import type { NucleoBorradores, ResumenPurga } from "./nucleo";
import type { Resultado } from "./almacen";
import type { AlmacenPreferencias } from "./preferencia";
import { fijarPersistencia } from "./preferencia";
import type { TipoBorrador } from "./tipos";

/**
 * BORR-1b — POLÍTICA DE SESIÓN Y LIMPIEZA LOCAL. Lógica pura e inyectable (sin React, sin red, sin leer sesión); la interfaz de
 * consentimiento la provee quien la integra (`decidir` / `decidirTrasFallo` / `confirmar`).
 *
 * REGLAS
 *  - Apagón, cierre inesperado del navegador y EXPIRACIÓN de sesión: NO se limpia nada. Estas rutas no llaman a este módulo (la
 *    expiración la dispara SessionInactivityGuard, que no lo usa). Los borradores quedan aislados por `ownerKey`: el siguiente
 *    usuario del equipo no los ve; su dueño los recupera al volver a iniciar sesión (retención de 14 días).
 *  - Salir EXPLÍCITAMENTE (menú de cuenta / selector de empresa) con borradores en este equipo: se pide una decisión informada.
 *    Como aún no existe respaldo en servidor, borrar es IRREVERSIBLE: solo se borra con «borrar» explícito; ante cualquier duda
 *    (sin decisión, error de la interfaz) se CONSERVA.
 *  - Consulta previa (solo lectura) fallida o lenta: no se pidió destruir nada, la salida continúa sin tocar datos.
 *  - Si el usuario eligió BORRAR y la eliminación NO se confirma por completo (parcial, error, plazo vencido, resultado
 *    incierto), la salida NO continúa en silencio: se exige una decisión informada (`decidirTrasFallo`): reintentar, salir
 *    conservando lo que pueda quedar, o cancelar la salida. Sin esa decisión la salida se CANCELA. «borrados» solo se informa
 *    cuando TODAS las transacciones de borrado se confirmaron.
 *  - Cada operación tiene un plazo. Al vencer, la purga se CANCELA de forma cooperativa (no se inicia ninguna eliminación nueva
 *    y una transacción aún no ejecutada ya no borra); una transacción que ya emitió su borrado no se puede revertir y se
 *    informa como resultado INCIERTO.
 *  - Solo se tocan los borradores del `ownerKey` indicado (nunca los de otros usuarios del mismo navegador), y solo las
 *    versiones que existían al consentir: lo creado o modificado después se conserva.
 *  - Limitación asumida: IndexedDB no cifra ni aísla fuertemente a usuarios del mismo perfil del navegador.
 */

export type DecisionSalida = "conservar" | "borrar" | "cancelar";

/** Decisión del usuario cuando la eliminación solicitada no se confirmó por completo. */
export type DecisionTrasFallo = "reintentar" | "salir" | "cancelar";

export type ResumenBorradoresUsuario = {
  /** Borradores legibles + ilegibles. */
  total: number;
  ilegibles: number;
  porTipo: Record<TipoBorrador, number>;
  /** Epoch ms del guardado más reciente, o null. */
  ultimaActualizacion: number | null;
};

export type EstadoLimpieza =
  | "no_requerida" // sin borradores / sin ownerKey
  | "conservados" // el usuario eligió conservarlos
  | "borrados" // eliminación COMPLETA y confirmada por el almacenamiento
  | "parcial" // se eliminaron algunos; otros siguen (conocido)
  | "fallida" // error de almacenamiento: no se eliminó nada (conocido)
  | "tiempo_agotado" // la eliminación no terminó a tiempo; ver `informe.incierto`
  | "error_inesperado" // excepción inesperada tras autorizar el borrado: resultado INCIERTO
  | "consulta_fallida" // no se pudo ni consultar (solo lectura; no se pidió destruir nada)
  | "consulta_tiempo_agotado";

/** Qué ocurrió con una eliminación solicitada que NO se confirmó por completo. */
export type InformeLimpieza = {
  estado: "parcial" | "fallida" | "tiempo_agotado" | "error_inesperado";
  /** Borradores objetivo al iniciar. */
  total: number;
  /** Confirmados como eliminados. */
  eliminados: number;
  /** Siguen (o podrían seguir) en este equipo: total - eliminados. */
  restantes: number;
  /** De los restantes, los que cambiaron durante la limpieza y se conservaron a propósito. */
  cambiados: number;
  /**
   * true si no se puede asegurar el resultado real: había una transacción de borrado EN CURSO al vencer el plazo, o ocurrió una
   * excepción inesperada tras autorizar el borrado. Algunos borradores pueden haberse eliminado ya sin confirmación, y la
   * operación podría terminar unos instantes después. `eliminados` es solo lo CONFIRMADO.
   */
  incierto: boolean;
  /** Número de intento (1 = el primero). */
  intento: number;
};

export type ResultadoCierreSesion = {
  /** `false` solo si la salida se canceló (decisión del usuario, o ausencia de decisión tras un fallo). */
  continuar: boolean;
  limpieza: EstadoLimpieza;
  detectados: number;
  eliminados: number;
  /** Presente cuando se pidió borrar y no se confirmó por completo. */
  informe?: InformeLimpieza;
  /** true si el usuario aceptó salir sabiendo que la eliminación no se confirmó. */
  salidaInformada?: boolean;
  intentos?: number;
};

export const TIEMPO_MAX_LIMPIEZA_MS = 3000;
/** Tiempo extra, tras cancelar por plazo, para que la purga informe su estado real antes de declararla incierta. */
export const GRACIA_CANCELACION_MS = 500;
const MAX_INTENTOS = 10;

type NucleoLimpieza = Pick<NucleoBorradores, "listarMetadatosUsuario" | "purgarUsuario">;
type Acotado<T> = { tipo: "ok"; valor: T } | { tipo: "tiempo_agotado" } | { tipo: "error" };

function temporizador(ms: number) {
  let id: ReturnType<typeof setTimeout> | undefined;
  const promesa = new Promise<"tiempo">((resolve) => { id = setTimeout(() => resolve("tiempo"), ms); });
  return { promesa, cancelar: () => clearTimeout(id) };
}

/** Acota una operación SOLO DE LECTURA: nunca rechaza y nunca tarda más que `ms`. */
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

type Purga = { estado: "borrados"; eliminados: number } | { estado: "informe"; informe: Omit<InformeLimpieza, "intento"> };

/**
 * UNA purga con plazo y cancelación cooperativa. Al vencer el plazo se cancela (no se inician más eliminaciones) y se espera
 * una breve gracia a que la purga informe su estado real; si no responde, el resultado es INCIERTO con lo último confirmado.
 */
async function purgarAcotado(nucleo: NucleoLimpieza, ownerKey: string, ms: number, graciaMs: number, consentidoEn: number, detectados: number): Promise<Purga> {
  let controlador: AbortController | undefined;
  let ultimo: ResumenPurga | null = null;
  const informe = (estado: InformeLimpieza["estado"], total: number, eliminados: number, cambiados: number, incierto: boolean): Purga => ({
    estado: "informe",
    informe: { estado, total, eliminados, restantes: Math.max(total - eliminados, 0), cambiados, incierto },
  });
  /** Lo último CONFIRMADO por la purga (si llegó a registrar algo); nunca se informa «0» ignorando ese progreso. */
  const progreso = () => {
    const s = ultimo as ResumenPurga | null;
    return { total: s && s.total > 0 ? s.total : detectados, eliminados: s?.eliminados ?? 0, cambiados: s?.cambiados ?? 0 };
  };
  try {
    controlador = new AbortController();
    const senal = controlador.signal;
    let operacion: Promise<Resultado<ResumenPurga>>;
    try {
      operacion = nucleo.purgarUsuario(ownerKey, { signal: senal, consentidoEn, alProgresar: (r) => { ultimo = { ...r }; } });
    } catch {
      // Lanzó de forma síncrona al iniciar: no se sabe si llegó a emitir algún borrado → se trata como inesperado/incierto.
      controlador.abort();
      const p = progreso();
      return informe("error_inesperado", p.total, p.eliminados, p.cambiados, true);
    }
    const fin = operacion.then((r) => ({ tipo: "fin" as const, r }), () => ({ tipo: "error" as const }));

    const t1 = temporizador(ms);
    const primero = await Promise.race([fin, t1.promesa]);
    t1.cancelar();
    let terminado: Awaited<typeof fin> | null;
    if (primero === "tiempo") {
      controlador.abort(); // cooperativo: nada nuevo se inicia a partir de aquí
      const t2 = temporizador(graciaMs);
      const segundo = await Promise.race([fin, t2.promesa]);
      t2.cancelar();
      terminado = segundo === "tiempo" ? null : segundo;
    } else {
      terminado = primero;
    }

    if (terminado === null) { // no respondió ni tras cancelar: no se puede saber qué terminó
      const p = progreso();
      return informe("tiempo_agotado", p.total, p.eliminados, p.cambiados, true);
    }
    if (terminado.tipo === "error") { // la purga RECHAZÓ de forma inesperada: pudo haber confirmado borrados antes
      controlador.abort();
      const p = progreso();
      return informe("error_inesperado", p.total, p.eliminados, p.cambiados, true);
    }
    if (!terminado.r.ok) { // fallo de listado/ámbito: no empezó a borrar. Si hubiera progreso, el resultado es incoherente → incierto.
      const p = progreso();
      return p.eliminados > 0 ? informe("error_inesperado", p.total, p.eliminados, p.cambiados, true) : informe("fallida", detectados, 0, 0, false);
    }

    const s = terminado.r.valor;
    if (s.cancelado) {
      // Cancelada durante el LISTADO (solo lectura, `total` aún 0): no se eliminó nada y se conserva lo que se detectó al consentir.
      const total = s.total === 0 ? detectados : s.total;
      return informe("tiempo_agotado", total, s.eliminados, s.cambiados, s.indeterminados > 0);
    }
    if (s.eliminados === s.total) return { estado: "borrados", eliminados: s.eliminados }; // incluye total 0
    return informe(s.eliminados > 0 || s.cambiados > 0 ? "parcial" : "fallida", s.total, s.eliminados, s.cambiados, false);
  } catch {
    // Cualquier excepción inesperada tras autorizar el borrado: se detiene lo que quede por iniciar y el resultado es INCIERTO.
    try { controlador?.abort(); } catch { /* ya cancelado */ }
    const p = progreso();
    return informe("error_inesperado", p.total, p.eliminados, p.cambiados, true);
  }
}

/** Resultado cuando una excepción inesperada ocurre DESPUÉS de autorizar el borrado: se advierte (resultado incierto); jamás se sale en silencio. */
export async function resolverTrasExcepcionInesperada(
  decidirTrasFallo: ((informe: InformeLimpieza) => Promise<DecisionTrasFallo>) | undefined,
  detectados: number,
  eliminados = 0,
): Promise<ResultadoCierreSesion> {
  const informe: InformeLimpieza = { estado: "error_inesperado", total: detectados, eliminados, restantes: Math.max(detectados - eliminados, 0), cambiados: 0, incierto: true, intento: 1 };
  let siguiente: DecisionTrasFallo = "cancelar";
  try { if (decidirTrasFallo) siguiente = await decidirTrasFallo(informe); } catch { siguiente = "cancelar"; }
  // «reintentar» no está disponible en esta vía de último recurso: equivale a cancelar la salida (nunca a continuar).
  return siguiente === "salir"
    ? { continuar: true, limpieza: "error_inesperado", detectados, eliminados, informe, salidaInformada: true }
    : { continuar: false, limpieza: "error_inesperado", detectados, eliminados, informe, salidaInformada: false };
}

/**
 * Se ejecuta ANTES de la salida EXPLÍCITA. Nunca lanza. `ownerKey === null` (función desactivada en el servidor) → nada que hacer.
 *
 * EXCEPCIONES INESPERADAS, por fase:
 *  - Antes de que el usuario autorice borrar (consulta previa de solo lectura, decisión): no se pidió destruir nada → la salida
 *    puede continuar sin tocar datos (`consulta_fallida`).
 *  - Durante o después de autorizar el borrado (la purga, su interpretación, la advertencia): resultado INCIERTO → se advierte
 *    con la misma interfaz; sin ella, o si falla, la salida se CANCELA. Nunca se continúa en silencio.
 * Tras «borrar», solo devuelve `continuar: true` con `limpieza: "borrados"` si TODO se confirmó; en cualquier otro caso exige
 * `decidirTrasFallo` (y sin él, o si falla, CANCELA la salida).
 */
export async function prepararCierreSesionExplicito(opciones: {
  ownerKey: string | null;
  nucleo: NucleoLimpieza;
  /** Interfaz de consentimiento: recibe el resumen y devuelve la decisión. Si falla, se conserva. */
  decidir: (resumen: ResumenBorradoresUsuario) => Promise<DecisionSalida>;
  /** Interfaz de advertencia cuando se pidió borrar y no se confirmó por completo. Si falta o falla, se cancela la salida. */
  decidirTrasFallo?: (informe: InformeLimpieza) => Promise<DecisionTrasFallo>;
  tiempoMaxMs?: number;
  graciaCancelacionMs?: number;
}): Promise<ResultadoCierreSesion> {
  const { ownerKey, nucleo, decidir, decidirTrasFallo } = opciones;
  const ms = opciones.tiempoMaxMs ?? TIEMPO_MAX_LIMPIEZA_MS;
  const gracia = opciones.graciaCancelacionMs ?? GRACIA_CANCELACION_MS;
  const sin = (limpieza: EstadoLimpieza, detectados = 0, eliminados = 0): ResultadoCierreSesion => ({ continuar: true, limpieza, detectados, eliminados });
  if (ownerKey === null) return sin("no_requerida");

  let borradoAutorizado = false;
  let detectados = 0;
  try {
    const resumen = await resumenDe(nucleo, ownerKey, ms);
    if (resumen.tipo === "tiempo_agotado") return sin("consulta_tiempo_agotado"); // solo lectura: no se pidió destruir nada
    if (resumen.tipo === "error") return sin("consulta_fallida");
    detectados = resumen.valor.total;
    if (detectados === 0) return sin("no_requerida");

    let decision: DecisionSalida;
    try {
      decision = await decidir(resumen.valor);
    } catch {
      decision = "conservar"; // sin consentimiento claro, jamás se borra
    }
    if (decision === "cancelar") return { continuar: false, limpieza: "no_requerida", detectados, eliminados: 0 };
    if (decision !== "borrar") return sin("conservados", detectados);

    borradoAutorizado = true; // a partir de aquí, cualquier excepción es de una eliminación AUTORIZADA
    const consentidoEn = Date.now();
    for (let intento = 1; intento <= MAX_INTENTOS; intento++) {
      const purga = await purgarAcotado(nucleo, ownerKey, ms, gracia, consentidoEn, detectados);
      if (purga.estado === "borrados") return { continuar: true, limpieza: "borrados", detectados, eliminados: purga.eliminados, intentos: intento };

      const informe: InformeLimpieza = { ...purga.informe, intento };
      let siguiente: DecisionTrasFallo = "cancelar";
      try { if (decidirTrasFallo) siguiente = await decidirTrasFallo(informe); } catch { siguiente = "cancelar"; }
      if (siguiente === "reintentar") continue;
      const base = { limpieza: informe.estado, detectados, eliminados: informe.eliminados, informe, intentos: intento };
      return siguiente === "salir" ? { continuar: true, salidaInformada: true, ...base } : { continuar: false, salidaInformada: false, ...base };
    }
    // Demasiados reintentos sin confirmar: no se sale en silencio.
    return { continuar: false, limpieza: "fallida", detectados, eliminados: 0, intentos: MAX_INTENTOS };
  } catch {
    if (!borradoAutorizado) return sin("consulta_fallida"); // excepción de solo lectura / previa al consentimiento
    return resolverTrasExcepcionInesperada(decidirTrasFallo, detectados);
  }
}

export type ResultadoDesactivacion = {
  estado: "desactivada" | "cancelada" | "desactivada_con_residuos" | "no_aplicada";
  detectados: number;
  eliminados: number;
  informe?: InformeLimpieza;
};

/**
 * «No guardar en este equipo»: con confirmación informada si hay borradores del usuario, desactiva la persistencia y elimina
 * SUS borradores. Orden deliberado: primero se fija la preferencia (cesan las escrituras) y después se borra; si el borrado no
 * se confirma por completo, la preferencia permanece y se informa `desactivada_con_residuos` (con el informe real). Si el
 * navegador no puede guardar la preferencia, NO se borra nada (`no_aplicada`). Solo se eliminan los borradores del `ownerKey`.
 */
export async function desactivarPersistencia(opciones: {
  ownerKey: string | null;
  nucleo: NucleoLimpieza;
  prefs: AlmacenPreferencias | null;
  confirmar: (resumen: ResumenBorradoresUsuario) => Promise<boolean>;
  tiempoMaxMs?: number;
  graciaCancelacionMs?: number;
}): Promise<ResultadoDesactivacion> {
  const { ownerKey, nucleo, prefs, confirmar } = opciones;
  const ms = opciones.tiempoMaxMs ?? TIEMPO_MAX_LIMPIEZA_MS;
  const gracia = opciones.graciaCancelacionMs ?? GRACIA_CANCELACION_MS;
  let detectados = 0;
  let hayQueBorrar = false;
  let preferenciaFijada = false; // hasta aquí una excepción no deja nada cambiado; después, puede haber residuos inciertos

  try {
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

    const consentidoEn = Date.now();
    if (!fijarPersistencia(prefs, false)) return { estado: "no_aplicada", detectados, eliminados: 0 };
    preferenciaFijada = true;
    if (!hayQueBorrar || ownerKey === null) return { estado: "desactivada", detectados, eliminados: 0 };

    const purga = await purgarAcotado(nucleo, ownerKey, ms, gracia, consentidoEn, detectados);
    if (purga.estado === "borrados") return { estado: "desactivada", detectados, eliminados: purga.eliminados };
    return { estado: "desactivada_con_residuos", detectados, eliminados: purga.informe.eliminados, informe: { ...purga.informe, intento: 1 } };
  } catch {
    if (!preferenciaFijada) return { estado: "no_aplicada", detectados, eliminados: 0 };
    return {
      estado: "desactivada_con_residuos", detectados, eliminados: 0,
      informe: { estado: "error_inesperado", total: detectados, eliminados: 0, restantes: detectados, cambiados: 0, incierto: true, intento: 1 },
    };
  }
}

/** Texto de la advertencia cuando la eliminación solicitada no se confirmó por completo. Nunca afirma «borrado correctamente». */
export function textoAdvertenciaLimpieza(informe: InformeLimpieza): { titulo: string; detalle: string; salir: string } {
  const de = `${informe.eliminados} de ${informe.total}`;
  const cambiados = informe.cambiados > 0 ? ` (${informe.cambiados} cambiaron durante la limpieza y se conservaron a propósito)` : "";
  const confirmados = informe.eliminados > 0 ? ` Antes de interrumpirse se confirmó la eliminación de ${de} borradores, pero no se puede asegurar el resto.` : "";
  if (informe.estado === "error_inesperado") {
    return {
      titulo: "No se pudo confirmar la eliminación",
      detalle: `Ocurrió un error inesperado durante la eliminación. No se puede confirmar qué borradores se eliminaron: es posible que algunos ya se hayan borrado y que otros sigan guardados en este equipo, y una operación en curso podría terminar unos instantes después.${confirmados}`,
      salir: "Salir sin confirmar el estado de los borradores",
    };
  }
  if (informe.incierto) {
    return {
      titulo: "No se pudo confirmar la eliminación",
      detalle: `La eliminación no respondió a tiempo. No se puede confirmar qué borradores se eliminaron: es posible que algunos ya se hayan borrado y que otros sigan guardados en este equipo, y una operación en curso podría terminar unos instantes después.${confirmados}`,
      salir: "Salir sin confirmar el estado de los borradores",
    };
  }
  if (informe.estado === "tiempo_agotado") {
    return {
      titulo: "La eliminación no terminó a tiempo",
      detalle: `Se eliminaron ${de} borradores. La eliminación se detuvo y no se tocó el resto: ${informe.restantes} siguen guardados en este equipo${cambiados}.`,
      salir: "Salir y conservar los borradores restantes",
    };
  }
  if (informe.estado === "parcial") {
    return {
      titulo: "No se pudieron eliminar todos los borradores",
      detalle: `Se eliminaron ${de} borradores. ${informe.restantes} siguen guardados en este equipo${cambiados}.`,
      salir: "Salir y conservar los borradores restantes",
    };
  }
  return {
    titulo: "No se pudieron eliminar los borradores",
    detalle: `Ocurrió un error de almacenamiento y no se eliminó ningún borrador: los ${informe.total} siguen guardados en este equipo.`,
    salir: "Salir y conservar los borradores",
  };
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
