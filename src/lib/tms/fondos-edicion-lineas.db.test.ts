// FONDOS FASE 1 — edición diferencial de líneas contra MariaDB 11.8.9 REAL y desechable (pipe sin red). Se omite sin CB2_587_PIPE.
// Ejecuta `actualizarSolicitudFondo` REAL sobre tablas con las MISMAS claves foráneas RESTRICT que protegen a Combustible y CB2
// (flota_combustible_cargas.fk_fcc_fondo_linea y flota_cb2_fondos_vinculos.fk_cb2fv_linea): demuestra que las líneas conservan su id, que
// eliminar una línea vinculada falla sin NINGÚN cambio parcial (ni encabezado ni otras líneas) y que no se tocan líneas de otra solicitud/empresa.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.setConfig({ testTimeout: 120000, hookTimeout: 120000 });
const pipe = process.env.CB2_587_PIPE ?? "";
const LAB = "fondos_edicion_lineas";
const BARRA = String.fromCharCode(92);

// Usuario con el que la APLICACIÓN se conecta: `root` por omisión; las pruebas de visibilidad lo cambian a un usuario con privilegios restringidos.
const sesion = vi.hoisted(() => ({ usuario: "root" }));
vi.mock("@/lib/db", async () => {
  const mysqlReal = await import("mysql2/promise");
  const pools = new Map<string, ReturnType<typeof mysqlReal.createPool>>();
  const obtener = () => {
    let pool = pools.get(sesion.usuario);
    if (!pool) {
      const b = String.fromCharCode(92);
      pool = mysqlReal.createPool({ socketPath: `${b}${b}.${b}pipe${b}${process.env.CB2_587_PIPE}`, user: sesion.usuario, password: "", database: "fondos_edicion_lineas", connectionLimit: 6 });
      pools.set(sesion.usuario, pool);
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

  it("CLIENTE ANTIGUO (sin ids): se rechaza ANTES de escribir tanto con líneas libres como con vinculadas; las líneas originales jamás se sustituyen en silencio", async () => {
    const antes = await foto();
    await expect(actualizarSolicitudFondo(E1, 1, { observaciones: "NO debe persistir", lineas: [{ categoria: "Combustible", monto: 10 }] })).rejects.toThrow(/no identifica ninguna de ellas/);
    expect(await foto()).toBe(antes);
    await admin.query("DELETE FROM flota_cb2_fondos_vinculos; DELETE FROM flota_combustible_cargas");   // ahora con líneas LIBRES
    const libres = await foto();
    await expect(actualizarSolicitudFondo(E1, 1, { lineas: [{ categoria: "Combustible", monto: 10 }, { categoria: "Otros", monto: 20 }] })).rejects.toThrow(/no identifica ninguna de ellas/);
    expect(await foto()).toBe(libres); expect(await idsDe(1)).toEqual([101, 102, 103]);
  });

  it("LÍNEA VINCULADA: se RECHAZA cambiar monto, cantidad, categoría o beneficiario sin ningún cambio parcial; SÍ se editan descripción, fecha y cuenta conservando id y vínculo", async () => {
    const antes = await foto();
    for (const cambio of [{ monto: 201 }, { cantidad: 2 }, { categoria: "Otros" }, { empleadoId: 77 }]) {
      const lineas = todas().map((l) => (l.id === 102 ? { ...l, ...cambio } : l));
      await expect(actualizarSolicitudFondo(E1, 1, { observaciones: "NO debe persistir", lineas }), JSON.stringify(cambio)).rejects.toThrow(/tiene vales de Combustible o vínculos CB2; no se puede cambiar/);
      expect(await foto()).toBe(antes);
    }
    await actualizarSolicitudFondo(E1, 1, { lineas: todas().map((l) => (l.id === 102 ? { ...l, descripcion: "nota", fechaViaje: "2026-11-20", metodoPago: "Transferencia" } : l)) });
    const [fila] = await R("SELECT id, categoria, monto, descripcion, metodo_pago, DATE_FORMAT(fecha_viaje, '%Y-%m-%d') AS f FROM tms_solicitud_fondo_lineas WHERE id = 102");
    expect([fila.id, fila.categoria, Number(fila.monto), fila.descripcion, fila.metodo_pago, fila.f]).toEqual([102, "Hospedaje", 200, "nota", "Transferencia", "2026-11-20"]);
    expect(Number((await R("SELECT COUNT(*) c FROM flota_combustible_cargas WHERE solicitud_fondo_linea_id = 102"))[0].c)).toBe(1);
  });

  it("ESTRUCTURA INCOMPATIBLE de una tabla de vínculos (existe pero sin la columna esperada): se DETIENE sin escribir; nunca se confunde con «sin vínculos»", async () => {
    await admin.query("ALTER TABLE flota_cb2_fondos_vinculos DROP FOREIGN KEY fk_cb2fv_linea, CHANGE linea_id linea_x INT NOT NULL");
    try {
      const lineasAntes = JSON.stringify(await R("SELECT * FROM tms_solicitud_fondo_lineas ORDER BY id")), cabAntes = JSON.stringify(await R("SELECT * FROM tms_solicitudes_fondo ORDER BY id"));
      await expect(actualizarSolicitudFondo(E1, 1, { observaciones: "NO debe persistir", lineas: [todas()[0], todas()[1]] })).rejects.toThrow(/la estructura de flota_cb2_fondos_vinculos no es la esperada/);   // retiraría la 103, que SÍ tiene vínculo
      expect(JSON.stringify(await R("SELECT * FROM tms_solicitud_fondo_lineas ORDER BY id"))).toBe(lineasAntes); expect(JSON.stringify(await R("SELECT * FROM tms_solicitudes_fondo ORDER BY id"))).toBe(cabAntes);
    } finally {
      await admin.query("ALTER TABLE flota_cb2_fondos_vinculos CHANGE linea_x linea_id INT NOT NULL, ADD CONSTRAINT fk_cb2fv_linea FOREIGN KEY(empresa_id, linea_id) REFERENCES tms_solicitud_fondo_lineas(empresa_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT");
    }
  });

  it("TABLAS OPCIONALES AUSENTES (módulos de Combustible/CB2 no instalados): no hay vínculos que comprobar y la edición procede", async () => {
    await admin.query("DROP TABLE flota_cb2_fondos_vinculos; DROP TABLE flota_combustible_cargas");
    try {
      await actualizarSolicitudFondo(E1, 1, { lineas: [todas()[0], todas()[2]] });   // retira la 102 (sin tabla de vales ya no hay vínculo que la proteja)
      expect(await idsDe(1)).toEqual([101, 103]);
    } finally {
      await admin.query(`CREATE TABLE flota_combustible_cargas(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, solicitud_fondo_linea_id INT NULL,
        CONSTRAINT fk_fcc_fondo_linea FOREIGN KEY(empresa_id, solicitud_fondo_linea_id) REFERENCES tms_solicitud_fondo_lineas(empresa_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT) ENGINE=InnoDB;
        CREATE TABLE flota_cb2_fondos_vinculos(empresa_id INT NOT NULL, consumo_id INT NOT NULL, linea_id INT NOT NULL, PRIMARY KEY(empresa_id, consumo_id),
        CONSTRAINT fk_cb2fv_linea FOREIGN KEY(empresa_id, linea_id) REFERENCES tms_solicitud_fondo_lineas(empresa_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT) ENGINE=InnoDB`);
    }
  });

  /** Un usuario de aplicación SIN privilegios sobre las tablas de Combustible/CB2: information_schema se las oculta, pero EXISTEN. */
  describe("visibilidad insuficiente del usuario de la base", () => {
    const DEBIL = "fondos_lim", ANCHO = "fondos_ancho";
    const TABLAS_FONDOS = ["tms_solicitudes_fondo", "tms_solicitud_fondo_lineas", "empleados", "auditoria"];
    const recrearModulos = async () => {
      await admin.query("DROP TABLE IF EXISTS flota_cb2_fondos_vinculos; DROP TABLE IF EXISTS flota_combustible_cargas");
      await admin.query(`CREATE TABLE flota_combustible_cargas(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, solicitud_fondo_linea_id INT NULL,
        CONSTRAINT fk_fcc_fondo_linea FOREIGN KEY(empresa_id, solicitud_fondo_linea_id) REFERENCES tms_solicitud_fondo_lineas(empresa_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT) ENGINE=InnoDB;
        CREATE TABLE flota_cb2_fondos_vinculos(empresa_id INT NOT NULL, consumo_id INT NOT NULL, linea_id INT NOT NULL, PRIMARY KEY(empresa_id, consumo_id),
        CONSTRAINT fk_cb2fv_linea FOREIGN KEY(empresa_id, linea_id) REFERENCES tms_solicitud_fondo_lineas(empresa_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT) ENGINE=InnoDB`);
    };
    beforeAll(async () => {
      await admin.query(`DROP USER IF EXISTS '${DEBIL}'@'localhost'; DROP USER IF EXISTS '${ANCHO}'@'localhost'; CREATE USER '${DEBIL}'@'localhost'; CREATE USER '${ANCHO}'@'localhost'`);
      for (const t of TABLAS_FONDOS) await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${LAB}.${t} TO '${DEBIL}'@'localhost'`);
      await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ${LAB}.* TO '${ANCHO}'@'localhost'; FLUSH PRIVILEGES`);
    });
    afterAll(async () => { sesion.usuario = "root"; await admin.query(`DROP USER IF EXISTS '${DEBIL}'@'localhost'; DROP USER IF EXISTS '${ANCHO}'@'localhost'`).catch(() => undefined); });
    afterEach(async () => { sesion.usuario = "root"; await recrearModulos(); });

    it("el usuario restringido NO ve las tablas de vínculos en information_schema aunque existan (es lo que una detección ingenua tomaría por «módulo ausente»)", async () => {
      const [[vis]] = await admin.query<RowDataPacket[]>(`SELECT COUNT(*) n FROM information_schema.TABLES WHERE TABLE_SCHEMA = '${LAB}' AND TABLE_NAME IN ('flota_combustible_cargas', 'flota_cb2_fondos_vinculos')`);
      expect(Number(vis.n)).toBe(2);   // root las ve
      const c = await mysql.createConnection({ socketPath: `${BARRA}${BARRA}.${BARRA}pipe${BARRA}${pipe}`, user: DEBIL, password: "", database: LAB });
      try {
        const [filas] = await c.query<RowDataPacket[]>("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN ('flota_combustible_cargas', 'flota_cb2_fondos_vinculos')");
        expect(filas).toHaveLength(0);   // oculta
        await expect(c.query("SELECT 1 FROM flota_combustible_cargas LIMIT 1")).rejects.toMatchObject({ errno: 1142 });   // pero existe: la sonda lo delata como acceso denegado
      } finally { await c.end(); }
    });

    it("con módulos presentes y usuario restringido: se DETIENE (visibilidad insuficiente); no se elimina la línea vinculada ni se cambia el monto, el beneficiario o la categoría", async () => {
      const antes = await foto();
      sesion.usuario = DEBIL;
      await expect(actualizarSolicitudFondo(E1, 1, { observaciones: "NO debe persistir", lineas: todas().slice(0, 2) })).rejects.toThrow(/vínculos con Combustible: el usuario de la base no tiene visibilidad suficiente sobre flota_combustible_cargas/);   // retiraría la 103
      await expect(actualizarSolicitudFondo(E1, 1, { lineas: todas().map((l) => (l.id === 102 ? { ...l, monto: 999 } : l)) })).rejects.toThrow(/visibilidad suficiente/);
      await expect(actualizarSolicitudFondo(E1, 1, { lineas: todas().map((l) => (l.id === 102 ? { ...l, categoria: "Otros", empleadoId: 5 } : l)) })).rejects.toThrow(/visibilidad suficiente/);
      sesion.usuario = "root";
      expect(await foto()).toBe(antes);
    });

    it("con módulos AUSENTES de verdad y un usuario con acceso a toda la base: la sonda responde «no existe», information_schema ve las tablas de Fondos y la edición procede", async () => {
      await admin.query("DROP TABLE flota_cb2_fondos_vinculos; DROP TABLE flota_combustible_cargas");
      sesion.usuario = ANCHO;
      await actualizarSolicitudFondo(E1, 1, { lineas: [todas()[0], todas()[2]] });
      sesion.usuario = "root";
      expect(await idsDe(1)).toEqual([101, 103]);
    });

    it("con módulos ausentes y un usuario SIN privilegios sobre ellos: no se puede distinguir «ausente» de «oculto» — se detiene en lugar de asumir que son libres", async () => {
      await admin.query("DROP TABLE flota_cb2_fondos_vinculos; DROP TABLE flota_combustible_cargas");
      const antes = JSON.stringify(await R("SELECT * FROM tms_solicitud_fondo_lineas ORDER BY id"));
      sesion.usuario = DEBIL;
      await expect(actualizarSolicitudFondo(E1, 1, { lineas: [todas()[0], todas()[2]] })).rejects.toThrow(/visibilidad suficiente/);
      sesion.usuario = "root";
      expect(JSON.stringify(await R("SELECT * FROM tms_solicitud_fondo_lineas ORDER BY id"))).toBe(antes);
    });
  });

  /** `fecha_viaje` de una línea vinculada: ni Combustible ni CB2 la leen (usan la fecha de la SOLICITUD); solo los reportes la usan como dimensión. */
  it("FECHA DEL VIAJE de una línea vinculada: cambiarla no altera NADA de lo que CB2 y Combustible leen, congelan o validan (snapshot de CB2 idéntico, vínculos intactos)", async () => {
    const snapshotCb2 = async () => JSON.stringify(await R(`SELECT l.id, s.codigo, s.estado, CAST(l.cantidad*l.monto AS DECIMAL(22,4)) AS monto, DATE_FORMAT(s.fecha_requerimiento,'%Y-%m-%d') AS fecha, l.empleado_nombre AS persona, l.placa,
      l.categoria, l.vehiculo_id FROM tms_solicitud_fondo_lineas l JOIN tms_solicitudes_fondo s ON s.empresa_id = l.empresa_id AND s.id = l.solicitud_id WHERE l.empresa_id = ${E1} AND l.id IN (102, 103) ORDER BY l.id`));   // misma proyección que cb2/fondos.ts y combustible-fondos.ts
    const vinculos = async () => JSON.stringify([await R("SELECT * FROM flota_combustible_cargas"), await R("SELECT * FROM flota_cb2_fondos_vinculos")]);
    const antes = [await snapshotCb2(), await vinculos()];
    await actualizarSolicitudFondo(E1, 1, { lineas: todas().map((l) => (l.id === 102 || l.id === 103 ? { ...l, fechaViaje: "2026-12-24" } : l)) });
    expect((await R("SELECT DATE_FORMAT(fecha_viaje, '%Y-%m-%d') AS f FROM tms_solicitud_fondo_lineas WHERE id IN (102, 103) ORDER BY id")).map((x) => x.f)).toEqual(["2026-12-24", "2026-12-24"]);
    expect([await snapshotCb2(), await vinculos()]).toEqual(antes);
  });
});

/** Premisa de la decisión sobre `fecha_viaje` (ver fondo-lineas-protegidas.ts): ningún código de Flota (Combustible/CB2) lee la fecha de la LÍNEA de fondos. Si algún día lo hace, hay que protegerla. */
describe("premisa: Combustible y CB2 no dependen de fecha_viaje de la línea (análisis estático, sin base de datos)", () => {
  const archivos = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? archivos(path.join(dir, e.name)) : /\.(ts|tsx)$/.test(e.name) && !/\.(test|fixture)\./.test(e.name) ? [path.join(dir, e.name)] : []));
  it("ningún lector de src/lib/flota ni de sus rutas menciona fecha_viaje / fechaViaje", () => {
    const lectores = [...archivos(path.join("src", "lib", "flota")), ...archivos(path.join("src", "app", "api", "empresas", "[slug]", "flota"))];
    expect(lectores.length).toBeGreaterThan(50);
    expect(lectores.filter((f) => /\b(fecha_viaje|fechaViaje)\b/.test(readFileSync(f, "utf8")))).toEqual([]);
  });
  it("el contraste de CB2 y la validación de Combustible usan la fecha de la SOLICITUD (fecha_requerimiento), no la de la línea", () => {
    expect(readFileSync(path.join("src", "lib", "flota", "cb2", "fondos.ts"), "utf8")).toContain("s.fecha_requerimiento");
    expect(readFileSync(path.join("src", "lib", "flota", "combustible-fondos.ts"), "utf8")).toContain("SELECT categoria, vehiculo_id FROM tms_solicitud_fondo_lineas");   // la validación solo lee categoría y unidad de la línea
  });
});
