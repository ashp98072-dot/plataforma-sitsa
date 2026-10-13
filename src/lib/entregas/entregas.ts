import type { ResultSetHeader, RowDataPacket } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { crearFirmaInterna, type ImagenFirmaInterna } from "@/lib/firmas/firmas-internas";
import { MAX_FIRMA_IMAGEN_BYTES, esPngValido, sha256Hex } from "@/lib/firmas/imagen-firma";
import { CLAVE_ENVIO_REGEX } from "@/lib/idempotencia/clave-envio";
import { ConflictoIdempotencia, esDuplicadoDeClave, huellaDe } from "@/lib/tms/idempotencia-envio";
import { borrarUpload, guardarUpload } from "@/lib/uploads";
import { ErrorDominioFormulario } from "@/lib/validacion-formulario";
import { bloquearDocumento } from "./adaptadores";
import {
  ACCION_FIRMA_ENTREGAR,
  ACCION_FIRMA_RECIBIR,
  DEFINICIONES_ENTREGA,
  ETIQUETA_AREA,
  esAreaEntrega,
  esModuloEntrega,
  parEntrega,
  type AreaEntrega,
  type EstadoEntrega,
  type ModoEntrega,
  type ModuloEntrega,
} from "./catalogo";
import {
  MAX_MOTIVO_ENTREGA,
  MAX_NOMBRE_PRESENCIAL,
  MAX_OBSERVACIONES_ENTREGA,
  areasRecepcionDelActor,
  calcularCustodia,
  esModoEntrega,
  puedeActuarPorArea,
  puedeAnularAjenas,
  puedeOperarPresencial,
  textoOpcional,
  type ActorEntrega,
} from "./reglas";

/**
 * CONTROL DE ENTREGA DE DOCUMENTOS — servicio común (PR 1). Sin UI y sin módulos conectados: Fondos, Gastos y Compras lo
 * llamarán en PRs posteriores desde sus endpoints, con el actor resuelto SIEMPRE desde la sesión.
 *
 * Invariantes (código + restricciones de `documento_entregas`, ver sql/migrate-2026-10-documento-entregas.sql):
 *   - Toda lectura/escritura filtra por empresa_id; un id de otra empresa responde 404, igual que uno inexistente.
 *   - Como máximo UNA entrega EMITIDA (pendiente) por documento: UNIQUE (empresa_id, pendiente_documento).
 *   - La custodia la da la última entrega RECIBIDA; solo se emite desde el área que custodia y por un par aprobado.
 *   - Nadie confirma ni rechaza una entrega que él mismo emitió. La recepción la confirma el RECEPTOR (modo SISTEMA) o, si
 *     la persona no tiene usuario, se registra presencial con su firma dibujada (modo PRESENCIAL, permiso explícito).
 *   - Las transiciones son EMITIDA → RECIBIDA | RECHAZADA | ANULADA; nunca se reabren. Una RECIBIDA no se anula: se corrige
 *     con una devolución (nueva entrega).
 *   - Firma (firmas_electronicas) obligatoria al emitir y al recibir, en la MISMA transacción que la entrega y la auditoría.
 *   - Registrar una entrega no cambia el estado del documento.
 */

export type FirmaEntregaInput = {
  /** GUARDADA = copia de «Mi firma» (bytes leídos por el endpoint); DIBUJADA = trazo hecho en ese momento. */
  origen: "GUARDADA" | "DIBUJADA";
  imagen: { bytes: ArrayBuffer; original: string };
};

export type Entrega = {
  id: number;
  empresaId: number;
  modulo: ModuloEntrega;
  entidadId: number;
  documentoCodigo: string | null;
  etapaOrigen: AreaEntrega;
  etapaDestino: AreaEntrega;
  modo: ModoEntrega;
  estado: EstadoEntrega;
  emitidoPorUsuarioId: number;
  emitidoPorNombre: string;
  emitidoPorRol: string;
  emitidoEn: Date;
  firmaEmisionId: number;
  observacionesEmision: string | null;
  recibidoPorUsuarioId: number | null;
  recibidoPorNombre: string | null;
  recibidoPorRol: string | null;
  recibidoEn: Date | null;
  firmaRecepcionId: number | null;
  observacionesRecepcion: string | null;
  recepcionOperadaPorUsuarioId: number | null;
  recepcionOperadaPorNombre: string | null;
  cerradoPorUsuarioId: number | null;
  cerradoPorNombre: string | null;
  cerradoEn: Date | null;
  motivoCierre: string | null;
};

export const MENSAJES_ENTREGA = {
  documentoNoEncontrado: "Documento no encontrado.",
  entregaNoEncontrada: "Entrega no encontrada.",
  estadoNoAdmitido: "El documento no está en un estado que permita registrar entregas.",
  pendienteExistente: "Este documento ya tiene una entrega pendiente de recibir.",
  parNoPermitido: "Esa entrega no está permitida desde el área que tiene el documento.",
  sinPermisoArea: "No tiene permiso para actuar por esa área.",
  sinPermisoPresencial: "No tiene permiso para registrar recepciones presenciales.",
  identidadIncompleta: "No se pudo determinar el nombre o el rol del usuario que opera.",
  sinPermisoAnular: "Solo quien emitió la entrega (o quien tenga permiso de anular) puede anularla.",
  propiaEntrega: "No puede recibir ni rechazar una entrega que usted mismo emitió.",
  noPendiente: "La entrega ya no está pendiente.",
  modoSistema: "Esta entrega se recibe en el sistema por el receptor, no de forma presencial.",
  modoPresencial: "Esta entrega es presencial: se registra con la firma de quien recibe.",
  firmaRequerida: "La firma es obligatoria.",
  firmaInvalida: "La firma debe ser una imagen PNG válida de hasta 1 MB.",
  firmaDibujadaRequerida: "La recepción presencial requiere la firma dibujada de quien recibe.",
  motivoRequerido: "Indique el motivo.",
  nombreRequerido: "Indique el nombre de quien recibe.",
  claveRequerida: "La clave de envío es obligatoria y debe ser válida.",
  datosInvalidos: "Datos de la entrega inválidos.",
} as const;

const error = (mensaje: string, status: 400 | 403 | 404 | 409 = 400) => new ErrorDominioFormulario(mensaje, status);

/** Nombre del índice UNIQUE de idempotencia (ver la migración). */
export const INDICE_CLAVE_ENTREGA = "uq_de_empresa_clave";
/** Nombre del índice UNIQUE de «una pendiente por documento». */
export const INDICE_PENDIENTE_ENTREGA = "uq_de_pendiente";

const VERSION_HUELLA = 1;

/* ------------------------------------------------------------------ utilidades */

function texto(valor: string | null | undefined, maximo: number, campo: string): string | null {
  try {
    return textoOpcional(valor, maximo, campo);
  } catch (e) {
    if (e instanceof RangeError) throw error(e.message);
    throw e;
  }
}

function idPositivo(valor: unknown): number {
  const n = Number(valor);
  if (!Number.isInteger(n) || n <= 0) throw error(MENSAJES_ENTREGA.datosInvalidos);
  return n;
}

/** La identidad llega de la sesión; el snapshot de nombre y rol es obligatorio en la entrega (columnas NOT NULL). */
function validarActor(actor: ActorEntrega): void {
  if (!Number.isInteger(actor?.usuarioId) || actor.usuarioId <= 0 || !actor.username?.trim() || !actor.nombre?.trim() || !actor.rol?.trim()) {
    throw error(MENSAJES_ENTREGA.identidadIncompleta, 403);
  }
}

function validarFirma(firma: FirmaEntregaInput | null | undefined, soloDibujada: boolean): FirmaEntregaInput {
  if (!firma || !firma.imagen || !(firma.imagen.bytes instanceof ArrayBuffer)) {
    throw error(soloDibujada ? MENSAJES_ENTREGA.firmaDibujadaRequerida : MENSAJES_ENTREGA.firmaRequerida);
  }
  if (soloDibujada && firma.origen !== "DIBUJADA") throw error(MENSAJES_ENTREGA.firmaDibujadaRequerida);
  if (firma.origen !== "GUARDADA" && firma.origen !== "DIBUJADA") throw error(MENSAJES_ENTREGA.firmaInvalida);
  const bytes = firma.imagen.bytes;
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_FIRMA_IMAGEN_BYTES || !esPngValido(new Uint8Array(bytes))) {
    throw error(MENSAJES_ENTREGA.firmaInvalida);
  }
  return firma;
}

/**
 * Copia física INDEPENDIENTE de la firma (mismo patrón que Fondos): se escribe antes de la transacción.
 *
 * PROPIEDAD DEL ARCHIVO: apenas esta función devuelve, el archivo existe en disco y el LLAMADOR es su dueño: debe pasarlo
 * INMEDIATAMENTE a `conImagenCompensada`, que lo borra en cualquier salida que no termine en commit usando esa imagen.
 * Por eso nada que pueda lanzar va después de `guardarUpload` (el SHA-256 se calcula antes).
 */
async function guardarImagenFirma(empresaId: number, prefijo: string, firma: FirmaEntregaInput): Promise<ImagenFirmaInterna> {
  const sha256 = sha256Hex(firma.imagen.bytes);
  const guardada = await guardarUpload(empresaId, "firmas", prefijo, {
    name: firma.imagen.original || "firma.png",
    size: firma.imagen.bytes.byteLength,
    arrayBuffer: async () => firma.imagen.bytes,
  });
  return { relative: guardada.relative, original: guardada.original, mime: "image/png", size: guardada.size, sha256 };
}

type ResultadoTx<T> = { valor: T; imagenUsada: boolean };

/**
 * Compensación del archivo temporal. `fn` abarca TODO lo que ocurre entre guardar la imagen y el commit (incluida la obtención
 * de la conexión y cualquier lectura previa). La imagen se conserva ÚNICAMENTE si `fn` terminó sin error (commit hecho) y
 * reportó `imagenUsada = true`; en cualquier otro caso (error de infraestructura, rollback, repetición, 404/409) se borra.
 * Lo que ocurra DESPUÉS del commit queda fuera a propósito: la firma ya referencia el archivo y debe conservarse.
 * `borrarUpload` tolera archivos inexistentes, y este es su único punto de borrado (un solo dueño).
 */
async function conImagenCompensada<T>(imagen: ImagenFirmaInterna | null, fn: () => Promise<ResultadoTx<T>>): Promise<T> {
  let conservar = false;
  try {
    const r = await fn();
    conservar = r.imagenUsada;
    return r.valor;
  } finally {
    if (imagen && !conservar) borrarUpload(imagen.relative);
  }
}

/** Transacción: la conexión se libera solo si se obtuvo; rollback solo si se abrió; el error original siempre prevalece. */
async function enTransaccion<T>(fn: (conn: PoolConnection) => Promise<ResultadoTx<T>>): Promise<ResultadoTx<T>> {
  const conn = await getPool().getConnection(); // si falla, no hay nada que liberar ni revertir
  let abierta = false;
  try {
    await conn.beginTransaction();
    abierta = true;
    const r = await fn(conn);
    await conn.commit();
    abierta = false;
    return r;
  } catch (e) {
    if (abierta) {
      try {
        await conn.rollback();
      } catch {
        // conexión rota: se libera abajo y el error original es el que se propaga
      }
    }
    throw e;
  } finally {
    conn.release();
  }
}

const numONull = (v: unknown) => (v == null ? null : Number(v));
const strONull = (v: unknown) => (v == null ? null : String(v));
const fechaONull = (v: unknown) => (v == null ? null : new Date(v as string | Date));

function mapear(f: RowDataPacket): Entrega {
  return {
    id: Number(f.id),
    empresaId: Number(f.empresa_id),
    modulo: String(f.modulo) as ModuloEntrega,
    entidadId: Number(f.entidad_id),
    documentoCodigo: strONull(f.documento_codigo),
    etapaOrigen: String(f.etapa_origen) as AreaEntrega,
    etapaDestino: String(f.etapa_destino) as AreaEntrega,
    modo: String(f.modo) as ModoEntrega,
    estado: String(f.estado) as EstadoEntrega,
    emitidoPorUsuarioId: Number(f.emitido_por_usuario_id),
    emitidoPorNombre: String(f.emitido_por_nombre),
    emitidoPorRol: String(f.emitido_por_rol),
    emitidoEn: new Date(f.emitido_en),
    firmaEmisionId: Number(f.firma_emision_id),
    observacionesEmision: strONull(f.observaciones_emision),
    recibidoPorUsuarioId: numONull(f.recibido_por_usuario_id),
    recibidoPorNombre: strONull(f.recibido_por_nombre),
    recibidoPorRol: strONull(f.recibido_por_rol),
    recibidoEn: fechaONull(f.recibido_en),
    firmaRecepcionId: numONull(f.firma_recepcion_id),
    observacionesRecepcion: strONull(f.observaciones_recepcion),
    recepcionOperadaPorUsuarioId: numONull(f.recepcion_operada_por_usuario_id),
    recepcionOperadaPorNombre: strONull(f.recepcion_operada_por_nombre),
    cerradoPorUsuarioId: numONull(f.cerrado_por_usuario_id),
    cerradoPorNombre: strONull(f.cerrado_por_nombre),
    cerradoEn: fechaONull(f.cerrado_en),
    motivoCierre: strONull(f.motivo_cierre),
  };
}

const COLUMNAS = `id, empresa_id, modulo, entidad_id, documento_codigo, etapa_origen, etapa_destino, modo, estado,
  emitido_por_usuario_id, emitido_por_nombre, emitido_por_rol, emitido_en, firma_emision_id, observaciones_emision,
  recibido_por_usuario_id, recibido_por_nombre, recibido_por_rol, recibido_en, firma_recepcion_id, observaciones_recepcion,
  recepcion_operada_por_usuario_id, recepcion_operada_por_nombre, cerrado_por_usuario_id, cerrado_por_nombre, cerrado_en,
  motivo_cierre, huella_idempotencia`;

async function leerEntregaConn(conn: PoolConnection, empresaId: number, id: number, bloquear: boolean): Promise<(Entrega & { huella: string }) | null> {
  const [filas] = await conn.query<RowDataPacket[]>(
    `SELECT ${COLUMNAS} FROM documento_entregas WHERE id = ? AND empresa_id = ? LIMIT 1${bloquear ? " FOR UPDATE" : ""}`,
    [id, empresaId],
  );
  return filas[0] ? { ...mapear(filas[0]), huella: String(filas[0].huella_idempotencia) } : null;
}

export async function obtenerEntrega(empresaId: number, id: number): Promise<Entrega | null> {
  const filas = await query<RowDataPacket[]>(
    `SELECT ${COLUMNAS} FROM documento_entregas WHERE id = ? AND empresa_id = ? LIMIT 1`, [id, empresaId],
  );
  return filas[0] ? mapear(filas[0]) : null;
}

/* ------------------------------------------------------------------ registrar (emitir) */

export type RegistrarEntregaInput = {
  empresaId: number;
  actor: ActorEntrega;
  modulo: ModuloEntrega;
  entidadId: number;
  destino: AreaEntrega;
  modo: ModoEntrega;
  observaciones?: string | null;
  /** Obligatoria: la genera el cliente una vez por intento de envío (mismo contrato que Fondos/Gastos/Compras). */
  claveIdempotencia: string;
  firma: FirmaEntregaInput;
  ip?: string | null;
  userAgent?: string | null;
};

/** Contenido funcional de la emisión. El origen NO entra: lo decide el servidor por la custodia. */
export function huellaEntrega(i: { modulo: ModuloEntrega; entidadId: number; destino: AreaEntrega; modo: ModoEntrega; observaciones: string | null; emisorUsuarioId: number }): string {
  return huellaDe({
    v: VERSION_HUELLA, tipo: "entrega", modulo: i.modulo, entidadId: i.entidadId, destino: i.destino, modo: i.modo,
    observaciones: i.observaciones, emisorUsuarioId: i.emisorUsuarioId,
  });
}

async function buscarPorClave(empresaId: number, clave: string, huella: string): Promise<Entrega | null> {
  const filas = await query<RowDataPacket[]>(
    `SELECT ${COLUMNAS} FROM documento_entregas WHERE empresa_id = ? AND clave_idempotencia = ? LIMIT 1`, [empresaId, clave],
  );
  if (!filas[0]) return null;
  if (String(filas[0].huella_idempotencia) !== huella) throw new ConflictoIdempotencia();
  return mapear(filas[0]);
}

export async function registrarEntrega(input: RegistrarEntregaInput): Promise<{ entrega: Entrega; repetida: boolean }> {
  const empresaId = idPositivo(input.empresaId);
  const entidadId = idPositivo(input.entidadId);
  if (!esModuloEntrega(input.modulo) || !esAreaEntrega(input.destino) || !esModoEntrega(input.modo)) {
    throw error(MENSAJES_ENTREGA.datosInvalidos);
  }
  const clave = typeof input.claveIdempotencia === "string" ? input.claveIdempotencia.trim() : "";
  if (!CLAVE_ENVIO_REGEX.test(clave)) throw error(MENSAJES_ENTREGA.claveRequerida);
  const observaciones = texto(input.observaciones, MAX_OBSERVACIONES_ENTREGA, "Las observaciones");
  const firma = validarFirma(input.firma, false);
  const { actor, modulo, destino, modo } = input;
  validarActor(actor);
  // Modo PRESENCIAL exige el permiso explícito (además del permiso del área de origen, que se valida con la custodia ya bloqueada).
  // SISTEMA no lo requiere. Antes de copiar la imagen o abrir la base.
  if (modo === "PRESENCIAL" && !puedeOperarPresencial(actor)) throw error(MENSAJES_ENTREGA.sinPermisoPresencial, 403);
  const def = DEFINICIONES_ENTREGA[modulo];
  const huella = huellaEntrega({ modulo, entidadId, destino, modo, observaciones, emisorUsuarioId: actor.usuarioId });

  // Reintento de la misma emisión (doble clic, red): devuelve la original sin escribir nada ni copiar la imagen.
  const previa = await buscarPorClave(empresaId, clave, huella);
  if (previa) return { entrega: previa, repetida: true };

  const imagen = await guardarImagenFirma(empresaId, `firma_entrega_${modulo.toLowerCase()}_${entidadId}`, firma);
  try {
    const { id, repetida } = await conImagenCompensada(imagen, () => enTransaccion(async (conn) => {
      const documento = await bloquearDocumento(conn, empresaId, modulo, entidadId);
      if (!documento) throw error(MENSAJES_ENTREGA.documentoNoEncontrado, 404);
      // Con el documento ya bloqueado, otra petición con la MISMA clave pudo haber terminado mientras esperábamos: se relee la
      // clave para responder la original en vez de «pendiente existente». Es la PRIMERA lectura no bloqueante de la transacción,
      // así que su instantánea se toma DESPUÉS de obtener el bloqueo del documento y ve todo lo confirmado por emisiones
      // anteriores del mismo documento. Va SIN `FOR UPDATE`: un bloqueo sobre una clave inexistente toma un bloqueo de hueco en
      // `uq_de_empresa_clave` que se comparte con emisiones de otros documentos y las interbloquea al insertar. La garantía de
      // fondo sigue siendo el UNIQUE (empresa_id, clave_idempotencia): una carrera con otro documento termina en ER_DUP_ENTRY y
      // se resuelve más abajo (original si la huella coincide, 409 si no).
      const [mismaClave] = await conn.query<RowDataPacket[]>(
        "SELECT id, huella_idempotencia FROM documento_entregas WHERE empresa_id = ? AND clave_idempotencia = ? LIMIT 1",
        [empresaId, clave],
      );
      if (mismaClave[0]) {
        if (String(mismaClave[0].huella_idempotencia) !== huella) throw new ConflictoIdempotencia();
        return { valor: { id: Number(mismaClave[0].id), repetida: true }, imagenUsada: false };
      }
      if (!documento.admiteEntrega) throw error(MENSAJES_ENTREGA.estadoNoAdmitido, 409);

      // Historial del documento SIN `FOR UPDATE`: la fila del documento (bloqueada arriba) ya serializa las emisiones del MISMO
      // documento y la lectura ocurre DESPUÉS de ese bloqueo, así que ve todo lo confirmado por emisiones anteriores. Un
      // `FOR UPDATE` sobre un rango vacío toma bloqueos de hueco que se comparten con emisiones de OTROS documentos (o empresas) y
      // las interbloquea al insertar (ER_LOCK_DEADLOCK). Cerrar una entrega concurrentemente solo puede dejarnos ver la entrega
      // aún pendiente (409), nunca una custodia futura: una pendiente en esta lectura siempre bloquea la nueva emisión.
      const [filas] = await conn.query<RowDataPacket[]>(
        `SELECT id, estado, etapa_destino FROM documento_entregas
         WHERE empresa_id = ? AND modulo = ? AND entidad_id = ? ORDER BY id`,
        [empresaId, modulo, entidadId],
      );
      const custodia = calcularCustodia(modulo, filas.map((f) => ({
        id: Number(f.id), estado: String(f.estado) as EstadoEntrega, etapaDestino: String(f.etapa_destino) as AreaEntrega,
      })));
      const origen = custodia.area;
      if (!puedeActuarPorArea(actor, modulo, origen)) throw error(MENSAJES_ENTREGA.sinPermisoArea, 403);
      if (custodia.pendiente) throw error(MENSAJES_ENTREGA.pendienteExistente, 409);
      if (!parEntrega(modulo, origen, destino)) throw error(MENSAJES_ENTREGA.parNoPermitido, 409);

      const firmaCreada = await crearFirmaInterna(conn, {
        empresaId, usuarioId: actor.usuarioId, empleadoId: null, nombreFirmante: actor.nombre, rolFirmante: actor.rol,
        accion: ACCION_FIRMA_ENTREGAR, modulo: def.moduloFirma, entidadTipo: def.entidadTipo, entidadId,
        valoresRelevantes: { documentoCodigo: documento.codigo, origen, destino, modo, observaciones, claveIdempotencia: clave },
        imagen, metodo: "FIRMA_MANUSCRITA", origenFirma: firma.origen, ip: input.ip ?? null, userAgent: input.userAgent ?? null,
      });
      const [r] = await conn.execute<ResultSetHeader>(
        `INSERT INTO documento_entregas
          (empresa_id, modulo, entidad_tipo, entidad_id, documento_codigo, etapa_origen, etapa_destino, modo, estado,
           emitido_por_usuario_id, emitido_por_nombre, emitido_por_rol, emitido_en, firma_emision_id, observaciones_emision,
           clave_idempotencia, huella_idempotencia)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'EMITIDA', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [empresaId, modulo, def.entidadTipo, entidadId, documento.codigo, origen, destino, modo,
          actor.usuarioId, actor.nombre, actor.rol, firmaCreada.fechaHoraServidor, firmaCreada.id, observaciones, clave, huella],
      );
      const nuevaId = Number(r.insertId);
      await registrarAuditoriaTx(conn, {
        empresaId, usuario: actor.username, accion: "entrega_emitir", modulo: "documento_entregas",
        detalle: `Entrega #${nuevaId} de ${modulo} #${entidadId}${documento.codigo ? ` (${documento.codigo})` : ""}: ` +
          `${ETIQUETA_AREA[origen]} -> ${ETIQUETA_AREA[destino]} (${modo}).`,
      });
      return { valor: { id: nuevaId, repetida: false }, imagenUsada: true };
    }));
    return { entrega: (await obtenerEntrega(empresaId, id))!, repetida };
  } catch (e) {
    // Carrera con la MISMA clave: la otra petición ganó el UNIQUE. Se devuelve la original (o 409 si el contenido difiere).
    if (esDuplicadoDeClave(e, INDICE_CLAVE_ENTREGA)) {
      const original = await buscarPorClave(empresaId, clave, huella);
      if (original) return { entrega: original, repetida: true };
    }
    // Defensa en profundidad: el bloqueo del documento ya serializa, pero el UNIQUE de pendiente es la garantía final.
    if (esDuplicadoDeClave(e, INDICE_PENDIENTE_ENTREGA)) throw error(MENSAJES_ENTREGA.pendienteExistente, 409);
    throw e;
  }
}

/* ------------------------------------------------------------------ cierre de una entrega EMITIDA */

type OperacionCierre<T> = {
  empresaId: number;
  entregaId: number;
  imagen: ImagenFirmaInterna | null;
  /** Si la entrega YA quedó en el estado final por esta misma petición (reintento), devuelve true para responder sin escribir. */
  esRepeticion: (e: Entrega) => boolean;
  validar: (e: Entrega) => void;
  aplicar: (conn: PoolConnection, e: Entrega) => Promise<T>;
};

async function cerrarEntrega<T>(op: OperacionCierre<T>): Promise<Entrega> {
  // `op.imagen` (si hay) YA está en disco: todo lo anterior al commit va dentro de `conImagenCompensada`, incluida la lectura
  // previa, de modo que un error de infraestructura en cualquier paso también borra el archivo.
  const previa = await conImagenCompensada(op.imagen, async (): Promise<ResultadoTx<Entrega | null>> => {
    // Reintento ya aplicado: se responde sin abrir transacción (y el archivo temporal se borra).
    const actual = await obtenerEntrega(op.empresaId, op.entregaId);
    if (!actual) throw error(MENSAJES_ENTREGA.entregaNoEncontrada, 404);
    if (op.esRepeticion(actual)) return { valor: actual, imagenUsada: false };
    return enTransaccion<Entrega | null>(async (conn) => {
      const e = await leerEntregaConn(conn, op.empresaId, op.entregaId, true);
      if (!e) throw error(MENSAJES_ENTREGA.entregaNoEncontrada, 404);
      if (op.esRepeticion(e)) return { valor: null, imagenUsada: false };
      op.validar(e);
      if (e.estado !== "EMITIDA") throw error(MENSAJES_ENTREGA.noPendiente, 409);
      await op.aplicar(conn, e);
      return { valor: null, imagenUsada: true };
    });
  });
  return previa ?? (await obtenerEntrega(op.empresaId, op.entregaId))!;
}

/** UPDATE condicionado al estado EMITIDA: si otra transacción la cerró antes, 0 filas → 409 (nunca se pisa un cierre). */
async function actualizarSiEmitida(conn: PoolConnection, sql: string, params: (string | number | Date | null)[], empresaId: number, id: number) {
  const [r] = await conn.execute<ResultSetHeader>(`${sql} WHERE id = ? AND empresa_id = ? AND estado = 'EMITIDA'`, [...params, id, empresaId]);
  if (r.affectedRows !== 1) throw error(MENSAJES_ENTREGA.noPendiente, 409);
}

/** Antes de copiar ninguna imagen: entrega inexistente/ajena (404) o ya cerrada y no repetible (409). */
async function precheckEntrega(empresaId: number, id: number, esRepeticion: (e: Entrega) => boolean): Promise<void> {
  const e = await obtenerEntrega(empresaId, id);
  if (!e) throw error(MENSAJES_ENTREGA.entregaNoEncontrada, 404);
  if (e.estado !== "EMITIDA" && !esRepeticion(e)) throw error(MENSAJES_ENTREGA.noPendiente, 409);
}

/* ------------------------------------------------------------------ confirmar recepción (modo SISTEMA) */

export type ConfirmarRecepcionInput = {
  empresaId: number;
  actor: ActorEntrega;
  entregaId: number;
  observaciones?: string | null;
  firma: FirmaEntregaInput;
  ip?: string | null;
  userAgent?: string | null;
};

export async function confirmarRecepcion(input: ConfirmarRecepcionInput): Promise<Entrega> {
  const empresaId = idPositivo(input.empresaId);
  const entregaId = idPositivo(input.entregaId);
  const observaciones = texto(input.observaciones, MAX_OBSERVACIONES_ENTREGA, "Las observaciones");
  const firma = validarFirma(input.firma, false);
  const { actor } = input;
  validarActor(actor);
  const esRepeticion = (e: Entrega) =>
    e.estado === "RECIBIDA" && e.modo === "SISTEMA" && e.recibidoPorUsuarioId === actor.usuarioId && e.observacionesRecepcion === observaciones;

  await precheckEntrega(empresaId, entregaId, esRepeticion);
  const imagen = await guardarImagenFirma(empresaId, `firma_recepcion_${entregaId}`, firma);
  return cerrarEntrega({
    empresaId, entregaId, imagen, esRepeticion,
    validar: (e) => {
      if (e.estado !== "EMITIDA") return;
      if (e.modo !== "SISTEMA") throw error(MENSAJES_ENTREGA.modoPresencial, 409);
      if (e.emitidoPorUsuarioId === actor.usuarioId) throw error(MENSAJES_ENTREGA.propiaEntrega, 403);
      if (!puedeActuarPorArea(actor, e.modulo, e.etapaDestino)) throw error(MENSAJES_ENTREGA.sinPermisoArea, 403);
    },
    aplicar: async (conn, e) => {
      const def = DEFINICIONES_ENTREGA[e.modulo];
      const f = await crearFirmaInterna(conn, {
        empresaId, usuarioId: actor.usuarioId, empleadoId: null, nombreFirmante: actor.nombre, rolFirmante: actor.rol,
        accion: ACCION_FIRMA_RECIBIR, modulo: def.moduloFirma, entidadTipo: def.entidadTipo, entidadId: e.entidadId,
        valoresRelevantes: { entregaId: e.id, documentoCodigo: e.documentoCodigo, origen: e.etapaOrigen, destino: e.etapaDestino, modo: e.modo, observaciones },
        imagen, metodo: "FIRMA_MANUSCRITA", origenFirma: firma.origen, ip: input.ip ?? null, userAgent: input.userAgent ?? null,
      });
      await actualizarSiEmitida(conn,
        `UPDATE documento_entregas SET estado = 'RECIBIDA', recibido_por_usuario_id = ?, recibido_por_nombre = ?, recibido_por_rol = ?,
           recibido_en = ?, firma_recepcion_id = ?, observaciones_recepcion = ?`,
        [actor.usuarioId, actor.nombre, actor.rol, f.fechaHoraServidor, f.id, observaciones], empresaId, e.id);
      await registrarAuditoriaTx(conn, {
        empresaId, usuario: actor.username, accion: "entrega_recibir", modulo: "documento_entregas",
        detalle: `Entrega #${e.id} de ${e.modulo} #${e.entidadId} recibida en ${ETIQUETA_AREA[e.etapaDestino]}.`,
      });
    },
  });
}

/* ------------------------------------------------------------------ recepción presencial */

export type RecepcionPresencialInput = {
  empresaId: number;
  /** Usuario que OPERA el dispositivo (con permiso `entregas_presencial`), no quien recibe. */
  actor: ActorEntrega;
  entregaId: number;
  /** Persona que recibe y no tiene usuario. No se pide documento de identidad (decisión de negocio). */
  nombreReceptor: string;
  observaciones?: string | null;
  /** Obligatoriamente DIBUJADA por quien recibe. */
  firma: FirmaEntregaInput;
  ip?: string | null;
  userAgent?: string | null;
};

export async function registrarRecepcionPresencial(input: RecepcionPresencialInput): Promise<Entrega> {
  const empresaId = idPositivo(input.empresaId);
  const entregaId = idPositivo(input.entregaId);
  const nombre = texto(input.nombreReceptor, MAX_NOMBRE_PRESENCIAL, "El nombre");
  if (!nombre) throw error(MENSAJES_ENTREGA.nombreRequerido);
  const observaciones = texto(input.observaciones, MAX_OBSERVACIONES_ENTREGA, "Las observaciones");
  const firma = validarFirma(input.firma, true);
  const { actor } = input;
  validarActor(actor);
  if (!puedeOperarPresencial(actor)) throw error(MENSAJES_ENTREGA.sinPermisoPresencial, 403);
  const esRepeticion = (e: Entrega) =>
    e.estado === "RECIBIDA" && e.modo === "PRESENCIAL" && e.recepcionOperadaPorUsuarioId === actor.usuarioId &&
    e.recibidoPorNombre === nombre && e.observacionesRecepcion === observaciones;

  await precheckEntrega(empresaId, entregaId, esRepeticion);
  const imagen = await guardarImagenFirma(empresaId, `firma_recepcion_presencial_${entregaId}`, firma);
  return cerrarEntrega({
    empresaId, entregaId, imagen, esRepeticion,
    validar: (e) => {
      if (e.estado !== "EMITIDA") return;
      if (e.modo !== "PRESENCIAL") throw error(MENSAJES_ENTREGA.modoSistema, 409);
    },
    aplicar: async (conn, e) => {
      const def = DEFINICIONES_ENTREGA[e.modulo];
      const f = await crearFirmaInterna(conn, {
        // Firmante SIN usuario: usuario_id NULL; quién operó el dispositivo queda en valoresRelevantes y en la entrega.
        empresaId, usuarioId: null, empleadoId: null, nombreFirmante: nombre, rolFirmante: "",
        accion: ACCION_FIRMA_RECIBIR, modulo: def.moduloFirma, entidadTipo: def.entidadTipo, entidadId: e.entidadId,
        valoresRelevantes: {
          entregaId: e.id, documentoCodigo: e.documentoCodigo, origen: e.etapaOrigen, destino: e.etapaDestino, modo: e.modo,
          observaciones, operadorUsuarioId: actor.usuarioId, operadorNombre: actor.nombre,
        },
        imagen, metodo: "FIRMA_MANUSCRITA", origenFirma: "DIBUJADA", ip: input.ip ?? null, userAgent: input.userAgent ?? null,
      });
      await actualizarSiEmitida(conn,
        `UPDATE documento_entregas SET estado = 'RECIBIDA', recibido_por_usuario_id = NULL, recibido_por_nombre = ?, recibido_por_rol = NULL,
           recibido_en = ?, firma_recepcion_id = ?, observaciones_recepcion = ?, recepcion_operada_por_usuario_id = ?,
           recepcion_operada_por_nombre = ?`,
        [nombre, f.fechaHoraServidor, f.id, observaciones, actor.usuarioId, actor.nombre], empresaId, e.id);
      await registrarAuditoriaTx(conn, {
        empresaId, usuario: actor.username, accion: "entrega_recibir_presencial", modulo: "documento_entregas",
        detalle: `Entrega #${e.id} de ${e.modulo} #${e.entidadId} recibida en forma presencial por ${nombre} ` +
          `(${ETIQUETA_AREA[e.etapaDestino]}); operó ${actor.nombre}.`,
      });
    },
  });
}

/* ------------------------------------------------------------------ rechazar / anular */

export type CierreSinFirmaInput = { empresaId: number; actor: ActorEntrega; entregaId: number; motivo: string };

/** El RECEPTOR (área destino) rechaza una entrega en modo SISTEMA. El documento sigue en custodia del área origen. */
export async function rechazarRecepcion(input: CierreSinFirmaInput): Promise<Entrega> {
  const empresaId = idPositivo(input.empresaId);
  const entregaId = idPositivo(input.entregaId);
  const motivo = texto(input.motivo, MAX_MOTIVO_ENTREGA, "El motivo");
  if (!motivo) throw error(MENSAJES_ENTREGA.motivoRequerido);
  const { actor } = input;
  validarActor(actor);
  return cerrarEntrega({
    empresaId, entregaId, imagen: null,
    esRepeticion: (e) => e.estado === "RECHAZADA" && e.cerradoPorUsuarioId === actor.usuarioId && e.motivoCierre === motivo,
    validar: (e) => {
      if (e.estado !== "EMITIDA") return;
      if (e.modo !== "SISTEMA") throw error(MENSAJES_ENTREGA.modoPresencial, 409);
      if (e.emitidoPorUsuarioId === actor.usuarioId) throw error(MENSAJES_ENTREGA.propiaEntrega, 403);
      if (!puedeActuarPorArea(actor, e.modulo, e.etapaDestino)) throw error(MENSAJES_ENTREGA.sinPermisoArea, 403);
    },
    aplicar: async (conn, e) => {
      await actualizarSiEmitida(conn,
        "UPDATE documento_entregas SET estado = 'RECHAZADA', cerrado_por_usuario_id = ?, cerrado_por_nombre = ?, cerrado_en = NOW(), motivo_cierre = ?",
        [actor.usuarioId, actor.nombre, motivo], empresaId, e.id);
      await registrarAuditoriaTx(conn, {
        empresaId, usuario: actor.username, accion: "entrega_rechazar", modulo: "documento_entregas",
        detalle: `Entrega #${e.id} de ${e.modulo} #${e.entidadId} rechazada en ${ETIQUETA_AREA[e.etapaDestino]}. Motivo: ${motivo}`,
      });
    },
  });
}

/** Anula una entrega EMITIDA (error de destino, etc.): quien la emitió o quien tenga `entregas_anular`. Nunca una RECIBIDA. */
export async function anularEntrega(input: CierreSinFirmaInput): Promise<Entrega> {
  const empresaId = idPositivo(input.empresaId);
  const entregaId = idPositivo(input.entregaId);
  const motivo = texto(input.motivo, MAX_MOTIVO_ENTREGA, "El motivo");
  if (!motivo) throw error(MENSAJES_ENTREGA.motivoRequerido);
  const { actor } = input;
  validarActor(actor);
  return cerrarEntrega({
    empresaId, entregaId, imagen: null,
    esRepeticion: (e) => e.estado === "ANULADA" && e.cerradoPorUsuarioId === actor.usuarioId && e.motivoCierre === motivo,
    validar: (e) => {
      if (e.estado !== "EMITIDA") return;
      if (e.emitidoPorUsuarioId !== actor.usuarioId && !puedeAnularAjenas(actor)) throw error(MENSAJES_ENTREGA.sinPermisoAnular, 403);
    },
    aplicar: async (conn, e) => {
      await actualizarSiEmitida(conn,
        "UPDATE documento_entregas SET estado = 'ANULADA', cerrado_por_usuario_id = ?, cerrado_por_nombre = ?, cerrado_en = NOW(), motivo_cierre = ?",
        [actor.usuarioId, actor.nombre, motivo], empresaId, e.id);
      await registrarAuditoriaTx(conn, {
        empresaId, usuario: actor.username, accion: "entrega_anular", modulo: "documento_entregas",
        detalle: `Entrega #${e.id} de ${e.modulo} #${e.entidadId} anulada. Motivo: ${motivo}`,
      });
    },
  });
}

/* ------------------------------------------------------------------ consultas */

/** Historial de entregas de un documento (todas, en orden). Para los PDF: RECIBIDAS + la EMITIDA pendiente; el resto como nota. */
export async function listarEntregasDocumento(empresaId: number, modulo: ModuloEntrega, entidadId: number): Promise<Entrega[]> {
  if (!esModuloEntrega(modulo)) throw error(MENSAJES_ENTREGA.datosInvalidos);
  const filas = await query<RowDataPacket[]>(
    `SELECT ${COLUMNAS} FROM documento_entregas WHERE empresa_id = ? AND modulo = ? AND entidad_id = ? ORDER BY id`,
    [idPositivo(empresaId), modulo, idPositivo(entidadId)],
  );
  return filas.map(mapear);
}

export async function custodiaDocumento(empresaId: number, modulo: ModuloEntrega, entidadId: number) {
  return calcularCustodia(modulo, await listarEntregasDocumento(empresaId, modulo, entidadId));
}

/** Bandeja «Entregas por recibir» del actor: EMITIDAS en modo SISTEMA hacia un área por la que puede recibir, no emitidas por él. */
export async function listarEntregasPorRecibir(empresaId: number, actor: ActorEntrega): Promise<Entrega[]> {
  const areas = areasRecepcionDelActor(actor);
  const condiciones: string[] = [];
  const params: (string | number)[] = [idPositivo(empresaId), actor.usuarioId];
  for (const [modulo, lista] of Object.entries(areas)) {
    if (!lista.length) continue;
    condiciones.push(`(modulo = ? AND etapa_destino IN (${lista.map(() => "?").join(", ")}))`);
    params.push(modulo, ...lista);
  }
  if (!condiciones.length) return [];
  const filas = await query<RowDataPacket[]>(
    `SELECT ${COLUMNAS} FROM documento_entregas
     WHERE empresa_id = ? AND estado = 'EMITIDA' AND modo = 'SISTEMA' AND emitido_por_usuario_id <> ? AND (${condiciones.join(" OR ")})
     ORDER BY emitido_en, id`,
    params,
  );
  return filas.map(mapear);
}
