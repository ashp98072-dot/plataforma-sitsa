// FONDOS DIARIOS (Fase 2) contra MariaDB 11.8.9 REAL y desechable (pipe sin red). Se omite sin CB2_587_PIPE.
// FASE 3 — «Otros fondos del viaje». Aplica las MIGRACIONES REALES (Fase 2 y Fase 3, cada una dos veces) y ejercita el servicio REAL. Aplica la MIGRACIÓN REAL (sql/migrate-2026-11-fondos-diarios.sql, dos veces: idempotencia) sobre un esquema mínimo con las FK reales y ejecuta el servicio REAL
// (sincronizarFondosDePlanes) y la edición/autorización reales de Fondos: agrupación, ausencia de duplicados, concurrencia, sincronización diferencial, solicitudes autorizadas y complementarias.
import { readFileSync } from "node:fs";
import path from "node:path";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 120000, hookTimeout: 120000 });
const pipe = process.env.CB2_587_PIPE ?? "";
const LAB = "fondos_diarios";
const BARRA = String.fromCharCode(92);

vi.mock("@/lib/db", async () => {
  const mysqlReal = await import("mysql2/promise");
  let pool: ReturnType<typeof mysqlReal.createPool> | null = null;
  const obtener = () => {
    if (!pool) { const b = String.fromCharCode(92); pool = mysqlReal.createPool({ socketPath: `${b}${b}.${b}pipe${b}${process.env.CB2_587_PIPE}`, user: "root", password: "", database: "fondos_diarios", connectionLimit: 12 }); }
    return pool;
  };
  return {
    getPool: obtener,
    query: async (sql: string, params: unknown[] = []) => (await obtener().query(sql, params as never))[0],
    execute: async (sql: string, params: unknown[] = []) => (await obtener().execute(sql, params as never))[0],
  };
});
vi.mock("@/lib/firmas/usuario-firmas", () => ({ leerBytesFirmaGuardada: vi.fn(async () => null) }));
vi.mock("@/lib/firmas/firmas-internas", () => ({ crearFirmaInterna: vi.fn(async () => ({ id: 1 })) }));
vi.mock("@/lib/uploads", () => ({ guardarUpload: vi.fn(async () => ({ relative: "empresas/1/firmas/f.png", original: "f.png", size: 3 })), borrarUpload: vi.fn() }));

import { getPool } from "@/lib/db";
import { listarOtrosFondosDePlanes, otrosFondosInstalado, otrosFondosSchema, reemplazarOtrosFondosTx, reiniciarDeteccionOtrosFondos, sugerirDestinoPago, type OtroFondoEntrada } from "./plan-otros-fondos";
import { actualizarSolicitudFondo } from "./fondos";
import { fondosDiariosInstalado, reiniciarDeteccionFondosDiarios, sincronizarFondosDePlanes, type ActorFondosDiarios } from "./fondos-diarios";

let admin: mysql.Connection;
const E = 1, KT = 1, MONACO = 2;
const OPS: ActorFondosDiarios = { usuarioId: 10, nombre: "Operador Uno", username: "ops" };
const DIA = "2026-12-01";

const DDL = `
CREATE TABLE empresas(id INT PRIMARY KEY) ENGINE=InnoDB;
CREATE TABLE usuarios(id INT PRIMARY KEY, nombre VARCHAR(100), rol_global VARCHAR(40), activo TINYINT NOT NULL DEFAULT 1, acceso_todas_empresas TINYINT NOT NULL DEFAULT 1) ENGINE=InnoDB;
CREATE TABLE usuario_empresa(usuario_id INT NOT NULL, empresa_id INT NOT NULL, PRIMARY KEY(usuario_id, empresa_id)) ENGINE=InnoDB;
CREATE TABLE cont_entidades(id INT PRIMARY KEY, empresa_id INT NOT NULL, codigo VARCHAR(40) NOT NULL, nombre VARCHAR(200) NOT NULL, activa TINYINT NOT NULL DEFAULT 1, UNIQUE KEY uq_ent(empresa_id, id)) ENGINE=InnoDB;
CREATE TABLE empleados(id INT PRIMARY KEY, empresa_id INT NOT NULL, nombre VARCHAR(200), puesto VARCHAR(100), cuenta_bancaria VARCHAR(30), telefono VARCHAR(20), estado VARCHAR(20) NOT NULL DEFAULT 'Activo', UNIQUE KEY uq_emp(empresa_id, id)) ENGINE=InnoDB;
CREATE TABLE tms_clientes(id INT PRIMARY KEY, empresa_id INT NOT NULL, nombre VARCHAR(200), UNIQUE KEY uq_cli(empresa_id, id)) ENGINE=InnoDB;
CREATE TABLE flota_vehiculos(id INT PRIMARY KEY, placa VARCHAR(20)) ENGINE=InnoDB;
CREATE TABLE tms_unidades(id INT PRIMARY KEY, empresa_id INT NOT NULL, placa VARCHAR(20), flota_vehiculo_id INT NULL) ENGINE=InnoDB;
CREATE TABLE tms_personal(id INT PRIMARY KEY, empresa_id INT NOT NULL, nombre VARCHAR(200), id_empleado INT NULL) ENGINE=InnoDB;
CREATE TABLE tms_planes_viaje(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, codigo VARCHAR(40) NOT NULL, cliente_id INT NULL, unidad_id INT NULL, fecha_plan DATE NOT NULL, hora_carga VARCHAR(20) NULL,
  estado VARCHAR(40) NOT NULL DEFAULT 'Programado', tipo_viaje VARCHAR(20) NOT NULL DEFAULT 'Propio', UNIQUE KEY uq_tmsplanes_empresa_id(empresa_id, id)) ENGINE=InnoDB;
CREATE TABLE tms_viaticos(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, plan_id INT NOT NULL, personal_id INT NOT NULL, rol VARCHAR(20) NOT NULL, monto_asignado DECIMAL(12,2) NOT NULL DEFAULT 0,
  estado VARCHAR(30) NOT NULL DEFAULT 'PROGRAMADO', UNIQUE KEY uq_viatico_plan_personal(plan_id, personal_id)) ENGINE=InnoDB;
CREATE TABLE tms_solicitudes_fondo(
  id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, codigo VARCHAR(40) NOT NULL, entidad_requirente_id INT NULL, entidad_requirente_nombre VARCHAR(200) NULL,
  requirente_empleado_id INT NULL, requirente_nombre VARCHAR(200) NULL, requirente_usuario_id INT NULL, fecha_requerimiento DATE NOT NULL, total DECIMAL(12,2) NOT NULL DEFAULT 0,
  autorizante_empleado_id INT NULL, autorizante_nombre VARCHAR(200) NULL, autorizante_usuario_id INT NULL, estado VARCHAR(30) NOT NULL DEFAULT 'Pendiente',
  autorizado_en DATETIME NULL, rechazado_en DATETIME NULL, motivo_rechazo VARCHAR(300) NULL, liquidado_en DATETIME NULL, observaciones VARCHAR(300) NULL, creado_por VARCHAR(100) NULL,
  solicitante_usuario_id INT NULL, solicitante_nombre VARCHAR(200) NULL, creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fondo_codigo(empresa_id, codigo), UNIQUE KEY uq_fondo_empresa_id(empresa_id, id),
  CONSTRAINT fk_fondo_entidad_requirente_ambito FOREIGN KEY (empresa_id, entidad_requirente_id) REFERENCES cont_entidades (empresa_id, id) ON DELETE RESTRICT) ENGINE=InnoDB;
CREATE TABLE tms_solicitud_fondo_lineas(
  id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, solicitud_id INT NOT NULL, categoria VARCHAR(40) NOT NULL, descripcion VARCHAR(300) NULL,
  cantidad DECIMAL(10,2) NOT NULL DEFAULT 1, monto DECIMAL(12,2) NOT NULL, fecha_viaje DATE NULL, empleado_id INT NULL, empleado_nombre VARCHAR(200) NULL, cargo VARCHAR(100) NULL,
  cuenta VARCHAR(30) NULL, metodo_pago VARCHAR(40) NULL, vehiculo_id INT NULL, placa VARCHAR(20) NULL, cliente_id INT NULL, cliente_nombre VARCHAR(200) NULL, plan_id INT NULL, orden INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_fondolin_c2a_empresa_id(empresa_id, id),
  CONSTRAINT fk_fondolin_solicitud_ambito FOREIGN KEY(empresa_id, solicitud_id) REFERENCES tms_solicitudes_fondo(empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_fondolin_empleado_ambito FOREIGN KEY(empresa_id, empleado_id) REFERENCES empleados(empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_fondolin_vehiculo FOREIGN KEY(vehiculo_id) REFERENCES flota_vehiculos(id) ON DELETE RESTRICT,
  CONSTRAINT fk_fondolin_cliente_ambito FOREIGN KEY(empresa_id, cliente_id) REFERENCES tms_clientes(empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_fondolin_plan_ambito FOREIGN KEY(empresa_id, plan_id) REFERENCES tms_planes_viaje(empresa_id, id) ON DELETE RESTRICT) ENGINE=InnoDB;
CREATE TABLE auditoria(id BIGINT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NULL, usuario VARCHAR(100) NULL, accion VARCHAR(80) NOT NULL, modulo VARCHAR(40) NULL, detalle TEXT NULL, creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB;`;

const R = async (sql: string) => (await admin.query<RowDataPacket[]>(sql))[0];
const N = async (sql: string) => Number((await R(sql))[0].n);
const sql = (f: string) => readFileSync(path.join("sql", f), "utf8").replace(/^﻿/, "");

/** Viaje con sus viáticos: [personal, monto]. Devuelve el id del viaje. */
async function viaje(fecha: string, entidad: number | null, viaticos: [number, number][], extra: { codigo?: string; estado?: string; tipo?: string } = {}) {
  const [r] = await admin.query<mysql.ResultSetHeader>("INSERT INTO tms_planes_viaje(empresa_id, codigo, cliente_id, unidad_id, fecha_plan, estado, tipo_viaje, entidad_requirente_id) VALUES (?, ?, 5, 60, ?, ?, ?, ?)",
    [E, extra.codigo ?? `PLAN-${Math.random().toString(36).slice(2, 8)}`, fecha, extra.estado ?? "Programado", extra.tipo ?? "Propio", entidad]);
  for (const [personal, monto] of viaticos) await admin.query("INSERT INTO tms_viaticos(empresa_id, plan_id, personal_id, rol, monto_asignado) VALUES (?, ?, ?, 'Piloto', ?)", [E, r.insertId, personal, monto]);
  return r.insertId;
}
/** Como lo hace Programación: el viaje ya está confirmado y la sincronización corre en su propia transacción. */
const sincronizar = (planIds: number[], actor = OPS) => sincronizarFondosDePlanes(E, planIds, actor);
const principales = (fecha = DIA, entidad = KT) => R(`SELECT id, codigo, estado, tipo, origen, requirente_usuario_id, total FROM tms_solicitudes_fondo WHERE empresa_id = ${E} AND fecha_requerimiento = '${fecha}' AND entidad_requirente_id = ${entidad} AND tipo = 'PRINCIPAL' ORDER BY id`);
const lineasDe = (solicitud: number) => R(`SELECT id, categoria, monto, orden, origen, viatico_id, plan_id, empleado_id, empleado_nombre, cuenta, metodo_pago FROM tms_solicitud_fondo_lineas WHERE solicitud_id = ${solicitud} ORDER BY orden, id`);

/** Como Programación: los otros fondos se guardan en la transacción del viaje (aquí, una transacción propia por llamada). */
const guardarOtros = async (planId: number, items: OtroFondoEntrada[]) => {
  const c = await getPool().getConnection();
  try { await c.beginTransaction(); const n = await reemplazarOtrosFondosTx(c, E, planId, items, "ops"); await c.commit(); return n; }
  catch (e) { await c.rollback(); throw e; } finally { c.release(); }
};
const otrosDe = (planId: number) => R(`SELECT id, categoria, monto, descripcion, empleado_id, metodo_pago, cuenta, pago_pendiente_sync FROM tms_plan_otros_fondos WHERE plan_id = ${planId} ORDER BY id`);
const HOSPEDAJE: OtroFondoEntrada = { categoria: "Hospedaje", monto: 300, descripcion: "Hotel 1 noche", empleadoId: 101, metodoPago: "Transferencia" };
const PEAJE: OtroFondoEntrada = { categoria: "Peajes", monto: 50.5, empleadoId: 100, metodoPago: "Efectivo" };
const autorizar = (id: unknown) => admin.query("UPDATE tms_solicitudes_fondo SET estado = 'Autorizada', autorizado_en = NOW() WHERE id = ?", [id]);

describe.skipIf(!pipe)("fondos diarios Fase 3: otros fondos del viaje (MariaDB 11.8.9)", () => {
  beforeAll(async () => {
    if (!/^cb2-587-[0-9a-f-]{36}$/.test(pipe)) throw Error("PIPE no autorizado");
    admin = await mysql.createConnection({ socketPath: `${BARRA}${BARRA}.${BARRA}pipe${BARRA}${pipe}`, user: "root", password: "", multipleStatements: true });
    const [[v]] = await admin.query<RowDataPacket[]>("SELECT VERSION() v"); expect(v.v).toMatch(/^11\.8\.9-MariaDB/);
    await admin.query(`DROP DATABASE IF EXISTS ${LAB}; CREATE DATABASE ${LAB} CHARACTER SET utf8mb4; USE ${LAB}`);
    await admin.query(DDL);
  });
  afterAll(async () => { await admin?.query(`DROP DATABASE IF EXISTS ${LAB}`).catch(() => undefined); await admin?.end(); });

  const sembrar = async () => {
    if (await N("SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tms_plan_otros_fondos'")) await admin.query("DELETE FROM tms_plan_otros_fondos");
    await admin.query(`USE ${LAB}; SET FOREIGN_KEY_CHECKS=0; DELETE FROM tms_solicitud_fondo_lineas; DELETE FROM tms_solicitudes_fondo; DELETE FROM tms_viaticos; DELETE FROM tms_planes_viaje; DELETE FROM auditoria; DELETE FROM tms_personal; DELETE FROM tms_unidades;
      DELETE FROM tms_clientes; DELETE FROM empleados; DELETE FROM cont_entidades; DELETE FROM usuarios; DELETE FROM usuario_empresa; DELETE FROM flota_vehiculos; DELETE FROM empresas; SET FOREIGN_KEY_CHECKS=1`);
    await admin.query(`INSERT INTO empresas VALUES (1), (2);
      INSERT INTO cont_entidades VALUES (1, 1, 'KT', 'Kuiqtrans', 1), (2, 1, 'MONACO', 'Logiservicios Mónaco', 1), (3, 1, 'OTRA', 'Otra entidad', 1), (9, 2, 'KT', 'Kuiqtrans E2', 1);
      INSERT INTO usuarios VALUES (10, 'Operador Uno', 'Operaciones', 1, 1), (11, 'Administrador', 'Admin', 1, 1), (12, 'Jefe', 'JefeOperaciones', 1, 1);
      INSERT INTO empleados (id, empresa_id, nombre, puesto, cuenta_bancaria, telefono) VALUES (100, 1, 'Juan Pérez', 'Piloto', '1111111111', NULL), (101, 1, 'Ana López', 'Auxiliar', '2222222222', NULL), (102, 1, 'Beto Ruiz', 'Piloto', NULL, '55550000'), (103, 1, 'Carla Mora', 'Mecánico', '3333333333', '55551111');
      INSERT INTO tms_clientes VALUES (5, 1, 'Cliente Cinco'); INSERT INTO flota_vehiculos VALUES (50, 'P-1'); INSERT INTO tms_unidades VALUES (60, 1, 'P-1', 50);
      INSERT INTO tms_personal VALUES (200, 1, 'Juan Pérez', 100), (201, 1, 'Ana López', 101), (202, 1, 'Beto Ruiz', 102), (203, 1, 'Sin ficha de RRHH', NULL)`);
  };


  it("MIGRACIÓN Fase 3: sin ella los otros fondos están apagados y los viáticos siguen sincronizando; la migración es IDEMPOTENTE (dos veces) y la enciende; la restricción exige el origen coherente", async () => {
    await sembrar();
    await admin.query(sql("migrate-2026-11-fondos-diarios.sql"));   // solo Fase 2
    reiniciarDeteccionFondosDiarios(); reiniciarDeteccionOtrosFondos();
    expect(await fondosDiariosInstalado()).toBe(true); expect(await otrosFondosInstalado()).toBe(false);
    const v0 = await viaje(DIA, KT, [[200, 150]]); await sincronizar([v0]);
    expect(await N("SELECT COUNT(*) n FROM tms_solicitud_fondo_lineas WHERE origen = 'AUTO_VIATICO'")).toBe(1);   // sin la tabla de otros fondos, los viáticos NO se rompen
    for (let k = 0; k < 2; k++) await admin.query(sql("migrate-2026-12-fondos-otros.sql"));
    await admin.query(sql("migrate-2026-11-fondos-diarios.sql"));   // reaplicar la Fase 2 NO degrada la restricción
    reiniciarDeteccionOtrosFondos(); expect(await otrosFondosInstalado()).toBe(true);
    await expect(admin.query("INSERT INTO tms_solicitud_fondo_lineas(empresa_id, solicitud_id, categoria, monto, origen) SELECT empresa_id, solicitud_id, 'X', 1, 'AUTO_OTRO' FROM tms_solicitud_fondo_lineas LIMIT 1")).rejects.toThrow();   // AUTO_OTRO sin otro_fondo_id
    await expect(admin.query("INSERT INTO tms_solicitud_fondo_lineas(empresa_id, solicitud_id, categoria, monto, origen, viatico_id, otro_fondo_id) SELECT empresa_id, solicitud_id, 'X', 1, 'AUTO_VIATICO', 99, 99 FROM tms_solicitud_fondo_lineas LIMIT 1")).rejects.toThrow();   // ambos
  });

  beforeEach(async () => { if (await N("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'otro_fondo_id'")) await sembrar(); });

  it("VALIDACIÓN: «Viáticos» no es categoría de otros fondos (no se paga dos veces); monto, método y beneficiario se validan; Peajes existe en el catálogo", () => {
    expect(otrosFondosSchema.safeParse([{ ...HOSPEDAJE, categoria: "Viáticos" }]).success).toBe(false);
    expect(otrosFondosSchema.safeParse([{ ...HOSPEDAJE, categoria: "Reintegro de gastos" }]).success).toBe(false);
    expect(otrosFondosSchema.safeParse([{ ...HOSPEDAJE, monto: 0 }]).success).toBe(false);
    expect(otrosFondosSchema.safeParse([{ ...HOSPEDAJE, monto: 10.123 }]).success).toBe(false);
    expect(otrosFondosSchema.safeParse([{ ...HOSPEDAJE, metodoPago: "Bitcoin" }]).success).toBe(false);
    expect(otrosFondosSchema.safeParse([HOSPEDAJE, PEAJE]).success).toBe(true);
    expect(otrosFondosSchema.safeParse([{ ...HOSPEDAJE, id: 5 }, { ...PEAJE, id: 5 }]).success).toBe(false);
  });

  it("CONSOLIDACIÓN: viáticos y otros fondos del mismo viaje van a UNA sola solicitud diaria; hereda unidad, cliente, fecha y viaje; la cuenta se sugiere desde RRHH", async () => {
    const v = await viaje(DIA, KT, [[200, 150]]);
    await guardarOtros(v, [HOSPEDAJE, PEAJE]); await sincronizar([v]);
    const ps = await principales(); expect(ps).toHaveLength(1);
    const lin = await lineasDe(Number(ps[0].id)); expect(lin).toHaveLength(3);
    expect(lin.map((l) => [l.origen, l.categoria, Number(l.monto)]).sort()).toEqual([["AUTO_OTRO", "Hospedaje", 300], ["AUTO_OTRO", "Peajes", 50.5], ["AUTO_VIATICO", "Viáticos", 150]]);
    const [h] = await R("SELECT l.*, DATE_FORMAT(l.fecha_viaje, '%Y-%m-%d') f FROM tms_solicitud_fondo_lineas l WHERE l.categoria = 'Hospedaje'");
    expect(h).toMatchObject({ plan_id: v, vehiculo_id: 50, placa: "P-1", cliente_id: 5, cliente_nombre: "Cliente Cinco", empleado_id: 101, metodo_pago: "Transferencia", cuenta: "2222222222", f: DIA });
    expect(Number(ps[0].total)).toBe(500.5);
    expect((await sugerirDestinoPago(E, 102, "Transferencia móvil"))?.destino).toBe("55550000");
    expect(await sugerirDestinoPago(2, 101, "Transferencia")).toBeNull();   // otra empresa: no ve el empleado
    // un beneficiario de OTRA empresa o inexistente se rechaza
    await expect(guardarOtros(v, [{ ...HOSPEDAJE, empleadoId: 9999 }])).rejects.toThrow(/beneficiario/);
    expect(await otrosDe(v)).toHaveLength(2);   // el rechazo no dejó nada a medias
  });

  it("IDEMPOTENCIA y CONCURRENCIA: repetir/concurrir la sincronización no crea solicitudes ni líneas nuevas y conserva los ids; guardar la misma lista no cambia nada", async () => {
    const v = await viaje(DIA, KT, [[200, 150]]); await guardarOtros(v, [HOSPEDAJE]); await sincronizar([v]);
    const [p] = await principales(); const antes = JSON.stringify(await lineasDe(Number(p.id)));
    await Promise.all([1, 2, 3, 4, 5, 6].map(() => sincronizar([v])));
    expect(JSON.stringify(await lineasDe(Number(p.id)))).toBe(antes);
    const [o] = await otrosDe(v); expect(await guardarOtros(v, [{ ...HOSPEDAJE, id: Number(o.id), cuenta: "2222222222" }])).toBe(0);
    expect((await sincronizar([v])).cambios).toBe(0);
    expect(await N("SELECT COUNT(*) n FROM tms_solicitudes_fondo")).toBe(1);
    expect(await N("SELECT COUNT(*) n FROM (SELECT otro_fondo_id FROM tms_solicitud_fondo_lineas WHERE otro_fondo_id IS NOT NULL GROUP BY solicitud_id, otro_fondo_id HAVING COUNT(*) > 1) d")).toBe(0);
  });

  it("SINCRONIZACIÓN DIFERENCIAL: el monto/categoría/beneficiario siguen al origen conservando el id de la línea; método y cuenta editados en Fondos se CONSERVAN; si cambian en Programación se aplican; se retira lo que se quita", async () => {
    const v = await viaje(DIA, KT, [[200, 150]]); await guardarOtros(v, [HOSPEDAJE, PEAJE]); await sincronizar([v]);
    const [p] = await principales(); const [h0] = (await lineasDe(Number(p.id))).filter((l) => l.categoria === "Hospedaje");
    // «Fondos» edita método de pago y cuenta de la línea automática
    await actualizarSolicitudFondo(E, Number(p.id), { lineas: [...(await lineasDe(Number(p.id))).map((l) => ({ id: Number(l.id), categoria: String(l.categoria), monto: Number(l.monto), empleadoId: Number(l.empleado_id), planId: v,
      ...(l.id === h0.id ? { metodoPago: "Transferencia", cuentaOverride: "7777777777" } : {}) }))] }, "ops");
    const [oh, op] = await otrosDe(v);
    await guardarOtros(v, [{ ...HOSPEDAJE, id: Number(oh.id), monto: 450, cuenta: "2222222222" }, { ...PEAJE, id: Number(op.id) }]);   // solo cambia el monto; el pago de Programación no cambió
    await sincronizar([v]);
    const [h1] = (await lineasDe(Number(p.id))).filter((l) => l.categoria === "Hospedaje");
    expect(h1.id).toBe(h0.id); expect(Number(h1.monto)).toBe(450); expect(h1.cuenta).toBe("7777777777");   // se conserva lo editado en Fondos
    // el pago cambia en Programación → se refleja en la línea pendiente y se limpia la marca
    await guardarOtros(v, [{ ...HOSPEDAJE, id: Number(oh.id), monto: 450, metodoPago: "Transferencia móvil", cuenta: "55551234" }, { ...PEAJE, id: Number(op.id) }]);
    expect(Number((await otrosDe(v))[0].pago_pendiente_sync)).toBe(1);
    await sincronizar([v]);
    const [h2] = (await lineasDe(Number(p.id))).filter((l) => l.categoria === "Hospedaje");
    expect([h2.id === h0.id, h2.metodo_pago, h2.cuenta]).toEqual([true, "Transferencia móvil", "55551234"]);
    expect(Number((await otrosDe(v))[0].pago_pendiente_sync)).toBe(0);
    // cambiar de beneficiario / categoría actualiza la misma línea
    await guardarOtros(v, [{ categoria: "Parqueo", monto: 450, empleadoId: 100, metodoPago: "Efectivo", id: Number(oh.id) }, { ...PEAJE, id: Number(op.id) }]); await sincronizar([v]);
    const [h3] = (await lineasDe(Number(p.id))).filter((l) => l.id === h0.id);
    expect([h3.categoria, h3.empleado_id, h3.metodo_pago]).toEqual(["Parqueo", 100, "Efectivo"]);
    // retirar un otro fondo retira su línea pendiente; la solicitud conserva el resto
    await guardarOtros(v, [{ ...PEAJE, id: Number(op.id) }]); await sincronizar([v]);
    expect((await lineasDe(Number(p.id))).map((l) => String(l.categoria)).sort()).toEqual(["Peajes", "Viáticos"]);
    expect(Number((await principales())[0].total)).toBe(200.5);
    // sin otros fondos ni viáticos la solicitud diaria pendiente se retira
    await guardarOtros(v, []); await admin.query("DELETE FROM tms_viaticos WHERE plan_id = ?", [v]); await sincronizar([v]);
    expect(await principales()).toHaveLength(0);
  });

  it("PROTECCIÓN en Fondos: la línea de otro fondo no permite cambiar monto, beneficiario ni categoría ni retirarla; SÍ método de pago y cuenta", async () => {
    const v = await viaje(DIA, KT, []); await guardarOtros(v, [HOSPEDAJE]); await sincronizar([v]);
    const [p] = await principales(); const [l] = await lineasDe(Number(p.id));
    expect(l.origen).toBe("AUTO_OTRO");
    const base = { id: Number(l.id), categoria: "Hospedaje", monto: 300, empleadoId: 101, planId: v };
    await expect(actualizarSolicitudFondo(E, Number(p.id), { lineas: [{ ...base, monto: 1 }] })).rejects.toThrow(/línea automática/);
    await expect(actualizarSolicitudFondo(E, Number(p.id), { lineas: [{ ...base, empleadoId: 100 }] })).rejects.toThrow(/línea automática/);
    await expect(actualizarSolicitudFondo(E, Number(p.id), { lineas: [{ ...base, categoria: "Otros" }] })).rejects.toThrow(/línea automática/);
    await expect(actualizarSolicitudFondo(E, Number(p.id), { lineas: [{ categoria: "Otros", monto: 5 }] })).rejects.toThrow();   // omitirla = retirarla
    await actualizarSolicitudFondo(E, Number(p.id), { lineas: [{ ...base, metodoPago: "Cheque", cuentaOverride: "CH-1" }] }, "ops");
    expect((await lineasDe(Number(p.id)))[0]).toMatchObject({ metodo_pago: "Cheque", cuenta: "CH-1", origen: "AUTO_OTRO" });
  });

  it("SOLICITUD AUTORIZADA: no se modifica; un otro fondo ya autorizado no se puede editar ni retirar en Programación; los nuevos van a UNA complementaria sin duplicar líneas", async () => {
    const v = await viaje(DIA, KT, [[200, 150]]); await guardarOtros(v, [HOSPEDAJE]); await sincronizar([v]);
    const [p] = await principales(); await autorizar(p.id);
    const antes = JSON.stringify([await principales(), await lineasDe(Number(p.id))]);
    const [oh] = await otrosDe(v);
    await expect(guardarOtros(v, [{ ...HOSPEDAJE, id: Number(oh.id), monto: 999 }])).rejects.toThrow(/autorizada/);
    await expect(guardarOtros(v, [])).rejects.toThrow(/autorizada/);
    expect((await listarOtrosFondosDePlanes(E, [v])).get(v)?.[0].bloqueado).toBe(true);
    // el mismo valor reenviado no es un cambio (guardar el viaje de nuevo no falla)
    expect(await guardarOtros(v, [{ ...HOSPEDAJE, id: Number(oh.id), cuenta: "2222222222" }])).toBe(0);
    // nuevos otros fondos tras la autorización → complementaria
    await guardarOtros(v, [{ ...HOSPEDAJE, id: Number(oh.id), cuenta: "2222222222" }, PEAJE]);
    await Promise.all([sincronizar([v]), sincronizar([v]), sincronizar([v])]);
    expect(JSON.stringify([await principales(), await lineasDe(Number(p.id))])).toBe(antes);
    const comp = await R("SELECT id, estado, solicitud_principal_id, total FROM tms_solicitudes_fondo WHERE tipo = 'COMPLEMENTARIA'");
    expect(comp).toHaveLength(1); expect(comp[0]).toMatchObject({ estado: "Pendiente", solicitud_principal_id: p.id }); expect(Number(comp[0].total)).toBe(50.5);
    expect((await lineasDe(Number(comp[0].id))).map((l) => [l.origen, l.categoria])).toEqual([["AUTO_OTRO", "Peajes"]]);
    expect((await listarOtrosFondosDePlanes(E, [v])).get(v)?.map((o) => o.bloqueado)).toEqual([true, false]);
    expect(await N("SELECT COUNT(*) n FROM (SELECT otro_fondo_id FROM tms_solicitud_fondo_lineas WHERE otro_fondo_id IS NOT NULL GROUP BY otro_fondo_id HAVING COUNT(*) > 1) d")).toBe(0);   // ningún otro fondo en dos solicitudes
  });

  it("SIN EMPRESA REQUIRENTE / Tercerizado / Cancelado: los otros fondos quedan en el viaje pero no generan líneas; al asignar la empresa se generan; cambiar de fecha mueve la línea al día nuevo", async () => {
    const v = await viaje(DIA, null, []); await guardarOtros(v, [HOSPEDAJE]); await sincronizar([v]);
    expect(await N("SELECT COUNT(*) n FROM tms_solicitud_fondo_lineas")).toBe(0);
    await admin.query("UPDATE tms_planes_viaje SET entidad_requirente_id = ? WHERE id = ?", [KT, v]); await sincronizar([v]);
    expect(await N("SELECT COUNT(*) n FROM tms_solicitud_fondo_lineas WHERE origen = 'AUTO_OTRO'")).toBe(1);
    await admin.query("UPDATE tms_planes_viaje SET fecha_plan = '2026-12-02' WHERE id = ?", [v]); await sincronizar([v]);
    expect(await principales(DIA)).toHaveLength(0); expect((await principales("2026-12-02")).length).toBe(1);
    expect(await N("SELECT COUNT(*) n FROM tms_solicitud_fondo_lineas WHERE origen = 'AUTO_OTRO'")).toBe(1);
    await admin.query("UPDATE tms_planes_viaje SET estado = 'Cancelado' WHERE id = ?", [v]); await sincronizar([v]);
    expect(await N("SELECT COUNT(*) n FROM tms_solicitud_fondo_lineas")).toBe(0);
    expect(await otrosDe(v)).toHaveLength(1);
  });

  it("AISLAMIENTO: los otros fondos de un viaje de otra empresa no se ven ni se tocan; no se puede reemplazar la lista de un viaje ajeno", async () => {
    const v = await viaje(DIA, KT, []); await guardarOtros(v, [HOSPEDAJE]);
    expect((await listarOtrosFondosDePlanes(2, [v])).size).toBe(0);
    const c = await getPool().getConnection();
    try { await c.beginTransaction(); await expect(reemplazarOtrosFondosTx(c, 2, v, [{ ...HOSPEDAJE, empleadoId: 100 }], "x")).rejects.toThrow(); } finally { await c.rollback(); c.release(); }
    expect(await otrosDe(v)).toHaveLength(1);
  });

  it("ROLLBACK SEGURO Fase 3: con otros fondos o líneas AUTO_OTRO NO borra nada; con confirmación revierte y las líneas pasan a manuales; los viáticos siguen funcionando", async () => {
    const cuentas = "SELECT (SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tms_plan_otros_fondos') + (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'tms_solicitud_fondo_lineas' AND COLUMN_NAME = 'otro_fondo_id') n";
    const rollback = (confirmar = false) => admin.query(`${confirmar ? "SET @CONFIRMAR_PERDIDA_DE_DATOS = 'SI';" : "SET @CONFIRMAR_PERDIDA_DE_DATOS = NULL;"}\n${sql("rollback-2026-12-fondos-otros.sql")}`);
    const v = await viaje(DIA, KT, [[200, 150]]); await guardarOtros(v, [HOSPEDAJE]); await sincronizar([v]);
    await rollback(); await rollback();
    expect(await N(cuentas)).toBe(2); expect(await N("SELECT COUNT(*) n FROM tms_solicitud_fondo_lineas WHERE origen = 'AUTO_OTRO'")).toBe(1); expect(await N("SELECT COUNT(*) n FROM tms_plan_otros_fondos")).toBe(1);
    await rollback(true);
    expect(await N(cuentas)).toBe(0);
    expect(await N("SELECT COUNT(*) n FROM tms_solicitud_fondo_lineas WHERE origen IS NULL AND categoria = 'Hospedaje'")).toBe(1);   // la línea quedó como manual
    await rollback(true);   // idempotente
    reiniciarDeteccionOtrosFondos(); expect(await otrosFondosInstalado()).toBe(false);
    const w = await viaje(DIA, MONACO, [[201, 75]]); expect((await sincronizar([w])).advertencia).toBeUndefined();   // la Fase 2 sigue funcionando sin la Fase 3
    expect(await N("SELECT COUNT(*) n FROM tms_solicitud_fondo_lineas WHERE origen = 'AUTO_VIATICO'")).toBeGreaterThanOrEqual(1);
    await admin.query(sql("migrate-2026-12-fondos-otros.sql"));   // se puede volver a migrar
    reiniciarDeteccionOtrosFondos(); expect(await otrosFondosInstalado()).toBe(true);
  });
});
