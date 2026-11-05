import { abrirCanalSeguro, type CanalSeguro } from "./canal";
import { nuevaClaveEnvio } from "@/lib/idempotencia/clave-envio";

/**
 * BORR-1c — COORDINACIÓN con la salida de sesión: evita que un guardado pendiente o tardío recree borradores que el usuario pidió
 * eliminar al cerrar sesión.
 *
 * Flujo (salida explícita con «borrar»):
 *   1. `suspenderEscriturasDe(ownerKey)` — ANTES de la purga: cada controlador del propietario cancela su temporizador, no inicia
 *      escrituras nuevas y se espera (con tope) a que termine la que esté en vuelo, de modo que la purga la vea y la elimine.
 *      También se avisa por BroadcastChannel a las demás pestañas del mismo propietario, que se suspenden igual.
 *   2. La purga elimina (BORR-1b).
 *   3. Si la salida finalmente NO ocurre (cancelar, fallo informado…), `reanudarEscriturasDe(ownerKey)` vuelve a sincronizar los
 *      controladores con lo que haya en el almacén. Si la salida ocurre, la página se descarta con todos sus temporizadores.
 * Limitación documentada: un borrador NUEVO creado por otra pestaña después de la purga se considera trabajo nuevo (coherente con
 * `consentidoEn` de BORR-1b); uno ya existente no puede recrearse porque la revisión base (CAS) deja de coincidir.
 */
export type MotivoSuspension = "salida_de_sesion" | "otra_pestana_salio";

export interface ControladorCoordinable {
  readonly ownerKey: string;
  suspender(motivo: MotivoSuspension): Promise<void>;
  reanudar(): void;
  /** Resuelve cuando no hay ninguna escritura en vuelo (nunca rechaza). */
  esperarEscritura(): Promise<void>;
}

const registro = new Set<ControladorCoordinable>();
const escuchas = new Map<string, { canal: CanalSeguro | null; cuenta: number }>();
const INSTANCIA = nuevaClaveEnvio(); // identifica a ESTA página en los avisos (no es una identidad ni un secreto)

const nombreCanalSesion = (ownerKey: string) => `novalvion-borradores-sesion:${ownerKey}`;

function delPropietario(ownerKey: string): ControladorCoordinable[] {
  return [...registro].filter((c) => c.ownerKey === ownerKey);
}

function abrirEscucha(ownerKey: string) {
  const previa = escuchas.get(ownerKey);
  if (previa) { previa.cuenta++; return; }
  const canal = abrirCanalSeguro(nombreCanalSesion(ownerKey), INSTANCIA, (m) => {
    if (m.t === "purga_iniciada") for (const c of delPropietario(ownerKey)) void c.suspender("otra_pestana_salio");
    else if (m.t === "purga_cancelada") for (const c of delPropietario(ownerKey)) c.reanudar();
  });
  escuchas.set(ownerKey, { canal, cuenta: 1 });
}

function cerrarEscucha(ownerKey: string) {
  const e = escuchas.get(ownerKey);
  if (!e) return;
  if (--e.cuenta > 0) return;
  e.canal?.cerrar();
  escuchas.delete(ownerKey);
}

/** Registra un controlador; devuelve la función que lo retira (idempotente). */
export function registrarControlador(c: ControladorCoordinable): () => void {
  if (registro.has(c)) return () => undefined;
  registro.add(c);
  abrirEscucha(c.ownerKey);
  let retirado = false;
  return () => {
    if (retirado) return;
    retirado = true;
    registro.delete(c);
    cerrarEscucha(c.ownerKey);
  };
}

/** Avisa a las demás pestañas del propietario aunque esta página no tenga ningún controlador (abre un canal temporal). */
function avisarSesion(ownerKey: string, t: "purga_iniciada" | "purga_cancelada") {
  const existente = escuchas.get(ownerKey)?.canal;
  if (existente) { existente.publicar({ t }); return; }
  const temporal = abrirCanalSeguro(nombreCanalSesion(ownerKey), INSTANCIA, () => undefined);
  if (!temporal) return;
  temporal.publicar({ t });
  setTimeout(() => temporal.cerrar(), 100); // cerrar de inmediato podría descartar el mensaje aún no entregado
}

export const TOPE_ESPERA_SUSPENSION_MS = 2000;

/**
 * Suspende las escrituras de todos los controladores del propietario (en esta página y, por aviso, en las demás pestañas) y espera,
 * con tope, a que terminen las escrituras en vuelo. NUNCA lanza. `completo: false` = alguna escritura no terminó dentro del tope.
 */
export async function suspenderEscriturasDe(ownerKey: string, opciones: { esperaMaxMs?: number } = {}): Promise<{ suspendidos: number; completo: boolean }> {
  const locales = delPropietario(ownerKey);
  avisarSesion(ownerKey, "purga_iniciada");
  const esperas = locales.map((c) => c.suspender("salida_de_sesion").then(() => true, () => true));
  let completo = true;
  let id: ReturnType<typeof setTimeout> | undefined;
  const tope = new Promise<"tope">((res) => { id = setTimeout(() => res("tope"), opciones.esperaMaxMs ?? TOPE_ESPERA_SUSPENSION_MS); });
  const r = await Promise.race([Promise.all(esperas).then(() => "listo" as const), tope]);
  clearTimeout(id);
  if (r === "tope") completo = false;
  return { suspendidos: locales.length, completo };
}

/**
 * Espera (con tope) a las escrituras en vuelo del propietario SIN suspender a nadie. Sirve cuando la escritura nueva ya está
 * impedida por otro mecanismo (p. ej. la preferencia «No guardar en este equipo» que el almacén consulta en cada operación).
 */
export async function esperarEscriturasEnVueloDe(ownerKey: string, opciones: { esperaMaxMs?: number } = {}): Promise<{ completo: boolean }> {
  const esperas = delPropietario(ownerKey).map((c) => c.esperarEscritura().then(() => true, () => true));
  let id: ReturnType<typeof setTimeout> | undefined;
  const tope = new Promise<"tope">((res) => { id = setTimeout(() => res("tope"), opciones.esperaMaxMs ?? TOPE_ESPERA_SUSPENSION_MS); });
  const r = await Promise.race([Promise.all(esperas).then(() => "listo" as const), tope]);
  clearTimeout(id);
  return { completo: r === "listo" };
}

/** La salida no ocurrió: los controladores vuelven a sincronizarse con el almacén (y las demás pestañas, por aviso). */
export function reanudarEscriturasDe(ownerKey: string): void {
  avisarSesion(ownerKey, "purga_cancelada");
  for (const c of delPropietario(ownerKey)) {
    try { c.reanudar(); } catch { /* un controlador defectuoso no impide reanudar al resto */ }
  }
}

/** Solo pruebas: vacía el registro y cierra los canales. */
export function reiniciarCoordinacionParaPruebas(): void {
  registro.clear();
  for (const e of escuchas.values()) e.canal?.cerrar();
  escuchas.clear();
}
