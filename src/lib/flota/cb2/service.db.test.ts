import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { beforeAll, beforeEach, afterAll, afterEach, describe, it, expect, vi } from "vitest";
const state = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock("@/lib/db", () => ({ getPool: () => state.pool }));
import { analizar, hash, asociar } from "./model";
import { preview, confirmarArchivo, reanudarArchivo, asociarFactura, consultar } from "./service";
import { libro, row } from "./fixture";
const pipe = process.env.CB2_TEST_PIPE ?? "";
const databases: string[] = [];
let admin: mysql.Connection;
const ctx = { empresaId: 1, proveedorId: 1, actor: { id: 1, username: "SINTETICO" }, autorizar: vi.fn(async () => { }) };
const key = () => randomUUID().replaceAll("-", "");
async function q(sql: string, args: unknown[] = []) { return (await state.pool!.query<RowDataPacket[]>(sql, args))[0]; }
async function entrada(b: Buffer, seleccion = true) { return { perfil: "HALEL" as const, moneda: "GTQ" as const, seleccion: seleccion ? [...new Set((await analizar(b, "HALEL", "GTQ")).flatMap(l => l.clave ? [l.clave] : []))].map(candidato => ({ candidato, vehiculoId: 1 })) : [] }; }
async function importar(b: Buffer, seleccion = true, k = key()) { const e = await entrada(b, seleccion), p = await preview(ctx, b, e); return confirmarArchivo(ctx, b, "sintetico.xlsx", e, k, p.token); }
async function snapshot() { return Promise.all(["flota_cb2_importaciones", "flota_cb2_facturas", "flota_cb2_consumos", "flota_cb2_filas", "auditoria"].map(t => q(`SELECT * FROM ${t} ORDER BY id`))); }
describe.skipIf(!pipe)("CB2 MariaDB 11.8.9 PIPE propio sin produccion", () => {
    beforeAll(async () => {
        if (!/^cb2-508-[0-9a-f-]{36}$/.test(pipe))
            throw new Error("PIPE de laboratorio invalida");
        admin = await mysql.createConnection({ socketPath: `\\\\.\\pipe\\${pipe}`, user: "root", password: "", multipleStatements: true });
        const [[env]] = await admin.query<RowDataPacket[]>("SELECT VERSION() AS v,@@skip_networking AS net,@@socket AS pipe,@@datadir AS dir");
        expect(String(env.v)).toMatch(/^11\.8\.9-MariaDB/);
        expect(Number(env.net)).toBe(1);
        expect(env.pipe).toBe(pipe);
        expect(path.resolve(env.dir).toLowerCase().startsWith(path.resolve(".lab-runtime").toLowerCase() + path.sep)).toBe(true);
        process.env.UPLOAD_DIR = path.resolve(".lab-runtime", "uploads-test");
        process.env.AUTH_SECRET = "cb2-only-synthetic-test-secret-508";
    });
    beforeEach(async () => {
        if (state.pool)
            await state.pool.end();
        const db = `cb2_508_${randomUUID().replaceAll("-", "")}`;
        databases.push(db);
        await admin.query(`CREATE DATABASE \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;USE \`${db}\`;`);
        await admin.query(readFileSync("scripts/ci/combustibles-pr2-lab/base.sql", "utf8"));
        await admin.query("ALTER TABLE flota_vehiculos ADD placa VARCHAR(40) NOT NULL DEFAULT 'C-001ABC',ADD estado VARCHAR(40) NOT NULL DEFAULT 'Activo',ADD activo TINYINT NOT NULL DEFAULT 1");
        const ddl = readFileSync("sql/migrate-2026-10-combustibles-pr2-consumos-facturas.sql", "utf8").match(/^CREATE TABLE [\s\S]*?COLLATE=utf8mb4_bin;/gm)!;
        expect(ddl).toHaveLength(4);
        for (const sql of ddl)
            await admin.query(sql);
        state.pool = mysql.createPool({ socketPath: `\\\\.\\pipe\\${pipe}`, user: "root", password: "", database: db, connectionLimit: 4, dateStrings: true });
        ctx.autorizar.mockReset();
        ctx.autorizar.mockResolvedValue();
    });
    afterAll(async () => { if (state.pool)
        await state.pool.end(); if (admin) {
        for (const db of databases)
            await admin.query(`DROP DATABASE \`${db}\``);
        await admin.end();
    } });
    afterEach(async () => {
        // Las 15 incidencias EXACTAS del canonico, sin reescribir sus predicados.
        const source = readFileSync("sql/postcheck-2026-10-combustibles-pr2-consumos-facturas.sql", "utf8").replace(/\r\n/g, "\n");
        const cte = source.match(/SELECT '(WITH incidencias AS \([\s\S]*?)' INTO @cb2_postcheck_select;/)![1].replaceAll("''", "'").split("\nSELECT 'DATO' AS ambito")[0];
        const incidencias = await q(cte + " SELECT * FROM incidencias");
        expect(incidencias).toHaveLength(15);
        expect(incidencias.filter(r => Number(r.incidencias) !== 0)).toEqual([]);
    });
    it("parcial, reanuda sin modificar ORIGEN, asocia un consumo creado en resolucion", async () => {
        const b = await libro([row()]);
        await importar(b, false);
        const [h] = await q("SELECT * FROM flota_cb2_importaciones");
        expect(h.estado).toBe("SOLO_EVIDENCIA");
        const originals = await q("SELECT * FROM flota_cb2_filas");
        await reanudarArchivo(ctx, { importacionId: h.id, revision: 1, seleccion: (await entrada(b)).seleccion, clave: key(), motivo: "Resolver unidad" });
        expect(await q("SELECT * FROM flota_cb2_filas WHERE tipo='ORIGEN'")).toEqual(originals);
        const [c] = await q("SELECT * FROM flota_cb2_consumos");
        expect(c.estado_factura).toBe("PENDIENTE_FACTURA");
        const op = asociar.parse({ proveedorId: 1, clave: key(), documento: { serie: "SERIE", numero: "000001", moneda: "GTQ" }, consumos: [c.id], revisiones: [{ id: h.id, revision: 2 }], motivo: "Documento fiable" });
        await asociarFactura(ctx, op);
        expect((await q("SELECT estado_factura FROM flota_cb2_consumos"))[0].estado_factura).toBe("FACTURADO");
    });
    it("misma clave recupera resultado anterior aunque revision avance; sin auditoria duplicada", async () => {
        const b = await libro([row()]), e = await entrada(b), p = await preview(ctx, b, e), k = key();
        const a = await confirmarArchivo(ctx, b, "sintetico.xlsx", e, k, p.token);
        const snap = await snapshot();
        const r = await confirmarArchivo(ctx, b, "sintetico.xlsx", e, k, "vencido");
        expect(r.eventos).toEqual(a.eventos);
        expect(await snapshot()).toEqual(snap);
        await expect(confirmarArchivo({ ...ctx, actor: { id: 2, username: "OTRO" } }, b, "sintetico.xlsx", e, k, p.token)).rejects.toThrow();
    });
    it("dos conexiones mismo archivo y clave: una sola cabecera/consumo/auditoria", async () => {
        const b = await libro([row()]), e = await entrada(b), p = await preview(ctx, b, e), k = key();
        await Promise.all([confirmarArchivo(ctx, b, "a.xlsx", e, k, p.token), confirmarArchivo(ctx, b, "a.xlsx", e, k, p.token)]);
        expect(await q("SELECT id FROM flota_cb2_importaciones")).toHaveLength(1);
        expect(await q("SELECT id FROM flota_cb2_consumos")).toHaveLength(1);
        expect(await q("SELECT id FROM auditoria")).toHaveLength(1);
    });
    it("archivo nuevo solapado y duplicados exactos reutilizan consumo", async () => {
        await importar(await libro([row()]));
        await importar(await libro([row(), row()]));
        expect(await q("SELECT id FROM flota_cb2_importaciones")).toHaveLength(2);
        expect(await q("SELECT id FROM flota_cb2_consumos")).toHaveLength(1);
    });
    it("mismo vale con payload distinto bloqueado, sin crear otro consumo", async () => {
        await importar(await libro([row()]));
        const r = row();
        r[5] = 300;
        await importar(await libro([r]));
        expect(await q("SELECT id FROM flota_cb2_consumos")).toHaveLength(1);
        expect(await q("SELECT id FROM flota_cb2_filas WHERE resultado='BLOQUEADA'")).toHaveLength(1);
    });
    it("historico C2B bloquea y conserva evidencia", async () => {
        await q("INSERT INTO flota_combustible_conciliaciones (id,empresa_id,proveedor_id,perfil_parser) VALUES(1,1,1,'HALEL')");
        await q("INSERT INTO flota_combustible_conciliacion_filas (empresa_id,conciliacion_id,clave_operacion) VALUES(1,1,?)", [hash(JSON.stringify(["0001"]))]);
        await importar(await libro([row()]));
        expect(await q("SELECT id FROM flota_cb2_consumos")).toHaveLength(0);
    });
    it("auditoria fallida revierte cabecera, consumos y diario", async () => {
        await q("CREATE TRIGGER cb2_test_audit BEFORE INSERT ON auditoria FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT='fixture fallo auditoria'");
        await expect(importar(await libro([row()]))).rejects.toThrow();
        expect(await q("SELECT id FROM flota_cb2_importaciones")).toHaveLength(0);
        expect(await q("SELECT id FROM flota_cb2_consumos")).toHaveLength(0);
    });
    it("permiso revocado mientras espera cancela sin escrituras", async () => { ctx.autorizar.mockRejectedValue(new Error("revocado")); await expect(importar(await libro([row()]))).rejects.toThrow("revocado"); expect(await q("SELECT id FROM flota_cb2_importaciones")).toHaveLength(0); });
    it("tenant/proveedor y vehiculo ajenos se rechazan; compartido vigente permitido", async () => {
        const b = await libro([row()]), e = await entrada(b);
        await expect(preview({ ...ctx, empresaId: 2 }, b, e)).rejects.toThrow();
        const bad = { ...e, seleccion: e.seleccion.map(s => ({ ...s, vehiculoId: 2 })) };
        let p = await preview(ctx, b, bad);
        await q("DELETE FROM flota_vehiculo_acceso");
        await expect(confirmarArchivo(ctx, b, "a.xlsx", bad, key(), p.token)).rejects.toThrow();
        await q("INSERT INTO flota_vehiculo_acceso VALUES(2,1)");
        p = await preview(ctx, b, bad);
        await confirmarArchivo(ctx, b, "a.xlsx", bad, key(), p.token);
        expect((await q("SELECT vehiculo_id FROM flota_cb2_consumos"))[0].vehiculo_id).toBe(2);
        await q("DELETE FROM flota_vehiculo_acceso");
        expect(await consultar(1, "consumos")).toHaveLength(1);
        expect(await consultar(2, "consumos")).toHaveLength(0);
    });
    it("revision obsoleta y hash privado alterado no agregan eventos", async () => {
        const b = await libro([row()]);
        await importar(b, false);
        const [h] = await q("SELECT * FROM flota_cb2_importaciones");
        const op = { importacionId: h.id, revision: 9, seleccion: (await entrada(b)).seleccion, clave: key(), motivo: "fixture" };
        const before = await snapshot();
        await expect(reanudarArchivo(ctx, op)).rejects.toThrow("Revision");
        expect(await snapshot()).toEqual(before);
        await q("UPDATE flota_cb2_importaciones SET archivo_sha256=REPEAT('e',64)");
        await expect(reanudarArchivo(ctx, { ...op, revision: 1 })).rejects.toThrow("Hash");
    });
    it("factura multicabecera atomica, NOOP y conflicto de reasignacion", async () => {
        await importar(await libro([row("01")]));
        await importar(await libro([row("02")]));
        const cs = await q("SELECT * FROM flota_cb2_consumos"), hs = await q("SELECT id,revision FROM flota_cb2_importaciones");
        const op = asociar.parse({ proveedorId: 1, clave: key(), documento: { serie: "S", numero: "0001", moneda: "GTQ" }, consumos: cs.map(c => c.id), revisiones: hs, motivo: "fixture" });
        await asociarFactura(ctx, op);
        const snap = await snapshot();
        await asociarFactura(ctx, op);
        expect(await snapshot()).toEqual(snap);
        const revisiones = await q("SELECT id,revision FROM flota_cb2_importaciones");
        await expect(asociarFactura(ctx, { ...op, clave: key(), revisiones: revisiones as {
                id: number;
                revision: number;
            }[], documento: { ...op.documento, numero: "0002" } })).rejects.toThrow();
        expect(await snapshot()).toEqual(snap);
        await asociarFactura(ctx, { ...op, clave: key(), revisiones: revisiones as {
                id: number;
                revision: number;
            }[] });
        expect(await q("SELECT id FROM flota_cb2_filas WHERE resultado='SIN_CAMBIO'")).toHaveLength(2);
    });
    it("asociaciones concurrentes contradictorias: solo un lote se confirma", async () => {
        await importar(await libro([row()]));
        const [c] = await q("SELECT * FROM flota_cb2_consumos"), [h] = await q("SELECT id,revision FROM flota_cb2_importaciones");
        const op = asociar.parse({ proveedorId: 1, clave: key(), documento: { serie: "S", numero: "01", moneda: "GTQ" }, consumos: [c.id], revisiones: [h], motivo: "fixture" });
        const r = await Promise.allSettled([asociarFactura(ctx, op), asociarFactura(ctx, { ...op, clave: key(), documento: { ...op.documento, numero: "02" } })]);
        expect(r.filter(x => x.status === "fulfilled")).toHaveLength(1);
        expect(await q("SELECT id FROM flota_cb2_facturas")).toHaveLength(1);
    });
    it("reanudacion recupera antes de revision, distinta solicitud e incompletitud bloquean", async () => {
        const b = await libro([row()]);
        await importar(b, false);
        const [h] = await q("SELECT * FROM flota_cb2_importaciones");
        const op = { importacionId: h.id, revision: 1, seleccion: (await entrada(b)).seleccion, clave: key(), motivo: "fixture" };
        const r = await reanudarArchivo(ctx, op), snap = await snapshot();
        expect((await reanudarArchivo(ctx, op)).eventos).toEqual(r.eventos);
        expect(await snapshot()).toEqual(snap);
        await expect(reanudarArchivo(ctx, { ...op, motivo: "otra" })).rejects.toThrow();
        await q("UPDATE flota_cb2_filas SET operacion_total=99 WHERE operacion_tipo='REANUDAR'");
        await expect(reanudarArchivo(ctx, op)).rejects.toThrow("diario incompleto");
        await q("UPDATE flota_cb2_filas SET operacion_total=1 WHERE operacion_tipo='REANUDAR'");
    });
    it("mismo vale en otro tenant/proveedor es independiente y no modifica tablas historicas", async () => {
        const historic = await Promise.all(["empresas", "usuarios", "compras_proveedores", "flota_vehiculos", "flota_vehiculo_acceso", "flota_combustible_cargas", "flota_combustible_conciliaciones", "flota_combustible_conciliacion_filas"].map(t => q(`SELECT * FROM ${t}`)));
        const b = await libro([row()]), e = await entrada(b);
        await importar(b);
        const p = await preview({ ...ctx, proveedorId: 2 }, b, e);
        await confirmarArchivo({ ...ctx, proveedorId: 2 }, b, "b.xlsx", e, key(), p.token);
        expect(await q("SELECT id FROM flota_cb2_consumos")).toHaveLength(2);
        expect(await Promise.all(["empresas", "usuarios", "compras_proveedores", "flota_vehiculos", "flota_vehiculo_acceso", "flota_combustible_cargas", "flota_combustible_conciliaciones", "flota_combustible_conciliacion_filas"].map(t => q(`SELECT * FROM ${t}`)))).toEqual(historic);
    });
    it("SHELL formula permitida y factura textual completa; conflicto fiable no crea documento extra", async () => {
        const a = row();
        a[6] = "S";
        a[7] = "000001";
        const b = await libro([a], w => w.worksheets[0].getCell("D2").value = { formula: "F2/E2", result: 10 });
        const e = { ...await entrada(b), perfil: "SHELL" as const }, p = await preview(ctx, b, e);
        await confirmarArchivo(ctx, b, "shell.xlsx", e, key(), p.token);
        expect((await q("SELECT estado_factura,galones_calculados FROM flota_cb2_consumos"))[0]).toMatchObject({ estado_factura: "FACTURADO", galones_calculados: 1 });
        expect((await q("SELECT numero FROM flota_cb2_facturas"))[0].numero).toBe("000001");
        a[7] = "000002";
        await importar(await libro([a]));
        expect(await q("SELECT id FROM flota_cb2_facturas")).toHaveLength(1);
        expect(await q("SELECT id FROM flota_cb2_consumos")).toHaveLength(1);
    });
    it("asociacion exige mismo proveedor y moneda; preserva todo el lote", async () => {
        await importar(await libro([row()]));
        const [c] = await q("SELECT * FROM flota_cb2_consumos"), [h] = await q("SELECT id,revision FROM flota_cb2_importaciones"), snap = await snapshot();
        const op = asociar.parse({ proveedorId: 1, clave: key(), documento: { serie: "S", numero: "01", moneda: "USD" }, consumos: [c.id], revisiones: [h], motivo: "fixture" });
        await expect(asociarFactura(ctx, op)).rejects.toThrow("Moneda");
        await expect(asociarFactura({ ...ctx, proveedorId: 2 }, op)).rejects.toThrow("Consumo");
        expect(await snapshot()).toEqual(snap);
    });
    it("reanuda desde ORIGEN pese a eventos de revisiones posteriores y otra importacion/proveedor", async () => {
        const b = await libro([row()]); await importar(b, false);
        const [h] = await q("SELECT * FROM flota_cb2_importaciones");
        const seleccion = (await entrada(b)).seleccion;
        await reanudarArchivo(ctx, {importacionId:h.id,revision:1,seleccion,clave:key(),motivo:"Revision 2"});
        const [c] = await q("SELECT * FROM flota_cb2_consumos");
        await asociarFactura(ctx, asociar.parse({proveedorId:1,clave:key(),documento:{serie:"S",numero:"01",moneda:"GTQ"},consumos:[c.id],revisiones:[{id:h.id,revision:2}],motivo:"Revision 3"}));
        await q("UPDATE flota_cb2_filas SET decision=? WHERE tipo<>'ORIGEN'", [JSON.stringify({moneda:"USD"})]);
        const e = {...await entrada(b,false),moneda:"USD" as const}, otro = {...ctx,proveedorId:2};
        const p = await preview(otro,b,e); await confirmarArchivo(otro,b,"otro.xlsx",e,key(),p.token);
        await reanudarArchivo(ctx,{importacionId:h.id,revision:3,seleccion,clave:key(),motivo:"Revision 4"});
        expect((await q("SELECT moneda FROM flota_cb2_consumos WHERE empresa_id=1 AND proveedor_id=1"))[0].moneda).toBe("GTQ");
        expect((await q("SELECT revision FROM flota_cb2_importaciones WHERE id=?",[h.id]))[0].revision).toBe(4);
    });
    it("moneda inconsistente en un original posterior bloquea sin escribir", async () => {
        const b=await libro([row("01"),row("02")]);await importar(b,false);
        const [h]=await q("SELECT * FROM flota_cb2_importaciones");
        const os=await q("SELECT id,decision FROM flota_cb2_filas WHERE tipo='ORIGEN' ORDER BY id"), ultimo=os[os.length-1];
        await q("UPDATE flota_cb2_filas SET decision=JSON_SET(decision,'$.moneda','USD') WHERE id=?",[ultimo.id]);
        try {const before=await snapshot();await expect(reanudarArchivo(ctx,{importacionId:h.id,revision:1,seleccion:(await entrada(b)).seleccion,clave:key(),motivo:"fixture"})).rejects.toThrow("inconsistente");expect(await snapshot()).toEqual(before);}
        finally {await q("UPDATE flota_cb2_filas SET decision=? WHERE id=?",[ultimo.decision,ultimo.id]);}
    });
    it("JSON original valido para SQL pero estructuralmente invalido no permite reanudar", async () => {
        const b=await libro([row()]);await importar(b,false);
        const [h]=await q("SELECT * FROM flota_cb2_importaciones"),[o]=await q("SELECT id,decision FROM flota_cb2_filas WHERE tipo='ORIGEN' ORDER BY id");
        try {for(const decision of ["[]","null",'{"moneda":"GTQ"}']){
            await q("UPDATE flota_cb2_filas SET decision=? WHERE id=?",[decision,o.id]);const before=await snapshot();
            await expect(reanudarArchivo(ctx,{importacionId:h.id,revision:1,seleccion:(await entrada(b)).seleccion,clave:key(),motivo:"fixture"})).rejects.toThrow("JSON");expect(await snapshot()).toEqual(before);
        }} finally {await q("UPDATE flota_cb2_filas SET decision=? WHERE id=?",[o.decision,o.id]);}
    });
});
