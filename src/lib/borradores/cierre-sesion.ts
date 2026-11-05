import type { NucleoBorradores } from "./nucleo";
import type { AlmacenPreferencias } from "./preferencia";
import { fijarPersistencia } from "./preferencia";
import type { TipoBorrador } from "./tipos";

/**
 * BORR-1b — POLÍTICA DE SESIÓN Y LIMPIEZA LOCAL. Lógica pura e inyectable (sin React, sin red, sin leer sesión); la interfaz de
 * consentimiento la provee quien la integra (`decidir` / `confirmar`).
 *
 * REGLAS
 *  - Apagón, cierre inesperado del navegador y EXPIRACIÓN de sesión: NO se limpia nada. Estas rutas no llaman a este módulo (la
 *    expiración la dispara SessionInactivityGuard, que no lo usa). Los borradores quedan aislados por `ownerKey`: el siguiente
 *    usuario del equipo no los ve; su dueño los recupera al volver a iniciar sesión (retención de 14 días).
 *  - Salir EXPLÍCITAMENTE (menú de cuenta / selector de empresa) con borradores en este equipo: se pide una decisión informada.
 *    Como aún no existe respaldo en servidor, borrar es IRREVERSIBLE: solo se borra con «borrar» explícito; ante cualquier duda
 *    (sin decisión, error de la interfaz) se CONSERVA.
 *  - La limpieza nunca bloquea la salida: cada operación de IndexedDB tiene tiempo máximo y sus errores se informan en el
 *    resultado, no se propagan. «Cancelar» es la única decisión que detiene la salida, y la toma el usuario.
 *  - Solo se tocan los borradores del `ownerKey` indicado (nunca los de otros usuarios del mismo navegador).
 *  - Limitación asumida: IndexedDB no cifra ni aísla fuertemente a usuarios del mismo perfil del navegador.
 */

export type DecisionSalida = "conservar" | "borrar" | "cancelar";

export type ResumenBorradoresUsuario = {
  /** Borradores legibles + ilegibles. */
  total: number;
  ilegibles: number;
  porTipo: Record<TipoBorrador, number>;
  /** Epoch ms del guardado más reciente, o null. */
  ultimaActualizacion: number | null;
};

export type EstadoLimpieza = "no_requerida" | "conservados" | "borrados" | "parcial" | "fallida" | "tiempo_agotado";

export type ResultadoCierreSesion = {
  /** `false` solo si el usuario canceló la salida. */
  continuar: boolean;
  limpieza: EstadoLimpieza;
  detectados: number;
  eliminados: number;
};

export const TIEMPO_MAX_LIMPIEZA_MS = 3000;

type NucleoLimpieza = Pick<NucleoBorradores, "listarMetadatosUsuario" | "purgarUsuario">;
type Acotado<T> = { tipo: "ok"; valor: T } | { tipo: "tiempo_agotado" } | { tipo: "error" };

/** Acota una operación asíncrona: nunca rechaza y nunca tarda más que `ms`. */
function acotar<T>(operacion: () => Promise<T>, ms: number): Promise<Acotado<T>> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve({ tipo: "tiempo_agotado" }), ms);
    let p: Promise<T>;
    try {
      p = operacion();
    } catch {
      clearTimeout(t);
      return resolve({ tipo: "error" });
    }
    p.then(
      (valor) => { clearTimeout(t); resolve({ tipo: "ok", valor }); },
      () => { clearTimeout(t); resolve({ tipo: "error" }); },
    );
  });
}

function resumir(borradores: { tipo: TipoBorrador; actualizadoEn: number }[], ilegibles: number): ResumenBorradoresUsuario {
  const porTipo: Record<TipoBorrador, number> = { solicitud_fondo: 0, gasto_operativo: 0, requerimiento_compra: 0 };
  let ultima: number | null = null;
  for (const b of borradores) {
    porTipo[b.tipo]++;
    if (ultima === null || b.actualizadoEn > ultima) ultima = b.actualizadoEn;
  }
  return { total: borradores.length + ilegibles, ilegibles, porTipo, ultimaActualizacion: ultima };
}

async function resumenDe(nucleo: NucleoLimpieza, ownerKey: string, ms: number): Promise<Acotado<ResumenBorradoresUsuario>> {
  const r = await acotar(() => nucleo.listarMetadatosUsuario(ownerKey), ms);
  if (r.tipo !== "ok") return r;
  if (!r.valor.ok) return { tipo: "error" };
  return { tipo: "ok", valor: resumir(r.valor.valor.borradores, r.valor.valor.ilegibles) };
}

async function purgar(nucleo: NucleoLimpieza, ownerKey: string, ms: number): Promise<{ estado: "borrados" | "parcial" | "fallida" | "tiempo_agotado"; eliminados: number }> {
  const r = await acotar(() => nucleo.purgarUsuario(ownerKey), ms);
  if (r.tipo === "tiempo_agotado") return { estado: "tiempo_agotado", eliminados: 0 };
  if (r.tipo === "error" || !r.valor.ok) return { estado: "fallida", eliminados: 0 };
  return { estado: r.valor.valor.fallidos === 0 ? "borrados" : "parcial", eliminados: r.valor.valor.eliminados };
}

/**
 * Se ejecuta ANTES de la salida EXPLÍCITA. Nunca lanza ni bloquea la salida por errores de almacenamiento.
 * `ownerKey === null` (función desactivada en el servidor) → no hay nada que hacer.
 */
export async function prepararCierreSesionExplicito(opciones: {
  ownerKey: string | null;
  nucleo: NucleoLimpieza;
  /** Interfaz de consentimiento: recibe el resumen y devuelve la decisión. Si falla, se conserva. */
  decidir: (resumen: ResumenBorradoresUsuario) => Promise<DecisionSalida>;
  tiempoMaxMs?: number;
}): Promise<ResultadoCierreSesion> {
  const { ownerKey, nucleo, decidir } = opciones;
  const ms = opciones.tiempoMaxMs ?? TIEMPO_MAX_LIMPIEZA_MS;
  const sin = (limpieza: EstadoLimpieza, detectados = 0, eliminados = 0): ResultadoCierreSesion => ({ continuar: true, limpieza, detectados, eliminados });
  if (ownerKey === null) return sin("no_requerida");

  const resumen = await resumenDe(nucleo, ownerKey, ms);
  if (resumen.tipo === "tiempo_agotado") return sin("tiempo_agotado");
  if (resumen.tipo === "error") return sin("fallida"); // no se pudo ni consultar: se sale sin tocar nada
  if (resumen.valor.total === 0) return sin("no_requerida");

  let decision: DecisionSalida;
  try {
    decision = await decidir(resumen.valor);
  } catch {
    decision = "conservar"; // sin consentimiento claro, jamás se borra
  }
  if (decision === "cancelar") return { continuar: false, limpieza: "no_requerida", detectados: resumen.valor.total, eliminados: 0 };
  if (decision !== "borrar") return sin("conservados", resumen.valor.total);

  const p = await purgar(nucleo, ownerKey, ms);
  return sin(p.estado, resumen.valor.total, p.eliminados);
}

export type ResultadoDesactivacion = {
  estado: "desactivada" | "cancelada" | "desactivada_con_residuos" | "no_aplicada";
  detectados: number;
  eliminados: number;
};

/**
 * «No guardar en este equipo»: con confirmación informada si hay borradores del usuario, desactiva la persistencia y elimina
 * SUS borradores. Orden deliberado: primero se fija la preferencia (cesan las escrituras) y después se borra; si el borrado
 * falla, la preferencia permanece y se informa `desactivada_con_residuos`. Si el navegador no puede guardar la preferencia,
 * NO se borra nada (`no_aplicada`). Solo se eliminan los borradores del `ownerKey` indicado.
 */
export async function desactivarPersistencia(opciones: {
  ownerKey: string | null;
  nucleo: NucleoLimpieza;
  prefs: AlmacenPreferencias | null;
  confirmar: (resumen: ResumenBorradoresUsuario) => Promise<boolean>;
  tiempoMaxMs?: number;
}): Promise<ResultadoDesactivacion> {
  const { ownerKey, nucleo, prefs, confirmar } = opciones;
  const ms = opciones.tiempoMaxMs ?? TIEMPO_MAX_LIMPIEZA_MS;
  let detectados = 0;
  let hayQueBorrar = false;

  if (ownerKey !== null) {
    const resumen = await resumenDe(nucleo, ownerKey, ms);
    if (resumen.tipo !== "ok") {
      // No se puede saber si hay borradores: no se desactiva a ciegas, para no dejar residuos sin informar.
      return { estado: "no_aplicada", detectados: 0, eliminados: 0 };
    }
    detectados = resumen.valor.total;
    if (detectados > 0) {
      let acepto = false;
      try { acepto = await confirmar(resumen.valor); } catch { acepto = false; }
      if (!acepto) return { estado: "cancelada", detectados, eliminados: 0 };
      hayQueBorrar = true;
    }
  }

  if (!fijarPersistencia(prefs, false)) return { estado: "no_aplicada", detectados, eliminados: 0 };
  if (!hayQueBorrar || ownerKey === null) return { estado: "desactivada", detectados, eliminados: 0 };

  const p = await purgar(nucleo, ownerKey, ms);
  return { estado: p.estado === "borrados" ? "desactivada" : "desactivada_con_residuos", detectados, eliminados: p.eliminados };
}

/** Mensajes de consentimiento (texto único para toda la aplicación). */
export function textoConsentimientoSalida(r: ResumenBorradoresUsuario): { conservar: string; borrar: string } {
  const n = r.total === 1 ? "1 borrador sin terminar" : `${r.total} borradores sin terminar`;
  return {
    conservar: `Tienes ${n} guardado(s) SOLO en este equipo (aún sin respaldo en el servidor).\n\nAceptar: salir y CONSERVARLOS para tu próxima sesión (recomendado en tu equipo).\nCancelar: ver otras opciones.`,
    borrar: `¿Salir y BORRAR ${n} de este equipo? Es útil en un equipo compartido, pero NO se puede deshacer: los borradores se perderán.\n\nAceptar: borrar y salir.\nCancelar: no salir.`,
  };
}

/** Decisión de salida con diálogos nativos (marcador de posición hasta que exista el diálogo propio de BORR-1c). */
export function decidirSalidaConDialogoNativo(confirmarFn: (mensaje: string) => boolean): (r: ResumenBorradoresUsuario) => Promise<DecisionSalida> {
  return async (resumen) => {
    const t = textoConsentimientoSalida(resumen);
    if (confirmarFn(t.conservar)) return "conservar";
    return confirmarFn(t.borrar) ? "borrar" : "cancelar";
  };
}
