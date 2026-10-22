import { createHash } from "node:crypto";
import Decimal from "decimal.js";
import { z } from "zod";
import { analizarProveedorV2 } from "../combustible-importacion-v2";
import { normalizarIdentificador as norm } from "../combustible-identificadores";
import type { FilaProveedorV2, PerfilProveedor } from "../combustible-importacion-v2-types";
export class ErrorCB2 extends Error {
    constructor(message: string, public status = 409, public incierto = false) { super(message); }
}
export const hash = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
export const id = z.number().int().positive().max(2147483647);
export const clave = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/);
export const moneda = z.enum(["GTQ", "USD"]);
const decisionOriginal = z.object({
    version: z.literal(1), moneda,
    candidato: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
    vehiculoId: id.nullable(), errores: z.array(z.string()),
}).strict();
/** Validar TODOS los originales; el resultado no depende de cual sea primero. */
export function monedaOriginal(originales: Record<string, unknown>[], empresa: number, proveedor: number, importacion: number): "GTQ" | "USD" {
    if (!originales.length || originales.length > 10000)
        throw new ErrorCB2("Evidencia original incompleta o no certificable.");
    const monedas = new Set<"GTQ" | "USD">();
    const posiciones = new Set<string>();
    for (const o of originales) {
        if (Number(o.empresa_id) !== empresa || Number(o.proveedor_id) !== proveedor || Number(o.importacion_id) !== importacion ||
            o.tipo !== "ORIGEN" || Number(o.revision) !== 1 || Number(o.marca_origen) !== 1 || o.origen_fila_id !== null || o.operacion_tipo !== "CONFIRMAR")
            throw new ErrorCB2("Evento ORIGEN no certificable.");
        let decision: z.infer<typeof decisionOriginal>;
        try {
            decision = decisionOriginal.parse(JSON.parse(String(o.decision)));
            const datos: unknown = JSON.parse(String(o.datos_origen));
            if (!datos || typeof datos !== "object" || Array.isArray(datos) ||
                !Number.isInteger(Number(o.hoja_indice)) || Number(o.hoja_indice) < 1 || Number(o.hoja_indice) > 20 ||
                !Number.isInteger(Number(o.fila_excel)) || Number(o.fila_excel) < 1 || Number(o.fila_excel) > 5000 ||
                (datos as Record<string, unknown>).hoja !== o.hoja_nombre || (datos as Record<string, unknown>).fila !== Number(o.fila_excel)) throw new Error();
        } catch { throw new ErrorCB2("JSON de evidencia original no certificable."); }
        const posicion = `${o.hoja_indice}:${o.fila_excel}`;
        if (posiciones.has(posicion)) throw new ErrorCB2("Posiciones ORIGEN repetidas.");
        posiciones.add(posicion); monedas.add(decision.moneda);
    }
    if (monedas.size !== 1) throw new ErrorCB2("Moneda inconsistente entre originales.");
    return [...monedas][0];
}
const decimal = z.string().regex(/^\d{1,12}(?:\.\d{1,6})?$/).transform(s => new Decimal(s).toFixed());
const texto = z.string().trim().min(1).max(128).refine(s => !/[\u0000-\u001f\u007f]/.test(s));
export const documento = z.object({ serie: texto, numero: texto, moneda, fecha: z.iso.date().nullable().default(null), total: decimal.nullable().default(null) }).strict();
export type Documento = z.infer<typeof documento>;
export const seleccion = z.array(z.object({ candidato: z.string().regex(/^[0-9a-f]{64}$/), vehiculoId: id }).strict()).max(10000).refine(xs => new Set(xs.map(x => x.candidato)).size === xs.length).transform(xs => xs.sort((a, b) => a.candidato.localeCompare(b.candidato)));
export const confirmar = z.object({ proveedorId: id, perfil: z.enum(["HALEL", "SHELL"]), moneda, clave, seleccion, token: z.string().min(1).max(8192) }).strict();
export const reanudar = z.object({ proveedorId: id, importacionId: id, revision: id, clave, seleccion, motivo: z.string().trim().min(1).max(1000) }).strict();
export const asociar = z.object({ proveedorId: id, clave, documento, consumos: z.array(id).min(1).max(1000).refine(xs => new Set(xs).size === xs.length).transform(xs => xs.sort((a, b) => a - b)), revisiones: z.array(z.object({ id, revision: id }).strict()).min(1).max(1000).refine(xs => new Set(xs.map(x => x.id)).size === xs.length).transform(xs => xs.sort((a, b) => a.id - b.id)), motivo: z.string().trim().min(1).max(1000) }).strict();
export type Seleccion = z.infer<typeof seleccion>;
export type Linea = {
    fila: FilaProveedorV2;
    hoja: number;
    errores: string[];
    documento: Documento | null;
    payload: string | null;
    huella: string | null;
    clave: string | null;
    bloqueada: boolean;
};
export function payload(f: FilaProveedorV2, currency: string) {
    const dec = (s: string | null) => s === null ? null : new Decimal(s).toFixed();
    return JSON.stringify([1, f.vale, f.fechaConsumo, f.placaNormalizada, f.pilotoInformado === null ? null : norm(f.pilotoInformado), f.producto === null ? null : norm(f.producto), dec(f.galones), dec(f.precio), dec(f.monto), dec(f.kilometraje), f.textos.km ? f.textos.km.normalize("NFC") : null, currency]);
}
/** Diagnosticos estructurados emitidos por el parser; nunca clasifica por texto de motivos. */
export async function analizar(buffer: Buffer, perfil: PerfilProveedor, currency: "GTQ" | "USD") {
    const errores = new Map<FilaProveedorV2, string[]>();
    const p = await analizarProveedorV2(buffer, perfil, (f, campo) => errores.set(f, [...(errores.get(f) ?? []), campo]));
    const hojas = new Map<string, number>();
    const lineas: Linea[] = p.filas.map(f => {
        if (!hojas.has(f.hoja))
            hojas.set(f.hoja, hojas.size + 1);
        const issues = [...(errores.get(f) ?? [])];
        if (f.estado !== "IGNORADA" && ([f.vale, f.placaOriginal, f.placaNormalizada, f.textos.km].some(s => s.length > 128) || (f.pilotoInformado?.length ?? 0) > 255 || (f.producto?.length ?? 0) > 100))
            issues.push("LONGITUD");
        if (f.serie.length > 128) issues.push("serie");
        if (f.factura.length > 128) issues.push("factura");
        const operativo = f.estado !== "IGNORADA" && !issues.some(c => c !== "serie" && c !== "factura") && !!f.identidadCandidata;
        const doc = f.serie && f.factura && !issues.some(c => c === "serie" || c === "factura") ? documento.safeParse({ serie: f.serie, numero: f.factura, moneda: currency }) : null;
        const canonical = operativo ? payload(f, currency) : null;
        return { fila: f, hoja: hojas.get(f.hoja)!, errores: issues, documento: doc?.success ? doc.data : null, payload: canonical, huella: canonical ? hash(canonical) : null, clave: f.identidadCandidata, bloqueada: !operativo };
    });
    const grupos = new Map<string, Linea[]>();
    for (const l of lineas)
        if (l.clave)
            grupos.set(l.clave, [...(grupos.get(l.clave) ?? []), l]);
    for (const grupo of grupos.values()) {
        const docs = new Set(grupo.filter(l => l.documento).map(l => JSON.stringify([norm(l.documento!.serie), norm(l.documento!.numero)])));
        if (grupo.some(l => l.bloqueada) || new Set(grupo.map(l => l.payload)).size !== 1 || docs.size > 1)
            grupo.forEach(l => l.bloqueada = true);
        else {
            const doc = grupo.find(l => l.documento)?.documento ?? null;
            grupo.forEach(l => l.documento = doc);
        }
    }
    if (lineas.length === 0 || lineas.length > 10000)
        throw new ErrorCB2("El archivo debe contener entre 1 y 10000 apariciones.", 400);
    return lineas;
}
export type Evento = {
    id?: number;
    importacion_id: number;
    revision: number;
    tipo: string;
    origen_fila_id: number | null;
    hoja_indice: number;
    hoja_nombre: string;
    fila_excel: number;
    resultado: string;
    consumo_id: number | null;
    factura_anterior_id?: number | null;
    factura_nueva_id?: number | null;
    datos_origen: string | null;
    decision: string;
    motivo: string;
};
export function recuperar(rows: Record<string, unknown>[], digest: string, actor: number) {
    if (!rows.length)
        return null;
    const n = rows.length;
    if (n > 10000 || rows.some((r, i) => Number(r.operacion_ordinal) !== i + 1 || Number(r.operacion_total) !== n || r.solicitud_sha256 !== digest || Number(r.usuario_id) !== actor))
        throw new ErrorCB2("Clave idempotente incompatible o diario incompleto.");
    return rows.map(r => ({ id: Number(r.id), importacionId: Number(r.importacion_id), revision: Number(r.revision), resultado: String(r.resultado), consumoId: r.consumo_id === null ? null : Number(r.consumo_id) }));
}
