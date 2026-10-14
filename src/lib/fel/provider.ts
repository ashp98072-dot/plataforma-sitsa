import type { AmbienteFel, DocumentoFelDto, IdentidadFiscal, TipoDocumentoFel } from "./tipos";

/**
 * Contrato NEUTRAL de un certificador FEL. FEL-2A solo define la interfaz y un proveedor MOCK; el proveedor real
 * (INFILE) se implementa en FEL-3 con su documentación oficial. Reglas del contrato:
 *
 *  - Un proveedor NUNCA lanza para comunicar un resultado de negocio. Si lo hace (timeout, corte, bug), el servicio lo
 *    trata como INCIERTO: jamás como NO_ENCONTRADO ni como RECHAZADO.
 *  - `NO_ENCONTRADO` solo puede ser respuesta de `consultar` (por tipo, `certificar` no lo admite): el certificador
 *    afirma que NO existe un documento con esa referencia. Un timeout, un 404 o un 5xx NO lo producen.
 *  - `RECHAZADO` significa «el certificador procesó la solicitud y la rechazó definitivamente».
 *  - `INCIERTO`: el resultado se desconoce (pudo haberse certificado). Obliga a consultar antes de reenviar.
 *  - `ERROR_CONFIG`: falla de configuración/credenciales detectada ANTES de que el certificador procese nada.
 */

export type ContextoProveedor = {
  ambiente: AmbienteFel;
  proveedor: string;
  /** NULL hasta que el responsable la configure; nunca hay una URL por defecto. */
  baseUrl: string | null;
  nitEmisor: string | null;
  /** Secreto ya descifrado en memoria (solo si el proveedor `requiereCredenciales`). Nunca se registra. */
  secreto: string | null;
};

export type SolicitudCertificar = {
  contexto: ContextoProveedor;
  /** Referencia propia e idempotente del emisor: el MISMO valor en cada reenvío del mismo documento. */
  referenciaEmisor: string;
  tipo: TipoDocumentoFel;
  dto: DocumentoFelDto;
};
export type SolicitudConsultar = { contexto: ContextoProveedor; referenciaEmisor: string };
export type SolicitudAnular = { contexto: ContextoProveedor; referenciaEmisor: string; autorizacion: string; motivo: string };

type Detalle = { codigo?: string; mensaje?: string };

export type ResultadoCertificar =
  | ({ tipo: "CERTIFICADO" } & IdentidadFiscal)
  | ({ tipo: "RECHAZADO" } & Detalle)
  | ({ tipo: "PENDIENTE" } & Detalle)
  | ({ tipo: "INCIERTO" } & Detalle)
  | ({ tipo: "ERROR_CONFIG" } & Detalle);

export type ResultadoConsulta =
  | ({ tipo: "CERTIFICADO" } & IdentidadFiscal)
  | ({ tipo: "RECHAZADO" } & Detalle)
  | ({ tipo: "PENDIENTE" } & Detalle)
  | ({ tipo: "NO_ENCONTRADO" } & Detalle)
  | ({ tipo: "INCIERTO" } & Detalle)
  | ({ tipo: "ERROR_CONFIG" } & Detalle);

export type ResultadoAnulacion =
  | ({ tipo: "ANULADO"; fechaAnulacion: string } & Detalle)
  | ({ tipo: "RECHAZADO" } & Detalle)
  | ({ tipo: "INCIERTO" } & Detalle)
  | ({ tipo: "ERROR_CONFIG" } & Detalle);

export interface FelProvider {
  /** Código estable guardado en `fel_emisor_ambientes.proveedor` (p. ej. «MOCK»). */
  readonly nombre: string;
  /** Si es true, el servicio exige FEL_CREDENTIALS_KEY y un secreto descifrable ANTES de preparar cualquier envío. */
  readonly requiereCredenciales: boolean;
  certificar(solicitud: SolicitudCertificar): Promise<ResultadoCertificar>;
  consultar(solicitud: SolicitudConsultar): Promise<ResultadoConsulta>;
  anular(solicitud: SolicitudAnular): Promise<ResultadoAnulacion>;
}

/** Resolución de proveedores por nombre: la inyecta quien construye el servicio. No hay registro global con MOCK. */
export type ResolverProveedor = (nombre: string) => FelProvider | null;
