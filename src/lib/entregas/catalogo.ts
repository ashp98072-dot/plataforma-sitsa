/**
 * CONTROL DE ENTREGA DE DOCUMENTOS — catálogo común (PR 1, sin UI ni módulos conectados).
 *
 * Una ENTREGA traslada la custodia de un documento (expediente) de un ÁREA a otra. Las áreas son categorías, nunca personas:
 * quién puede actuar por un área se decide por permiso (ver permisos.ts). Las entregas son una entidad SEPARADA de los estados
 * del documento: registrarlas no cambia el estado de la solicitud/gasto/requerimiento (en Fondos, «Liquidar» conserva su
 * significado actual).
 *
 * Pares origen → destino aprobados por negocio (2026-10-13). Se cambian aquí, en código, nunca desde la base de datos.
 */

export const AREAS_ENTREGA = ["OPERACIONES", "COMPRAS", "TESORERIA", "CONTABILIDAD"] as const;
export type AreaEntrega = (typeof AREAS_ENTREGA)[number];

export const MODULOS_ENTREGA = ["FONDOS", "GASTOS", "COMPRAS"] as const;
export type ModuloEntrega = (typeof MODULOS_ENTREGA)[number];

export const ESTADOS_ENTREGA = ["EMITIDA", "RECIBIDA", "RECHAZADA", "ANULADA"] as const;
export type EstadoEntrega = (typeof ESTADOS_ENTREGA)[number];

export const MODOS_ENTREGA = ["SISTEMA", "PRESENCIAL"] as const;
export type ModoEntrega = (typeof MODOS_ENTREGA)[number];

export const ETIQUETA_AREA: Record<AreaEntrega, string> = {
  OPERACIONES: "Operaciones",
  COMPRAS: "Compras",
  TESORERIA: "Tesorería",
  CONTABILIDAD: "Contabilidad",
};

/** Acciones registradas en firmas_electronicas (la firma se liga al DOCUMENTO, junto a sus demás firmas). */
export const ACCION_FIRMA_ENTREGAR = "ENTREGAR_DOCUMENTO";
export const ACCION_FIRMA_RECIBIR = "RECIBIR_DOCUMENTO";

/** Permisos transversales (módulo de catálogo `documentos_entregas`). */
export const PERMISO_AREA_TESORERIA = "entregas_area_tesoreria";
export const PERMISO_AREA_CONTABILIDAD = "entregas_area_contabilidad";
export const PERMISO_PRESENCIAL = "entregas_presencial";
export const PERMISO_ANULAR = "entregas_anular";

export type ParEntrega = { origen: AreaEntrega; destino: AreaEntrega; etiqueta: string };

export type DefinicionModuloEntrega = {
  modulo: ModuloEntrega;
  /** Igual que en firmas_electronicas.entidad_tipo de las firmas existentes del módulo. */
  entidadTipo: "SOLICITUD_FONDO" | "GASTO_OPERATIVO" | "REQUERIMIENTO_COMPRA";
  /** Igual que en firmas_electronicas.modulo de las firmas existentes del módulo. */
  moduloFirma: "FONDOS" | "GASTOS" | "COMPRAS";
  /** Área que custodia el documento mientras no haya ninguna entrega recibida. */
  areaInicial: AreaEntrega;
  /** Permiso para actuar por el área inicial (emitir desde ella y recibir devoluciones). */
  permisoAreaInicial: string;
  /** Estados del documento en los que se puede REGISTRAR una entrega (las demás acciones no reevalúan el estado). */
  estadosDocumento: readonly string[];
  pares: readonly ParEntrega[];
};

export const DEFINICIONES_ENTREGA: Record<ModuloEntrega, DefinicionModuloEntrega> = {
  FONDOS: {
    modulo: "FONDOS",
    entidadTipo: "SOLICITUD_FONDO",
    moduloFirma: "FONDOS",
    areaInicial: "OPERACIONES",
    permisoAreaInicial: "fondos_entrega_emitir",
    estadosDocumento: ["Autorizada", "Liquidada"],
    pares: [
      { origen: "OPERACIONES", destino: "TESORERIA", etiqueta: "Expediente autorizado a Tesorería" },
      { origen: "TESORERIA", destino: "CONTABILIDAD", etiqueta: "Expediente a Contabilidad" },
      { origen: "OPERACIONES", destino: "CONTABILIDAD", etiqueta: "Expediente a Contabilidad" },
      { origen: "CONTABILIDAD", destino: "OPERACIONES", etiqueta: "Devolución para corrección" },
    ],
  },
  GASTOS: {
    modulo: "GASTOS",
    entidadTipo: "GASTO_OPERATIVO",
    moduloFirma: "GASTOS",
    areaInicial: "OPERACIONES",
    permisoAreaInicial: "gastos_entrega_emitir",
    // Los históricos (`estado IS NULL`) quedan fuera: nunca pasaron por autorización.
    estadosDocumento: ["Autorizada"],
    pares: [
      { origen: "OPERACIONES", destino: "CONTABILIDAD", etiqueta: "Expediente con comprobantes a Contabilidad" },
      { origen: "CONTABILIDAD", destino: "OPERACIONES", etiqueta: "Devolución para corrección" },
    ],
  },
  COMPRAS: {
    modulo: "COMPRAS",
    entidadTipo: "REQUERIMIENTO_COMPRA",
    moduloFirma: "COMPRAS",
    areaInicial: "COMPRAS",
    permisoAreaInicial: "compras_entrega_emitir",
    estadosDocumento: ["Autorizada"],
    pares: [
      { origen: "COMPRAS", destino: "TESORERIA", etiqueta: "Requerimiento autorizado a Tesorería" },
      { origen: "COMPRAS", destino: "CONTABILIDAD", etiqueta: "Factura sellada / expediente a Contabilidad" },
      { origen: "TESORERIA", destino: "CONTABILIDAD", etiqueta: "Expediente a Contabilidad" },
      { origen: "CONTABILIDAD", destino: "COMPRAS", etiqueta: "Devolución para corrección" },
    ],
  },
};

export function esModuloEntrega(v: unknown): v is ModuloEntrega {
  return typeof v === "string" && (MODULOS_ENTREGA as readonly string[]).includes(v);
}
export function esAreaEntrega(v: unknown): v is AreaEntrega {
  return typeof v === "string" && (AREAS_ENTREGA as readonly string[]).includes(v);
}

export function parEntrega(modulo: ModuloEntrega, origen: AreaEntrega, destino: AreaEntrega): ParEntrega | null {
  return DEFINICIONES_ENTREGA[modulo].pares.find((p) => p.origen === origen && p.destino === destino) ?? null;
}

/** Destinos posibles desde un área (lo que la UI ofrecerá según la custodia actual). */
export function destinosDesde(modulo: ModuloEntrega, origen: AreaEntrega): ParEntrega[] {
  return DEFINICIONES_ENTREGA[modulo].pares.filter((p) => p.origen === origen);
}
