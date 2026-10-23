import type { PoolConnection, RowDataPacket, ResultSetHeader } from "mysql2/promise";
import Decimal from "decimal.js";
import { getPool, type SqlValue } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { ahoraLocal } from "@/lib/rrhh/dates";
import { normalizarIdentificador as norm, normalizarPlacaImportada } from "../combustible-identificadores";
import { ErrorCB2, recuperar, type Documento, type Evento } from "./model";
import { predicadoVehiculoAccesible } from "../acceso";
import { esPlacaAbreviada, placaComparable } from "../combustible-coincidencias";
export type Actor = {
    id: number;
    username: string;
};
export type Contexto = {
    empresaId: number;
    proveedorId: number;
    actor: Actor;
    autorizar: () => Promise<void>;
};
export async function rows(c: PoolConnection, sql: string, args: SqlValue[] = []): Promise<RowDataPacket[]> { return (await c.query<RowDataPacket[]>(sql, args))[0]; }
export async function insert(c: PoolConnection, table: string, values: Record<string, SqlValue>) {
    // Los nombres/columnas proceden exclusivamente de constantes del servicio, nunca del request.
    const keys = Object.keys(values).filter(k => values[k] !== undefined);
    const [r] = await c.execute<ResultSetHeader>(`INSERT INTO ${table} (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`, keys.map(k => values[k]));
    return r.insertId;
}
// El guard central consulta el pool al revalidar. No dejar que escritores CB2
// ocupen sus 15 conexiones mientras esperan proveedor y luego pidan otra.
let activas = 0;
const esperando: (() => void)[] = [];
export async function tx<T>(ctx: Contexto, fn: (c: PoolConnection, p: RowDataPacket) => Promise<T>): Promise<T> {
    if (activas >= 4) {
        if (esperando.length >= 32) throw new ErrorCB2("CB2 ocupado; reintenta la misma solicitud.", 503);
        await new Promise<void>(resolve => esperando.push(resolve));
    } else activas++;
    try { return await transaccion(ctx, fn); }
    finally {
        const siguiente = esperando.shift();
        if (siguiente) siguiente(); // transferir la plaza sin carrera con nuevos callers
        else activas--;
    }
}
async function transaccion<T>(ctx: Contexto, fn: (c: PoolConnection, p: RowDataPacket) => Promise<T>): Promise<T> {
    for (let intento = 0;; intento++) {
        const c = await getPool().getConnection();
        let original: RowDataPacket | undefined, commit = false, clean = true;
        try {
            [original] = await rows(c, "SELECT @@SESSION.sql_mode AS mode, @@SESSION.innodb_strict_mode AS innodb");
            await c.query("SET SESSION sql_mode = ?", [[...new Set([...String(original.mode).split(",").filter(Boolean), "STRICT_ALL_TABLES"])].join(",")]);
            await c.query("SET SESSION innodb_strict_mode=ON");
            const [env] = await rows(c, "SELECT @@foreign_key_checks AS fk, @@check_constraint_checks AS ck");
            if (Number(env.fk) !== 1 || Number(env.ck) !== 1 || String(original.mode).split(",").includes("NO_BACKSLASH_ESCAPES"))
                throw new ErrorCB2("Entorno SQL incompatible; no se modificaron las tablas.", 503);
            await c.query("SET TRANSACTION ISOLATION LEVEL READ COMMITTED");
            await c.beginTransaction();
            const [p] = await rows(c, "SELECT id,nombre_comercial,activo FROM compras_proveedores WHERE empresa_id=? AND id=? FOR UPDATE", [ctx.empresaId, ctx.proveedorId]);
            if (!p || Number(p.activo) !== 1)
                throw new ErrorCB2("Proveedor no disponible.", 403);
            await ctx.autorizar(); // Revalidar identidad, acceso y capacidad tras esperar el bloqueo.
            const r = await fn(c, p);
            commit = true;
            await c.commit();
            return r;
        }
        catch (e) {
            try {
                await c.rollback();
            }
            catch {
                clean = false;
            }
            const code = (e as {
                code?: string;
            }).code;
            if (!commit && clean && intento < 2 && ["ER_LOCK_DEADLOCK", "ER_LOCK_WAIT_TIMEOUT"].includes(code ?? ""))
                continue;
            if (commit || !clean) {
                clean = false;
                throw new ErrorCB2("Resultado transaccional incierto. Reintenta exactamente la misma clave y solicitud.", 503, true);
            }
            if (code === "ER_DUP_ENTRY")
                throw new ErrorCB2("Conflicto de unicidad; no se certifica como reintento idempotente.");
            throw e;
        }
        finally {
            if (clean && original) {
                try {
                    await c.query("SET SESSION sql_mode=?", [original.mode]);
                    await c.query("SET SESSION innodb_strict_mode=?", [original.innodb]);
                }
                catch {
                    clean = false;
                }
            }
            if (clean)
                c.release();
            else
                c.destroy();
        }
    }
}
export async function anterior(c: PoolConnection, ctx: Contexto, tipo: string, clave: string, digest: string) {
    const r = await rows(c, "SELECT * FROM flota_cb2_filas WHERE empresa_id=? AND proveedor_id=? AND operacion_tipo=? AND operacion_clave=? ORDER BY operacion_ordinal", [ctx.empresaId, ctx.proveedorId, tipo, clave]);
    return recuperar(r, digest, ctx.actor.id);
}
export async function diario(c: PoolConnection, ctx: Contexto, tipo: string, clave: string, digest: string, eventos: Evento[]) {
    if (!eventos.length || eventos.length > 10000)
        throw new ErrorCB2("La operacion requiere entre 1 y 10000 eventos.", 400);
    for (const [i, e] of eventos.entries())
        await insert(c, "flota_cb2_filas", { ...e, id: undefined, empresa_id: ctx.empresaId, proveedor_id: ctx.proveedorId, marca_origen: e.tipo === "ORIGEN" ? 1 : null, operacion_tipo: tipo, operacion_clave: clave, solicitud_sha256: digest, operacion_ordinal: i + 1, operacion_total: eventos.length, usuario_id: ctx.actor.id, creado_en: ahoraLocal(), factura_anterior_id: e.factura_anterior_id ?? null, factura_nueva_id: e.factura_nueva_id ?? null } as unknown as Record<string, SqlValue>);
    await registrarAuditoriaTx(c, { empresaId: ctx.empresaId, usuario: ctx.actor.username, modulo: "flota_combustible", accion: `cb2_${tipo.toLowerCase()}`, detalle: JSON.stringify({ clave, digest, eventos: eventos.length, actor: ctx.actor.id }) });
    return (await anterior(c, ctx, tipo, clave, digest))!;
}
export async function factura(c: PoolConnection, ctx: Contexto, d: Documento) {
    const [f] = await rows(c, "SELECT *,DATE_FORMAT(fecha_factura,'%Y-%m-%d') AS fecha FROM flota_cb2_facturas WHERE empresa_id=? AND proveedor_id=? AND serie_norm=? AND numero_norm=? FOR UPDATE", [ctx.empresaId, ctx.proveedorId, norm(d.serie), norm(d.numero)]);
    if (f) {
        if (f.moneda !== d.moneda || (d.fecha !== null && f.fecha !== d.fecha) || (d.total !== null && (f.total_documental === null || !new Decimal(f.total_documental).eq(d.total))))
            throw new ErrorCB2("Documento existente incompatible; no se sobrescribe.");
        return Number(f.id);
    }
    return insert(c, "flota_cb2_facturas", { empresa_id: ctx.empresaId, proveedor_id: ctx.proveedorId, serie: d.serie, numero: d.numero, serie_norm: norm(d.serie), numero_norm: norm(d.numero), moneda: d.moneda, fecha_factura: d.fecha, total_documental: d.total, creado_por: ctx.actor.id, creado_en: ahoraLocal() });
}
/** Bloquea vehiculo y acceso compartido para impedir revocacion entre validacion y commit. */
export async function vehiculos(c: PoolConnection, ctx: Contexto, ids: number[]) {
    const result = new Map<number, string>();
    for (const id of [...new Set(ids)].sort((a, b) => a - b)) {
        const [v] = await rows(c, "SELECT id,empresa_id,placa,estado,activo FROM flota_vehiculos WHERE id=? FOR UPDATE", [id]);
        if (!v || (v.estado !== "Activo" || Number(v.activo) !== 1))
            throw new ErrorCB2("Vehiculo no disponible.", 403);
        if (Number(v.empresa_id) !== ctx.empresaId) {
            const a = await rows(c, "SELECT vehiculo_id FROM flota_vehiculo_acceso WHERE empresa_id=? AND vehiculo_id=? FOR UPDATE", [ctx.empresaId, id]);
            if (!a.length)
                throw new ErrorCB2("Vehiculo sin acceso vigente.", 403);
        }
        result.set(id, normalizarPlacaImportada(String(v.placa)));
    }
    return result;
}

/** Revalidación de abreviaturas dentro de la empresa y la transacción actuales.
 * Bloquea todos los candidatos del sufijo, no solo el ID enviado por el cliente. */
export async function catalogoAbreviadas(c: PoolConnection, ctx: Contexto, placas: string[]) {
    const sufijos = [...new Set(placas.filter(esPlacaAbreviada).map(placaComparable))].sort();
    const catalogo: { id: number; placa: string }[] = [];
    for (let i = 0; i < sufijos.length; i += 200) {
        const parte = sufijos.slice(i, i + 200);
        const found = await rows(c, `SELECT v.id,v.placa FROM flota_vehiculos v WHERE v.activo=1 AND v.estado='Activo' AND ${predicadoVehiculoAccesible("v", "?")} AND RIGHT(REGEXP_REPLACE(UPPER(v.placa),'[[:space:]‐‑–—-]',''),6) IN (${parte.map(() => "?").join(",")}) ORDER BY v.id FOR UPDATE`, [ctx.empresaId, ctx.empresaId, ...parte]);
        catalogo.push(...found.map(v => ({ id: Number(v.id), placa: String(v.placa) })));
    }
    return catalogo;
}
