/** MariaDB real solo en instancia PIPE creada por run-windows.mjs; adaptadores de archivos sintéticos. */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock("@/lib/db", () => ({ getPool: () => state.pool, query: async (s: string, p: unknown[]) => (await state.pool!.query(s, p))[0] }));
vi.mock("@/lib/load-env", () => ({ loadRuntimeEnv: () => { throw Error("ENV_PROHIBIDO_EN_LAB"); } }));
vi.mock("@/lib/auth-secret", () => ({ getAuthSecretBytes: () => new TextEncoder().encode("synthetic-only-pr587-disposable-integration-lab") }));
vi.mock("./storage", () => ({ guardar: async () => `synthetic/${randomUUID()}.xlsx`, compensar: async () => {} }));
vi.mock("@/lib/uploads", () => ({ guardarUpload: async () => ({ relative: `synthetic/${randomUUID()}.pdf`, original: "sintetico.pdf", size: 10 }), contentTypeFor: () => "application/pdf" }));
import { preview, confirmarArchivo, type Entrada } from "./service";
import { analizar } from "./model";
import { libro, row } from "./fixture";
import { registrarTerceros, revisarTerceros, listarTerceros, tercerosHabilitados } from "./terceros";
import { guardarCombustibleStaff } from "../combustible-staff";
import { asignacionesExactas } from "@/components/flota/cb2/preview-model";
import type { CatalogosCB2 } from "@/components/flota/cb2/client";

const pipe = process.env.CB2_587_PIPE ?? "";
const ctx = { empresaId: 1, proveedorId: 1, actor: { id: 1, username: "SINTETICO_CAPTURA" }, autorizar: async () => {} };
const revisor = { ...ctx, actor: { id: 2, username: "SINTETICO_REVISION" } };
const otra = { ...ctx, empresaId: 2, proveedorId: 3 };
let admin: mysql.Connection;
let historico: unknown;
const q = async (sql: string, args: unknown[] = []) => (await state.pool!.query<RowDataPacket[]>(sql, args))[0];
const key = () => randomUUID().replaceAll("-", "");
async function preparar(vale: string, nombre?: string, placa?: string) {
  const r = row(vale); if (nombre) r[8] = nombre; if (placa) r[2] = placa;
  const buffer = await libro([r]);
  const candidato = (await analizar(buffer, "HALEL", "GTQ")).find(l => l.clave)!.clave!;
  return { buffer, entrada: { perfil: "HALEL", moneda: "GTQ", seleccion: [{ candidato, vehiculoId: 1 }] } as Entrada };
}
async function cb2(p: Awaited<ReturnType<typeof preparar>>, contexto = ctx) {
  const pvw = await preview(contexto, p.buffer, p.entrada);
  return confirmarArchivo(contexto, p.buffer, "sintetico.xlsx", p.entrada, key(), pvw.token);
}
const staff = (vale: string) => guardarCombustibleStaff(1, { usuarioId: 1, username: "SINTETICO" }, {
  vehiculoId: 1, estacionId: 1, numeroVale: vale, fechaConsumo: "2026-10-01", tipoCombustible: "diesel", galones: "10", monto: "200", km: null, gasolinera: "", observaciones: "",
}, { name: "sintetico.pdf", size: 10, arrayBuffer: async () => new ArrayBuffer(10) });
const total = async (vale: string) => Number((await q(`SELECT
 (SELECT COUNT(*) FROM flota_combustible_cargas WHERE empresa_id=1 AND proveedor_id=1 AND numero_vale=?) +
 (SELECT COUNT(*) FROM flota_cb2_consumos WHERE empresa_id=1 AND proveedor_id=1 AND vale_norm=?) AS n`, [vale, vale]))[0].n);
const alta = (suffix: string, nombre = "Piloto Ficticio Alfa", placa = "060 KHK") => ({ proveedorId: 1, pilotoReferencia: `ficticio-p-${suffix}`, nombre, unidadReferencia: `ficticio-u-${suffix}`, placa, tipo: "MOTOCICLETA", descripcion: "Unidad sintetica", relacion: "CONTRATISTA", evidencia: "expediente-ficticio" });
async function verificar(suffix: string, nombre?: string, placa?: string) {
  const op = alta(suffix, nombre, placa), a = await registrarTerceros(ctx, op);
  await revisarTerceros(revisor, a.id, 0, "VERIFICADA");
  return (await listarTerceros(1)).find(x => x.id === a.id)!;
}
async function esperarEmpresa(n: number) {
  for (let i = 0; i < 100; i++) {
    const actuales = await q("SELECT ID FROM information_schema.PROCESSLIST WHERE DB=DATABASE() AND INFO LIKE 'SELECT id FROM empresas%FOR UPDATE'");
    if (new Set(actuales.map(r => r.ID)).size >= n) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw Error("No se observaron las conexiones concurrentes esperando empresa");
}
async function carreraEmpresa(tasks: (() => Promise<unknown>)[]) {
  const gate = await state.pool!.getConnection(); await gate.beginTransaction();
  await gate.query("SELECT id FROM empresas WHERE id=1 FOR UPDATE");
  const settled = Promise.allSettled(tasks.map(task => task()));
  try { await esperarEmpresa(tasks.length); } finally { await gate.commit(); gate.release(); }
  return settled;
}
async function historial() {
  return Promise.all([
    q("SELECT * FROM flota_combustible_cargas WHERE numero_vale='HIST-STAFF'"),
    q("SELECT * FROM flota_cb2_consumos WHERE vale_norm='HIST-CB2'"),
    ...["empresas", "usuarios", "compras_proveedores", "flota_vehiculos", "flota_vehiculo_acceso", "flota_combustible_conciliaciones", "flota_combustible_conciliacion_filas"].map(t => q(`SELECT * FROM ${t} ORDER BY 1`)),
  ]);
}

describe.skipIf(!pipe)("PR587 MariaDB desechable: migracion y concurrencia reales", () => {
  beforeAll(async () => {
    if (!/^cb2-587-[0-9a-f-]{36}$/.test(pipe)) throw Error("PIPE no autorizado");
    const data = path.resolve(process.env.CB2_587_DATA ?? "");
    if (!data.startsWith(path.resolve(".lab-runtime") + path.sep) || path.basename(data) !== "data") throw Error("Datadir no autorizado");
    admin = await mysql.createConnection({ socketPath: `\\\\.\\pipe\\${pipe}`, user: "root", password: "", multipleStatements: true });
    const [[env]] = await admin.query<RowDataPacket[]>("SELECT VERSION() AS v,@@skip_networking AS net,@@socket AS pipe,@@datadir AS dir,@@foreign_key_checks AS fk,@@check_constraint_checks AS ck");
    expect(env.v).toMatch(/^11\.8\.9-MariaDB/); expect(Number(env.net)).toBe(1); expect(env.pipe).toBe(pipe);
    expect(path.resolve(env.dir).toLowerCase()).toBe(data.toLowerCase()); expect(Number(env.fk)).toBe(1); expect(Number(env.ck)).toBe(1);
    const db = `cb2_587_${key()}`;
    await admin.query(`CREATE DATABASE \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin; USE \`${db}\``);
    await admin.query(readFileSync("scripts/ci/combustibles-pr2-lab/base.sql", "utf8"));
    await admin.query("ALTER TABLE flota_vehiculos ADD placa VARCHAR(40) NOT NULL DEFAULT 'C-001ABC', ADD estado VARCHAR(40) NOT NULL DEFAULT 'Activo', ADD activo TINYINT NOT NULL DEFAULT 1; INSERT INTO usuarios VALUES(2,1); CREATE TABLE empleados(id INT PRIMARY KEY,empresa_id INT NOT NULL,nombre VARCHAR(160),estado VARCHAR(20)) ENGINE=InnoDB");
    await admin.query("ALTER TABLE usuarios ADD rol_global VARCHAR(40) NOT NULL DEFAULT 'Admin'; INSERT INTO usuarios VALUES(3,1,'Admin')");
    // Esquema staff compatible, sin ejecutar los migradores de otros modulos.
    const carga = readFileSync("src/lib/flota/schema.ts", "utf8").match(/CREATE TABLE IF NOT EXISTS flota_combustible_cargas \([\s\S]*?ENGINE=InnoDB DEFAULT CHARSET=utf8mb4/)![0];
    // La tabla base del fixture esta vacia: se completa en lugar de reemplazarla.
    const cols = carga.slice(carga.indexOf("(") + 1, carga.lastIndexOf(")")).split("\n").map(s => s.trim()).filter(s => s && !s.startsWith("id ") && !s.startsWith("empresa_id ")).map(s => s.replace(/,$/, ""));
    await admin.query(`ALTER TABLE flota_combustible_cargas ${cols.map(s => `ADD ${s}`).join(",")}, MODIFY viaje_id INT NULL, MODIFY empleado_id INT NULL, MODIFY piloto_nombre VARCHAR(120) NULL, MODIFY galones DECIMAL(12,3) NOT NULL,
      ADD numero_vale VARCHAR(40), ADD fecha_consumo DATE, ADD precio_por_galon DECIMAL(10,2), ADD proveedor_id INT, ADD estacion_id INT, ADD observaciones TEXT, ADD creado_por_usuario_id INT, ADD solicitud_fondo_linea_id INT`);
    await admin.query("CREATE TABLE flota_combustible_estaciones(id INT PRIMARY KEY,empresa_id INT,proveedor_id INT,nombre VARCHAR(150),activo TINYINT) ENGINE=InnoDB; INSERT INTO flota_combustible_estaciones VALUES(1,1,1,'ESTACION FICTICIA',1)");
    const ddl = readFileSync("sql/migrate-2026-10-combustibles-pr2-consumos-facturas.sql", "utf8").match(/^CREATE TABLE [\s\S]*?COLLATE=utf8mb4_bin;/gm)!;
    expect(ddl).toHaveLength(4); for (const s of ddl) await admin.query(s);
    await admin.query(readFileSync("sql/migrate-2026-10-combustibles-pr514-asignaciones.sql", "utf8").replace(/^\uFEFF/, ""));
    state.pool = mysql.createPool({ socketPath: `\\\\.\\pipe\\${pipe}`, user: "root", password: "", database: db, connectionLimit: 8, dateStrings: true });
    vi.stubEnv("CB2_TERCEROS_D2_APROBADA", "");
    await staff("HIST-STAFF"); await cb2(await preparar("HIST-CB2"));
    historico = await historial();
    await admin.query(readFileSync("sql/migrate-2026-11-cb2-terceros.sql", "utf8"));
    // Solo las dos columnas nuevas son NULL en registros previos; el resto debe ser identico.
    const nuevo = await q("SELECT * FROM flota_cb2_consumos WHERE vale_norm='HIST-CB2'");
    expect(nuevo[0].asociacion_externa_id).toBeNull(); expect(nuevo[0].identidad_externa).toBeNull();
    delete nuevo[0].asociacion_externa_id; delete nuevo[0].identidad_externa;
    expect(nuevo).toEqual((historico as unknown[][])[1]);
    historico = await historial();
  }, 60000);
  afterAll(async () => { vi.unstubAllEnvs(); await state.pool?.end(); await admin?.end(); });

  it("migracion crea tres tablas InnoDB y FK/CHECK activos; conserva historicos", async () => {
    const tables = await q("SELECT TABLE_NAME,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME LIKE 'flota_cb2_externos_%'");
    expect(tables).toHaveLength(3); expect(tables.every(t => t.ENGINE === "InnoDB")).toBe(true);
    expect(await historial()).toEqual(historico);
    await expect(q("UPDATE flota_cb2_consumos SET vehiculo_id=NULL WHERE vale_norm='HIST-CB2'")).rejects.toMatchObject({ errno: 4025 });
    await expect(q("INSERT INTO flota_cb2_externos_unidades(empresa_id,referencia,referencia_hash,placa,tipo,descripcion) VALUES(1,'ficticio',REPEAT('a',64),'FICTICIA','AVION','fixture')")).rejects.toMatchObject({ errno: 4025 });
    await expect(q("INSERT INTO flota_cb2_externos_pilotos(empresa_id,referencia,referencia_hash,nombre) VALUES(999,'ficticio',REPEAT('a',64),'Ficticio')")).rejects.toMatchObject({ errno: 1452 });
  });
  it("D2 deshabilitada por defecto, aun despues de aplicar migracion", async () => {
    vi.stubEnv("CB2_TERCEROS_D2_APROBADA", undefined);
    expect(tercerosHabilitados()).toBe(false); expect(await listarTerceros(1)).toEqual([]);
    await expect(registrarTerceros(ctx, alta("off"))).rejects.toMatchObject({ status: 403 });
  });
  it("Staff primero: CB2 bloquea vale y conserva evidencia sin doble consumo", async () => {
    await staff("STAFF-PRIMERO"); await cb2(await preparar("STAFF-PRIMERO"));
    expect(await total("STAFF-PRIMERO")).toBe(1);
    expect(await q("SELECT id FROM flota_cb2_filas WHERE resultado='BLOQUEADA'")).toHaveLength(1);
  });
  it("CB2 primero: Staff bloquea; D3 rechaza mismo vale con payload distinto", async () => {
    const p = await preparar("CB2-PRIMERO"); await cb2(p);
    await expect(staff("CB2-PRIMERO")).rejects.toMatchObject({ status: 409 });
    const r = row("CB2-PRIMERO"); r[5] = 300;
    const buffer = await libro([r]); const pvw = await preview(ctx, buffer, p.entrada);
    expect(pvw.filas.find(f => f.candidato)?.bloqueada).toBe(true);
    await confirmarArchivo(ctx, buffer, "conflicto.xlsx", p.entrada, key(), pvw.token);
    expect(await total("CB2-PRIMERO")).toBe(1);
  });
  it.each(["STAFF", "CB2"])("dos conexiones reales en espera simultanea; %s inicia primero: solo un consumo", async primero => {
    const vale = `RACE-${primero}`, p = await preparar(vale), pvw = await preview(ctx, p.buffer, p.entrada);
    const gate = await state.pool!.getConnection();
    await gate.beginTransaction(); await gate.query("SELECT id FROM compras_proveedores WHERE empresa_id=1 AND id=1 FOR UPDATE");
    const waits = async (n: number) => {
      for (let i = 0; i < 100; i++) {
        // PROCESSLIST no usa la cache temporal de INNODB_LOCK_WAITS. Cada ID es
        // una conexion distinta ejecutando FOR UPDATE mientras gate retiene la fila.
        const rows = await q("SELECT ID FROM information_schema.PROCESSLIST WHERE DB=DATABASE() AND ID<>CONNECTION_ID() AND INFO LIKE 'SELECT id%FROM compras_proveedores%FOR UPDATE'");
        if (rows.length >= n) { expect(new Set(rows.map(r => r.ID)).size).toBeGreaterThanOrEqual(n); return; }
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      throw Error(`No se observaron ${n} transacciones concurrentes esperando el proveedor`);
    };
    const a = () => staff(vale), b = () => confirmarArchivo(ctx, p.buffer, "concurrente.xlsx", p.entrada, key(), pvw.token);
    const jobs: Promise<unknown>[] = [];
    let results: PromiseSettledResult<unknown>[] = [];
    try {
      jobs.push((primero === "STAFF" ? a : b)()); await waits(1);
      jobs.push((primero === "STAFF" ? b : a)()); await waits(2);
    } finally { await gate.commit(); gate.release(); results = await Promise.allSettled(jobs); }
    for (const r of results) if (r.status === "rejected") expect(r.reason).toMatchObject({ status: 409 });
    expect(results.some(r => r.status === "fulfilled")).toBe(true); expect(await total(vale)).toBe(1);
  }, 20000);
  it("alta, verificacion independiente y dos importaciones: reconocimiento sin recrear identidades", async () => {
    vi.stubEnv("CB2_TERCEROS_D2_APROBADA", "1");
    const a = await registrarTerceros(ctx, alta("auto"));
    await expect(revisarTerceros(ctx, a.id, 0, "VERIFICADA")).rejects.toMatchObject({ status: 403 });
    await revisarTerceros(revisor, a.id, 0, "VERIFICADA");
    expect(await registrarTerceros(ctx, alta("auto"))).toMatchObject({ id: a.id, existente: true });
    for (const vale of ["EXTERNO-1", "EXTERNO-2"]) {
      const p = await preparar(vale, " PILOTO FICTICIO ALFA ", "060-KHK"); p.entrada.seleccion = [];
      const initial = await preview(ctx, p.buffer, p.entrada), f = initial.filas.find(f => f.candidato)!;
      expect(f.asociacionExterna?.id).toBe(a.id);
      const cat: CatalogosCB2 = { tercerosHabilitados: true, terceros: await listarTerceros(1), proveedores: [], vehiculos: [{ id: -f.asociacionExterna!.unidad_id, placa: "060 KHK" }] };
      const automaticas = asignacionesExactas(initial.filas, cat);
      expect(automaticas[f.candidato!]).toBe(String(-f.asociacionExterna!.unidad_id));
      p.entrada.seleccion = [{ candidato: f.candidato!, vehiculoId: Number(automaticas[f.candidato!]), asociacionExternaId: a.id }];
      await cb2(p);
    }
    const consumos = await q("SELECT * FROM flota_cb2_consumos WHERE asociacion_externa_id=?", [a.id]);
    expect(consumos).toHaveLength(2);
    expect(consumos[0]).toMatchObject({ vehiculo_id: null, empleado_id: null, piloto_informado: "PILOTO FICTICIO ALFA", placa_original: "060-KHK" });
    expect(JSON.parse(consumos[0].identidad_externa)).toMatchObject({ tipo: "MOTOCICLETA", relacion: "CONTRATISTA" });
    expect(await q("SELECT id FROM flota_cb2_externos_pilotos")).toHaveLength(1);
    expect(await q("SELECT id FROM empleados")).toHaveLength(0);
  });
  it("FK empresarial, CHECK de verificador y forma de consumo externo se hacen cumplir en motor", async () => {
    const [a] = await q("SELECT * FROM flota_cb2_externos_asociaciones LIMIT 1");
    await expect(q("UPDATE flota_cb2_externos_asociaciones SET verificado_por=creado_por WHERE id=?", [a.id])).rejects.toMatchObject({ errno: 4025 });
    await expect(q("INSERT INTO flota_cb2_externos_asociaciones(empresa_id,piloto_id,unidad_id,relacion,evidencia,estado,creado_por) VALUES(2,?,?,'CONTRATISTA','ficticio','PENDIENTE',1)", [a.piloto_id, a.unidad_id])).rejects.toMatchObject({ errno: 1452 });
    await expect(q("UPDATE flota_cb2_consumos SET empleado_id=1 WHERE asociacion_externa_id=?", [a.id])).rejects.toBeDefined();
    await expect(q("UPDATE flota_cb2_consumos SET identidad_externa='no-json' WHERE asociacion_externa_id=?", [a.id])).rejects.toMatchObject({ errno: 4025 });
    await expect(q("UPDATE flota_cb2_consumos SET asociacion_externa_id=999999 WHERE asociacion_externa_id=?", [a.id])).rejects.toMatchObject({ errno: 1452 });
  });
  it("revocacion posterior al preview impide confirmar y no elimina consumo previo", async () => {
    const a = (await listarTerceros(1))[0], p = await preparar("REVOCADO", a.nombre, a.placa);
    p.entrada.seleccion = [{ candidato: p.entrada.seleccion[0].candidato, vehiculoId: -a.unidad_id, asociacionExternaId: a.id }];
    const pvw = await preview(ctx, p.buffer, p.entrada);
    await revisarTerceros(revisor, a.id, 1, "REVOCADA");
    await expect(confirmarArchivo(ctx, p.buffer, "revocado.xlsx", p.entrada, key(), pvw.token)).rejects.toThrow("revocado");
    expect((await preview(ctx, p.buffer, p.entrada)).filas.find(f => f.candidato)?.asociacionExterna).toBeNull();
    expect(await total("REVOCADO")).toBe(0);
    expect(await q("SELECT id FROM flota_cb2_consumos WHERE asociacion_externa_id=?", [a.id])).toHaveLength(2);
  });
  it("homonimos, cambio de unidad y placa ambigua permanecen sin asociacion automatica", async () => {
    await verificar("homo1", "Piloto Ficticio Beta", "061 KHK");
    await verificar("homo2", "Piloto Ficticio Beta", "062 KHK");
    await verificar("placa1", "Piloto Ficticio Gamma", "063 KHK");
    await verificar("placa2", "Piloto Ficticio Delta", "063 KHK");
    for (const [nombre, placa] of [["Piloto Ficticio Beta", "061 KHK"], ["Piloto Ficticio Gamma", "064 KHK"], ["Piloto Ficticio Gamma", "063 KHK"]]) {
      const p = await preparar(`AMB-${key().slice(0, 8)}`, nombre, placa); p.entrada.seleccion = [];
      const pvw = await preview(ctx, p.buffer, p.entrada);
      expect(pvw.filas.find(f => f.candidato)?.asociacionExterna).toBeNull();
      await cb2(p); expect(await q("SELECT id FROM flota_cb2_consumos WHERE vale_norm=?", [(await analizar(p.buffer, "HALEL", "GTQ"))[0].fila.vale])).toHaveLength(0);
    }
  });
  it("empresa ajena no reconoce ni selecciona el ID; misma referencia se mantiene aislada", async () => {
    const a = await verificar("tenant", "Piloto Ficticio Tenant", "065 KHK"), p = await preparar("TENANT", a.nombre, a.placa);
    p.entrada.seleccion = [];
    expect(await listarTerceros(2)).toEqual([]);
    expect((await preview(otra, p.buffer, p.entrada)).filas.find(f => f.candidato)?.asociacionExterna).toBeNull();
    p.entrada.seleccion = [{ candidato: (await analizar(p.buffer, "HALEL", "GTQ"))[0].clave!, vehiculoId: -a.unidad_id, asociacionExternaId: a.id }];
    await expect(cb2(p, otra)).rejects.toThrow("incompatible");
    const own = await registrarTerceros(otra, { ...alta("tenant", a.nombre, a.placa), proveedorId: 3 });
    expect(own.id).not.toBe(a.id); expect(await listarTerceros(2)).toHaveLength(1);
    await expect(revisarTerceros(otra, a.id, 1, "REVOCADA")).rejects.toMatchObject({ status: 404 });
  });
  it("D2: altas simultaneas desde dos proveedores reutilizan una identidad y asociacion", async () => {
    vi.stubEnv("CB2_TERCEROS_D2_APROBADA", "1");
    const datos = alta("race-alta", "Piloto Ficticio Concurrente", "080 KHK");
    const resultados = await carreraEmpresa([
      () => registrarTerceros(ctx, datos),
      () => registrarTerceros({ ...ctx, proveedorId: 2 }, { ...datos, proveedorId: 2 }),
    ]);
    expect(resultados.every(r => r.status === "fulfilled")).toBe(true);
    const values = resultados.map(r => (r as PromiseFulfilledResult<{ id: number }>).value.id);
    expect(new Set(values).size).toBe(1);
    expect(await q("SELECT id FROM flota_cb2_externos_pilotos WHERE referencia=?", [datos.pilotoReferencia])).toHaveLength(1);
    expect(await q("SELECT id FROM flota_cb2_externos_asociaciones WHERE id=?", [values[0]])).toHaveLength(1);
  });
  it("D2: dos revisores concurrentes de la misma revision no confirman estados contradictorios", async () => {
    const a = await registrarTerceros(ctx, alta("race-revision", "Piloto Ficticio Revision", "081 KHK"));
    const resultados = await carreraEmpresa([
      () => revisarTerceros(revisor, a.id, 0, "VERIFICADA"),
      () => revisarTerceros({ ...ctx, proveedorId: 2, actor: { id: 3, username: "OTRO_ADMIN_FICTICIO" } }, a.id, 0, "REVOCADA"),
    ]);
    expect(resultados.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(resultados.filter(r => r.status === "rejected")).toHaveLength(1);
    expect((await q("SELECT revision FROM flota_cb2_externos_asociaciones WHERE id=?", [a.id]))[0].revision).toBe(1);
  });
  it("D2: revocacion concurrente con confirmar conserva un resultado serializable y bloquea el reconocimiento posterior", async () => {
    const a = await verificar("race-consumo", "Piloto Ficticio Consumo", "082 KHK"), p = await preparar("RACE-EXTERNO", a.nombre, a.placa);
    p.entrada.seleccion = [{ candidato: p.entrada.seleccion[0].candidato, vehiculoId: -a.unidad_id, asociacionExternaId: a.id }];
    const recibo = await preview(ctx, p.buffer, p.entrada);
    const resultados = await carreraEmpresa([
      () => revisarTerceros({ ...revisor, proveedorId: 2 }, a.id, 1, "REVOCADA"),
      () => confirmarArchivo(ctx, p.buffer, "ficticio.xlsx", p.entrada, key(), recibo.token),
    ]);
    expect(resultados[0].status).toBe("fulfilled");
    expect(await total("RACE-EXTERNO")).toBe(resultados[1].status === "fulfilled" ? 1 : 0);
    if (resultados[1].status === "rejected") expect(resultados[1].reason).toMatchObject({ status: 409 });
    const [actual] = await q("SELECT estado,verificado_por FROM flota_cb2_externos_asociaciones WHERE id=?", [a.id]);
    expect(actual).toMatchObject({ estado: "REVOCADA", verificado_por: 2 });
    expect((await preview(ctx, p.buffer, p.entrada)).filas.find(f => f.candidato)?.asociacionExterna).toBeNull();
  });
  it("D2: rol revocado mientras espera empresa cancela aunque el contexto se capturo como administrador", async () => {
    const gate = await state.pool!.getConnection(); await gate.beginTransaction(); await gate.query("SELECT id FROM empresas WHERE id=1 FOR UPDATE");
    const trabajo = registrarTerceros({ ...ctx, actor: { id: 3, username: "ADMIN_FICTICIO" } }, alta("rol-revocado", "Piloto Ficticio Rol", "083 KHK"));
    const resultado = Promise.allSettled([trabajo]);
    try { await esperarEmpresa(1); await q("UPDATE usuarios SET rol_global='Operaciones' WHERE id=3"); }
    finally { await gate.commit(); gate.release(); }
    try {
      const [r] = await resultado; expect(r.status).toBe("rejected");
      if (r.status === "rejected") expect(r.reason).toMatchObject({ status: 403 });
      expect(await q("SELECT id FROM flota_cb2_externos_pilotos WHERE referencia='ficticio-p-rol-revocado'")).toHaveLength(0);
    } finally { await q("UPDATE usuarios SET rol_global='Admin' WHERE id=3"); }
  });
  it("postcheck: historicos intactos y D2 vuelve a su valor predeterminado", async () => {
    expect(await historial()).toEqual(historico);
    vi.stubEnv("CB2_TERCEROS_D2_APROBADA", undefined);
    expect(tercerosHabilitados()).toBe(false); expect(await listarTerceros(1)).toEqual([]);
  });
});
