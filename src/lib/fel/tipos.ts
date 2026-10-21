import { ErrorDominioFormulario, type EstadoDominio } from "@/lib/validacion-formulario";

/**
 * FEL-2A — vocabulario del dominio fiscal (neutral al proveedor). NADA aquí conoce a INFILE ni a la red.
 *
 * Verdad fiscal: `fel_documentos.estado = 'CERTIFICADO'` con autorización/serie/número/fecha. `fact_facturas.estado_admin`
 * es un estado OPERATIVO y nunca prueba fiscal. Un CERTIFICADO de un proveedor MOCK no es un documento SAT válido; el
 * esquema impide que un documento MOCK pertenezca a un ambiente PROD.
 */

export const AMBIENTES_FEL = ["TEST", "PROD"] as const;
export type AmbienteFel = (typeof AMBIENTES_FEL)[number];

export const MODOS_FEL = ["DESACTIVADO", "TEST", "PROD"] as const;
export type ModoFel = (typeof MODOS_FEL)[number];

export const TIPOS_DOCUMENTO_FEL = ["FACTURA", "NOTA_CREDITO", "NOTA_DEBITO"] as const;
export type TipoDocumentoFel = (typeof TIPOS_DOCUMENTO_FEL)[number];

/** PENDIENTE: preparado/enviado sin resolución. NO_ENCONTRADO: SOLO una consulta lo confirma. RECHAZADO es terminal. */
export const ESTADOS_DOCUMENTO_FEL = ["PENDIENTE", "CERTIFICADO", "RECHAZADO", "INCIERTO", "NO_ENCONTRADO", "ANULADO"] as const;
export type EstadoDocumentoFel = (typeof ESTADOS_DOCUMENTO_FEL)[number];

export const TIPOS_INTENTO_FEL = ["CERTIFICAR", "CONSULTAR", "ANULAR"] as const;
export type TipoIntentoFel = (typeof TIPOS_INTENTO_FEL)[number];

export const ESTADOS_INTENTO_FEL = [
  "ENVIANDO", "CERTIFICADO", "RECHAZADO", "PENDIENTE", "NO_ENCONTRADO", "INCIERTO", "ERROR_CONFIG", "ANULADO",
] as const;
export type EstadoIntentoFel = (typeof ESTADOS_INTENTO_FEL)[number];

/** Identidad fiscal devuelta por el certificador. Los valores son opacos para SITSA (sin formato asumido). */
export type IdentidadFiscal = {
  autorizacion: string;
  serie: string;
  numero: string;
  /** ISO-8601 UTC. */
  fechaCertificacion: string;
};

export type LineaDocumentoFel = {
  orden: number;
  descripcion: string;
  cantidad: string;
  precioUnitario: string;
  clasificacion: "SERVICIO" | "BIEN";
  precioIncluyeIva: boolean;
  porcentajeIva: string;
  base: string;
  iva: string;
  total: string;
};

/**
 * DTO INTERNO neutral y congelado. NO es un payload de INFILE ni un DTE de la SAT: no contiene códigos de tipo SAT,
 * régimen, frases, establecimiento ni validación de identificación del receptor (decisiones pendientes, ver
 * docs/FEL-INFILE-DATOS-FALTANTES.md). Los importes son cadenas con 2 decimales (nunca float).
 */
export type DocumentoFelDto = {
  version: 1;
  tipo: TipoDocumentoFel;
  moneda: "GTQ";
  fechaEmision: string;
  emisor: { empresaId: number; entidadId: number; nit: string; nombreFiscal: string };
  /** Datos del cliente TAL COMO están en SITSA: sin validar ni clasificar (NIT/CUI/CF pendiente de decisión). */
  receptor: { nitDeclarado: string; nombreFiscal: string; correo: string | null; direccion: string | null };
  lineas: LineaDocumentoFel[];
  totales: { base: string; iva: string; total: string };
  /** Solo notas: referencia al documento certificado que corrigen. */
  referenciaOrigen: (IdentidadFiscal & { documentoId: number }) | null;
  motivo: string | null;
};

export type BloqueoFel = { codigo: string; mensaje: string };

export type CodigoErrorFel =
  | "ERROR_CONFIG"
  | "CONFLICTO_IDEMPOTENCIA"
  | "NO_ENCONTRADO"
  | "ESTADO_NO_PERMITE"
  | "ORIGEN_INVALIDO"
  | "SOLICITUD_INVALIDA";

/** Error de dominio FEL seguro de mostrar (sin secretos ni detalles internos). */
export class ErrorFel extends ErrorDominioFormulario {
  readonly codigoFel: CodigoErrorFel;
  constructor(codigoFel: CodigoErrorFel, message: string, status: EstadoDominio = 409) {
    super(message, status);
    this.name = "ErrorFel";
    this.codigoFel = codigoFel;
  }
}
