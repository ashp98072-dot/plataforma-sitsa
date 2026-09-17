import type { RowDataPacket, ResultSetHeader } from "mysql2";
import type { PoolConnection } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import {
  antecedenteFiscalSchema, documentosAntecedente, ErrorModeloFiscal,
  parsearDatosFiscales, validarAntecedenteFiscal, type AntecedenteFiscal,
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

export async function capturarAntecedentesFiscales(
  empresaId: number, empleadoId: number, ejercicio: number, raw: unknown, usuario: string, expectedRevision: number,
): Promise<{ id: number; revision: number }> {
  identidad(empresaId, empleadoId, ejercicio); actor(usuario, expectedRevision);
  const a = validarAntecedenteFiscal(raw, ejercicio);
  return transaccion(async (conn) => {
    await empleado(conn, empresaId, empleadoId, true);
    const rows = await revisiones(conn, empresaId, empleadoId, ejercicio);
    if (Number(rows[0]?.revision ?? 0) !== expectedRevision) throw new ErrorModeloFiscal("La revisión cambió; vuelva a consultar.", 409);
    await evidencias(conn, empresaId, empleadoId, a.datos);
    const revision = expectedRevision + 1;
    const [insert] = await conn.execute<ResultSetHeader>(
      `INSERT INTO rrhh_fiscal_empleado_ejercicio (empresa_id, id_empleado, ejercicio, revision, inicio_fiscal, corte_antecedentes,
       ingresos_gravados_previos, ingresos_exentos_previos, igss_laboral_previo, isr_retenido_previo, datos, creado_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [empresaId, empleadoId, ejercicio, revision, a.inicioFiscal, a.corteAntecedentes,
        a.ingresosGravadosPrevios, a.ingresosExentosPrevios, a.igssLaboralPrevio, a.isrRetenidoPrevio, JSON.stringify(a.datos), usuario]);
    await registrarAuditoriaTx(conn, { empresaId, usuario, accion: "CAPTURAR_ANTECEDENTES_FISCALES", modulo: "rrhh_fiscal",
      detalle: `Empleado #${empleadoId} ejercicio ${ejercicio} revisión ${revision} registro #${insert.insertId}` });
    return { id: insert.insertId, revision };
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
    const [update] = await conn.execute<ResultSetHeader>(
      `UPDATE rrhh_fiscal_empleado_ejercicio SET confirmado_por = ?, confirmado_en = CURRENT_TIMESTAMP
       WHERE empresa_id = ? AND id_empleado = ? AND ejercicio = ? AND revision = ? AND confirmado_en IS NULL`,
      [usuario, empresaId, empleadoId, ejercicio, revision]);
    if (update.affectedRows !== 1) throw new ErrorModeloFiscal("No se pudo confirmar la revisión.", 409);
    await registrarAuditoriaTx(conn, { empresaId, usuario, accion: "CONFIRMAR_ANTECEDENTES_FISCALES", modulo: "rrhh_fiscal",
      detalle: `Empleado #${empleadoId} ejercicio ${ejercicio} revisión ${revision}` });
    return { revision };
  });
}
