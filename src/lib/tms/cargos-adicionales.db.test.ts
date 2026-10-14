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
  query: async (texto: string, params: unknown[] = []) => {
    if (!holder.pool) throw new Error("Sin conexión local fixture");
    return (await holder.pool.query(texto, params))[0];
  },
}));

import {
  anularCargoAdicional,
  crearCargoAdicional,
  editarCargoAdicional,
  listarCargosPlan,
  listarEventosCargosPlan,
  obtenerVistaCargosPlan,
  reactivarCargoAdicional,
  resumenCargosDePlanes,
  type ActorCargos,
} from "./cargos-adicionales";
import { nuevaClaveEnvio } from "@/lib/idempotencia/clave-envio";
import {
  confirmarReporteRecibido,
  leerLiquidacionPlan,
  liquidarViaje,
  listarEventosLiquidacion,
  reabrirLiquidacion,
  type ActorLiquidacion,
} from "./liquidacion-viaje";

/**
 * Fase 4 (cargos adicionales facturables) contra MariaDB 11.8.9 DESECHABLE. Se OMITE salvo que exista LIQ_TEST_DB_PORT (3399
 * o 3407, solo local). Ejecuta el código REAL y el SQL REAL de las migraciones de Fase 1 y Fase 4 (dos veces cada una).
 *   LIQ_TEST_DB_PORT=3399 npx vitest run src/lib/tms/cargos-adicionales.db.test.ts --no-file-parallelism
 */
const port = Number(process.env.LIQ_TEST_DB_PORT ?? 0);
const database = `liq4_test_${randomUUID().replaceAll("-", "")}`;
const A: ActorCargos = { empresaId: 7, usuarioId: 4, usuario: "ana" };
const B: ActorCargos = { empresaId: 7, usuarioId: 5, usuario: "beto" };
const OTRA: ActorCargos = { empresaId: 8, usuarioId: 6, usuario: "carla" };
const L = (a: ActorCargos): ActorLiquidacion => a;
let sigPlan = 500;

const sql = async <T extends RowDataPacket = RowDataPacket>(t: string, p: unknown[] = []): Promise<T[]> => (await holder.pool!.query<T[]>(t, p))[0];
const conteo = async (tabla: string, where = "1=1", p: unknown[] = []) =>
  Number((await sql(`SELECT COUNT(*) AS n FROM ${tabla} WHERE ${where}`, p))[0].n);

async function plan(delta: { empresa?: number; estado?: string; tarifa?: number | null; moneda?: string | null } = {}) {
  const id = sigPlan++;
  await holder.pool!.execute(
    "INSERT INTO tms_planes_viaje (id, empresa_id, codigo, estado, fecha_plan, tarifa_comercial, tarifa_moneda_historico) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [id, delta.empresa ?? 7, `PLAN-${id}`, delta.estado ?? "Programado", "2026-10-14", delta.tarifa === undefined ? 1000 : delta.tarifa, delta.moneda ?? null],
  );
  return id;
}
const filaPlan = async (id: number) => (await sql("SELECT * FROM tms_planes_viaje WHERE id = ?", [id]))[0];
const cerrarPlan = (id: number) => holder.pool!.execute("UPDATE tms_planes_viaje SET estado = 'Cerrado' WHERE id = ? AND estado <> 'Cancelado'", [id]);
const codigo = (p: Promise<unknown>) => p.then(() => "OK", (e: { codigoCargo?: string; codigoLiquidacion?: string }) => e.codigoCargo ?? e.codigoLiquidacion ?? "ERROR");
const nuevo = (planId: number, extra: Partial<{ concepto: string; monto: unknown; observacion: string | null }> = {}, actor = A) =>
  crearCargoAdicional(actor, { planId, concepto: "Tiempo de espera", monto: "150.00", claveEnvio: nuevaClaveEnvio(), ...extra });

/** Lleva un viaje a Cerrado + REPORTE_RECIBIDO (secuencia real: reporte → cerrar). */
async function cerradoConReporte(delta: Parameters<typeof plan>[0] = {}) {
  const p = await plan(delta);
  await confirmarReporteRecibido(L(A), { planId: p });
  await cerrarPlan(p);
  return p;
}

describe.skipIf(!port)("Cargos adicionales Fase 4 / MariaDB 11.8.9 SOLO LOCAL", () => {
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
      // La liquidación se instala ANTES; cargos después. Cada migración se ejecuta dos veces (NOOP la segunda).
      for (const f of ["sql/migrate-2026-10-tms-liquidacion-viajes-fase1.sql", "sql/migrate-2026-10-tms-liquidacion-cargos-fase4.sql"]) {
        const ddl = readFileSync(f, "utf8");
        await c.query(ddl);
        await c.query(ddl);
      }
      for (const t of ["tms_viaje_cargos_adicionales", "tms_viaje_cargo_eventos"]) {
        const [n] = await c.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${t}`);
        expect(Number(n[0].n)).toBe(0); // sin seeds ni backfill
      }
    } finally {
      await c.end();
    }
    holder.pool = mysql.createPool({ host: "127.0.0.1", port, user: "root", password: "", database, connectionLimit: 16 });
  });

  afterAll(async () => {
    await holder.pool?.end();
  });

  // ───────────────────────────────────── ciclo de vida ─────────────────────────────────────
  it("crear → editar → anular → reactivar: versiones 1..4, eventos append-only y totales exactos", async () => {
    const p = await plan({ tarifa: 1000 });
    const antesPlan = await filaPlan(p);

    const c1 = await nuevo(p, { concepto: "  Tiempo   de espera ", monto: "0.10", observacion: "  2 horas " });
    expect(c1).toMatchObject({ evento: "CREADO", idempotente: false, cargo: { concepto: "Tiempo de espera", monto: "0.10", observacion: "2 horas", activo: true, version: 1, creadoPor: 4 } });
    const c2 = await nuevo(p, { concepto: "Maniobra", monto: "0.20" });
    // 0.10 + 0.20 con Decimal = 0.30 exacto (no 0.30000000000000004).
    expect((await obtenerVistaCargosPlan(7, p))!.totales).toMatchObject({ cargosActivos: "0.30", cantidadActivos: 2, tarifaBase: "1000.00", totalComercial: "1000.30", ivaPendiente: true });

    const e = await editarCargoAdicional(B, { planId: p, cargoId: c1.cargo.id, versionEsperada: 1, monto: "250.50" });
    expect(e).toMatchObject({ evento: "EDITADO", cargo: { monto: "250.50", version: 2, actualizadoPor: 5 } });
    const an = await anularCargoAdicional(A, { planId: p, cargoId: c1.cargo.id, versionEsperada: 2, motivo: "  Cobro duplicado  " });
    expect(an).toMatchObject({ evento: "ANULADO", cargo: { activo: false, version: 3, anuladoPor: 4, motivoAnulacion: "Cobro duplicado" } });
    expect((await obtenerVistaCargosPlan(7, p))!.totales).toMatchObject({ cargosActivos: "0.20", cantidadActivos: 1, totalComercial: "1000.20" });
    const re = await reactivarCargoAdicional(B, { planId: p, cargoId: c1.cargo.id, versionEsperada: 3 });
    expect(re).toMatchObject({ evento: "REACTIVADO", cargo: { activo: true, version: 4, anuladoPor: null, motivoAnulacion: null } });

    const ev = (await listarEventosCargosPlan(7, p)).filter((x) => x.cargoId === c1.cargo.id).sort((a, b) => a.version - b.version);
    expect(ev.map((x) => [x.version, x.tipo, x.actorId])).toEqual([[1, "CREADO", 4], [2, "EDITADO", 5], [3, "ANULADO", 4], [4, "REACTIVADO", 5]]);
    expect(ev[2].motivo).toBe("Cobro duplicado");
    expect(ev[1].antes).toMatchObject({ monto: "0.10" });
    expect(ev[1].despues).toMatchObject({ monto: "250.50" });
    expect(c2.cargo.version).toBe(1);

    // Nunca borra: sigue la fila (anulada y reactivada) y el cargo no puede eliminarse con historia (ON DELETE RESTRICT).
    await expect(holder.pool!.execute("DELETE FROM tms_viaje_cargos_adicionales WHERE id = ?", [c1.cargo.id])).rejects.toMatchObject({ errno: 1451 });
    // Separación: los cargos NO modifican el plan ni la tarifa base.
    expect(await filaPlan(p)).toEqual(antesPlan);
    // Auditoría: una por cambio.
    expect(await conteo("auditoria", "accion LIKE 'cargo_adicional_%' AND detalle LIKE ?", [`Plan #${p} %`])).toBe(5); // 4 del cargo 1 + 1 del cargo 2
  });

  it("sin tarifa: el total comercial preliminar no inventa una base (null) y los cargos suman aparte", async () => {
    const p = await plan({ tarifa: null });
    await nuevo(p, { monto: "75" });
    expect((await obtenerVistaCargosPlan(7, p))!.totales).toMatchObject({ tarifaBase: null, totalComercial: null, cargosActivos: "75.00" });
  });

  it("validaciones: monto ≤ 0, > 2 decimales, no numérico, concepto vacío y motivo corto se rechazan sin escribir", async () => {
    const p = await plan();
    for (const monto of [0, -5, "10.005", "abc", "", "1e3", Number.NaN]) {
      expect(await codigo(nuevo(p, { monto })), String(monto)).toBe("SOLICITUD_INVALIDA");
    }
    expect(await codigo(nuevo(p, { concepto: "  " }))).toBe("SOLICITUD_INVALIDA");
    const c = await nuevo(p);
    expect(await codigo(anularCargoAdicional(A, { planId: p, cargoId: c.cargo.id, versionEsperada: 1, motivo: "no" }))).toBe("SOLICITUD_INVALIDA");
    expect(await conteo("tms_viaje_cargos_adicionales", "plan_id = ?", [p])).toBe(1);
    // CHECKs de BD (defensa en profundidad): monto 0 y anulado sin motivo.
    await expect(holder.pool!.execute(
      "INSERT INTO tms_viaje_cargos_adicionales (empresa_id, plan_id, concepto, monto, clave_envio, huella, creado_por) VALUES (7, ?, 'Espera', 0, ?, ?, 4)",
      [p, nuevaClaveEnvio(), "a".repeat(64)],
    )).rejects.toMatchObject({ errno: 4025 });
    await expect(holder.pool!.execute("UPDATE tms_viaje_cargos_adicionales SET activo = 0 WHERE id = ?", [c.cargo.id])).rejects.toMatchObject({ errno: 4025 });
  });

  // ───────────────────────────────────── idempotencia ─────────────────────────────────────
  it("idempotencia de creación: misma clave y contenido = mismo cargo; distinto contenido = conflicto", async () => {
    const p = await plan();
    const clave = nuevaClaveEnvio();
    const a = await crearCargoAdicional(A, { planId: p, concepto: "Desvío", monto: "90", claveEnvio: clave });
    const b = await crearCargoAdicional(A, { planId: p, concepto: "Desvío", monto: "90.00", claveEnvio: clave });
    expect(b).toMatchObject({ idempotente: true, evento: null, cargo: { id: a.cargo.id } });
    expect(await codigo(crearCargoAdicional(A, { planId: p, concepto: "Desvío", monto: "91", claveEnvio: clave }))).toBe("CONFLICTO_IDEMPOTENCIA");
    const otroPlan = await plan();
    expect(await codigo(crearCargoAdicional(A, { planId: otroPlan, concepto: "Desvío", monto: "90", claveEnvio: clave }))).toBe("CONFLICTO_IDEMPOTENCIA");
    expect(await conteo("tms_viaje_cargos_adicionales", "plan_id = ?", [p])).toBe(1);
    expect(await conteo("tms_viaje_cargo_eventos", "plan_id = ?", [p])).toBe(1);
  });

  it("idempotencia de edición/anulación: la réplica del mismo actor devuelve el mismo resultado sin evento nuevo", async () => {
    const p = await plan();
    const c = await nuevo(p);
    await editarCargoAdicional(A, { planId: p, cargoId: c.cargo.id, versionEsperada: 1, monto: "200" });
    const rep = await editarCargoAdicional(A, { planId: p, cargoId: c.cargo.id, versionEsperada: 1, monto: "200" });
    expect(rep).toMatchObject({ idempotente: true, evento: null, cargo: { version: 2 } });
    // Otro actor con versión vieja: conflicto de versión (no se pisa en silencio).
    expect(await codigo(editarCargoAdicional(B, { planId: p, cargoId: c.cargo.id, versionEsperada: 1, monto: "999" }))).toBe("CONFLICTO_VERSION");
    await anularCargoAdicional(A, { planId: p, cargoId: c.cargo.id, versionEsperada: 2, motivo: "Error de captura" });
    expect(await anularCargoAdicional(A, { planId: p, cargoId: c.cargo.id, versionEsperada: 2, motivo: "Error de captura" })).toMatchObject({ idempotente: true, evento: null });
    expect(await conteo("tms_viaje_cargo_eventos", "cargo_id = ?", [c.cargo.id])).toBe(3);
  });

  // ───────────────────────────── reglas por estado (secuencia confirmada) ─────────────────────────────
  it("EDITABLES: viaje abierto no liquidado, Cerrado + REPORTE_RECIBIDO, Cerrado sin liquidación y Cerrado + EN_AJUSTE", async () => {
    // abierto sin liquidación registrada
    const abierto = await plan({ estado: "En ruta" });
    expect((await nuevo(abierto)).evento).toBe("CREADO");
    // abierto + REPORTE_RECIBIDO
    const abiertoRep = await plan();
    await confirmarReporteRecibido(L(A), { planId: abiertoRep });
    expect((await nuevo(abiertoRep)).evento).toBe("CREADO");
    // Cerrado + REPORTE_RECIBIDO
    const cerRep = await cerradoConReporte();
    const c = await nuevo(cerRep);
    expect(c.evento).toBe("CREADO");
    expect((await editarCargoAdicional(A, { planId: cerRep, cargoId: c.cargo.id, versionEsperada: 1, monto: "10" })).evento).toBe("EDITADO");
    // Cerrado SIN liquidación registrada (histórico): no está liquidado → editable
    const cerSin = await plan({ estado: "Cerrado" });
    expect((await nuevo(cerSin)).evento).toBe("CREADO");
    // El viaje sigue Cerrado: los cargos no reabren nada.
    expect((await filaPlan(cerRep)).estado).toBe("Cerrado");
  });

  it("LIQUIDADO bloquea crear/editar/anular/reactivar; reabrir la liquidación (viaje sigue Cerrado) vuelve a permitirlo; re-liquidado bloquea", async () => {
    const p = await cerradoConReporte();
    const c = await nuevo(p, { monto: "300" });
    const c2 = await nuevo(p, { concepto: "Maniobra", monto: "50" });
    await anularCargoAdicional(A, { planId: p, cargoId: c2.cargo.id, versionEsperada: 1, motivo: "Se retira el cargo" });

    const liq = await leerLiquidacionPlan(7, p);
    await liquidarViaje(L(B), { planId: p, versionEsperada: liq!.version });
    const bloqueado = "LIQUIDACION_CERRADA";
    expect(await codigo(nuevo(p))).toBe(bloqueado);
    expect(await codigo(editarCargoAdicional(A, { planId: p, cargoId: c.cargo.id, versionEsperada: 1, monto: "1" }))).toBe(bloqueado);
    expect(await codigo(anularCargoAdicional(A, { planId: p, cargoId: c.cargo.id, versionEsperada: 1, motivo: "Motivo válido" }))).toBe(bloqueado);
    expect(await codigo(reactivarCargoAdicional(A, { planId: p, cargoId: c2.cargo.id, versionEsperada: 2 }))).toBe(bloqueado);
    expect((await obtenerVistaCargosPlan(7, p))!.edicion).toMatchObject({ editable: false, codigo: bloqueado });
    // Nada cambió.
    expect((await listarCargosPlan(7, p)).map((x) => [x.id, x.monto, x.activo, x.version])).toEqual([
      [c.cargo.id, "300.00", true, 1],
      [c2.cargo.id, "50.00", false, 2],
    ]);

    // Reabrir liquidación: Cerrado + EN_AJUSTE → editable SIN reabrir el viaje.
    const l2 = await leerLiquidacionPlan(7, p);
    await reabrirLiquidacion(L(A), { planId: p, versionEsperada: l2!.version, motivo: "Falta un cargo de espera" });
    expect((await filaPlan(p)).estado).toBe("Cerrado");
    expect((await obtenerVistaCargosPlan(7, p))!.edicion.editable).toBe(true);
    const nuevoCargo = await nuevo(p, { concepto: "Estadía", monto: "120" });
    expect(nuevoCargo.evento).toBe("CREADO");

    // Re-liquidar: el snapshot del RELIQUIDADO congela el cargo agregado en ajuste; vuelve a bloquear.
    const l3 = await leerLiquidacionPlan(7, p);
    await liquidarViaje(L(B), { planId: p, versionEsperada: l3!.version });
    expect(await codigo(nuevo(p))).toBe(bloqueado);
    const ev = await listarEventosLiquidacion(7, p);
    const reliq = ev.find((e) => e.tipo === "RELIQUIDADO")!;
    const snap = (reliq.snapshot as unknown as { cargos?: { vigentes: { concepto: string }[]; total: string; ivaPendiente: boolean } }) ?? {};
    expect(snap).toBeTruthy();
    const filaEv = await sql<RowDataPacket>("SELECT snapshot_json FROM tms_viaje_liquidacion_eventos WHERE plan_id = ? AND tipo = 'RELIQUIDADO'", [p]);
    const completo = JSON.parse(String(filaEv[0].snapshot_json)) as { operativo: { cargos?: { vigentes: { concepto: string; monto: string }[]; total: string; ivaPendiente: boolean } } };
    expect(completo.operativo.cargos).toMatchObject({ total: "420.00", ivaPendiente: true });
    expect(completo.operativo.cargos!.vigentes.map((v) => v.concepto)).toEqual(["Tiempo de espera", "Estadía"]); // el anulado no entra
  });

  it("Cancelado no admite cargos", async () => {
    const p = await plan({ estado: "Cancelado" });
    expect(await codigo(nuevo(p))).toBe("PLAN_NO_ADMITE");
  });

  // ───────────────────────────────────── multiempresa ─────────────────────────────────────
  it("aislamiento por empresa: otro tenant no ve, no crea, no edita, no anula y no cuenta cargos ajenos", async () => {
    const p = await plan(); // empresa 7
    const c = await nuevo(p);
    expect(await codigo(nuevo(p, {}, OTRA))).toBe("NO_ENCONTRADO");
    expect(await codigo(editarCargoAdicional(OTRA, { planId: p, cargoId: c.cargo.id, versionEsperada: 1, monto: "1" }))).toBe("NO_ENCONTRADO");
    expect(await codigo(anularCargoAdicional(OTRA, { planId: p, cargoId: c.cargo.id, versionEsperada: 1, motivo: "Motivo válido" }))).toBe("NO_ENCONTRADO");
    expect(await codigo(reactivarCargoAdicional(OTRA, { planId: p, cargoId: c.cargo.id, versionEsperada: 1 }))).toBe("NO_ENCONTRADO");
    expect(await listarCargosPlan(8, p)).toEqual([]);
    expect(await listarEventosCargosPlan(8, p)).toEqual([]);
    expect(await obtenerVistaCargosPlan(8, p)).toBeNull();
    expect((await resumenCargosDePlanes(8, [p])).size).toBe(0);
    // Un cargo de un viaje no se alcanza usando el id de OTRO viaje de la misma empresa.
    const otroPlan = await plan();
    expect(await codigo(editarCargoAdicional(A, { planId: otroPlan, cargoId: c.cargo.id, versionEsperada: 1, monto: "1" }))).toBe("NO_ENCONTRADO");
    // El resumen cuenta solo activos de la empresa y trae la moneda del viaje.
    const eur = await plan({ moneda: "USD" });
    await nuevo(eur, { monto: "10" });
    const r = await resumenCargosDePlanes(7, [p, eur, 99999]);
    expect(r.get(p)).toMatchObject({ cantidad: 1, total: "150.00", moneda: "GTQ" });
    expect(r.get(eur)).toMatchObject({ cantidad: 1, total: "10.00", moneda: "USD" });
    expect(r.has(99999)).toBe(false);
  });

  // ───────────────────────────────────── concurrencia ─────────────────────────────────────
  it("dos ediciones simultáneas con la misma versión: una gana y la otra recibe conflicto; sin eventos duplicados", async () => {
    const p = await plan();
    const c = await nuevo(p);
    const res = await Promise.all([
      codigo(editarCargoAdicional(A, { planId: p, cargoId: c.cargo.id, versionEsperada: 1, monto: "111" })),
      codigo(editarCargoAdicional(B, { planId: p, cargoId: c.cargo.id, versionEsperada: 1, monto: "222" })),
    ]);
    expect(res.sort()).toEqual(["CONFLICTO_VERSION", "OK"]);
    expect(await conteo("tms_viaje_cargo_eventos", "cargo_id = ?", [c.cargo.id])).toBe(2);
    expect((await listarCargosPlan(7, p))[0].version).toBe(2);
  });

  it("doble clic en crear (misma clave en paralelo): un solo cargo", async () => {
    const p = await plan();
    const clave = nuevaClaveEnvio();
    const r = await Promise.all(
      Array.from({ length: 5 }, () => codigo(crearCargoAdicional(A, { planId: p, concepto: "Desvío", monto: "40", claveEnvio: clave }))),
    );
    expect(r.every((x) => x === "OK")).toBe(true);
    expect(await conteo("tms_viaje_cargos_adicionales", "plan_id = ?", [p])).toBe(1);
    expect(await conteo("tms_viaje_cargo_eventos", "plan_id = ?", [p])).toBe(1);
  });

  it("carrera crear cargo vs liquidar: si el cargo se crea, QUEDA en el snapshot; si la liquidación gana, el cargo se rechaza", async () => {
    for (let i = 0; i < 12; i++) {
      const p = await cerradoConReporte();
      const liq = await leerLiquidacionPlan(7, p);
      const [rCargo, rLiq] = await Promise.all([
        codigo(nuevo(p, { monto: "77" })),
        codigo(liquidarViaje(L(B), { planId: p, versionEsperada: liq!.version })),
      ]);
      expect(rLiq).toBe("OK");
      const fila = await sql<RowDataPacket>("SELECT snapshot_json FROM tms_viaje_liquidacion_eventos WHERE plan_id = ? AND tipo = 'LIQUIDADO'", [p]);
      const cargos = (JSON.parse(String(fila[0].snapshot_json)) as { operativo: { cargos?: { vigentes: unknown[] } } }).operativo.cargos;
      const enBD = await conteo("tms_viaje_cargos_adicionales", "plan_id = ?", [p]);
      if (rCargo === "OK") {
        expect(cargos?.vigentes.length, `iteración ${i}`).toBe(1); // creado antes de liquidar ⇒ congelado en el snapshot
        expect(enBD).toBe(1);
      } else {
        expect(rCargo, `iteración ${i}`).toBe("LIQUIDACION_CERRADA"); // liquidar ganó el lock ⇒ cargo rechazado
        expect(cargos?.vigentes.length).toBe(0);
        expect(enBD).toBe(0);
      }
    }
  });

  // ───────────────────────────────────── alcance ─────────────────────────────────────
  it("no escribe en cierre, facturación, FEL, contabilidad, fondos ni gastos, ni cambia la liquidación", async () => {
    const p = await cerradoConReporte();
    const antesLiq = await leerLiquidacionPlan(7, p);
    const antesPlan = await filaPlan(p);
    const c = await nuevo(p);
    await editarCargoAdicional(A, { planId: p, cargoId: c.cargo.id, versionEsperada: 1, concepto: "Otro concepto" });
    await anularCargoAdicional(A, { planId: p, cargoId: c.cargo.id, versionEsperada: 2, motivo: "Motivo válido" });
    await reactivarCargoAdicional(A, { planId: p, cargoId: c.cargo.id, versionEsperada: 3 });
    for (const t of ["fact_factura_viajes", "fel_documentos", "cont_eventos", "tms_solicitud_fondo_lineas", "tms_gastos_operativos"]) {
      expect(await conteo(t), t).toBe(0);
    }
    expect(await leerLiquidacionPlan(7, p)).toEqual(antesLiq);
    expect(await filaPlan(p)).toEqual(antesPlan);
  });
});
