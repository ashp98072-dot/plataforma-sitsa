import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock("@/lib/db", () => ({
  getPool: () => {
    if (!holder.pool) throw new Error("Sin conexión local fixture");
    return holder.pool;
  },
  // Mismo contrato que `query` de @/lib/db: devuelve solo las filas.
  query: async (texto: string, params: unknown[] = []) => {
    if (!holder.pool) throw new Error("Sin conexión local fixture");
    return (await holder.pool.query(texto, params))[0];
  },
}));

import {
  configurarFechaActivacionLiquidacion,
  confirmarReporteRecibido,
  leerLiquidacionPlan,
  liquidacionesDePlanes,
  liquidarViaje,
  listarEventosLiquidacion,
  obtenerFechaActivacionLiquidacion,
  reabrirLiquidacion,
  type ActorLiquidacion,
} from "./liquidacion-viaje";
import { liquidacionExigidaParaPlan } from "./liquidacion-viaje-shared";
import { confirmarReporteOperativo, evaluarAdvertenciasReporte } from "./liquidacion-viaje-reporte";

/**
 * Fase 1 de liquidación contra MariaDB 11.8.9 DESECHABLE. Se OMITE salvo que exista LIQ_TEST_DB_PORT (3399 o 3407, solo
 * local). Ejecuta el código REAL del módulo y el SQL REAL de la migración (dos veces). Datos 100 % sintéticos.
 *   LIQ_TEST_DB_PORT=3399 npx vitest run src/lib/tms/liquidacion-viaje.db.test.ts --no-file-parallelism
 */
const port = Number(process.env.LIQ_TEST_DB_PORT ?? 0);
const database = `liq1_test_${randomUUID().replaceAll("-", "")}`;
const A: ActorLiquidacion = { empresaId: 7, usuarioId: 4, usuario: "ana" };
const B: ActorLiquidacion = { empresaId: 7, usuarioId: 5, usuario: "beto" };
const OTRA: ActorLiquidacion = { empresaId: 8, usuarioId: 6, usuario: "carla" };
let sigPlan = 100;

const sql = async <T extends RowDataPacket = RowDataPacket>(t: string, p: unknown[] = []): Promise<T[]> => (await holder.pool!.query<T[]>(t, p))[0];
const conteo = async (tabla: string, where = "1=1", p: unknown[] = []) =>
  Number((await sql(`SELECT COUNT(*) AS n FROM ${tabla} WHERE ${where}`, p))[0].n);

async function plan(delta: { empresa?: number; estado?: string; fecha?: string; tarifa?: number | null } = {}) {
  const id = sigPlan++;
  await holder.pool!.execute(
    "INSERT INTO tms_planes_viaje (id, empresa_id, codigo, estado, fecha_plan, tarifa_comercial) VALUES (?, ?, ?, ?, ?, ?)",
    [id, delta.empresa ?? 7, `PLAN-${id}`, delta.estado ?? "Programado", delta.fecha ?? "2026-10-14", delta.tarifa === undefined ? 100 : delta.tarifa],
  );
  return id;
}
const filaPlan = async (id: number) => (await sql("SELECT * FROM tms_planes_viaje WHERE id = ?", [id]))[0];
const codigo = (p: Promise<unknown>) => p.then(() => "OK", (e: { codigoLiquidacion?: string }) => e.codigoLiquidacion ?? "ERROR");

describe.skipIf(!port)("Liquidación de viajes Fase 1 / MariaDB 11.8.9 SOLO LOCAL", () => {
  beforeAll(async () => {
    if (![3399, 3407].includes(port)) throw new Error("Solo puertos locales desechables 3399/3407");
    const c = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "", multipleStatements: true });
    try {
      const [v] = await c.query<RowDataPacket[]>("SELECT VERSION() AS v");
      expect(String(v[0].v)).toContain("11.8.9");
      await c.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci`);
      await c.query(`USE ${database}`);
      await c.query(`
        CREATE TABLE empresas(id INT PRIMARY KEY) ENGINE=InnoDB;
        CREATE TABLE usuarios(id INT PRIMARY KEY, username VARCHAR(100)) ENGINE=InnoDB;
        CREATE TABLE tms_planes_viaje(id INT PRIMARY KEY, empresa_id INT NOT NULL, codigo VARCHAR(80) NOT NULL,
          estado VARCHAR(40) NOT NULL, fecha_plan DATE NOT NULL, tarifa_comercial DECIMAL(12,2) NULL,
          UNIQUE KEY uq_tmsplanes_empresa_id (empresa_id, id)) ENGINE=InnoDB;
        CREATE TABLE auditoria(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT, usuario VARCHAR(100), accion VARCHAR(100), modulo VARCHAR(100), detalle TEXT) ENGINE=InnoDB;
        CREATE TABLE flota_viajes(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, plan_id INT NULL,
          estado VARCHAR(20) NOT NULL DEFAULT 'abierto', km_salida INT NULL, km_llegada INT NULL) ENGINE=InnoDB;
        CREATE TABLE tms_solicitud_fondo_lineas(id INT AUTO_INCREMENT PRIMARY KEY, plan_id INT) ENGINE=InnoDB;
        CREATE TABLE tms_gastos_operativos(id INT AUTO_INCREMENT PRIMARY KEY, plan_id INT) ENGINE=InnoDB;
        CREATE TABLE tms_plan_cuadrilla(id INT AUTO_INCREMENT PRIMARY KEY, plan_id INT) ENGINE=InnoDB;
        CREATE TABLE fact_factura_viajes(id INT AUTO_INCREMENT PRIMARY KEY, plan_id INT) ENGINE=InnoDB;
        CREATE TABLE fel_documentos(id INT AUTO_INCREMENT PRIMARY KEY) ENGINE=InnoDB;
        CREATE TABLE cont_eventos(id INT AUTO_INCREMENT PRIMARY KEY) ENGINE=InnoDB;
        INSERT INTO empresas VALUES (7),(8);
        INSERT INTO usuarios VALUES (4,'ana'),(5,'beto'),(6,'carla');
      `);
      const ddl = readFileSync("sql/migrate-2026-10-tms-liquidacion-viajes-fase1.sql", "utf8");
      await c.query(ddl);
      // Instalación inicial: sin datos (sin seeds ni backfill).
      for (const t of ["tms_liquidacion_config", "tms_viaje_liquidaciones", "tms_viaje_liquidacion_eventos"]) {
        const [n] = await c.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${t}`);
        expect(Number(n[0].n)).toBe(0);
      }
      await c.query(ddl); // segunda ejecución: NOOP
    } finally {
      await c.end();
    }
    holder.pool = mysql.createPool({ host: "127.0.0.1", port, user: "root", password: "", database, connectionLimit: 12 });
  });

  afterAll(async () => {
    await holder.pool?.end(); // Sin DROP: base desechable recuperable.
  });

  // ───────────────────────────────────── ciclo de vida ─────────────────────────────────────
  it("1-6. confirmar → LIQUIDADO → EN_AJUSTE → LIQUIDADO: estados, versiones 1..4 y eventos append-only", async () => {
    const p = await plan();
    const antesPlan = await filaPlan(p);
    expect(await leerLiquidacionPlan(7, p)).toBeNull(); // ausencia de fila = sin liquidación registrada

    const c = await confirmarReporteRecibido(A, { planId: p, observacion: "  Reporte completo  " });
    expect(c).toMatchObject({ evento: "REPORTE_RECIBIDO", idempotente: false, liquidacion: { estado: "REPORTE_RECIBIDO", version: 1, reporteRecibidoPor: 4 } });
    expect(c.liquidacion.liquidadoEn).toBeNull();

    const l = await liquidarViaje(B, { planId: p, versionEsperada: 1 });
    expect(l).toMatchObject({ evento: "LIQUIDADO", liquidacion: { estado: "LIQUIDADO", version: 2, liquidadoPor: 5 } });

    const r = await reabrirLiquidacion(A, { planId: p, versionEsperada: 2, motivo: "  Falta cargo de espera  " });
    expect(r).toMatchObject({ evento: "REABIERTO", liquidacion: { estado: "EN_AJUSTE", version: 3, reabiertoPor: 4, liquidadoPor: 5 } });

    const rl = await liquidarViaje(B, { planId: p, versionEsperada: 3 });
    expect(rl).toMatchObject({ evento: "RELIQUIDADO", liquidacion: { estado: "LIQUIDADO", version: 4, liquidadoPor: 5, reabiertoPor: 4 } });

    const ev = await listarEventosLiquidacion(7, p);
    expect(ev.map((e) => [e.version, e.tipo, e.estadoAntes, e.estadoDespues, e.actorId])).toEqual([
      [1, "REPORTE_RECIBIDO", null, "REPORTE_RECIBIDO", 4],
      [2, "LIQUIDADO", "REPORTE_RECIBIDO", "LIQUIDADO", 5],
      [3, "REABIERTO", "LIQUIDADO", "EN_AJUSTE", 4],
      [4, "RELIQUIDADO", "EN_AJUSTE", "LIQUIDADO", 5],
    ]);
    expect(ev[0].detalle).toBe("Reporte completo");
    expect(ev[2].detalle).toBe("Falta cargo de espera");
    expect(ev[0].snapshot).toEqual({ planEstado: "Programado", fechaPlan: "2026-10-14", tarifaComercial: "100.00" });
    // El estado operativo del viaje NO se modifica en ningún momento.
    expect(await filaPlan(p)).toEqual(antesPlan);
    // Auditoría: una por transición.
    expect(await conteo("auditoria", "accion LIKE 'liquidacion_viaje_%' AND detalle LIKE ?", [`Plan #${p} %`])).toBe(4);
  });

  it("confirmar es idempotente: segunda confirmación no crea evento ni cambia la versión", async () => {
    const p = await plan();
    await confirmarReporteRecibido(A, { planId: p });
    const otra = await confirmarReporteRecibido(B, { planId: p });
    expect(otra).toMatchObject({ idempotente: true, evento: null, liquidacion: { version: 1, reporteRecibidoPor: 4 } });
    expect(await conteo("tms_viaje_liquidacion_eventos", "plan_id = ?", [p])).toBe(1);
  });

  it("7. la reapertura exige motivo (≥ 5, ≤ 500) y no deja rastro si se rechaza", async () => {
    const p = await plan();
    await confirmarReporteRecibido(A, { planId: p });
    await liquidarViaje(A, { planId: p, versionEsperada: 1 });
    for (const motivo of ["", "    ", "abcd", " a b "]) {
      expect(await codigo(reabrirLiquidacion(A, { planId: p, versionEsperada: 2, motivo }))).toBe("SOLICITUD_INVALIDA");
    }
    expect(await codigo(reabrirLiquidacion(A, { planId: p, versionEsperada: 2, motivo: "x".repeat(501) }))).toBe("SOLICITUD_INVALIDA");
    expect((await leerLiquidacionPlan(7, p))!.version).toBe(2);
    expect(await conteo("tms_viaje_liquidacion_eventos", "plan_id = ?", [p])).toBe(2);
    // Y la BD lo exige también (CHECK), aunque alguien omita el servicio:
    await expect(holder.pool!.execute(
      "INSERT INTO tms_viaje_liquidacion_eventos (empresa_id, plan_id, version, tipo, estado_antes, estado_despues, actor_id, detalle) VALUES (7, ?, 3, 'REABIERTO', 'LIQUIDADO', 'EN_AJUSTE', 4, 'abc')",
      [p],
    )).rejects.toThrow();
  });

  it("transiciones inválidas: solo se reabre LIQUIDADO, solo se liquida REPORTE_RECIBIDO/EN_AJUSTE, y sin versión no hay operación", async () => {
    const p = await plan();
    expect(await codigo(liquidarViaje(A, { planId: p, versionEsperada: 1 }))).toBe("NO_ENCONTRADO"); // sin reporte
    expect(await codigo(reabrirLiquidacion(A, { planId: p, versionEsperada: 1, motivo: "motivo valido" }))).toBe("NO_ENCONTRADO");
    await confirmarReporteRecibido(A, { planId: p });
    expect(await codigo(reabrirLiquidacion(A, { planId: p, versionEsperada: 1, motivo: "motivo valido" }))).toBe("ESTADO_NO_PERMITE");
    expect(await codigo(liquidarViaje(A, { planId: p, versionEsperada: 0 }))).toBe("SOLICITUD_INVALIDA");
    expect(await codigo(liquidarViaje(A, { planId: p, versionEsperada: 1.5 }))).toBe("SOLICITUD_INVALIDA");
    await liquidarViaje(A, { planId: p, versionEsperada: 1 });
    expect(await codigo(confirmarReporteRecibido(A, { planId: p }))).toBe("ESTADO_NO_PERMITE");
    expect(await codigo(liquidarViaje(B, { planId: p, versionEsperada: 2 }))).toBe("ESTADO_NO_PERMITE"); // ya liquidado
    await reabrirLiquidacion(A, { planId: p, versionEsperada: 2, motivo: "motivo valido" });
    expect(await codigo(reabrirLiquidacion(B, { planId: p, versionEsperada: 3, motivo: "otra vez" }))).toBe("ESTADO_NO_PERMITE"); // ya en ajuste
  });

  it("viajes Cerrado/Cancelado no admiten transiciones (el cierre es final) y no pierden su liquidación", async () => {
    const p = await plan();
    await confirmarReporteRecibido(A, { planId: p });
    await liquidarViaje(A, { planId: p, versionEsperada: 1 });
    await holder.pool!.execute("UPDATE tms_planes_viaje SET estado = 'Cerrado' WHERE id = ?", [p]);
    expect(await codigo(reabrirLiquidacion(A, { planId: p, versionEsperada: 2, motivo: "motivo valido" }))).toBe("PLAN_NO_ADMITE");
    expect(await codigo(liquidarViaje(A, { planId: p, versionEsperada: 2 }))).toBe("PLAN_NO_ADMITE");
    expect((await leerLiquidacionPlan(7, p))!.estado).toBe("LIQUIDADO");
    const cancelado = await plan({ estado: "Cancelado" });
    expect(await codigo(confirmarReporteRecibido(A, { planId: cancelado }))).toBe("PLAN_NO_ADMITE");
    expect(await leerLiquidacionPlan(7, cancelado)).toBeNull();
  });

  // ───────────────────────────────────── aislamiento y modelo ─────────────────────────────────────
  it("8. aislamiento por empresa: otra empresa no ve ni toca el viaje", async () => {
    const p = await plan();
    await confirmarReporteRecibido(A, { planId: p });
    expect(await codigo(confirmarReporteRecibido(OTRA, { planId: p }))).toBe("NO_ENCONTRADO");
    expect(await codigo(liquidarViaje(OTRA, { planId: p, versionEsperada: 1 }))).toBe("NO_ENCONTRADO");
    expect(await codigo(reabrirLiquidacion(OTRA, { planId: p, versionEsperada: 1, motivo: "motivo valido" }))).toBe("NO_ENCONTRADO");
    expect(await leerLiquidacionPlan(8, p)).toBeNull();
    expect(await listarEventosLiquidacion(8, p)).toEqual([]);
    expect(await conteo("tms_viaje_liquidaciones", "plan_id = ? AND empresa_id = 8", [p])).toBe(0);
    // y un viaje de OTRA no se confirma desde A
    const ajeno = await plan({ empresa: 8 });
    expect(await codigo(confirmarReporteRecibido(A, { planId: ajeno }))).toBe("NO_ENCONTRADO");
  });

  it("9. UNIQUE 1:1 por viaje y FK compuesta: un segundo registro o un plan de otra empresa se rechazan en BD", async () => {
    const p = await plan();
    await confirmarReporteRecibido(A, { planId: p });
    await expect(holder.pool!.execute(
      "INSERT INTO tms_viaje_liquidaciones (empresa_id, plan_id, estado, version, reporte_recibido_en, reporte_recibido_por) VALUES (7, ?, 'REPORTE_RECIBIDO', 1, NOW(), 4)", [p],
    )).rejects.toThrow();
    const ajeno = await plan({ empresa: 8 });
    await expect(holder.pool!.execute(
      "INSERT INTO tms_viaje_liquidaciones (empresa_id, plan_id, estado, version, reporte_recibido_en, reporte_recibido_por) VALUES (7, ?, 'REPORTE_RECIBIDO', 1, NOW(), 4)", [ajeno],
    )).rejects.toThrow();
  });

  it("CHECKs: estado inválido, marcas incoherentes y transición de evento inválida se rechazan", async () => {
    const p = await plan();
    const ins = (estado: string, extra = "", cols = "") =>
      holder.pool!.execute(
        `INSERT INTO tms_viaje_liquidaciones (empresa_id, plan_id, estado, version, reporte_recibido_en, reporte_recibido_por${cols}) VALUES (7, ?, ?, 1, NOW(), 4${extra})`,
        [p, estado],
      );
    await expect(ins("CERRADO")).rejects.toThrow();
    await expect(ins("LIQUIDADO")).rejects.toThrow(); // sin liquidado_en
    await expect(ins("EN_AJUSTE", ", NOW(), 4", ", liquidado_en, liquidado_por")).rejects.toThrow(); // sin reabierto_en
    await expect(ins("REPORTE_RECIBIDO", ", NOW(), 4", ", liquidado_en, liquidado_por")).rejects.toThrow(); // liquidado antes de tiempo
    await expect(holder.pool!.execute(
      "INSERT INTO tms_viaje_liquidaciones (empresa_id, plan_id, estado, version, reporte_recibido_en, reporte_recibido_por) VALUES (7, ?, 'REPORTE_RECIBIDO', 0, NOW(), 4)", [p],
    )).rejects.toThrow(); // version >= 1
    await confirmarReporteRecibido(A, { planId: p });
    await expect(holder.pool!.execute(
      "INSERT INTO tms_viaje_liquidacion_eventos (empresa_id, plan_id, version, tipo, estado_antes, estado_despues, actor_id) VALUES (7, ?, 2, 'LIQUIDADO', 'EN_AJUSTE', 'LIQUIDADO', 4)", [p],
    )).rejects.toThrow();
    await expect(holder.pool!.execute(
      "INSERT INTO tms_viaje_liquidacion_eventos (empresa_id, plan_id, version, tipo, estado_antes, estado_despues, actor_id) VALUES (7, ?, 1, 'REPORTE_RECIBIDO', NULL, 'REPORTE_RECIBIDO', 4)", [p],
    )).rejects.toThrow(); // misma versión: UNIQUE
  });

  it("los eventos no se pueden perder: borrar la liquidación o el viaje con historia falla (RESTRICT)", async () => {
    const p = await plan();
    await confirmarReporteRecibido(A, { planId: p });
    await expect(holder.pool!.execute("DELETE FROM tms_viaje_liquidaciones WHERE plan_id = ?", [p])).rejects.toThrow();
    await expect(holder.pool!.execute("DELETE FROM tms_planes_viaje WHERE id = ?", [p])).rejects.toThrow();
    expect(await conteo("tms_viaje_liquidacion_eventos", "plan_id = ?", [p])).toBe(1);
  });

  // ───────────────────────────────────── concurrencia real ─────────────────────────────────────
  it("10a. dos confirmaciones simultáneas: una fila, un evento, ambas terminan bien (una idempotente)", async () => {
    const p = await plan();
    const r = await Promise.all([confirmarReporteRecibido(A, { planId: p }), confirmarReporteRecibido(B, { planId: p })]);
    expect(r.filter((x) => x.idempotente)).toHaveLength(1);
    expect(r.filter((x) => x.evento === "REPORTE_RECIBIDO")).toHaveLength(1);
    expect(await conteo("tms_viaje_liquidaciones", "plan_id = ?", [p])).toBe(1);
    expect(await conteo("tms_viaje_liquidacion_eventos", "plan_id = ?", [p])).toBe(1);
  });

  it("10b. diez confirmaciones simultáneas: una sola fila y un solo evento", async () => {
    const p = await plan();
    await Promise.all(Array.from({ length: 10 }, (_, i) => confirmarReporteRecibido(i % 2 ? A : B, { planId: p })));
    expect(await conteo("tms_viaje_liquidaciones", "plan_id = ?", [p])).toBe(1);
    expect(await conteo("tms_viaje_liquidacion_eventos", "plan_id = ?", [p])).toBe(1);
  });

  it("10c. dos liquidaciones simultáneas de actores distintos: una gana y la otra recibe conflicto/estado", async () => {
    const p = await plan();
    await confirmarReporteRecibido(A, { planId: p });
    const r = await Promise.allSettled([liquidarViaje(A, { planId: p, versionEsperada: 1 }), liquidarViaje(B, { planId: p, versionEsperada: 1 })]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const rechazo = r.find((x) => x.status === "rejected") as PromiseRejectedResult;
    expect(["CONFLICTO_VERSION", "ESTADO_NO_PERMITE"]).toContain(rechazo.reason.codigoLiquidacion);
    expect((await leerLiquidacionPlan(7, p))).toMatchObject({ estado: "LIQUIDADO", version: 2 });
    expect(await conteo("tms_viaje_liquidacion_eventos", "plan_id = ? AND tipo = 'LIQUIDADO'", [p])).toBe(1);
  });

  it("10d. doble clic del MISMO actor al liquidar: una transición y la réplica es idempotente", async () => {
    const p = await plan();
    await confirmarReporteRecibido(A, { planId: p });
    const r = await Promise.all([liquidarViaje(A, { planId: p, versionEsperada: 1 }), liquidarViaje(A, { planId: p, versionEsperada: 1 })]);
    expect(r.filter((x) => x.idempotente)).toHaveLength(1);
    expect(await conteo("tms_viaje_liquidacion_eventos", "plan_id = ? AND tipo = 'LIQUIDADO'", [p])).toBe(1);
    expect((await leerLiquidacionPlan(7, p))!.version).toBe(2);
  });

  it("10e. reapertura concurrente por dos actores: una sola reapertura efectiva", async () => {
    const p = await plan();
    await confirmarReporteRecibido(A, { planId: p });
    await liquidarViaje(A, { planId: p, versionEsperada: 1 });
    const r = await Promise.allSettled([
      reabrirLiquidacion(A, { planId: p, versionEsperada: 2, motivo: "motivo de A" }),
      reabrirLiquidacion(B, { planId: p, versionEsperada: 2, motivo: "motivo de B" }),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(await conteo("tms_viaje_liquidacion_eventos", "plan_id = ? AND tipo = 'REABIERTO'", [p])).toBe(1);
    expect((await leerLiquidacionPlan(7, p))).toMatchObject({ estado: "EN_AJUSTE", version: 3 });
  });

  it("10f. relíquido con versión vieja se rechaza; con la versión vigente procede", async () => {
    const p = await plan();
    await confirmarReporteRecibido(A, { planId: p });
    await liquidarViaje(A, { planId: p, versionEsperada: 1 });
    await reabrirLiquidacion(A, { planId: p, versionEsperada: 2, motivo: "motivo valido" });
    expect(await codigo(liquidarViaje(B, { planId: p, versionEsperada: 2 }))).toBe("CONFLICTO_VERSION");
    expect(await codigo(liquidarViaje(B, { planId: p, versionEsperada: 1 }))).toBe("CONFLICTO_VERSION");
    expect((await leerLiquidacionPlan(7, p))).toMatchObject({ estado: "EN_AJUSTE", version: 3 });
    expect(await codigo(liquidarViaje(B, { planId: p, versionEsperada: 3 }))).toBe("OK");
    expect((await leerLiquidacionPlan(7, p))).toMatchObject({ estado: "LIQUIDADO", version: 4 });
  });

  it("10g. carrera de liquidar vs reabrir con la misma versión: exactamente una transición", async () => {
    const p = await plan();
    await confirmarReporteRecibido(A, { planId: p });
    await liquidarViaje(A, { planId: p, versionEsperada: 1 });
    await reabrirLiquidacion(A, { planId: p, versionEsperada: 2, motivo: "motivo valido" });
    const r = await Promise.allSettled([
      liquidarViaje(B, { planId: p, versionEsperada: 3 }),
      reabrirLiquidacion(A, { planId: p, versionEsperada: 3, motivo: "otro motivo" }),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const l = (await leerLiquidacionPlan(7, p))!;
    expect(l.version).toBe(4);
    expect(await conteo("tms_viaje_liquidacion_eventos", "plan_id = ?", [p])).toBe(4);
  });

  // ───────────────────────────────────── activación, sin backfill y alcance ─────────────────────────────────────
  it("11-12. fecha de activación: nullable, por empresa, auditada; sin fecha la liquidación no se exige", async () => {
    expect(await obtenerFechaActivacionLiquidacion(7)).toBeNull();
    expect(liquidacionExigidaParaPlan(await obtenerFechaActivacionLiquidacion(7), "2026-10-14")).toBe(false);
    expect(await configurarFechaActivacionLiquidacion(A, "2026-11-01")).toEqual({ anterior: null, actual: "2026-11-01" });
    expect(await obtenerFechaActivacionLiquidacion(7)).toBe("2026-11-01");
    expect(await obtenerFechaActivacionLiquidacion(8)).toBeNull(); // otra empresa no cambia
    expect(liquidacionExigidaParaPlan(await obtenerFechaActivacionLiquidacion(7), "2026-10-31")).toBe(false);
    expect(liquidacionExigidaParaPlan(await obtenerFechaActivacionLiquidacion(7), "2026-11-01")).toBe(true);
    expect(await codigo(configurarFechaActivacionLiquidacion(A, "2026-02-30"))).toBe("SOLICITUD_INVALIDA");
    expect(await configurarFechaActivacionLiquidacion(B, "2026-12-01")).toEqual({ anterior: "2026-11-01", actual: "2026-12-01" });
    expect(await configurarFechaActivacionLiquidacion(B, null)).toEqual({ anterior: "2026-12-01", actual: null });
    expect(await obtenerFechaActivacionLiquidacion(7)).toBeNull();
    expect(await conteo("auditoria", "accion = 'liquidacion_viaje_configurar_activacion' AND empresa_id = 7")).toBe(4 - 1); // la inválida no audita
  });

  it("13. sin backfill: tener fecha de activación NO crea ni marca liquidaciones de viajes existentes", async () => {
    const historicos = [await plan({ estado: "Cerrado", fecha: "2026-01-10" }), await plan({ estado: "Descargado", fecha: "2026-02-10" }), await plan()];
    const antes = await conteo("tms_viaje_liquidaciones");
    await configurarFechaActivacionLiquidacion(A, "2026-01-01");
    expect(await conteo("tms_viaje_liquidaciones")).toBe(antes);
    for (const p of historicos) expect(await leerLiquidacionPlan(7, p)).toBeNull();
    await configurarFechaActivacionLiquidacion(A, null);
  });

  it("14-18. las operaciones no tocan cierre, facturación, fondos, gastos, cuadrilla, FEL ni contabilidad", async () => {
    const p = await plan();
    await holder.pool!.execute("INSERT INTO tms_solicitud_fondo_lineas (plan_id) VALUES (?)", [p]);
    await holder.pool!.execute("INSERT INTO tms_gastos_operativos (plan_id) VALUES (?)", [p]);
    await holder.pool!.execute("INSERT INTO tms_plan_cuadrilla (plan_id) VALUES (?)", [p]);
    const tablas = ["tms_solicitud_fondo_lineas", "tms_gastos_operativos", "tms_plan_cuadrilla", "fact_factura_viajes", "fel_documentos", "cont_eventos"];
    const foto = async () => JSON.stringify(await Promise.all(tablas.map((t) => sql(`SELECT * FROM ${t} ORDER BY id`))));
    const antesTablas = await foto();
    const antesPlan = await filaPlan(p);
    await confirmarReporteRecibido(A, { planId: p });
    await liquidarViaje(A, { planId: p, versionEsperada: 1 });
    await reabrirLiquidacion(A, { planId: p, versionEsperada: 2, motivo: "motivo valido" });
    await liquidarViaje(A, { planId: p, versionEsperada: 3 });
    expect(await foto()).toBe(antesTablas);
    expect(await filaPlan(p)).toEqual(antesPlan);
    // El viaje sigue «Programado»: ni cierra ni cambia por estar LIQUIDADO.
    expect((await filaPlan(p)).estado).toBe("Programado");
  });

  it("segunda migración es NOOP: conserva liquidaciones, eventos y configuración", async () => {
    const antes = {
      l: await sql("SELECT * FROM tms_viaje_liquidaciones ORDER BY id"),
      e: await sql("SELECT * FROM tms_viaje_liquidacion_eventos ORDER BY id"),
      c: await sql("SELECT * FROM tms_liquidacion_config ORDER BY empresa_id"),
    };
    expect(antes.l.length).toBeGreaterThan(0);
    const c = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "", database, multipleStatements: true });
    try {
      await c.query(readFileSync("sql/migrate-2026-10-tms-liquidacion-viajes-fase1.sql", "utf8"));
    } finally {
      await c.end();
    }
    expect(await sql("SELECT * FROM tms_viaje_liquidaciones ORDER BY id")).toEqual(antes.l);
    expect(await sql("SELECT * FROM tms_viaje_liquidacion_eventos ORDER BY id")).toEqual(antes.e);
    expect(await sql("SELECT * FROM tms_liquidacion_config ORDER BY empresa_id")).toEqual(antes.c);
  });

  it("invariantes de verify: cada liquidación tiene su evento vigente, sin huecos y con estado coherente", async () => {
    expect(await sql(`SELECT l.id FROM tms_viaje_liquidaciones l LEFT JOIN tms_viaje_liquidacion_eventos e
      ON e.empresa_id=l.empresa_id AND e.plan_id=l.plan_id AND e.version=l.version WHERE e.id IS NULL`)).toEqual([]);
    expect(await sql(`SELECT e.id FROM tms_viaje_liquidacion_eventos e LEFT JOIN tms_viaje_liquidacion_eventos p
      ON p.empresa_id=e.empresa_id AND p.plan_id=e.plan_id AND p.version=e.version-1 WHERE e.version>1 AND p.id IS NULL`)).toEqual([]);
    expect(await sql(`SELECT l.id FROM tms_viaje_liquidaciones l JOIN tms_viaje_liquidacion_eventos e
      ON e.empresa_id=l.empresa_id AND e.plan_id=l.plan_id AND e.version=l.version WHERE e.estado_despues<>l.estado`)).toEqual([]);
  });

  // ───────────────────────────── FASE 2: reporte recibido desde Planes/Viajes ─────────────────────────────
  const viajeFisico = async (planId: number, estado: "abierto" | "cerrado", empresa = 7) =>
    holder.pool!.execute("INSERT INTO flota_viajes (empresa_id, plan_id, estado, km_salida, km_llegada) VALUES (?, ?, ?, 100, ?)", [empresa, planId, estado, estado === "cerrado" ? 180 : null]);

  it("F2-1. advertencias: sin salida, sin llegada y sin advertencias; Cerrado/Cancelado y otra empresa fallan sin advertir", async () => {
    const p = await plan();
    expect((await evaluarAdvertenciasReporte(7, p)).map((a) => a.codigo)).toEqual(["SIN_SALIDA_REGISTRADA"]);
    await viajeFisico(p, "abierto");
    expect((await evaluarAdvertenciasReporte(7, p)).map((a) => a.codigo)).toEqual(["SIN_LLEGADA_REGISTRADA"]);
    await holder.pool!.execute("UPDATE flota_viajes SET estado = 'cerrado', km_llegada = 150 WHERE plan_id = ?", [p]);
    expect(await evaluarAdvertenciasReporte(7, p)).toEqual([]);
    const cerrado = await plan({ estado: "Cerrado" });
    expect(await codigo(evaluarAdvertenciasReporte(7, cerrado))).toBe("PLAN_NO_ADMITE");
    expect(await codigo(evaluarAdvertenciasReporte(8, p))).toBe("NO_ENCONTRADO");
    // Un viaje físico de OTRA empresa con el mismo plan_id no cuenta.
    const q = await plan();
    await viajeFisico(q, "cerrado", 8);
    expect((await evaluarAdvertenciasReporte(7, q)).map((a) => a.codigo)).toEqual(["SIN_SALIDA_REGISTRADA"]);
  });

  it("F2-2. advertencias NO bloquean: sin reconocerlas no se escribe nada; reconocidas, confirma y quedan en el evento", async () => {
    const p = await plan();
    const antesPlan = await filaPlan(p);
    const sin = await confirmarReporteOperativo(A, { planId: p, observacion: "Reporte en papel" });
    expect(sin).toMatchObject({ ok: false, advertencias: [{ codigo: "SIN_SALIDA_REGISTRADA" }] });
    expect(await leerLiquidacionPlan(7, p)).toBeNull();
    expect(await conteo("tms_viaje_liquidacion_eventos", "plan_id = ?", [p])).toBe(0);

    const con = await confirmarReporteOperativo(A, { planId: p, observacion: "Reporte en papel", reconocerAdvertencias: true });
    expect(con.ok).toBe(true);
    const ev = await listarEventosLiquidacion(7, p);
    expect(ev).toHaveLength(1);
    expect(ev[0].detalle).toBe("Reporte en papel [Advertencias reconocidas: SIN_SALIDA_REGISTRADA]");
    expect((await leerLiquidacionPlan(7, p))).toMatchObject({ estado: "REPORTE_RECIBIDO", version: 1 });
    // El estado operativo del viaje no cambia: confirmar el reporte NO cierra ni liquida.
    expect(await filaPlan(p)).toEqual(antesPlan);
  });

  it("F2-3. sin advertencias confirma directo; la réplica es idempotente y no vuelve a advertir ni a escribir", async () => {
    const p = await plan();
    await viajeFisico(p, "cerrado");
    const r = await confirmarReporteOperativo(A, { planId: p });
    expect(r).toMatchObject({ ok: true, resultado: { idempotente: false, liquidacion: { estado: "REPORTE_RECIBIDO" } } });
    expect((await listarEventosLiquidacion(7, p))[0].detalle).toBeNull();
    const otra = await confirmarReporteOperativo(B, { planId: p });
    expect(otra).toMatchObject({ ok: true, resultado: { idempotente: true } });
    expect(await conteo("tms_viaje_liquidacion_eventos", "plan_id = ?", [p])).toBe(1);
    // Replay sobre un viaje SIN salida con liquidación existente: tampoco pide reconocer nada.
    const q = await plan();
    await confirmarReporteOperativo(A, { planId: q, reconocerAdvertencias: true });
    expect(await confirmarReporteOperativo(B, { planId: q })).toMatchObject({ ok: true, resultado: { idempotente: true } });
  });

  it("F2-4. el reporte recibido no toca flota_viajes, fondos, cuadrilla, facturación ni contabilidad", async () => {
    const p = await plan();
    await viajeFisico(p, "abierto");
    await holder.pool!.execute("INSERT INTO tms_solicitud_fondo_lineas (plan_id) VALUES (?)", [p]);
    const tablas = ["flota_viajes", "tms_solicitud_fondo_lineas", "tms_gastos_operativos", "tms_plan_cuadrilla", "fact_factura_viajes", "fel_documentos", "cont_eventos"];
    const foto = async () => JSON.stringify(await Promise.all(tablas.map((t) => sql(`SELECT * FROM ${t} ORDER BY id`))));
    const antes = await foto();
    await confirmarReporteOperativo(A, { planId: p, reconocerAdvertencias: true });
    expect(await foto()).toBe(antes);
  });

  it("F2-5. concurrencia: doble clic de «Confirmar reporte» deja una fila y un evento", async () => {
    const p = await plan();
    await viajeFisico(p, "cerrado");
    const r = await Promise.all([
      confirmarReporteOperativo(A, { planId: p }),
      confirmarReporteOperativo(A, { planId: p }),
      confirmarReporteOperativo(B, { planId: p }),
    ]);
    expect(r.every((x) => x.ok)).toBe(true);
    expect(await conteo("tms_viaje_liquidaciones", "plan_id = ?", [p])).toBe(1);
    expect(await conteo("tms_viaje_liquidacion_eventos", "plan_id = ?", [p])).toBe(1);
  });

  it("F2-6. liquidacionesDePlanes: estado vigente por empresa; el viaje sin fila no aparece (jamás «liquidado»)", async () => {
    const reportado = await plan();
    const liquidado = await plan();
    const enAjuste = await plan();
    const historico = await plan({ estado: "Cerrado", fecha: "2026-01-05" });
    const ajeno = await plan({ empresa: 8 });
    await confirmarReporteRecibido(A, { planId: reportado });
    await confirmarReporteRecibido(A, { planId: liquidado });
    await liquidarViaje(A, { planId: liquidado, versionEsperada: 1 });
    await confirmarReporteRecibido(A, { planId: enAjuste });
    await liquidarViaje(A, { planId: enAjuste, versionEsperada: 1 });
    await reabrirLiquidacion(A, { planId: enAjuste, versionEsperada: 2, motivo: "motivo valido" });
    await confirmarReporteRecibido(OTRA, { planId: ajeno });
    const m = await liquidacionesDePlanes(7, [reportado, liquidado, enAjuste, historico, ajeno]);
    expect(m.get(reportado)).toEqual({ estado: "REPORTE_RECIBIDO", version: 1 });
    expect(m.get(liquidado)).toEqual({ estado: "LIQUIDADO", version: 2 });
    expect(m.get(enAjuste)).toEqual({ estado: "EN_AJUSTE", version: 3 });
    expect(m.has(historico)).toBe(false);
    expect(m.has(ajeno)).toBe(false); // otra empresa
  });
});
