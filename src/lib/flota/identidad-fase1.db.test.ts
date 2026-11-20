import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * FASE 1 de la identidad maestra, contra una MariaDB LOCAL y DESECHABLE (127.0.0.1, root sin contraseña). Se OMITE sin `FLOTA_CANON_DB_PORT`.
 * Crea SU PROPIO esquema reducido e instala las migraciones REALES M1 (fusiones) y M3 (identidad física). Ejecuta el código REAL: proponer/aprobar identidad
 * (incluida la aprobación DELEGADA y las operaciones abiertas solo en la representante), catalogoSinAlias, anotarIdentidades y la guarda de alta.
 * Caso modelado: #602 (Fresco Fresh, empresa 4) ↔ #1296 (Mónaco, empresa 1), misma placa y chasis, #602 compartida con Mónaco y con 3 planes programados en #1296.
 * Datos sintéticos; nada toca producción.
 */
const PUERTO = process.env.FLOTA_CANON_DB_PORT;
const ESQUEMA = "flota_identidad_fase1";

vi.mock("@/lib/db", async () => {
  const mysql = await import("mysql2/promise");
  let pool: ReturnType<typeof mysql.createPool> | null = null;
  const obtener = () => {
    if (!pool) pool = mysql.createPool({ host: "127.0.0.1", port: Number(process.env.FLOTA_CANON_DB_PORT), user: "root", password: "", database: "flota_identidad_fase1", connectionLimit: 8, timezone: "local" });
    return pool;
  };
  return { getPool: obtener, query: async (sql: string, params: unknown[] = []) => (await obtener().query(sql, params as never))[0] };
});

import mysql from "mysql2/promise";
import { getPool } from "@/lib/db";
import { aprobarIdentidadFisica, consultarIdentidadFisica, inspeccionarIdentidadFisica, proponerIdentidadFisica, type ContextoFisico } from "./identidad-fisica";
import { catalogoSinAlias } from "./vehiculos-alias";
import { anotarIdentidades } from "./vehiculos-identidad";
import { exigirSinIdentidadVinculadaTx, fichaEnIdentidadTx, ErrorIdentidadVehiculo } from "./vehiculos-escritura";

const MONACO = 1, FRESCO = 4, ADMIN = 1;
const q = async (sql: string, params: unknown[] = []) => (await getPool().query(sql, params as never))[0] as Record<string, unknown>[];
const ctx = (empresaId: number): ContextoFisico => ({ empresaId, usuarioId: ADMIN, usuario: "admin", autorizar: async () => undefined });
const huella = async () => createHash("sha256").update(JSON.stringify(await q("SELECT l.id, l.vehiculo_id, l.placa, l.monto, l.solicitud_id FROM tms_solicitud_fondo_lineas l ORDER BY l.id"))).digest("hex");

async function dividirScript(ruta: string, c: mysql.Connection) {
  const sql = readFileSync(ruta, "utf8").replace(/^\s*--.*$/gm, ""); // los comentarios contienen ";"
  const [antes, resto] = sql.split(/DELIMITER\s+\/\//i);
  for (const parte of antes.split(";")) if (parte.trim()) await c.query(parte);
  const [bloque, despues] = resto.split(/DELIMITER\s+;/i);
  for (const parte of bloque.split("//")) if (parte.trim()) await c.query(parte);
  for (const parte of (despues ?? "").split(";")) if (parte.trim()) await c.query(parte);
}

async function crearEsquema() {
  const admin = await mysql.createConnection({ host: "127.0.0.1", port: Number(PUERTO), user: "root", password: "", multipleStatements: true });
  await admin.query(`DROP DATABASE IF EXISTS ${ESQUEMA}`);
  await admin.query(`CREATE DATABASE ${ESQUEMA} CHARACTER SET utf8mb4`);
  await admin.end();
  const c = await mysql.createConnection({ host: "127.0.0.1", port: Number(PUERTO), user: "root", password: "", database: ESQUEMA, multipleStatements: true });
  await c.query(`
    CREATE TABLE empresas (id INT PRIMARY KEY, nombre VARCHAR(80), activa TINYINT NOT NULL DEFAULT 1) ENGINE=InnoDB;
    CREATE TABLE usuarios (id INT PRIMARY KEY, activo TINYINT NOT NULL DEFAULT 1, rol_global VARCHAR(30) NOT NULL) ENGINE=InnoDB;
    CREATE TABLE auditoria (id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NULL, usuario VARCHAR(100) NULL, accion VARCHAR(100), modulo VARCHAR(60) NULL, detalle LONGTEXT NULL, creado_en DATETIME DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB;
    CREATE TABLE flota_vehiculos (
      id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, placa VARCHAR(40) NOT NULL, descripcion VARCHAR(200) NULL,
      tipo_unidad VARCHAR(20) NOT NULL DEFAULT 'VEHICULO', chasis VARCHAR(80) NULL, en_taller TINYINT(1) NOT NULL DEFAULT 0,
      estado VARCHAR(40) NOT NULL DEFAULT 'Activo', activo TINYINT(1) NOT NULL DEFAULT 1,
      tipo_propiedad VARCHAR(20) NULL, empresa_propietaria_id INT NULL, propietario_externo VARCHAR(120) NULL,
      UNIQUE KEY uq_placa (empresa_id, placa), UNIQUE KEY uq_emp_id (empresa_id, id)
    ) ENGINE=InnoDB;
    CREATE TABLE flota_vehiculo_acceso (vehiculo_id INT NOT NULL, empresa_id INT NOT NULL, PRIMARY KEY (vehiculo_id, empresa_id)) ENGINE=InnoDB;
    CREATE TABLE flota_viajes (id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, vehiculo_id INT NOT NULL, estado VARCHAR(20) NOT NULL DEFAULT 'cerrado', hora_llegada DATETIME NULL,
      FOREIGN KEY (vehiculo_id) REFERENCES flota_vehiculos(id)) ENGINE=InnoDB;
    CREATE TABLE tms_cotizacion_costeo_perfiles (id INT AUTO_INCREMENT PRIMARY KEY, nombre VARCHAR(60)) ENGINE=InnoDB;
    CREATE TABLE tms_unidades (id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, placa VARCHAR(40) NOT NULL, flota_vehiculo_id INT NULL) ENGINE=InnoDB;
    CREATE TABLE tms_planes_viaje (id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, codigo VARCHAR(40) NOT NULL, estado VARCHAR(20) NOT NULL DEFAULT 'Cerrado', fecha_plan DATE NOT NULL,
      unidad_id INT NULL, tc_vehiculo_id INT NULL, vehiculo_solicitado_perfil_id INT NULL,
      FOREIGN KEY (vehiculo_solicitado_perfil_id) REFERENCES tms_cotizacion_costeo_perfiles(id)) ENGINE=InnoDB;
    CREATE TABLE tms_solicitudes_fondo (id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, codigo VARCHAR(40) NOT NULL, fecha_requerimiento DATE NOT NULL, total DECIMAL(12,2) NOT NULL DEFAULT 0,
      estado VARCHAR(30) NOT NULL DEFAULT 'Pendiente', UNIQUE KEY uq (empresa_id, codigo), UNIQUE KEY uq_id (empresa_id, id)) ENGINE=InnoDB;
    CREATE TABLE tms_solicitud_fondo_lineas (id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, solicitud_id INT NOT NULL, categoria VARCHAR(40) NOT NULL, monto DECIMAL(12,2) NOT NULL,
      vehiculo_id INT NULL, placa VARCHAR(20) NULL, FOREIGN KEY (vehiculo_id) REFERENCES flota_vehiculos(id) ON DELETE RESTRICT,
      FOREIGN KEY (empresa_id, solicitud_id) REFERENCES tms_solicitudes_fondo (empresa_id, id) ON DELETE CASCADE) ENGINE=InnoDB;
  `);
  await dividirScript("sql/migrate-2026-11-flota-fusiones.sql", c);          // M1
  await dividirScript("sql/migrate-2026-11-flota-identidad-fisica.sql", c);  // M3 (tablas, disparadores y guardas)
  await c.end();
}

async function sembrar() {
  await q("INSERT INTO empresas (id, nombre, activa) VALUES (1,'Mónaco',1),(4,'Fresco Fresh',1),(5,'Otra',1)");
  await q("INSERT INTO usuarios (id, activo, rol_global) VALUES (1,1,'Admin')");
  await q("INSERT INTO flota_vehiculos (id, empresa_id, placa, chasis, tipo_unidad) VALUES (602,4,'C-034BXR','ABC123456789','VEHICULO'),(1296,1,'C 034 BXR','abc123456789','VEHICULO'),(603,4,'C-035BXR','ZZZ999888777','VEHICULO'),(1297,1,'C-035BXR','OTRO12345678','VEHICULO')");
  await q("INSERT INTO flota_vehiculo_acceso VALUES (602,1),(603,1)");
  await q("INSERT INTO tms_unidades (id, empresa_id, placa, flota_vehiculo_id) VALUES (398,1,'C-034BXR',1296)");
  await q("INSERT INTO tms_planes_viaje (empresa_id, codigo, estado, fecha_plan, unidad_id) VALUES (1,'P1','Programado','2026-11-20',398),(1,'P2','Programado','2026-11-21',398),(1,'P3','Programado','2026-11-22',398)");
  await q("INSERT INTO tms_solicitudes_fondo (id, empresa_id, codigo, fecha_requerimiento, total, estado) VALUES (135,1,'FONDO-000135','2026-11-10',9977.08,'Liquidada')");
  await q("INSERT INTO tms_solicitud_fondo_lineas (empresa_id, solicitud_id, categoria, monto, vehiculo_id, placa) VALUES (1,135,'Combustible',335.90,602,'C-034BXR'),(1,135,'Combustible',749.10,602,'C-034BXR'),(1,135,'Otros',100,1296,'C-034BXR')");
}

describe.skipIf(!PUERTO)("Fase 1 de la identidad maestra contra MariaDB (M1 + M3 reales)", () => {
  beforeAll(async () => { await crearEsquema(); await sembrar(); }, 180_000);
  afterAll(async () => { const c = await mysql.createConnection({ host: "127.0.0.1", port: Number(PUERTO), user: "root", password: "" }); try { await (getPool() as unknown as { end: () => Promise<void> }).end(); await c.query(`DROP DATABASE IF EXISTS ${ESQUEMA}`); } finally { await c.end(); } });

  let identidadId = 0, huellaAntes = "";
  it("sin el interruptor, las operaciones abiertas en #1296 (3 planes programados) siguen BLOQUEANDO la propuesta (comportamiento actual)", async () => {
    vi.stubEnv("FLOTA_IDENTIDAD_OPERACIONES_EN_REPRESENTANTE", "");
    const insp = await inspeccionarIdentidadFisica(ctx(MONACO), [602, 1296]);
    expect(insp.compatible).toBe(true); // placa comparable, tipo y chasis coinciden
    const revisiones = Object.fromEntries(insp.vehiculos.map(v => [String(v.id), v.revision]));
    await expect(proponerIdentidadFisica(ctx(MONACO), { ids: [602, 1296], revisiones, motivo: "Misma unidad física: tarjeta de circulación verificada." })).rejects.toThrow(/pendientes/);
    expect(await q("SELECT id FROM flota_identidades_fisicas")).toHaveLength(0);
  });

  it("con el interruptor, una operación de Mónaco en la ficha COMPARTIDA #602 (no representante) sigue bloqueando", async () => {
    vi.stubEnv("FLOTA_IDENTIDAD_OPERACIONES_EN_REPRESENTANTE", "1");
    await q("INSERT INTO tms_planes_viaje (empresa_id, codigo, estado, fecha_plan, tc_vehiculo_id) VALUES (1,'PX','Programado','2026-11-25',602)");
    const insp = await inspeccionarIdentidadFisica(ctx(MONACO), [602, 1296]);
    const revisiones = Object.fromEntries(insp.vehiculos.map(v => [String(v.id), v.revision]));
    await expect(proponerIdentidadFisica(ctx(MONACO), { ids: [602, 1296], revisiones, motivo: "Misma unidad física: tarjeta de circulación verificada." })).rejects.toThrow(/no es la representante/);
    await q("DELETE FROM tms_planes_viaje WHERE codigo='PX'");
  });

  it("con el interruptor, las operaciones abiertas SOLO en la representante (#1296 para Mónaco) permiten proponer; los históricos no se tocan", async () => {
    vi.stubEnv("FLOTA_IDENTIDAD_OPERACIONES_EN_REPRESENTANTE", "1");
    huellaAntes = await huella();
    const insp = await inspeccionarIdentidadFisica(ctx(MONACO), [602, 1296]);
    const revisiones = Object.fromEntries(insp.vehiculos.map(v => [String(v.id), v.revision]));
    const r = await proponerIdentidadFisica(ctx(MONACO), { ids: [602, 1296], revisiones, motivo: "Misma unidad física: tarjeta de circulación verificada." });
    identidadId = Number(r.id);
    expect(r.estado).toBe("PROPUESTA");
    expect((await q("SELECT empresa_id FROM flota_identidad_empresas WHERE identidad_id=? ORDER BY empresa_id", [identidadId])).map(x => Number(x.empresa_id))).toEqual([1, 4]);
  });

  it("aprobación de Mónaco y aprobación DELEGADA de Fresco Fresh (sin su módulo): queda APROBADA, con evidencia y auditoría marcadas como delegadas", async () => {
    const vm = await consultarIdentidadFisica(ctx(MONACO), identidadId) as { revision: string };
    expect((await aprobarIdentidadFisica(ctx(MONACO), { id: identidadId, revision: vm.revision, evidencia: "Tarjeta de circulación #123 verificada por Mónaco." })).estado).toBe("PROPUESTA");
    const vf = await consultarIdentidadFisica(ctx(FRESCO), identidadId) as { revision: string };
    const r = await aprobarIdentidadFisica(ctx(FRESCO), { id: identidadId, revision: vf.revision, evidencia: "Tarjeta de circulación #123 verificada para Fresco Fresh.", delegadaDesdeEmpresaId: MONACO });
    expect(r.estado).toBe("APROBADA");
    const ap = await q("SELECT empresa_id, administrador_id, evidencia FROM flota_identidad_aprobaciones WHERE identidad_id=? ORDER BY empresa_id", [identidadId]);
    expect(ap.map(x => Number(x.empresa_id))).toEqual([1, 4]);
    expect(String(ap[1].evidencia)).toMatch(/^\[Aprobación delegada desde la empresa 1\] /);
    expect(String(ap[0].evidencia)).not.toMatch(/delegada/);
    const aud = (await q("SELECT detalle FROM auditoria WHERE accion='aprobar_identidad_fisica' ORDER BY id")).map(x => JSON.parse(String(x.detalle)));
    expect(aud.find(a => a.empresa === 4)).toMatchObject({ delegadaDesde: 1 });
    expect(aud.find(a => a.empresa === 1)).not.toHaveProperty("delegadaDesde");
  });

  it("históricos intactos: FONDO-000135 y las líneas de #602 y #1296 conservan su ficha y su placa guardada", async () => {
    expect(await huella()).toBe(huellaAntes);
  });

  it("catálogo desde Mónaco: UNA sola unidad (la representante #1296); desde Fresco Fresh: UNA (la propia #602)", async () => {
    const lista = async (emp: number) => (await q("SELECT v.* FROM flota_vehiculos v WHERE v.placa LIKE '%034%' AND (v.empresa_id=? OR EXISTS (SELECT 1 FROM flota_vehiculo_acceso a WHERE a.vehiculo_id=v.id AND a.empresa_id=?)) ORDER BY v.id", [emp, emp])).map(v => ({ ...v, id: Number(v.id) }));
    const mon = await catalogoSinAlias(await lista(MONACO), MONACO);
    expect(mon.map(v => v.id)).toEqual([1296]);
    expect(mon[0]).toMatchObject({ identidadFisicaId: identidadId });
    expect([...(mon[0] as { equivalenciasHistoricas: number[] }).equivalenciasHistoricas].sort((x, y) => x - y)).toEqual([602, 1296]);
    const fresco = await catalogoSinAlias(await lista(FRESCO), FRESCO);
    expect(fresco.map(v => v.id)).toEqual([602]);
  });

  it("anotarIdentidades (pantallas de Flota): #602 queda como vinculada a #1296; la lista sigue completa para resolver históricos", async () => {
    const filas = (await q("SELECT v.* FROM flota_vehiculos v WHERE v.placa LIKE '%034%' ORDER BY v.id")).map(v => ({ ...v, id: Number(v.id) }));
    const anotadas = await anotarIdentidades(filas, MONACO);
    expect(anotadas).toHaveLength(2);
    const por = Object.fromEntries(anotadas.map(v => [v.id, v]));
    expect(por[1296]).toMatchObject({ esRepresentante: true, vinculadaA: null, fichasVinculadas: [602] });
    expect(por[602]).toMatchObject({ esRepresentante: false, vinculadaA: 1296, identidadFisicaId: identidadId, fichasVinculadas: [1296] });
    const sinIdentidad = (await q("SELECT v.* FROM flota_vehiculos v WHERE v.placa LIKE '%035%' ORDER BY v.id")).map(v => ({ ...v, id: Number(v.id) }));
    expect((await anotarIdentidades(sinIdentidad, MONACO)).every(v => v.esRepresentante)).toBe(true); // #603/#1297 sin identidad: nada se oculta
  });

  it("guarda de alta: no se crea otra ficha con la placa de una unidad con identidad APROBADA (cualquier empresa y formato); otras placas y el interruptor apagado pasan", async () => {
    const c = await getPool().getConnection();
    try {
      for (const placa of ["C-034BXR", "c 034 bxr", "C034BXR"]) {
        await expect(exigirSinIdentidadVinculadaTx(c as never, placa)).rejects.toMatchObject({ status: 409, codigo: "PLACA_CON_IDENTIDAD_VINCULADA" });
      }
      await expect(exigirSinIdentidadVinculadaTx(c as never, "C-035BXR")).resolves.toBeUndefined(); // #603/#1297 aún sin identidad: no bloquea
      await expect(exigirSinIdentidadVinculadaTx(c as never, "P-777ZZZ")).resolves.toBeUndefined();
      vi.stubEnv("FLOTA_GUARDA_ALTA_IDENTIDAD", "0");
      await expect(exigirSinIdentidadVinculadaTx(c as never, "C-034BXR")).resolves.toBeUndefined();
      vi.stubEnv("FLOTA_GUARDA_ALTA_IDENTIDAD", "");
      await expect(exigirSinIdentidadVinculadaTx(c as never, "C-034BXR")).rejects.toBeInstanceOf(ErrorIdentidadVehiculo);
    } finally { c.release(); }
  });

  it("el chasis de una ficha miembro de una identidad es INMUTABLE (el disparador lo impide) y la ficha se detecta como miembro", async () => {
    const c = await getPool().getConnection();
    try {
      expect(await fichaEnIdentidadTx(c as never, 602)).toBe(true);
      expect(await fichaEnIdentidadTx(c as never, 603)).toBe(false);
    } finally { c.release(); }
    await expect(q("UPDATE flota_vehiculos SET chasis='OTROCHASIS123' WHERE id=602")).rejects.toThrow(/requiere revision independiente/);
    await expect(q("UPDATE flota_vehiculos SET chasis='NUEVOCHASIS123' WHERE id=603")).resolves.toBeDefined(); // una ficha sin identidad sí puede recibir chasis
  });

  it("sin la identidad aprobada la ruta de operaciones abiertas con fichas de una sola empresa tampoco cambia: #603 ↔ #1297 con chasis distinto NO acredita identidad", async () => {
    const insp = await inspeccionarIdentidadFisica(ctx(MONACO), [603, 1297]);
    expect(insp.compatible).toBe(false);
    expect(insp.motivo).toMatch(/No acredita la misma unidad/i);
  });
});
