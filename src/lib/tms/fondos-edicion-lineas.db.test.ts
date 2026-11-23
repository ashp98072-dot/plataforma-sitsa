// FONDOS FASE 1 — edición diferencial de líneas contra MariaDB 11.8.9 REAL y desechable (pipe sin red). Se omite sin CB2_587_PIPE.
// Ejecuta `actualizarSolicitudFondo` REAL sobre tablas con las MISMAS claves foráneas RESTRICT que protegen a Combustible y CB2
// (flota_combustible_cargas.fk_fcc_fondo_linea y flota_cb2_fondos_vinculos.fk_cb2fv_linea): demuestra que las líneas conservan su id, que
// eliminar una línea vinculada falla sin NINGÚN cambio parcial (ni encabezado ni otras líneas) y que no se tocan líneas de otra solicitud/empresa.
import mysql, { type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 120000, hookTimeout: 120000 });
const pipe = process.env.CB2_587_PIPE ?? "";
const LAB = "fondos_edicion_lineas";
const BARRA = String.fromCharCode(92);

vi.mock("@/lib/db", async () => {
  const mysqlReal = await import("mysql2/promise");
  let pool: ReturnType<typeof mysqlReal.createPool> | null = null;
  const obtener = () => {
    if (!pool) {
      const b = String.fromCharCode(92);
      pool = mysqlReal.createPool({ socketPath: `${b}${b}.${b}pipe${b}${process.env.CB2_587_PIPE}`, user: "root", password: "", database: "fondos_edicion_lineas", connectionLimit: 6 });
    }
    return pool;
  };
  return {
    getPool: obtener,
    query: async (sql: string, params: unknown[] = []) => (await obtener().query(sql, params as never))[0],
    execute: async (sql: string, params: unknown[] = []) => (await obtener().execute(sql, params as never))[0],
  };
});
vi.mock("@/lib/firmas/usuario-firmas", () => ({ leerBytesFirmaGuardada: vi.fn(async () => null) }));
vi.mock("@/lib/uploads", () => ({ guardarUpload: vi.fn(), borrarUpload: vi.fn() }));

import { actualizarSolicitudFondo } from "./fondos";

let admin: mysql.Connection;
const E1 = 1, E2 = 2;

const DDL = `
CREATE TABLE empresas(id INT PRIMARY KEY) ENGINE=InnoDB;
CREATE TABLE empleados(id INT NOT NULL, empresa_id INT NOT NULL, nombre VARCHAR(200) NULL, PRIMARY KEY(id), UNIQUE KEY uq_emp(empresa_id, id)) ENGINE=InnoDB;
CREATE TABLE tms_solicitudes_fondo(
  id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, codigo VARCHAR(40) NOT NULL, entidad_requirente_id INT NULL, entidad_requirente_nombre VARCHAR(200) NULL,
  requirente_empleado_id INT NULL, requirente_nombre VARCHAR(200) NULL, requirente_usuario_id INT NULL, fecha_requerimiento DATE NOT NULL, total DECIMAL(12,2) NOT NULL DEFAULT 0,
  autorizante_empleado_id INT NULL, autorizante_nombre VARCHAR(200) NULL, autorizante_usuario_id INT NULL, estado VARCHAR(30) NOT NULL DEFAULT 'Pendiente',
  autorizado_en DATETIME NULL, rechazado_en DATETIME NULL, motivo_rechazo VARCHAR(300) NULL, liquidado_en DATETIME NULL, observaciones VARCHAR(300) NULL, creado_por VARCHAR(100) NULL,
  solicitante_usuario_id INT NULL, solicitante_nombre VARCHAR(200) NULL, creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_fondo_codigo(empresa_id, codigo), UNIQUE KEY uq_fondo_empresa_id(empresa_id, id)) ENGINE=InnoDB;
CREATE TABLE tms_solicitud_fondo_lineas(
  id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, solicitud_id INT NOT NULL, categoria VARCHAR(40) NOT NULL, descripcion VARCHAR(300) NULL,
  cantidad DECIMAL(10,2) NOT NULL DEFAULT 1, monto DECIMAL(12,2) NOT NULL, fecha_viaje DATE NULL, empleado_id INT NULL, empleado_nombre VARCHAR(200) NULL, cargo VARCHAR(100) NULL,
  cuenta VARCHAR(30) NULL, metodo_pago VARCHAR(40) NULL, vehiculo_id INT NULL, placa VARCHAR(20) NULL, cliente_id INT NULL, cliente_nombre VARCHAR(200) NULL, plan_id INT NULL, orden INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_fondolin_c2a_empresa_id(empresa_id, id),
  CONSTRAINT fk_fondolin_solicitud_ambito FOREIGN KEY(empresa_id, solicitud_id) REFERENCES tms_solicitudes_fondo(empresa_id, id) ON DELETE CASCADE) ENGINE=InnoDB;
CREATE TABLE flota_combustible_cargas(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, solicitud_fondo_linea_id INT NULL,
  CONSTRAINT fk_fcc_fondo_linea FOREIGN KEY(empresa_id, solicitud_fondo_linea_id) REFERENCES tms_solicitud_fondo_lineas(empresa_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT) ENGINE=InnoDB;
CREATE TABLE flota_cb2_fondos_vinculos(empresa_id INT NOT NULL, consumo_id INT NOT NULL, linea_id INT NOT NULL, PRIMARY KEY(empresa_id, consumo_id),
  CONSTRAINT fk_cb2fv_linea FOREIGN KEY(empresa_id, linea_id) REFERENCES tms_solicitud_fondo_lineas(empresa_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT) ENGINE=InnoDB;
CREATE TABLE auditoria(id BIGINT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NULL, usuario VARCHAR(100) NULL, accion VARCHAR(80) NOT NULL, modulo VARCHAR(40) NULL, detalle TEXT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB;`;

const R = async (sql: string) => (await admin.query<RowDataPacket[]>(sql))[0];
const foto = async () => JSON.stringify({
  cab: await R("SELECT id, empresa_id, total, observaciones, estado FROM tms_solicitudes_fondo ORDER BY id"),
  lin: await R("SELECT * FROM tms_solicitud_fondo_lineas ORDER BY id"),
  cargas: await R("SELECT * FROM flota_combustible_cargas ORDER BY id"), cb2: await R("SELECT * FROM flota_cb2_fondos_vinculos ORDER BY consumo_id"),
});
const idsDe = async (solicitud: number) => (await R(`SELECT id FROM tms_solicitud_fondo_lineas WHERE solicitud_id = ${solicitud} ORDER BY orden, id`)).map((x) => Number(x.id));

/** Solicitud 1 (E1, Pendiente) con 3 líneas: A libre, B con vale de Combustible, C con vínculo CB2. Solicitud 2 (E1) y 3 (E2) ajenas, y 4 (E1) Autorizada. */
async function sembrar() {
  await admin.query(`USE ${LAB}; SET FOREIGN_KEY_CHECKS=0; DELETE FROM flota_cb2_fondos_vinculos; DELETE FROM flota_combustible_cargas; DELETE FROM tms_solicitud_fondo_lineas; DELETE FROM tms_solicitudes_fondo; DELETE FROM auditoria; SET FOREIGN_KEY_CHECKS=1`);
  await admin.query(`INSERT INTO tms_solicitudes_fondo(id, empresa_id, codigo, requirente_nombre, fecha_requerimiento, total, estado, observaciones) VALUES
    (1,${E1},'FONDO-000001','Histórico','2026-11-01',600,'Pendiente','original'),(2,${E1},'FONDO-000002','Histórico','2026-11-01',70,'Pendiente','otra'),
    (3,${E2},'FONDO-000003','Histórico','2026-11-01',80,'Pendiente','ajena'),(4,${E1},'FONDO-000004','Histórico','2026-11-01',90,'Autorizada','autorizada')`);
  await admin.query(`INSERT INTO tms_solicitud_fondo_lineas(id, empresa_id, solicitud_id, categoria, monto, orden) VALUES
    (101,${E1},1,'Combustible',100,0),(102,${E1},1,'Hospedaje',200,1),(103,${E1},1,'Parqueo',300,2),(201,${E1},2,'Otros',70,0),(301,${E2},3,'Otros',80,0),(401,${E1},4,'Otros',90,0)`);
  await admin.query(`INSERT INTO flota_combustible_cargas(empresa_id, solicitud_fondo_linea_id) VALUES (${E1},102); INSERT INTO flota_cb2_fondos_vinculos VALUES (${E1},9001,103)`);
}

describe.skipIf(!pipe)("edición diferencial de líneas de fondo (MariaDB 11.8.9)", () => {
  beforeAll(async () => {
    if (!/^cb2-587-[0-9a-f-]{36}$/.test(pipe)) throw Error("PIPE no autorizado");
    admin = await mysql.createConnection({ socketPath: `${BARRA}${BARRA}.${BARRA}pipe${BARRA}${pipe}`, user: "root", password: "", multipleStatements: true });
    const [[v]] = await admin.query<RowDataPacket[]>("SELECT VERSION() v"); expect(v.v).toMatch(/^11\.8\.9-MariaDB/);
    await admin.query(`DROP DATABASE IF EXISTS ${LAB}; CREATE DATABASE ${LAB} CHARACTER SET utf8mb4; USE ${LAB}`);
    await admin.query(DDL);
  });
  beforeEach(sembrar);
  afterAll(async () => { await admin?.query(`DROP DATABASE IF EXISTS ${LAB}`).catch(() => undefined); await admin?.end(); });

  const todas = () => [{ id: 101, categoria: "Combustible", monto: 100 }, { id: 102, categoria: "Hospedaje", monto: 200 }, { id: 103, categoria: "Parqueo", monto: 300 }];

  it("editar una línea conserva TODOS los ids; las líneas sin cambios quedan byte a byte iguales (incluidas las vinculadas a Combustible y CB2)", async () => {
    const antes = await R("SELECT * FROM tms_solicitud_fondo_lineas WHERE id IN (102, 103) ORDER BY id");
    const sol = await actualizarSolicitudFondo(E1, 1, { observaciones: "editada", lineas: [{ ...todas()[0], monto: 150 }, todas()[1], todas()[2]] }, "jefe");
    expect(await idsDe(1)).toEqual([101, 102, 103]);
    expect(sol?.lineas.map((l) => [l.id, l.monto])).toEqual([[101, 150], [102, 200], [103, 300]]);
    expect(Number((await R("SELECT total FROM tms_solicitudes_fondo WHERE id = 1"))[0].total)).toBe(650);
    expect(await R("SELECT * FROM tms_solicitud_fondo_lineas WHERE id IN (102, 103) ORDER BY id")).toEqual(antes);
    expect(Number((await R("SELECT COUNT(*) c FROM flota_combustible_cargas WHERE solicitud_fondo_linea_id = 102"))[0].c)).toBe(1);   // los vínculos siguen intactos
    expect(Number((await R("SELECT COUNT(*) c FROM flota_cb2_fondos_vinculos WHERE linea_id = 103"))[0].c)).toBe(1);
  });

  it("agregar una línea inserta solo esa (id nuevo); las demás no cambian", async () => {
    const antes = await R("SELECT * FROM tms_solicitud_fondo_lineas WHERE solicitud_id = 1 ORDER BY id");
    await actualizarSolicitudFondo(E1, 1, { lineas: [...todas(), { categoria: "Cuadrilla", monto: 40 }] });
    const ids = await idsDe(1); expect(ids.slice(0, 3)).toEqual([101, 102, 103]); expect(ids).toHaveLength(4); expect(ids[3]).toBeGreaterThan(401);
    expect(await R("SELECT * FROM tms_solicitud_fondo_lineas WHERE id IN (101,102,103) ORDER BY id")).toEqual(antes);
  });

  it("eliminar una línea LIBRE funciona; las vinculadas y las demás conservan su id", async () => {
    await actualizarSolicitudFondo(E1, 1, { lineas: [todas()[1], todas()[2]] });   // se retira la 101 (libre)
    expect(await idsDe(1)).toEqual([102, 103]);
    expect(Number((await R("SELECT total FROM tms_solicitudes_fondo WHERE id = 1"))[0].total)).toBe(500);
  });

  it.each([
    ["con un vale de Combustible", 102, "Hospedaje"],
    ["con un vínculo CB2", 103, "Parqueo"],
  ])("eliminar una línea %s FALLA con error controlado y SIN NINGÚN cambio parcial (ni encabezado, ni otras líneas, ni vínculos)", async (_n, retirada) => {
    const antes = await foto();
    const resto = todas().filter((l) => l.id !== retirada).map((l) => ({ ...l, monto: l.monto + 1 }));   // además intenta modificar las demás
    await expect(actualizarSolicitudFondo(E1, 1, { observaciones: "NO debe persistir", lineas: resto })).rejects.toThrow(/tiene vales de Combustible o vínculos CB2/);
    expect(await foto()).toBe(antes);
    expect((await R("SELECT COUNT(*) c FROM auditoria"))[0].c).toBe(0);   // tampoco se audita una edición que no ocurrió
  });

  it("la protección es DOBLE: aunque la comprobación previa no existiera, la FK RESTRICT de la base rechaza el DELETE (la transacción revierte todo)", async () => {
    const antes = await foto();
    await expect(admin.query(`START TRANSACTION; UPDATE tms_solicitudes_fondo SET observaciones = 'x' WHERE id = 1; DELETE FROM tms_solicitud_fondo_lineas WHERE id = 102;`)).rejects.toMatchObject({ errno: 1451 });
    await admin.query("ROLLBACK");
    expect(await foto()).toBe(antes);
  });

  it("AISLAMIENTO: ids de OTRA solicitud, de OTRA empresa o inexistentes se rechazan sin escribir nada; no se pueden editar solicitudes de otra empresa", async () => {
    const antes = await foto();
    for (const id of [201, 301, 401, 99999]) {
      await expect(actualizarSolicitudFondo(E1, 1, { observaciones: "x", lineas: [{ id, categoria: "Otros", monto: 1 }] }), String(id)).rejects.toThrow("no pertenece a esta solicitud");
    }
    expect(await foto()).toBe(antes);
    expect(await actualizarSolicitudFondo(E1, 3, { observaciones: "cruce de empresa", lineas: [{ id: 301, categoria: "Otros", monto: 1 }] })).toBeNull();   // la solicitud 3 es de la empresa 2
    expect(await actualizarSolicitudFondo(E2, 1, { observaciones: "cruce de empresa", lineas: [{ id: 101, categoria: "Otros", monto: 1 }] })).toBeNull();
    expect(await foto()).toBe(antes);
  });

  it("una solicitud AUTORIZADA es inmutable (con y sin ids de línea)", async () => {
    const antes = await foto();
    await expect(actualizarSolicitudFondo(E1, 4, { lineas: [{ id: 401, categoria: "Otros", monto: 1 }] })).rejects.toThrow('No se puede editar una solicitud en estado "Autorizada"');
    await expect(actualizarSolicitudFondo(E1, 4, { observaciones: "x" })).rejects.toThrow("Autorizada");
    expect(await foto()).toBe(antes);
  });

  it("reordenar conserva los ids y solo cambia `orden`", async () => {
    await actualizarSolicitudFondo(E1, 1, { lineas: [todas()[2], todas()[0], todas()[1]] });
    expect(await idsDe(1)).toEqual([103, 101, 102]);
    expect((await R("SELECT id, monto FROM tms_solicitud_fondo_lineas WHERE solicitud_id = 1 ORDER BY id")).map((x) => [Number(x.id), Number(x.monto)])).toEqual([[101, 100], [102, 200], [103, 300]]);
  });

  it("COMPATIBILIDAD: un cliente que reenvía todo SIN ids reemplaza las líneas libres (como antes), pero NO puede borrar las vinculadas: falla y no cambia nada", async () => {
    await admin.query("DELETE FROM flota_cb2_fondos_vinculos; DELETE FROM flota_combustible_cargas");   // solicitud sin vínculos
    await actualizarSolicitudFondo(E1, 1, { lineas: [{ categoria: "Combustible", monto: 10 }, { categoria: "Otros", monto: 20 }] });
    expect(await idsDe(1)).toHaveLength(2); expect((await idsDe(1)).every((id) => id > 401)).toBe(true);
    await sembrar();
    const antes = await foto();
    await expect(actualizarSolicitudFondo(E1, 1, { lineas: [{ categoria: "Combustible", monto: 10 }] })).rejects.toThrow(/tiene vales de Combustible o vínculos CB2/);
    expect(await foto()).toBe(antes);
  });
});
