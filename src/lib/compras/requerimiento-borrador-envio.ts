import type { FalloAccion, SnapshotBorrador } from "@/lib/borradores/controlador";
import { CLAVE_ENVIO_REGEX } from "@/lib/idempotencia/clave-envio";

/**
 * BORR-1d — PUENTE entre el formulario de Nuevo requerimiento y el borrador local, para el ENVÍO OFICIAL.
 *
 * Garantías (todas del lado cliente; el backend de Compras no cambia):
 *  1. Antes del primer POST se registra en IndexedDB `estadoEnvio: "enviando"` + la clave de idempotencia + el payload final. Si ese
 *     registro falla, NO se hace el POST.
 *  2. La clave del intento es UNA sola (`crearEnvioUnico`), alineada con la persistida en el borrador. Nunca se renueva sola.
 *  3. Respuesta incierta (red caída, timeout, 5xx, cuerpo ilegible): el intento queda «enviando»; el reintento del MISMO contenido
 *     reutiliza la MISMA clave (el servidor devuelve el requerimiento original). Tras recargar, el borrador queda en «reconciliación
 *     pendiente»: el núcleo no permite recuperarlo ni descartarlo, y este formulario no envía otro documento.
 *  4. Rechazo definitivo (4xx: nada se creó): el intento se resuelve como «ninguno» conservando la clave y se vuelve a editar.
 *  5. Creación confirmada: se marca «completado» y, solo después, se elimina el borrador local (ya no se necesita la clave).
 */
export type ApiBorradorEnvio = {
  snapshot: SnapshotBorrador;
  registrarEnvio: (clave: string) => Promise<{ ok: true } | FalloAccion>;
  resolverEnvio: (o: { estadoEnvio: "completado" | "ninguno"; claveEnvio?: string | null }) => Promise<{ ok: true } | FalloAccion>;
  descartar: (o: { confirmado: boolean }) => Promise<{ ok: true } | FalloAccion>;
};

/** Contenedor mutable estable: el componente de autoguardado publica aquí la API vigente; el envío la lee al enviar. */
export type PuenteBorrador = { api: ApiBorradorEnvio | null; publicar: (api: ApiBorradorEnvio | null) => void };
export const crearPuenteBorrador = (): PuenteBorrador => {
  const p: PuenteBorrador = { api: null, publicar: (api) => { p.api = api; } };
  return p;
};

export type PlanEnvio =
  | { tipo: "sin_borrador" } // sin autoguardado (desactivado por el usuario / sin contexto): comportamiento anterior
  | { tipo: "registrar" } // primer intento (o intento nuevo tras un rechazo): registrar antes del POST
  | { tipo: "reintento" } // intento ya registrado con la misma clave y el mismo contenido (respuesta incierta previa)
  | { tipo: "bloqueado"; mensaje: string };

export function planearEnvio(api: ApiBorradorEnvio | null, claveActual: string, documento = "requerimiento"): PlanEnvio {
  if (!api) return { tipo: "sin_borrador" };
  const s = api.snapshot;
  switch (s.fase) {
    case "sin_contexto": case "desactivado": case "cerrado": return { tipo: "sin_borrador" };
    case "activo": return { tipo: "registrar" };
    case "bloqueado":
      if (s.bloqueo === "envio_en_curso" && s.estadoEnvio === "enviando" && s.claveEnvio === claveActual) return { tipo: "reintento" };
      return { tipo: "bloqueado", mensaje: s.bloqueo === "enviado" ? `Este ${documento} ya se envió oficialmente.` : s.bloqueo === "envio_en_curso" ? "Hay un envío anterior sin resultado confirmado con otra clave: no se envía otro documento." : "El borrador guardado en este equipo no permite enviar. Recarga la página o descártalo." };
    case "decision_pendiente": case "en_espera":
      return { tipo: "bloqueado", mensaje: s.recuperacion?.situacion === "envio_incierto" || s.estadoEnvio === "enviando" ? "Reconciliación pendiente: un envío anterior no tiene resultado confirmado. No se envía otro documento mientras tanto." : "Hay un borrador guardado sin resolver. Recupéralo o descártalo antes de enviar." };
    default: return { tipo: "bloqueado", mensaje: "El autoguardado no está listo para enviar. Espera un momento o recarga la página." };
  }
}

export type ResultadoEnvio = "exito" | "rechazo_definitivo" | "incierto";

/**
 * Clasifica la respuesta de la CREACIÓN. «exito» exige 2xx con un id numérico: un 2xx ilegible es incierto (puede haberse creado).
 * Los 5xx, 408, 425 y 429 y los fallos de red son inciertos; el resto de 4xx son rechazos (el servidor no creó nada con esa petición).
 */
export function clasificarResultadoEnvio(r: { lanzo: boolean; ok?: boolean; status?: number; id?: unknown }): ResultadoEnvio {
  if (r.lanzo) return "incierto";
  const st = r.status ?? 0;
  if (r.ok) return typeof r.id === "number" && Number.isSafeInteger(r.id) && r.id > 0 ? "exito" : "incierto";
  if (st >= 500 || st === 408 || st === 425 || st === 429 || st === 0) return "incierto";
  return "rechazo_definitivo";
}

/** Prepara el envío. `false` = NO hacer el POST. Alinea la clave del `envio` con la persistida en el borrador recuperado. */
export async function prepararEnvioBorrador(
  puente: PuenteBorrador,
  envio: { clave(): string; adoptarClave(c: string): boolean },
  documento = "requerimiento",
): Promise<{ ok: true; registrado: boolean } | { ok: false; mensaje: string }> {
  const api = puente.api;
  if (api && api.snapshot.fase === "activo" && api.snapshot.claveEnvio && CLAVE_ENVIO_REGEX.test(api.snapshot.claveEnvio)) envio.adoptarClave(api.snapshot.claveEnvio);
  const clave = envio.clave();
  const plan = planearEnvio(api, clave, documento);
  if (plan.tipo === "sin_borrador") return { ok: true, registrado: false };
  if (plan.tipo === "bloqueado") return { ok: false, mensaje: plan.mensaje };
  if (plan.tipo === "reintento") return { ok: true, registrado: true };
  let r: { ok: true } | FalloAccion;
  try { r = await api!.registrarEnvio(clave); } catch { r = { ok: false, motivo: "excepcion", mensaje: "" }; }
  if (!r.ok) return { ok: false, mensaje: "No se pudo preparar el envío en este equipo (borrador local). No se envió nada; inténtalo de nuevo." };
  return { ok: true, registrado: true };
}

/** Tras un rechazo definitivo: libera el borrador conservando la clave. Mejor esfuerzo: si falla, queda bloqueado (falla cerrada). */
export async function liberarEnvioRechazado(puente: PuenteBorrador): Promise<boolean> {
  try { const r = await puente.api?.resolverEnvio({ estadoEnvio: "ninguno" }); return r?.ok === true; } catch { return false; }
}

/** Creación confirmada: marca «completado» (contrato) para que un reintento/recarga no ofrezca duplicar. Devuelve si quedó marcado. */
export async function marcarEnvioCompletado(puente: PuenteBorrador): Promise<boolean> {
  try { const r = await puente.api?.resolverEnvio({ estadoEnvio: "completado" }); return r?.ok === true; } catch { return false; }
}

/** Elimina el borrador de un envío ya CONFIRMADO. Solo si quedó marcado «completado» (nunca pierde la clave de un envío incierto). */
export async function limpiarBorradorEnviado(puente: PuenteBorrador, marcado: boolean): Promise<boolean> {
  if (!marcado) return false;
  try { const r = await puente.api?.descartar({ confirmado: true }); return r?.ok === true; } catch { return false; }
}
