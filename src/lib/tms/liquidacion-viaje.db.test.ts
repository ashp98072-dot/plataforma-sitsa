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
/** Secuencia real: el viaje se CIERRA (lo hace el cierre existente, no este módulo) y luego se liquida. */
const cerrarPlan = (id: number) => holder.pool!.execute("UPDATE tms_planes_viaje SET estado = 'Cerrado' WHERE id = ? AND estado <> 'Cancelado'", [id]);
/** Liquida cerrando antes el viaje (la liquidación exige viaje Cerrado). Las pruebas de la regla usan el dominio directo. */
const liquidar: typeof liquidarViaje = async (actor, entrada) => {
  await cerrarPlan(entrada.planId);
  return liquidarViaje(actor, entrada);
};
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
          tipo_viaje VARCHAR(20) NOT NULL DEFAULT 'Propio', referencia_cliente VARCHAR(160) NULL, cliente_id INT NULL,
          lugar_carga_id INT NULL, lugar_descarga_id INT NULL, ruta_codigo_historico VARCHAR(40) NULL, lugar_descarga_historico VARCHAR(300) NULL,
          tarifa_id INT NULL, tarifa_nombre_historico VARCHAR(120) NULL, tarifa_monto_historico DECIMAL(12,2) NULL, tarifa_moneda_historico VARCHAR(10) NULL,
          unidad_id INT NULL, tc_vehiculo_id INT NULL, tc_placa_historica VARCHAR(40) NULL, tc_externo_placa VARCHAR(40) NULL,
          piloto_id INT NULL, auxiliar_id INT NULL, piloto_externo_nombre VARCHAR(160) NULL, auxiliares_externos TEXT NULL,
          unidad_externa_placa VARCHAR(40) NULL, unidad_externa_descripcion VARCHAR(160) NULL, transportista_externo VARCHAR(160) NULL,
          UNIQUE KEY uq_tmsplanes_empresa_id (empresa_id, id)) ENGINE=InnoDB;
        CREATE TABLE tms_clientes(id INT PRIMARY KEY, empresa_id INT NOT NULL, nombre VARCHAR(200) NOT NULL) ENGINE=InnoDB;
        CREATE TABLE tms_lugares(id INT PRIMARY KEY, empresa_id INT NOT NULL, nombre VARCHAR(200) NOT NULL) ENGINE=InnoDB;
        CREATE TABLE tms_unidades(id INT PRIMARY KEY, empresa_id INT NOT NULL, placa VARCHAR(40) NOT NULL) ENGINE=InnoDB;
        CREATE TABLE tms_personal(id INT PRIMARY KEY, empresa_id INT NOT NULL, nombre VARCHAR(200) NOT NULL) ENGINE=InnoDB;
        CREATE TABLE flota_vehiculos(id INT PRIMARY KEY, placa VARCHAR(40) NOT NULL) ENGINE=InnoDB;
        CREATE TABLE tms_plan_auxiliares(id INT AUTO_INCREMENT PRIMARY KEY, plan_id INT NOT NULL, personal_id INT NOT NULL, orden TINYINT NOT NULL DEFAULT 1) ENGINE=InnoDB;
        CREATE TABLE tms_plan_pilotos_adicionales(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, plan_id INT NOT NULL, personal_id INT NOT NULL, orden TINYINT NOT NULL DEFAULT 1) ENGINE=InnoDB;
        CREATE TABLE auditoria(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT, usuario VARCHAR(100), accion VARCHAR(100), modulo VARCHAR(100), detalle TEXT) ENGINE=InnoDB;
        CREATE TABLE flota_viajes(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, plan_id INT NULL,
          estado VARCHAR(20) NOT NULL DEFAULT 'abierto', km_salida INT NULL, km_llegada INT NULL,
          hora_salida DATETIME NULL, hora_llegada DATETIME NULL) ENGINE=InnoDB;
        CREATE TABLE tms_solicitud_fondo_lineas(id INT AUTO_INCREMENT PRIMARY KEY, plan_id INT) ENGINE=InnoDB;
        CREATE TABLE tms_gastos_operativos(id INT AUTO_INCREMENT PRIMARY KEY, plan_id INT) ENGINE=InnoDB;
        CREATE TABLE tms_plan_cuadrilla(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL DEFAULT 7, plan_id INT NOT NULL,
          orden SMALLINT NOT NULL DEFAULT 1, tipo VARCHAR(10) NOT NULL DEFAULT 'EXTERNO', id_empleado INT NULL,
          nombre VARCHAR(200) NOT NULL DEFAULT 'Cuadrilla', identificacion VARCHAR(100) NULL, telefono VARCHAR(50) NULL) ENGINE=InnoDB;
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

    const l = await liquidar(B, { planId: p, versionEsperada: 1 });
    expect(l).toMatchObject({ evento: "LIQUIDADO", liquidacion: { estado: "LIQUIDADO", version: 2, liquidadoPor: 5 } });

    const r = await reabrirLiquidacion(A, { planId: p, versionEsperada: 2, motivo: "  Falta cargo de espera  " });
    expect(r).toMatchObject({ evento: "REABIERTO", liquidacion: { estado: "EN_AJUSTE", version: 3, reabiertoPor: 4, liquidadoPor: 5 } });

    const rl = await liquidar(B, { planId: p, versionEsperada: 3 });
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
    // El módulo NO modifica el plan: lo único que cambió es el estado por el cierre previo que hace la propia prueba.
    expect(await filaPlan(p)).toEqual({ ...antesPlan, estado: "Cerrado" });
    // Auditoría: una por transición.
    expect(await conteo("auditoria", "accion LIKE 'liquidacion_viaje_%' AND detalle LIKE ?", [`Plan #${p} %`])).toBe(4);
  });

  it("confirmar sigue siendo idempotente aunque el viaje ya se haya cerrado (REPORTE_RECIBIDO + Cerrado)", async () => {
    const p = await plan();
    await confirmarReporteRecibido(A, { planId: p });
    await cerrarPlan(p);
    expect(await confirmarReporteRecibido(B, { planId: p })).toMatchObject({ idempotente: true, evento: null, liquidacion: { version: 1 } });
    expect(await conteo("tms_viaje_liquidacion_eventos", "plan_id = ?", [p])).toBe(1);
    // Sin liquidación previa, un viaje Cerrado NO acepta confirmar reporte (comportamiento sin cambios).
    const q = await plan({ estado: "Cerrado" });
    expect(await codigo(confirmarReporteRecibido(A, { planId: q }))).toBe("PLAN_NO_ADMITE");
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
    await liquidar(A, { planId: p, versionEsperada: 1 });
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
    // Abierto y sin reporte: primero manda la regla de secuencia (el viaje debe estar Cerrado).
    expect(await codigo(liquidarViaje(A, { planId: p, versionEsperada: 1 }))).toBe("PLAN_NO_CERRADO");
    // Cerrado pero sin reporte recibido (nunca se liquida desde «sin liquidación»).
    const sinReporte = await plan({ estado: "Cerrado" });
    expect(await codigo(liquidarViaje(A, { planId: sinReporte, versionEsperada: 1 }))).toBe("NO_ENCONTRADO");
    expect(await codigo(reabrirLiquidacion(A, { planId: sinReporte, versionEsperada: 1, motivo: "motivo valido" }))).toBe("NO_ENCONTRADO");
    await confirmarReporteRecibido(A, { planId: p });
    expect(await codigo(reabrirLiquidacion(A, { planId: p, versionEsperada: 1, motivo: "motivo valido" }))).toBe("ESTADO_NO_PERMITE");
    expect(await codigo(liquidar(A, { planId: p, versionEsperada: 0 }))).toBe("SOLICITUD_INVALIDA");
    expect(await codigo(liquidar(A, { planId: p, versionEsperada: 1.5 }))).toBe("SOLICITUD_INVALIDA");
    await liquidar(A, { planId: p, versionEsperada: 1 });
    expect(await codigo(confirmarReporteRecibido(A, { planId: p }))).toBe("ESTADO_NO_PERMITE");
    expect(await codigo(liquidar(B, { planId: p, versionEsperada: 2 }))).toBe("ESTADO_NO_PERMITE"); // ya liquidado
    await reabrirLiquidacion(A, { planId: p, versionEsperada: 2, motivo: "motivo valido" });
    expect(await codigo(reabrirLiquidacion(B, { planId: p, versionEsperada: 3, motivo: "otra vez" }))).toBe("ESTADO_NO_PERMITE"); // ya en ajuste
  });

  it("secuencia: liquidar exige viaje CERRADO (servidor); reabrir sí procede con el viaje Cerrado; Cancelado no admite nada", async () => {
    const p = await plan();
    await confirmarReporteRecibido(A, { planId: p });
    // Abierto (cualquier estado operativo no cerrado): NO se liquida y no se escribe nada.
    for (const estado of ["Programado", "Cargado", "En ruta", "Descargado"]) {
      await holder.pool!.execute("UPDATE tms_planes_viaje SET estado = ? WHERE id = ?", [estado, p]);
      expect(await codigo(liquidarViaje(A, { planId: p, versionEsperada: 1 })), estado).toBe("PLAN_NO_CERRADO");
    }
    expect(await leerLiquidacionPlan(7, p)).toMatchObject({ estado: "REPORTE_RECIBIDO", version: 1 });
    expect(await conteo("tms_viaje_liquidacion_eventos", "plan_id = ?", [p])).toBe(1);
    // Cerrado: procede.
    await cerrarPlan(p);
    expect(await codigo(liquidarViaje(A, { planId: p, versionEsperada: 1 }))).toBe("OK");
    expect((await leerLiquidacionPlan(7, p))!.estado).toBe("LIQUIDADO");
    // Reabrir con el viaje Cerrado: la liquidación pasa a EN_AJUSTE y el viaje PERMANECE Cerrado.
    expect(await codigo(reabrirLiquidacion(A, { planId: p, versionEsperada: 2, motivo: "motivo valido" }))).toBe("OK");
    expect((await filaPlan(p)).estado).toBe("Cerrado");
    expect((await leerLiquidacionPlan(7, p))!.estado).toBe("EN_AJUSTE");
    // Cancelado no admite liquidar ni reabrir ni confirmar.
    const cancelado = await plan({ estado: "Cancelado" });
    expect(await codigo(confirmarReporteRecibido(A, { planId: cancelado }))).toBe("PLAN_NO_ADMITE");
    expect(await leerLiquidacionPlan(7, cancelado)).toBeNull();
    await holder.pool!.execute("UPDATE tms_planes_viaje SET estado = 'Cancelado' WHERE id = ?", [p]);
    expect(await codigo(reabrirLiquidacion(A, { planId: p, versionEsperada: 3, motivo: "motivo valido" }))).toBe("PLAN_NO_ADMITE");
    expect(await codigo(liquidarViaje(A, { planId: p, versionEsperada: 3 }))).toBe("PLAN_NO_ADMITE");
  });

  it("EN_AJUSTE con el viaje abierto NO se re-liquida (datos previos a la regla); al cerrarse sí", async () => {
    const p = await plan();
    await confirmarReporteRecibido(A, { planId: p });
    await liquidar(A, { planId: p, versionEsperada: 1 });
    await reabrirLiquidacion(A, { planId: p, versionEsperada: 2, motivo: "motivo valido" });
    await holder.pool!.execute("UPDATE tms_planes_viaje SET estado = 'En ruta' WHERE id = ?", [p]); // dato legado: viaje abierto
    expect(await codigo(liquidarViaje(A, { planId: p, versionEsperada: 3 }))).toBe("PLAN_NO_CERRADO");
    expect((await leerLiquidacionPlan(7, p))).toMatchObject({ estado: "EN_AJUSTE", version: 3 });
    // También con la liquidación LIQUIDADA en un viaje abierto (legado) se puede reabrir.
    expect(await conteo("tms_viaje_liquidacion_eventos", "plan_id = ?", [p])).toBe(3);
    await cerrarPlan(p);
    expect(await liquidar(B, { planId: p, versionEsperada: 3 })).toMatchObject({ evento: "RELIQUIDADO", liquidacion: { version: 4 } });
  });

  it("carrera cierre vs liquidación: la validación se hace bajo el lock del plan (lee el estado ya confirmado)", async () => {
    const p = await plan({ estado: "En ruta" });
    await confirmarReporteRecibido(A, { planId: p });
    // 1) Otra transacción mantiene el plan bloqueado y lo CIERRA antes de confirmar: la liquidación espera y procede.
    const c1 = await holder.pool!.getConnection();
    try {
      await c1.beginTransaction();
      await c1.query("SELECT estado FROM tms_planes_viaje WHERE id = ? FOR UPDATE", [p]);
      const liquidando = liquidarViaje(A, { planId: p, versionEsperada: 1 });
      await new Promise((r) => setTimeout(r, 150));
      await c1.query("UPDATE tms_planes_viaje SET estado = 'Cerrado' WHERE id = ?", [p]);
      await c1.commit();
      expect(await liquidando).toMatchObject({ liquidacion: { estado: "LIQUIDADO", version: 2 } });
    } finally {
      c1.release();
    }
    // 2) Otra transacción libera el lock SIN cerrar: la liquidación se rechaza.
    const q = await plan({ estado: "En ruta" });
    await confirmarReporteRecibido(A, { planId: q });
    const c2 = await holder.pool!.getConnection();
    try {
      await c2.beginTransaction();
      await c2.query("SELECT estado FROM tms_planes_viaje WHERE id = ? FOR UPDATE", [q]);
      const liquidando = codigo(liquidarViaje(A, { planId: q, versionEsperada: 1 }));
      await new Promise((r) => setTimeout(r, 150));
      await c2.commit();
      expect(await liquidando).toBe("PLAN_NO_CERRADO");
    } finally {
      c2.release();
    }
    expect((await leerLiquidacionPlan(7, q))!.estado).toBe("REPORTE_RECIBIDO");
  });

  // ───────────────────────────────────── aislamiento y modelo ─────────────────────────────────────
  it("8. aislamiento por empresa: otra empresa no ve ni toca el viaje", async () => {
    const p = await plan();
    await confirmarReporteRecibido(A, { planId: p });
    expect(await codigo(confirmarReporteRecibido(OTRA, { planId: p }))).toBe("NO_ENCONTRADO");
    expect(await codigo(liquidar(OTRA, { planId: p, versionEsperada: 1 }))).toBe("NO_ENCONTRADO");
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
    const r = await Promise.allSettled([liquidar(A, { planId: p, versionEsperada: 1 }), liquidar(B, { planId: p, versionEsperada: 1 })]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const rechazo = r.find((x) => x.status === "rejected") as PromiseRejectedResult;
    expect(["CONFLICTO_VERSION", "ESTADO_NO_PERMITE"]).toContain(rechazo.reason.codigoLiquidacion);
    expect((await leerLiquidacionPlan(7, p))).toMatchObject({ estado: "LIQUIDADO", version: 2 });
    expect(await conteo("tms_viaje_liquidacion_eventos", "plan_id = ? AND tipo = 'LIQUIDADO'", [p])).toBe(1);
  });

  it("10d. doble clic del MISMO actor al liquidar: una transición y la réplica es idempotente", async () => {
    const p = await plan();
    await confirmarReporteRecibido(A, { planId: p });
    const r = await Promise.all([liquidar(A, { planId: p, versionEsperada: 1 }), liquidar(A, { planId: p, versionEsperada: 1 })]);
    expect(r.filter((x) => x.idempotente)).toHaveLength(1);
    expect(await conteo("tms_viaje_liquidacion_eventos", "plan_id = ? AND tipo = 'LIQUIDADO'", [p])).toBe(1);
    expect((await leerLiquidacionPlan(7, p))!.version).toBe(2);
  });

  it("10e. reapertura concurrente por dos actores: una sola reapertura efectiva", async () => {
    const p = await plan();
    await confirmarReporteRecibido(A, { planId: p });
    await liquidar(A, { planId: p, versionEsperada: 1 });
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
    await liquidar(A, { planId: p, versionEsperada: 1 });
    await reabrirLiquidacion(A, { planId: p, versionEsperada: 2, motivo: "motivo valido" });
    expect(await codigo(liquidar(B, { planId: p, versionEsperada: 2 }))).toBe("CONFLICTO_VERSION");
    expect(await codigo(liquidar(B, { planId: p, versionEsperada: 1 }))).toBe("CONFLICTO_VERSION");
    expect((await leerLiquidacionPlan(7, p))).toMatchObject({ estado: "EN_AJUSTE", version: 3 });
    expect(await codigo(liquidar(B, { planId: p, versionEsperada: 3 }))).toBe("OK");
    expect((await leerLiquidacionPlan(7, p))).toMatchObject({ estado: "LIQUIDADO", version: 4 });
  });

  it("10g. carrera de liquidar vs reabrir con la misma versión: exactamente una transición", async () => {
    const p = await plan();
    await confirmarReporteRecibido(A, { planId: p });
    await liquidar(A, { planId: p, versionEsperada: 1 });
    await reabrirLiquidacion(A, { planId: p, versionEsperada: 2, motivo: "motivo valido" });
    const r = await Promise.allSettled([
      liquidar(B, { planId: p, versionEsperada: 3 }),
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
    await confirmarReporteRecibido(A, { planId: p });
    await cerrarPlan(p); // el cierre es otro flujo; aquí solo se prepara la secuencia
    const antesPlan = await filaPlan(p);
    await liquidarViaje(A, { planId: p, versionEsperada: 1 });
    await reabrirLiquidacion(A, { planId: p, versionEsperada: 2, motivo: "motivo valido" });
    await liquidarViaje(A, { planId: p, versionEsperada: 3 });
    expect(await foto()).toBe(antesTablas);
    // Liquidar/reabrir/re-liquidar NO modifican el plan (ni su estado Cerrado ni cierre_*/tarifa).
    expect(await filaPlan(p)).toEqual(antesPlan);
    expect((await filaPlan(p)).estado).toBe("Cerrado");
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
    await liquidar(A, { planId: liquidado, versionEsperada: 1 });
    await confirmarReporteRecibido(A, { planId: enAjuste });
    await liquidar(A, { planId: enAjuste, versionEsperada: 1 });
    await reabrirLiquidacion(A, { planId: enAjuste, versionEsperada: 2, motivo: "motivo valido" });
    await confirmarReporteRecibido(OTRA, { planId: ajeno });
    const m = await liquidacionesDePlanes(7, [reportado, liquidado, enAjuste, historico, ajeno]);
    expect(m.get(reportado)).toEqual({ estado: "REPORTE_RECIBIDO", version: 1, reporteRecibido: true });
    expect(m.get(liquidado)).toEqual({ estado: "LIQUIDADO", version: 2, reporteRecibido: true }); // el evento REPORTE_RECIBIDO v1 existe
    expect(m.get(enAjuste)).toEqual({ estado: "EN_AJUSTE", version: 3, reporteRecibido: true });
    expect(m.has(historico)).toBe(false);
    expect(m.has(ajeno)).toBe(false); // otra empresa
  });

  // ───────────────────────────── FASE 3: liquidar / reabrir con snapshot operativo ─────────────────────────────
  const completo = async (delta: { empresa?: number } = {}) => {
    const e = delta.empresa ?? 7;
    const base = sigPlan * 10; // ids de catálogos únicos por viaje
    await holder.pool!.execute("INSERT INTO tms_clientes VALUES (?, ?, 'Cliente Fase3')", [base + 1, e]);
    await holder.pool!.execute("INSERT INTO tms_lugares VALUES (?, ?, 'Bodega Origen'), (?, ?, 'Destino Catalogo')", [base + 2, e, base + 3, e]);
    await holder.pool!.execute("INSERT INTO tms_unidades VALUES (?, ?, 'C-123ABC')", [base + 4, e]);
    await holder.pool!.execute("INSERT INTO tms_personal VALUES (?, ?, 'Piloto Uno'), (?, ?, 'Aux Uno'), (?, ?, 'Piloto Extra')", [base + 5, e, base + 6, e, base + 7, e]);
    await holder.pool!.execute("INSERT INTO flota_vehiculos VALUES (?, 'TC-999XYZ')", [base + 8]);
    const p = await plan({ empresa: e, tarifa: 1500 });
    await holder.pool!.execute(
      `UPDATE tms_planes_viaje SET cliente_id = ?, lugar_carga_id = ?, lugar_descarga_id = ?, ruta_codigo_historico = 'RUTA-1', unidad_id = ?,
              piloto_id = ?, tc_vehiculo_id = ?, referencia_cliente = 'REF-9', tarifa_id = 77, tarifa_nombre_historico = 'Tarifa std',
              tarifa_monto_historico = 1400, tarifa_moneda_historico = 'GTQ' WHERE id = ?`,
      [base + 1, base + 2, base + 3, base + 4, base + 5, base + 8, p],
    );
    await holder.pool!.execute("INSERT INTO tms_plan_auxiliares (plan_id, personal_id, orden) VALUES (?, ?, 1)", [p, base + 6]);
    await holder.pool!.execute("INSERT INTO tms_plan_pilotos_adicionales (empresa_id, plan_id, personal_id) VALUES (?, ?, ?)", [e, p, base + 7]);
    await holder.pool!.execute(
      "INSERT INTO tms_plan_cuadrilla (empresa_id, plan_id, orden, tipo, id_empleado, nombre, identificacion, telefono) VALUES (?, ?, 1, 'INTERNO', 501, 'Ayudante Interno', NULL, NULL), (?, ?, 2, 'EXTERNO', NULL, 'Ayudante Externo', 'DPI-SECRETO-123', '5555-0000')",
      [e, p, e, p],
    );
    await holder.pool!.execute(
      "INSERT INTO flota_viajes (empresa_id, plan_id, estado, km_salida, km_llegada, hora_salida, hora_llegada) VALUES (?, ?, 'cerrado', 1000, 1250, '2026-10-14 06:30:00', '2026-10-14 18:10:00')",
      [e, p],
    );
    return p;
  };
  const eventoDe = async (p: number, tipo: string) => (await listarEventosLiquidacion(7, p)).find((e) => e.tipo === tipo)!;

  it("F3-1. liquidar guarda un snapshot operativo con los datos existentes (y sin datos sensibles ni costos)", async () => {
    const p = await completo();
    await confirmarReporteRecibido(A, { planId: p });
    const r = await liquidar(B, { planId: p, versionEsperada: 1, observacion: "  Todo conforme  " });
    expect(r).toMatchObject({ evento: "LIQUIDADO", liquidacion: { estado: "LIQUIDADO", version: 2 } });
    const ev = await eventoDe(p, "LIQUIDADO");
    expect(ev.detalle).toBe("Todo conforme");
    const o = ev.snapshot!.operativo!;
    expect(o.version).toBe(1);
    expect(o.plan).toMatchObject({ id: p, codigo: `PLAN-${p}`, fechaPlan: "2026-10-14", estado: "Cerrado", tipoViaje: "Propio", referenciaCliente: "REF-9" });
    expect(o.cliente.nombre).toBe("Cliente Fase3");
    expect(o.ruta).toEqual({ codigo: "RUTA-1", origen: "Bodega Origen", destino: "Destino Catalogo" });
    expect(o.tarifa).toEqual({ comercial: "1500.00", tarifaId: 77, nombre: "Tarifa std", montoCatalogo: "1400.00", moneda: "GTQ" });
    expect(o.unidad.placa).toBe("C-123ABC");
    expect(o.tc).toEqual({ placa: "TC-999XYZ", origen: "INTERNO" });
    expect(o.piloto.nombre).toBe("Piloto Uno");
    expect(o.pilotosExtra.map((x) => x.nombre)).toEqual(["Piloto Extra"]);
    expect(o.auxiliares.map((x) => x.nombre)).toEqual(["Aux Uno"]);
    expect(o.cuadrilla).toEqual([
      { tipo: "INTERNO", empleadoId: 501, nombre: "Ayudante Interno" },
      { tipo: "EXTERNO", empleadoId: null, nombre: "Ayudante Externo" },
    ]);
    expect(o.tercerizado).toBeNull();
    expect(o.viajeFisico).toEqual({ estado: "cerrado", kmSalida: 1000, kmLlegada: 1250, kmRecorridos: 250, horaSalida: "2026-10-14T06:30", horaLlegada: "2026-10-14T18:10" });
    expect(o.noDisponible.length).toBeGreaterThan(0);
    // Datos de la liquidación y trazabilidad.
    expect(ev.snapshot!.liquidacion).toMatchObject({
      version: 2, transicion: "LIQUIDADO", estadoAntes: "REPORTE_RECIBIDO", liquidadoPor: 5, liquidadoPorUsuario: "beto",
      reporteRecibidoPor: 4, reaperturaPrevia: null,
    });
    expect(typeof ev.snapshot!.liquidacion!.reporteRecibidoEn).toBe("string");
    // Sin datos sensibles innecesarios ni costos.
    const crudo = (await sql("SELECT snapshot_json FROM tms_viaje_liquidacion_eventos WHERE plan_id = ? AND tipo = 'LIQUIDADO'", [p]))[0].snapshot_json as string;
    expect(crudo).not.toMatch(/DPI-SECRETO-123|5555-0000/);
    const claves: string[] = [];
    JSON.parse(crudo, function (k, v) { claves.push(k); return v; });
    expect(claves.filter((k) => /identificacion|telefono|costo|monto_asignado/i.test(k))).toEqual([]);
    // Fase 4: el único rastro de «cargo» es el bloque aditivo `cargos` (vigentes del cliente), nunca costos internos.
    expect([...new Set(claves.filter((k) => /cargo/i.test(k)))]).toEqual(["cargos"]);
  });

  it("F3-2. el snapshot es evidencia inmutable y liquidar NO modifica Programación (plan, auxiliares, cuadrilla, piloto extra)", async () => {
    const p = await completo();
    const foto = async () => JSON.stringify([
      await sql("SELECT * FROM tms_planes_viaje WHERE id = ?", [p]),
      await sql("SELECT * FROM tms_plan_auxiliares WHERE plan_id = ?", [p]),
      await sql("SELECT * FROM tms_plan_cuadrilla WHERE plan_id = ?", [p]),
      await sql("SELECT * FROM tms_plan_pilotos_adicionales WHERE plan_id = ?", [p]),
      await sql("SELECT * FROM flota_viajes WHERE plan_id = ?", [p]),
    ]);
    await confirmarReporteRecibido(A, { planId: p });
    await cerrarPlan(p);
    const antes = await foto();
    await liquidarViaje(A, { planId: p, versionEsperada: 1 });
    expect(await foto()).toBe(antes);
    const original = (await sql("SELECT snapshot_json FROM tms_viaje_liquidacion_eventos WHERE plan_id = ? AND tipo = 'LIQUIDADO'", [p]))[0].snapshot_json;
    // Cambios posteriores en Programación NO alteran el snapshot ya guardado.
    await holder.pool!.execute("UPDATE tms_planes_viaje SET tarifa_comercial = 9999 WHERE id = ?", [p]);
    await holder.pool!.execute("UPDATE tms_personal SET nombre = 'Otro Nombre' WHERE nombre = 'Piloto Uno'");
    await holder.pool!.execute("DELETE FROM tms_plan_cuadrilla WHERE plan_id = ?", [p]);
    expect((await sql("SELECT snapshot_json FROM tms_viaje_liquidacion_eventos WHERE plan_id = ? AND tipo = 'LIQUIDADO'", [p]))[0].snapshot_json).toBe(original);
  });

  it("F3-3. reapertura + reliquidación: nuevo snapshot, motivo preservado y evento anterior intacto", async () => {
    const p = await completo();
    await confirmarReporteRecibido(A, { planId: p });
    await liquidar(A, { planId: p, versionEsperada: 1 });
    const v2 = (await sql("SELECT snapshot_json FROM tms_viaje_liquidacion_eventos WHERE plan_id = ? AND version = 2", [p]))[0].snapshot_json;
    await reabrirLiquidacion(B, { planId: p, versionEsperada: 2, motivo: "Corregir tarifa del viaje" });
    await holder.pool!.execute("UPDATE tms_planes_viaje SET tarifa_comercial = 1800 WHERE id = ?", [p]);
    const r = await liquidar(A, { planId: p, versionEsperada: 3, observacion: "Tarifa corregida" });
    expect(r).toMatchObject({ evento: "RELIQUIDADO", liquidacion: { estado: "LIQUIDADO", version: 4 } });
    const rel = await eventoDe(p, "RELIQUIDADO");
    expect(rel.snapshot!.operativo!.tarifa.comercial).toBe("1800.00");
    expect(rel.snapshot!.liquidacion).toMatchObject({
      version: 4, transicion: "RELIQUIDADO", estadoAntes: "EN_AJUSTE",
      reaperturaPrevia: { version: 3, actorId: 5, motivo: "Corregir tarifa del viaje" },
    });
    // La liquidación anterior y el evento REABIERTO permanecen sin cambios (append-only).
    expect((await sql("SELECT snapshot_json FROM tms_viaje_liquidacion_eventos WHERE plan_id = ? AND version = 2", [p]))[0].snapshot_json).toBe(v2);
    expect((await eventoDe(p, "REABIERTO")).detalle).toBe("Corregir tarifa del viaje");
    expect((await listarEventosLiquidacion(7, p)).map((e) => e.tipo)).toEqual(["REPORTE_RECIBIDO", "LIQUIDADO", "REABIERTO", "RELIQUIDADO"]);
  });

  it("F3-4. tenant-safe: un cliente/unidad de OTRA empresa referenciado por el viaje no se filtra al snapshot", async () => {
    const p = await completo();
    await holder.pool!.execute("INSERT INTO tms_clientes VALUES (?, 8, 'Cliente De Otra Empresa')", [900000 + p]);
    await holder.pool!.execute("UPDATE tms_planes_viaje SET cliente_id = ? WHERE id = ?", [900000 + p, p]);
    await confirmarReporteRecibido(A, { planId: p });
    await liquidar(A, { planId: p, versionEsperada: 1 });
    const o = (await eventoDe(p, "LIQUIDADO")).snapshot!.operativo!;
    expect(o.cliente.nombre).toBeNull();
    const crudo = (await sql("SELECT snapshot_json FROM tms_viaje_liquidacion_eventos WHERE plan_id = ?", [p])).map((x) => x.snapshot_json).join("");
    expect(crudo).not.toContain("Cliente De Otra Empresa");
  });

  it("F3-5. viaje tercerizado: el snapshot incluye los datos externos y el TC externo", async () => {
    const p = await plan({ tarifa: 800 });
    await holder.pool!.execute(
      `UPDATE tms_planes_viaje SET tipo_viaje = 'Tercerizado', piloto_externo_nombre = 'Piloto Ajeno', unidad_externa_placa = 'EXT-111',
              unidad_externa_descripcion = 'Cabezal', transportista_externo = 'Transportes SA', tc_externo_placa = 'TCE-222' WHERE id = ?`,
      [p],
    );
    await confirmarReporteRecibido(A, { planId: p });
    await liquidar(A, { planId: p, versionEsperada: 1 });
    const o = (await eventoDe(p, "LIQUIDADO")).snapshot!.operativo!;
    expect(o.plan.tipoViaje).toBe("Tercerizado");
    expect(o.tercerizado).toEqual({
      pilotoExterno: "Piloto Ajeno", auxiliaresExternos: null, unidadExternaPlaca: "EXT-111", unidadExternaDescripcion: "Cabezal", transportistaExterno: "Transportes SA",
    });
    expect(o.unidad.placa).toBe("EXT-111");
    expect(o.tc).toEqual({ placa: "TCE-222", origen: "EXTERNO" });
    expect(o.piloto.nombre).toBe("Piloto Ajeno");
    expect(o.viajeFisico).toBeNull(); // sin registro del piloto: no se inventa
  });

  it("F3-6. observación de liquidación: ≤ 500 caracteres y sin efecto en la versión si se rechaza", async () => {
    const p = await plan();
    await confirmarReporteRecibido(A, { planId: p });
    expect(await codigo(liquidar(A, { planId: p, versionEsperada: 1, observacion: "x".repeat(501) }))).toBe("SOLICITUD_INVALIDA");
    expect((await leerLiquidacionPlan(7, p))!.version).toBe(1);
    expect(await conteo("tms_viaje_liquidacion_eventos", "plan_id = ?", [p])).toBe(1);
  });

  it("F3-7. concurrencia: 6 liquidaciones simultáneas de 3 actores = una sola transición con UN snapshot", async () => {
    const p = await completo();
    await confirmarReporteRecibido(A, { planId: p });
    const actores = [A, B, { empresaId: 7, usuarioId: 6, usuario: "carla" }];
    const r = await Promise.allSettled(Array.from({ length: 6 }, (_, i) => liquidar(actores[i % 3], { planId: p, versionEsperada: 1 })));
    const efectivas = r.filter((x) => x.status === "fulfilled" && !x.value.idempotente);
    expect(efectivas).toHaveLength(1);
    for (const x of r) {
      if (x.status === "rejected") expect(["CONFLICTO_VERSION", "ESTADO_NO_PERMITE"]).toContain(x.reason.codigoLiquidacion);
    }
    expect(await conteo("tms_viaje_liquidacion_eventos", "plan_id = ? AND tipo = 'LIQUIDADO' AND snapshot_json IS NOT NULL", [p])).toBe(1);
    expect((await leerLiquidacionPlan(7, p))).toMatchObject({ estado: "LIQUIDADO", version: 2 });
  });

  it("F3-8. reabrir: réplica del mismo actor es idempotente y la versión obsoleta se rechaza sin evento", async () => {
    const p = await plan();
    await confirmarReporteRecibido(A, { planId: p });
    await liquidar(A, { planId: p, versionEsperada: 1 });
    const r = await Promise.all([
      reabrirLiquidacion(A, { planId: p, versionEsperada: 2, motivo: "Ajustar viaticos" }),
      reabrirLiquidacion(A, { planId: p, versionEsperada: 2, motivo: "Ajustar viaticos" }),
    ]);
    expect(r.filter((x) => x.idempotente)).toHaveLength(1);
    expect(await conteo("tms_viaje_liquidacion_eventos", "plan_id = ? AND tipo = 'REABIERTO'", [p])).toBe(1);
    expect(await codigo(reabrirLiquidacion(B, { planId: p, versionEsperada: 2, motivo: "otro motivo" }))).toBe("CONFLICTO_VERSION");
    expect(await codigo(reabrirLiquidacion(B, { planId: p, versionEsperada: 3, motivo: "otro motivo" }))).toBe("ESTADO_NO_PERMITE");
    expect(await codigo(liquidar(B, { planId: p, versionEsperada: 2 }))).toBe("CONFLICTO_VERSION");
    expect(await conteo("tms_viaje_liquidacion_eventos", "plan_id = ?", [p])).toBe(3);
  });

  it("F3-9. liquidar no toca cierre, facturación, fondos/gastos, FEL ni contabilidad (el cierre es prerrequisito, no efecto)", async () => {
    const p = await completo();
    await holder.pool!.execute("INSERT INTO tms_solicitud_fondo_lineas (plan_id) VALUES (?)", [p]);
    await holder.pool!.execute("INSERT INTO tms_gastos_operativos (plan_id) VALUES (?)", [p]);
    const tablas = ["tms_solicitud_fondo_lineas", "tms_gastos_operativos", "fact_factura_viajes", "fel_documentos", "cont_eventos"];
    const foto = async () => JSON.stringify(await Promise.all(tablas.map((t) => sql(`SELECT * FROM ${t} ORDER BY id`))));
    const antes = await foto();
    await confirmarReporteRecibido(A, { planId: p });
    await cerrarPlan(p);
    const planAntes = await filaPlan(p);
    await liquidarViaje(A, { planId: p, versionEsperada: 1 });
    await reabrirLiquidacion(A, { planId: p, versionEsperada: 2, motivo: "Ajuste de prueba" });
    await liquidarViaje(A, { planId: p, versionEsperada: 3 });
    expect(await foto()).toBe(antes);
    expect(await filaPlan(p)).toEqual(planAntes);
  });
});
