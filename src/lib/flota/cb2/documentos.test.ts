import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
const m = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("@/lib/db", () => ({ getPool: () => ({ getConnection: m.get }) }));
import { editarDocumento, leerDocumento } from "./documentos";
import { editarDocumentoSchema, cambioDocumento, type EdicionDocumento } from "./documentos-model";
import type { Contexto } from "./repository";
type Registro = Record<string, unknown>;
type Estado = { factura: Registro; recibos: Registro[]; auditoria: Registro[] };
let estado: Estado, cola: Promise<void>, fallo: string | undefined, commitPerdido: boolean;
let sentencias: { sql: string; args: unknown[] }[];
let conexiones: { commit: ReturnType<typeof vi.fn>; rollback: ReturnType<typeof vi.fn>; destroy: ReturnType<typeof vi.fn> }[];
const ctx: Contexto = { empresaId: 7, proveedorId: 3, actor: { id: 9, username: "demo" }, autorizar: vi.fn(async () => {}) };
const permiso = vi.fn(async () => {});
const op = (extra: Partial<EdicionDocumento> = {}): EdicionDocumento => editarDocumentoSchema.parse({ proveedorId: 3, revision: 0, clave: "solicitud-documental-0001", total: "100.123456", motivo: "Documento contrastado con factura", ...extra });
function conexion() {
    let draft: Estado | undefined, liberar: (() => void) | undefined;
    const unlock = () => { liberar?.(); liberar = undefined; };
    const c = {
        beginTransaction: vi.fn(async () => {}),
        commit: vi.fn(async () => { if (fallo === "commit") throw new Error("commit rechazado"); if (draft) estado = draft; if (commitPerdido) { unlock(); throw new Error("respuesta commit perdida"); } unlock(); }),
        rollback: vi.fn(async () => { draft = undefined; unlock(); }),
        release: vi.fn(), destroy: vi.fn(unlock),
        query: vi.fn(async (sql: string, args: unknown[] = []) => {
            sentencias.push({ sql, args });
            if (sql.startsWith("SELECT @@SESSION")) return [[{ mode: "STRICT_ALL_TABLES", innodb: 1 }]];
            if (sql.startsWith("SELECT @@foreign")) return [[{ fk: 1, ck: 1 }]];
            if (sql.startsWith("SET ")) return [[]];
            if (sql.includes("FROM compras_proveedores")) {
                const anterior = cola; cola = new Promise<void>(resolve => { liberar = resolve; }); await anterior;
                draft = structuredClone(estado);
                if (fallo === "proveedor") throw new Error("bloqueo fallido");
                return [[{ id: 3, activo: 1 }]];
            }
            if (sql.includes("FROM flota_cb2_documento_operaciones")) {
                if (fallo === "recibo-lectura") throw new Error("lectura fallida");
                return [(draft ?? estado).recibos.filter(r => r.empresa_id === args[0] && r.proveedor_id === args[1] && r.clave === args[2])];
            }
            if (sql.includes("FROM flota_cb2_facturas")) {
                if (fallo === "factura-lectura") throw new Error("lectura fallida");
                const f = (draft ?? estado).factura;
                return [f.empresa_id === args[0] && f.proveedor_id === args[1] && f.id === args[2] ? [f] : []];
            }
            throw new Error(`Consulta no simulada: ${sql}`);
        }),
        execute: vi.fn(async (sql: string, args: unknown[] = []) => {
            sentencias.push({ sql, args });
            if (!draft) throw new Error("escritura fuera de transaccion");
            if (sql.startsWith("UPDATE flota_cb2_facturas")) {
                if (fallo === "actualizar") throw new Error("actualizacion fallida");
                if (fallo === "cas") return [{ affectedRows: 0 }];
                Object.assign(draft.factura, { fecha: args[0], total_documental: args[1], revision_documental: args[2] });
                return [{ affectedRows: 1 }];
            }
            if (sql.startsWith("INSERT INTO flota_cb2_documento_operaciones")) {
                if (fallo === "recibo-escritura") throw new Error("recibo fallido");
                const keys = sql.match(/\(([^)]+)\)/)![1].split(",");
                draft.recibos.push(Object.fromEntries(keys.map((k, i) => [k, args[i]])));
                return [{ insertId: draft.recibos.length }];
            }
            if (sql.startsWith("INSERT INTO auditoria")) {
                if (fallo === "auditoria") throw new Error("auditoria fallida");
                draft.auditoria.push({ empresa: args[0], usuario: args[1], accion: args[2], detalle: JSON.parse(String(args[4])) });
                return [{ insertId: draft.auditoria.length }];
            }
            throw new Error(`Escritura prohibida: ${sql}`);
        }),
    };
    conexiones.push(c); return c;
}
beforeEach(() => {
    vi.stubEnv("CB2_DOCUMENTOS_FASE2", "1"); fallo = undefined; commitPerdido = false;
    estado = { factura: { id: 10, empresa_id: 7, proveedor_id: 3, moneda: "GTQ", revision_documental: 0, fecha: null, total_documental: null }, recibos: [], auditoria: [] };
    cola = Promise.resolve(); sentencias = []; conexiones = []; m.get.mockImplementation(async () => conexion());
    vi.mocked(ctx.autorizar).mockReset().mockResolvedValue(); permiso.mockReset().mockResolvedValue();
});
afterEach(() => vi.unstubAllEnvs());

describe("documentos: transaccion real con driver simulado, sin bases", () => {
    it("completa nulos, registra auditoria antes/despues y no toca otras entidades", async () => {
        const r = await editarDocumento(ctx, 10, op({ fecha: "2026-10-25" }), permiso);
        expect(r).toMatchObject({ revision: 1, tipo: "COMPLETAR", moneda: "GTQ", valores: { fecha: "2026-10-25", total: "100.123456" } });
        expect(estado.auditoria[0].detalle).toMatchObject({ actorId: 9, antes: { fecha: null, total: null }, despues: { fecha: "2026-10-25", total: "100.123456" }, motivo: op().motivo, revisionAnterior: 0, revisionNueva: 1 });
        expect(permiso).toHaveBeenCalledWith("COMPLETAR");
        expect(sentencias.filter(s => /^(UPDATE|INSERT)/.test(s.sql)).every(s => /^(UPDATE flota_cb2_facturas|INSERT INTO (flota_cb2_documento_operaciones|auditoria))/.test(s.sql))).toBe(true);
        expect(conexiones[0].commit).toHaveBeenCalledOnce();
    });
    it("corrige valores declarados con permiso adicional, mezcla de nulo y declarado es correccion", async () => {
        estado.factura.total_documental = "99";
        await editarDocumento(ctx, 10, op({ fecha: "2026-10-25" }), permiso);
        expect(permiso).toHaveBeenCalledWith("CORREGIR");
        expect((estado.auditoria[0].detalle as Registro).antes).toEqual({ fecha: null, total: "99" });
    });
    it("sin cambio no aumenta revision y queda idempotente/auditado", async () => {
        estado.factura.total_documental = "100.123456";
        expect(await editarDocumento(ctx, 10, op(), permiso)).toMatchObject({ revision: 0, tipo: "SIN_CAMBIO" });
        expect(sentencias.some(s => s.sql.startsWith("UPDATE"))).toBe(false); expect(estado.recibos).toHaveLength(1);
    });
    it("reintento devuelve resultado original incluso tras otra correccion", async () => {
        const primero = await editarDocumento(ctx, 10, op(), permiso);
        await editarDocumento(ctx, 10, op({ revision: 1, total: "200", clave: "solicitud-documental-0002" }), permiso);
        expect(await editarDocumento(ctx, 10, op(), permiso)).toEqual({ ...primero, repetida: true });
        expect(estado.recibos).toHaveLength(2); expect(estado.auditoria).toHaveLength(2);
    });
    it("rechaza clave con distinto actor, contenido o factura", async () => {
        await editarDocumento(ctx, 10, op(), permiso);
        for (const [c, factura, request] of [[{ ...ctx, actor: { id: 11, username: "otro" } }, 10, op()], [ctx, 10, op({ total: "200" })], [ctx, 11, op()]] as const)
            await expect(editarDocumento(c, factura, request, permiso)).rejects.toMatchObject({ status: 409 });
        expect(estado.auditoria).toHaveLength(1);
    });
    it("dos editores con revision cero: uno gana y otro recibe conflicto", async () => {
        const r = await Promise.allSettled([editarDocumento(ctx, 10, op(), permiso), editarDocumento(ctx, 10, op({ total: "200", clave: "solicitud-documental-0002" }), permiso)]);
        expect(r.filter(x => x.status === "fulfilled")).toHaveLength(1); expect(r.find(x => x.status === "rejected")).toMatchObject({ reason: { status: 409 } });
        expect(estado.factura.revision_documental).toBe(1); expect(estado.auditoria).toHaveLength(1);
    });
    it("dos reintentos concurrentes aplican solo una escritura", async () => {
        const r = await Promise.all([editarDocumento(ctx, 10, op(), permiso), editarDocumento(ctx, 10, op(), permiso)]);
        expect(r.map(x => x.repetida)).toEqual([false, true]); expect(estado.recibos).toHaveLength(1); expect(estado.auditoria).toHaveLength(1);
    });
    it("A→B→A no permite una pantalla con revision antigua", async () => {
        estado.factura.total_documental = "100";
        await editarDocumento(ctx, 10, op({ total: "200" }), permiso);
        await editarDocumento(ctx, 10, op({ revision: 1, total: "100", clave: "solicitud-documental-0002" }), permiso);
        await expect(editarDocumento(ctx, 10, op({ total: "300", clave: "solicitud-documental-0003" }), permiso)).rejects.toMatchObject({ status: 409 });
        expect(estado.factura).toMatchObject({ total_documental: "100", revision_documental: 2 });
    });
    it.each(["proveedor", "recibo-lectura", "factura-lectura", "actualizar", "cas", "recibo-escritura", "auditoria", "commit"])("fallo en %s revierte factura, recibo y auditoria", async etapa => {
        const antes = structuredClone(estado); fallo = etapa;
        await expect(editarDocumento(ctx, 10, op(), permiso)).rejects.toBeDefined();
        expect(estado).toEqual(antes); expect(conexiones[0].rollback).toHaveBeenCalled();
    });
    it("commit confirmado pero respuesta perdida: reintento recupera recibo sin reescribir", async () => {
        commitPerdido = true;
        await expect(editarDocumento(ctx, 10, op(), permiso)).rejects.toMatchObject({ status: 503, incierto: true });
        commitPerdido = false;
        expect(await editarDocumento(ctx, 10, op(), permiso)).toMatchObject({ repetida: true, revision: 1 });
        expect(estado.recibos).toHaveLength(1); expect(estado.auditoria).toHaveLength(1);
    });
    it("denegacion bajo bloqueo revierte y replay revalida permiso original", async () => {
        estado.factura.total_documental = "99";
        permiso.mockRejectedValueOnce(new Error("sin permiso"));
        await expect(editarDocumento(ctx, 10, op(), permiso)).rejects.toThrow("sin permiso"); expect(estado.recibos).toHaveLength(0);
        await editarDocumento(ctx, 10, op(), permiso);
        permiso.mockRejectedValueOnce(new Error("permiso revocado"));
        await expect(editarDocumento(ctx, 10, op(), permiso)).rejects.toThrow("permiso revocado"); expect(estado.recibos).toHaveLength(1);
    });
    it.each([{ empresaId: 8 }, { proveedorId: 4 }])("aisla empresa/proveedor %j", async otro => {
        await expect(editarDocumento({ ...ctx, ...otro }, 10, op({ proveedorId: otro.proveedorId ?? 3 }), permiso)).rejects.toMatchObject({ status: 404 });
        expect(estado.recibos).toHaveLength(0);
    });
    it("mantiene USD y precision exacta; lectura usa ámbito compuesto", async () => {
        estado.factura.moneda = "USD";
        expect(await editarDocumento(ctx, 10, op({ total: "999999999999.999999" }), permiso)).toMatchObject({ moneda: "USD", valores: { total: "999999999999.999999" } });
        expect(await leerDocumento(7, 3, 10)).toMatchObject({ moneda: "USD", revision: 1 });
        await expect(leerDocumento(8, 3, 10)).rejects.toMatchObject({ status: 404 });
    });
    it("flag apagado no abre conexión", async () => {
        vi.stubEnv("CB2_DOCUMENTOS_FASE2", "0"); await expect(editarDocumento(ctx, 10, op(), permiso)).rejects.toMatchObject({ status: 503 }); expect(m.get).not.toHaveBeenCalled();
    });
    it("revalidación de sesión fallida tras bloqueo no deja cambios", async () => {
        const antes = structuredClone(estado); vi.mocked(ctx.autorizar).mockRejectedValueOnce(new Error("sesion revocada"));
        await expect(editarDocumento(ctx, 10, op(), permiso)).rejects.toThrow("sesion revocada");
        expect(estado).toEqual(antes); expect(conexiones[0].rollback).toHaveBeenCalled();
    });
    it("misma clave puede existir en otra empresa sin recuperar el recibo ajeno", async () => {
        await editarDocumento(ctx, 10, op(), permiso);
        estado.factura = { ...estado.factura, empresa_id: 8, id: 11, total_documental: null, revision_documental: 0 };
        const r = await editarDocumento({ ...ctx, empresaId: 8 }, 11, op(), permiso);
        expect(r).toMatchObject({ facturaId: 11, repetida: false, revision: 1 });
        expect(estado.recibos.map(r => r.empresa_id)).toEqual([7, 8]);
        expect(estado.auditoria.map(r => r.empresa)).toEqual([7, 8]);
    });
    it("total cero y fecha válida se completan sin conversión; moneda ajena se rechaza", async () => {
        expect(await editarDocumento(ctx, 10, op({ total: "0.000000", fecha: "2026-10-01" }), permiso)).toMatchObject({ valores: { total: "0", fecha: "2026-10-01" } });
        estado.factura.moneda = "EUR";
        await expect(editarDocumento(ctx, 10, op({ total: "1", revision: 1, clave: "solicitud-documental-0002" }), permiso)).rejects.toMatchObject({ status: 409 });
    });
});
describe("contrato puro documental", () => {
    it.each(["1.0000001", "-1", "1e3", "1000000000000", "1,200", "NaN"])("rechaza importe %s sin redondearlo", total => expect(() => op({ total })).toThrow());
    it("no acepta moneda, clasificacion, borrado, proveedor cliente o motivos vacios", () => {
        for (const extra of [{ moneda: "USD" }, { tipo: "COMPLETAR" }, { total: null }, { fecha: null }, { empresa_id: 8 }, { motivo: " " }])
            expect(editarDocumentoSchema.safeParse({ ...op(), ...extra }).success).toBe(false);
        expect(cambioDocumento({ fecha: null, total: "1.000000" }, { total: "1" }).tipo).toBe("SIN_CAMBIO");
    });
});
