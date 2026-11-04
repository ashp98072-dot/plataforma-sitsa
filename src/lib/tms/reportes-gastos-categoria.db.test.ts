import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * OP-FONDOS-REP-01 — VERIFICACIÓN CONTRA UNA BASE REAL DESECHABLE (MariaDB local).
 *
 * Se OMITE por defecto. Solo corre si `OP_FONDOS_REP_DB_PORT` apunta a una MariaDB LOCAL y DESECHABLE (127.0.0.1, usuario root sin
 * contraseña). Crea y destruye SU PROPIO esquema `op_fondos_rep01` con las dos tablas que lee el reporte (solo las columnas usadas) y
 * datos SINTÉTICOS. Ejecuta el reporte REAL (reporteSolicitudesFondo / obtenerReporteGastosPorTipo) y compara contra un oráculo
 * independiente calculado por la propia base con DECIMAL exacto (SUM(cantidad*monto)).
 */
const PUERTO = process.env.OP_FONDOS_REP_DB_PORT;
const ESQUEMA = "op_fondos_rep01";

vi.mock("@/lib/db", async () => {
  const mysql = await import("mysql2/promise");
  let pool: ReturnType<typeof mysql.createPool> | null = null;
  const obtener = () => {
    if (!pool) pool = mysql.createPool({ host: "127.0.0.1", port: Number(process.env.OP_FONDOS_REP_DB_PORT), user: "root", password: "", database: "op_fondos_rep01", connectionLimit: 4, timezone: "local" });
    return pool;
  };
  return { getPool: obtener, query: async (sql: string, params: unknown[] = []) => (await obtener().query(sql, params as never))[0] };
});

import mysql from "mysql2/promise";
import { getPool } from "@/lib/db";
import { CATEGORIAS_GASTO } from "./gastos";
import { aCentavos, obtenerReporteGastosPorTipo, reporteSolicitudesFondo, resumirSolicitudesFondo, agruparSolicitudesFondo, resumenMensualFondos } from "./reportes-gastos";

const E1 = 1;
const E2 = 2;

async function sembrar() {
  const admin = await mysql.createConnection({ host: "127.0.0.1", port: Number(PUERTO), user: "root", password: "" });
  await admin.query(`DROP DATABASE IF EXISTS ${ESQUEMA}`);
  await admin.query(`CREATE DATABASE ${ESQUEMA} CHARACTER SET utf8mb4`);
  await admin.end();
  const p = getPool();
  await p.query(`CREATE TABLE tms_solicitudes_fondo (
    id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, codigo VARCHAR(40) NOT NULL, entidad_requirente_nombre VARCHAR(200) NULL,
    requirente_nombre VARCHAR(200) NULL, requirente_usuario_id INT NULL, solicitante_nombre VARCHAR(200) NULL, autorizante_nombre VARCHAR(200) NULL,
    fecha_requerimiento DATE NOT NULL, total DECIMAL(12,2) NOT NULL DEFAULT 0, estado VARCHAR(30) NOT NULL DEFAULT 'Pendiente',
    autorizado_en DATETIME NULL, observaciones VARCHAR(300) NULL, UNIQUE KEY uq (empresa_id, codigo), UNIQUE KEY uq_id (empresa_id, id))`);
  await p.query(`CREATE TABLE tms_solicitud_fondo_lineas (
    id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, solicitud_id INT NOT NULL, categoria VARCHAR(40) NOT NULL, descripcion VARCHAR(300) NULL,
    cantidad DECIMAL(10,2) NOT NULL DEFAULT 1, monto DECIMAL(12,2) NOT NULL, fecha_viaje DATE NULL, empleado_id INT NULL, empleado_nombre VARCHAR(200) NULL,
    cargo VARCHAR(100) NULL, vehiculo_id INT NULL, placa VARCHAR(20) NULL, cliente_id INT NULL, cliente_nombre VARCHAR(200) NULL, plan_id INT NULL,
    orden INT NOT NULL DEFAULT 0, cuenta VARCHAR(80) NULL, metodo_pago VARCHAR(40) NULL)`);

  const sol = async (emp: number, codigo: string, fecha: string, estado: string, total: string) =>
    Number(((await p.query("INSERT INTO tms_solicitudes_fondo (empresa_id, codigo, fecha_requerimiento, estado, total, requirente_nombre) VALUES (?,?,?,?,?,?)", [emp, codigo, fecha, estado, total, "Req"]))[0] as { insertId: number }).insertId);
  const lin = (emp: number, sid: number, cat: string, cant: string, monto: string, extra: { cliente?: number; placa?: string; empleado?: string; viaje?: string } = {}) =>
    p.query("INSERT INTO tms_solicitud_fondo_lineas (empresa_id, solicitud_id, categoria, cantidad, monto, cliente_id, placa, empleado_nombre, fecha_viaje) VALUES (?,?,?,?,?,?,?,?,?)",
      [emp, sid, cat, cant, monto, extra.cliente ?? null, extra.placa ?? null, extra.empleado ?? null, extra.viaje ?? null]);

  const s10 = await sol(E1, "F-10", "2026-09-03", "Autorizada", "501.00");
  await lin(E1, s10, "Combustible", "2.00", "100.50", { cliente: 5, placa: "C-130BQ", empleado: "Heber", viaje: "2026-09-04" });
  await lin(E1, s10, "Hospedaje", "1.00", "300.00", { cliente: 5, placa: "C-130BQ", empleado: "Heber" });
  const s11 = await sol(E1, "F-11", "2026-09-10", "Liquidada", "110.25");
  await lin(E1, s11, "Combustible", "1.00", "50.10", { cliente: 6, placa: "C-200AA", empleado: "Luis" });
  await lin(E1, s11, "Combustible", "3.00", "20.05", { cliente: 6, placa: "C-200AA", empleado: "Luis" });
  const s12 = await sol(E1, "F-12", "2026-09-12", "Pendiente", "75.00");
  await lin(E1, s12, "Hospedaje", "1.00", "75.00");
  const s13 = await sol(E1, "F-13", "2026-10-01", "Rechazada", "1000.00");
  await lin(E1, s13, "Combustible", "1.00", "1000.00", { cliente: 5, placa: "C-130BQ", empleado: "Heber" });
  const s14 = await sol(E1, "F-14", "2026-09-20", "Autorizada", "0.50");
  await lin(E1, s14, "Combustible", "3.00", "0.10");
  await lin(E1, s14, "Combustible", "1.00", "0.20");
  const s15 = await sol(E1, "F-15", "2026-09-21", "Autorizada", "40.00");
  await lin(E1, s15, "Gasolina vieja", "1.00", "40.00"); // categoría histórica fuera del catálogo
  // Otra empresa con los MISMOS códigos: no debe mezclarse nunca.
  const t10 = await sol(E2, "F-10", "2026-09-03", "Autorizada", "9999.00");
  await lin(E2, t10, "Combustible", "1.00", "9999.00", { cliente: 5, placa: "C-130BQ", empleado: "Heber" });
}

/** Oráculo independiente: suma exacta calculada por la BASE (DECIMAL), en centavos. */
async function oraculoCentavos(empresa: number, categoria: string | null, estados: string[] | null): Promise<bigint> {
  const [r] = await getPool().query(
    `SELECT CAST(ROUND(COALESCE(SUM(l.cantidad * l.monto), 0) * 100) AS CHAR) AS c
     FROM tms_solicitud_fondo_lineas l JOIN tms_solicitudes_fondo s ON s.empresa_id = l.empresa_id AND s.id = l.solicitud_id
     WHERE l.empresa_id = ? AND (? IS NULL OR l.categoria = ?) AND (? IS NULL OR s.estado IN (${(estados ?? ["_"]).map(() => "?").join(",")}))`,
    [empresa, categoria, categoria, estados === null ? null : "x", ...(estados ?? ["_"])]);
  return BigInt(String((r as { c: string }[])[0].c));
}

describe.skipIf(!PUERTO)(`BD real desechable (${ESQUEMA})`, () => {
  beforeAll(sembrar, 60000);
  afterAll(async () => { await getPool().end(); });

  it("categoría Combustible: una fila por línea coincidente, sin líneas de otras categorías ni de otra empresa, sin duplicados", async () => {
    const filas = await reporteSolicitudesFondo(E1, { categoria: "Combustible" });
    expect(filas).toHaveLength(6); // F-10 (1) + F-11 (2) + F-13 (1) + F-14 (2)
    expect(new Set(filas.map((f) => f.lineaId)).size).toBe(6);
    expect(filas.every((f) => f.categoria === "Combustible")).toBe(true);
    expect(filas.map((f) => f.solicitudCodigo).sort()).toEqual(["F-10", "F-11", "F-11", "F-13", "F-14", "F-14"]);
    expect(filas.some((f) => f.total === 9999)).toBe(false); // la solicitud F-10 de la empresa 2 no aparece
  });

  it("totales por categoría exactos y por estado real, comparados con un oráculo independiente (DECIMAL de la base)", async () => {
    const filas = await reporteSolicitudesFondo(E1, { categoria: "Combustible" });
    const r = resumirSolicitudesFondo(filas, "Combustible");
    expect(r).toEqual({ categoria: "Combustible", cantidad: 4, totalSolicitado: 1311.75, totalAutorizado: 311.75, totalLiquidado: 110.25, totalRechazado: 1000, totalPendiente: 0 });
    expect(BigInt(Math.round(r.totalSolicitado * 100))).toBe(await oraculoCentavos(E1, "Combustible", null));
    expect(BigInt(Math.round(r.totalAutorizado * 100))).toBe(await oraculoCentavos(E1, "Combustible", ["Autorizada", "Liquidada"]));
    expect(BigInt(Math.round(r.totalLiquidado * 100))).toBe(await oraculoCentavos(E1, "Combustible", ["Liquidada"]));
    expect(BigInt(Math.round(r.totalRechazado * 100))).toBe(await oraculoCentavos(E1, "Combustible", ["Rechazada"]));
    const f14 = filas.filter((f) => f.solicitudCodigo === "F-14");
    expect(f14.map((f) => f.subtotalCategoria)).toEqual([0.5, 0.5]); // 3 × 0.10 + 0.20, exacto
  });

  it("subtotal de categoría ≠ total de la solicitud cuando la solicitud tiene otras categorías (F-10: 201.00 de 501.00)", async () => {
    const filas = await reporteSolicitudesFondo(E1, { categoria: "Combustible" });
    const f10 = filas.find((f) => f.solicitudCodigo === "F-10")!;
    expect([f10.subtotalCategoria, f10.totalSolicitud]).toEqual([201, 501]);
    const hosp = await reporteSolicitudesFondo(E1, { categoria: "Hospedaje" });
    expect(hosp.find((f) => f.solicitudCodigo === "F-10")!.subtotalCategoria).toBe(300);
  });

  it("solicitud con varias líneas de la misma categoría: 2 filas, 1 solicitud, un solo subtotal", async () => {
    const filas = await reporteSolicitudesFondo(E1, { categoria: "Combustible" });
    const f11 = filas.filter((f) => f.solicitudCodigo === "F-11");
    expect(f11).toHaveLength(2);
    expect(new Set(f11.map((f) => f.subtotalCategoria))).toEqual(new Set([110.25]));
    expect(resumirSolicitudesFondo(filas, "Combustible").cantidad).toBe(4);
  });

  it("filtros combinados (fecha solicitud + cliente + placa + empleado + estado + categoría) se interseccionan", async () => {
    const filas = await reporteSolicitudesFondo(E1, {
      categoria: "Combustible", fechaSolicitudDesde: "2026-09-01", fechaSolicitudHasta: "2026-09-30", clienteId: 5, placa: "C-130BQ", empleadoNombre: "Heber", estadoFondo: "Autorizada",
    });
    expect(filas.map((f) => f.solicitudCodigo)).toEqual(["F-10"]);
    expect(filas[0].subtotalCategoria).toBe(201);
    const vacia = await reporteSolicitudesFondo(E1, { categoria: "Hospedaje", clienteId: 6 });
    expect(vacia).toEqual([]);
  });

  it("fecha de viaje + categoría: solo la línea con esa fecha", async () => {
    const filas = await reporteSolicitudesFondo(E1, { categoria: "Combustible", fechaViajeDesde: "2026-09-04", fechaViajeHasta: "2026-09-04" });
    expect(filas.map((f) => f.lineaId).length).toBe(1);
    expect(filas[0].solicitudCodigo).toBe("F-10");
  });

  it("sin categoría: comportamiento anterior (todas las líneas, total de cabecera, sin campos nuevos de resumen)", async () => {
    const r = await obtenerReporteGastosPorTipo(E1, "fondos", {});
    if (r.tipo !== "fondos") throw new Error("tipo");
    expect(r.filas).toHaveLength(9); // 2 + 2 + 1 + 1 + 2 + 1 = todas las líneas de la empresa 1
    expect(r.filas.every((f) => f.subtotalCategoria === undefined)).toBe(true);
    expect(r.resumen).toEqual({ cantidad: 6, totalSolicitado: 501 + 110.25 + 75 + 1000 + 0.5 + 40, totalAutorizado: 501 + 110.25 + 0.5 + 40, totalLiquidado: 110.25, totalRechazado: 1000 });
  });

  it("consistencia entre categorías: la suma de los subtotales de todas las categorías del catálogo + histórica = suma de todas las líneas", async () => {
    let acumulado = BigInt(0);
    for (const c of [...CATEGORIAS_GASTO, "Gasolina vieja"]) {
      const r = resumirSolicitudesFondo(await reporteSolicitudesFondo(E1, { categoria: c as string }), c);
      acumulado += BigInt(Math.round(r.totalSolicitado * 100));
    }
    expect(acumulado).toBe(await oraculoCentavos(E1, null, null));
  });

  it("categoría histórica fuera del catálogo: aparece sin filtro con su texto original; el filtro de catálogo no la toca y no se modifica ningún dato", async () => {
    const sinFiltro = await reporteSolicitudesFondo(E1, {});
    expect(sinFiltro.find((f) => f.solicitudCodigo === "F-15")!.categoria).toBe("Gasolina vieja");
    expect((CATEGORIAS_GASTO as readonly string[]).includes("Gasolina vieja")).toBe(false);
    const [antes] = await getPool().query("SELECT COUNT(*) AS n, SUM(monto) AS s FROM tms_solicitud_fondo_lineas WHERE empresa_id = ?", [E1]);
    await reporteSolicitudesFondo(E1, { categoria: "Combustible" });
    const [despues] = await getPool().query("SELECT COUNT(*) AS n, SUM(monto) AS s FROM tms_solicitud_fondo_lineas WHERE empresa_id = ?", [E1]);
    expect(despues).toEqual(antes);
  });

  it("aislamiento por empresa: la empresa 2 solo ve lo suyo, con el mismo código de solicitud", async () => {
    const f2 = await reporteSolicitudesFondo(E2, { categoria: "Combustible" });
    expect(f2.map((f) => [f.solicitudCodigo, f.total])).toEqual([["F-10", 9999]]);
    expect(resumirSolicitudesFondo(f2, "Combustible").totalSolicitado).toBe(9999);
  });

  it("resumen mensual (PDF): total del mes con categoría = autorizado del resumen (F-10 201.00 + F-11 110.25 + F-14 0.50)", async () => {
    const filas = await reporteSolicitudesFondo(E1, { categoria: "Combustible", fechaSolicitudDesde: "2026-09-01", fechaSolicitudHasta: "2026-09-30" });
    const grupos = agruparSolicitudesFondo(filas);
    const mes = resumenMensualFondos(grupos, "Combustible");
    expect(mes.totalGeneral).toBe(311.75);
    expect(mes.totalGeneral).toBe(resumirSolicitudesFondo(filas, "Combustible").totalAutorizado);
    expect(aCentavos(BigInt(31175 * 100))).toBe(BigInt(31175));
  });

  it("sin paginación en el reporte: con 600 líneas devuelve las 600 y el resumen suma las 600 (conjunto único para pantalla, Excel y PDF)", async () => {
    const [res] = await getPool().query("INSERT INTO tms_solicitudes_fondo (empresa_id, codigo, fecha_requerimiento, estado, total) VALUES (?, 'F-BIG', '2026-11-01', 'Autorizada', 600.00)", [E1]);
    const sid = (res as { insertId: number }).insertId;
    const valores = Array.from({ length: 600 }, () => [E1, sid, "Parqueo", "1.00", "1.00"]);
    await getPool().query("INSERT INTO tms_solicitud_fondo_lineas (empresa_id, solicitud_id, categoria, cantidad, monto) VALUES ?", [valores]);
    const filas = await reporteSolicitudesFondo(E1, { categoria: "Parqueo" });
    expect(filas).toHaveLength(600);
    expect(resumirSolicitudesFondo(filas, "Parqueo")).toMatchObject({ cantidad: 1, totalSolicitado: 600, totalAutorizado: 600 });
  });
});
