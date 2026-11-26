// Prueba integral (MariaDB 11.8.9 real y desechable, pipe sin red): un piloto que NO existe en RR. HH. se guarda UNA vez como piloto reportado (flota_cb2_pilotos_reportados) al confirmar la
// primera importación y las siguientes —de Shell Y de HALEL— lo reconocen solas, sin pedir confirmación otra vez, sin crear empleados y sin tocar consumos históricos.
// Incluye el caso «Pedro Coc»: nombres parecidos en RR. HH. (candidatos aproximados, ninguno elegible) no deben dejar el alias marcado «requiere revisión» (pendiente en cada importación).
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock("@/lib/db", () => ({ getPool: () => state.pool, query: async (sql: string, p: unknown[] = []) => (await state.pool!.query(sql, p))[0] }));
import { analizar } from "./model";
import { preview, confirmarArchivo, consultar } from "./service";
import { libro, libroShell, filaShell } from "./fixture";
import { productos } from "./clasificacion";
import { corregirEquivalenciaPiloto, listarEquivalenciasPilotos } from "./pilotos-equivalencias";
import { recordarIdentificacion, vistaIdentificacion, confirmarIdentificacion } from "./identificacion-masiva-service";
import { resumenIntegrado } from "./resumen-mensual";
import { revisionCandidatos } from "@/components/flota/cb2/preview-model";
import type { CatalogosCB2, FilaCB2 } from "@/components/flota/cb2/client";
import { gruposOrigen, type Registro } from "@/components/flota/cb2/client";
import { recordarPlacaTx, revocarPlaca } from "./placas-equivalencias";
import { exigirSinEquivalenciaPlacaTx } from "../vehiculos-escritura";
import { hash } from "./model";

vi.setConfig({ testTimeout: 240000, hookTimeout: 240000 });
const pipe = process.env.CB2_587_PIPE ?? "";
const BARRA = String.fromCharCode(92), LAB = "cb2_reportados_it";
const ctx = { empresaId: 1, proveedorId: 1, actor: { id: 1, username: "SINTETICO" }, autorizar: vi.fn(async () => { }) };
let admin: mysql.Connection;
const q = async (sql: string, args: unknown[] = []) => (await state.pool!.query<RowDataPacket[]>(sql, args))[0];
const n = async (sql: string) => Number((await q(sql))[0].n);

type Perfil = "SHELL" | "HALEL";
type Decision = { tipo: "REPORTADO"; reportadoId?: number; confirmado: boolean } | { tipo: "EMPLEADO"; empleadoId: number; confirmado: boolean };
const claves = async (b: Buffer, perfil: Perfil) => [...new Set((await analizar(b, perfil, "GTQ")).flatMap(l => (l.clave ? [l.clave] : [])))];
const entrada = async (b: Buffer, perfil: Perfil, decision?: Decision) => ({
  perfil, moneda: "GTQ" as const,
  seleccion: (await claves(b, perfil)).map(candidato => ({ candidato, vehiculoId: 1, productoClasificado: productos[0], ...(decision ? { empleadoId: null, metodoEmpleado: "SIN_ASIGNACION" as const, decisionNombre: decision } : {}) })),
});
/** Lo que hace la pantalla: vista previa → (reconocimiento del servidor) → decisión → confirmar. */
async function importar(b: Buffer, perfil: Perfil, decidir: (nombres: Awaited<ReturnType<typeof preview>>["nombres"]) => Decision | undefined) {
  const p = await preview(ctx, b, await entrada(b, perfil));
  const decision = decidir(p.nombres);
  const e = await entrada(b, perfil, decision), p2 = await preview(ctx, b, e);
  const r = await confirmarArchivo(ctx, b, "sintetico.xlsx", e, randomUUID().replaceAll("-", ""), p2.token);
  return { nombres: p.nombres, decision, r };
}
const shell = (vale: string, piloto: string) => libroShell([filaShell(vale, piloto, "C-001ABC", "vPower")]);
const halel = (vale: string, piloto: string) => libro([[new Date("2026-10-01T00:00:00Z"), vale, "C-001ABC", 10, 20, 200, "", "", piloto, "DIESEL", null]]);
const snapshotConsumos = () => q("SELECT * FROM flota_cb2_consumos ORDER BY id");

describe.skipIf(!pipe)("CB2: piloto reportado — primera y segunda importación con reconocimiento automático (Shell y HALEL)", () => {
  beforeAll(async () => {
    if (!/^cb2-587-[0-9a-f-]{36}$/.test(pipe)) throw Error("PIPE no autorizado");
    process.env.UPLOAD_DIR = ".lab-runtime/uploads-test"; process.env.AUTH_SECRET = "cb2-only-synthetic-test-secret-reportados";
    admin = await mysql.createConnection({ socketPath: `${BARRA}${BARRA}.${BARRA}pipe${BARRA}${pipe}`, user: "root", password: "", multipleStatements: true });
    const [[v]] = await admin.query<RowDataPacket[]>("SELECT VERSION() v"); expect(v.v).toMatch(/^11\.8\.9-MariaDB/);
    await admin.query(`DROP DATABASE IF EXISTS ${LAB}; CREATE DATABASE ${LAB} CHARACTER SET utf8mb4 COLLATE utf8mb4_bin; USE ${LAB};`);
    await admin.query(readFileSync("scripts/ci/combustibles-pr2-lab/base.sql", "utf8"));
    await admin.query("ALTER TABLE flota_vehiculos ADD placa VARCHAR(40) NOT NULL DEFAULT 'C-001ABC', ADD estado VARCHAR(40) NOT NULL DEFAULT 'Activo', ADD activo TINYINT NOT NULL DEFAULT 1");
    await admin.query("ALTER TABLE flota_combustible_cargas ADD numero_vale VARCHAR(128) NULL, ADD proveedor_id INT NULL, ADD estado VARCHAR(40) NULL");   // lectura de vales internos (duplicados)
    await admin.query("INSERT IGNORE INTO empresas VALUES(1,1),(2,1)"); await admin.query("INSERT IGNORE INTO usuarios VALUES(1,1),(2,1)");
    for (const sql of readFileSync("sql/migrate-2026-10-combustibles-pr2-consumos-facturas.sql", "utf8").match(/^CREATE TABLE [\s\S]*?COLLATE=utf8mb4_bin;/gm)!) await admin.query(sql);
    // RR. HH. mínimo: ninguno se llama «Pedro Coc»; tres nombres PARECIDOS (aproximados, no elegibles) reproducen el caso que dejaba el alias «requiere revisión».
    await admin.query(`CREATE TABLE empleados (id INT PRIMARY KEY AUTO_INCREMENT, empresa_id INT NOT NULL, nombre VARCHAR(200) NOT NULL, estado VARCHAR(20) NOT NULL DEFAULT 'Activo', fecha_alta DATE NULL, fecha_egreso DATE NULL) ENGINE=InnoDB;
      INSERT INTO empleados (empresa_id, nombre) VALUES (1, 'Juan Perez Lopez'), (1, 'Pedro Coz'), (1, 'Pedro Cob'), (1, 'Pedro Cox');`);
    // Cadena de instalación REAL del módulo (en el orden del detector de nivel): asignaciones → terceros → directos → independientes → piloto reportado → registro de pilotos reportados.
    for (const f of ["migrate-2026-10-combustibles-pr514-asignaciones.sql", "migrate-2026-11-cb2-terceros.sql", "migrate-2026-11-cb2-terceros-directos.sql", "migrate-2026-11-cb2-identidades-independientes.sql", "migrate-2026-11-cb2-piloto-reportado.sql", "migrate-2026-11-cb2-vinculo-unidad.sql", "migrate-2026-11-cb2-pilotos-reportados.sql"])
      await admin.query(readFileSync(`sql/${f}`, "utf8").replace(/^﻿/, ""));
    await admin.query("CREATE TABLE tms_solicitud_fondo_lineas (id INT NOT NULL PRIMARY KEY, empresa_id INT NOT NULL, UNIQUE KEY uq_fondolin_c2a_empresa_id (empresa_id,id)) ENGINE=InnoDB");
    await admin.query(readFileSync("sql/migrate-2026-11-cb2-fondos-vinculos.sql", "utf8"));
    await admin.query(readFileSync("sql/migrate-2026-11-cb2-equivalencias-placas.sql", "utf8"));
    state.pool = mysql.createPool({ socketPath: `${BARRA}${BARRA}.${BARRA}pipe${BARRA}${pipe}`, user: "root", password: "", database: LAB, connectionLimit: 4, dateStrings: true });
  });
  afterAll(async () => { await state.pool?.end(); await admin?.query(`DROP DATABASE IF EXISTS ${LAB}`).catch(() => undefined); await admin?.end(); });

  it("SHELL: la 1.ª importación pide decidir al piloto desconocido; al confirmar se guarda como reportado SIN crear empleados; la 2.ª lo reconoce sola y no duplica ni toca lo histórico", async () => {
    const empleadosAntes = await n("SELECT COUNT(*) n FROM empleados");
    const primera = await importar(await shell("S-0001", "Pedro Coc"), "SHELL", (nombres) => {
      const nombre = nombres.find(x => x.clave === "PEDRO COC")!;
      expect(nombre.propuesta).toBeNull();                       // desconocido: hay que decidir (única vez)
      expect(nombre.elegibles).toEqual([]);                      // ningún empleado elegible…
      expect(nombre.candidatos.length).toBeGreaterThan(1);       // …pero SÍ varios parecidos (aproximados): el caso que lo dejaba pendiente para siempre
      return { tipo: "REPORTADO", confirmado: true };
    });
    expect(primera.r).toBeTruthy();
    expect(await n("SELECT COUNT(*) n FROM empleados")).toBe(empleadosAntes);                              // no crea empleados
    expect(await q("SELECT nombre_muestra, estado FROM flota_cb2_pilotos_reportados")).toEqual([{ nombre_muestra: "Pedro Coc", estado: "REPORTADO_CONFIRMADO" }]);
    const [eq] = await q("SELECT empleado_id, piloto_reportado_id, requiere_revision FROM flota_cb2_pilotos_equivalencias");
    expect(eq.empleado_id).toBeNull(); expect(Number(eq.requiere_revision)).toBe(0);                       // los parecidos NO lo marcan «requiere revisión»
    expect(await n("SELECT COUNT(*) n FROM flota_cb2_consumo_piloto_reportado")).toBe(1);
    const historico = await snapshotConsumos();

    const segunda = await importar(await shell("S-0002", "PEDRO  COC"), "SHELL", (nombres) => {
      const nombre = nombres.find(x => x.clave === "PEDRO COC")!;
      expect(nombre.propuesta).toMatchObject({ tipo: "REPORTADO", confirmado: false });                  // reconocido automáticamente: sin volver a pedir confirmación
      return nombre.propuesta!;
    });
    expect(segunda.r).toBeTruthy();
    expect(await n("SELECT COUNT(*) n FROM flota_cb2_pilotos_reportados")).toBe(1);                        // no duplica
    expect(await n("SELECT COUNT(DISTINCT piloto_reportado_id) n FROM flota_cb2_consumo_piloto_reportado")).toBe(1);
    expect(await n("SELECT COUNT(*) n FROM flota_cb2_consumo_piloto_reportado")).toBe(2);                  // los dos vales apuntan al mismo piloto
    const ahora = await snapshotConsumos();
    expect(ahora.slice(0, historico.length)).toEqual(historico);                                           // consumos históricos intactos
  });

  it("HALEL: mismo comportamiento — el piloto guardado desde Shell se reconoce solo; uno nuevo se guarda con la casilla y se reconoce en la siguiente", async () => {
    // Pedro Coc ya está en el registro (guardado desde Shell): HALEL lo reconoce automáticamente.
    const reconocido = await importar(await halel("H-0001", "Pedro Coc"), "HALEL", (nombres) => {
      const nombre = nombres.find(x => x.clave === "PEDRO COC")!;
      expect(nombre.propuesta).toMatchObject({ tipo: "REPORTADO", confirmado: false });
      return nombre.propuesta!;
    });
    expect(reconocido.r).toBeTruthy(); expect(await n("SELECT COUNT(*) n FROM flota_cb2_pilotos_reportados")).toBe(1);

    // Un piloto nuevo en HALEL: primera importación (casilla marcada) y segunda (automática).
    await importar(await halel("H-0002", "Rosa Pop"), "HALEL", (nombres) => {
      expect(nombres.find(x => x.clave === "ROSA POP")!.propuesta).toBeNull();
      return { tipo: "REPORTADO", confirmado: true };
    });
    expect(await q("SELECT nombre_muestra FROM flota_cb2_pilotos_reportados ORDER BY id")).toEqual([{ nombre_muestra: "Pedro Coc" }, { nombre_muestra: "Rosa Pop" }]);
    const antes = await snapshotConsumos();
    await importar(await halel("H-0003", "ROSA POP"), "HALEL", (nombres) => {
      const nombre = nombres.find(x => x.clave === "ROSA POP")!;
      expect(nombre.propuesta).toMatchObject({ tipo: "REPORTADO", confirmado: false });
      return nombre.propuesta!;
    });
    expect(await n("SELECT COUNT(*) n FROM flota_cb2_pilotos_reportados")).toBe(2);
    expect((await snapshotConsumos()).slice(0, antes.length)).toEqual(antes);
    expect(await n("SELECT COUNT(*) n FROM empleados")).toBe(4);
  });

  it("HALEL sin la casilla: el piloto no se guarda (no hay confirmación implícita) y la importación sigue funcionando como antes", async () => {
    await importar(await halel("H-0004", "Tomas Ixcoy"), "HALEL", () => undefined);
    expect(await n("SELECT COUNT(*) n FROM flota_cb2_pilotos_reportados WHERE nombre_muestra = 'Tomas Ixcoy'")).toBe(0);
    const p = await preview(ctx, await halel("H-0005", "Tomas Ixcoy"), await entrada(await halel("H-0005", "Tomas Ixcoy"), "HALEL"));
    expect(p.nombres.find(x => x.clave === "TOMAS IXCOY")!.propuesta).toBeNull();                          // sigue sin reconocerse hasta que alguien lo guarde
  });

  it("CORREGIR: quitar o reasignar un reconocimiento solo afecta importaciones futuras (consumos y vínculos históricos intactos); otra empresa y hashes ajenos se rechazan", async () => {
    const actor = { id: 1, username: "SINTETICO" }, c1 = { empresaId: 1, actor };
    const lista = await listarEquivalenciasPilotos(1);
    const rosa = lista.items.find(e => e.nombre === "ROSA POP")!;
    expect(lista.instalado).toBe(true); expect(rosa).toMatchObject({ tipo: "REPORTADO", requiereRevision: false }); expect(rosa.consumos).toBeGreaterThanOrEqual(2);
    const historico = await snapshotConsumos(), vinculos = await q("SELECT * FROM flota_cb2_consumo_piloto_reportado ORDER BY consumo_id"), reportados = await q("SELECT * FROM flota_cb2_pilotos_reportados ORDER BY id");

    await corregirEquivalenciaPiloto(c1, { accion: "QUITAR", nombreHash: rosa.nombreHash });
    expect((await listarEquivalenciasPilotos(1)).items.some(e => e.nombre === "ROSA POP")).toBe(false);
    expect(await snapshotConsumos()).toEqual(historico); expect(await q("SELECT * FROM flota_cb2_consumo_piloto_reportado ORDER BY consumo_id")).toEqual(vinculos);
    expect(await q("SELECT * FROM flota_cb2_pilotos_reportados ORDER BY id")).toEqual(reportados);          // el registro del piloto y sus consumos NO se tocan
    expect(await n("SELECT COUNT(*) n FROM auditoria WHERE accion = 'cb2_corregir_equivalencia_piloto'")).toBe(1);
    // la siguiente importación vuelve a preguntar por ese nombre (única vez) y, al guardarlo de nuevo, reutiliza el MISMO piloto reportado (sin duplicar)
    await importar(await halel("H-0010", "Rosa Pop"), "HALEL", (nombres) => { expect(nombres.find(x => x.clave === "ROSA POP")!.propuesta).toBeNull(); return { tipo: "REPORTADO", confirmado: true }; });
    expect(await n("SELECT COUNT(*) n FROM flota_cb2_pilotos_reportados WHERE nombre_muestra = 'Rosa Pop'")).toBe(1);

    // reasignar a un empleado de RR. HH. de la MISMA empresa
    const pedro = (await listarEquivalenciasPilotos(1)).items.find(e => e.nombre === "PEDRO COC")!;
    const [juan] = await q("SELECT id FROM empleados WHERE nombre = 'Juan Perez Lopez'");
    await corregirEquivalenciaPiloto(c1, { accion: "EMPLEADO", nombreHash: pedro.nombreHash, empleadoId: Number(juan.id) });
    expect((await listarEquivalenciasPilotos(1)).items.find(e => e.nombre === "PEDRO COC")).toMatchObject({ tipo: "EMPLEADO", empleadoId: Number(juan.id), reportadoId: null, requiereRevision: false });
    expect(await n("SELECT COUNT(*) n FROM flota_cb2_consumo_piloto_reportado WHERE piloto_reportado_id = " + pedro.reportadoId)).toBeGreaterThanOrEqual(2);   // sus consumos históricos conservan el vínculo

    // aislamiento: un empleado de otra empresa o una equivalencia ajena/inexistente se rechazan
    await admin.query("INSERT INTO empleados (empresa_id, nombre) VALUES (2, 'Empleado Otra Empresa')");
    const [otra] = await q("SELECT id FROM empleados WHERE empresa_id = 2");
    await expect(corregirEquivalenciaPiloto(c1, { accion: "EMPLEADO", nombreHash: pedro.nombreHash, empleadoId: Number(otra.id) })).rejects.toMatchObject({ status: 403 });
    await expect(corregirEquivalenciaPiloto({ empresaId: 2, actor }, { accion: "QUITAR", nombreHash: pedro.nombreHash })).rejects.toMatchObject({ status: 404 });
    await expect(corregirEquivalenciaPiloto(c1, { accion: "QUITAR", nombreHash: "0".repeat(64) })).rejects.toMatchObject({ status: 404 });
    expect((await listarEquivalenciasPilotos(2)).items).toEqual([]);
  });
  it("equivalencia confirmada propone el empleado en importaciones HALEL y SHELL sin cambiar identidades anteriores", async () => {
    await admin.query("INSERT INTO empleados (empresa_id,nombre) VALUES (1,'Jayme Calderón')");
    const [emp] = await q("SELECT id FROM empleados WHERE empresa_id=1 AND nombre='Jayme Calderón'");
    const empleadoId = Number(emp.id), anterior = await snapshotConsumos();
    await recordarIdentificacion(ctx, { proveedorId: 1, nombre: "Jaime Calderon", empleadoId });
    for (const perfil of ["HALEL", "SHELL"] as const) {
      const b = perfil === "HALEL" ? await halel("H-MASIVA", "Jaime Calderon") : await shell("S-MASIVA", "Jaime Calderon");
      const p = await preview(ctx, b, await entrada(b, perfil));
      const decision = p.nombres.find(x => x.clave === "JAIME CALDERON")?.propuesta;
      expect(decision).toEqual({ tipo: "EMPLEADO", empleadoId, confirmado: false, origen: "EQUIVALENCIA" });
      const seleccion = (await claves(b, perfil)).map(candidato => ({ candidato, vehiculoId: 1, productoClasificado: productos[0], empleadoId, metodoEmpleado: "MANUAL" as const, decisionNombre: decision! }));
      const entradaReal = { perfil, moneda: "GTQ" as const, seleccion };
      const revision = await preview(ctx, b, entradaReal);
      await confirmarArchivo(ctx, b, "equivalencia.xlsx", entradaReal, randomUUID().replaceAll("-", ""), revision.token);
    }
    expect((await snapshotConsumos()).slice(0, anterior.length)).toEqual(anterior);
    expect(await n(`SELECT COUNT(*) n FROM flota_cb2_consumos WHERE piloto_informado='Jaime Calderon' AND empleado_id=${empleadoId}`)).toBe(2);
    await admin.query("INSERT INTO empleados (empresa_id,nombre) VALUES (1,'Jaime Calderon')");
    const conflictivo = await halel("H-CONFLICTO", "Jaime Calderon");
    const revision = await preview(ctx, conflictivo, await entrada(conflictivo, "HALEL"));
    const nombre = revision.nombres.find(x => x.clave === "JAIME CALDERON")!;
    expect(nombre.propuesta).toBeNull();
    expect(nombre.conflictoEquivalencia?.equivalenciaId).toBe(empleadoId);
    expect(await n(`SELECT COUNT(*) n FROM flota_cb2_consumos WHERE piloto_informado='Jaime Calderon' AND empleado_id=${empleadoId}`)).toBe(2);
  });
  it("corrige históricos con el esquema integral y revierte ante revisión obsoleta", async () => {
    await importar(await halel("H-MAS-2", "Nombre Pendiente"), "HALEL", () => undefined);
    await importar(await halel("H-MAS-3", "Nombre Pendiente"), "HALEL", () => undefined);
    const [emp] = await q("SELECT id FROM empleados WHERE empresa_id=1 AND nombre='Jayme Calderón'");
    const empleadoId = Number(emp.id), vista = await vistaIdentificacion(1, { nombre: "Nombre Pendiente", empleadoId });
    const items = vista.proveedores[0].pendientes;
    expect(items).toHaveLength(2);
    const op = { nombre: "Nombre Pendiente", empleadoId, proveedorId: 1, items, motivo: "Confirmado contra evidencia", clave: "integral123456789" };
    await expect(confirmarIdentificacion(ctx, { ...op, items: [items[0], { ...items[1], revision: items[1].revision + 1 }] })).rejects.toThrow("ya no es elegible");
    expect(await n("SELECT COUNT(*) n FROM flota_cb2_consumos WHERE piloto_informado='Nombre Pendiente' AND empleado_id IS NOT NULL")).toBe(0);
    await expect(confirmarIdentificacion(ctx, op)).resolves.toMatchObject({ actualizados: 2 });
    await expect(confirmarIdentificacion(ctx, op)).resolves.toMatchObject({ repetidos: 2 });
  });
  it("vale 18554: revisión, confirmación y lectura persistida con placa original intacta", async () => {
    await admin.query("INSERT INTO flota_vehiculos (id,empresa_id,placa,estado,activo) VALUES (1190,1,'C-125CCM','Activo',1)");
    await admin.query("INSERT INTO empleados (id,empresa_id,nombre,estado) VALUES (96,1,'Rafael Manuel Cucul Yaxcal','Activo')");
    const datos = filaShell("18554", "Rafael Caal", "125 CCN", "Diesel");
    datos[0] = new Date("2026-10-14T00:00:00Z");
    const b = await libroShell([datos]);
    const clave = (await claves(b, "SHELL"))[0];
    const p = await preview(ctx, b, { perfil: "SHELL", moneda: "GTQ", seleccion: [] });
    const fila = { ...p.filas.find(f => f.candidato === clave), perfil: "SHELL" } as FilaCB2;
    const cat = { proveedores: [], vehiculos: [{ id: 1190, placa: "C-125CCM", estado: "Activo" }], empleados: [{ id: 96, nombre: "Rafael Manuel Cucul Yaxcal", estado: "Activo" }], pilotosReportados: true } as unknown as CatalogosCB2;
    const d = { exigirProducto: true, exigirPiloto: true, pilotoTipo: "INTERNO" as const, empleadoId: 96, decisionNombre: { tipo: "EMPLEADO" as const, empleadoId: 96, confirmado: true } };
    expect(revisionCandidatos([fila], cat, { [clave]: "1190" }, {}, {}, { [clave]: d })[0].estado).toBe("PENDIENTE");
    const justificada = { ...d, motivoUnidad: "Placa verificada contra el vale original" };
    expect(revisionCandidatos([fila], cat, { [clave]: "1190" }, {}, {}, { [clave]: justificada })[0].estado).toBe("LISTO");
    const seleccion = [{ candidato: clave, vehiculoId: 1190, empleadoId: 96, metodoEmpleado: "MANUAL" as const, decisionNombre: d.decisionNombre, productoClasificado: "DIESEL" as const, motivoUnidad: justificada.motivoUnidad }];
    const entradaReal = { perfil: "SHELL" as const, moneda: "GTQ" as const, seleccion };
    const verificada = await preview(ctx, b, entradaReal);
    await confirmarArchivo(ctx, b, "sintetico-18554.xlsx", entradaReal, randomUUID().replaceAll("-", ""), verificada.token);
    const [guardado] = await q("SELECT vehiculo_id,empleado_id,placa_original,piloto_informado,fecha_consumo FROM flota_cb2_consumos WHERE empresa_id=1 AND numero_vale=?", ["18554"]);
    expect(guardado).toMatchObject({ vehiculo_id: 1190, empleado_id: 96, placa_original: "125 CCN", piloto_informado: "Rafael Caal", fecha_consumo: "2026-10-14" });
    const [importacion] = await q("SELECT id FROM flota_cb2_importaciones WHERE empresa_id=1 AND archivo_nombre=?", ["sintetico-18554.xlsx"]);
    const eventos = await consultar(1, "filas", Number(importacion.id), 500);
    const origen = gruposOrigen(eventos as Registro[]).find(f => f.vale === "18554")!;
    expect(origen.consumoId).toBeGreaterThan(0);
    expect(revisionCandidatos([origen], cat, {}, {}, {}, {})[0].estado).toBe("RESUELTO");
  });
  it("el resumen integrado consulta históricos y CB2 en MariaDB aislada", async () => {
    await admin.query("ALTER TABLE flota_combustible_cargas ADD vehiculo_id INT NULL, ADD fecha_consumo DATE NULL, ADD creado_at DATETIME NULL, ADD galones DECIMAL(18,6) NULL, ADD precio_galon DECIMAL(18,6) NULL, ADD monto DECIMAL(18,6) NULL, ADD tipo_combustible VARCHAR(30) NULL");
    await admin.query("INSERT INTO flota_combustible_cargas (empresa_id,vehiculo_id,proveedor_id,numero_vale,estado,fecha_consumo,creado_at,galones,precio_galon,monto,tipo_combustible) VALUES (1,1190,1,'SINTETICO-H','APROBADO','2026-10-14','2026-10-15',5,20,100,'diesel')");
    const resumen = await resumenIntegrado(1, "2026-10");
    expect(resumen.grupos.some(g => g.origen === "HISTORICO" && g.vehiculoId === 1190 && g.galones === "5")).toBe(true);
    expect(resumen.grupos.some(g => g.origen === "CB2" && g.vehiculoId === 1190)).toBe(true);
  });
  it("equivalencias de placa: importación, aislamiento, reintento, conflicto y revocación", async () => {
    await admin.query("INSERT INTO flota_vehiculos (id,empresa_id,placa,estado,activo) VALUES (1191,1,'C-125CCM','Activo',1),(1192,1,'C-999XYZ','Activo',1)");
    const b = await libroShell([filaShell("EQ-1", "Piloto Placa", "125 CCN", "Diesel")]);
    const key = (await claves(b, "SHELL"))[0];
    const seleccion = [{ candidato: key, vehiculoId: 1191, productoClasificado: "DIESEL" as const, motivoUnidad: "Verificado contra el vale original", recordarPlaca: true, empleadoId: null, metodoEmpleado: "SIN_ASIGNACION" as const, decisionNombre: { tipo: "REPORTADO" as const, confirmado: true } }];
    const entradaReal = { perfil: "SHELL" as const, moneda: "GTQ" as const, seleccion };
    const p = await preview(ctx, b, entradaReal), claveOp = "equivalenciaPlaca0001";
    await confirmarArchivo(ctx, b, "eq-shell.xlsx", entradaReal, claveOp, p.token);
    await expect(confirmarArchivo(ctx, b, "eq-shell.xlsx", entradaReal, claveOp, p.token)).resolves.toMatchObject({ repetida: true });
    expect(await n("SELECT COUNT(*) n FROM flota_cb2_placas_equivalencias WHERE empresa_id=1 AND proveedor_id=1")).toBe(1);
    expect((await q("SELECT placa_original,vehiculo_id FROM flota_cb2_consumos WHERE numero_vale='EQ-1'"))[0]).toMatchObject({ placa_original: "125 CCN", vehiculo_id: 1191 });
    const futuroShell = await preview(ctx, await libroShell([filaShell("EQ-2", "Piloto Placa", "125 CCN", "Diesel")]), { perfil: "SHELL", moneda: "GTQ", seleccion: [] });
    expect(futuroShell.filas.find(f => f.candidato)?.equivalenciaPlaca).toEqual({ vehiculoId: 1191, placa: "C-125CCM" });
    const bHalel = await libro([[new Date("2026-10-01T00:00:00Z"), "EQ-3", "125 CCN", 10, 20, 200, "", "", "Piloto Placa", "DIESEL", null]]);
    expect((await preview(ctx, bHalel, { perfil: "HALEL", moneda: "GTQ", seleccion: [] })).filas.find(f => f.candidato)?.equivalenciaPlaca?.vehiculoId).toBe(1191);
    await admin.query("UPDATE flota_vehiculos SET activo=0 WHERE id=1191");
    expect((await preview(ctx, bHalel, { perfil: "HALEL", moneda: "GTQ", seleccion: [] })).filas.find(f => f.candidato)?.equivalenciaPlaca).toBeNull();
    await admin.query("UPDATE flota_vehiculos SET activo=1 WHERE id=1191");
    await admin.query("INSERT INTO flota_vehiculos (id,empresa_id,placa,estado,activo) VALUES (1193,1,'C-125CCN','Baja',0)");
    expect((await preview(ctx, bHalel, { perfil: "HALEL", moneda: "GTQ", seleccion: [] })).filas.find(f => f.candidato)?.equivalenciaPlaca).toBeNull();
    await admin.query("DELETE FROM flota_vehiculos WHERE id=1193");
    expect((await preview({ ...ctx, proveedorId: 2 }, bHalel, { perfil: "HALEL", moneda: "GTQ", seleccion: [] })).filas.find(f => f.candidato)?.equivalenciaPlaca).toBeNull();
    expect((await preview({ ...ctx, empresaId: 2, proveedorId: 3 }, bHalel, { perfil: "HALEL", moneda: "GTQ", seleccion: [] })).filas.find(f => f.candidato)?.equivalenciaPlaca).toBeNull();
    const h = await libro([[new Date("2026-10-01T00:00:00Z"), "EQ-H1", "125 CCE", 10, 20, 200, "", "", "Piloto Placa", "DIESEL", null]]);
    const hEntrada = { perfil: "HALEL" as const, moneda: "GTQ" as const, seleccion: [{ candidato: (await claves(h, "HALEL"))[0], vehiculoId: 1191, productoClasificado: "DIESEL" as const, motivoUnidad: "Verificado contra vale de HALEL", recordarPlaca: true }] };
    await confirmarArchivo({ ...ctx, proveedorId: 2 }, h, "eq-halel.xlsx", hEntrada, "equivalenciaHalel001", (await preview({ ...ctx, proveedorId: 2 }, h, hEntrada)).token);
    const h2 = await libro([[new Date("2026-10-01T00:00:00Z"), "EQ-H2", "125 CCE", 10, 20, 200, "", "", "Piloto Placa", "DIESEL", null]]);
    expect((await preview({ ...ctx, proveedorId: 2 }, h2, { perfil: "HALEL", moneda: "GTQ", seleccion: [] })).filas.find(f => f.candidato)?.equivalenciaPlaca?.vehiculoId).toBe(1191);
    expect((await preview(ctx, h2, { perfil: "HALEL", moneda: "GTQ", seleccion: [] })).filas.find(f => f.candidato)?.equivalenciaPlaca).toBeNull();
    const conflict = await libroShell([filaShell("EQ-4", "Piloto Placa", "125 CCN", "Diesel")]);
    const k = (await claves(conflict, "SHELL"))[0], e = { ...entradaReal, seleccion: [{ ...seleccion[0], candidato: k, vehiculoId: 1192 }] };
    const pc = await preview(ctx, conflict, e);
    await expect(confirmarArchivo(ctx, conflict, "conflicto.xlsx", e, "equivalenciaPlaca0002", pc.token)).rejects.toThrow(/conflicto/i);
    expect(await n("SELECT COUNT(*) n FROM flota_cb2_consumos WHERE numero_vale='EQ-4'")).toBe(0);
    const auditAntes = await n("SELECT COUNT(*) n FROM auditoria WHERE accion='cb2_recordar_placa'");
    await confirmarArchivo(ctx, b, "eq-shell.xlsx", entradaReal, claveOp, p.token);
    expect(await n("SELECT COUNT(*) n FROM auditoria WHERE accion='cb2_recordar_placa'")).toBe(auditAntes);
    const concurrentes = await Promise.all(["EQ-5", "EQ-6"].map(v => libroShell([filaShell(v, "Piloto Placa", "125 CCD", "Diesel")])));
    const peticiones = await Promise.all(concurrentes.map(async (archivo, i) => {
      const candidato = (await claves(archivo, "SHELL"))[0];
      const entrada = { ...entradaReal, seleccion: [{ ...seleccion[0], candidato, vehiculoId: i ? 1192 : 1191 }] };
      return { archivo, entrada, token: (await preview(ctx, archivo, entrada)).token };
    }));
    const resultados = await Promise.allSettled(peticiones.map((r, i) => confirmarArchivo(ctx, r.archivo, `concurrente-${i}.xlsx`, r.entrada, `concurrenciaPlaca000${i}`, r.token)));
    expect(resultados.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect(resultados.filter(r => r.status === "rejected")).toHaveLength(1);
    expect(await n("SELECT COUNT(*) n FROM flota_cb2_consumos WHERE numero_vale IN ('EQ-5','EQ-6')")).toBe(1);
    const seleccionSugerida = [{ ...seleccion[0], candidato: (await claves(bHalel, "HALEL"))[0], usarEquivalenciaPlaca: true, recordarPlaca: false, decisionNombre: undefined }];
    const entradaSugerida = { perfil: "HALEL" as const, moneda: "GTQ" as const, seleccion: seleccionSugerida };
    const reciboSugerido = await preview(ctx, bHalel, entradaSugerida);
    await expect(revocarPlaca(ctx, hash("125CCN"))).resolves.toMatchObject({ repetida: false });
    await expect(revocarPlaca(ctx, hash("125CCN"))).resolves.toMatchObject({ repetida: true });
    await expect(confirmarArchivo(ctx, bHalel, "sugerida-revocada.xlsx", entradaSugerida, "equivalenciaPlaca0003", reciboSugerido.token)).rejects.toThrow(/equivalencia cambi/i);
    expect((await preview(ctx, bHalel, { perfil: "HALEL", moneda: "GTQ", seleccion: [] })).filas.find(f => f.candidato)?.equivalenciaPlaca).toBeNull();
    expect((await q("SELECT placa_original,vehiculo_id FROM flota_cb2_consumos WHERE numero_vale='EQ-1'"))[0]).toMatchObject({ placa_original: "125 CCN", vehiculo_id: 1191 });
  });
  it("recupera con la misma clave después de perder la respuesta al COMMIT real", async () => {
    const archivo = await libro([[new Date("2026-10-01T00:00:00Z"), "EQ-COMMIT", "125 CCQ", 10, 20, 200, "", "", "Piloto Placa", "DIESEL", null]]);
    const candidato = (await claves(archivo, "HALEL"))[0];
    const entrada = { perfil: "HALEL" as const, moneda: "GTQ" as const, seleccion: [{ candidato, vehiculoId: 1191, productoClasificado: "DIESEL" as const, motivoUnidad: "Verificado contra evidencia original", recordarPlaca: true }] };
    const recibo = await preview(ctx, archivo, entrada), clave = "commitPerdidoPlaca001";
    const auditorias = await n("SELECT COUNT(*) n FROM auditoria WHERE accion IN ('cb2_recordar_placa','cb2_confirmar')");
    const obtener = state.pool!.getConnection.bind(state.pool!);
    let commits = 0;
    const spy = vi.spyOn(state.pool!, "getConnection").mockImplementation(async () => {
      const c = await obtener();
      return new Proxy(c, { get(target, prop) {
        if (prop === "commit") return async () => { await target.commit(); if (++commits === 2) throw new Error("respuesta perdida tras commit"); };
        const v = Reflect.get(target, prop, target); return typeof v === "function" ? v.bind(target) : v;
      } });
    });
    try { await expect(confirmarArchivo(ctx, archivo, "perdido.xlsx", entrada, clave, recibo.token)).rejects.toMatchObject({ incierto: true }); }
    finally { spy.mockRestore(); }
    expect(await n("SELECT COUNT(*) n FROM flota_cb2_consumos WHERE numero_vale='EQ-COMMIT'")).toBe(1);
    expect(await n("SELECT COUNT(*) n FROM flota_cb2_placas_equivalencias WHERE placa_normalizada='125CCQ'")).toBe(1);
    expect(await n("SELECT COUNT(*) n FROM auditoria WHERE accion IN ('cb2_recordar_placa','cb2_confirmar')")).toBe(auditorias + 2);
    await expect(confirmarArchivo(ctx, archivo, "perdido.xlsx", entrada, clave, recibo.token)).resolves.toMatchObject({ repetida: true });
    expect(await n("SELECT COUNT(*) n FROM flota_cb2_consumos WHERE numero_vale='EQ-COMMIT'")).toBe(1);
    expect(await n("SELECT COUNT(*) n FROM flota_cb2_placas_equivalencias WHERE placa_normalizada='125CCQ'")).toBe(1);
    expect(await n("SELECT COUNT(*) n FROM auditoria WHERE accion IN ('cb2_recordar_placa','cb2_confirmar')")).toBe(auditorias + 2);
  });
  it("serializa equivalencia y alta de Flota mediante el bloqueo de empresa", async () => {
    const a = await state.pool!.getConnection(), b = await state.pool!.getConnection();
    try {
      await a.beginTransaction(); await b.beginTransaction();
      await recordarPlacaTx(a, ctx, "123 AAA", 1191, "Verificado contra la evidencia");
      let desbloqueada = false;
      const espera = b.query("SELECT id FROM empresas WHERE id=1 FOR UPDATE").then(() => { desbloqueada = true; });
      await new Promise(resolve => setTimeout(resolve, 150));
      expect(desbloqueada).toBe(false);
      await a.commit(); await espera;
      await expect(exigirSinEquivalenciaPlacaTx(b, 1, "C-123AAA")).rejects.toThrow(/equivalencia CB2/);
      await b.rollback();
      expect(await n("SELECT COUNT(*) n FROM flota_vehiculos WHERE placa='C-123AAA'")).toBe(0);
      await a.beginTransaction();
      await a.query("SELECT id FROM empresas WHERE id=1 FOR UPDATE");
      await a.query("INSERT INTO flota_vehiculos (empresa_id,placa,estado,activo) VALUES (1,'C-124AAA','Activo',1)");
      await b.beginTransaction();
      const guardar = recordarPlacaTx(b, ctx, "124 AAA", 1191, "Verificado contra la evidencia");
      await a.commit();
      await expect(guardar).rejects.toThrow(/coincide con una unidad real/i);
      await b.rollback();
      expect(await n("SELECT COUNT(*) n FROM flota_cb2_placas_equivalencias WHERE placa_normalizada='124AAA'")).toBe(0);
    } finally { await a.rollback(); await b.rollback(); a.release(); b.release(); }
  });

});
