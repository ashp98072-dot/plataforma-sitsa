// FONDOS DIARIOS (Fase 2) contra MariaDB 11.8.9 REAL y desechable (pipe sin red). Se omite sin CB2_587_PIPE.
// Aplica la MIGRACIÓN REAL (sql/migrate-2026-11-fondos-diarios.sql, dos veces: idempotencia) sobre un esquema mínimo con las FK reales y ejecuta el servicio REAL
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
import { actualizarSolicitudFondo, cambiarEstadoSolicitudFondo, MENSAJE_SIN_REQUIRENTE } from "./fondos";
import { asignarEntidadRequirentePlanTx, fondosDiariosInstalado, reiniciarDeteccionFondosDiarios, resincronizarGrupoDiario, sincronizarFondosDePlanes, type ActorFondosDiarios } from "./fondos-diarios";

let admin: mysql.Connection;
const E = 1, KT = 1, MONACO = 2;
const OPS: ActorFondosDiarios = { usuarioId: 10, nombre: "Operador Uno", username: "ops" };
const ADMIN: ActorFondosDiarios = { usuarioId: 11, nombre: "Administrador", username: "admin" };
const DIA = "2026-12-01";

const DDL = `
CREATE TABLE empresas(id INT PRIMARY KEY) ENGINE=InnoDB;
CREATE TABLE usuarios(id INT PRIMARY KEY, nombre VARCHAR(100), rol_global VARCHAR(40), activo TINYINT NOT NULL DEFAULT 1, acceso_todas_empresas TINYINT NOT NULL DEFAULT 1) ENGINE=InnoDB;
CREATE TABLE usuario_empresa(usuario_id INT NOT NULL, empresa_id INT NOT NULL, PRIMARY KEY(usuario_id, empresa_id)) ENGINE=InnoDB;
CREATE TABLE cont_entidades(id INT PRIMARY KEY, empresa_id INT NOT NULL, codigo VARCHAR(40) NOT NULL, nombre VARCHAR(200) NOT NULL, activa TINYINT NOT NULL DEFAULT 1, UNIQUE KEY uq_ent(empresa_id, id)) ENGINE=InnoDB;
CREATE TABLE empleados(id INT PRIMARY KEY, empresa_id INT NOT NULL, nombre VARCHAR(200), puesto VARCHAR(100), cuenta_bancaria VARCHAR(30), telefono VARCHAR(20), UNIQUE KEY uq_emp(empresa_id, id)) ENGINE=InnoDB;
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

describe.skipIf(!pipe)("fondos diarios (MariaDB 11.8.9)", () => {
  beforeAll(async () => {
    if (!/^cb2-587-[0-9a-f-]{36}$/.test(pipe)) throw Error("PIPE no autorizado");
    admin = await mysql.createConnection({ socketPath: `${BARRA}${BARRA}.${BARRA}pipe${BARRA}${pipe}`, user: "root", password: "", multipleStatements: true });
    const [[v]] = await admin.query<RowDataPacket[]>("SELECT VERSION() v"); expect(v.v).toMatch(/^11\.8\.9-MariaDB/);
    await admin.query(`DROP DATABASE IF EXISTS ${LAB}; CREATE DATABASE ${LAB} CHARACTER SET utf8mb4; USE ${LAB}`);
    await admin.query(DDL);
  });
  afterAll(async () => { await admin?.query(`DROP DATABASE IF EXISTS ${LAB}`).catch(() => undefined); await admin?.end(); });

  const sembrar = async () => {
    await admin.query(`USE ${LAB}; SET FOREIGN_KEY_CHECKS=0; DELETE FROM tms_solicitud_fondo_lineas; DELETE FROM tms_solicitudes_fondo; DELETE FROM tms_viaticos; DELETE FROM tms_planes_viaje; DELETE FROM auditoria; DELETE FROM tms_personal; DELETE FROM tms_unidades;
      DELETE FROM tms_clientes; DELETE FROM empleados; DELETE FROM cont_entidades; DELETE FROM usuarios; DELETE FROM usuario_empresa; DELETE FROM flota_vehiculos; DELETE FROM empresas; SET FOREIGN_KEY_CHECKS=1`);
    await admin.query(`INSERT INTO empresas VALUES (1), (2);
      INSERT INTO cont_entidades VALUES (1, 1, 'KT', 'Kuiqtrans', 1), (2, 1, 'MONACO', 'Logiservicios Mónaco', 1), (3, 1, 'OTRA', 'Otra entidad', 1), (9, 2, 'KT', 'Kuiqtrans E2', 1);
      INSERT INTO usuarios VALUES (10, 'Operador Uno', 'Operaciones', 1, 1), (11, 'Administrador', 'Admin', 1, 1), (12, 'Jefe', 'JefeOperaciones', 1, 1);
      INSERT INTO empleados VALUES (100, 1, 'Juan Pérez', 'Piloto', '1111111111', NULL), (101, 1, 'Ana López', 'Auxiliar', '2222222222', NULL), (102, 1, 'Beto Ruiz', 'Piloto', NULL, '55550000');
      INSERT INTO tms_clientes VALUES (5, 1, 'Cliente Cinco'); INSERT INTO flota_vehiculos VALUES (50, 'P-1'); INSERT INTO tms_unidades VALUES (60, 1, 'P-1', 50);
      INSERT INTO tms_personal VALUES (200, 1, 'Juan Pérez', 100), (201, 1, 'Ana López', 101), (202, 1, 'Beto Ruiz', 102), (203, 1, 'Sin ficha de RRHH', NULL)`);
  };

  it("DETECCIÓN: sin la migración la función está apagada; la migración real es IDEMPOTENTE (se aplica dos veces) y la enciende", async () => {
    await sembrar();
    reiniciarDeteccionFondosDiarios();
    expect(await fondosDiariosInstalado()).toBe(false);
    for (let i = 0; i < 2; i++) await admin.query(sql("migrate-2026-11-fondos-diarios.sql"));
    reiniciarDeteccionFondosDiarios();
    expect(await fondosDiariosInstalado()).toBe(true);
    const [fila] = await R("SELECT (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND ((TABLE_NAME='tms_planes_viaje' AND COLUMN_NAME='entidad_requirente_id') OR (TABLE_NAME='tms_solicitudes_fondo' AND COLUMN_NAME IN ('origen','tipo','solicitud_principal_id','clave_diaria')) OR (TABLE_NAME='tms_solicitud_fondo_lineas' AND COLUMN_NAME IN ('origen','viatico_id')))) AS n");
    expect(Number(fila.n)).toBe(7);
  });

  beforeEach(async () => { if (await N("SELECT COUNT(*) n FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND COLUMN_NAME = 'viatico_id'")) await sembrar(); });

  it("AGRUPACIÓN: varios viajes de KT el mismo día → UNA principal; Mónaco → otra INDEPENDIENTE; cada línea toma el monto y el beneficiario REALES del viático", async () => {
    const v1 = await viaje(DIA, KT, [[200, 150], [201, 75.5]]), v2 = await viaje(DIA, KT, [[202, 120]]), v3 = await viaje(DIA, MONACO, [[200, 90]]);
    await sincronizar([v1]); await sincronizar([v2]); await sincronizar([v3]);
    const kt = await principales(DIA, KT), mo = await principales(DIA, MONACO);
    expect(kt).toHaveLength(1); expect(mo).toHaveLength(1); expect(kt[0].id).not.toBe(mo[0].id);
    expect(kt[0]).toMatchObject({ estado: "Pendiente", origen: "DIARIA", tipo: "PRINCIPAL" }); expect(Number(kt[0].total)).toBe(345.5); expect(Number(mo[0].total)).toBe(90);
    const lin = await lineasDe(Number(kt[0].id));
    expect(lin.map((l) => [Number(l.monto), l.empleado_nombre, l.cuenta, l.origen, l.categoria])).toEqual([[150, "Juan Pérez", "1111111111", "AUTO_VIATICO", "Viáticos"], [75.5, "Ana López", "2222222222", "AUTO_VIATICO", "Viáticos"], [120, "Beto Ruiz", null, "AUTO_VIATICO", "Viáticos"]]);
    expect(await N("SELECT COUNT(*) n FROM tms_solicitudes_fondo")).toBe(2);
    expect(await N("SELECT COUNT(*) n FROM tms_solicitud_fondo_lineas WHERE viatico_id IS NULL")).toBe(0);
  });

  it("viaje SIN empresa requirente, Tercerizado, Cancelado, viático en cero o RECHAZADO: no genera ninguna línea; un beneficiario sin ficha de RRHH se conserva con su nombre", async () => {
    const sin = await viaje(DIA, null, [[200, 100]]), terc = await viaje(DIA, KT, [[200, 100]], { tipo: "Tercerizado" }), canc = await viaje(DIA, KT, [[200, 100]], { estado: "Cancelado" });
    const cero = await viaje(DIA, KT, [[200, 0]]), rech = await viaje(DIA, KT, [[200, 100]]); await admin.query("UPDATE tms_viaticos SET estado = 'RECHAZADO' WHERE plan_id = ?", [rech]);
    for (const p of [sin, terc, canc, cero, rech]) await sincronizar([p]);
    expect(await N("SELECT COUNT(*) n FROM tms_solicitudes_fondo")).toBe(0);
    const libre = await viaje(DIA, KT, [[203, 60]]); await sincronizar([libre]);
    const [l] = await lineasDe(Number((await principales())[0].id));
    expect([Number(l.monto), l.empleado_id, l.empleado_nombre]).toEqual([60, null, "Sin ficha de RRHH"]);
  });

  it("IDEMPOTENCIA: repetir la sincronización no crea solicitudes ni líneas nuevas, conserva los ids y no audita cambios", async () => {
    const v = await viaje(DIA, KT, [[200, 150], [201, 75]]);
    await sincronizar([v]);
    const [p] = await principales(); const antes = JSON.stringify(await lineasDe(Number(p.id))); const aud = await N("SELECT COUNT(*) n FROM auditoria");
    for (let i = 0; i < 3; i++) { const r = await sincronizar([v]); expect(r.cambios).toBe(0); }
    expect(JSON.stringify(await lineasDe(Number(p.id)))).toBe(antes); expect(await N("SELECT COUNT(*) n FROM tms_solicitudes_fondo")).toBe(1); expect(await N("SELECT COUNT(*) n FROM auditoria")).toBe(aud);
  });

  it("CONCURRENCIA: 8 transacciones simultáneas (viajes distintos, mismo día y empresa requirente) producen UNA principal y cada viático exactamente UNA vez", async () => {
    const planes = await Promise.all(Array.from({ length: 8 }, (_, i) => viaje(DIA, KT, [[200, 10 + i], [201, 20 + i]])));
    const resultados = await Promise.allSettled(planes.map((p) => sincronizar([p])));
    expect(resultados.filter((r) => r.status === "rejected").map((r) => String((r as PromiseRejectedResult).reason))).toEqual([]);
    expect(resultados.every((r) => r.status === "fulfilled" && !(r.value as { advertencia?: string }).advertencia)).toBe(true);
    const ps = await principales(); expect(ps).toHaveLength(1);
    expect(await N(`SELECT COUNT(*) n FROM tms_solicitud_fondo_lineas WHERE solicitud_id = ${ps[0].id}`)).toBe(16);
    expect(await N("SELECT COUNT(*) n FROM (SELECT viatico_id FROM tms_solicitud_fondo_lineas GROUP BY viatico_id HAVING COUNT(*) > 1) d")).toBe(0);
    expect(await N("SELECT COUNT(*) n FROM tms_solicitudes_fondo")).toBe(1); expect(Number(ps[0].total)).toBe(8 * 30 + 2 * 28);
  });

  it("CONCURRENCIA sobre el MISMO viaje (doble envío / reintento): sin duplicados", async () => {
    const v = await viaje(DIA, KT, [[200, 150], [201, 75]]);
    const r = await Promise.allSettled([sincronizar([v]), sincronizar([v]), sincronizar([v])]);
    expect(r.every((x) => x.status === "fulfilled")).toBe(true);
    expect(await N("SELECT COUNT(*) n FROM tms_solicitudes_fondo")).toBe(1); expect(await N("SELECT COUNT(*) n FROM tms_solicitud_fondo_lineas")).toBe(2);
  });

  it("SINCRONIZACIÓN DIFERENCIAL (Pendiente): cambia el monto de origen → misma línea con el monto nuevo; método de pago y cuenta editados se CONSERVAN; se retira el viático que ya no existe; vacía → se retira la solicitud", async () => {
    const v = await viaje(DIA, KT, [[200, 150], [201, 75]]); await sincronizar([v]);
    const [p] = await principales(); const [a, b] = await lineasDe(Number(p.id));
    await admin.query("UPDATE tms_solicitud_fondo_lineas SET metodo_pago = 'Transferencia', cuenta = 'CUENTA-EDITADA' WHERE id = ?", [a.id]);   // lo único editable a mano
    await admin.query("UPDATE tms_viaticos SET monto_asignado = 200 WHERE plan_id = ? AND personal_id = 200", [v]);
    await sincronizar([v]);
    const [a2] = (await lineasDe(Number(p.id))).filter((l) => l.id === a.id);
    expect([Number(a2.monto), a2.metodo_pago, a2.cuenta]).toEqual([200, "Transferencia", "CUENTA-EDITADA"]); expect(Number((await principales())[0].total)).toBe(275);
    await admin.query("DELETE FROM tms_viaticos WHERE plan_id = ? AND personal_id = 201", [v]); await sincronizar([v]);
    expect((await lineasDe(Number(p.id))).map((l) => l.id)).toEqual([a.id]); expect(b.id).not.toBe(a.id);
    await admin.query("DELETE FROM tms_viaticos WHERE plan_id = ?", [v]); await sincronizar([v]);
    expect(await principales()).toHaveLength(0);   // solicitud diaria pendiente sin líneas: se retira
  });

  it("cambiar de beneficiario reinicia método y cuenta; mover el viaje de fecha/empresa traslada la línea (se retira de la anterior y se agrega a la nueva)", async () => {
    const v = await viaje(DIA, KT, [[200, 150]]); await sincronizar([v]);
    const [p] = await principales(); const [l] = await lineasDe(Number(p.id));
    await admin.query("UPDATE tms_solicitud_fondo_lineas SET metodo_pago = 'Transferencia', cuenta = 'X' WHERE id = ?", [l.id]);
    await admin.query("UPDATE tms_viaticos SET personal_id = 201 WHERE plan_id = ?", [v]); await sincronizar([v]);
    const [l2] = await lineasDe(Number(p.id)); expect([l2.id, l2.empleado_nombre, l2.cuenta, l2.metodo_pago]).toEqual([l.id, "Ana López", "2222222222", null]);
    await admin.query("UPDATE tms_planes_viaje SET fecha_plan = '2026-12-02', entidad_requirente_id = ? WHERE id = ?", [MONACO, v]); await sincronizar([v]);
    expect(await principales(DIA, KT)).toHaveLength(0); const [nuevo] = await principales("2026-12-02", MONACO); expect(await lineasDe(Number(nuevo.id))).toHaveLength(1);
  });

  it("REQUIRENTE: inicialmente el usuario que programa si es de Operaciones; si no lo es (Admin) queda VACÍO y la autorización se bloquea hasta definirlo; luego se puede cambiar por otro usuario de Operaciones", async () => {
    const v = await viaje(DIA, KT, [[200, 150]]); await sincronizar([v], OPS);
    expect((await principales())[0].requirente_usuario_id).toBe(10);
    await sembrar();
    const w = await viaje(DIA, KT, [[200, 150]]); await sincronizar([w], ADMIN);
    const [p] = await principales(); expect(p.requirente_usuario_id).toBeNull();
    const aut = { usuarioId: 12, nombre: "Jefe", rol: "JefeOperaciones", imagen: { bytes: new ArrayBuffer(3), original: "f.png" } };
    await expect(cambiarEstadoSolicitudFondo(E, Number(p.id), "autorizar", { usuario: "jefe", autorizante: aut })).rejects.toThrow(MENSAJE_SIN_REQUIRENTE);
    expect((await principales())[0].estado).toBe("Pendiente");
    const [l] = await lineasDe(Number(p.id));
    await actualizarSolicitudFondo(E, Number(p.id), { requirenteUsuarioId: 10, solicitanteUsuarioId: 10, lineas: [{ id: Number(l.id), categoria: "Viáticos", monto: 150, empleadoId: 100, planId: w }] }, "admin");
    expect((await principales())[0].requirente_usuario_id).toBe(10);
    const r = await cambiarEstadoSolicitudFondo(E, Number(p.id), "autorizar", { usuario: "jefe", autorizante: aut });
    expect(r?.estado).toBe("Autorizada");
  });

  it("LÍNEAS AUTOMÁTICAS: no se puede cambiar monto, beneficiario ni retirarlas a mano; SÍ método de pago y cuenta; una línea manual agregada a la solicitud no interfiere con la sincronización", async () => {
    const v = await viaje(DIA, KT, [[200, 150]]); await sincronizar([v]);
    const [p] = await principales(); const [l] = await lineasDe(Number(p.id));
    const base = { id: Number(l.id), categoria: "Viáticos", monto: 150, empleadoId: 100, planId: v };
    await expect(actualizarSolicitudFondo(E, Number(p.id), { lineas: [{ ...base, monto: 999 }] })).rejects.toThrow(/línea automática/);
    await expect(actualizarSolicitudFondo(E, Number(p.id), { lineas: [{ ...base, empleadoId: 101 }] })).rejects.toThrow(/línea automática/);
    await expect(actualizarSolicitudFondo(E, Number(p.id), { lineas: [{ categoria: "Combustible", monto: 10 }] })).rejects.toThrow();   // omitir la automática = retirarla
    await expect(actualizarSolicitudFondo(E, Number(p.id), { fechaRequerimiento: "2026-12-05", lineas: [base] })).rejects.toThrow(/solicitud diaria/);   // la fecha y la empresa requirente de una diaria no se cambian a mano
    await expect(actualizarSolicitudFondo(E, Number(p.id), { entidadRequirenteId: MONACO, lineas: [base] })).rejects.toThrow(/solicitud diaria/);
    await actualizarSolicitudFondo(E, Number(p.id), { lineas: [{ ...base, metodoPago: "Transferencia", cuentaOverride: "9999999999" }, { categoria: "Combustible", monto: 40 }] }, "ops");
    const lin = await lineasDe(Number(p.id)); expect(lin.map((x) => [x.id === l.id, Number(x.monto), x.origen, x.metodo_pago, x.cuenta])).toEqual([[true, 150, "AUTO_VIATICO", "Transferencia", "9999999999"], [false, 40, null, null, null]]);
    await sincronizar([v]);   // la manual no se toca y la automática conserva lo editado
    expect((await lineasDe(Number(p.id))).map((x) => [Number(x.monto), x.metodo_pago])).toEqual([[150, "Transferencia"], [40, null]]);
  });

  it("SOLICITUD AUTORIZADA: no se modifica; los viajes nuevos van a UNA complementaria Pendiente ligada a la principal, sin duplicar líneas (también con repeticiones y concurrencia)", async () => {
    const v1 = await viaje(DIA, KT, [[200, 150]]); await sincronizar([v1], OPS);
    const [p] = await principales(); await admin.query("UPDATE tms_solicitudes_fondo SET estado = 'Autorizada', autorizado_en = NOW() WHERE id = ?", [p.id]);
    const antesPrincipal = JSON.stringify([await principales(), await lineasDe(Number(p.id))]);
    const v2 = await viaje(DIA, KT, [[201, 75]]), v3 = await viaje(DIA, KT, [[202, 60]]);
    await Promise.all([sincronizar([v2]), sincronizar([v3]), sincronizar([v2])]);
    await sincronizar([v2]); await sincronizar([v3]);
    expect(JSON.stringify([await principales(), await lineasDe(Number(p.id))])).toBe(antesPrincipal);   // la autorizada NO cambió
    const comp = await R(`SELECT id, codigo, tipo, origen, estado, solicitud_principal_id, total, observaciones FROM tms_solicitudes_fondo WHERE tipo = 'COMPLEMENTARIA'`);
    expect(comp).toHaveLength(1); expect(comp[0]).toMatchObject({ origen: "DIARIA", estado: "Pendiente", solicitud_principal_id: p.id }); expect(Number(comp[0].total)).toBe(135); expect(String(comp[0].observaciones)).toContain(String(p.codigo));
    expect((await lineasDe(Number(comp[0].id))).map((l) => Number(l.monto)).sort((x, y) => x - y)).toEqual([60, 75]);
    expect(await N("SELECT COUNT(*) n FROM (SELECT viatico_id FROM tms_solicitud_fondo_lineas GROUP BY viatico_id HAVING COUNT(*) > 1) d")).toBe(0);
    // la complementaria pendiente se sincroniza como cualquier pendiente; ya autorizada, el siguiente viaje abre OTRA complementaria
    await admin.query("DELETE FROM tms_viaticos WHERE plan_id = ?", [v3]); await sincronizar([v3]);
    expect((await lineasDe(Number(comp[0].id))).map((l) => Number(l.monto))).toEqual([75]);
    await admin.query("UPDATE tms_solicitudes_fondo SET estado = 'Autorizada' WHERE id = ?", [comp[0].id]);
    const v4 = await viaje(DIA, KT, [[202, 33]]); await sincronizar([v4]);
    expect(await N("SELECT COUNT(*) n FROM tms_solicitudes_fondo WHERE tipo = 'COMPLEMENTARIA'")).toBe(2);
    expect(await N("SELECT COUNT(*) n FROM tms_solicitudes_fondo WHERE tipo = 'PRINCIPAL'")).toBe(1);
  });

  it("un viaje movido DESPUÉS de autorizada su solicitud no duplica el dinero ya autorizado; una principal RECHAZADA libera la clave y se crea una nueva", async () => {
    const v = await viaje(DIA, KT, [[200, 150]]); await sincronizar([v]);
    const [p] = await principales(); await admin.query("UPDATE tms_solicitudes_fondo SET estado = 'Autorizada' WHERE id = ?", [p.id]);
    await admin.query("UPDATE tms_planes_viaje SET fecha_plan = '2026-12-09' WHERE id = ?", [v]); await sincronizar([v]);
    expect(await N("SELECT COUNT(*) n FROM tms_solicitud_fondo_lineas WHERE plan_id = " + v)).toBe(1);   // sigue solo la línea de la solicitud autorizada
    expect(await principales("2026-12-09", KT)).toHaveLength(0);
    const w = await viaje("2026-12-10", MONACO, [[200, 80]]); await sincronizar([w]);
    const [q] = await principales("2026-12-10", MONACO); await admin.query("UPDATE tms_solicitudes_fondo SET estado = 'Rechazada', motivo_rechazo = 'x', rechazado_en = NOW() WHERE id = ?", [q.id]);
    const w2 = await viaje("2026-12-10", MONACO, [[201, 40]]); await sincronizar([w2]);
    const ps = await principales("2026-12-10", MONACO); expect(ps.map((x) => x.estado)).toEqual(["Rechazada", "Pendiente"]);
    expect((await lineasDe(Number(ps[1].id))).map((l) => Number(l.monto))).toEqual([40]);   // la rechazada no cubre ni se toca; w sigue sin línea vigente hasta su próxima sincronización
    await sincronizar([w]); expect((await lineasDe(Number((await principales("2026-12-10", MONACO))[1].id))).map((l) => Number(l.monto)).sort()).toEqual([40, 80]);
  });

  it("la UNICIDAD real de la base impide una segunda principal vigente y un viático repetido en la misma solicitud (defensa independiente del código)", async () => {
    const v = await viaje(DIA, KT, [[200, 150]]); await sincronizar([v]);
    const [p] = await principales();
    await expect(admin.query(`INSERT INTO tms_solicitudes_fondo(empresa_id, codigo, entidad_requirente_id, fecha_requerimiento, origen, tipo) VALUES (${E}, 'DUP-1', ${KT}, '${DIA}', 'DIARIA', 'PRINCIPAL')`)).rejects.toMatchObject({ errno: 1062 });
    await expect(admin.query(`INSERT INTO tms_solicitud_fondo_lineas(empresa_id, solicitud_id, categoria, monto, origen, viatico_id) SELECT empresa_id, solicitud_id, categoria, monto, origen, viatico_id FROM tms_solicitud_fondo_lineas WHERE solicitud_id = ${p.id}`)).rejects.toMatchObject({ errno: 1062 });
    await expect(admin.query(`INSERT INTO tms_solicitud_fondo_lineas(empresa_id, solicitud_id, categoria, monto, origen) VALUES (${E}, ${p.id}, 'Viáticos', 1, 'AUTO_VIATICO')`)).rejects.toMatchObject({ errno: 4025 });   // CHECK: origen automático exige viático
    await expect(admin.query(`INSERT INTO tms_solicitudes_fondo(empresa_id, codigo, fecha_requerimiento, origen, tipo, solicitud_principal_id) VALUES (${E}, 'CK-1', '${DIA}', 'MANUAL', 'COMPLEMENTARIA', ${p.id})`)).rejects.toMatchObject({ errno: 4025 });
    await admin.query(`INSERT INTO tms_solicitudes_fondo(empresa_id, codigo, entidad_requirente_id, fecha_requerimiento) VALUES (${E}, 'MAN-1', ${KT}, '${DIA}'), (${E}, 'MAN-2', ${KT}, '${DIA}')`);   // las manuales no se ven afectadas: varias el mismo día
  });

  it("AISLAMIENTO: la empresa requirente debe ser de ESTA empresa y válida (KT/MONACO activa); los viajes y fondos de otra empresa no se tocan", async () => {
    const v = await viaje(DIA, KT, [[200, 150]]);
    const conn = await getPool().getConnection();
    try {
      await conn.beginTransaction();
      await expect(asignarEntidadRequirentePlanTx(conn, E, v, 9)).rejects.toThrow(/empresa requirente no es válida/);   // entidad de la empresa 2
      await expect(asignarEntidadRequirentePlanTx(conn, E, v, 3)).rejects.toThrow(/empresa requirente no es válida/);   // código fuera de KT/MONACO
      await asignarEntidadRequirentePlanTx(conn, E, v, MONACO);
      await conn.commit();
    } finally { conn.release(); }
    expect(await N(`SELECT entidad_requirente_id n FROM tms_planes_viaje WHERE id = ${v}`)).toBe(MONACO);
    await sincronizar([v]); expect(await N("SELECT COUNT(*) n FROM tms_solicitudes_fondo WHERE empresa_id = 2")).toBe(0);
    expect(await N(`SELECT COUNT(*) n FROM tms_solicitudes_fondo WHERE empresa_id = ${E} AND entidad_requirente_id = ${MONACO}`)).toBe(1);
  });

  it("FALLO DE LA SINCRONIZACIÓN: el viaje ya confirmado no se afecta, la transacción de fondos se revierte COMPLETA (ni solicitud ni líneas a medias) y se devuelve una advertencia; luego se repara", async () => {
    const v = await viaje(DIA, KT, [[200, 150], [201, 75]]);
    await admin.query("UPDATE tms_planes_viaje SET hora_carga = '07:30' WHERE id = ?", [v]);
    await admin.query("UPDATE tms_unidades SET flota_vehiculo_id = 999 WHERE id = 60");   // referencia rota: la FK del vehículo hace fallar el INSERT de la línea (después de crear la solicitud)
    const r = await sincronizar([v]);
    expect(r.advertencia).toMatch(/El viaje se guardó/);
    expect(await R(`SELECT hora_carga FROM tms_planes_viaje WHERE id = ${v}`)).toEqual([{ hora_carga: "07:30" }]);
    expect(await N("SELECT COUNT(*) n FROM tms_solicitudes_fondo")).toBe(0); expect(await N("SELECT COUNT(*) n FROM tms_solicitud_fondo_lineas")).toBe(0);
    await admin.query("UPDATE tms_unidades SET flota_vehiculo_id = 50 WHERE id = 60");
    expect((await sincronizar([v])).advertencia).toBeUndefined(); expect(await N("SELECT COUNT(*) n FROM tms_solicitud_fondo_lineas")).toBe(2);
  });

  it("RESINCRONIZAR un día completo (acción explícita): repara líneas faltantes y es idempotente", async () => {
    const v1 = await viaje(DIA, KT, [[200, 150]]), v2 = await viaje(DIA, KT, [[201, 75]]);
    const r = await resincronizarGrupoDiario(E, DIA, KT, OPS); expect(r.cambios).toBe(2);
    expect((await resincronizarGrupoDiario(E, DIA, KT, OPS)).cambios).toBe(0);
    expect(await N("SELECT COUNT(*) n FROM tms_solicitud_fondo_lineas")).toBe(2); expect(v1).not.toBe(v2);
    await expect(resincronizarGrupoDiario(E, DIA, 9, OPS)).rejects.toThrow(/empresa requirente no es válida/);
  });
});
