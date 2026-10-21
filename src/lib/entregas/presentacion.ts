import type { Entrega } from "./entregas";
import {
  DEFINICIONES_ENTREGA,
  ETIQUETA_AREA,
  destinosDesde,
  type AreaEntrega,
  type EstadoEntrega,
  type ModoEntrega,
  type ModuloEntrega,
} from "./catalogo";
import { puedeActuarPorArea, puedeAnularAjenas, puedeOperarPresencial, type ActorEntrega } from "./reglas";

/**
 * CONTROL DE ENTREGA — presentación (PR 2). Lógica PURA y segura para el cliente: etiquetas en español, DTO sin identificadores
 * internos (ni firmas) y qué acciones puede ejecutar el actor sobre cada entrega. NO duplica reglas: las decide `reglas.ts` /
 * `catalogo.ts` (la misma fuente que usa el servicio). El servidor SIEMPRE revalida al ejecutar; esto solo evita ofrecer
 * botones que de todos modos serían rechazados.
 */

export const ETIQUETA_ESTADO_ENTREGA: Record<EstadoEntrega, string> = {
  EMITIDA: "Pendiente",
  RECIBIDA: "Recibida",
  RECHAZADA: "Rechazada",
  ANULADA: "Anulada",
};

export const ETIQUETA_MODO_ENTREGA: Record<ModoEntrega, string> = {
  SISTEMA: "En el sistema",
  PRESENCIAL: "Presencial",
};

export type AccionesEntrega = { recibir: boolean; rechazar: boolean; presencial: boolean; anular: boolean };

/** Qué puede hacer `actor` con `entrega` (solo una EMITIDA admite acciones; una RECIBIDA se corrige con una devolución). */
export function accionesDisponibles(actor: ActorEntrega, e: Pick<Entrega, "estado" | "modo" | "modulo" | "etapaDestino" | "emitidoPorUsuarioId">): AccionesEntrega {
  if (e.estado !== "EMITIDA") return { recibir: false, rechazar: false, presencial: false, anular: false };
  const receptorSistema = e.modo === "SISTEMA" && e.emitidoPorUsuarioId !== actor.usuarioId && puedeActuarPorArea(actor, e.modulo, e.etapaDestino);
  return {
    recibir: receptorSistema,
    rechazar: receptorSistema,
    presencial: e.modo === "PRESENCIAL" && puedeOperarPresencial(actor),
    anular: e.emitidoPorUsuarioId === actor.usuarioId || puedeAnularAjenas(actor),
  };
}

/** Lo que el cliente recibe de una entrega: sin ids internos de usuario/firma, con nombres y fechas ya legibles. */
export type EntregaDto = {
  id: number;
  modulo: ModuloEntrega;
  entidadId: number;
  documentoCodigo: string | null;
  estado: EstadoEntrega;
  estadoEtiqueta: string;
  modo: ModoEntrega;
  modoEtiqueta: string;
  origen: AreaEntrega;
  origenEtiqueta: string;
  destino: AreaEntrega;
  destinoEtiqueta: string;
  emitidoPor: string;
  emitidoPorRol: string;
  emitidoEn: string;
  observacionesEmision: string | null;
  recibidoPor: string | null;
  recibidoEn: string | null;
  observacionesRecepcion: string | null;
  /** Solo presencial: usuario del sistema que operó el dispositivo. */
  recepcionOperadaPor: string | null;
  cerradoPor: string | null;
  cerradoEn: string | null;
  motivoCierre: string | null;
  acciones: AccionesEntrega;
  /**
   * Constancia PDF disponible: `PREVIA` (presencial pendiente: para imprimir y firmar) o `FINAL` (recibida). En modo SISTEMA no hay
   * constancia previa; RECHAZADA/ANULADA no generan constancia.
   */
  constancia: "PREVIA" | "FINAL" | null;
  /** Hay constancia firmada escaneada adjunta (solo recepción presencial). */
  tieneEvidencia: boolean;
};

/** Qué constancia PDF corresponde a una entrega según estado y modo. */
export function constanciaDisponible(e: Pick<Entrega, "estado" | "modo">): "PREVIA" | "FINAL" | null {
  if (e.estado === "RECIBIDA") return "FINAL";
  if (e.estado === "EMITIDA" && e.modo === "PRESENCIAL") return "PREVIA";
  return null;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function aDto(e: Entrega, actor: ActorEntrega, extra: { tieneEvidencia?: boolean } = {}): EntregaDto {
  return {
    id: e.id,
    modulo: e.modulo,
    entidadId: e.entidadId,
    documentoCodigo: e.documentoCodigo,
    estado: e.estado,
    estadoEtiqueta: ETIQUETA_ESTADO_ENTREGA[e.estado],
    modo: e.modo,
    modoEtiqueta: ETIQUETA_MODO_ENTREGA[e.modo],
    origen: e.etapaOrigen,
    origenEtiqueta: ETIQUETA_AREA[e.etapaOrigen],
    destino: e.etapaDestino,
    destinoEtiqueta: ETIQUETA_AREA[e.etapaDestino],
    emitidoPor: e.emitidoPorNombre,
    emitidoPorRol: e.emitidoPorRol,
    emitidoEn: e.emitidoEn.toISOString(),
    observacionesEmision: e.observacionesEmision,
    recibidoPor: e.recibidoPorNombre,
    recibidoEn: iso(e.recibidoEn),
    observacionesRecepcion: e.observacionesRecepcion,
    recepcionOperadaPor: e.recepcionOperadaPorNombre,
    cerradoPor: e.cerradoPorNombre,
    cerradoEn: iso(e.cerradoEn),
    motivoCierre: e.motivoCierre,
    acciones: accionesDisponibles(actor, e),
    constancia: constanciaDisponible(e),
    tieneEvidencia: Boolean(extra.tieneEvidencia),
  };
}

/** Texto visible del estado de entrega de un documento: «Entrega pendiente → Tesorería». */
export function textoEntregaPendiente(destino: AreaEntrega): string {
  return `Entrega pendiente → ${ETIQUETA_AREA[destino]}`;
}

export type OpcionesRegistro = {
  permitido: boolean;
  /** Mensaje comprensible cuando no se permite (solo informativo; el botón simplemente no se ofrece). */
  motivo: string | null;
  destinos: { destino: AreaEntrega; etiqueta: string; etiquetaArea: string }[];
  modos: ModoEntrega[];
};

/**
 * Opciones del formulario «Registrar entrega» para un documento: destinos del catálogo según la CUSTODIA actual, modos según
 * permisos. No permitido si el documento no admite entregas en su estado, si ya hay una pendiente, o si el actor no puede actuar
 * por el área que tiene la custodia.
 */
export function opcionesRegistro(
  actor: ActorEntrega,
  modulo: ModuloEntrega,
  custodia: AreaEntrega,
  hayPendiente: boolean,
  estadoDocumento: string | null,
): OpcionesRegistro {
  const vacio = (motivo: string): OpcionesRegistro => ({ permitido: false, motivo, destinos: [], modos: [] });
  if (!estadoDocumento || !DEFINICIONES_ENTREGA[modulo].estadosDocumento.includes(estadoDocumento)) {
    return vacio("El documento no está en un estado que permita registrar entregas.");
  }
  if (hayPendiente) return vacio("Ya hay una entrega pendiente de recibir.");
  if (!puedeActuarPorArea(actor, modulo, custodia)) return vacio("No tiene permiso para entregar desde el área que tiene el documento.");
  const destinos = destinosDesde(modulo, custodia).map((p) => ({ destino: p.destino, etiqueta: p.etiqueta, etiquetaArea: ETIQUETA_AREA[p.destino] }));
  if (!destinos.length) return vacio("Desde esta área no hay entregas disponibles para este documento.");
  const modos: ModoEntrega[] = puedeOperarPresencial(actor) ? ["SISTEMA", "PRESENCIAL"] : ["SISTEMA"];
  return { permitido: true, motivo: null, destinos, modos };
}

/** Resumen por documento para el listado: una sola consulta para toda la página, sin polling. */
export type ResumenEntregaDocumento = {
  custodia: AreaEntrega;
  custodiaEtiqueta: string;
  /** Entrega EMITIDA pendiente (a lo sumo una). */
  pendiente: { id: number; destino: AreaEntrega; destinoEtiqueta: string; modo: ModoEntrega; texto: string } | null;
  total: number;
  recibidas: number;
  /** Hay movimientos RECHAZADA/ANULADA (el PDF solo los menciona en una nota). */
  hayCerradasSinRecepcion: boolean;
};
