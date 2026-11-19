import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * VERIFICACIÓN CONTRA UNA BASE REAL DESECHABLE — consolidación de vehículos por alias (caso «558 BSJ»: ID 2 con planes de viaje, ID 3 con
 * solicitudes de fondos).
 *
 * Se OMITE por defecto. Solo corre con `FLOTA_CANON_DB_PORT` apuntando a una MariaDB LOCAL y DESECHABLE (127.0.0.1, root sin contraseña). Crea y
 * destruye SU PROPIO esquema `flota_canon_test` con un esquema REDUCIDO e instala la migración REAL sql/migrate-2026-11-flota-fusiones.sql (con sus
 * triggers y guardas por columna). Ejecuta el código REAL: fusionarVehiculos, referencias, resolverUnidadCanonica (vía idsHistoricosVehiculo),
 * canonizarVehiculoTx, canonicosDeAlias y reporteSolicitudesFondo / obtenerReporteGastosPorTipo. Datos sintéticos; nada toca producción.
 */
const PUERTO = process.env.FLOTA_CANON_DB_PORT;
const ESQUEMA = "flota_canon_test";

vi.mock("@/lib/db", async () => {
  const mysql = await import("mysql2/promise");
  let pool: ReturnType<typeof mysql.createPool> | null = null;
  const obtener = () => {
    if (!pool) pool = mysql.createPool({ host: "127.0.0.1", port: Number(process.env.FLOTA_CANON_DB_PORT), user: "root", password: "", database: "flota_canon_test", connectionLimit: 6, timezone: "local" });
    return pool;
  };
  return { getPool: obtener, query: async (sql: string, params: unknown[] = []) => (await obtener().query(sql, params as never))[0] };
});

import mysql from "mysql2/promise";
import { getPool } from "@/lib/db";
import { fusionarVehiculos } from "./vehiculos-fusion";
import { referencias } from "./vehiculos-duplicados";
import { canonicosDeAlias, canonizarVehiculoTx, idsHistoricosVehiculo } from "./vehiculos-alias";
import { obtenerReporteGastosPorTipo, reporteSolicitudesFondo } from "@/lib/tms/reportes-gastos";

const E1 = 1;
const ADMIN = 1;
const q = async (sql: string, params: unknown[] = []) => (await getPool().query(sql, params as never))[0] as Record<string, unknown>[];

/** Ejecuta un script .sql real: sin DELIMITER (todo junto) o con bloque DELIMITER // ... DELIMITER ; (se parte como en crearEsquema). */
async function ejecutarScript(ruta: string): Promise<void> {
  const c = await mysql.createConnection({ host: "127.0.0.1", port: Number(PUERTO), user: "root", password: "", database: ESQUEMA, multipleStatements: true });
  try {
    const sql = readFileSync(ruta, "utf8").replace(/^\s*--.*$/gm, "");
    if (!/DELIMITER/i.test(sql)) { await c.query(sql); return; }
    const [antes, resto] = sql.split(/DELIMITER\s+\/\//i);
    for (const parte of antes.split(";")) if (parte.trim()) await c.query(parte);
    const [bloque, despues] = resto.split(/DELIMITER\s+;/i);
    for (const parte of bloque.split("//")) if (parte.trim()) await c.query(parte);
    for (const parte of (despues ?? "").split(";")) if (parte.trim()) await c.query(parte);
  } finally { await c.end(); }
}
/** Ejecuta un script de SOLO LECTURA con varias consultas y devuelve el resultado de cada una. */
async function consultasScript(ruta: string, primeras?: number): Promise<Record<string, unknown>[][]> {
  const c = await mysql.createConnection({ host: "127.0.0.1", port: Number(PUERTO), user: "root", password: "", database: ESQUEMA, multipleStatements: true });
  try {
    const sentencias = readFileSync(ruta, "utf8").replace(/^\s*--.*$/gm, "").split(";").filter((x) => x.trim());
    const r = (await c.query(sentencias.slice(0, primeras ?? sentencias.length).join(";\n")))[0] as unknown;
    return (primeras === 1 ? [r] : r) as Record<string, unknown>[][];
  } finally { await c.end(); }
}
const accionGuardas = async () => q("SELECT TRIGGER_NAME, EVENT_MANIPULATION, ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND EVENT_OBJECT_TABLE='tms_planes_viaje' AND TRIGGER_NAME REGEXP '^ff[iu]_' ORDER BY TRIGGER_NAME");

async function crearEsquema() {
  const admin = await mysql.createConnection({ host: "127.0.0.1", port: Number(PUERTO), user: "root", password: "", multipleStatements: true });
  await admin.query(`DROP DATABASE IF EXISTS ${ESQUEMA}`);
  await admin.query(`CREATE DATABASE ${ESQUEMA} CHARACTER SET utf8mb4`);
  await admin.end();
  const c = await mysql.createConnection({ host: "127.0.0.1", port: Number(PUERTO), user: "root", password: "", database: ESQUEMA, multipleStatements: true });
  await c.query(`
    CREATE TABLE empresas (id INT PRIMARY KEY, nombre VARCHAR(80)) ENGINE=InnoDB;
    CREATE TABLE usuarios (id INT PRIMARY KEY, activo TINYINT NOT NULL DEFAULT 1, rol_global VARCHAR(30) NOT NULL) ENGINE=InnoDB;
    CREATE TABLE auditoria (id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NULL, usuario VARCHAR(100) NULL, accion VARCHAR(100), modulo VARCHAR(60) NULL, detalle LONGTEXT NULL, creado_en DATETIME DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB;
    CREATE TABLE flota_vehiculos (
      id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, placa VARCHAR(40) NOT NULL, descripcion VARCHAR(200) NULL,
      tipo_unidad VARCHAR(20) NOT NULL DEFAULT 'VEHICULO', chasis VARCHAR(80) NULL, en_taller TINYINT(1) NOT NULL DEFAULT 0,
      estado VARCHAR(40) NOT NULL DEFAULT 'Activo', activo TINYINT(1) NOT NULL DEFAULT 1,
      UNIQUE KEY uq_placa (empresa_id, placa), UNIQUE KEY uq_emp_id (empresa_id, id)
    ) ENGINE=InnoDB;
    CREATE TABLE flota_vehiculo_acceso (vehiculo_id INT NOT NULL, empresa_id INT NOT NULL, PRIMARY KEY (vehiculo_id, empresa_id)) ENGINE=InnoDB;
    CREATE TABLE flota_viajes (id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, vehiculo_id INT NOT NULL, estado VARCHAR(20) NOT NULL DEFAULT 'cerrado', hora_llegada DATETIME NULL,
      FOREIGN KEY (vehiculo_id) REFERENCES flota_vehiculos(id)) ENGINE=InnoDB;
    CREATE TABLE tms_cotizacion_costeo_perfiles (id INT AUTO_INCREMENT PRIMARY KEY, nombre VARCHAR(60)) ENGINE=InnoDB;
    CREATE TABLE tms_unidades (id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, placa VARCHAR(40) NOT NULL, flota_vehiculo_id INT NULL) ENGINE=InnoDB;
    CREATE TABLE tms_planes_viaje (id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, codigo VARCHAR(40) NOT NULL, ruta_codigo_historico VARCHAR(40) NULL, estado VARCHAR(20) NOT NULL DEFAULT 'Cerrado', fecha_plan DATE NOT NULL,
      unidad_id INT NULL, tc_vehiculo_id INT NULL, vehiculo_solicitado_perfil_id INT NULL,
      FOREIGN KEY (vehiculo_solicitado_perfil_id) REFERENCES tms_cotizacion_costeo_perfiles(id)) ENGINE=InnoDB;
    CREATE TABLE tms_solicitudes_fondo (
      id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, codigo VARCHAR(40) NOT NULL, entidad_requirente_nombre VARCHAR(200) NULL, requirente_nombre VARCHAR(200) NULL,
      requirente_usuario_id INT NULL, solicitante_nombre VARCHAR(200) NULL, autorizante_nombre VARCHAR(200) NULL, fecha_requerimiento DATE NOT NULL,
      total DECIMAL(12,2) NOT NULL DEFAULT 0, estado VARCHAR(30) NOT NULL DEFAULT 'Pendiente', autorizado_en DATETIME NULL, observaciones VARCHAR(300) NULL,
      UNIQUE KEY uq (empresa_id, codigo), UNIQUE KEY uq_id (empresa_id, id)
    ) ENGINE=InnoDB;
    CREATE TABLE tms_solicitud_fondo_lineas (
      id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, solicitud_id INT NOT NULL, categoria VARCHAR(40) NOT NULL, descripcion VARCHAR(300) NULL,
      cantidad DECIMAL(10,2) NOT NULL DEFAULT 1, monto DECIMAL(12,2) NOT NULL, fecha_viaje DATE NULL, empleado_id INT NULL, empleado_nombre VARCHAR(200) NULL, cargo VARCHAR(100) NULL,
      vehiculo_id INT NULL, placa VARCHAR(20) NULL, cliente_id INT NULL, cliente_nombre VARCHAR(200) NULL, plan_id INT NULL, orden INT NOT NULL DEFAULT 0,
      cuenta VARCHAR(80) NULL, metodo_pago VARCHAR(40) NULL,
      FOREIGN KEY (vehiculo_id) REFERENCES flota_vehiculos(id) ON DELETE RESTRICT,
      FOREIGN KEY (empresa_id, solicitud_id) REFERENCES tms_solicitudes_fondo (empresa_id, id) ON DELETE CASCADE
    ) ENGINE=InnoDB;
    CREATE TABLE empleados (id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, nombre VARCHAR(100), puesto VARCHAR(60)) ENGINE=InnoDB;
    CREATE TABLE tms_clientes (id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, nombre VARCHAR(100)) ENGINE=InnoDB;
    CREATE TABLE tms_gastos_operativos (id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, fecha_solicitud DATE NOT NULL, fecha_viaje DATE NULL, empleado_id INT NULL,
      vehiculo_id INT NULL, cliente_id INT NULL, plan_id INT NULL, categoria VARCHAR(40) NOT NULL, descripcion VARCHAR(300) NULL,
      cantidad DECIMAL(10,2) NOT NULL DEFAULT 1, monto DECIMAL(12,2) NOT NULL, metodo_pago VARCHAR(40) NULL, numero_cuenta_pago VARCHAR(80) NULL,
      observaciones VARCHAR(300) NULL, creado_por VARCHAR(100) NULL, activo TINYINT(1) NOT NULL DEFAULT 1, FOREIGN KEY (vehiculo_id) REFERENCES flota_vehiculos(id)) ENGINE=InnoDB;
    CREATE TABLE tms_gasto_operativo_lineas (id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, gasto_id INT NOT NULL, fecha_viaje DATE NULL, plan_id INT NULL,
      empleado_id INT NULL, empleado_nombre VARCHAR(100) NULL, cargo VARCHAR(100) NULL, vehiculo_id INT NULL, placa VARCHAR(20) NULL, cliente_id INT NULL, cliente_nombre VARCHAR(100) NULL,
      categoria VARCHAR(40) NOT NULL, descripcion VARCHAR(300) NULL, cantidad DECIMAL(10,2) NOT NULL DEFAULT 1, monto DECIMAL(12,2) NOT NULL, metodo_pago VARCHAR(40) NULL,
      numero_cuenta_pago VARCHAR(80) NULL, FOREIGN KEY (vehiculo_id) REFERENCES flota_vehiculos(id), FOREIGN KEY (gasto_id) REFERENCES tms_gastos_operativos(id)) ENGINE=InnoDB;
  `);
  // Migración REAL de fusiones: tabla + triggers (parte 1) y procedimiento que instala las guardas por columna (parte 2, con DELIMITER //).
  const sql = readFileSync("sql/migrate-2026-11-flota-fusiones.sql", "utf8").replace(/^\s*--.*$/gm, ""); // los comentarios contienen ";"
  const [antes, resto] = sql.split(/DELIMITER\s+\/\//i);
  for (const parte of antes.split(";")) if (parte.trim()) await c.query(parte);
  for (const parte of resto.split(/DELIMITER\s+;/i)[0].split("//")) if (parte.trim()) await c.query(parte);
  await c.end();
}

type V = { empresa?: number; placa: string; chasis?: string };
async function vehiculo(v: V): Promise<number> {
  return Number(((await getPool().query("INSERT INTO flota_vehiculos (empresa_id, placa, chasis) VALUES (?,?,?)", [v.empresa ?? E1, v.placa, v.chasis ?? null]))[0] as { insertId: number }).insertId);
}
async function solicitud(codigo: string, estado: string, lineas: { vehiculo: number; monto: string; placa: string }[]) {
  const sid = Number(((await getPool().query("INSERT INTO tms_solicitudes_fondo (empresa_id, codigo, fecha_requerimiento, estado, total) VALUES (?,?, '2026-09-10', ?, ?)", [E1, codigo, estado, lineas.reduce((s, l) => s + Number(l.monto), 0)]))[0] as { insertId: number }).insertId);
  for (const l of lineas) await getPool().query("INSERT INTO tms_solicitud_fondo_lineas (empresa_id, solicitud_id, categoria, cantidad, monto, vehiculo_id, placa) VALUES (?,?, 'Combustible', 1, ?, ?, ?)", [E1, sid, l.monto, l.vehiculo, l.placa]);
  return sid;
}
async function fusionar(origen: number, destino: number) {
  const [filaO] = (await getPool().query("SELECT * FROM flota_vehiculos WHERE id IN (?,?) ORDER BY id FOR UPDATE", [Math.min(origen, destino), Math.max(origen, destino)]))[0] as Record<string, unknown>[] & { id: number }[];
  const filas = (await getPool().query("SELECT * FROM flota_vehiculos WHERE id IN (?,?) ORDER BY id", [Math.min(origen, destino), Math.max(origen, destino)]))[0] as { id: number }[];
  void filaO;
  const h = (id: number) => createHash("sha256").update(JSON.stringify(filas.find((f) => f.id === id))).digest("hex");
  return fusionarVehiculos({ empresaId: E1, usuarioId: ADMIN, usuario: "admin", autorizar: async () => {} }, { id: origen, conservarId: destino, motivo: "misma unidad física (prueba)", revision: h(origen), destinoRevision: h(destino) });
}

describe.skipIf(!PUERTO)(`BD real desechable (${ESQUEMA})`, () => {
  let v2 = 0, v3 = 0;
  beforeAll(async () => {
    vi.stubEnv("FLOTA_FUSIONES_APROBADAS", "1");
    await crearEsquema();
    await q("INSERT INTO empresas (id, nombre) VALUES (1,'E1'),(2,'E2')");
    await q("INSERT INTO usuarios (id, activo, rol_global) VALUES (1,1,'Admin')");
    await q("INSERT INTO tms_cotizacion_costeo_perfiles (id, nombre) VALUES (1,'p1'),(2,'p2'),(3,'p3')");
    // Caso motivador: 2 = «558 BSJ» (planes de viaje, unidad TMS), 3 = «558BSJ» (solicitudes de fondos); mismo tipo y chasis real.
    await q("INSERT INTO flota_vehiculos (id, empresa_id, placa, chasis) VALUES (1, 1, 'X-000ZZZ', 'CHASISOTRO0001')");
    v2 = await vehiculo({ placa: "558 BSJ", chasis: "CHASIS558BSJ01" });
    v3 = await vehiculo({ placa: "558BSJ", chasis: "chasis558bsj01" });
    expect([v2, v3]).toEqual([2, 3]);
    await q("INSERT INTO tms_unidades (empresa_id, placa, flota_vehiculo_id) VALUES (1, '558 BSJ', ?)", [v2]);
    await q("INSERT INTO tms_planes_viaje (empresa_id, codigo, estado, fecha_plan, unidad_id, tc_vehiculo_id, vehiculo_solicitado_perfil_id) VALUES (1,'P-1','Cerrado','2026-01-05',1,?,3)", [v2]);
    await solicitud("F-V2", "Autorizada", [{ vehiculo: v2, monto: "100.00", placa: "558 BSJ" }]);
    await solicitud("F-V3-A", "Autorizada", [{ vehiculo: v3, monto: "200.00", placa: "558BSJ" }, { vehiculo: v3, monto: "50.00", placa: "558BSJ" }]);
    await solicitud("F-V3-L", "Liquidada", [{ vehiculo: v3, monto: "75.00", placa: "558BSJ" }]);
  }, 120000);
  afterAll(async () => { vi.unstubAllEnvs(); await (getPool() as unknown as { end(): Promise<void> }).end(); });

  it("referencias(): lista las tablas reales de ID 3 y NO cuenta vehiculo_solicitado_perfil_id (FK a perfiles, ID 3 coincide con un perfil)", async () => {
    const c = await getPool().getConnection();
    try {
      const refs = await referencias(c, E1, v3, false);
      expect(refs.map((r) => r.tabla)).toEqual(["tms_solicitud_fondo_lineas"]);
      const refs2 = await referencias(c, E1, v2, false);
      expect(refs2.map((r) => `${r.tabla}.${r.campo}`).sort()).toEqual(["tms_planes_viaje.tc_vehiculo_id", "tms_solicitud_fondo_lineas.vehiculo_id", "tms_unidades.flota_vehiculo_id"]);
    } finally { c.release(); }
  });

  describe("condiciones de fusión (cada una con su propia pareja de vehículos)", () => {
    it("solicitud de fondo PENDIENTE con el vehículo absorbido: bloquea (se resuelve antes)", async () => {
      const a = await vehiculo({ placa: "PEN 111", chasis: "CHASISPEND0001" }), b = await vehiculo({ placa: "PEN111", chasis: "CHASISPEND0001" });
      await solicitud("F-PEND", "Pendiente", [{ vehiculo: a, monto: "10.00", placa: "PEN 111" }]);
      await expect(fusionar(a, b)).rejects.toThrow(/solicitudes de fondo pendientes/);
      expect(await q("SELECT * FROM flota_vehiculos_fusiones WHERE origen_id=?", [a])).toEqual([]);
    });
    it("ambas con unidad TMS propia: bloquea (identidad TMS ambigua)", async () => {
      const a = await vehiculo({ placa: "TMS 222", chasis: "CHASISTMS00002" }), b = await vehiculo({ placa: "TMS222", chasis: "CHASISTMS00002" });
      await q("INSERT INTO tms_unidades (empresa_id, placa, flota_vehiculo_id) VALUES (1,'TMS 222',?),(1,'TMS222',?)", [a, b]);
      await expect(fusionar(a, b)).rejects.toThrow(/unidad TMS propia/);
    });
    it("referencia operativa no admitida (gastos operativos): sigue bloqueando", async () => {
      const a = await vehiculo({ placa: "GAS 333", chasis: "CHASISGAS00003" }), b = await vehiculo({ placa: "GAS333", chasis: "CHASISGAS00003" });
      await q("INSERT INTO tms_gastos_operativos (empresa_id, fecha_solicitud, vehiculo_id, categoria, monto) VALUES (1,'2026-09-01',?, 'Combustible', 10)", [a]);
      await expect(fusionar(a, b)).rejects.toThrow(/referencias operativas/);
    });
    it("chasis distinto: la placa no demuestra identidad (sin cambios respecto al mecanismo existente)", async () => {
      const a = await vehiculo({ placa: "CHA 444", chasis: "CHASISUNO00004" }), b = await vehiculo({ placa: "CHA444", chasis: "CHASISDOS00004" });
      await expect(fusionar(a, b)).rejects.toThrow(/La placa no demuestra identidad/);
    });
  });

  it("CASO MOTIVADOR: fusiona ID 3 (solicitudes de fondos) en ID 2 (planes de viaje) sin mover ni borrar nada", async () => {
    const antesFondos = await q("SELECT id, vehiculo_id, placa, monto FROM tms_solicitud_fondo_lineas ORDER BY id");
    const antesPlanes = await q("SELECT * FROM tms_planes_viaje");
    const antesVeh = await q("SELECT id, placa FROM flota_vehiculos WHERE id IN (2,3) ORDER BY id");
    const r = await fusionar(v3, v2);
    expect(r).toEqual({ origen: 3, destino: 2, historicosReasignados: 0 });
    expect(await q("SELECT origen_id, destino_id FROM flota_vehiculos_fusiones")).toEqual([{ origen_id: 3, destino_id: 2 }]);
    expect(await q("SELECT id, vehiculo_id, placa, monto FROM tms_solicitud_fondo_lineas ORDER BY id")).toEqual(antesFondos); // historia intacta
    expect(await q("SELECT * FROM tms_planes_viaje")).toEqual(antesPlanes);
    expect(await q("SELECT id, placa FROM flota_vehiculos WHERE id IN (2,3) ORDER BY id")).toEqual(antesVeh); // ni borrado ni renumerado
    expect(await q("SELECT id, activo, estado FROM flota_vehiculos WHERE id IN (2,3) ORDER BY id")).toEqual([{ id: 2, activo: 1, estado: "Activo" }, { id: 3, activo: 0, estado: "Inactivo" }]);
    expect((await q("SELECT accion FROM auditoria WHERE accion='fusion_alias_vehiculo'")).length).toBe(1);
  });

  it("después de fusionar: el absorbido no se repite en la fusión y no se reactiva", async () => {
    await expect(fusionar(v3, v2)).rejects.toThrow(); // ya inactivo / repetida
    await expect(q("UPDATE flota_vehiculos SET activo=1, estado='Activo' WHERE id=3")).rejects.toThrow(/fusionada/);
  });

  it("lectores: IDs históricos de la unidad desde cualquiera de los dos IDs; alias -> canónico", async () => {
    expect(await idsHistoricosVehiculo(E1, v2)).toEqual([2, 3]);
    expect(await idsHistoricosVehiculo(E1, v3)).toEqual([2, 3]);
    expect(await idsHistoricosVehiculo(E1, 1)).toEqual([1]);
    expect(await idsHistoricosVehiculo(E1, 999999)).toEqual([999999]); // inexistente: como antes, reporte vacío
    const c = await getPool().getConnection();
    try {
      expect(await canonizarVehiculoTx(c, E1, v3)).toBe(2);
      expect(await canonizarVehiculoTx(c, E1, v2)).toBe(2);
      expect(await canonizarVehiculoTx(c, E1, 1)).toBe(1);
      expect(await canonizarVehiculoTx(c, 2, v3)).toBe(3); // el alias es de la empresa 1: otra empresa no lo resuelve
      expect(await canonizarVehiculoTx(c, E1, null)).toBeNull();
    } finally { c.release(); }
    const mapa = await canonicosDeAlias([2, 3, 1], E1);
    expect([...mapa.entries()]).toEqual([[3, { id: 2, placa: "558 BSJ" }]]);
  });

  it("reporte de solicitudes de fondo por el vehículo canónico (ID 2) incluye la historia de AMBOS IDs; sin la expansión solo vería la suya", async () => {
    const soloExacto = await reporteSolicitudesFondo(E1, { vehiculoId: v2 });
    expect(soloExacto.map((f) => f.solicitudCodigo)).toEqual(["F-V2"]); // el comportamiento exacto de antes
    for (const id of [v2, v3]) {
      const r = await obtenerReporteGastosPorTipo(E1, "fondos", { vehiculoId: id });
      if (r.tipo !== "fondos") throw new Error("tipo");
      expect(r.filas.map((f) => f.solicitudCodigo).sort()).toEqual(["F-V2", "F-V3-A", "F-V3-A", "F-V3-L"]);
      expect(r.resumen.cantidad).toBe(3);
      expect(r.resumen.totalSolicitado).toBe(100 + 250 + 75);
    }
    const otro = await obtenerReporteGastosPorTipo(E1, "fondos", { vehiculoId: 1 });
    if (otro.tipo !== "fondos") throw new Error("tipo");
    expect(otro.filas).toEqual([]);
  });

  it("operaciones NUEVAS: la base rechaza referencias nuevas al absorbido y acepta el canónico (guarda real de la migración)", async () => {
    const sid = Number(((await getPool().query("INSERT INTO tms_solicitudes_fondo (empresa_id, codigo, fecha_requerimiento, estado, total) VALUES (1,'F-NUEVA','2026-10-01','Pendiente',1)"))[0] as { insertId: number }).insertId);
    await expect(q("INSERT INTO tms_solicitud_fondo_lineas (empresa_id, solicitud_id, categoria, monto, vehiculo_id) VALUES (1,?, 'Combustible', 1, 3)", [sid])).rejects.toThrow(/fusionado/i);
    await expect(q("INSERT INTO tms_solicitud_fondo_lineas (empresa_id, solicitud_id, categoria, monto, vehiculo_id) VALUES (1,?, 'Combustible', 1, ?)", [sid, 2])).resolves.toBeDefined();
  });

  it("LIMITACIÓN CONOCIDA de las guardas de la migración (no corregida aquí): vehiculo_solicitado_perfil_id es un perfil, pero la guarda busca su valor entre los vehículos fusionados", async () => {
    // ID 3 está fusionado y el perfil 3 existe: insertar un plan con ese perfil falla por la guarda `ffi_*`, aunque no sea un vehículo.
    // El inventario de referencias de la aplicación ya lo excluye (prueba 1); el trigger SQL requiere una migración nueva, a decidir por el propietario.
    await expect(q("INSERT INTO tms_planes_viaje (empresa_id, codigo, estado, fecha_plan, vehiculo_solicitado_perfil_id) VALUES (1,'P-2','Cerrado','2026-10-01',3)")).rejects.toThrow();
    await expect(q("INSERT INTO tms_planes_viaje (empresa_id, codigo, estado, fecha_plan, vehiculo_solicitado_perfil_id) VALUES (1,'P-3','Cerrado','2026-10-01',2)")).resolves.toBeDefined();
  });
describe("aislamiento por empresa y recuperación de historia en reportes (fondos y detalle de gastos)", () => {
    let v10 = 0, v11 = 0;
    beforeAll(async () => {
      // Alias previo V10 -> V11 (insertado directamente: emula una fusión ya registrada; la fusión nueva bloquea gastos históricos a propósito).
      v10 = await vehiculo({ placa: "ALI 100", chasis: "CHASISALIAS0100" });
      v11 = await vehiculo({ placa: "ALI100", chasis: "CHASISALIAS0100" });
      const g = async (empresa: number, vehiculo: number, monto: string) =>
        Number(((await getPool().query("INSERT INTO tms_gastos_operativos (empresa_id, fecha_solicitud, vehiculo_id, categoria, monto) VALUES (?, '2026-09-15', ?, 'Combustible', ?)", [empresa, vehiculo, monto]))[0] as { insertId: number }).insertId);
      const gHist = await g(E1, v10, "30.00"); // historia bajo el ID absorbido (cabecera, sin líneas)
      await g(E1, v11, "20.00");               // historia bajo el canónico
      const gLin = await g(E1, v10, "0.00");  // gasto CON líneas (rama B del detalle)
      await getPool().query("INSERT INTO tms_gasto_operativo_lineas (empresa_id, gasto_id, vehiculo_id, placa, categoria, monto) VALUES (?,?,?,?, 'Combustible', 5.00)", [E1, gLin, v10, "ALI 100"]);
      void gHist;
      await q("INSERT INTO flota_vehiculos_fusiones (origen_id, destino_id, empresa_id, administrador_id, motivo, origen_snapshot, destino_snapshot) VALUES (?,?,?,?,?,?,?)", [v10, v11, E1, ADMIN, "alias previo (prueba)", "{}", "{}"]);
      // Empresa 2: tiene acceso COMPARTIDO al canónico V11 y registra sus propios movimientos con ese ID.
      await q("INSERT INTO flota_vehiculo_acceso (vehiculo_id, empresa_id) VALUES (?, 2)", [v11]);
      await g(2, v11, "999.00");
      await solicitud2("F-E2", "Autorizada", v11, "777.00", "ALI100");
    });
    async function solicitud2(codigo: string, estado: string, vehiculo: number, monto: string, placa: string) {
      const sid = Number(((await getPool().query("INSERT INTO tms_solicitudes_fondo (empresa_id, codigo, fecha_requerimiento, estado, total) VALUES (2,?, '2026-09-10', ?, ?)", [codigo, estado, monto]))[0] as { insertId: number }).insertId);
      await getPool().query("INSERT INTO tms_solicitud_fondo_lineas (empresa_id, solicitud_id, categoria, cantidad, monto, vehiculo_id, placa) VALUES (2,?, 'Combustible', 1, ?, ?, ?)", [sid, monto, vehiculo, placa]);
    }

    it("detalle de gastos por el canónico (V11) en la empresa 1: historia de AMBOS IDs (cabecera y líneas), sin movimientos de la empresa 2", async () => {
      const r = await obtenerReporteGastosPorTipo(E1, "gastosDetalle", { vehiculoId: v11 });
      if (r.tipo !== "gastosDetalle") throw new Error("tipo");
      expect(r.filas.map((f) => [f.vehiculoId, f.monto, f.lineaId !== null]).sort()).toEqual([[v10, 30, false], [v10, 5, true], [v11, 20, false]].sort());
      expect(r.filas.some((f) => f.monto === 999)).toBe(false); // el gasto de la empresa 2 con el mismo vehículo compartido
      // y desde el absorbido se recupera lo mismo
      const desdeAbsorbido = await obtenerReporteGastosPorTipo(E1, "gastosDetalle", { vehiculoId: v10 });
      if (desdeAbsorbido.tipo !== "gastosDetalle") throw new Error("tipo");
      expect(desdeAbsorbido.filas.length).toBe(3);
    });

    it("empresa 2 (acceso compartido al canónico): ve SOLO sus movimientos y nunca la historia de la empresa 1 bajo el ID absorbido", async () => {
      // idsHistoricosVehiculo conserva el comportamiento de resolverUnidadCanonica: puede listar IDs de OTRAS empresas del mismo grupo (solo IDs, sin datos).
      // El aislamiento de datos lo garantizan las consultas de los reportes, que SIEMPRE filtran por empresa_id: ningún dato de otra empresa puede salir.
      expect(await idsHistoricosVehiculo(2, v11)).toContain(v11);
      const gastos = await obtenerReporteGastosPorTipo(2, "gastosDetalle", { vehiculoId: v11 });
      if (gastos.tipo !== "gastosDetalle") throw new Error("tipo");
      expect(gastos.filas.map((f) => f.monto)).toEqual([999]);
      const fondos = await obtenerReporteGastosPorTipo(2, "fondos", { vehiculoId: v11 });
      if (fondos.tipo !== "fondos") throw new Error("tipo");
      expect(fondos.filas.map((f) => f.solicitudCodigo)).toEqual(["F-E2"]);
      expect(fondos.resumen.totalSolicitado).toBe(777);
    });

    it("fondos de la empresa 1 por el canónico 558 BSJ no incluyen la solicitud de la empresa 2, y la empresa 2 no ve las de la empresa 1", async () => {
      const e1 = await obtenerReporteGastosPorTipo(E1, "fondos", { vehiculoId: v11 });
      if (e1.tipo !== "fondos") throw new Error("tipo");
      expect(e1.filas.some((f) => f.solicitudCodigo === "F-E2")).toBe(false);
      const e2 = await obtenerReporteGastosPorTipo(2, "fondos", { vehiculoId: v2 });
      if (e2.tipo !== "fondos") throw new Error("tipo");
      expect(e2.filas).toEqual([]); // la empresa 2 no tiene acceso al vehículo 2 de la empresa 1: reporte vacío, sin filtrar historia ajena
    });
  });

  describe("migración v2 de las guardas (propuesta separada): corrige el falso positivo y es reversible", () => {
    let originales: Record<string, unknown>[] = [];
    const insertarPlan = (codigo: string, perfil: number | null, tc: number | null = null) =>
      q("INSERT INTO tms_planes_viaje (empresa_id, codigo, estado, fecha_plan, vehiculo_solicitado_perfil_id, tc_vehiculo_id) VALUES (1,?, 'Cerrado','2026-10-02',?,?)", [codigo, perfil, tc]);

    it("preflight (solo lectura): lista EXACTAMENTE las dos guardas del falso positivo y los prerrequisitos", async () => {
      originales = await accionGuardas();
      const [prerreq, candidatas] = await consultasScript("sql/preflight-2026-11-flota-fusiones-guardas-v2.sql");
      expect(prerreq[0]).toMatchObject({ tabla_fusiones: 1, trigger_principal: 1, respaldo_ya_existe: 0 });
      expect(candidatas.map((f) => [f.tabla, f.campo, f.fk_hacia, String(f.guarda).slice(0, 4)]).sort()).toEqual([
        ["tms_planes_viaje", "vehiculo_solicitado_perfil_id", "tms_cotizacion_costeo_perfiles", "ffi_"],
        ["tms_planes_viaje", "vehiculo_solicitado_perfil_id", "tms_cotizacion_costeo_perfiles", "ffu_"],
      ]);
    });

    it("antes de v2 (estado actual): el perfil 3 se bloquea por la guarda; el postcheck v2 detecta el falso positivo", async () => {
      await expect(insertarPlan("P-V2-0", 3)).rejects.toThrow(/fusionado/i);
      const [falsos] = await consultasScript("sql/postcheck-2026-11-flota-fusiones-guardas-v2.sql", 1); // antes de v2 la tabla de respaldo no existe: solo la consulta 1
      expect(falsos.length).toBe(2);
    });

    it("aplica v2: el perfil de costeo legítimo (ID 3) se permite al insertar y al actualizar", async () => {
      await ejecutarScript("sql/migrate-2026-11-flota-fusiones-guardas-v2.sql");
      await expect(insertarPlan("P-V2-1", 3)).resolves.toBeDefined();
      await expect(q("UPDATE tms_planes_viaje SET vehiculo_solicitado_perfil_id=3 WHERE codigo='P-V2-1'")).resolves.toBeDefined();
      await expect(insertarPlan("P-V2-2", 2)).resolves.toBeDefined();
    });

    it("aplica v2: SIGUEN bloqueadas las referencias nuevas a vehículos absorbidos (fondos, plan por tc_vehiculo_id, gastos y sus líneas)", async () => {
      const sid = Number(((await getPool().query("INSERT INTO tms_solicitudes_fondo (empresa_id, codigo, fecha_requerimiento, estado, total) VALUES (1,'F-V2-B','2026-10-01','Pendiente',1)"))[0] as { insertId: number }).insertId);
      await expect(q("INSERT INTO tms_solicitud_fondo_lineas (empresa_id, solicitud_id, categoria, monto, vehiculo_id) VALUES (1,?, 'Combustible', 1, 3)", [sid])).rejects.toThrow(/fusionado/i);
      await expect(insertarPlan("P-V2-3", null, 3)).rejects.toThrow(/fusionado/i);
      await expect(q("INSERT INTO tms_gastos_operativos (empresa_id, fecha_solicitud, vehiculo_id, categoria, monto) VALUES (1,'2026-10-01',3,'Combustible',1)")).rejects.toThrow(/fusionado/i);
      await expect(q("INSERT INTO tms_gasto_operativo_lineas (empresa_id, gasto_id, vehiculo_id, categoria, monto) VALUES (1,1,3,'Combustible',1)")).rejects.toThrow(/fusionado/i);
      // y el canónico sigue aceptándose
      await expect(q("INSERT INTO tms_solicitud_fondo_lineas (empresa_id, solicitud_id, categoria, monto, vehiculo_id) VALUES (1,?, 'Combustible', 1, 2)", [sid])).resolves.toBeDefined();
      await expect(insertarPlan("P-V2-4", null, 2)).resolves.toBeDefined();
    });

    it("postcheck v2: cero falsos positivos, cero guardas faltantes y respaldo de 2 guardas", async () => {
      const [falsos, faltantes, respaldo] = await consultasScript("sql/postcheck-2026-11-flota-fusiones-guardas-v2.sql");
      expect(falsos).toEqual([]);
      expect(faltantes).toEqual([]);
      expect(respaldo.map((r) => [r.tabla, r.campo, String(r.trigger_nombre).slice(0, 4), r.evento]).sort()).toEqual([
        ["tms_planes_viaje", "vehiculo_solicitado_perfil_id", "ffi_", "INSERT"],
        ["tms_planes_viaje", "vehiculo_solicitado_perfil_id", "ffu_", "UPDATE"],
      ]);
      // Solo se retiraron esas dos guardas: las demás de tms_planes_viaje siguen intactas.
      const restantes = (await accionGuardas()).map((g) => g.TRIGGER_NAME);
      expect(restantes).toEqual(originales.map((g) => g.TRIGGER_NAME).filter((n) => restantes.includes(n)));
      expect(restantes.length).toBe(originales.length - 2);
    });

    it("idempotente: reaplicar v2 no falla ni duplica el respaldo", async () => {
      await ejecutarScript("sql/migrate-2026-11-flota-fusiones-guardas-v2.sql");
      expect((await q("SELECT COUNT(*) AS n FROM flota_fusion_guardas_v2_respaldo"))[0].n).toBe(2);
      await expect(insertarPlan("P-V2-5", 3)).resolves.toBeDefined();
    });

    it("rollback: recrea EXACTAMENTE las guardas originales (misma definición), vuelve el falso positivo y elimina la tabla de respaldo", async () => {
      await ejecutarScript("sql/rollback-2026-11-flota-fusiones-guardas-v2.sql");
      const despues = await accionGuardas();
      expect(despues.map((g) => [g.TRIGGER_NAME, g.EVENT_MANIPULATION, g.ACTION_STATEMENT])).toEqual(originales.map((g) => [g.TRIGGER_NAME, g.EVENT_MANIPULATION, g.ACTION_STATEMENT]));
      await expect(insertarPlan("P-V2-6", 3)).rejects.toThrow(/fusionado/i);
      expect(await q("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_fusion_guardas_v2_respaldo'")).toEqual([]);
    });

    it("tras el rollback v2 se puede volver a aplicar (ciclo completo reversible)", async () => {
      await ejecutarScript("sql/migrate-2026-11-flota-fusiones-guardas-v2.sql");
      await expect(insertarPlan("P-V2-7", 3)).resolves.toBeDefined();
      const [falsos, faltantes] = await consultasScript("sql/postcheck-2026-11-flota-fusiones-guardas-v2.sql");
      expect([falsos.length, faltantes.length]).toEqual([0, 0]);
    });
  });
describe("migración v2: respaldo verificado antes de cada DROP (sin INSERT IGNORE), aborto ante discrepancias e interrupción parcial", () => {
    const MIGRACION = "sql/migrate-2026-11-flota-fusiones-guardas-v2.sql";
    const ROLLBACK = "sql/rollback-2026-11-flota-fusiones-guardas-v2.sql";
    let base: Record<string, unknown>[] = [];
    // Las DOS guardas del falso positivo (tms_planes_viaje.vehiculo_solicitado_perfil_id), con el mismo hash que usa la migración.
    let ffi = "", ffu = "";
    const tablaRespaldo = async () => (await q("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='flota_fusion_guardas_v2_respaldo'")).length > 0;
    /** Deja el esquema en el estado ORIGINAL de las guardas (sin v2): si hay respaldo, el rollback las recrea. */
    async function restablecer() {
      if (await tablaRespaldo()) await ejecutarScript(ROLLBACK);
    }
    /** Solo el CREATE TABLE de la migración (para simular una ejecución previa interrumpida). */
    async function crearRespaldoVacio() {
      const c = await mysql.createConnection({ host: "127.0.0.1", port: Number(PUERTO), user: "root", password: "", database: ESQUEMA });
      try { await c.query(readFileSync(MIGRACION, "utf8").replace(/^\s*--.*$/gm, "").split(/DELIMITER/i)[0]); } finally { await c.end(); }
    }
    const respaldar = (nombre: string) => q("INSERT INTO flota_fusion_guardas_v2_respaldo (tabla, campo, trigger_nombre, momento, evento, accion) SELECT EVENT_OBJECT_TABLE, 'vehiculo_solicitado_perfil_id', TRIGGER_NAME, ACTION_TIMING, EVENT_MANIPULATION, ACTION_STATEMENT FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() AND TRIGGER_NAME=?", [nombre]);
    const insertarPlan = (codigo: string) => q("INSERT INTO tms_planes_viaje (empresa_id, codigo, estado, fecha_plan, vehiculo_solicitado_perfil_id) VALUES (1,?, 'Cerrado','2026-10-03',3)", [codigo]);
    const mismaDefinicion = async () => expect((await accionGuardas()).map((g) => [g.TRIGGER_NAME, g.EVENT_MANIPULATION, g.ACTION_STATEMENT])).toEqual(base.map((g) => [g.TRIGGER_NAME, g.EVENT_MANIPULATION, g.ACTION_STATEMENT]));

    beforeAll(async () => {
      await restablecer();
      base = await accionGuardas();
      const [h] = await q("SELECT LEFT(SHA2('tms_planes_viaje:vehiculo_solicitado_perfil_id',256),32) AS h");
      ffi = `ffi_${h.h}`; ffu = `ffu_${h.h}`;
      expect(base.map((g) => g.TRIGGER_NAME)).toEqual(expect.arrayContaining([ffi, ffu]));
    });

    it("la migración NO usa INSERT IGNORE y verifica expresamente el respaldo antes de cada DROP (estático)", () => {
      const sql = readFileSync(MIGRACION, "utf8").replace(/^\s*--.*$/gm, "");
      expect(sql).not.toMatch(/INSERT\s+IGNORE/i);
      // Cada DROP TRIGGER está dentro de retirar_guarda_v2, precedido de la comprobación y del SIGNAL de aborto.
      const retirar = sql.slice(sql.indexOf("CREATE PROCEDURE retirar_guarda_v2"), sql.indexOf("CREATE PROCEDURE corregir_guardas_fusion_v2"));
      expect(retirar.indexOf("SIGNAL SQLSTATE")).toBeGreaterThan(-1);
      expect(retirar.indexOf("SIGNAL SQLSTATE")).toBeLessThan(retirar.indexOf("DROP TRIGGER"));
      expect((sql.match(/DROP TRIGGER/gi) ?? []).length).toBe(1);
    });

    it("camino normal: respalda 2 guardas idénticas, las retira y el rollback recrea las definiciones originales", async () => {
      await ejecutarScript(MIGRACION);
      const respaldo = await q("SELECT trigger_nombre, tabla, campo, momento, evento, accion FROM flota_fusion_guardas_v2_respaldo ORDER BY trigger_nombre");
      expect(respaldo.length).toBe(2);
      for (const r of respaldo) {
        const original = base.find((g) => g.TRIGGER_NAME === r.trigger_nombre)!;
        expect(r.accion).toBe(original.ACTION_STATEMENT); // definición exacta recuperable
        expect(r.evento).toBe(original.EVENT_MANIPULATION);
      }
      await expect(insertarPlan("P-R-1")).resolves.toBeDefined(); // falso positivo corregido
      await ejecutarScript(ROLLBACK);
      await mismaDefinicion();
      await expect(insertarPlan("P-R-2")).rejects.toThrow(/fusionado/i);
    });

    it("respaldo previo DISTINTO para el mismo trigger: aborta SIN eliminar ese trigger ni sobrescribir el respaldo", async () => {
      await restablecer();
      await crearRespaldoVacio();
      await respaldar(ffi);
      await q("UPDATE flota_fusion_guardas_v2_respaldo SET accion = 'BEGIN SET @distinto = 1; END' WHERE trigger_nombre = ?", [ffi]);
      await expect(ejecutarScript(MIGRACION)).rejects.toThrow(/Respaldo de guarda ausente o distinto/);
      // Ninguna guarda se eliminó (ni la discrepante ni su par ffu) y el respaldo discrepante se conserva tal cual para su revisión.
      await mismaDefinicion();
      await expect(insertarPlan("P-R-3")).rejects.toThrow(/fusionado/i);
      expect(await q("SELECT trigger_nombre, accion FROM flota_fusion_guardas_v2_respaldo")).toEqual([{ trigger_nombre: ffi, accion: "BEGIN SET @distinto = 1; END" }]);
      await q("DROP TABLE flota_fusion_guardas_v2_respaldo"); // limpieza de la simulación; las guardas originales siguen intactas
      await mismaDefinicion();
    });

    it("interrupción parcial A: respaldo hecho de ambas guardas pero ningún DROP -> al reejecutar completa sin duplicar", async () => {
      await restablecer();
      await crearRespaldoVacio();
      for (const n of [ffi, ffu]) await respaldar(n);
      await mismaDefinicion(); // el corte ocurrió antes de eliminar nada
      await ejecutarScript(MIGRACION);
      expect((await q("SELECT COUNT(*) AS n FROM flota_fusion_guardas_v2_respaldo"))[0].n).toBe(2);
      expect((await accionGuardas()).length).toBe(base.length - 2);
      await expect(insertarPlan("P-R-4")).resolves.toBeDefined();
      await ejecutarScript(ROLLBACK);
      await mismaDefinicion();
    });

    it("interrupción parcial B: ffi ya respaldada y eliminada, ffu intacta sin respaldo -> al reejecutar respalda y retira ffu", async () => {
      await restablecer();
      await crearRespaldoVacio();
      await respaldar(ffi);
      await q(`DROP TRIGGER \`${ffi}\``); // el corte ocurrió entre el DROP de ffi y el de ffu
      expect((await accionGuardas()).length).toBe(base.length - 1);
      await ejecutarScript(MIGRACION);
      expect((await q("SELECT COUNT(*) AS n FROM flota_fusion_guardas_v2_respaldo"))[0].n).toBe(2);
      expect((await accionGuardas()).length).toBe(base.length - 2);
      await expect(insertarPlan("P-R-5")).resolves.toBeDefined();
      // y el rollback recrea AMBAS con su definición original (también la que se respaldó antes del corte)
      await ejecutarScript(ROLLBACK);
      await mismaDefinicion();
      expect(await tablaRespaldo()).toBe(false);
    });

    it("interrupción parcial C: ffi eliminada SIN respaldo (no recuperable) -> la migración no inventa nada: ffu sigue respaldada y retirada con su definición exacta", async () => {
      await restablecer();
      await crearRespaldoVacio();
      await q(`DROP TRIGGER \`${ffi}\``); // estado imposible con la migración v2, pero posible por intervención manual
      await ejecutarScript(MIGRACION);
      // Solo ffu tiene respaldo; ffi no se puede recuperar desde v2 y el rollback no la inventa.
      expect((await q("SELECT trigger_nombre FROM flota_fusion_guardas_v2_respaldo")).map((r) => r.trigger_nombre)).toEqual([ffu]);
      await ejecutarScript(ROLLBACK);
      expect((await accionGuardas()).map((g) => [g.TRIGGER_NAME, g.EVENT_MANIPULATION, g.ACTION_STATEMENT]))
        .toEqual(base.filter((g) => g.TRIGGER_NAME !== ffi).map((g) => [g.TRIGGER_NAME, g.EVENT_MANIPULATION, g.ACTION_STATEMENT]));
      // Restablecer el estado original de la guarda ffi manualmente a partir de la definición capturada, para dejar el esquema íntegro.
      const original = base.find((g) => String(g.TRIGGER_NAME) === ffi)!;
      await q(`CREATE TRIGGER \`${ffi}\` BEFORE INSERT ON tms_planes_viaje FOR EACH ROW ${original.ACTION_STATEMENT}`);
      await mismaDefinicion();
    });

    it("la migración sigue siendo idempotente tras todo lo anterior (aplicar dos veces) y el postcheck v2 queda limpio", async () => {
      await restablecer();
      await mismaDefinicion();
      await ejecutarScript(MIGRACION);
      await ejecutarScript(MIGRACION);
      expect((await q("SELECT COUNT(*) AS n FROM flota_fusion_guardas_v2_respaldo"))[0].n).toBe(2);
      const [falsos, faltantes] = await consultasScript("sql/postcheck-2026-11-flota-fusiones-guardas-v2.sql");
      expect([falsos.length, faltantes.length]).toEqual([0, 0]);
      await ejecutarScript(ROLLBACK);
      await mismaDefinicion();
    });
  });
});
