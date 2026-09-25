import type { RowDataPacket, ResultSetHeader } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import {
  antecedenteFiscalSchema, documentosAntecedente, ErrorModeloFiscal, inicioEjercicio, MSG_MIGRACION_SOLAPADA,
  parsearDatosFiscales, TIPO_ORIGEN_MIGRACION, validarAntecedenteFiscal, type AntecedenteFiscal,
} from "./fiscal-modelo";

export type RevisionFiscal = AntecedenteFiscal & {
  id: number; revision: number; creadoPor: string; creadoEn: string;
  confirmadoPor: string | null; confirmadoEn: string | null;
};

function mapear(row: RowDataPacket): RevisionFiscal {
  const monto = (key: string) => row[key] === null ? null : String(row[key]);
  const fecha = (value: unknown) => value === null ? null :
    value instanceof Date ? `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}` : String(value).slice(0, 10);
  const parsed = antecedenteFiscalSchema.safeParse({
    inicioFiscal: fecha(row.inicio_fiscal), corteAntecedentes: fecha(row.corte_antecedentes),
    ingresosGravadosPrevios: monto("ingresos_gravados_previos"), ingresosExentosPrevios: monto("ingresos_exentos_previos"),
    igssLaboralPrevio: monto("igss_laboral_previo"), isrRetenidoPrevio: monto("isr_retenido_previo"),
    datos: parsearDatosFiscales(row.datos),
  });
  if (!parsed.success) throw new ErrorModeloFiscal("Antecedentes almacenados inválidos.", 409);
  return { ...parsed.data, id: Number(row.id), revision: Number(row.revision),
    creadoPor: String(row.creado_por), creadoEn: String(row.creado_en),
    confirmadoPor: row.confirmado_por === null ? null : String(row.confirmado_por),
    confirmadoEn: row.confirmado_en === null ? null : String(row.confirmado_en) };
}

function identidad(empresaId: number, empleadoId: number, ejercicio: number) {
  if (![empresaId, empleadoId].every((x) => Number.isSafeInteger(x) && x > 0 && x <= 2147483647) ||
    !Number.isInteger(ejercicio) || ejercicio < 2000 || ejercicio > 9999) {
    throw new ErrorModeloFiscal("Identidad fiscal inválida.");
  }
}

async function empleado(conn: PoolConnection, empresaId: number, empleadoId: number, lock: boolean) {
  // No filtrar estado: un empleado en Baja conserva antecedentes y acceso histórico.
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT id FROM empleados WHERE empresa_id = ? AND id = ?${lock ? " FOR UPDATE" : ""}`, [empresaId, empleadoId]);
  if (!rows.length) throw new ErrorModeloFiscal("Empleado no encontrado.", 404);
}

async function evidencias(conn: PoolConnection, empresaId: number, empleadoId: number, datos: AntecedenteFiscal["datos"]) {
  const ids = documentosAntecedente(datos);
  if (!ids.length) return;
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT id FROM documentos_empleados WHERE empresa_id = ? AND id_empleado = ? AND id IN (${ids.map(() => "?").join(",")}) ORDER BY id FOR UPDATE`,
    [empresaId, empleadoId, ...ids]);
  if (new Set(rows.map((r) => Number(r.id))).size !== ids.length) {
    throw new ErrorModeloFiscal("Evidencia no disponible para este empleado y empresa.");
  }
}

/**
 * ANTI DOBLE CONTEO: el acumulado de migración cubre TODO desde el 1 de enero hasta la fecha de corte (inclusive). Ninguna planilla
 * AUTORIZADA de este sistema con líneas de ese empleado puede solaparse con ese rango: el motor las sumaría como propias y
 * quedarían contadas dos veces. Bloquea al capturar, al confirmar y (defensa adicional) al calcular el ISR de una planilla.
 */
async function sinSolapamientoConPlanillas(conn: PoolConnection, empresaId: number, empleadoId: number, ejercicio: number, corte: string) {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT p.id FROM rrhh_planilla_periodos p
     INNER JOIN rrhh_planilla_lineas l ON l.periodo_id = p.id AND l.empresa_id = p.empresa_id
     WHERE p.empresa_id = ? AND l.id_empleado = ? AND p.autorizado_en IS NOT NULL AND p.fecha_inicio <= ? AND p.fecha_fin >= ?
     ORDER BY p.id LIMIT 1 FOR UPDATE`,
    [empresaId, empleadoId, corte, inicioEjercicio(ejercicio)]);
  if (rows.length) throw new ErrorModeloFiscal(MSG_MIGRACION_SOLAPADA, 409);
}

function auditoriaMigracion(a: AntecedenteFiscal) {
  return `tipo ${TIPO_ORIGEN_MIGRACION} corte ${a.corteAntecedentes} gravado ${a.ingresosGravadosPrevios} exento ${a.ingresosExentosPrevios} ` +
    `igss ${a.igssLaboralPrevio} isr ${a.isrRetenidoPrevio} origen "${a.datos.migracion?.referenciaOrigen ?? ""}"`;
}

async function revisiones(conn: PoolConnection, empresaId: number, empleadoId: number, ejercicio: number) {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT * FROM rrhh_fiscal_empleado_ejercicio WHERE empresa_id = ? AND id_empleado = ? AND ejercicio = ? ORDER BY revision DESC LIMIT 100`,
    [empresaId, empleadoId, ejercicio]);
  return rows;
}

export type AntecedentesFiscalesLectura = { ultima: RevisionFiscal | null; confirmada: RevisionFiscal | null; revisiones: RevisionFiscal[] };

/**
 * Núcleo de lectura, sin abrir ni cerrar conexión — para reutilizar dentro
 * de una transacción ya abierta por el llamador (ver leerAntecedentesFiscalesTx
 * más abajo, usado por planilla-fiscal-2026.ts). No hacer FOR UPDATE aquí:
 * sigue siendo una lectura, no reserva la fila para escribir.
 */
async function leerAntecedentesConn(conn: PoolConnection, empresaId: number, empleadoId: number, ejercicio: number): Promise<AntecedentesFiscalesLectura> {
  await empleado(conn, empresaId, empleadoId, false);
  const rows = await revisiones(conn, empresaId, empleadoId, ejercicio);
  // Confirmada se consulta aparte: puede ser anterior a las últimas 100 revisiones.
  const [confirmadas] = await conn.execute<RowDataPacket[]>(
    `SELECT * FROM rrhh_fiscal_empleado_ejercicio WHERE empresa_id = ? AND id_empleado = ? AND ejercicio = ? AND confirmado_en IS NOT NULL ORDER BY revision DESC LIMIT 1`,
    [empresaId, empleadoId, ejercicio]);
  return { ultima: rows[0] ? mapear(rows[0]) : null,
    confirmada: confirmadas[0] ? mapear(confirmadas[0]) : null, revisiones: rows.map(mapear) };
}

export async function leerAntecedentesFiscales(empresaId: number, empleadoId: number, ejercicio: number): Promise<AntecedentesFiscalesLectura> {
  identidad(empresaId, empleadoId, ejercicio);
  const conn = await getPool().getConnection();
  try {
    return await leerAntecedentesConn(conn, empresaId, empleadoId, ejercicio);
  } finally { conn.release(); }
}

/**
 * Variante transaccional: usa la conexión YA ABIERTA del llamador (por
 * ejemplo, la transacción de generarLineasPeriodo/autorizarPeriodoPlanilla
 * en planillas.ts, vía planilla-fiscal-2026.ts) en vez de pedir otra del
 * pool. Misma lógica de selección/parseo exacta que leerAntecedentesFiscales
 * — nunca abre ni libera conexión, esa es responsabilidad del llamador.
 */
export async function leerAntecedentesFiscalesTx(conn: PoolConnection, empresaId: number, empleadoId: number, ejercicio: number): Promise<AntecedentesFiscalesLectura> {
  identidad(empresaId, empleadoId, ejercicio);
  return leerAntecedentesConn(conn, empresaId, empleadoId, ejercicio);
}

async function transaccion<T>(trabajo: (conn: PoolConnection) => Promise<T>): Promise<T> {
  const conn = await getPool().getConnection();
  try {
    // Fail-closed si una instalación distinta no conserva transacciones reales.
    const [engines] = await conn.execute<RowDataPacket[]>(
      `SELECT TABLE_NAME, ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('empleados', 'documentos_empleados', 'auditoria', 'rrhh_fiscal_empleado_ejercicio')`);
    if (engines.length !== 4 || engines.some((r) => String(r.ENGINE).toLowerCase() !== "innodb")) {
      throw new ErrorModeloFiscal("Modelo fiscal requiere tablas transaccionales InnoDB.", 409);
    }
    await conn.beginTransaction();
    const result = await trabajo(conn);
    await conn.commit();
    return result;
  } catch (error) { await conn.rollback(); throw error; }
  finally { conn.release(); }
}

function actor(usuario: string, expectedRevision: number) {
  if (!usuario.trim() || usuario.length > 100 || !Number.isInteger(expectedRevision) || expectedRevision < 0 || expectedRevision >= 2147483647) {
    throw new ErrorModeloFiscal("Responsable o revisión inválidos.");
  }
}

/**
 * Núcleo de captura de UNA revisión dentro de una transacción/conexión YA abierta por el llamador: bloquea al empleado, valida
 * expectedRevision, evidencias, anti doble conteo (migración) e inserta la revisión + auditoría. Lo comparten la captura
 * individual (una transacción) y la importación masiva (UNA transacción para todas las filas): las reglas no se duplican.
 */
async function capturarEnConexion(
  conn: PoolConnection, empresaId: number, empleadoId: number, ejercicio: number, a: AntecedenteFiscal, usuario: string,
  expectedRevision: number, origenExtra?: string,
): Promise<{ id: number; revision: number }> {
  await empleado(conn, empresaId, empleadoId, true);
  const rows = await revisiones(conn, empresaId, empleadoId, ejercicio);
  if (Number(rows[0]?.revision ?? 0) !== expectedRevision) throw new ErrorModeloFiscal("La revisión cambió; vuelva a consultar.", 409);
  await evidencias(conn, empresaId, empleadoId, a.datos);
  const migracion = a.datos.declaracionAntecedentes === TIPO_ORIGEN_MIGRACION;
  if (migracion) await sinSolapamientoConPlanillas(conn, empresaId, empleadoId, ejercicio, a.corteAntecedentes!);
  const revision = expectedRevision + 1;
  const [insert] = await conn.execute<ResultSetHeader>(
    `INSERT INTO rrhh_fiscal_empleado_ejercicio (empresa_id, id_empleado, ejercicio, revision, inicio_fiscal, corte_antecedentes,
     ingresos_gravados_previos, ingresos_exentos_previos, igss_laboral_previo, isr_retenido_previo, datos, creado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [empresaId, empleadoId, ejercicio, revision, a.inicioFiscal, a.corteAntecedentes,
      a.ingresosGravadosPrevios, a.ingresosExentosPrevios, a.igssLaboralPrevio, a.isrRetenidoPrevio, JSON.stringify(a.datos), usuario]);
  await registrarAuditoriaTx(conn, { empresaId, usuario, accion: migracion ? "CAPTURAR_ACUMULADO_FISCAL_INICIAL" : "CAPTURAR_ANTECEDENTES_FISCALES", modulo: "rrhh_fiscal",
    detalle: `Empleado #${empleadoId} ejercicio ${ejercicio} revisión ${revision} registro #${insert.insertId}${migracion ? ` · ${auditoriaMigracion(a)}` : ""}${origenExtra ? ` · ${origenExtra}` : ""}` });
  return { id: insert.insertId, revision };
}

export async function capturarAntecedentesFiscales(
  empresaId: number, empleadoId: number, ejercicio: number, raw: unknown, usuario: string, expectedRevision: number,
): Promise<{ id: number; revision: number }> {
  identidad(empresaId, empleadoId, ejercicio); actor(usuario, expectedRevision);
  const a = validarAntecedenteFiscal(raw, ejercicio);
  return transaccion((conn) => capturarEnConexion(conn, empresaId, empleadoId, ejercicio, a, usuario, expectedRevision));
}

/** Error de una fila concreta de la importación masiva (provoca ROLLBACK de todo el archivo). */
export class ErrorImportacionFiscal extends ErrorModeloFiscal {
  constructor(public readonly numeroFila: number, message: string, status = 409) { super(`Fila ${numeroFila}: ${message}`, status); }
}
export type ItemImportacionAcumulado = { numeroFila: number; empleadoId: number; ejercicio: number; antecedente: unknown };

/**
 * IMPORTACIÓN MASIVA de acumulados iniciales como BORRADORES (nunca confirma). TODO O NADA: UNA conexión y UNA transacción para
 * todas las filas (no una por fila). Cada fila se revalida AQUÍ, con locks, aunque el análisis previo la haya dado por válida:
 * empleado, revisión esperada (0: cualquier borrador o confirmada posterior falla), anti doble conteo y modelo fiscal. Cualquier
 * fallo revierte todo. Auditoría por empleado (IMPORTACION_EXCEL) + un evento general.
 */
export async function importarAcumuladosFiscales(
  empresaId: number, items: ItemImportacionAcumulado[], usuario: string, archivo: string,
): Promise<{ importados: number; revisiones: { empleadoId: number; revision: number }[] }> {
  actor(usuario, 0);
  if (!items.length) throw new ErrorModeloFiscal("No hay filas para importar.");
  const validados = items.map((it) => {
    identidad(empresaId, it.empleadoId, it.ejercicio);
    try { return { ...it, a: validarAntecedenteFiscal(it.antecedente, it.ejercicio) }; }
    catch (e) { throw e instanceof ErrorModeloFiscal ? new ErrorImportacionFiscal(it.numeroFila, e.message, e.status) : e; }
  });
  // Orden estable por empleado: dos importaciones concurrentes toman los locks en el mismo orden (sin deadlocks).
  validados.sort((x, y) => x.empleadoId - y.empleadoId || x.ejercicio - y.ejercicio);
  const nombre = archivo.replace(/[\r\n"]/g, " ").slice(0, 120);
  return transaccion(async (conn) => {
    const revisionesCreadas: { empleadoId: number; revision: number }[] = [];
    for (const v of validados) {
      try {
        const r = await capturarEnConexion(conn, empresaId, v.empleadoId, v.ejercicio, v.a, usuario, 0, `IMPORTACION_EXCEL fila ${v.numeroFila} archivo "${nombre}"`);
        revisionesCreadas.push({ empleadoId: v.empleadoId, revision: r.revision });
      } catch (e) {
        throw e instanceof ErrorModeloFiscal && !(e instanceof ErrorImportacionFiscal) ? new ErrorImportacionFiscal(v.numeroFila, e.message, e.status) : e;
      }
    }
    const ejercicios = [...new Set(validados.map((v) => v.ejercicio))].join(",");
    await registrarAuditoriaTx(conn, { empresaId, usuario, accion: "IMPORTAR_ACUMULADOS_FISCALES", modulo: "rrhh_fiscal",
      detalle: `Importación Excel de acumulados fiscales iniciales · ejercicio ${ejercicios} · ${validados.length} borradores · archivo "${nombre}" · usuario ${usuario}` });
    return { importados: validados.length, revisiones: revisionesCreadas };
  });
}

export async function confirmarAntecedentesFiscales(
  empresaId: number, empleadoId: number, ejercicio: number, revision: number, usuario: string,
): Promise<{ revision: number }> {
  identidad(empresaId, empleadoId, ejercicio); actor(usuario, revision);
  if (revision <= 0) throw new ErrorModeloFiscal("Revisión inválida.");
  return transaccion(async (conn) => {
    await empleado(conn, empresaId, empleadoId, true);
    const rows = await revisiones(conn, empresaId, empleadoId, ejercicio), row = rows[0];
    if (!row) throw new ErrorModeloFiscal("Antecedentes no encontrados.", 404);
    if (Number(row.revision) !== revision) throw new ErrorModeloFiscal("La revisión cambió; vuelva a consultar.", 409);
    if (row.confirmado_en !== null) throw new ErrorModeloFiscal("Revisión ya confirmada.", 409);
    const stored = mapear(row);
    // No pasar metadata al schema estricto.
    const a = validarAntecedenteFiscal({ inicioFiscal: stored.inicioFiscal, corteAntecedentes: stored.corteAntecedentes,
      ingresosGravadosPrevios: stored.ingresosGravadosPrevios, ingresosExentosPrevios: stored.ingresosExentosPrevios,
      igssLaboralPrevio: stored.igssLaboralPrevio, isrRetenidoPrevio: stored.isrRetenidoPrevio, datos: stored.datos }, ejercicio, true);
    await evidencias(conn, empresaId, empleadoId, a.datos);
    const migracion = a.datos.declaracionAntecedentes === TIPO_ORIGEN_MIGRACION;
    if (migracion) await sinSolapamientoConPlanillas(conn, empresaId, empleadoId, ejercicio, a.corteAntecedentes!);
    const [update] = await conn.execute<ResultSetHeader>(
      `UPDATE rrhh_fiscal_empleado_ejercicio SET confirmado_por = ?, confirmado_en = CURRENT_TIMESTAMP
       WHERE empresa_id = ? AND id_empleado = ? AND ejercicio = ? AND revision = ? AND confirmado_en IS NULL`,
      [usuario, empresaId, empleadoId, ejercicio, revision]);
    if (update.affectedRows !== 1) throw new ErrorModeloFiscal("No se pudo confirmar la revisión.", 409);
    await registrarAuditoriaTx(conn, { empresaId, usuario, accion: migracion ? "CONFIRMAR_ACUMULADO_FISCAL_INICIAL" : "CONFIRMAR_ANTECEDENTES_FISCALES", modulo: "rrhh_fiscal",
      detalle: `Empleado #${empleadoId} ejercicio ${ejercicio} revisión ${revision}${migracion ? ` · ${auditoriaMigracion(a)}` : ""}` });
    return { revision };
  });
}
