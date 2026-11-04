/**
 * BORR-1a — CONTRATO DEL BORRADOR (núcleo compartido de autoguardado de formularios).
 *
 * Infraestructura SOLO de cliente: no llama a ningún endpoint, no envía documentos oficiales, no lee la sesión ni cookies.
 * Las identidades (`ownerKey`, `empresaId`, `empresaSlug`) las suministrará el contexto autenticado del servidor en fases
 * posteriores (BORR-1b); este módulo no las inventa ni las toma de ningún global implícito.
 *
 * AISLAMIENTO: las claves de almacenamiento incorporan ownerKey + empresa + tipo. Es aislamiento LÓGICO de aplicación para
 * que un usuario no vea por error el borrador de otro en el mismo navegador. NO es cifrado ni una barrera de seguridad
 * frente a alguien con acceso al perfil del navegador (DevTools, otro script del mismo origen).
 *
 * IDEMPOTENCIA (política pendiente para fases posteriores): el contrato transporta `claveEnvio` y `estadoEnvio`, pero el
 * núcleo NO ejecuta envíos. Cuando exista un intento de envío (`estadoEnvio !== "ninguno"`), modificar el payload exige una
 * política explícita —conservar la clave (mismo contenido funcional) o renovarla (contenido nuevo)— porque reutilizar la clave
 * con otro contenido produce 409 en el servidor y renovarla tras una respuesta perdida podría duplicar el documento. Hasta
 * que esa política exista, `guardar` conserva la clave tal cual y no la renueva por sí solo.
 */

/** Tipos de formulario que usarán el núcleo. Cerrado a propósito: un tipo desconocido es un ámbito inválido. */
export const TIPOS_BORRADOR = ["solicitud_fondo", "gasto_operativo", "requerimiento_compra"] as const;
export type TipoBorrador = (typeof TIPOS_BORRADOR)[number];

export const ESTADOS_ENVIO = ["ninguno", "enviando", "completado"] as const;
export type EstadoEnvio = (typeof ESTADOS_ENVIO)[number];

/** Versión del formato del REGISTRO contenedor (no del payload del formulario, que versiona cada adaptador). */
export const FORMATO_REGISTRO = 1;

/** Retención local por defecto: 14 días desde el último guardado. */
export const RETENCION_MS_POR_DEFECTO = 14 * 24 * 60 * 60 * 1000;

/** Tope por defecto del payload serializado (caracteres JSON). Cientos de líneas caben con holgura. */
export const MAX_PAYLOAD_CHARS_POR_DEFECTO = 2_000_000;

/**
 * Ámbito completo de un borrador: UN borrador por (ownerKey, empresaId, tipo).
 * `ownerKey` es un identificador OPACO provisto por el servidor; el núcleo solo lo compara y lo concatena en claves.
 */
export type AmbitoBorrador = {
  ownerKey: string;
  empresaId: number;
  empresaSlug: string;
  tipo: TipoBorrador;
};

/** Ámbito de un usuario dentro de una empresa (todos los tipos). Para listar y limpiar. */
export type AmbitoUsuarioEmpresa = { ownerKey: string; empresaId: number };

export type Borrador<TPayload = unknown> = {
  borradorId: string;
  tipo: TipoBorrador;
  ownerKey: string;
  empresaId: number;
  empresaSlug: string;
  /** Versión del esquema del payload (la define el adaptador del formulario). */
  esquemaVersion: number;
  /** Build de la aplicación que escribió el borrador (diagnóstico; no participa en la compatibilidad). */
  appBuild: string;
  /** Contador incremental por borrador: 1 en la creación, +1 en cada guardado. Base del control de revisión obsoleta. */
  revision: number;
  payload: TPayload;
  /** Epoch en milisegundos del último guardado confirmado. */
  actualizadoEn: number;
  /** Epoch en milisegundos a partir del cual el borrador está expirado (último guardado + retención). */
  expiraEn: number;
  /** Clave de idempotencia del intento lógico de creación (ver cabecera). No es un secreto. */
  claveEnvio: string | null;
  estadoEnvio: EstadoEnvio;
};

/** Metadatos sin payload, para listados y banners de recuperación. */
export type MetadatosBorrador = Omit<Borrador, "payload" | "claveEnvio"> & { tieneClaveEnvio: boolean };

/** Registro tal como se guarda: el borrador más campos internos de indexación. */
export type RegistroAlmacenado = Borrador & {
  clave: string;
  ambitoClave: string;
  formato: number;
};
