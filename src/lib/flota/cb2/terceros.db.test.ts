import { seleccionShell } from "@/components/flota/cb2/seleccion-shell";
import { revisionCandidatos } from "@/components/flota/cb2/preview-model";
import type { DecisionAsignacion } from "@/components/flota/cb2/asignacion";
import { reportePilotos } from "./pilotos-reporte";
import { resolverUnidadTms } from "@/lib/tms/unidad-canonica";
import { corregirAsignacion } from "./asignaciones";
import { fusionarVehiculos } from "../vehiculos-fusion";
import { revisarPlacaDuplicada } from "../vehiculos-duplicados";
import { consultarConsumos } from "./consumos-lectura";
import { validarTerceroDirecto } from "./terceros-directos";
import { registrarTerceros } from "./terceros-fixture";
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
vi.mock("@/lib/tenant",()=>({requireTenantFlotaCombustible:async(slug:string)=>slug==='denied'?{error:new Response(null,{status:403})}:{empresa:{id:1},session:{id:1,username:'SINTETICO_CAPTURA',rol:'Admin'}}}));
vi.mock("./storage", () => ({ guardar: async () => `synthetic/${randomUUID()}.xlsx`, compensar: async () => {} }));
vi.mock("@/lib/uploads", () => ({ guardarUpload: async () => ({ relative: `synthetic/${randomUUID()}.pdf`, original: "sintetico.pdf", size: 10 }), contentTypeFor: () => "application/pdf" }));
import { preview, confirmarArchivo, type Entrada } from "./service";
import { cb2Http } from "./http";
import { consultarFondoCB2,vincularFondoCB2 } from "./fondos";
import { ErrorCB2 } from "./model";
import { analizar } from "./model";
import { libro, row,libroShell,filaShell } from "./fixture";
import { validarTercero, revisarTerceros, listarTerceros, tercerosHabilitados, registrarPiloto, registrarUnidad, crearAsociacion, listarCatalogosTerceros, reconocerTercero } from "./terceros";
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
  const buffer = await libro([r],w=>{w.worksheets[0].getCell('F1').value='COSTO TOTAL';});
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
    const actuales = await q("SELECT ID FROM information_schema.PROCESSLIST WHERE DB=DATABASE() AND INFO LIKE 'SELECT id%FROM empresas%FOR UPDATE'");
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
    await admin.query("INSERT INTO empresas VALUES(3,1),(4,1)");
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
    expect(consumos[0]).toMatchObject({ vehiculo_id: null, empleado_id: null, piloto_informado: " PILOTO FICTICIO ALFA ", placa_original: "060-KHK" });
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
  it("D2: altas simultaneas empresariales reutilizan una identidad y asociacion", async () => {
    vi.stubEnv("CB2_TERCEROS_D2_APROBADA", "1");
    const datos = alta("race-alta", "Piloto Ficticio Concurrente", "080 KHK");
    const resultados = await carreraEmpresa([
      () => registrarTerceros(ctx, datos),
      () => registrarTerceros(ctx, datos),
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
      () => revisarTerceros({ ...ctx, actor: { id: 3, username: "OTRO_ADMIN_FICTICIO" } }, a.id, 0, "REVOCADA"),
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
      () => revisarTerceros(revisor, a.id, 1, "REVOCADA"),
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
  it("catálogos independientes funcionan en empresa sin proveedores y no crean relaciones implícitas", async () => {
    const empresa = { empresaId: 3, actor: ctx.actor, autorizar: ctx.autorizar };
    const p = await registrarPiloto(empresa, { referencia: "solo-piloto", nombre: "Piloto Ficticio Independiente" });
    const u = await registrarUnidad(empresa, { referencia: "solo-unidad", placa: "090 KHK", tipo: "MOTOCICLETA", descripcion: "Moto ficticia independiente" });
    const cat = await listarCatalogosTerceros(3);
    expect(cat.pilotos.map(x => x.id)).toEqual([p.id]); expect(cat.unidades.map(x => x.id)).toEqual([u.id]); expect(cat.asociaciones).toEqual([]);
    expect(await q("SELECT id FROM compras_proveedores WHERE empresa_id=3")).toHaveLength(0);
    expect(await registrarPiloto(empresa, { referencia: " SOLO-PILOTO ", nombre: "PILOTO FICTICIO INDEPENDIENTE" })).toMatchObject({ id: p.id, existente: true });
    await expect(crearAsociacion({ ...empresa, empresaId: 2 }, { pilotoId: p.id, unidadId: u.id, relacion: "CONTRATISTA", evidencia: "respaldo ficticio" })).rejects.toMatchObject({ status: 404 });
  });
  it("relaciones muchos a muchos conservan identidades y reconocimiento único por nombre + placa", async () => {
    const empresa = { empresaId: 1, actor: ctx.actor, autorizar: ctx.autorizar };
    const previos = await q("SELECT * FROM flota_cb2_consumos ORDER BY id");
    const p1 = await registrarPiloto(empresa, { referencia: "multi-p1", nombre: "Piloto Ficticio Multiples" });
    const p2 = await registrarPiloto(empresa, { referencia: "multi-p2", nombre: "Piloto Ficticio Alterno" });
    const u1 = await registrarUnidad(empresa, { referencia: "multi-u1", placa: "091 KHK", tipo: "MOTOCICLETA", descripcion: "Moto ficticia" });
    const u2 = await registrarUnidad(empresa, { referencia: "multi-u2", placa: "092 KHK", tipo: "VEHICULO", descripcion: "Vehiculo ficticio" });
    const asociadas: number[] = [];
    for (const [pilotoId, unidadId] of [[p1.id, u1.id], [p1.id, u2.id], [p2.id, u1.id]]) {
      const a = await crearAsociacion(empresa, { pilotoId, unidadId, relacion: "CONTRATISTA", evidencia: "respaldo ficticio" }); asociadas.push(a.id);
      await revisarTerceros(revisor, a.id, 0, "VERIFICADA");
    }
    const cat = await listarCatalogosTerceros(1);
    expect(new Set(asociadas).size).toBe(3);
    expect(reconocerTercero("Piloto Ficticio Multiples", "091 KHK", cat.asociaciones, cat).asociacion?.id).toBe(asociadas[0]);
    expect(reconocerTercero("Piloto Ficticio Multiples", "092 KHK", cat.asociaciones, cat).asociacion?.id).toBe(asociadas[1]);
    expect(reconocerTercero("Piloto Ficticio Alterno", "091 KHK", cat.asociaciones, cat).asociacion?.id).toBe(asociadas[2]);
    const op = { pilotoId: p1.id, unidadId: u1.id, relacion: "CONTRATISTA", evidencia: "respaldo ficticio" };
    const carreras = await carreraEmpresa([() => crearAsociacion(empresa, op), () => crearAsociacion(empresa, op)]);
    expect(carreras.every(x => x.status === "fulfilled" && (x.value as { id: number }).id === asociadas[0])).toBe(true);
    const entrada = await preparar("MULTI-FICTICIO", "Piloto Ficticio Multiples", "091 KHK");
    expect((await preview(ctx, entrada.buffer, entrada.entrada)).filas.find(f => f.candidato)?.asociacionExterna?.id).toBe(asociadas[0]);
    await registrarPiloto(empresa, { confirmarCoincidencias: true, referencia: "multi-homonimo", nombre: "Piloto Ficticio Multiples" });
    expect((await preview(ctx, entrada.buffer, entrada.entrada)).filas.find(f => f.candidato)?.asociacionExterna).toBeNull();
    await registrarUnidad(empresa, { confirmarCoincidencias: true, referencia: "multi-placa-ambigua", placa: "091 KHK", tipo: "VEHICULO", descripcion: "Otra unidad ficticia" });
    const otraEntrada = await preparar("MULTI-AMBIGUO", "Piloto Ficticio Alterno", "091 KHK");
    expect((await preview(ctx, otraEntrada.buffer, otraEntrada.entrada)).filas.find(f => f.candidato)?.asociacionExterna).toBeNull();
    expect(await q("SELECT * FROM flota_cb2_consumos ORDER BY id")).toEqual(previos);
  });
  it("fallo de auditoría revierte el alta independiente completa", async () => {
    await q("CREATE TRIGGER cb2_catalogo_audit_fail BEFORE INSERT ON auditoria FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='fallo sintetico auditoria'");
    try {
      await expect(registrarPiloto({ empresaId: 1, actor: ctx.actor, autorizar: ctx.autorizar }, { referencia: "auditoria-fallida", nombre: "Piloto Ficticio Rollback" })).rejects.toThrow("fallo sintetico");
      expect(await q("SELECT id FROM flota_cb2_externos_pilotos WHERE referencia='auditoria-fallida'")).toHaveLength(0);
    } finally { await q("DROP TRIGGER cb2_catalogo_audit_fail"); }
  });
  it("vale 19955: identidades persistentes independientes, prefijo, D2 y revocacion", async () => {
    vi.stubEnv("CB2_TERCEROS_D2_APROBADA", "1");
    const empresa = { empresaId: 4, actor: ctx.actor, autorizar: ctx.autorizar };
    const p = await registrarPiloto(empresa, { referencia: "lab-19955-p", nombre: "Luis Escobar" });
    const u = await registrarUnidad(empresa, { referencia: "lab-19955-u", placa: "M-060KHK", tipo: "MOTOCICLETA", descripcion: "Sintetica laboratorio" });
    let cat = await listarCatalogosTerceros(4);
    expect(cat.asociaciones).toEqual([]); expect(cat.pilotos.some(x => x.id === p.id)).toBe(true); expect(cat.unidades.some(x => x.id === u.id)).toBe(true);
    await expect(registrarPiloto(empresa, { referencia: "lab-19955-duplicado", nombre: " LUIS  ESCOBAR " })).rejects.toThrow("Nombre coincidente");
    await expect(registrarUnidad(empresa, { referencia: "lab-19955-duplicada", placa: "060 KHK", tipo: "MOTOCICLETA", descripcion: "Sintetica" })).rejects.toThrow("Placa coincidente");
    const a = await crearAsociacion(empresa, { pilotoId: p.id, unidadId: u.id, relacion: "CONTRATISTA", evidencia: "vale 19955 ficticio" });
    await expect(revisarTerceros(empresa, a.id, 0, "VERIFICADA")).rejects.toMatchObject({ status: 403 });
    await revisarTerceros({ ...empresa, actor: revisor.actor }, a.id, 0, "VERIFICADA");
    cat = await listarCatalogosTerceros(4);
    expect(reconocerTercero(" luis  escobar ", "060 KHK", cat.asociaciones, cat).asociacion?.id).toBe(a.id);
    const c = await state.pool!.getConnection();
    try { expect((await validarTercero(c, { ...empresa, proveedorId: 1 }, a.id, u.id, "LUIS  ESCOBAR", "060-KHK")).id).toBe(a.id); } finally { c.release(); }
    expect((await listarCatalogosTerceros(2)).pilotos.some(x => x.id === p.id)).toBe(false);
    await revisarTerceros(empresa, a.id, 1, "REVOCADA"); cat = await listarCatalogosTerceros(4);
    expect(reconocerTercero("Luis Escobar", "060-KHK", cat.asociaciones, cat).asociacion).toBeNull();
    await revisarTerceros({ ...empresa, actor: revisor.actor }, a.id, 2, "VERIFICADA");
    expect((await listarCatalogosTerceros(4)).unidades.find(x => x.id === u.id)?.placa).toBe("M-060KHK");
    vi.stubEnv("CB2_TERCEROS_D2_APROBADA", "");
  });
  it("postcheck: historicos intactos y D2 vuelve a su valor predeterminado", async () => {
    expect(await historial()).toEqual(historico);
    vi.stubEnv("CB2_TERCEROS_D2_APROBADA", undefined);
    expect(tercerosHabilitados()).toBe(false); expect(await listarTerceros(1)).toEqual([]);
  });
  it("política directa: migración compatible y consumo con identidades sin asociación", async () => {
    const antes = await q("SELECT * FROM flota_cb2_consumos ORDER BY id");
    await admin.query(readFileSync("sql/migrate-2026-11-cb2-terceros-directos.sql", "utf8"));
    expect((await q("SELECT * FROM flota_cb2_consumos ORDER BY id")).map(({ piloto_externo_id, unidad_externa_id, ...r }) => { expect(piloto_externo_id).toBeNull(); expect(unidad_externa_id).toBeNull(); return r; })).toEqual(antes);
    vi.stubEnv("CB2_TERCEROS_DIRECTOS_APROBADA", "1");
    await q("INSERT INTO usuarios VALUES(4,1,'Operador')");
    await q("ALTER TABLE usuarios ADD username VARCHAR(80) NOT NULL DEFAULT 'LAB_SINTETICO'");
    const operador = { ...ctx, actor: { id: 4, username: "LAB_OPERADOR" }, escrituraDirecta: true };
    const p = await registrarPiloto(operador, { referencia: "directo-lab-p", nombre: "Luis Escobar" });
    const u = await registrarUnidad(operador, { referencia: "directo-lab-u", placa: "M-060KHK", tipo: "MOTOCICLETA", descripcion: "Laboratorio", confirmarCoincidencias: true });
    const file = await preparar("121646", "Luis Escobar", "M-060KHK");
    file.entrada.seleccion[0] = { ...file.entrada.seleccion[0], vehiculoId: -u.id, pilotoExternoId: p.id, motivoUnidad: "Referencia real revisada en laboratorio" };
    const gate = await state.pool!.getConnection(); await gate.beginTransaction();
    await gate.query("SELECT id FROM compras_proveedores WHERE empresa_id=1 AND id=1 FOR UPDATE");
    const pending = Promise.allSettled([cb2(file, operador), cb2(file, operador)]);
    let esperando = false;
    try { for (let i=0; i<100; i++) { const procesos = await q("SELECT ID FROM information_schema.PROCESSLIST WHERE DB=DATABASE() AND INFO LIKE 'SELECT id,nombre_comercial,activo FROM compras_proveedores%'"); if (procesos.length >= 2) { esperando = true; break; } await new Promise(r => setTimeout(r, 20)); } }
    finally { await gate.commit(); gate.release(); }
    const results = await pending; expect(esperando).toBe(true);
    expect(results.some(r => r.status === "fulfilled"), results.map(r => r.status === "rejected" ? r.reason?.message : "OK").join("; ")).toBe(true); expect(await total("121646")).toBe(1);
    const [consumo] = await q("SELECT * FROM flota_cb2_consumos WHERE vale_norm='121646'");
    expect(consumo).toMatchObject({ piloto_externo_id: p.id, unidad_externa_id: u.id, asociacion_externa_id: null, vehiculo_id: null, empleado_id: null, piloto_informado: "Luis Escobar" });
    const c = await state.pool!.getConnection();
    try {
      expect(await consultarConsumos(c, 1, 100, 0, { pilotoExternoId: p.id, unidadExternaId: u.id })).toHaveLength(1);
      const [legacy] = await q("SELECT id,identidad_externa FROM flota_cb2_consumos WHERE empresa_id=1 AND asociacion_externa_id IS NOT NULL ORDER BY id LIMIT 1");
      const identidad = JSON.parse(String(legacy.identidad_externa));
      expect((await consultarConsumos(c, 1, 100, 0, { pilotoExternoId: identidad.piloto_id, unidadExternaId: identidad.unidad_id })).some(r => r.id === legacy.id)).toBe(true);
      await expect(validarTerceroDirecto(c, { ...otra, autorizar: async () => {} }, p.id, u.id, "Luis Escobar", "M-060KHK")).rejects.toThrow("incompatibles");
      await expect(validarTerceroDirecto(c, { ...operador, autorizar: async () => { throw Error("REVOCADO_LAB"); } }, p.id, u.id, "Luis Escobar", "M-060KHK")).rejects.toThrow("REVOCADO_LAB");
      await expect(validarTerceroDirecto(c, operador, p.id, u.id, "Luis Escobar", "M-060KHK", "Referencia real revisada en laboratorio")).resolves.toMatchObject({ unidad_id: u.id });
      await q("UPDATE flota_cb2_externos_unidades SET tipo='VEHICULO' WHERE empresa_id=1 AND id=?", [u.id]);
      try {
        await expect(validarTerceroDirecto(c, operador, p.id, u.id, "Luis Escobar", "M-060KHK", "Referencia real revisada en laboratorio")).rejects.toThrow("incompatibles");
      } finally { await q("UPDATE flota_cb2_externos_unidades SET tipo='MOTOCICLETA' WHERE empresa_id=1 AND id=?", [u.id]); }
      vi.stubEnv("CB2_TERCEROS_DIRECTOS_APROBADA", "");
      await expect(validarTerceroDirecto(c, operador, p.id, u.id, "Luis Escobar", "M-060KHK")).rejects.toMatchObject({ status: 403 });
    } finally { c.release(); }
  });
  it("fusión: alias preserva referencias y guardas reales impiden nuevas asignaciones al duplicado", async () => {
    await q("ALTER TABLE flota_vehiculos ADD tipo_unidad VARCHAR(40) NOT NULL DEFAULT 'Vehiculo', ADD chasis VARCHAR(40), ADD en_taller INT NOT NULL DEFAULT 0");
    await q("INSERT INTO flota_vehiculos(id,empresa_id,placa,chasis) VALUES(684,1,'C-558BSJ','LABSERIAL000000001'),(1301,1,'C 558 BSJ','LABSERIAL000000001'),(1302,2,'C558BSJ','LABSERIAL000000001')");
    await staff("FUSION-HIST-LAB"); await q("UPDATE flota_combustible_cargas SET vehiculo_id=684 WHERE numero_vale='FUSION-HIST-LAB'");
    const historico = await q("SELECT * FROM flota_combustible_cargas WHERE numero_vale='FUSION-HIST-LAB'");
    await q("CREATE TABLE flota_viajes(id INT PRIMARY KEY,empresa_id INT,vehiculo_id INT,estado VARCHAR(20),hora_llegada DATETIME NULL, FOREIGN KEY(vehiculo_id) REFERENCES flota_vehiculos(id)) ENGINE=InnoDB");
    await q("INSERT INTO flota_viajes VALUES(1,1,684,'cerrado','2020-01-01 12:00:00')");
    const viajeHistorico = await q("SELECT * FROM flota_viajes WHERE id=1");
    await q("CREATE TABLE tms_unidades(id INT AUTO_INCREMENT PRIMARY KEY,empresa_id INT NOT NULL,placa VARCHAR(40),tipo VARCHAR(40),flota_vehiculo_id INT NULL,UNIQUE(empresa_id,placa),FOREIGN KEY(flota_vehiculo_id) REFERENCES flota_vehiculos(id)) ENGINE=InnoDB");
    await q("CREATE TABLE tms_planes_viaje(id INT AUTO_INCREMENT PRIMARY KEY,empresa_id INT NOT NULL,codigo VARCHAR(40),fecha_plan DATE,estado VARCHAR(30),unidad_id INT NULL,tc_vehiculo_id INT NULL,FOREIGN KEY(unidad_id) REFERENCES tms_unidades(id),FOREIGN KEY(tc_vehiculo_id) REFERENCES flota_vehiculos(id)) ENGINE=InnoDB");
    const sql = readFileSync("sql/migrate-2026-11-flota-fusiones.sql", "utf8"); const [head, tail] = sql.split("DELIMITER //");
    await admin.query(head); for (const statement of tail.replace("DELIMITER ;", "").split("//").map(s => s.trim()).filter(Boolean)) await admin.query(statement);
    vi.stubEnv("FLOTA_FUSIONES_APROBADAS", "1");
    const empresa = { empresaId: 1, usuarioId: 1, usuario: "SINTETICO_CAPTURA", autorizar: async () => {} };
    const origen = await revisarPlacaDuplicada(1, 684), destino = await revisarPlacaDuplicada(1, 1301);
    const op = { id: 684, conservarId: 1301, revision: origen.vehiculo.revision, destinoRevision: destino.vehiculo.revision, motivo: "Misma serie real comparada en laboratorio" };
    await expect(fusionarVehiculos({ ...empresa, empresaId: 2 }, op)).rejects.toMatchObject({ status: 403 });
    await expect(fusionarVehiculos({ ...empresa, usuarioId: 4 }, op)).rejects.toMatchObject({ status: 403 });
    await expect(fusionarVehiculos(empresa, { ...op, conservarId: 1302 })).rejects.toMatchObject({ status: 403 });
    await expect(fusionarVehiculos(empresa, { ...op, destinoRevision: "0".repeat(64) })).rejects.toThrow("cambiaron");
    expect(await fusionarVehiculos(empresa, op)).toMatchObject({ origen: 684, destino: 1301, historicosReasignados: 0 });
    expect(await q("SELECT * FROM flota_combustible_cargas WHERE numero_vale='FUSION-HIST-LAB'")).toEqual(historico);
    await expect(q("UPDATE flota_vehiculos SET activo=1 WHERE id=684")).rejects.toThrow("reactivarse");
    await expect(q("INSERT INTO flota_vehiculo_acceso(vehiculo_id,empresa_id) VALUES(684,1)")).rejects.toThrow("fusionado");
    await expect(q("UPDATE flota_combustible_cargas SET vehiculo_id=684 WHERE numero_vale='HIST-STAFF'")).rejects.toThrow("fusionado");
    await q("UPDATE flota_combustible_cargas SET observaciones='Historia conservada' WHERE numero_vale='FUSION-HIST-LAB'");
    expect((await q("SELECT vehiculo_id FROM flota_combustible_cargas WHERE numero_vale='FUSION-HIST-LAB'"))[0].vehiculo_id).toBe(684);
    expect((await q("SELECT * FROM flota_vehiculos_fusiones WHERE origen_id=684"))[0]).toMatchObject({ destino_id: 1301, administrador_id: 1 });
    expect(await q("SELECT * FROM flota_viajes WHERE id=1")).toEqual(viajeHistorico);
    await expect(q("DELETE FROM flota_vehiculos_fusiones WHERE origen_id=684")).rejects.toThrow("eliminarse");
    await expect(q("INSERT INTO flota_vehiculos_fusiones SELECT destino_id,1,empresa_id,administrador_id,motivo,creado_en,origen_snapshot,destino_snapshot FROM flota_vehiculos_fusiones WHERE origen_id=684")).rejects.toThrow("cadena");
    await expect(fusionarVehiculos(empresa, op)).rejects.toThrow();
    vi.stubEnv("FLOTA_FUSIONES_APROBADAS", "");
  });

  it("fusión: chasis contradictorio, reservas abiertas y dos administradores concurrentes", async () => {
    vi.stubEnv("FLOTA_FUSIONES_APROBADAS", "1");
    await q("INSERT INTO flota_vehiculos(id,empresa_id,placa,chasis) VALUES(1470,1,'C559BSJ','LABSERIAL000000002'),(1471,1,'C559BSJ','LABSERIAL000000003')");
    const empresa = { empresaId: 1, usuarioId: 1, usuario: "LAB", autorizar: async () => {} };
    const op = async () => ({ id: 1470, conservarId: 1471, revision: (await revisarPlacaDuplicada(1,1470)).vehiculo.revision, destinoRevision: (await revisarPlacaDuplicada(1,1471)).vehiculo.revision, motivo: "Identidad real revisada por administrador" });
    await expect(fusionarVehiculos(empresa, await op())).rejects.toThrow("chasis");
    await q("UPDATE flota_vehiculos SET chasis='LABSERIAL000000002' WHERE id=1471");
    await q("INSERT INTO flota_viajes VALUES(2,1,1470,'abierto',NULL)");
    await expect(fusionarVehiculos(empresa, await op())).rejects.toThrow("abiertos");
    await q("UPDATE flota_viajes SET estado='cerrado',hora_llegada='2020-01-01 12:00:00' WHERE id=2");
    const operacion = await op();
    const gate = await state.pool!.getConnection(); await gate.beginTransaction(); await gate.query("SELECT id FROM flota_vehiculos WHERE id=1470 FOR UPDATE");
    const pending = Promise.allSettled([fusionarVehiculos(empresa, operacion), fusionarVehiculos({ ...empresa, usuarioId: 2, usuario: "LAB_REVISOR" }, operacion)]);
    let dos = false;
    try { for (let i=0; i<100; i++) { const p = await q("SELECT ID FROM information_schema.PROCESSLIST WHERE DB=DATABASE() AND INFO LIKE 'SELECT * FROM flota_vehiculos WHERE id IN%1470%'"); if (p.length >= 2) { dos = true; break; } await new Promise(r => setTimeout(r, 20)); } }
    finally { await gate.commit(); gate.release(); }
    const result = await pending; expect(dos).toBe(true); expect(result.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(await q("SELECT origen_id FROM flota_vehiculos_fusiones WHERE origen_id=1470")).toHaveLength(1);
    await expect(q("INSERT INTO flota_viajes VALUES(3,1,1470,'abierto',NULL)")).rejects.toThrow("fusionado");
    await expect(q("UPDATE flota_vehiculos SET chasis='OTROSERIAL' WHERE id=1471")).rejects.toThrow("Identidad");
    vi.stubEnv("FLOTA_FUSIONES_APROBADAS", "");
  });

  it("fusión revierte alias y desactivación si falla auditoría; apagada no permite operar", async () => {
    vi.stubEnv("FLOTA_FUSIONES_APROBADAS", "1");
    await q("INSERT INTO flota_vehiculos(id,empresa_id,placa,chasis) VALUES(1480,1,'C560BSJ','LABSERIAL000000004'),(1481,1,'C560BSJ','LABSERIAL000000004')");
    const empresa = { empresaId: 1, usuarioId: 1, usuario: "LAB", autorizar: async () => {} };
    const op = { id: 1480, conservarId: 1481, revision: (await revisarPlacaDuplicada(1,1480)).vehiculo.revision, destinoRevision: (await revisarPlacaDuplicada(1,1481)).vehiculo.revision, motivo: "Revisión sintética de identidad" };
    await q("CREATE TRIGGER lab_fallo_fusion BEFORE INSERT ON auditoria FOR EACH ROW BEGIN IF NEW.accion='fusion_alias_vehiculo' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='FALLO_AUDITORIA_LAB'; END IF; END");
    try { await expect(fusionarVehiculos(empresa,op)).rejects.toThrow("FALLO_AUDITORIA_LAB"); }
    finally { await q("DROP TRIGGER lab_fallo_fusion"); }
    expect(await q("SELECT origen_id FROM flota_vehiculos_fusiones WHERE origen_id=1480")).toEqual([]);
    expect((await q("SELECT activo FROM flota_vehiculos WHERE id=1480"))[0].activo).toBe(1);
    vi.stubEnv("FLOTA_FUSIONES_APROBADAS", "");
    await expect(fusionarVehiculos(empresa,op)).rejects.toMatchObject({ status: 403 });
  });

 it("piloto y unidad independientes: cuatro combinaciones, regresiones, persistencia y concurrencia",async()=>{
  const antes=await q("SELECT * FROM flota_cb2_consumos ORDER BY id");
  await admin.query(readFileSync("sql/migrate-2026-11-cb2-identidades-independientes.sql","utf8"));
  expect(await q("SELECT * FROM flota_cb2_consumos ORDER BY id")).toEqual(antes);
  vi.stubEnv("CB2_TERCEROS_DIRECTOS_APROBADA","1");
  try{
   await q("INSERT INTO empleados(id,empresa_id,nombre,estado) VALUES(701,1,'Interno Independiente','Activo'),(702,2,'Otro Tenant','Activo')");
   const p=await registrarPiloto(ctx,{referencia:"independiente-p",nombre:"Externo Independiente"});
   const u=await registrarUnidad(ctx,{referencia:"independiente-u",placa:"M889LAB",tipo:"MOTOCICLETA",descripcion:"LAB independiente"});
   const propia=(await q("SELECT placa FROM flota_vehiculos WHERE id=1"))[0].placa;
   const casos=[{vale:"121641",externo:false,externa:false},{vale:"121552",externo:true,externa:false},{vale:"121646-INT",externo:false,externa:true},{vale:"121646-EXT",externo:true,externa:true}];
   for(const caso of casos){
    const file=await preparar(caso.vale,"Nombre original conservado",caso.externa?"M889LAB":propia);
    file.entrada.seleccion[0]={candidato:file.entrada.seleccion[0].candidato,vehiculoId:caso.externa?-u.id:1,pilotoTipo:caso.externo?"EXTERNO":"INTERNO",metodoPiloto:"MANUAL",empleadoId:caso.externo?null:701,metodoEmpleado:caso.externo?"SIN_ASIGNACION":"MANUAL",...(caso.externo?{pilotoExternoId:p.id}:{})};
    const http=async(action:'preview'|'confirmar',token?:string)=>{const form=new FormData();form.append('file',new File([new Uint8Array(file.buffer)],'lab.xlsx',{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'}));form.append('seleccion',JSON.stringify(file.entrada.seleccion));form.append('proveedorId','1');form.append('moneda','GTQ');if(token){form.append('token',token);form.append('clave',key());}return cb2Http(new Request('http://localhost/lab',{method:'POST',headers:{Origin:'http://localhost'},body:form}),'e1',action);};
    const pvw=await http('preview');expect(pvw.status,await pvw.clone().text()).toBe(200);const data=await pvw.json();const confirmed=await http('confirmar',data.token);expect(confirmed.status,await confirmed.clone().text()).toBe(200);await cb2(file);
    const [saved]=await q("SELECT * FROM flota_cb2_consumos WHERE vale_norm=?",[caso.vale]);
    expect(await total(caso.vale)).toBe(1);expect(saved).toMatchObject({empleado_id:caso.externo?null:701,piloto_externo_id:caso.externo?p.id:null,vehiculo_id:caso.externa?null:1,unidad_externa_id:caso.externa?u.id:null,asociacion_externa_id:null,piloto_informado:"Nombre original conservado"});
    expect(JSON.parse(saved.identidad_externa)).toMatchObject({politica:"INDEPENDIENTE_V1",piloto:{tipo:caso.externo?"EXTERNO":"INTERNO"},unidad:{tipo:caso.externa?"EXTERNA":"FLOTA"}});
   }
   const [original]=await q("SELECT * FROM flota_cb2_consumos WHERE vale_norm='121646'");
   await corregirAsignacion(ctx,{proveedorId:1,consumoId:original.id,revision:Number(original.revision_asignacion),vehiculoId:1,pilotoTipo:"EXTERNO",metodoPiloto:"MANUAL",pilotoExternoId:p.id,empleadoId:null,productoClasificado:"DIESEL",motivo:"Correccion independiente revisada en laboratorio",clave:key()});
   expect((await q("SELECT id,vehiculo_id,piloto_externo_id,unidad_externa_id FROM flota_cb2_consumos WHERE id=?",[original.id]))[0]).toMatchObject({id:original.id,vehiculo_id:1,piloto_externo_id:p.id,unidad_externa_id:null});
   const file=await preparar("INDEPENDIENTE-CONCURRENTE","Externo Independiente",propia);file.entrada.seleccion[0]={...file.entrada.seleccion[0],pilotoTipo:"EXTERNO",metodoPiloto:"MANUAL",pilotoExternoId:p.id,empleadoId:null,metodoEmpleado:"SIN_ASIGNACION"};
   const results=await Promise.allSettled([cb2(file),cb2(file)]);expect(results.some(r=>r.status==="fulfilled")).toBe(true);expect(await total("INDEPENDIENTE-CONCURRENTE")).toBe(1);
   const ajeno=await preparar("INDEPENDIENTE-AJENO","Otro Tenant",propia);ajeno.entrada.seleccion[0]={...ajeno.entrada.seleccion[0],pilotoTipo:"INTERNO",metodoPiloto:"MANUAL",empleadoId:702,metodoEmpleado:"MANUAL"};
   await expect(cb2(ajeno)).rejects.toMatchObject({status:403});expect(await total("INDEPENDIENTE-AJENO")).toBe(0);
   // Empleados de baja (identidades independientes): mismo reconocimiento que los activos (≥2 palabras completas, único), de la misma empresa y con trazabilidad.
   await q("INSERT INTO empleados(id,empresa_id,nombre,estado) VALUES(704,1,'Baja Independiente Uno','Baja'),(705,2,'Baja Otro Tenant','Baja')");
   const bajaManual=await preparar("INDEPENDIENTE-BAJA-MANUAL","Baja Independiente Uno",propia);bajaManual.entrada.seleccion[0]={...bajaManual.entrada.seleccion[0],pilotoTipo:"INTERNO",metodoPiloto:"MANUAL",empleadoId:704,metodoEmpleado:"MANUAL"};
   await cb2(bajaManual);expect(await total("INDEPENDIENTE-BAJA-MANUAL")).toBe(1);
   const [guardadaBaja]=await q("SELECT * FROM flota_cb2_consumos WHERE vale_norm='INDEPENDIENTE-BAJA-MANUAL'");
   expect(guardadaBaja).toMatchObject({empleado_id:704});expect(JSON.parse(guardadaBaja.identidad_externa)).toMatchObject({politica:"INDEPENDIENTE_V1",piloto:{tipo:"INTERNO",id:704,estadoEmpleado:"Baja"}});
   const bajaAuto=await preparar("INDEPENDIENTE-BAJA-AUTO","Baja Independiente",propia);bajaAuto.entrada.seleccion[0]={...bajaAuto.entrada.seleccion[0],pilotoTipo:"INTERNO",metodoPiloto:"AUTOMATICA",empleadoId:704,metodoEmpleado:"TOKENS_COMPLETOS_UNICOS"};
   await cb2(bajaAuto);expect(await total("INDEPENDIENTE-BAJA-AUTO")).toBe(1);   // dos palabras completas, único, estado Baja: reconocimiento automático
   expect((await q("SELECT empleado_id FROM flota_cb2_consumos WHERE vale_norm='INDEPENDIENTE-BAJA-AUTO'"))[0].empleado_id).toBe(704);
   const bajaAjena=await preparar("INDEPENDIENTE-BAJA-AJENA","Baja Otro Tenant",propia);bajaAjena.entrada.seleccion[0]={...bajaAjena.entrada.seleccion[0],pilotoTipo:"INTERNO",metodoPiloto:"AUTOMATICA",empleadoId:705,metodoEmpleado:"TOKENS_COMPLETOS_UNICOS"};
   await expect(cb2(bajaAjena)).rejects.toThrow();expect(await total("INDEPENDIENTE-BAJA-AJENA")).toBe(0);   // otra empresa: no existe en el catálogo autorizado
   await q("INSERT INTO empleados(id,empresa_id,nombre,estado) VALUES(706,1,'Baja Independiente Dos','Activo')");   // ahora «Baja Independiente» es ambiguo
   const bajaAmbigua=await preparar("INDEPENDIENTE-BAJA-AMBIGUA","Baja Independiente",propia);bajaAmbigua.entrada.seleccion[0]={...bajaAmbigua.entrada.seleccion[0],pilotoTipo:"INTERNO",metodoPiloto:"AUTOMATICA",empleadoId:704,metodoEmpleado:"TOKENS_COMPLETOS_UNICOS"};
   await expect(cb2(bajaAmbigua)).rejects.toThrow();expect(await total("INDEPENDIENTE-BAJA-AMBIGUA")).toBe(0);
   expect((await q("SELECT estado FROM empleados WHERE id=704"))[0].estado).toBe("Baja");   // RR. HH. no se modifica
   await q("INSERT INTO empleados(id,empresa_id,nombre,estado) VALUES(703,1,'Externo Independiente','Activo')");
   const ambiguo=await preparar("INDEPENDIENTE-AMBIGUO","Externo Independiente",propia);ambiguo.entrada.seleccion[0]={...ambiguo.entrada.seleccion[0],pilotoTipo:'EXTERNO',metodoPiloto:'AUTOMATICA',pilotoExternoId:p.id,empleadoId:null,metodoEmpleado:'SIN_ASIGNACION'};
   await expect(cb2(ambiguo)).rejects.toThrow('ambigua');expect(await total('INDEPENDIENTE-AMBIGUO')).toBe(0);
   ambiguo.entrada.seleccion[0].metodoPiloto='MANUAL';await cb2(ambiguo);expect(await total('INDEPENDIENTE-AMBIGUO')).toBe(1);
   await expect(q("UPDATE flota_cb2_consumos SET empleado_id=701 WHERE vale_norm='121646-EXT'")).rejects.toThrow();
   const apagado=await preparar("INDEPENDIENTE-APAGADO","Externo Independiente",propia);apagado.entrada.seleccion[0]={...apagado.entrada.seleccion[0],pilotoTipo:"EXTERNO",metodoPiloto:"MANUAL",pilotoExternoId:p.id,empleadoId:null,metodoEmpleado:"SIN_ASIGNACION"};
   vi.stubEnv("CB2_TERCEROS_DIRECTOS_APROBADA","");await expect(cb2(apagado)).rejects.toMatchObject({status:403});expect(await total("INDEPENDIENTE-APAGADO")).toBe(0);
  }finally{vi.stubEnv("CB2_TERCEROS_DIRECTOS_APROBADA","");}
 });

 it("Shell HTTP sin empleado ni fondos, repetidos legitimos, reimportacion y errores",async()=>{
  const employees=await q("SELECT * FROM empleados ORDER BY id"),history=await q("SELECT * FROM flota_cb2_consumos ORDER BY id");
  vi.stubEnv("CB2_TERCEROS_DIRECTOS_APROBADA","1");
  const propia=String((await q("SELECT placa FROM flota_vehiculos WHERE id=1"))[0].placa);
  const buffer=await libroShell([filaShell("SHELL-OPC-001","Mensajero sin catalogo",propia),filaShell("SHELL-OPC-002","Mensajero sin catalogo",propia),filaShell("SHELL-SIN-NOMBRE","",propia,"Regular")]);
  const lineas=(await analizar(buffer,"SHELL","GTQ")).filter(l=>l.clave);
  const entrada:Entrada={perfil:"SHELL",moneda:"GTQ",seleccion:lineas.map(l=>({candidato:l.clave!,vehiculoId:1,empleadoId:null,metodoEmpleado:"SIN_ASIGNACION"}))};
  async function http(action:"preview"|"confirmar",token?:string,slug="e1",archivo=buffer,selection=entrada.seleccion){
   const form=new FormData();form.append("file",new File([new Uint8Array(archivo)],"Shell.xlsx",{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));form.append("seleccion",JSON.stringify(selection));form.append("proveedorId","1");form.append("moneda","GTQ");if(token){form.append("token",token);form.append("clave",key());}
   return cb2Http(new Request("http://localhost/lab",{method:"POST",headers:{Origin:"http://localhost"},body:form}),slug,action);
  }
  try{
   const p=await http("preview");expect(p.status,await p.clone().text()).toBe(200);const receipt=await p.json();
   const result=await http("confirmar",receipt.token);expect(result.status,await result.clone().text()).toBe(200);
   const saved=await q("SELECT * FROM flota_cb2_consumos WHERE vale_norm LIKE 'SHELL-%' ORDER BY id");expect(saved).toHaveLength(3);
   expect(saved[0]).toMatchObject({empleado_id:null,piloto_externo_id:null,piloto_informado:"Mensajero sin catalogo",producto:"vPower",producto_clasificado:"VPOWER_NO_DETERMINADO",factura_id:null,galones:"10.000000",monto:"200.000000",precio:"20.000000"});
   const p2=await http("preview");const second=await http("confirmar",(await p2.json()).token);expect(second.status,await second.clone().text()).toBe(200);
   expect(await q("SELECT id FROM flota_cb2_consumos WHERE vale_norm LIKE 'SHELL-%'")).toHaveLength(3);
   const evidence=await q("SELECT datos_origen FROM flota_cb2_filas WHERE consumo_id=? AND tipo='ORIGEN'",[saved[0].id]);
   expect(JSON.parse(String(evidence[0].datos_origen)).textos).toMatchObject({piloto:"Mensajero sin catalogo",producto:"vPower",auxiliar:"Sucursal sintetica / observacion"});
   const sinPermiso=await http("confirmar",receipt.token,"denied");expect(sinPermiso.status).toBe(403);
   const badBuffer=await libroShell([filaShell("SHELL-AJENO","Mensajero",propia)]);const badLinea=(await analizar(badBuffer,"SHELL","GTQ")).find(l=>l.clave)!;const badSel=[{candidato:badLinea.clave!,vehiculoId:1,empleadoId:702,metodoEmpleado:"MANUAL" as const}];const badP=await http("preview",undefined,"e1",badBuffer,badSel);expect(badP.status).toBe(200);const ajeno=await http("confirmar",(await badP.json()).token,"e1",badBuffer,badSel);expect(ajeno.status).toBe(403);
   const ambiguo=await libroShell([filaShell("SHELL-CONFLICTO","Mensajero",propia),[...filaShell("SHELL-CONFLICTO","Mensajero",propia)].map((v,i)=>i===4?201:v)]);
   expect((await analizar(ambiguo,"SHELL","GTQ")).filter(l=>l.clave).every(l=>l.bloqueada)).toBe(true);
   const oil=await libroShell([filaShell("SHELL-ACEITE","Mensajero",propia,"20W50")]);const oilLines=(await analizar(oil,"SHELL","GTQ")).filter(l=>l.clave);const oilEntry:Entrada={perfil:"SHELL",moneda:"GTQ",seleccion:[{candidato:oilLines[0].clave!,vehiculoId:1,empleadoId:null,metodoEmpleado:"SIN_ASIGNACION"}]};
   await expect(cb2({buffer:oil,entrada:oilEntry})).rejects.toMatchObject({status:400});expect(await total("SHELL-ACEITE")).toBe(0);
   expect(await q("SELECT * FROM empleados ORDER BY id")).toEqual(employees);
   expect(await q(`SELECT * FROM flota_cb2_consumos WHERE id IN (${history.map(()=>"?").join(",")}) ORDER BY id`,history.map(r=>r.id))).toEqual(history);
  }finally{vi.stubEnv("CB2_TERCEROS_DIRECTOS_APROBADA","");}
 });
 it("piloto reportado en unidad externa: migracion aditiva, tenant, guardas y concurrencia",async()=>{
  vi.stubEnv("CB2_TERCEROS_D2_APROBADA","1");vi.stubEnv("CB2_TERCEROS_DIRECTOS_APROBADA","1");
  try{
   const u=await registrarUnidad(ctx,{referencia:"shell-reportada",placa:"M777LAB",tipo:"MOTOCICLETA",descripcion:"Sintetica"});
   const buffer=await libroShell([filaShell("SHELL-EXTERNA","Persona sin relacion laboral","M777LAB","Diesel")]);const l=(await analizar(buffer,"SHELL","GTQ")).find(l=>l.clave)!;
   const file={buffer,entrada:{perfil:"SHELL",moneda:"GTQ",seleccion:[{candidato:l.clave!,vehiculoId:-u.id,pilotoTipo:"REPORTADO",empleadoId:null,metodoEmpleado:"SIN_ASIGNACION"}]} as Entrada};
   await expect(cb2(file)).rejects.toMatchObject({status:503});
  await admin.query(`CREATE TABLE tms_solicitudes_fondo(id INT PRIMARY KEY,empresa_id INT NOT NULL,codigo VARCHAR(40),estado VARCHAR(30),fecha_requerimiento DATE,UNIQUE(empresa_id,id)) ENGINE=InnoDB;
   CREATE TABLE tms_solicitud_fondo_lineas(id INT PRIMARY KEY,empresa_id INT NOT NULL,solicitud_id INT NOT NULL,categoria VARCHAR(40),vehiculo_id INT NULL,cantidad DECIMAL(10,2),monto DECIMAL(12,2),empleado_nombre VARCHAR(200),placa VARCHAR(40),UNIQUE KEY uq_fondolin_c2a_empresa_id(empresa_id,id),KEY idx_fondolin_solicitud(empresa_id,solicitud_id)) ENGINE=InnoDB;
   ALTER TABLE flota_combustible_cargas ADD KEY idx_fcc_fondo_linea(empresa_id,solicitud_fondo_linea_id), ADD CONSTRAINT fk_fcc_fondo_linea FOREIGN KEY(empresa_id,solicitud_fondo_linea_id) REFERENCES tms_solicitud_fondo_lineas(empresa_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT;
   INSERT INTO tms_solicitudes_fondo VALUES(901,1,'LAB-901','Autorizada','2026-09-30'),(902,2,'LAB-902','Autorizada','2026-09-30'),(903,1,'LAB-903','Pendiente','2026-09-30');
   INSERT INTO tms_solicitud_fondo_lineas VALUES(901,1,901,'Combustible',1,1,250,'Otra persona','C-001ABC'),(902,2,902,'Combustible',NULL,1,250,'Otro tenant','C-001ABC'),(903,1,903,'Combustible',1,1,250,'Otra persona','C-001ABC');`);

   const [preflight]=await admin.query(readFileSync("sql/preflight-2026-11-cb2-shell-opcional.sql","utf8"));for(const n of [0,1,2,4,5,7,8])expect((preflight as unknown as unknown[][])[n]).toEqual([]);
   const triggersAntes=await q("SELECT TRIGGER_NAME,ACTION_ORDER,ACTION_STATEMENT,DEFINER,SQL_MODE,CHARACTER_SET_CLIENT,COLLATION_CONNECTION,DATABASE_COLLATION FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() ORDER BY TRIGGER_NAME");
   const history=await q("SELECT * FROM flota_cb2_consumos ORDER BY id");await admin.query(readFileSync("sql/migrate-2026-11-cb2-piloto-reportado.sql","utf8"));expect(await q("SELECT TRIGGER_NAME,ACTION_ORDER,ACTION_STATEMENT,DEFINER,SQL_MODE,CHARACTER_SET_CLIENT,COLLATION_CONNECTION,DATABASE_COLLATION FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA=DATABASE() ORDER BY TRIGGER_NAME")).toEqual(triggersAntes);expect(await q("SELECT * FROM flota_cb2_consumos ORDER BY id")).toEqual(history);
   const results=await Promise.allSettled([cb2(file),cb2(file)]);expect(results.filter(r=>r.status==="fulfilled")).toHaveLength(2);expect(await total("SHELL-EXTERNA")).toBe(1);
   const [r]=await q("SELECT * FROM flota_cb2_consumos WHERE vale_norm='SHELL-EXTERNA'");expect(r).toMatchObject({vehiculo_id:null,unidad_externa_id:u.id,empleado_id:null,piloto_externo_id:null,asociacion_externa_id:null,piloto_informado:"Persona sin relacion laboral"});expect(JSON.parse(String(r.identidad_externa))).toMatchObject({politica:"REPORTADO_V1",piloto:{tipo:"REPORTADO",id:null}});
   await expect(q("UPDATE flota_cb2_consumos SET empleado_id=701 WHERE id=?",[r.id])).rejects.toThrow();
   await expect(q("UPDATE flota_cb2_consumos SET identidad_externa=JSON_SET(identidad_externa,'$.unidad.id',999999) WHERE id=?",[r.id])).rejects.toThrow();
   // Unidad externa REUTILIZADA en otra importación Shell con un empleado de BAJA (INTERNO manual): misma identidad externa, sin crear vehículos de Flota ni modificar RR. HH.
   await q("INSERT INTO empleados(id,empresa_id,nombre,estado) VALUES(7701,1,'Baja Externa Prueba','Baja'),(7702,2,'Baja Otro Tenant Ext','Baja')");
   const vehiculosAntes=await q("SELECT COUNT(*) n FROM flota_vehiculos");
   const bufferBaja=await libroShell([filaShell("SHELL-EXTERNA-BAJA","Baja Externa Prueba","M777LAB","Diesel")]);const lineaBaja=(await analizar(bufferBaja,"SHELL","GTQ")).find(l=>l.clave)!;
   const archivoBaja={buffer:bufferBaja,entrada:{perfil:"SHELL",moneda:"GTQ",seleccion:[{candidato:lineaBaja.clave!,vehiculoId:-u.id,pilotoTipo:"INTERNO",metodoPiloto:"MANUAL",empleadoId:7701,metodoEmpleado:"MANUAL"}]} as Entrada};
   await cb2(archivoBaja);
   const [rb]=await q("SELECT * FROM flota_cb2_consumos WHERE vale_norm='SHELL-EXTERNA-BAJA'");expect(rb).toMatchObject({vehiculo_id:null,unidad_externa_id:u.id,empleado_id:7701});expect(JSON.parse(String(rb.identidad_externa))).toMatchObject({piloto:{tipo:"INTERNO",id:7701,estadoEmpleado:"Baja"},unidad:{tipo:"EXTERNA",id:u.id}});
   expect(await q("SELECT COUNT(*) n FROM flota_vehiculos")).toEqual(vehiculosAntes);expect((await q("SELECT estado FROM empleados WHERE id=7701"))[0].estado).toBe("Baja");
   // otra empresa: ni su empleado ni una unidad ajena se aceptan aunque el ID exista
   const bufferAjena=await libroShell([filaShell("SHELL-EXTERNA-BAJA-AJENA","Baja Otro Tenant Ext","M777LAB","Diesel")]);const lineaAjena=(await analizar(bufferAjena,"SHELL","GTQ")).find(l=>l.clave)!;
   await expect(cb2({buffer:bufferAjena,entrada:{...archivoBaja.entrada,seleccion:[{...archivoBaja.entrada.seleccion[0],candidato:lineaAjena.clave!,empleadoId:7702}]}})).rejects.toMatchObject({status:403});
   expect(await total("SHELL-EXTERNA-BAJA-AJENA")).toBe(0);
   const otroBuffer=await libroShell([filaShell("SHELL-EXTERNA-AJENA","Persona sin relacion laboral","M777LAB","Diesel")]);const otraLinea=(await analizar(otroBuffer,"SHELL","GTQ")).find(l=>l.clave)!;
   const ajeno={buffer:otroBuffer,entrada:{...file.entrada,seleccion:[{...file.entrada.seleccion[0],candidato:otraLinea.clave!,vehiculoId:-999999}]}};await expect(cb2(ajeno)).rejects.toThrow();
   vi.stubEnv("CB2_TERCEROS_DIRECTOS_APROBADA","");await expect(cb2({...ajeno,entrada:{...ajeno.entrada,seleccion:[{...ajeno.entrada.seleccion[0],vehiculoId:-u.id}]}})).rejects.toMatchObject({status:403});
  }finally{vi.stubEnv("CB2_TERCEROS_DIRECTOS_APROBADA","");}
 });
 it("fondos posteriores: sin efecto en consumos, diferencias manuales, permisos e idempotencia",async()=>{
  const [r]=await q("SELECT * FROM flota_cb2_consumos WHERE vale_norm='SHELL-OPC-001'");
  await expect(consultarFondoCB2(1,1,r.id,"")).rejects.toMatchObject({status:503});
  const tablasHistoricas=["flota_cb2_consumos","flota_combustible_cargas","tms_solicitudes_fondo","tms_solicitud_fondo_lineas"];
  const historicos=await Promise.all(tablasHistoricas.map(t=>q(`SELECT * FROM ${t} ORDER BY id`)));
  const indicesAntes=await q("SELECT INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,SUB_PART,INDEX_TYPE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tms_solicitud_fondo_lineas' ORDER BY INDEX_NAME,SEQ_IN_INDEX");
  const tablaAntes=await q("SHOW CREATE TABLE tms_solicitud_fondo_lineas");
  const ddl=readFileSync("sql/migrate-2026-11-cb2-fondos-vinculos.sql","utf8");
  // Una única DDL CREATE TABLE; nunca añadir índices sobre tablas históricas.
  expect(ddl.replace(/^--.*$/gm,"").match(/\bCREATE TABLE\b/g)).toHaveLength(1);
  expect(ddl.replace(/^--.*$/gm,"")).not.toMatch(/\bALTER\s+TABLE\b/i);
  await admin.query(ddl);
  expect(await q("SHOW CREATE TABLE tms_solicitud_fondo_lineas")).toEqual(tablaAntes);
  expect(await q("SELECT INDEX_NAME,NON_UNIQUE,SEQ_IN_INDEX,COLUMN_NAME,SUB_PART,INDEX_TYPE FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='tms_solicitud_fondo_lineas' ORDER BY INDEX_NAME,SEQ_IN_INDEX")).toEqual(indicesAntes);
  const fks=await q("SELECT CONSTRAINT_NAME,UNIQUE_CONSTRAINT_NAME,REFERENCED_TABLE_NAME,UPDATE_RULE,DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_fondos_vinculos' ORDER BY CONSTRAINT_NAME");
  expect(fks).toEqual([
   {CONSTRAINT_NAME:"fk_cb2fv_actor",UNIQUE_CONSTRAINT_NAME:"PRIMARY",REFERENCED_TABLE_NAME:"usuarios",UPDATE_RULE:"RESTRICT",DELETE_RULE:"RESTRICT"},
   {CONSTRAINT_NAME:"fk_cb2fv_consumo",UNIQUE_CONSTRAINT_NAME:"uq_cb2c_ambito",REFERENCED_TABLE_NAME:"flota_cb2_consumos",UPDATE_RULE:"RESTRICT",DELETE_RULE:"RESTRICT"},
   {CONSTRAINT_NAME:"fk_cb2fv_linea",UNIQUE_CONSTRAINT_NAME:"uq_fondolin_c2a_empresa_id",REFERENCED_TABLE_NAME:"tms_solicitud_fondo_lineas",UPDATE_RULE:"RESTRICT",DELETE_RULE:"RESTRICT"}
  ]);
  expect((await q("SELECT UNIQUE_CONSTRAINT_NAME FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='flota_combustible_cargas' AND CONSTRAINT_NAME='fk_fcc_fondo_linea'"))[0].UNIQUE_CONSTRAINT_NAME).toBe("uq_fondolin_c2a_empresa_id");
  expect((await q("SELECT CONSTRAINT_NAME FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='flota_cb2_fondos_vinculos' ORDER BY CONSTRAINT_NAME")).map(r=>r.CONSTRAINT_NAME)).toEqual(["ck_cb2fv_revision","ck_cb2fv_snapshot"]);
  const insertar=(consumo:number,linea:number,actor:number,snapshot:string,revision:number)=>q("INSERT INTO flota_cb2_fondos_vinculos(empresa_id,proveedor_id,consumo_id,linea_id,revision_asignacion,snapshot,motivo,creado_por,creado_en) VALUES(1,1,?,?,?,?, 'Prueba sintetica de guardas',?,NOW(6))",[consumo,linea,revision,snapshot,actor]);
  await expect(insertar(999999,901,1,"{}",0)).rejects.toMatchObject({errno:1452});
  await expect(insertar(r.id,902,1,"{}",0)).rejects.toMatchObject({errno:1452});
  await expect(insertar(r.id,901,999999,"{}",0)).rejects.toMatchObject({errno:1452});
  await expect(insertar(r.id,901,1,"{",0)).rejects.toMatchObject({errno:4025});
  await expect(insertar(r.id,901,1,"{}",-1)).rejects.toMatchObject({errno:4025});
  expect(await Promise.all(tablasHistoricas.map(t=>q(`SELECT * FROM ${t} ORDER BY id`)))).toEqual(historicos);

  const [postcheck]=await admin.query(readFileSync("sql/postcheck-2026-11-cb2-shell-opcional.sql","utf8"));expect((postcheck as unknown as Record<string,unknown>[][])[3][0].vinculos_manuales).toBe(0);expect((postcheck as unknown as unknown[][])[4]).toEqual([]);
  expect((await consultarFondoCB2(1,1,r.id,"")).estado).toBe("SIN_CONCILIAR");
  const op={proveedorId:1,consumoId:Number(r.id),lineaId:901,revision:Number(r.revision_asignacion),motivo:"Revisados los comprobantes y las diferencias",confirmado:true as const};
  await expect(vincularFondoCB2(ctx,{...op,lineaId:902})).rejects.toThrow();await expect(vincularFondoCB2(ctx,{...op,lineaId:903})).rejects.toThrow();
  await expect(vincularFondoCB2({...ctx,autorizar:async()=>{throw new ErrorCB2("Sin permiso",403);}},op)).rejects.toMatchObject({status:403});
  const all=await Promise.all([vincularFondoCB2(ctx,op),vincularFondoCB2(ctx,op)]);expect(all.filter(v=>!v.repetida)).toHaveLength(1);expect(all[0].snapshot.contraste).toEqual({diferencias:["MONTO","FECHA","PERSONA"],diferenciaMonto:"-50"});
  expect(await q("SELECT consumo_id FROM flota_cb2_fondos_vinculos")).toHaveLength(1);expect((await q("SELECT * FROM flota_cb2_consumos WHERE id=?",[r.id]))[0]).toEqual(r);
  await expect(vincularFondoCB2(ctx,{...op,motivo:"Intento de sobrescribir otra revision"})).rejects.toThrow("sobrescribe");
  expect((await consultarFondoCB2(1,1,r.id,"")).estado).toBe("VINCULADO_MANUAL");await expect(consultarFondoCB2(2,1,r.id,"")).rejects.toMatchObject({status:404});
  const post=await cb2Http(new Request("http://localhost/lab",{method:"POST",headers:{Origin:"http://localhost"},body:JSON.stringify(op)}),"e1","vincular-fondo");expect(post.status,await post.clone().text()).toBe(200);
  expect(await Promise.all(tablasHistoricas.map(t=>q(`SELECT * FROM ${t} ORDER BY id`)))).toEqual(historicos);
  const noConfirmado=await cb2Http(new Request("http://localhost/lab",{method:"POST",headers:{Origin:"http://localhost"},body:JSON.stringify({...op,confirmado:false})}),"e1","vincular-fondo");expect(noConfirmado.status).toBe(400);
 });
 it("pilotos reportados: confirmación explícita, equivalencias empresariales y concurrencia, concurrencia e historial",async()=>{
  expect((await reportePilotos(1,{})).instalado).toBe(false);
  const antiguos=await q("SELECT * FROM flota_cb2_consumos ORDER BY id");
  const [pre]=await admin.query(readFileSync("sql/preflight-2026-11-cb2-pilotos-reportados.sql","utf8"));expect((pre as unknown as unknown[][])[2]).toEqual([]);expect((pre as unknown as unknown[][])[3]).toEqual([]);
  await admin.query(readFileSync("sql/migrate-2026-11-cb2-pilotos-reportados.sql","utf8"));
  const [post]=await admin.query(readFileSync("sql/postcheck-2026-11-cb2-pilotos-reportados.sql","utf8"));expect((post as unknown as unknown[][])[5]).toEqual([]);expect((post as unknown as unknown[][])[6]).toEqual([]);
  expect(await q("SELECT * FROM flota_cb2_consumos ORDER BY id")).toEqual(antiguos);
  expect(await q("SELECT * FROM flota_cb2_pilotos_reportados")).toEqual([]);
  await q("INSERT INTO flota_vehiculos(id,empresa_id,placa) VALUES(3330,1,'C333LAB'),(3331,2,'C334LAB')");
  const propia=String((await q("SELECT placa FROM flota_vehiculos WHERE id=1"))[0].placa);
  async function shell(vale:string,nombre:string,placa:string,vehiculo:number){const buffer=await libroShell([filaShell(vale,nombre,placa,"Diesel")]);const l=(await analizar(buffer,"SHELL","GTQ")).find(l=>l.clave)!;return {buffer,entrada:{perfil:"SHELL",moneda:"GTQ",seleccion:[{candidato:l.clave!,vehiculoId:vehiculo,empleadoId:null,metodoEmpleado:"SIN_ASIGNACION",...(nombre?{decisionNombre:{tipo:"REPORTADO",confirmado:true}}:{})}]} as Entrada};}
  const a=await shell("NOMBRE-REPORTE-A","  Álvaro   Pérez ",propia,1),b=await shell("NOMBRE-REPORTE-B","ÁLVARO PÉREZ","C333LAB",3330);
  const previa=await preview(ctx,a.buffer,a.entrada);expect(previa.nombres).toHaveLength(1);expect(previa.nombres[0].propuesta).toBeNull();expect(await q("SELECT * FROM flota_cb2_pilotos_reportados")).toEqual([]);expect(await q("SELECT * FROM flota_cb2_pilotos_equivalencias")).toEqual([]);
  const sinDecision={...a,entrada:{...a.entrada,seleccion:a.entrada.seleccion.map(s=>{const copia={...s};delete copia.decisionNombre;return copia;})}};
  await expect(cb2(sinDecision)).rejects.toThrow("nombres distintos");
  const noConfirmado={...a,entrada:{...a.entrada,seleccion:a.entrada.seleccion.map(s=>({...s,decisionNombre:{tipo:"REPORTADO" as const,confirmado:false}}))}};
  await expect(cb2(noConfirmado)).rejects.toThrow("requiere confirmación");
  expect(await q("SELECT * FROM flota_cb2_pilotos_reportados")).toEqual([]);
  await Promise.all([cb2(a),cb2(b,{...ctx,proveedorId:2})]);
  const nombres=await q("SELECT * FROM flota_cb2_pilotos_reportados WHERE empresa_id=1");expect(nombres).toHaveLength(1);expect(nombres[0]).toMatchObject({nombre_normalizado:"ÁLVARO PÉREZ",estado:"REPORTADO_CONFIRMADO"});
  const enlaces=await q("SELECT * FROM flota_cb2_consumo_piloto_reportado WHERE empresa_id=1");expect(enlaces).toHaveLength(2);expect(new Set(enlaces.map(r=>r.piloto_reportado_id)).size).toBe(1);
  const reconocido=await shell("NOMBRE-REPORTE-C","Álvaro Pérez",propia,1);const sugerencias=await preview(ctx,reconocido.buffer,reconocido.entrada);expect(sugerencias.nombres[0].propuesta).toMatchObject({tipo:"REPORTADO",reportadoId:nombres[0].id,confirmado:false});
  await cb2(a);expect(await q("SELECT * FROM flota_cb2_consumo_piloto_reportado WHERE empresa_id=1")).toHaveLength(2);
  const reporte=await reportePilotos(1,{pilotoReportadoId:Number(nombres[0].id)});expect(reporte.items).toHaveLength(2);expect(reporte.totales).toEqual([expect.objectContaining({consumos:2,galones:"20.000000",importe:"400.000000",moneda:"GTQ"})]);expect(new Set(reporte.items.map(r=>r.piloto_informado))).toEqual(new Set(["  Álvaro   Pérez ","ÁLVARO PÉREZ"]));
  expect(reporte.items.every(r=>r.empleado_id===null&&r.piloto_externo_id===null)).toBe(true);
  const pag=await reportePilotos(1,{pilotoReportadoId:Number(nombres[0].id)},0,1);expect(pag.items).toHaveLength(1);expect(pag.siguiente).not.toBeNull();expect((await reportePilotos(1,{pilotoReportadoId:Number(nombres[0].id)},pag.siguiente!,1)).items[0].id).not.toBe(pag.items[0].id);
  expect((await reportePilotos(1,{nombre:"  Álvaro   Pérez "})).items).toHaveLength(1);
  await cb2(await shell("NOMBRE-OTRA-EMPRESA","ÁLVARO PÉREZ","C334LAB",3331),otra);const [ajeno]=await q("SELECT id FROM flota_cb2_pilotos_reportados WHERE empresa_id=2");expect(ajeno.id).not.toBe(nombres[0].id);await expect(reportePilotos(1,{pilotoReportadoId:ajeno.id})).rejects.toMatchObject({status:404});
  await cb2(await shell("NOMBRE-AUSENTE","",propia,1));expect(await q("SELECT * FROM flota_cb2_pilotos_reportados WHERE empresa_id=1")).toHaveLength(1);
  const historicos=await reportePilotos(1,{nombre:"DEMO"});expect(historicos.items.length).toBeGreaterThan(0);expect(historicos.items.every(r=>r.piloto_reportado_id===null)).toBe(true);
  expect(await q(`SELECT * FROM flota_cb2_consumos WHERE id IN (${antiguos.map(()=>"?").join(",")}) ORDER BY id`,antiguos.map(r=>r.id))).toEqual(antiguos);
  // Piloto desconocido registrado desde el vale: doble envío / reintentos concurrentes no duplican la identidad y se reconoce en una reimportación posterior.
  const dc1=await shell("DOBLE-CLIC-A","Piloto Doble Clic",propia,1),dc2=await shell("DOBLE-CLIC-B","Piloto Doble Clic",propia,1);
  await Promise.allSettled([cb2(dc1),cb2(dc2),cb2(dc1)]);
  const dobles=await q("SELECT * FROM flota_cb2_pilotos_reportados WHERE empresa_id=1 AND nombre_normalizado='PILOTO DOBLE CLIC'");expect(dobles).toHaveLength(1);
  expect(dobles[0]).toMatchObject({nombre_muestra:"Piloto Doble Clic",estado:"REPORTADO_CONFIRMADO"});expect(Number(dobles[0].creado_por)).toBeGreaterThan(0);   // nombre original, normalizado y quién lo confirmó
  expect(await q("SELECT * FROM flota_cb2_pilotos_reportados WHERE empresa_id=2 AND nombre_normalizado='PILOTO DOBLE CLIC'")).toHaveLength(0);   // ámbito por empresa
  const dc3=await shell("DOBLE-CLIC-C","Piloto Doble Clic",propia,1);
  expect((await preview(ctx,dc3.buffer,dc3.entrada)).nombres[0].propuesta).toMatchObject({tipo:"REPORTADO",reportadoId:dobles[0].id,confirmado:false});   // reconocido sin pedir confirmación
  await cb2({...dc3,entrada:{...dc3.entrada,seleccion:dc3.entrada.seleccion.map(sel=>({...sel,decisionNombre:{tipo:"REPORTADO" as const,reportadoId:Number(dobles[0].id),confirmado:false}}))}});
  expect(await q("SELECT * FROM flota_cb2_pilotos_reportados WHERE empresa_id=1 AND nombre_normalizado='PILOTO DOBLE CLIC'")).toHaveLength(1);
  expect(await q("SELECT piloto_reportado_id FROM flota_cb2_consumo_piloto_reportado WHERE empresa_id=1 AND piloto_reportado_id=?",[dobles[0].id])).toHaveLength(3);
  // Las variantes de empleado se confirman una vez y se reutilizan sin crear reportados.
  await q("INSERT INTO empleados(id,empresa_id,nombre,estado) VALUES(4441,1,'Luis Escobar Sintético','Activo'),(4442,2,'Luis Escobar Sintético','Activo')");
  const variante=await shell("VARIANTE-EMPLEADO","Luis Escobr Sintético",propia,1);
  const revisionNombre=(await preview(ctx,variante.buffer,variante.entrada)).nombres[0];expect(revisionNombre.propuesta).toEqual({tipo:"EMPLEADO",empleadoId:4441,confirmado:false});   expect(revisionNombre.candidatos.some(p=>p.id===4441)).toBe(true);expect(revisionNombre.candidatos.some(p=>p.id===4442)).toBe(false);   // «Luis» y «Sintético» son dos palabras completas coincidentes
  const comoEmpleado=(id:number)=>({...variante,entrada:{...variante.entrada,seleccion:variante.entrada.seleccion.map(s=>({...s,empleadoId:id,metodoEmpleado:"MANUAL" as const,decisionNombre:{tipo:"EMPLEADO" as const,empleadoId:id,confirmado:true}}))}});
  await expect(cb2(comoEmpleado(4442))).rejects.toMatchObject({status:403});await cb2(comoEmpleado(4441));
  expect((await q("SELECT empleado_id,piloto_informado FROM flota_cb2_consumos WHERE numero_vale='VARIANTE-EMPLEADO'"))[0]).toMatchObject({empleado_id:4441,piloto_informado:"Luis Escobr Sintético"});
  expect((await preview(ctx,variante.buffer,variante.entrada)).nombres[0].propuesta).toEqual({tipo:"EMPLEADO",empleadoId:4441,confirmado:false});
  expect(await q("SELECT * FROM flota_cb2_pilotos_reportados WHERE empresa_id=1")).toHaveLength(2);   // «Álvaro Pérez» + «Piloto Doble Clic»: los empleados reconocidos no crean reportados
  // Empleado de BAJA reconocido automáticamente en Shell (sin selección manual, sin crear piloto reportado, RR. HH. intacto).
  await q("INSERT INTO empleados(id,empresa_id,nombre,estado) VALUES(4450,1,'Norberto Taracena Sintético Mayén','Baja'),(4451,2,'Norberto Taracena Sintético Mayén','Baja')");
  const baja=await shell("BAJA-SHELL-AUTO","Norberto Taracena",propia,1);
  const revBaja=(await preview(ctx,baja.buffer,baja.entrada)).nombres[0];expect(revBaja.propuesta).toEqual({tipo:"EMPLEADO",empleadoId:4450,confirmado:false});
  const autoBaja={...baja,entrada:{...baja.entrada,seleccion:baja.entrada.seleccion.map(s=>({...s,empleadoId:4450,metodoEmpleado:"MANUAL" as const,decisionNombre:{tipo:"EMPLEADO" as const,empleadoId:4450,confirmado:false}}))}};
  await cb2(autoBaja);
  expect((await q("SELECT empleado_id FROM flota_cb2_consumos WHERE numero_vale='BAJA-SHELL-AUTO'"))[0].empleado_id).toBe(4450);
  expect(await q("SELECT * FROM flota_cb2_pilotos_reportados WHERE empresa_id=1")).toHaveLength(2);
  expect((await q("SELECT estado FROM empleados WHERE id=4450"))[0].estado).toBe("Baja");
  // Decisión no confirmada hacia otro empleado distinto de la propuesta (u otra empresa) se rechaza.
  const otraPersona=await shell("BAJA-SHELL-AJENA","Norberto Taracena",propia,1);
  await expect(cb2({...otraPersona,entrada:{...otraPersona.entrada,seleccion:otraPersona.entrada.seleccion.map(s=>({...s,empleadoId:4451,metodoEmpleado:"MANUAL" as const,decisionNombre:{tipo:"EMPLEADO" as const,empleadoId:4451,confirmado:false}}))}})).rejects.toThrow();
  expect(await q("SELECT * FROM flota_cb2_consumos WHERE numero_vale='BAJA-SHELL-AJENA'")).toHaveLength(0);
  // Equivalencia histórica en conflicto con el reconocimiento actual: nunca se aplica el ID antiguo sin revisión explícita.
  await q("INSERT INTO empleados(id,empresa_id,nombre,estado) VALUES(4460,1,'Otro Sintetico Alias','Activo')");
  const base=await shell("ALIAS-BASE","Conflicto Alias",propia,1);
  const aEmpleado=(f:typeof base,id:number,confirmado:boolean)=>({...f,entrada:{...f.entrada,seleccion:f.entrada.seleccion.map(sel=>({...sel,empleadoId:id,metodoEmpleado:"MANUAL" as const,decisionNombre:{tipo:"EMPLEADO" as const,empleadoId:id,confirmado}}))}});
  await cb2(aEmpleado(base,4460,true));   // equivalencia explícita «Conflicto Alias» → #4460
  await q("INSERT INTO empleados(id,empresa_id,nombre,estado) VALUES(4461,1,'Conflicto Alias Sintético','Baja')");   // hoy el motor identifica de forma única al #4461
  const conflicto=await shell("ALIAS-CONFLICTO","Conflicto Alias",propia,1);
  const revConflicto=(await preview(ctx,conflicto.buffer,conflicto.entrada)).nombres[0];
  expect(revConflicto.propuesta).toBeNull();expect(revConflicto.conflictoEquivalencia).toEqual({equivalenciaId:4460,reconocidoId:4461});expect(revConflicto.elegibles).toEqual([4461]);
  await expect(cb2(aEmpleado(conflicto,4460,false))).rejects.toThrow("requiere confirmación");   // el ID antiguo sin confirmar se rechaza
  await expect(cb2(aEmpleado(conflicto,4461,false))).rejects.toThrow("requiere confirmación");   // tampoco el reconocido sin revisión explícita
  expect(await q("SELECT * FROM flota_cb2_consumos WHERE numero_vale='ALIAS-CONFLICTO'")).toHaveLength(0);
  await cb2(aEmpleado(conflicto,4461,true));   // confirmación explícita
  expect((await q("SELECT empleado_id FROM flota_cb2_consumos WHERE numero_vale='ALIAS-CONFLICTO'"))[0].empleado_id).toBe(4461);
  // Alias hacia un empleado con un nombre de UNA palabra en común: nunca autopropuesta; el servidor exige confirmación explícita.
  await q("INSERT INTO empleados(id,empresa_id,nombre,estado) VALUES(4462,1,'Zeta Sintetico Persona','Baja')");
  const aliasUno=await shell("ALIAS-UNA-BASE","Zeta Omega",propia,1);await cb2(aEmpleado(aliasUno,4462,true));   // equivalencia explícita «Zeta Omega» → #4462
  const unaPalabra=await shell("ALIAS-UNA-PALABRA","Zeta Omega",propia,1);
  const revUna=(await preview(ctx,unaPalabra.buffer,unaPalabra.entrada)).nombres[0];expect(revUna.propuesta).toBeNull();expect(revUna.equivalencia).toMatchObject({tipo:"EMPLEADO",empleadoId:4462});expect(revUna.elegibles).toEqual([]);
  await expect(cb2(aEmpleado(unaPalabra,4462,false))).rejects.toThrow("requiere confirmación");
  expect(await q("SELECT * FROM flota_cb2_consumos WHERE numero_vale='ALIAS-UNA-PALABRA'")).toHaveLength(0);
  await cb2(aEmpleado(unaPalabra,4462,true));expect((await q("SELECT empleado_id FROM flota_cb2_consumos WHERE numero_vale='ALIAS-UNA-PALABRA'"))[0].empleado_id).toBe(4462);
  await q("INSERT INTO empleados(id,empresa_id,nombre,estado) VALUES(4443,1,'Luis Escobar Sintético','Activo')");
  expect((await preview(ctx,variante.buffer,variante.entrada)).nombres[0].propuesta).toBeNull();
  const homonimo=await shell("VARIANTE-HOMONIMO","Luis Escobr Sintético",propia,1);homonimo.entrada.seleccion[0]={...homonimo.entrada.seleccion[0],empleadoId:4443,metodoEmpleado:"MANUAL",decisionNombre:{tipo:"EMPLEADO",empleadoId:4443,confirmado:true}};
  await cb2(homonimo);expect((await preview(ctx,variante.buffer,variante.entrada)).nombres[0].propuesta).toBeNull();expect((await q("SELECT empleado_id FROM flota_cb2_consumos WHERE numero_vale='VARIANTE-EMPLEADO'"))[0].empleado_id).toBe(4441);expect((await q("SELECT empleado_id FROM flota_cb2_consumos WHERE numero_vale='VARIANTE-HOMONIMO'"))[0].empleado_id).toBe(4443);
  // Una corrección cambia la equivalencia vigente, nunca los consumos anteriores.
  const nombreCorreccion="Correccion Sintetica Unica";
  await cb2(await shell("CORRECCION-REPORTADO",nombreCorreccion,propia,1));
  const antesCorreccion=await q("SELECT * FROM flota_cb2_consumos ORDER BY id");
  const enlacesAntes=await q("SELECT * FROM flota_cb2_consumo_piloto_reportado ORDER BY consumo_id");
  const corregido=await shell("CORRECCION-EMPLEADO",nombreCorreccion,propia,1);
  corregido.entrada.seleccion[0]={...corregido.entrada.seleccion[0],empleadoId:4441,metodoEmpleado:"MANUAL",decisionNombre:{tipo:"EMPLEADO",empleadoId:4441,confirmado:true}};
  await cb2(corregido);
  {const r=(await preview(ctx,corregido.buffer,corregido.entrada)).nombres[0];expect(r.propuesta).toBeNull();expect(r.equivalencia).toMatchObject({tipo:"EMPLEADO",empleadoId:4441});expect(r.elegibles).toEqual([]);}   // el motor no reconoce a nadie (sin dos palabras): el alias es solo referencia y no autopropone
  const [equivalenciaCorregida]=await q("SELECT * FROM flota_cb2_pilotos_equivalencias WHERE nombre_normalizado='CORRECCION SINTETICA UNICA'");
  expect(equivalenciaCorregida).toMatchObject({empleado_id:4441,piloto_reportado_id:null,requiere_revision:0,confirmado_por:1});
  const auditorias=await q("SELECT detalle FROM auditoria WHERE accion='cb2_confirmar_equivalencia_piloto' AND JSON_VALUE(detalle,'$.nombreNormalizado')='CORRECCION SINTETICA UNICA' ORDER BY id");
  expect(auditorias).toHaveLength(2);
  expect(JSON.parse(auditorias[1].detalle)).toMatchObject({anterior:{empleado_id:null,piloto_reportado_id:expect.any(Number)},nuevo:{empleado_id:4441,piloto_reportado_id:null}});
  expect(await q(`SELECT * FROM flota_cb2_consumos WHERE id IN (${antesCorreccion.map(()=>"?").join(",")}) ORDER BY id`,antesCorreccion.map(r=>r.id))).toEqual(antesCorreccion);
  expect(await q("SELECT * FROM flota_cb2_consumo_piloto_reportado ORDER BY consumo_id")).toEqual(enlacesAntes);
  // Si falla auditoría, también se revierten la equivalencia y el nuevo consumo.
  const fallido=await shell("CORRECCION-ROLLBACK",nombreCorreccion,propia,1);
  fallido.entrada.seleccion[0]={...fallido.entrada.seleccion[0],empleadoId:4443,metodoEmpleado:"MANUAL",decisionNombre:{tipo:"EMPLEADO",empleadoId:4443,confirmado:true}};
  await q("CREATE TRIGGER lab_falla_equivalencia BEFORE INSERT ON auditoria FOR EACH ROW BEGIN IF NEW.accion='cb2_confirmar_equivalencia_piloto' THEN SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='AUDITORIA_EQ_FALLIDA'; END IF; END");
  try{await expect(cb2(fallido)).rejects.toThrow('AUDITORIA_EQ_FALLIDA');}finally{await q("DROP TRIGGER lab_falla_equivalencia");}
  expect((await q("SELECT * FROM flota_cb2_pilotos_equivalencias WHERE nombre_normalizado='CORRECCION SINTETICA UNICA'"))[0]).toEqual(equivalenciaCorregida);
  expect(await q("SELECT id FROM flota_cb2_consumos WHERE numero_vale='CORRECCION-ROLLBACK'")).toEqual([]);
  await cb2(fallido);
  {const r=(await preview(ctx,fallido.buffer,fallido.entrada)).nombres[0];expect(r.propuesta).toBeNull();expect(r.equivalencia).toMatchObject({tipo:"EMPLEADO",empleadoId:4443});}
  const reutilizado=await shell("CORRECCION-REUSO",nombreCorreccion,propia,1);
  reutilizado.entrada.seleccion[0]={...reutilizado.entrada.seleccion[0],empleadoId:4443,metodoEmpleado:"MANUAL",decisionNombre:{tipo:"EMPLEADO",empleadoId:4443,confirmado:false}};
  await expect(cb2(reutilizado)).rejects.toThrow("requiere confirmación");   // un alias sin reconocimiento del motor no se acepta sin confirmar
  reutilizado.entrada.seleccion[0]={...reutilizado.entrada.seleccion[0],decisionNombre:{tipo:"EMPLEADO",empleadoId:4443,confirmado:true}};
  await cb2(reutilizado);
  expect((await q("SELECT empleado_id FROM flota_cb2_consumos WHERE numero_vale='CORRECCION-REUSO'"))[0].empleado_id).toBe(4443);
  // Dos proveedores confirman destinos distintos: el bloqueo empresarial conserva una cadena auditada.
  const carreraA=await shell("CORRECCION-CARRERA-A",nombreCorreccion,propia,1),carreraB=await shell("CORRECCION-CARRERA-B",nombreCorreccion,propia,1);
  carreraA.entrada.seleccion[0]={...carreraA.entrada.seleccion[0],empleadoId:4441,metodoEmpleado:"MANUAL",decisionNombre:{tipo:"EMPLEADO",empleadoId:4441,confirmado:true}};
  carreraB.entrada.seleccion[0]={...carreraB.entrada.seleccion[0],empleadoId:4443,metodoEmpleado:"MANUAL",decisionNombre:{tipo:"EMPLEADO",empleadoId:4443,confirmado:true}};
  await Promise.all([cb2(carreraA),cb2(carreraB,{...ctx,proveedorId:2})]);
  const cadena=(await q("SELECT detalle FROM auditoria WHERE accion='cb2_confirmar_equivalencia_piloto' AND JSON_VALUE(detalle,'$.nombreNormalizado')='CORRECCION SINTETICA UNICA' ORDER BY id")).map(r=>JSON.parse(r.detalle));
  for(let i=1;i<cadena.length;i++)expect(cadena[i].anterior.empleado_id).toBe(cadena[i-1].nuevo.empleado_id);
  const [vigente]=await q("SELECT empleado_id FROM flota_cb2_pilotos_equivalencias WHERE nombre_normalizado='CORRECCION SINTETICA UNICA'");
  expect(vigente.empleado_id).toBe(cadena.at(-1).nuevo.empleado_id);
  expect((await q("SELECT empleado_id FROM flota_cb2_consumos WHERE numero_vale='CORRECCION-CARRERA-A'"))[0].empleado_id).toBe(4441);
  expect((await q("SELECT empleado_id FROM flota_cb2_consumos WHERE numero_vale='CORRECCION-CARRERA-B'"))[0].empleado_id).toBe(4443);
  // Los homónimos actualizan el destino confirmado pero siguen requiriendo decisión por archivo.
  expect((await q("SELECT empleado_id,requiere_revision FROM flota_cb2_pilotos_equivalencias WHERE nombre_normalizado='LUIS ESCOBR SINTÉTICO'"))[0]).toMatchObject({empleado_id:4443,requiere_revision:1});
  const http=await cb2Http(new Request(`http://localhost/lab?pilotoReportadoId=${nombres[0].id}&exportar=csv`),"e1","pilotos-reporte");expect(http.status,await http.clone().text()).toBe(200);expect(await http.text()).toContain('Álvaro');
  expect((await cb2Http(new Request("http://localhost/lab"),"denied","pilotos-reporte")).status).toBe(403);
  await expect(q("UPDATE flota_cb2_pilotos_reportados SET estado='PERSONA_CONFIRMADA' WHERE id=?",[nombres[0].id])).rejects.toMatchObject({errno:4025});
 },60000);
 it("unidad TMS canónica: guardas reales, insertId cero, alias, concurrencia y conservación de planes",async()=>{
  const antes=await q("SELECT * FROM flota_cb2_consumos ORDER BY id");
  const id=await resolverUnidadTms(1,"C-558BSJ",684);expect(id).toBeGreaterThan(0);
  const [u]=await q("SELECT * FROM tms_unidades WHERE id=?",[id]);expect(u.flota_vehiculo_id).toBe(1301);
  const [resultado]=await admin.execute("INSERT INTO tms_unidades(empresa_id,placa,tipo,flota_vehiculo_id) VALUES(1,?,'Camion',1301) ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)",[u.placa]);expect(Number((resultado as {insertId:number}).insertId)).toBe(0);
  expect(await resolverUnidadTms(1,"C 558 BSJ",1301)).toBe(id);
  await q("INSERT INTO tms_planes_viaje(empresa_id,codigo,fecha_plan,estado,unidad_id) VALUES(1,'PLAN-CANON-ORIGEN','2026-11-01','Cerrado',?)",[id]);
  const original=await q("SELECT * FROM tms_planes_viaje ORDER BY id");
  const copia=await resolverUnidadTms(1,"C558BSJ",684);await q("INSERT INTO tms_planes_viaje(empresa_id,codigo,fecha_plan,estado,unidad_id) VALUES(1,'PLAN-CANON-COPIA','2026-11-02','Cerrado',?)",[copia]);
  expect((await q("SELECT * FROM tms_planes_viaje ORDER BY id"))[0]).toEqual(original[0]);expect(await q("SELECT id FROM tms_planes_viaje WHERE unidad_id<=0")).toEqual([]);
  const unidades=await Promise.all([resolverUnidadTms(1,'C 991 LAB',null),resolverUnidadTms(1,'C-991LAB',null)]);expect(unidades[0]).toBe(unidades[1]);expect(await q("SELECT id FROM tms_unidades WHERE placa='C991LAB'")).toHaveLength(1);
  await expect(resolverUnidadTms(2,'C558BSJ',684)).rejects.toMatchObject({status:404});
  await q("INSERT INTO tms_unidades(empresa_id,placa,tipo) VALUES(1,'C-998LAB','Camion')");await q("INSERT INTO flota_vehiculos(id,empresa_id,placa) VALUES(1998,1,'C998LAB')");
  const conflicto=await q("SELECT * FROM tms_unidades WHERE placa='C-998LAB'");await expect(resolverUnidadTms(1,'C998LAB',1998)).rejects.toThrow('Conflicto');expect(await q("SELECT * FROM tms_unidades WHERE placa='C-998LAB'")).toEqual(conflicto);
  expect(await q("SELECT * FROM flota_cb2_consumos ORDER BY id")).toEqual(antes);
  // Distintas placas pueden conservar varios IDs TMS de la misma identidad.
  await q("INSERT INTO tms_unidades(empresa_id,placa,tipo,flota_vehiculo_id) VALUES(1,'OTRA-PLACA-LAB','Camion',1301)");
  const tablas=['tms_unidades','tms_planes_viaje','flota_cb2_consumos'];
  const historicos=await Promise.all(tablas.map(t=>q(`SELECT * FROM ${t} ORDER BY id`)));
  await expect(resolverUnidadTms(1,'C558BSJ',684)).rejects.toThrow('Identidad TMS ambigua');
  await expect(resolverUnidadTms(1,'C558BSJ',null)).rejects.toThrow('Identidad TMS ambigua');
  const concurrentes=await Promise.allSettled([resolverUnidadTms(1,'C558BSJ',1301),resolverUnidadTms(1,'C558BSJ',684)]);
  expect(concurrentes.every(r=>r.status==='rejected')).toBe(true);
  expect(await Promise.all(tablas.map(t=>q(`SELECT * FROM ${t} ORDER BY id`)))).toEqual(historicos);
 });

 it("paridad cliente/servidor (preflight #642): empleado activo, de baja, reportado, externo, unidad interna/externa, placa ambigua y combustible pendiente",async()=>{
  vi.stubEnv("CB2_TERCEROS_DIRECTOS_APROBADA","1");vi.stubEnv("CB2_TERCEROS_D2_APROBADA","");
  try{
   const actor={...ctx,escrituraDirecta:true};
   await q("INSERT INTO empleados(id,empresa_id,nombre,estado) VALUES(8801,1,'Marta Activa Prueba','Activo'),(8802,1,'Beto Baja Prueba','Baja')");
   await q("INSERT INTO flota_vehiculos(id,empresa_id,placa,chasis) VALUES(8810,1,'C-571LAB','LABSERIAL000008810'),(8811,1,'P-581LAB','LABSERIAL000008811'),(8812,1,'C-581LAB','LABSERIAL000008812')");
   const piloto=await registrarPiloto(actor,{referencia:"paridad-piloto",nombre:"Piloto Paridad Externo"});
   const unidad=await registrarUnidad(actor,{referencia:"paridad-unidad",placa:"M771LAB",tipo:"MOTOCICLETA",descripcion:"Paridad sintetica"});
   const cat:CatalogosCB2={tercerosDirectos:true,tercerosHabilitados:true,identidadesIndependientes:true,pilotosReportados:true,pilotoReportadoExterno:true,proveedores:[],
    empleados:[{id:8801,nombre:"Marta Activa Prueba",estado:"Activo"},{id:8802,nombre:"Beto Baja Prueba",estado:"Baja"}],
    vehiculos:[{id:8810,placa:"C-571LAB",estado:"Activo"},{id:8811,placa:"P-581LAB",estado:"Activo"},{id:8812,placa:"C-581LAB",estado:"Activo"},{id:-unidad.id,placa:"M771LAB"}],
    pilotosExternos:[{id:piloto.id,nombre:"Piloto Paridad Externo",referencia:"paridad-piloto"}],unidadesExternas:[{id:unidad.id,placa:"M771LAB",referencia:"paridad-unidad",tipo:"MOTOCICLETA",descripcion:"Paridad sintetica"}]};
   type Esc={vale:string;piloto:string;placa:string;producto:string;unidad:number|null;decision:(prop:unknown)=>DecisionAsignacion;cliente:"LISTO"|"PENDIENTE";servidor:"OK"|"RECHAZA"|"NO_APLICA"};
   const base:DecisionAsignacion={exigirProducto:true,exigirPiloto:true};
   const auto=(id:number)=>(prop:unknown):DecisionAsignacion=>({...base,pilotoTipo:"INTERNO",empleadoId:id,pilotoExternoId:null,decisionNombre:prop as never});
   const escenarios:Esc[]=[
    {vale:"PAR-ACTIVO",piloto:"Marta Activa",placa:"C-571LAB",producto:"Diesel",unidad:8810,decision:auto(8801),cliente:"LISTO",servidor:"OK"},
    {vale:"PAR-BAJA",piloto:"Beto Baja",placa:"C-571LAB",producto:"Diesel",unidad:8810,decision:auto(8802),cliente:"LISTO",servidor:"OK"},
    {vale:"PAR-REPORTADO",piloto:"Visitante Sin Registro",placa:"C-571LAB",producto:"Diesel",unidad:8810,decision:()=>({...base,pilotoTipo:"REPORTADO",empleadoId:null,pilotoExternoId:null,decisionNombre:{tipo:"REPORTADO",confirmado:true}}),cliente:"LISTO",servidor:"OK"},
    {vale:"PAR-EXTERNO",piloto:"Cualquier Nombre",placa:"C-571LAB",producto:"Diesel",unidad:8810,decision:()=>({...base,pilotoTipo:"EXTERNO",pilotoExternoId:piloto.id,empleadoId:null}),cliente:"LISTO",servidor:"OK"},
    {vale:"PAR-UNIDAD-EXTERNA",piloto:"Otra Persona Visitante",placa:"M771LAB",producto:"Diesel",unidad:-unidad.id,decision:()=>({...base,pilotoTipo:"REPORTADO",empleadoId:null,pilotoExternoId:null,decisionNombre:{tipo:"REPORTADO",confirmado:true}}),cliente:"LISTO",servidor:"OK"},
    {vale:"PAR-EXTERNO-SIN-IDENTIDAD",piloto:"Sin Identidad Externa",placa:"C-571LAB",producto:"Diesel",unidad:8810,decision:()=>({...base,pilotoTipo:"EXTERNO",empleadoId:null}),cliente:"PENDIENTE",servidor:"NO_APLICA"},
    {vale:"PAR-SIN-DECISION",piloto:"Sin Decision Aun",placa:"C-571LAB",producto:"Diesel",unidad:8810,decision:()=>({...base,pilotoTipo:"REPORTADO",empleadoId:null,pilotoExternoId:null}),cliente:"PENDIENTE",servidor:"NO_APLICA"},
    {vale:"PAR-AMBIGUA",piloto:"Marta Activa",placa:"581LAB",producto:"Diesel",unidad:null,decision:auto(8801),cliente:"PENDIENTE",servidor:"NO_APLICA"},
    {vale:"PAR-AMBIGUA-SIN-MOTIVO",piloto:"Marta Activa",placa:"581LAB",producto:"Diesel",unidad:8811,decision:auto(8801),cliente:"PENDIENTE",servidor:"RECHAZA"},
    {vale:"PAR-AMBIGUA-CON-MOTIVO",piloto:"Marta Activa",placa:"581LAB",producto:"Diesel",unidad:8811,decision:(prop)=>({...auto(8801)(prop),motivoUnidad:"Confirmado con el proveedor: la unidad es P-581LAB"}),cliente:"LISTO",servidor:"OK"},
    {vale:"PAR-COMBUSTIBLE",piloto:"Marta Activa",placa:"C-571LAB",producto:"20W50",unidad:8810,decision:auto(8801),cliente:"PENDIENTE",servidor:"RECHAZA"},
   ];
   const resultados:string[]=[];
   for(const e of escenarios){
    const buffer=await libroShell([filaShell(e.vale,e.piloto,e.placa,e.producto)]);
    const previa=await preview(ctx,buffer,{perfil:"SHELL",moneda:"GTQ",seleccion:[]});
    const fila=previa.filas.find(f=>f.candidato)!;const propuesta=previa.nombres?.find(n=>n.propuesta)?.propuesta??null;
    const decision=e.decision(propuesta);
    const seleccion=e.unidad===null?{}:{[fila.candidato!]:String(e.unidad)};
    const estado=revisionCandidatos([fila],cat,seleccion,{},{},{[fila.candidato!]:decision})[0].estado;
    resultados.push(`${e.vale}: cliente=${estado}`);expect(estado,e.vale).toBe(e.cliente);
    if(e.servidor==="NO_APLICA"||e.unidad===null)continue;
    const entrada:Entrada={perfil:"SHELL",moneda:"GTQ",seleccion:[{candidato:fila.candidato!,vehiculoId:e.unidad,...seleccionShell(fila,cat,decision,e.unidad),...(decision.productoClasificado?{productoClasificado:decision.productoClasificado}:{}),...(decision.motivoUnidad?.trim()?{motivoUnidad:decision.motivoUnidad.trim()}:{})}]};
    let servidor="OK";try{const token=await preview(ctx,buffer,entrada);await confirmarArchivo(ctx,buffer,"paridad.xlsx",entrada,key(),token.token);}catch{servidor="RECHAZA";}
    resultados.push(`${e.vale}: servidor=${servidor}`);expect(servidor,e.vale).toBe(e.servidor);
    expect(await total(e.vale)).toBe(servidor==="OK"?1:0);
   }
   // Consistencia: lo que el cliente da por LISTO el servidor lo acepta, y los consumos guardan identidades reales (sin vehículos ficticios ni empleados modificados).
   expect((await q("SELECT COUNT(*) n FROM flota_vehiculos WHERE placa='M771LAB'"))[0].n).toBe(0);
   expect((await q("SELECT empleado_id,piloto_externo_id,unidad_externa_id,vehiculo_id FROM flota_cb2_consumos WHERE vale_norm IN ('PAR-ACTIVO','PAR-BAJA','PAR-EXTERNO','PAR-UNIDAD-EXTERNA') ORDER BY vale_norm")).map(r=>[r.empleado_id,r.piloto_externo_id,r.unidad_externa_id,r.vehiculo_id])).toEqual([[8801,null,null,8810],[8802,null,null,8810],[null,piloto.id,null,8810],[null,null,unidad.id,null]]);
   expect((await q("SELECT estado FROM empleados WHERE id IN (8801,8802) ORDER BY id")).map(r=>r.estado)).toEqual(["Activo","Baja"]);
   console.log("PARIDAD "+resultados.join(" | "));
  }finally{vi.stubEnv("CB2_TERCEROS_DIRECTOS_APROBADA","");}
 });

 it("cierre integral Shell: alta directa, pendiente, listo, consumo, fondos, historial y solapamiento",async()=>{
  vi.stubEnv("CB2_TERCEROS_DIRECTOS_APROBADA","1");
  vi.stubEnv("CB2_TERCEROS_D2_APROBADA","");
  try {
   const actor={...ctx,escrituraDirecta:true};
   const p=await registrarPiloto(actor,{referencia:"cierre-piloto",nombre:"Piloto Cierre Sintetico"});
   const u=await registrarUnidad(actor,{referencia:"cierre-unidad",placa:"M884LAB",tipo:"MOTOCICLETA",descripcion:"Cierre sintetico"});
   expect(await registrarPiloto(actor,{referencia:"cierre-piloto",nombre:"Piloto Cierre Sintetico"})).toMatchObject({id:p.id,existente:true});
   expect(await q("SELECT id FROM flota_cb2_externos_asociaciones WHERE piloto_id=?",[p.id])).toEqual([]);
   const original="Nombre original del proveedor";
   const buffer=await libroShell([filaShell("CIERRE-INTEGRAL",original,"M884LAB","Diesel")]);
   const previa=await preview(ctx,buffer,{perfil:"SHELL",moneda:"GTQ",seleccion:[]});
   const fila=previa.filas.find(f=>f.candidato)!;
   const cat:CatalogosCB2={tercerosDirectos:true,tercerosHabilitados:true,identidadesIndependientes:true,pilotosReportados:true,pilotoReportadoExterno:true,proveedores:[],empleados:[],vehiculos:[{id:-u.id,placa:"M884LAB"}],pilotosExternos:[{id:p.id,nombre:"Piloto Cierre Sintetico",referencia:"cierre-piloto"}],unidadesExternas:[{id:u.id,placa:"M884LAB",referencia:"cierre-unidad",tipo:"MOTOCICLETA",descripcion:"Cierre sintetico"}]};
   expect(revisionCandidatos([fila],cat,{})[0].estado).toBe("PENDIENTE");
   const decision:DecisionAsignacion={pilotoTipo:"EXTERNO",pilotoExternoId:p.id,empleadoId:null,productoClasificado:"DIESEL"};
   const unidad={[fila.candidato!]:String(-u.id)};
   expect(revisionCandidatos([fila],cat,unidad,{}, {},{[fila.candidato!]:decision})[0].estado).toBe("LISTO");
   const entrada:Entrada={perfil:"SHELL",moneda:"GTQ",seleccion:[{candidato:fila.candidato!,vehiculoId:-u.id,...seleccionShell(fila,cat,decision,-u.id),productoClasificado:"DIESEL"}]};
   const token=await preview(ctx,buffer,entrada);
   await confirmarArchivo(ctx,buffer,"cierre.xlsx",entrada,key(),token.token);
   const [consumo]=await q("SELECT * FROM flota_cb2_consumos WHERE vale_norm='CIERRE-INTEGRAL'");
   expect(consumo).toMatchObject({piloto_informado:original,piloto_externo_id:p.id,unidad_externa_id:u.id,asociacion_externa_id:null});
   // Otro archivo contiene el mismo vale y uno nuevo: reutilizar, no bloquear ni duplicar.
   const solapado=await libroShell([filaShell("CIERRE-INTEGRAL",original,"M884LAB","Diesel"),filaShell("CIERRE-NUEVO",original,"M884LAB","Diesel")]);
   const lineas=(await analizar(solapado,"SHELL","GTQ")).filter(l=>l.clave);
   await cb2({buffer:solapado,entrada:{...entrada,seleccion:lineas.map(l=>({...entrada.seleccion[0],candidato:l.clave!}))}});
   expect(await total("CIERRE-INTEGRAL")).toBe(1);
   expect(await q("SELECT id FROM flota_cb2_filas WHERE consumo_id=? AND resultado='REUTILIZADA'",[consumo.id])).toHaveLength(1);
   await q("INSERT INTO tms_solicitud_fondo_lineas VALUES(990,1,901,'Combustible',NULL,1,200,?,'M884LAB')",[original]);
   const op={proveedorId:1,consumoId:consumo.id,lineaId:990,revision:Number(consumo.revision_asignacion),motivo:"Cierre sintetico con comprobantes revisados",confirmado:true as const};
   await expect(vincularFondoCB2({...ctx,proveedorId:2},op)).rejects.toMatchObject({status:404});
   const fondos=await Promise.all([vincularFondoCB2(ctx,op),vincularFondoCB2(ctx,op)]);
   expect(fondos.filter(f=>!f.repetida)).toHaveLength(1);
   expect((await consultarFondoCB2(1,1,consumo.id,"")).estado).toBe("VINCULADO_MANUAL");
   const historial=await cb2Http(new Request("http://localhost/lab?pilotoExternoId="+p.id),"e1","consumos");
   expect(historial.status,await historial.clone().text()).toBe(200);
   expect(await historial.text()).toContain(original);
   expect((await q("SELECT * FROM flota_cb2_consumos WHERE id=?",[consumo.id]))[0]).toEqual(consumo);
   expect(await q("SELECT * FROM flota_cb2_consumo_piloto_reportado WHERE consumo_id=?",[consumo.id])).toEqual([]);
   expect(await q("SELECT * FROM flota_cb2_fondos_vinculos WHERE consumo_id=?",[consumo.id])).toHaveLength(1);
  } finally {vi.stubEnv("CB2_TERCEROS_DIRECTOS_APROBADA","");}
 },60000);

 it("captura CHECK solo lectura: recupera expresion, NULL permitido y rechazo real tras restaurar",async()=>{
  await q("CREATE TABLE lab_check_capture(id INT PRIMARY KEY,valor INT NULL,CONSTRAINT lab_ck_capture CHECK(valor>=0)) ENGINE=InnoDB");
  await q("INSERT INTO lab_check_capture VALUES(1,NULL),(2,10)");
  const [resultados]=await admin.query(readFileSync("docs/operaciones/cb2-cierre-20261116/00-capturar-checks-solo-lectura.sql","utf8"));
  const sets=resultados as unknown as Record<string,unknown>[][];
  const registro=sets[1].find(r=>r.TABLE_NAME==="lab_check_capture")!;
  const texto=sets[3].find(r=>r.TABLE_NAME==="lab_check_capture")!;
  expect(Number(registro.bytes_clausula)).toBe(Buffer.byteLength(String(registro.CHECK_CLAUSE)));
  expect(sets[1]).toHaveLength(Number(sets[2][0].checks_esperados));
  await q("ALTER TABLE lab_check_capture DROP CONSTRAINT lab_ck_capture");
  expect(Number((await q(String(texto.validar_datos)))[0].infracciones)).toBe(0);
  await q(String(texto.restaurar_check));
  expect((await q("SELECT CHECK_CLAUSE FROM information_schema.CHECK_CONSTRAINTS WHERE CONSTRAINT_SCHEMA=DATABASE() AND TABLE_NAME='lab_check_capture'"))[0].CHECK_CLAUSE).toBe(registro.CHECK_CLAUSE);
  await expect(q("UPDATE lab_check_capture SET valor=-1 WHERE id=2")).rejects.toMatchObject({errno:4025});
  await q("DROP TABLE lab_check_capture");
 });

});
