import Decimal from "decimal.js";
import type { BloqueoFel, DocumentoFelDto, IdentidadFiscal, LineaDocumentoFel, TipoDocumentoFel } from "./tipos";

/**
 * MAPPER Factura SITSA → DTO INTERNO neutral (puro, sin BD ni red). Solo emite datos que SITSA conoce sin ambigüedad;
 * cuando falta algo (o la regla de negocio no está decidida) devuelve BLOQUEOS estructurados y NO construye el DTO.
 * NO genera payload INFILE ni aplica valores fiscales por defecto: régimen, frases, establecimiento, tipo FACT/FCAM,
 * validación/clasificación de la identificación del receptor, retenciones, unidades de medida, exentos, adenda y
 * monedas distintas de GTQ están PENDIENTES (docs/FEL-INFILE-DATOS-FALTANTES.md) y se bloquean o se omiten.
 */

export const BLOQUEOS_FEL = {
  FACTURA_NO_BORRADOR: "La factura debe estar en Borrador para certificarse.",
  ENTIDAD_NO_ASIGNADA: "La factura no tiene entidad emisora asignada.",
  MONEDA_NO_SOPORTADA: "Moneda no soportada: por ahora solo GTQ.",
  RETENCION_NO_SOPORTADA: "Factura con retención de IVA: regla fiscal aún no definida.",
  FECHA_FALTANTE: "La factura no tiene fecha de emisión.",
  SIN_LINEAS: "La factura no tiene líneas fiscales (modelo anterior a FACT-4).",
  CLASIFICACION_NO_INEQUIVOCA: "Hay líneas sin clasificar como servicio o bien.",
  IMPORTES_INCONSISTENTES: "Los importes del documento no cuadran.",
  EMISOR_SIN_DATOS_FISCALES: "El emisor no tiene NIT y nombre fiscal configurados para este ambiente.",
  RECEPTOR_SIN_NIT: "El cliente no tiene NIT.",
  RECEPTOR_SIN_NOMBRE_FISCAL: "El cliente no tiene razón social.",
} as const;
export type CodigoBloqueoFel = keyof typeof BLOQUEOS_FEL;

export type FacturaParaFel = {
  facturaId: number;
  empresaId: number;
  entidadId: number | null;
  estadoAdmin: "Borrador" | "Emitida" | "Anulada";
  moneda: string;
  /** YYYY-MM-DD */
  fechaEmision: string | null;
  montoTotal: string;
  retencionIvaPct: number;
  cliente: { razonSocial: string | null; nit: string | null; email: string | null; direccion: string | null };
  lineas: {
    orden: number;
    descripcion: string;
    cantidad: string;
    precioUnitario: string;
    clasificacion: string | null;
    precioIncluyeIva: boolean;
    porcentajeIva: string;
    base: string | null;
    iva: string | null;
    total: string | null;
  }[];
  emisor: { nit: string | null; nombreFiscal: string | null };
};

export type ResultadoMapeo = { ok: true; dto: DocumentoFelDto } | { ok: false; bloqueos: BloqueoFel[] };

const bloqueo = (codigo: CodigoBloqueoFel): BloqueoFel => ({ codigo, mensaje: BLOQUEOS_FEL[codigo] });
const dos = (d: Decimal.Value) => new Decimal(d).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toFixed(2);
const texto = (v: string | null | undefined) => (v ?? "").trim();

export function construirDtoFactura(f: FacturaParaFel): ResultadoMapeo {
  const b: BloqueoFel[] = [];
  if (f.estadoAdmin !== "Borrador") b.push(bloqueo("FACTURA_NO_BORRADOR"));
  if (f.entidadId == null) b.push(bloqueo("ENTIDAD_NO_ASIGNADA"));
  if (f.moneda !== "GTQ") b.push(bloqueo("MONEDA_NO_SOPORTADA"));
  if (f.retencionIvaPct !== 0) b.push(bloqueo("RETENCION_NO_SOPORTADA"));
  if (!f.fechaEmision || !/^\d{4}-\d{2}-\d{2}$/.test(f.fechaEmision)) b.push(bloqueo("FECHA_FALTANTE"));
  if (!texto(f.emisor.nit) || !texto(f.emisor.nombreFiscal)) b.push(bloqueo("EMISOR_SIN_DATOS_FISCALES"));
  if (!texto(f.cliente.nit)) b.push(bloqueo("RECEPTOR_SIN_NIT"));
  // Sin respaldo en el nombre comercial: qué campo manda es una decisión pendiente (DATOS-FALTANTES A2).
  if (!texto(f.cliente.razonSocial)) b.push(bloqueo("RECEPTOR_SIN_NOMBRE_FISCAL"));

  if (!f.lineas.length) {
    b.push(bloqueo("SIN_LINEAS"));
  } else {
    if (f.lineas.some((l) => l.clasificacion !== "SERVICIO" && l.clasificacion !== "BIEN")) b.push(bloqueo("CLASIFICACION_NO_INEQUIVOCA"));
    if (f.lineas.some((l) => l.base == null || l.iva == null || l.total == null)) {
      b.push(bloqueo("IMPORTES_INCONSISTENTES"));
    } else {
      const lineaCuadra = f.lineas.every((l) => new Decimal(l.base!).plus(l.iva!).equals(new Decimal(l.total!)));
      const suma = f.lineas.reduce((s, l) => s.plus(l.total!), new Decimal(0));
      if (!lineaCuadra || !suma.equals(new Decimal(f.montoTotal))) b.push(bloqueo("IMPORTES_INCONSISTENTES"));
    }
  }
  if (b.length) return { ok: false, bloqueos: b };

  const lineas: LineaDocumentoFel[] = f.lineas.map((l) => ({
    orden: l.orden,
    descripcion: l.descripcion,
    cantidad: dos(l.cantidad),
    precioUnitario: dos(l.precioUnitario),
    clasificacion: l.clasificacion as "SERVICIO" | "BIEN",
    precioIncluyeIva: l.precioIncluyeIva,
    porcentajeIva: dos(l.porcentajeIva),
    base: dos(l.base!),
    iva: dos(l.iva!),
    total: dos(l.total!),
  }));
  const sum = (k: "base" | "iva" | "total") => lineas.reduce((s, l) => s.plus(l[k]), new Decimal(0));
  return {
    ok: true,
    dto: {
      version: 1,
      tipo: "FACTURA",
      moneda: "GTQ",
      fechaEmision: f.fechaEmision!,
      emisor: { empresaId: f.empresaId, entidadId: f.entidadId!, nit: texto(f.emisor.nit), nombreFiscal: texto(f.emisor.nombreFiscal) },
      receptor: {
        nitDeclarado: texto(f.cliente.nit),
        nombreFiscal: texto(f.cliente.razonSocial),
        correo: texto(f.cliente.email) || null,
        direccion: texto(f.cliente.direccion) || null,
      },
      lineas,
      totales: { base: dos(sum("base")), iva: dos(sum("iva")), total: dos(sum("total")) },
      referenciaOrigen: null,
      motivo: null,
    },
  };
}

export type ImportesCorrectivo = { base: string; iva: string; total: string };

/**
 * DTO de una nota de crédito/débito: copia emisor/receptor del documento origen CERTIFICADO y lo referencia. Los
 * importes los aporta el llamador (qué se corrige y en cuánto es una decisión de negocio pendiente; no se infiere).
 */
export function construirDtoCorrectivo(
  origen: { dto: DocumentoFelDto; documentoId: number; identidad: IdentidadFiscal },
  tipo: Exclude<TipoDocumentoFel, "FACTURA">,
  motivo: string,
  importes: ImportesCorrectivo,
  fechaEmision: string,
): ResultadoMapeo {
  const b: BloqueoFel[] = [];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaEmision)) b.push(bloqueo("FECHA_FALTANTE"));
  const base = new Decimal(importes.base);
  const iva = new Decimal(importes.iva);
  const total = new Decimal(importes.total);
  if (base.lte(0) || iva.lt(0) || !base.plus(iva).equals(total)) b.push(bloqueo("IMPORTES_INCONSISTENTES"));
  if (b.length) return { ok: false, bloqueos: b };
  return {
    ok: true,
    dto: {
      version: 1,
      tipo,
      moneda: origen.dto.moneda,
      fechaEmision,
      emisor: origen.dto.emisor,
      receptor: origen.dto.receptor,
      lineas: [],
      totales: { base: dos(base), iva: dos(iva), total: dos(total) },
      referenciaOrigen: { documentoId: origen.documentoId, ...origen.identidad },
      motivo: motivo.trim(),
    },
  };
}
