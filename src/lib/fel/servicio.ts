import { randomUUID } from "node:crypto";
import type { PoolConnection, ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { CLAVE_ENVIO_REGEX } from "@/lib/idempotencia/clave-envio";
import { ErrorConfigFel, descifrarSecretoFel } from "./credenciales";
import { estadoIntentoDe, estadoTrasResultado, type OrigenResultado, type ResultadoProveedorEstado } from "./estados";
import { huellaDe } from "./huella";
import { construirDtoCorrectivo, construirDtoFactura, type FacturaParaFel, type ImportesCorrectivo } from "./mapper";
import type {
  ContextoProveedor,
  FelProvider,
  ResolverProveedor,
  ResultadoAnulacion,
  ResultadoCertificar,
  ResultadoConsulta,
} from "./provider";
import { redactar } from "./redaccion";
import {
  ErrorFel,
  type AmbienteFel,
  type BloqueoFel,
  type DocumentoFelDto,
  type EstadoDocumentoFel,
  type EstadoIntentoFel,
  type IdentidadFiscal,
  type TipoDocumentoFel,
  type TipoIntentoFel,
} from "./tipos";

/**
 * SERVICIO FEL (FEL-2A) — dominio e idempotencia, SIN red y SIN conexión con contabilidad ni con la UI productiva.
 *
 * Protocolo (cada paso de BD es una transacción corta; la llamada al proveedor queda SIEMPRE fuera de toda transacción):
 *   TX1  bloquear (factura | documento origen) → resolver configuración → congelar DTO → crear/continuar el documento
 *        + intento ENVIANDO con la clave de solicitud → COMMIT.
 *   ───  proveedor.certificar | consultar | anular (sin transacción, con timeout acotado).
 *   TX2  bloquear el documento → aplicar el resultado por la máquina de estados → cerrar el intento → auditoría.
 *
 * Garantías: UNIQUE(referencia_emisor), UNIQUE (empresa, clave_solicitud), una FACTURA viva por factura (columna generada),
 * FKs compuestas con empresa_id y lock de la fila de la factura/origen. Un documento INCIERTO o PENDIENTE jamás se
 * reenvía sin consultar; NO_ENCONTRADO solo lo produce una consulta. Este módulo NO importa nada de contabilidad ni
 * modifica `fact_facturas`.
 */

export type ActorFel = { empresaId: number; usuarioId: number; usuario: string };

export type OpcionesServicioFel = {
  proveedores: ResolverProveedor;
  /** Un intento ENVIANDO más viejo que esto se considera huérfano (caída entre TX1 y TX2). Por defecto 5 min. */
  ventanaPendienteMs?: number;
  /** Tope de espera de la llamada al proveedor; al vencer el resultado es INCIERTO. Por defecto 30 s. */
  timeoutProveedorMs?: number;
  nuevaReferencia?: () => string;
  /** Semilla de PRUEBAS: simula la caída del proceso después de enviar y antes de registrar (TX2). */
  simularCaidaDespuesDeEnviar?: () => void | Promise<void>;
};

export type ResumenDocumentoFel = {
  documentoId: number;
  facturaId: number;
  tipo: TipoDocumentoFel;
  estado: EstadoDocumentoFel;
  ambiente: AmbienteFel;
  proveedor: string;
  referenciaEmisor: string;
  documentoOrigenId: number | null;
  identidad: IdentidadFiscal | null;
  ultimoCodigo: string | null;
  ultimoMensaje: string | null;
};

export type ResultadoFel =
  | { resultado: "ERROR_CONFIG"; codigo: string; mensaje: string }
  /**
   * Existe una anulación cuyo resultado EXTERNO se desconoce. El documento sigue CERTIFICADO localmente. NO se reenvía
   * automáticamente: la reconciliación depende del contrato de consulta de anulación del proveedor (no definido: FEL-3).
   */
  | { resultado: "ANULACION_INCIERTA"; documento: ResumenDocumentoFel; codigo: string | null; mensaje: string }
  | { resultado: "BLOQUEADO"; bloqueos: BloqueoFel[] }
  | { resultado: "DOCUMENTO"; documento: ResumenDocumentoFel; idempotente: boolean; enProceso: boolean };

interface FilaDoc extends RowDataPacket {
  id: number; empresa_id: number; factura_id: number; emisor_id: number; entidad_id: number; ambiente: AmbienteFel;
  proveedor: string; tipo_documento: TipoDocumentoFel; estado: EstadoDocumentoFel; referencia_emisor: string;
  huella_dto: string; dto_json: string; documento_origen_id: number | null; autorizacion: string | null;
  serie: string | null; numero: string | null; fecha_cert_iso: string | null;
  ultimo_codigo: string | null; ultimo_mensaje: string | null;
}
interface FilaIntentoClave extends RowDataPacket { id: number; documento_id: number; huella_solicitud: string | null; tipo: TipoIntentoFel }

/** Columnas del documento; la fecha de certificación se lee como ISO UTC (se guarda en UTC, sin conversión de zona). */
const COLS_DOC = "*, DATE_FORMAT(fecha_certificacion, '%Y-%m-%dT%H:%i:%sZ') AS fecha_cert_iso";
const DEFECTO_VENTANA_MS = 5 * 60_000;
const DEFECTO_TIMEOUT_MS = 30_000;
const MENSAJE_EXCEPCION = "El proveedor FEL no respondió de forma válida.";

type ConfigResuelta = {
  emisorId: number;
  ambiente: AmbienteFel;
  proveedor: FelProvider;
  proveedorNombre: string;
  contexto: ContextoProveedor;
  nitEmisor: string | null;
  nombreFiscal: string | null;
};
type ConfigFallo = { error: true; resultado: Extract<ResultadoFel, { resultado: "ERROR_CONFIG" }> };

type PlanEjecutable = {
  accion: "ENVIAR" | "CONSULTAR" | "ANULAR";
  documentoId: number;
  intentoId: number;
  config: ConfigResuelta;
  dto: DocumentoFelDto;
  referenciaEmisor: string;
  autorizacion: string | null;
  motivo: string | null;
  idempotente: boolean;
};
type Plan = { accion: "RETORNAR"; resultado: ResultadoFel } | PlanEjecutable;

const errorConfig = (codigo: string, mensaje: string): ConfigFallo => ({ error: true, resultado: { resultado: "ERROR_CONFIG", codigo, mensaje } });
const aDatetimeUtc = (iso: string) => new Date(iso).toISOString().slice(0, 19).replace("T", " ");
const esDup = (e: unknown, indice?: string) =>
  (e as { code?: string })?.code === "ER_DUP_ENTRY" && (!indice || String((e as { message?: string }).message).includes(indice));

async function transaccion<T>(fn: (c: PoolConnection) => Promise<T>): Promise<T> {
  const c = await getPool().getConnection();
  try {
    await c.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
    await c.beginTransaction();
    const r = await fn(c);
    await c.commit();
    return r;
  } catch (e) {
    try {
      await c.rollback();
    } catch {
      c.destroy();
    }
    throw e;
  } finally {
    c.release();
  }
}

function resumen(d: FilaDoc): ResumenDocumentoFel {
  const certificado = d.autorizacion && d.serie && d.numero && d.fecha_cert_iso;
  return {
    documentoId: Number(d.id),
    facturaId: Number(d.factura_id),
    tipo: d.tipo_documento,
    estado: d.estado,
    ambiente: d.ambiente,
    proveedor: d.proveedor,
    referenciaEmisor: d.referencia_emisor,
    documentoOrigenId: d.documento_origen_id == null ? null : Number(d.documento_origen_id),
    identidad: certificado ? { autorizacion: d.autorizacion!, serie: d.serie!, numero: d.numero!, fechaCertificacion: d.fecha_cert_iso! } : null,
    ultimoCodigo: d.ultimo_codigo,
    ultimoMensaje: d.ultimo_mensaje,
  };
}

const devolver = (d: FilaDoc, idempotente: boolean, enProceso = false): Plan => ({
  accion: "RETORNAR",
  resultado: { resultado: "DOCUMENTO", documento: resumen(d), idempotente, enProceso },
});

export function crearServicioFel(opciones: OpcionesServicioFel) {
  const ventanaMs = opciones.ventanaPendienteMs ?? DEFECTO_VENTANA_MS;
  const timeoutMs = opciones.timeoutProveedorMs ?? DEFECTO_TIMEOUT_MS;
  const nuevaReferencia = opciones.nuevaReferencia ?? randomUUID;

  // ───────────────────────── lecturas/escrituras de BD (siempre dentro de una transacción) ─────────────────────────
  async function cargarDoc(c: PoolConnection, empresaId: number, id: number, bloquear = true): Promise<FilaDoc | null> {
    const [r] = await c.query<FilaDoc[]>(
      `SELECT ${COLS_DOC} FROM fel_documentos WHERE empresa_id = ? AND id = ?${bloquear ? " FOR UPDATE" : ""}`,
      [empresaId, id],
    );
    return r[0] ?? null;
  }

  async function intentoAbierto(c: PoolConnection, empresaId: number, documentoId: number, tipo?: TipoIntentoFel) {
    const [r] = await c.query<(RowDataPacket & { id: number; tipo: TipoIntentoFel; edad_ms: string })[]>(
      `SELECT id, tipo, TIMESTAMPDIFF(MICROSECOND, creado_en, CURRENT_TIMESTAMP(3)) / 1000 AS edad_ms
         FROM fel_intentos WHERE empresa_id = ? AND documento_id = ? AND estado = 'ENVIANDO'${tipo ? " AND tipo = ?" : ""}
        ORDER BY id DESC LIMIT 1 FOR UPDATE`,
      tipo ? [empresaId, documentoId, tipo] : [empresaId, documentoId],
    );
    return r[0] ? { id: Number(r[0].id), tipo: r[0].tipo, vencido: Number(r[0].edad_ms) >= ventanaMs } : null;
  }

  async function crearIntento(
    c: PoolConnection, actor: ActorFel, documentoId: number, tipo: TipoIntentoFel, clave: string | null, huella: string | null,
  ): Promise<number> {
    const [r] = await c.execute<ResultSetHeader>(
      `INSERT INTO fel_intentos (empresa_id, documento_id, tipo, estado, clave_solicitud, huella_solicitud, usuario_id)
       VALUES (?, ?, ?, 'ENVIANDO', ?, ?, ?)`,
      [actor.empresaId, documentoId, tipo, clave, huella, actor.usuarioId],
    );
    return Number(r.insertId);
  }

  async function cerrarIntento(
    c: PoolConnection, intentoId: number, estado: EstadoIntentoFel,
    detalle: { codigo?: string; mensaje?: string; respuesta?: unknown } = {},
  ): Promise<void> {
    await c.execute(
      `UPDATE fel_intentos SET estado = ?, codigo = ?, mensaje = ?, respuesta_redactada = ?, finalizado_en = CURRENT_TIMESTAMP(3)
        WHERE id = ? AND estado = 'ENVIANDO'`,
      [
        estado,
        detalle.codigo?.slice(0, 60) ?? null,
        detalle.mensaje ? redactar(detalle.mensaje, 500) : null,
        detalle.respuesta === undefined ? null : redactar(detalle.respuesta),
        intentoId,
      ],
    );
  }

  async function cambiarEstado(
    c: PoolConnection, empresaId: number, doc: FilaDoc, estado: EstadoDocumentoFel,
    extra: { identidad?: IdentidadFiscal; codigo?: string | null; mensaje?: string | null } = {},
  ): Promise<void> {
    await c.execute(
      `UPDATE fel_documentos
          SET estado = ?, autorizacion = COALESCE(?, autorizacion), serie = COALESCE(?, serie), numero = COALESCE(?, numero),
              fecha_certificacion = COALESCE(?, fecha_certificacion), ultimo_codigo = ?, ultimo_mensaje = ?, version = version + 1
        WHERE empresa_id = ? AND id = ?`,
      [
        estado,
        extra.identidad?.autorizacion ?? null,
        extra.identidad?.serie ?? null,
        extra.identidad?.numero ?? null,
        extra.identidad ? aDatetimeUtc(extra.identidad.fechaCertificacion) : null,
        extra.codigo?.slice(0, 60) ?? null,
        extra.mensaje ? redactar(extra.mensaje, 500) : null,
        empresaId,
        doc.id,
      ],
    );
  }

  const auditar = (c: PoolConnection, actor: ActorFel, accion: string, detalle: Record<string, unknown>) =>
    registrarAuditoriaTx(c, { empresaId: actor.empresaId, usuario: actor.usuario, accion, modulo: "fel", detalle: redactar(detalle, 800) });

  /** Configuración del ambiente de un documento existente (consultar/anular/reenviar): NO depende del modo actual. */
  async function resolverAmbiente(
    c: PoolConnection, empresaId: number, entidadId: number, emisorId: number, ambiente: AmbienteFel,
  ): Promise<ConfigResuelta | ConfigFallo> {
    const [r] = await c.query<(RowDataPacket & {
      proveedor: string; base_url: string | null; nit_emisor: string | null; nombre_fiscal: string | null;
      secreto_cifrado: string | null; activo: number;
    })[]>(
      `SELECT proveedor, base_url, nit_emisor, nombre_fiscal, secreto_cifrado, activo
         FROM fel_emisor_ambientes WHERE empresa_id = ? AND emisor_id = ? AND ambiente = ?`,
      [empresaId, emisorId, ambiente],
    );
    const a = r[0];
    if (!a || !a.activo) return errorConfig("AMBIENTE_NO_CONFIGURADO", `El emisor no tiene el ambiente ${ambiente} configurado.`);
    const proveedor = opciones.proveedores(a.proveedor);
    if (!proveedor) return errorConfig("PROVEEDOR_NO_DISPONIBLE", "El proveedor FEL configurado no está disponible.");
    let secreto: string | null = null;
    if (proveedor.requiereCredenciales) {
      if (!a.secreto_cifrado) return errorConfig("SECRETO_NO_CONFIGURADO", "Faltan las credenciales FEL del ambiente.");
      try {
        secreto = descifrarSecretoFel(a.secreto_cifrado, { empresaId, entidadId, ambiente });
      } catch (e) {
        if (e instanceof ErrorConfigFel) return errorConfig("ERROR_CONFIG", e.message);
        throw e;
      }
    }
    return {
      emisorId,
      ambiente,
      proveedor,
      proveedorNombre: a.proveedor,
      contexto: { ambiente, proveedor: a.proveedor, baseUrl: a.base_url, nitEmisor: a.nit_emisor, secreto },
      nitEmisor: a.nit_emisor,
      nombreFiscal: a.nombre_fiscal,
    };
  }

  /** Configuración para un envío NUEVO: exige emisor activo y modo TEST/PROD; el ambiente es el modo vigente. */
  async function resolverNuevoEnvio(
    c: PoolConnection, empresaId: number, entidadId: number, ambienteRequerido?: AmbienteFel,
  ): Promise<ConfigResuelta | ConfigFallo> {
    const [r] = await c.query<(RowDataPacket & { id: number; modo: string; activo: number })[]>(
      "SELECT id, modo, activo FROM fel_emisores WHERE empresa_id = ? AND entidad_id = ?",
      [empresaId, entidadId],
    );
    const e = r[0];
    if (!e || !e.activo) return errorConfig("EMISOR_NO_CONFIGURADO", "La entidad no tiene un emisor FEL activo.");
    if (e.modo !== "TEST" && e.modo !== "PROD") return errorConfig("EMISOR_DESACTIVADO", "La emisión FEL está desactivada para esta entidad.");
    if (ambienteRequerido && e.modo !== ambienteRequerido) {
      return errorConfig("AMBIENTE_DISTINTO", `El emisor opera en ${e.modo} y el documento de origen pertenece a ${ambienteRequerido}.`);
    }
    return resolverAmbiente(c, empresaId, entidadId, Number(e.id), e.modo);
  }

  const MENSAJE_ANULACION_INCIERTA =
    "Hay una anulación con resultado desconocido. No se reenvía automáticamente: requiere reconciliación manual con el proveedor.";

  /** Resultado de una anulación incierta previa (cerrada INCIERTO/ERROR_CONFIG), o null si no existe. */
  async function anulacionIncierta(c: PoolConnection, empresaId: number, documentoId: number) {
    const [r] = await c.query<(RowDataPacket & { codigo: string | null })[]>(
      `SELECT codigo FROM fel_intentos WHERE empresa_id = ? AND documento_id = ? AND tipo = 'ANULAR'
          AND estado IN ('INCIERTO', 'ERROR_CONFIG') ORDER BY id DESC LIMIT 1`,
      [empresaId, documentoId],
    );
    return r[0] ? { codigo: r[0].codigo } : null;
  }

  const planAnulacionIncierta = (doc: FilaDoc, codigo: string | null): Plan => ({
    accion: "RETORNAR",
    resultado: { resultado: "ANULACION_INCIERTA", documento: resumen(doc), codigo, mensaje: MENSAJE_ANULACION_INCIERTA },
  });

  async function buscarPorClave(c: PoolConnection, empresaId: number, clave: string) {
    const [r] = await c.query<FilaIntentoClave[]>(
      "SELECT id, documento_id, huella_solicitud, tipo FROM fel_intentos WHERE empresa_id = ? AND clave_solicitud = ?",
      [empresaId, clave],
    );
    return r[0] ?? null;
  }

  /** Misma clave: mismo contenido ⇒ réplica; distinto contenido ⇒ conflicto. Devuelve el documento de la clave o null. */
  async function replicaPorClave(c: PoolConnection, actor: ActorFel, clave: string, huella: string): Promise<FilaDoc | null> {
    const previa = await buscarPorClave(c, actor.empresaId, clave);
    if (!previa) return null;
    if (previa.huella_solicitud !== huella) {
      throw new ErrorFel("CONFLICTO_IDEMPOTENCIA", "La clave de idempotencia ya fue usada con una solicitud diferente.");
    }
    return cargarDoc(c, actor.empresaId, Number(previa.documento_id));
  }

  const claveValida = (clave: string) => {
    if (!CLAVE_ENVIO_REGEX.test(clave)) throw new ErrorFel("SOLICITUD_INVALIDA", "Clave de idempotencia inválida.", 400);
  };

  /** Decide qué hacer con un documento YA existente (CERTIFICADO ⇒ devolverlo; incierto ⇒ consultar; etc.). */
  async function continuarDocumento(c: PoolConnection, actor: ActorFel, doc: FilaDoc, clave: string, huella: string): Promise<Plan> {
    if (doc.estado === "CERTIFICADO" || doc.estado === "ANULADO" || doc.estado === "RECHAZADO") return devolver(doc, true);

    const dto = JSON.parse(doc.dto_json) as DocumentoFelDto;
    const conClave = async (tipo: TipoIntentoFel) => {
      const previa = await buscarPorClave(c, actor.empresaId, clave);
      return crearIntento(c, actor, Number(doc.id), tipo, previa ? null : clave, previa ? null : huella);
    };
    const cfg = await resolverAmbiente(c, actor.empresaId, Number(doc.entidad_id), Number(doc.emisor_id), doc.ambiente);
    if ("error" in cfg) return { accion: "RETORNAR", resultado: cfg.resultado };
    const base = { documentoId: Number(doc.id), config: cfg, dto, referenciaEmisor: doc.referencia_emisor, autorizacion: doc.autorizacion, motivo: null, idempotente: true };

    if (doc.estado === "NO_ENCONTRADO") {
      // La consulta ya confirmó que NO existe: reenvío seguro con la MISMA referencia y el MISMO DTO congelado.
      await cambiarEstado(c, actor.empresaId, doc, "PENDIENTE", { codigo: doc.ultimo_codigo, mensaje: doc.ultimo_mensaje });
      return { accion: "ENVIAR", intentoId: await conClave("CERTIFICAR"), ...base, idempotente: false };
    }
    if (doc.estado === "PENDIENTE") {
      const abierto = await intentoAbierto(c, actor.empresaId, Number(doc.id));
      if (abierto && !abierto.vencido) return devolver(doc, true, true);
      if (abierto) {
        await cerrarIntento(c, abierto.id, "INCIERTO", { codigo: "VENTANA_VENCIDA", mensaje: "El envío quedó sin respuesta registrada." });
        await cambiarEstado(c, actor.empresaId, doc, "INCIERTO", { codigo: "VENTANA_VENCIDA", mensaje: "El envío quedó sin respuesta registrada." });
      }
    }
    // PENDIENTE sin intento abierto / INCIERTO: NUNCA se reenvía a ciegas; se consulta primero.
    return { accion: "CONSULTAR", intentoId: await conClave("CONSULTAR"), ...base };
  }

  // ─────────────────────────────── ejecución fuera de transacción + registro (TX2) ───────────────────────────────
  async function conTimeout<T>(promesa: Promise<T>, vencido: T): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limite = new Promise<T>((resolve) => {
      timer = setTimeout(() => resolve(vencido), timeoutMs);
    });
    try {
      return await Promise.race([promesa, limite]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  const sinRespuesta = (codigo: string, mensaje: string) => ({ tipo: "INCIERTO" as const, codigo, mensaje });

  function normalizar(raw: unknown, origen: OrigenResultado): ResultadoCertificar | ResultadoConsulta {
    const r = raw as { tipo?: string; autorizacion?: string; serie?: string; numero?: string; fechaCertificacion?: string } | null;
    switch (r?.tipo) {
      case "CERTIFICADO":
        if (!r.autorizacion || !r.serie || !r.numero || !r.fechaCertificacion || Number.isNaN(new Date(r.fechaCertificacion).getTime())) {
          return sinRespuesta("RESPUESTA_INVALIDA", "El proveedor informó certificación sin identidad fiscal completa.");
        }
        return raw as ResultadoCertificar;
      case "RECHAZADO":
      case "PENDIENTE":
      case "INCIERTO":
      case "ERROR_CONFIG":
        return raw as ResultadoCertificar;
      case "NO_ENCONTRADO":
        // Solo una consulta puede afirmarlo; en cualquier otro origen no se acepta como evidencia.
        return origen === "CONSULTAR" ? (raw as ResultadoConsulta) : sinRespuesta("NO_ENCONTRADO_NO_VALIDO", "NO_ENCONTRADO solo es válido como respuesta de consulta.");
      default:
        return sinRespuesta("RESPUESTA_INVALIDA", MENSAJE_EXCEPCION);
    }
  }

  async function llamar(plan: PlanEjecutable): Promise<ResultadoCertificar | ResultadoConsulta> {
    const origen: OrigenResultado = plan.accion === "ENVIAR" ? "CERTIFICAR" : "CONSULTAR";
    try {
      const { proveedor, contexto } = plan.config;
      const promesa =
        plan.accion === "ENVIAR"
          ? proveedor.certificar({ contexto, referenciaEmisor: plan.referenciaEmisor, tipo: plan.dto.tipo, dto: plan.dto })
          : proveedor.consultar({ contexto, referenciaEmisor: plan.referenciaEmisor });
      const raw = await conTimeout<unknown>(promesa, sinRespuesta("TIMEOUT_SERVICIO", "Tiempo de espera agotado sin respuesta del proveedor."));
      return normalizar(raw, origen);
    } catch {
      // Una excepción NUNCA se interpreta como «no existe» ni como rechazo: es incertidumbre.
      return sinRespuesta("EXCEPCION_PROVEEDOR", MENSAJE_EXCEPCION);
    }
  }

  async function registrar(
    actor: ActorFel, plan: PlanEjecutable, resultado: ResultadoCertificar | ResultadoConsulta,
  ): Promise<ResultadoFel> {
    const origen: OrigenResultado = plan.accion === "ENVIAR" ? "CERTIFICAR" : "CONSULTAR";
    return transaccion(async (c) => {
      const doc = (await cargarDoc(c, actor.empresaId, plan.documentoId))!;
      const tipo = resultado.tipo as ResultadoProveedorEstado;
      const detalle = { codigo: "codigo" in resultado ? resultado.codigo : undefined, mensaje: "mensaje" in resultado ? resultado.mensaje : undefined };
      const destino = estadoTrasResultado(doc.estado, origen, tipo);
      await cerrarIntento(c, plan.intentoId, estadoIntentoDe(tipo, origen), { ...detalle, respuesta: { tipo, ...detalle } });
      if (destino && destino !== doc.estado) {
        await cambiarEstado(c, actor.empresaId, doc, destino, {
          identidad: resultado.tipo === "CERTIFICADO" ? (resultado as IdentidadFiscal) : undefined,
          codigo: detalle.codigo ?? null,
          mensaje: detalle.mensaje ?? null,
        });
        await auditar(c, actor, `fel_${destino.toLowerCase()}`, { documentoId: doc.id, facturaId: doc.factura_id, de: doc.estado, a: destino, origen });
      } else if (destino === doc.estado && (tipo === "PENDIENTE" || tipo === "INCIERTO")) {
        await cambiarEstado(c, actor.empresaId, doc, destino, { codigo: detalle.codigo ?? null, mensaje: detalle.mensaje ?? null });
      }
      const final = (await cargarDoc(c, actor.empresaId, plan.documentoId, false))!;
      return { resultado: "DOCUMENTO", documento: resumen(final), idempotente: plan.idempotente, enProceso: false };
    });
  }

  async function ejecutar(actor: ActorFel, plan: Plan): Promise<ResultadoFel> {
    if (plan.accion === "RETORNAR") return plan.resultado;
    if (plan.accion === "ANULAR") return ejecutarAnulacion(actor, plan);
    const resultado = await llamar(plan);
    if (opciones.simularCaidaDespuesDeEnviar) await opciones.simularCaidaDespuesDeEnviar();
    return registrar(actor, plan, resultado);
  }

  async function ejecutarAnulacion(actor: ActorFel, plan: PlanEjecutable): Promise<ResultadoFel> {
    let raw: unknown;
    try {
      raw = await conTimeout<unknown>(
        plan.config.proveedor.anular({
          contexto: plan.config.contexto,
          referenciaEmisor: plan.referenciaEmisor,
          autorizacion: plan.autorizacion ?? "",
          motivo: plan.motivo ?? "",
        }),
        sinRespuesta("TIMEOUT_SERVICIO", "Tiempo de espera agotado sin respuesta del proveedor."),
      );
    } catch {
      raw = sinRespuesta("EXCEPCION_PROVEEDOR", MENSAJE_EXCEPCION);
    }
    if (opciones.simularCaidaDespuesDeEnviar) await opciones.simularCaidaDespuesDeEnviar();
    const r = raw as ResultadoAnulacion | null;
    // ANULADO solo es válido con fecha de anulación interpretable; cualquier otra forma es incertidumbre, no éxito.
    const anuladoValido = r?.tipo === "ANULADO" && !!r.fechaAnulacion && !Number.isNaN(new Date(r.fechaAnulacion).getTime());
    const tipo = anuladoValido ? "ANULADO" : r?.tipo === "RECHAZADO" || r?.tipo === "ERROR_CONFIG" ? r.tipo : "INCIERTO";
    // Fecha FISCAL de la anulación = la confirmada por el proveedor (UTC, como `fecha_certificacion`). La hora local en que
    // SITSA procesó la respuesta queda en `actualizado_en`, en `finalizado_en` del intento y en la auditoría.
    const fechaAnulacionProveedor = anuladoValido ? aDatetimeUtc((r as { fechaAnulacion: string }).fechaAnulacion) : null;
    return transaccion(async (c) => {
      const doc = (await cargarDoc(c, actor.empresaId, plan.documentoId))!;
      const detalle = { codigo: r && "codigo" in r ? r.codigo : undefined, mensaje: r && "mensaje" in r ? r.mensaje : undefined };
      await cerrarIntento(c, plan.intentoId, tipo, { ...detalle, respuesta: { tipo, ...detalle } });
      // La anulación fiscal SOLO se registra con una respuesta ANULADO válida del proveedor y desde CERTIFICADO.
      if (tipo === "ANULADO" && doc.estado === "CERTIFICADO") {
        await c.execute(
          `UPDATE fel_documentos SET estado = 'ANULADO', anulado_en = ?, anulado_por = ?, motivo_anulacion = ?,
                  ultimo_codigo = NULL, ultimo_mensaje = NULL, version = version + 1
            WHERE empresa_id = ? AND id = ? AND estado = 'CERTIFICADO'`,
          [fechaAnulacionProveedor, actor.usuarioId, plan.motivo, actor.empresaId, doc.id],
        );
        await auditar(c, actor, "fel_anulado", {
          documentoId: doc.id, facturaId: doc.factura_id, fechaAnulacionProveedor,
        });
      }
      const final = (await cargarDoc(c, actor.empresaId, plan.documentoId, false))!;
      if (final.estado === "CERTIFICADO" && (tipo === "INCIERTO" || tipo === "ERROR_CONFIG")) {
        // El documento sigue CERTIFICADO localmente y la anulación externa es desconocida: queda registrada, sin reenvío.
        await auditar(c, actor, "fel_anulacion_incierta", { documentoId: doc.id, facturaId: doc.factura_id, motivo: detalle.codigo ?? tipo });
        return { resultado: "ANULACION_INCIERTA", documento: resumen(final), codigo: detalle.codigo ?? null, mensaje: MENSAJE_ANULACION_INCIERTA };
      }
      return { resultado: "DOCUMENTO", documento: resumen(final), idempotente: false, enProceso: false };
    });
  }

  // ──────────────────────────────────── preparación de documentos nuevos (TX1) ────────────────────────────────────
  interface FilaFactura extends RowDataPacket {
    id: number; empresa_id: number; entidad_id: number | null; estado_admin: "Borrador" | "Emitida" | "Anulada"; moneda: string;
    fecha_emision: Date | string | null; monto_total: string; retencion_iva_pct: number; cliente_id: number;
  }

  async function bloquearFactura(c: PoolConnection, empresaId: number, facturaId: number): Promise<FilaFactura> {
    const [r] = await c.query<FilaFactura[]>(
      `SELECT id, empresa_id, entidad_id, estado_admin, moneda, fecha_emision, monto_total, retencion_iva_pct, cliente_id
         FROM fact_facturas WHERE empresa_id = ? AND id = ? FOR UPDATE`,
      [empresaId, facturaId],
    );
    if (!r[0]) throw new ErrorFel("NO_ENCONTRADO", "Factura no encontrada.", 404);
    return r[0];
  }

  async function facturaParaFel(c: PoolConnection, f: FilaFactura, emisor: { nit: string | null; nombreFiscal: string | null }): Promise<FacturaParaFel> {
    const [cl] = await c.query<(RowDataPacket & { razon_social: string | null; nit: string | null; email: string | null; direccion: string | null })[]>(
      "SELECT razon_social, nit, email, direccion FROM clientes WHERE empresa_id = ? AND id = ?",
      [f.empresa_id, f.cliente_id],
    );
    const [ls] = await c.query<(RowDataPacket & Record<string, string | number | null>)[]>(
      `SELECT orden, descripcion, cantidad, precio_unitario, clasificacion, precio_incluye_iva, porcentaje_iva, base_monto, iva_monto, total_linea
         FROM fact_factura_lineas WHERE factura_id = ? ORDER BY orden`,
      [f.id],
    );
    const fecha = f.fecha_emision instanceof Date ? f.fecha_emision.toISOString().slice(0, 10) : f.fecha_emision ? String(f.fecha_emision).slice(0, 10) : null;
    return {
      facturaId: Number(f.id),
      empresaId: Number(f.empresa_id),
      entidadId: f.entidad_id == null ? null : Number(f.entidad_id),
      estadoAdmin: f.estado_admin,
      moneda: f.moneda,
      fechaEmision: fecha,
      montoTotal: String(f.monto_total),
      retencionIvaPct: Number(f.retencion_iva_pct ?? 0),
      cliente: {
        razonSocial: cl[0]?.razon_social ?? null,
        nit: cl[0]?.nit ?? null,
        email: cl[0]?.email ?? null,
        direccion: cl[0]?.direccion ?? null,
      },
      lineas: ls.map((l) => ({
        orden: Number(l.orden),
        descripcion: String(l.descripcion),
        cantidad: String(l.cantidad),
        precioUnitario: String(l.precio_unitario),
        clasificacion: l.clasificacion == null ? null : String(l.clasificacion),
        precioIncluyeIva: Number(l.precio_incluye_iva) === 1,
        porcentajeIva: String(l.porcentaje_iva),
        base: l.base_monto == null ? null : String(l.base_monto),
        iva: l.iva_monto == null ? null : String(l.iva_monto),
        total: l.total_linea == null ? null : String(l.total_linea),
      })),
      emisor,
    };
  }

  async function insertarDocumento(
    c: PoolConnection, actor: ActorFel, d: {
      facturaId: number; entidadId: number; cfg: ConfigResuelta; tipo: TipoDocumentoFel; dto: DocumentoFelDto;
      origenId: number | null; motivo: string | null; clave: string; huella: string;
    },
  ): Promise<{ documentoId: number; intentoId: number; referencia: string }> {
    const referencia = nuevaReferencia();
    const [r] = await c.execute<ResultSetHeader>(
      `INSERT INTO fel_documentos (empresa_id, factura_id, emisor_id, entidad_id, ambiente, proveedor, tipo_documento, estado,
                                  referencia_emisor, huella_dto, dto_json, documento_origen_id, motivo, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDIENTE', ?, ?, ?, ?, ?, ?)`,
      [
        actor.empresaId, d.facturaId, d.cfg.emisorId, d.entidadId, d.cfg.ambiente, d.cfg.proveedorNombre, d.tipo,
        referencia, huellaDe(d.dto), JSON.stringify(d.dto), d.origenId, d.motivo, actor.usuarioId,
      ],
    );
    const documentoId = Number(r.insertId);
    const intentoId = await crearIntento(c, actor, documentoId, "CERTIFICAR", d.clave, d.huella);
    await auditar(c, actor, "fel_documento_preparado", {
      documentoId, facturaId: d.facturaId, tipo: d.tipo, ambiente: d.cfg.ambiente, referencia, origenId: d.origenId,
    });
    return { documentoId, intentoId, referencia };
  }

  /** TX1 común de facturas (certificación directa y refacturación). */
  async function prepararFactura(
    c: PoolConnection, actor: ActorFel, facturaId: number, clave: string, huella: string, origen: FilaDoc | null,
  ): Promise<Plan> {
    const fac = await bloquearFactura(c, actor.empresaId, facturaId);

    const replica = await replicaPorClave(c, actor, clave, huella);
    if (replica) return continuarDocumento(c, actor, replica, clave, huella);

    const [vivo] = await c.query<FilaDoc[]>(
      `SELECT ${COLS_DOC} FROM fel_documentos WHERE empresa_id = ? AND factura_id = ? AND tipo_documento = 'FACTURA' AND estado <> 'RECHAZADO'
        ORDER BY id LIMIT 1 FOR UPDATE`,
      [actor.empresaId, facturaId],
    );
    if (vivo[0]) return continuarDocumento(c, actor, vivo[0], clave, huella);

    if (origen && fac.entidad_id != null && Number(fac.entidad_id) !== Number(origen.entidad_id)) {
      throw new ErrorFel("ORIGEN_INVALIDO", "La nueva factura debe pertenecer a la misma entidad emisora del documento origen.");
    }
    const entidadId = fac.entidad_id == null ? null : Number(fac.entidad_id);
    let cfg: ConfigResuelta | null = null;
    if (entidadId != null) {
      const r = await resolverNuevoEnvio(c, actor.empresaId, entidadId, origen?.ambiente);
      if ("error" in r) return { accion: "RETORNAR", resultado: r.resultado };
      cfg = r;
    }
    const mapeo = construirDtoFactura(await facturaParaFel(c, fac, { nit: cfg?.nitEmisor ?? null, nombreFiscal: cfg?.nombreFiscal ?? null }));
    if (!mapeo.ok || !cfg || entidadId == null) {
      return { accion: "RETORNAR", resultado: { resultado: "BLOQUEADO", bloqueos: mapeo.ok ? [] : mapeo.bloqueos } };
    }
    const creado = await insertarDocumento(c, actor, {
      facturaId, entidadId, cfg, tipo: "FACTURA", dto: mapeo.dto, origenId: origen ? Number(origen.id) : null, motivo: null, clave, huella,
    });
    return {
      accion: "ENVIAR", documentoId: creado.documentoId, intentoId: creado.intentoId, config: cfg, dto: mapeo.dto,
      referenciaEmisor: creado.referencia, autorizacion: null, motivo: null, idempotente: false,
    };
  }

  const traducirDuplicado = (e: unknown): never => {
    if (esDup(e, "uq_fel_int_solicitud")) {
      throw new ErrorFel("CONFLICTO_IDEMPOTENCIA", "La clave de idempotencia ya fue usada con una solicitud diferente.");
    }
    if (esDup(e, "uq_fel_doc_factura_viva")) {
      throw new ErrorFel("ESTADO_NO_PERMITE", "La factura ya tiene un documento fiscal vigente.");
    }
    throw e;
  };

  async function ejecutarPlan(actor: ActorFel, preparar: (c: PoolConnection) => Promise<Plan>): Promise<ResultadoFel> {
    let plan: Plan;
    try {
      plan = await transaccion(preparar);
    } catch (e) {
      return traducirDuplicado(e);
    }
    return ejecutar(actor, plan);
  }

  // ────────────────────────────────────────────────── API pública ──────────────────────────────────────────────────

  /**
   * Certifica (o continúa/recupera) la factura fiscal de `facturaId`. Idempotente por `claveSolicitud` y por factura:
   * dos clics o dos procesos producen UNA identidad fiscal. NO cambia `fact_facturas.estado_admin`.
   */
  async function solicitarCertificacion(actor: ActorFel, entrada: { facturaId: number; claveSolicitud: string }): Promise<ResultadoFel> {
    claveValida(entrada.claveSolicitud);
    const huella = huellaDe({ op: "CERTIFICAR_FACTURA", facturaId: entrada.facturaId });
    return ejecutarPlan(actor, (c) => prepararFactura(c, actor, entrada.facturaId, entrada.claveSolicitud, huella, null));
  }

  /** Consulta al proveedor un documento incierto/pendiente/no encontrado (nunca reenvía por sí misma). */
  async function reconciliarDocumento(actor: ActorFel, documentoId: number): Promise<ResultadoFel> {
    return ejecutarPlan(actor, async (c) => {
      const doc = await cargarDoc(c, actor.empresaId, documentoId);
      if (!doc) throw new ErrorFel("NO_ENCONTRADO", "Documento FEL no encontrado.", 404);
      if (doc.estado === "CERTIFICADO" || doc.estado === "ANULADO" || doc.estado === "RECHAZADO") return devolver(doc, true);
      if (doc.estado === "PENDIENTE") {
        const abierto = await intentoAbierto(c, actor.empresaId, Number(doc.id));
        if (abierto && !abierto.vencido) return devolver(doc, true, true);
        if (abierto) {
          await cerrarIntento(c, abierto.id, "INCIERTO", { codigo: "VENTANA_VENCIDA", mensaje: "El envío quedó sin respuesta registrada." });
          await cambiarEstado(c, actor.empresaId, doc, "INCIERTO", { codigo: "VENTANA_VENCIDA", mensaje: "El envío quedó sin respuesta registrada." });
        }
      }
      const cfg = await resolverAmbiente(c, actor.empresaId, Number(doc.entidad_id), Number(doc.emisor_id), doc.ambiente);
      if ("error" in cfg) return { accion: "RETORNAR", resultado: cfg.resultado };
      const intentoId = await crearIntento(c, actor, Number(doc.id), "CONSULTAR", null, null);
      return {
        accion: "CONSULTAR", documentoId: Number(doc.id), intentoId, config: cfg, dto: JSON.parse(doc.dto_json) as DocumentoFelDto,
        referenciaEmisor: doc.referencia_emisor, autorizacion: doc.autorizacion, motivo: null, idempotente: false,
      };
    });
  }

  /**
   * Reenvío de un documento cuya consulta confirmó NO_ENCONTRADO (misma referencia y DTO), o recuperación de uno
   * incierto. RECHAZADO es terminal: una corrección es un documento NUEVO.
   */
  async function reintentarDocumento(actor: ActorFel, entrada: { documentoId: number; claveSolicitud: string }): Promise<ResultadoFel> {
    claveValida(entrada.claveSolicitud);
    const huella = huellaDe({ op: "REINTENTAR", documentoId: entrada.documentoId });
    return ejecutarPlan(actor, async (c) => {
      const doc = await cargarDoc(c, actor.empresaId, entrada.documentoId);
      if (!doc) throw new ErrorFel("NO_ENCONTRADO", "Documento FEL no encontrado.", 404);
      const replica = await replicaPorClave(c, actor, entrada.claveSolicitud, huella);
      if (replica && Number(replica.id) !== Number(doc.id)) {
        throw new ErrorFel("CONFLICTO_IDEMPOTENCIA", "La clave de idempotencia ya fue usada con una solicitud diferente.");
      }
      if (doc.estado === "RECHAZADO") {
        throw new ErrorFel("ESTADO_NO_PERMITE", "Un documento rechazado no se reenvía: corrija los datos y cree un documento nuevo.");
      }
      return continuarDocumento(c, actor, doc, entrada.claveSolicitud, huella);
    });
  }

  /** Anulación fiscal: SOLO desde CERTIFICADO y SOLO con respuesta ANULADO del proveedor. No toca fact_facturas. */
  async function anularDocumento(
    actor: ActorFel, entrada: { documentoId: number; motivo: string; claveSolicitud: string },
  ): Promise<ResultadoFel> {
    claveValida(entrada.claveSolicitud);
    const motivo = entrada.motivo.trim();
    if (motivo.length < 5 || motivo.length > 500) throw new ErrorFel("SOLICITUD_INVALIDA", "El motivo de anulación debe tener entre 5 y 500 caracteres.", 400);
    const huella = huellaDe({ op: "ANULAR", documentoId: entrada.documentoId, motivo });
    return ejecutarPlan(actor, async (c) => {
      const doc = await cargarDoc(c, actor.empresaId, entrada.documentoId);
      if (!doc) throw new ErrorFel("NO_ENCONTRADO", "Documento FEL no encontrado.", 404);
      const previa = await buscarPorClave(c, actor.empresaId, entrada.claveSolicitud);
      if (previa && (previa.huella_solicitud !== huella || Number(previa.documento_id) !== Number(doc.id))) {
        throw new ErrorFel("CONFLICTO_IDEMPOTENCIA", "La clave de idempotencia ya fue usada con una solicitud diferente.");
      }
      if (doc.estado === "ANULADO") return devolver(doc, true);
      if (doc.estado !== "CERTIFICADO") throw new ErrorFel("ESTADO_NO_PERMITE", "Solo un documento CERTIFICADO puede anularse.");
      // Una anulación es IRREVERSIBLE: ante cualquier incertidumbre NO se reenvía (ni aquí ni en otra solicitud).
      const abierto = await intentoAbierto(c, actor.empresaId, Number(doc.id), "ANULAR");
      if (abierto && !abierto.vencido) return devolver(doc, true, true);
      if (abierto) {
        // Huérfano (caída entre TX1 y TX2): el proveedor pudo haber anulado. Queda INCIERTO y NO se vuelve a enviar.
        await cerrarIntento(c, abierto.id, "INCIERTO", { codigo: "VENTANA_VENCIDA", mensaje: "La anulación quedó sin respuesta registrada." });
        await auditar(c, actor, "fel_anulacion_incierta", { documentoId: doc.id, facturaId: doc.factura_id, motivo: "VENTANA_VENCIDA" });
        return planAnulacionIncierta(doc, "VENTANA_VENCIDA");
      }
      const previaIncierta = await anulacionIncierta(c, actor.empresaId, Number(doc.id));
      if (previaIncierta) return planAnulacionIncierta(doc, previaIncierta.codigo);
      const cfg = await resolverAmbiente(c, actor.empresaId, Number(doc.entidad_id), Number(doc.emisor_id), doc.ambiente);
      if ("error" in cfg) return { accion: "RETORNAR", resultado: cfg.resultado };
      const intentoId = await crearIntento(c, actor, Number(doc.id), "ANULAR", previa ? null : entrada.claveSolicitud, previa ? null : huella);
      await auditar(c, actor, "fel_anulacion_solicitada", { documentoId: doc.id, facturaId: doc.factura_id });
      return {
        accion: "ANULAR", documentoId: Number(doc.id), intentoId, config: cfg, dto: JSON.parse(doc.dto_json) as DocumentoFelDto,
        referenciaEmisor: doc.referencia_emisor, autorizacion: doc.autorizacion, motivo, idempotente: false,
      };
    });
  }

  /**
   * Nota de crédito/débito sobre un documento CERTIFICADO. El origen NO se modifica. Los importes los aporta el
   * llamador (decisión de negocio pendiente). Solo dominio: no hay ruta ni UI que lo exponga.
   */
  async function solicitarDocumentoCorrectivo(
    actor: ActorFel,
    entrada: {
      documentoOrigenId: number; tipo: Exclude<TipoDocumentoFel, "FACTURA">; motivo: string; importes: ImportesCorrectivo;
      fechaEmision: string; claveSolicitud: string;
    },
  ): Promise<ResultadoFel> {
    claveValida(entrada.claveSolicitud);
    const motivo = entrada.motivo.trim();
    if (motivo.length < 5 || motivo.length > 500) throw new ErrorFel("SOLICITUD_INVALIDA", "El motivo debe tener entre 5 y 500 caracteres.", 400);
    const huella = huellaDe({ op: "CORRECTIVO", origen: entrada.documentoOrigenId, tipo: entrada.tipo, motivo, importes: entrada.importes, fecha: entrada.fechaEmision });
    return ejecutarPlan(actor, async (c) => {
      const origen = await cargarDoc(c, actor.empresaId, entrada.documentoOrigenId);
      if (!origen) throw new ErrorFel("ORIGEN_INVALIDO", "El documento de origen no existe en esta empresa.", 404);
      const replica = await replicaPorClave(c, actor, entrada.claveSolicitud, huella);
      if (replica) return continuarDocumento(c, actor, replica, entrada.claveSolicitud, huella);
      if (origen.tipo_documento !== "FACTURA") throw new ErrorFel("ORIGEN_INVALIDO", "Solo se puede corregir una factura.");
      if (origen.estado !== "CERTIFICADO") throw new ErrorFel("ORIGEN_INVALIDO", "El documento de origen debe estar CERTIFICADO.");
      const origenDto = JSON.parse(origen.dto_json) as DocumentoFelDto;
      const cfg = await resolverNuevoEnvio(c, actor.empresaId, Number(origen.entidad_id), origen.ambiente);
      if ("error" in cfg) return { accion: "RETORNAR", resultado: cfg.resultado };
      if (cfg.emisorId !== Number(origen.emisor_id)) throw new ErrorFel("ORIGEN_INVALIDO", "El emisor no coincide con el del documento origen.");
      const identidad = resumen(origen).identidad!;
      const mapeo = construirDtoCorrectivo(
        { dto: origenDto, documentoId: Number(origen.id), identidad }, entrada.tipo, motivo, entrada.importes, entrada.fechaEmision,
      );
      if (!mapeo.ok) return { accion: "RETORNAR", resultado: { resultado: "BLOQUEADO", bloqueos: mapeo.bloqueos } };
      const creado = await insertarDocumento(c, actor, {
        facturaId: Number(origen.factura_id), entidadId: Number(origen.entidad_id), cfg, tipo: entrada.tipo, dto: mapeo.dto,
        origenId: Number(origen.id), motivo, clave: entrada.claveSolicitud, huella,
      });
      return {
        accion: "ENVIAR", documentoId: creado.documentoId, intentoId: creado.intentoId, config: cfg, dto: mapeo.dto,
        referenciaEmisor: creado.referencia, autorizacion: null, motivo, idempotente: false,
      };
    });
  }

  /**
   * Refacturación: una FACTURA NUEVA (otra `fact_facturas`) enlazada al documento original por `documento_origen_id`.
   * Exige que el original ya esté corregido: ANULADO, o con una nota de crédito CERTIFICADA. (Regla provisional: ver docs.)
   */
  async function solicitarRefacturacion(
    actor: ActorFel, entrada: { documentoOrigenId: number; nuevaFacturaId: number; claveSolicitud: string },
  ): Promise<ResultadoFel> {
    claveValida(entrada.claveSolicitud);
    const huella = huellaDe({ op: "REFACTURAR", origen: entrada.documentoOrigenId, facturaId: entrada.nuevaFacturaId });
    return ejecutarPlan(actor, async (c) => {
      const origenPrevio = await cargarDoc(c, actor.empresaId, entrada.documentoOrigenId, false);
      if (!origenPrevio) throw new ErrorFel("ORIGEN_INVALIDO", "El documento de origen no existe en esta empresa.", 404);
      if (Number(origenPrevio.factura_id) === entrada.nuevaFacturaId) {
        throw new ErrorFel("ORIGEN_INVALIDO", "La refacturación debe hacerse sobre una factura distinta de la original.");
      }
      // Orden de locks: factura primero (dentro de prepararFactura), luego documento origen.
      const fac = await bloquearFactura(c, actor.empresaId, entrada.nuevaFacturaId);
      const origen = (await cargarDoc(c, actor.empresaId, entrada.documentoOrigenId))!;
      if (origen.tipo_documento !== "FACTURA") throw new ErrorFel("ORIGEN_INVALIDO", "Solo se puede refacturar una factura.");
      if (fac.entidad_id == null || Number(fac.entidad_id) !== Number(origen.entidad_id)) {
        throw new ErrorFel("ORIGEN_INVALIDO", "La nueva factura debe pertenecer a la misma entidad emisora del documento origen.");
      }
      const replica = await replicaPorClave(c, actor, entrada.claveSolicitud, huella);
      if (replica) return continuarDocumento(c, actor, replica, entrada.claveSolicitud, huella);
      if (origen.estado !== "ANULADO") {
        const [nc] = await c.query<RowDataPacket[]>(
          `SELECT id FROM fel_documentos WHERE empresa_id = ? AND documento_origen_id = ? AND tipo_documento = 'NOTA_CREDITO' AND estado = 'CERTIFICADO' LIMIT 1`,
          [actor.empresaId, origen.id],
        );
        if (origen.estado !== "CERTIFICADO" || !nc[0]) {
          throw new ErrorFel("ESTADO_NO_PERMITE", "El documento original debe estar anulado o corregido con una nota de crédito certificada.");
        }
      }
      return prepararFactura(c, actor, entrada.nuevaFacturaId, entrada.claveSolicitud, huella, origen);
    });
  }

  return { solicitarCertificacion, reconciliarDocumento, reintentarDocumento, anularDocumento, solicitarDocumentoCorrectivo, solicitarRefacturacion };
}

export type ServicioFel = ReturnType<typeof crearServicioFel>;

// ───────────────────────────── lecturas (para PR C y para la futura UI; sin escritura) ─────────────────────────────

/** Documento FEL más reciente de una factura, scoped por empresa. */
export async function obtenerDocumentoFel(empresaId: number, documentoId: number): Promise<ResumenDocumentoFel | null> {
  const [r] = await getPool().query<FilaDoc[]>(`SELECT ${COLS_DOC} FROM fel_documentos WHERE empresa_id = ? AND id = ?`, [empresaId, documentoId]);
  return r[0] ? resumen(r[0]) : null;
}

/**
 * Certificación fiscal vigente de una factura (la FACTURA fiscal CERTIFICADA bajo la misma empresa), o null. Pensada para
 * la futura transacción de reconocimiento contable (PR C); aquí NO se invoca desde ningún flujo productivo.
 */
export async function obtenerCertificacionFactura(empresaId: number, facturaId: number): Promise<ResumenDocumentoFel | null> {
  const [r] = await getPool().query<FilaDoc[]>(
    `SELECT ${COLS_DOC} FROM fel_documentos WHERE empresa_id = ? AND factura_id = ? AND tipo_documento = 'FACTURA' AND estado = 'CERTIFICADO'
      ORDER BY id DESC LIMIT 1`,
    [empresaId, facturaId],
  );
  return r[0] ? resumen(r[0]) : null;
}

/** true si el documento tiene una anulación con resultado externo desconocido o en vuelo (sigue CERTIFICADO; no se reenvía). */
export async function tieneAnulacionIncierta(empresaId: number, documentoId: number): Promise<boolean> {
  const [r] = await getPool().query<RowDataPacket[]>(
    `SELECT 1 FROM fel_intentos WHERE empresa_id = ? AND documento_id = ? AND tipo = 'ANULAR'
        AND estado IN ('ENVIANDO', 'INCIERTO', 'ERROR_CONFIG') LIMIT 1`,
    [empresaId, documentoId],
  );
  return r.length > 0;
}
