import { SignJWT, jwtVerify } from "jose";
import type { PoolConnection, RowDataPacket } from "mysql2/promise";
import { getAuthSecretBytes } from "@/lib/auth-secret";
import { getPool } from "@/lib/db";
import { ahoraLocal } from "@/lib/rrhh/dates";
import { ErrorCB2, hash, analizar, monedaOriginal, type Linea, type Seleccion, type Evento, type Documento } from "./model";
import { rows, insert, tx, anterior, diario, factura, vehiculos, catalogoAbreviadas, type Contexto } from "./repository";
import * as storage from "./storage";
import { esPlacaAbreviada, placaComparable, placaCompatible } from "../combustible-coincidencias";
const audience = "combustibles-cb2-confirmar-v1";
export type Entrada = {
    perfil: "HALEL" | "SHELL";
    moneda: "GTQ" | "USD";
    seleccion: Seleccion;
};
const digest = (ctx: Contexto, tipo: string, data: unknown) => hash(JSON.stringify([1, ctx.empresaId, ctx.proveedorId, ctx.actor.id, tipo, data]));
async function proveedor(ctx: Contexto) {
    const c = await getPool().getConnection();
    try {
        const [p] = await rows(c, "SELECT id FROM compras_proveedores WHERE empresa_id=? AND id=? AND activo=1", [ctx.empresaId, ctx.proveedorId]);
        if (!p)
            throw new ErrorCB2("Proveedor no disponible.", 403);
    }
    finally {
        c.release();
    }
}
export async function preview(ctx: Contexto, buffer: Buffer, entrada: Entrada) {
    await proveedor(ctx);
    const lineas = await analizar(buffer, entrada.perfil, entrada.moneda), sha = hash(buffer);
    const token = await new SignJWT({ parser: 2, solicitud: digest(ctx, "CONFIRMAR", [sha, entrada]), archivo: sha }).setProtectedHeader({ alg: "HS256" }).setAudience(audience).setIssuedAt().setExpirationTime("15m").sign(getAuthSecretBytes());
    return { sha256: sha, token, filas: lineas.map(l => ({ hoja: l.fila.hoja, fila: l.fila.fila, lote: l.fila.lote, kilometraje: l.fila.kilometraje, origen: { ...l.fila.textos }, candidato: l.clave, bloqueada: l.bloqueada, documento: l.documento, errores: l.errores, estado: l.fila.estado, motivos: l.fila.motivos, vale: l.fila.vale, placa: l.fila.placaOriginal, placaNormalizada: l.fila.placaNormalizada, fecha: l.fila.fechaConsumo, galones: l.fila.galones, precio: l.fila.precio, monto: l.fila.monto, moneda: entrada.moneda })), nota: "Confirmacion revalida historial, vehiculos y documentos bajo bloqueo; el recibo no garantiza elegibilidad." };
}
export async function confirmarArchivo(ctx: Contexto, buffer: Buffer, nombre: string, entrada: Entrada, clave: string, token: string) {
    const sha = hash(buffer), request = digest(ctx, "CONFIRMAR", [sha, entrada]);
    // Un recibo vencido no impide recuperar una operacion ya confirmada. La
    // recuperacion valida actor/digest/ordinales bajo el mismo bloqueo proveedor.
    const conocido = await tx(ctx, async (c) => {
        const retry = await anterior(c, ctx, "CONFIRMAR", clave, request);
        if (retry)
            return { eventos: retry, repetida: true };
        const [existente] = await rows(c, "SELECT id FROM flota_cb2_importaciones WHERE empresa_id=? AND proveedor_id=? AND archivo_sha256=?", [ctx.empresaId, ctx.proveedorId, sha]);
        return existente ? { importacionId: Number(existente.id), existente: true, requiereReanudacion: true } : null;
    });
    if (conocido)
        return conocido;
    try {
        const p = (await jwtVerify(token, getAuthSecretBytes(), { algorithms: ["HS256"], audience })).payload;
        if (p.parser !== 2 || p.solicitud !== request)
            throw new Error();
    }
    catch {
        throw new ErrorCB2("Recibo invalido o vencido; repite preview con las mismas decisiones.", 409);
    }
    const lineas = await analizar(buffer, entrada.perfil, entrada.moneda);
    if (nombre.length > 255 || !nombre.toLowerCase().endsWith(".xlsx"))
        throw new ErrorCB2("Nombre de archivo invalido.", 400);
    // Evidencia preparada antes de la transaccion. Solo compensar el archivo NUEVO
    // tras rollback confirmado; un resultado incierto conserva siempre la evidencia.
    await proveedor(ctx);
    const ruta = await storage.guardar(ctx.empresaId, buffer);
    let nueva = false;
    try {
        const resultado = await tx(ctx, async (c, p) => {
            nueva = false;
            const retry = await anterior(c, ctx, "CONFIRMAR", clave, request);
            if (retry)
                return { eventos: retry, repetida: true };
            const [existente] = await rows(c, "SELECT id FROM flota_cb2_importaciones WHERE empresa_id=? AND proveedor_id=? AND archivo_sha256=? FOR UPDATE", [ctx.empresaId, ctx.proveedorId, sha]);
            if (existente)
                return { importacionId: Number(existente.id), existente: true, requiereReanudacion: true };
            const iid = await insert(c, "flota_cb2_importaciones", { empresa_id: ctx.empresaId, proveedor_id: ctx.proveedorId, proveedor_nombre: String(p.nombre_comercial), perfil: entrada.perfil, version_contrato: 2, version_parser: 2, archivo_nombre: nombre, archivo_ruta: ruta, archivo_mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", archivo_tamano: buffer.length, archivo_sha256: sha, estado: "SOLO_EVIDENCIA", revision: 1, resumen_actual: "{}", creado_por: ctx.actor.id, creado_en: ahoraLocal(), actualizado_por: ctx.actor.id, actualizado_en: ahoraLocal() });
            nueva = true;
            const eventos = await resolver(c, ctx, lineas, entrada.seleccion, iid, 1, entrada.moneda);
            await proyectar(c, ctx, iid, 1, eventos);
            return { eventos: await diario(c, ctx, "CONFIRMAR", clave, request, eventos), repetida: false };
        });
        if (!nueva)
            await storage.compensar(ctx.empresaId, ruta);
        return resultado;
    }
    catch (e) {
        if (!(e instanceof ErrorCB2 && e.incierto))
            await storage.compensar(ctx.empresaId, ruta);
        throw e;
    }
}
async function cabecera(c: PoolConnection, ctx: Contexto, id: number, lock = false) {
    const [h] = await rows(c, `SELECT * FROM flota_cb2_importaciones WHERE empresa_id=? AND proveedor_id=? AND id=?${lock ? " FOR UPDATE" : ""}`, [ctx.empresaId, ctx.proveedorId, id]);
    if (!h)
        throw new ErrorCB2("Importacion no encontrada.", 404);
    return h;
}
async function originales(c: PoolConnection, ctx: Contexto, importacionId: number, lock = false) {
    // Sin paginacion: ninguna moneda ni aparicion original puede quedar fuera.
    return rows(c, `SELECT * FROM flota_cb2_filas WHERE empresa_id=? AND proveedor_id=? AND importacion_id=? AND tipo='ORIGEN' ORDER BY hoja_indice,fila_excel,id${lock ? " FOR UPDATE" : ""}`, [ctx.empresaId, ctx.proveedorId, importacionId]);
}
export async function reanudarArchivo(ctx: Contexto, op: {
    importacionId: number;
    revision: number;
    seleccion: Seleccion;
    clave: string;
    motivo: string;
}) {
    const request = digest(ctx, "REANUDAR", op);
    const conocido = await tx(ctx, async (c) => {
        const retry = await anterior(c, ctx, "REANUDAR", op.clave, request);
        return retry ? { eventos: retry, repetida: true } : null;
    });
    if (conocido)
        return conocido;
    // El archivo viene exclusivamente de la cabecera, nunca del cliente.
    const c = await getPool().getConnection();
    let h: RowDataPacket;
    let currency: "GTQ" | "USD";
    try {
        h = await cabecera(c, ctx, op.importacionId);
        currency = monedaOriginal(await originales(c, ctx, op.importacionId), ctx.empresaId, ctx.proveedorId, op.importacionId);
    }
    finally {
        c.release();
    }
    if (Number(h.version_contrato) !== 2 || ![1, 2].includes(Number(h.version_parser)))
        throw new ErrorCB2("Version de evidencia no soportada.");
    const buffer = await storage.leer(ctx.empresaId, String(h.archivo_ruta), String(h.archivo_sha256));
    const lineas = await analizar(buffer, h.perfil, currency, Number(h.version_parser) as 1 | 2);
    return tx(ctx, async (c) => {
        const retry = await anterior(c, ctx, "REANUDAR", op.clave, request);
        if (retry)
            return { eventos: retry, repetida: true };
        h = await cabecera(c, ctx, op.importacionId, true);
        if (Number(h.revision) !== op.revision)
            throw new ErrorCB2("Revision obsoleta.");
        const origenes = await originales(c, ctx, op.importacionId, true);
        if (monedaOriginal(origenes, ctx.empresaId, ctx.proveedorId, op.importacionId) !== currency)
            throw new ErrorCB2("Moneda original cambio durante la reanudacion.");
        if (origenes.length !== lineas.length)
            throw new ErrorCB2("Evidencia original incompleta.");
        const elegidas = new Set(op.seleccion.map(s => s.candidato));
        if (!elegidas.size)
            throw new ErrorCB2("Selecciona candidatos para reanudar.", 400);
        const eventos = await resolver(c, ctx, lineas, op.seleccion, op.importacionId, op.revision + 1, currency, origenes, op.motivo);
        await proyectar(c, ctx, op.importacionId, op.revision + 1, eventos);
        return { eventos: await diario(c, ctx, "REANUDAR", op.clave, request, eventos), repetida: false };
    });
}
async function resolver(c: PoolConnection, ctx: Contexto, lineas: Linea[], selection: Seleccion, iid: number, revision: number, currency: "GTQ" | "USD", origenes?: RowDataPacket[], motivo = "Confirmacion explicita") {
    const seleccion = new Map(selection.map(s => [s.candidato, s.vehiculoId]));
    for (const k of seleccion.keys())
        if (!lineas.some(l => l.clave === k))
            throw new ErrorCB2("Candidato no pertenece al archivo.", 400);
    // Leer toda la identidad/version, no solo la huella vigente. Historial C2B sin
    // identidad verificable no se promueve; cualquier coincidencia bloquea el grupo.
    const previos = new Map<string, RowDataPacket[]>(), historicos = new Set<string>();
    const claves = [...new Set(lineas.flatMap(l => l.clave ? [l.clave] : []))];
    for (let i = 0; i < claves.length; i += 200) {
        const keys = claves.slice(i, i + 200), placeholders = keys.map(() => "?").join(",");
        const antiguos = await rows(c, `SELECT f.clave_operacion FROM flota_combustible_conciliacion_filas f JOIN flota_combustible_conciliaciones h ON h.empresa_id=f.empresa_id AND h.id=f.conciliacion_id WHERE h.empresa_id=? AND h.proveedor_id=? AND h.perfil_parser='HALEL' AND f.clave_operacion IN (${placeholders})`, [ctx.empresaId, ctx.proveedorId, ...keys]);
        antiguos.forEach(r => historicos.add(r.clave_operacion));
        const consumes = await rows(c, `SELECT * FROM flota_cb2_consumos WHERE empresa_id=? AND proveedor_id=? AND (clave_candidata IN (${placeholders}) OR vale_norm IN (${placeholders})) ORDER BY id`, [ctx.empresaId, ctx.proveedorId, ...keys, ...keys.map(k => lineas.find(l => l.clave === k)!.fila.vale)]);
        consumes.forEach(r => { for (const key of keys)
            if (r.clave_candidata === key || r.vale_norm === lineas.find(l => l.clave === key)!.fila.vale)
                previos.set(key, [...(previos.get(key) ?? []), r]); });
    }
    // No crear documentos para grupos que ya estan bloqueados por otra operacion.
    for (const l of lineas)
        if (l.clave && seleccion.has(l.clave)) {
            const prev = previos.get(l.clave) ?? [];
            if (prev.length > 1 || prev.some(p => Number(p.version_clave) !== 1 || Number(p.version_huella) !== 1 || p.payload_operacion !== l.payload || p.huella_operacion !== l.huella || Number(p.vehiculo_id) !== seleccion.get(l.clave!)))
                l.bloqueada = true;
        }
    const existentes = new Map<number, RowDataPacket>();
    const documentosIds = new Set<number>([...previos.values()].flat().filter(p => p.factura_id !== null).map(p => Number(p.factura_id)));
    for (const l of lineas)
        if (l.documento && l.clave && seleccion.has(l.clave)) {
            const [d] = await rows(c, "SELECT id FROM flota_cb2_facturas WHERE empresa_id=? AND proveedor_id=? AND serie_norm=? AND numero_norm=?", [ctx.empresaId, ctx.proveedorId, l.documento.serie.normalize("NFC").trim().replace(/\s+/g, " ").toUpperCase(), l.documento.numero.normalize("NFC").trim().replace(/\s+/g, " ").toUpperCase()]);
            if (d)
                documentosIds.add(Number(d.id));
        }
    for (const id of [...documentosIds].sort((a, b) => a - b)) {
        const [d] = await rows(c, "SELECT * FROM flota_cb2_facturas WHERE empresa_id=? AND proveedor_id=? AND id=? FOR UPDATE", [ctx.empresaId, ctx.proveedorId, id]);
        if (!d)
            throw new ErrorCB2("Documento previo no certificable.");
        existentes.set(id, d);
    }
    for (const l of lineas)
        if (l.clave && l.documento) {
            const d = l.documento, prev = previos.get(l.clave) ?? [];
            if (prev.some(p => p.factura_id !== null && (() => { const f = existentes.get(Number(p.factura_id))!; return f.serie_norm !== d.serie.normalize("NFC").trim().replace(/\s+/g, " ").toUpperCase() || f.numero_norm !== d.numero.normalize("NFC").trim().replace(/\s+/g, " ").toUpperCase() || f.moneda !== d.moneda; })()))
                l.bloqueada = true;
        }
    const docs = new Map<string, number>();
    for (const l of lineas.filter(l => l.clave && seleccion.has(l.clave) && !l.bloqueada && !historicos.has(l.clave) && l.documento).sort((a, b) => JSON.stringify(a.documento).localeCompare(JSON.stringify(b.documento)))) {
        const key = JSON.stringify(l.documento);
        if (!docs.has(key))
            docs.set(key, await factura(c, ctx, l.documento!));
    }
    const abreviadas = await catalogoAbreviadas(c, ctx, lineas.filter(l => l.clave && seleccion.has(l.clave) && !l.bloqueada).map(l => l.fila.placaNormalizada));
    const unidades = await vehiculos(c, ctx, selection.map(s => s.vehiculoId));
    const ids = [...new Set([...previos.values()].flat().map(r => Number(r.id)))].sort((a, b) => a - b);
    for (const id of ids)
        await rows(c, "SELECT id FROM flota_cb2_consumos WHERE empresa_id=? AND proveedor_id=? AND id=? FOR UPDATE", [ctx.empresaId, ctx.proveedorId, id]);
    const res = new Map<string, {
        id: number;
        resultado: string;
        factura: number | null;
    }>(), eventos: Evento[] = [];
    for (const l of lineas) {
        if (origenes && (!l.clave || !seleccion.has(l.clave)))
            continue;
        const f = l.fila, original = origenes?.find(o => Number(o.hoja_indice) === l.hoja && Number(o.fila_excel) === f.fila);
        if (origenes && (!original || JSON.stringify(JSON.parse(original.datos_origen)) !== JSON.stringify(f)))
            throw new ErrorCB2("Original y archivo privado no coinciden.");
        let resultado = f.estado === "IGNORADA" ? "IGNORADA" : !l.clave ? "INVALIDA" : l.bloqueada ? "BLOQUEADA" : !seleccion.has(l.clave) ? "OMITIDA" : historicos.has(l.clave) ? "BLOQUEADA" : "CREADA";
        let cid: number | null = null;
        if (resultado === "CREADA" && l.clave) {
            const vehicle = seleccion.get(l.clave)!;
            if (esPlacaAbreviada(f.placaNormalizada)
                ? !placaCompatible(f.placaNormalizada, vehicle, abreviadas) || !placaCompatible(f.placaNormalizada, vehicle, [{ id: vehicle, placa: unidades.get(vehicle) ?? "" }])
                : !placaComparable(f.placaNormalizada) || placaComparable(unidades.get(vehicle) ?? "") !== placaComparable(f.placaNormalizada))
                throw new ErrorCB2("El vehiculo elegido no coincide con la placa original.");
            let resolved = res.get(l.clave);
            if (!resolved) {
                const previous = previos.get(l.clave) ?? [];
                const fid = l.documento ? docs.get(JSON.stringify(l.documento))! : null;
                if (previous.some(p => Number(p.version_clave) !== 1 || Number(p.version_huella) !== 1 || p.payload_operacion !== l.payload || p.huella_operacion !== l.huella || Number(p.vehiculo_id) !== vehicle || (p.factura_id !== null && fid !== null && Number(p.factura_id) !== fid)) || previous.length > 1) {
                    resultado = "BLOQUEADA";
                }
                else if (previous.length) {
                    resolved = { id: Number(previous[0].id), resultado: "REUTILIZADA", factura: previous[0].factura_id === null ? null : Number(previous[0].factura_id) };
                }
                else {
                    const id = await insert(c, "flota_cb2_consumos", { empresa_id: ctx.empresaId, proveedor_id: ctx.proveedorId, importacion_origen_id: iid, vehiculo_id: vehicle, factura_id: fid, fecha_consumo: f.fechaConsumo, numero_vale: f.textos.vale, vale_norm: f.vale, placa_original: f.placaOriginal, placa_normalizada: f.placaNormalizada, version_clave: 1, clave_candidata: l.clave, version_huella: 1, huella_operacion: l.huella, payload_operacion: l.payload, piloto_informado: f.pilotoInformado, producto: f.producto, galones: f.galones, precio: f.precio, monto: f.monto, kilometraje: f.kilometraje, kilometraje_texto: f.textos.km || null, galones_calculados: f.galonesCalculados, moneda: JSON.parse(l.payload!)[11], creado_por: ctx.actor.id, creado_en: ahoraLocal(), factura_asociada_por: fid ? ctx.actor.id : null, factura_asociada_en: fid ? ahoraLocal() : null });
                    resolved = { id, resultado: "CREADA", factura: fid };
                }
                if (resolved)
                    res.set(l.clave, resolved);
            }
            else
                resolved = { ...resolved, resultado: "REUTILIZADA" };
            if (resolved) {
                cid = resolved.id;
                resultado = resolved.resultado;
            }
        }
        eventos.push({ importacion_id: iid, revision, tipo: origenes ? "RESOLUCION" : "ORIGEN", origen_fila_id: original ? Number(original.id) : null, hoja_indice: l.hoja, hoja_nombre: f.hoja, fila_excel: f.fila, resultado, consumo_id: cid, datos_origen: origenes ? null : JSON.stringify(f), decision: JSON.stringify({ version: 1, moneda: currency, candidato: l.clave, vehiculoId: l.clave ? seleccion.get(l.clave) ?? null : null, errores: l.errores }), motivo });
    }
    return eventos;
}
async function proyectar(c: PoolConnection, ctx: Contexto, iid: number, revision: number, eventos: Evento[]) {
    const anteriores = await rows(c, "SELECT * FROM flota_cb2_filas WHERE empresa_id=? AND proveedor_id=? AND importacion_id=? ORDER BY revision,id", [ctx.empresaId, ctx.proveedorId, iid]);
    const posiciones = new Map<string, {
        resultado: string;
        consumo_id: unknown;
    }>();
    for (const e of [...anteriores, ...eventos])
        if (e.tipo !== "ASOCIACION_FACTURA")
            posiciones.set(`${e.hoja_indice}:${e.fila_excel}`, { resultado: String(e.resultado), consumo_id: e.consumo_id });
    const values = [...posiciones.values()], consumos = new Set(values.filter(e => e.consumo_id !== null).map(e => e.consumo_id)), pendientes = values.filter(e => !["IGNORADA", "CREADA", "REUTILIZADA"].includes(e.resultado)).length;
    const estado = !consumos.size ? "SOLO_EVIDENCIA" : pendientes ? "PARCIAL" : "COMPLETA";
    await c.execute("UPDATE flota_cb2_importaciones SET revision=?,estado=?,resumen_actual=?,actualizado_por=?,actualizado_en=? WHERE empresa_id=? AND proveedor_id=? AND id=?", [revision, estado, JSON.stringify({ consumos: consumos.size, pendientes, apariciones: values.length }), ctx.actor.id, ahoraLocal(), ctx.empresaId, ctx.proveedorId, iid]);
}
export async function asociarFactura(ctx: Contexto, op: {
    clave: string;
    documento: Documento;
    consumos: number[];
    revisiones: {
        id: number;
        revision: number;
    }[];
    motivo: string;
}) {
    const request = digest(ctx, "ASOCIAR_FACTURA", op);
    return tx(ctx, async (c) => {
        const retry = await anterior(c, ctx, "ASOCIAR_FACTURA", op.clave, request);
        if (retry)
            return { eventos: retry, repetida: true };
        const consumos: RowDataPacket[] = [];
        for (const id of op.consumos) {
            const [r] = await rows(c, "SELECT id,importacion_origen_id FROM flota_cb2_consumos WHERE empresa_id=? AND proveedor_id=? AND id=?", [ctx.empresaId, ctx.proveedorId, id]);
            if (!r)
                throw new ErrorCB2("Consumo no encontrado en este proveedor.", 404);
            consumos.push(r);
        }
        const iids = [...new Set(consumos.map(r => Number(r.importacion_origen_id)))].sort((a, b) => a - b), revisiones = new Map(op.revisiones.map(r => [r.id, r.revision]));
        if (iids.length !== revisiones.size)
            throw new ErrorCB2("Revisiones no corresponden al lote.");
        for (const iid of iids) {
            const h = await cabecera(c, ctx, iid, true);
            if (Number(h.revision) !== revisiones.get(iid))
                throw new ErrorCB2("Revision obsoleta.");
        }
        const fid = await factura(c, ctx, op.documento), eventos: Evento[] = [];
        for (const item of consumos) {
            const [r] = await rows(c, "SELECT * FROM flota_cb2_consumos WHERE empresa_id=? AND proveedor_id=? AND id=? FOR UPDATE", [ctx.empresaId, ctx.proveedorId, item.id]);
            if (r.moneda !== op.documento.moneda || (r.factura_id !== null && Number(r.factura_id) !== fid))
                throw new ErrorCB2("Moneda o factura incompatible; lote revertido.");
            const [o] = await rows(c, "SELECT o.* FROM flota_cb2_filas o JOIN flota_cb2_filas e ON e.empresa_id=o.empresa_id AND e.proveedor_id=o.proveedor_id AND e.importacion_id=o.importacion_id AND COALESCE(e.origen_fila_id,e.id)=o.id WHERE e.empresa_id=? AND e.proveedor_id=? AND e.importacion_id=? AND e.consumo_id=? AND o.tipo='ORIGEN' ORDER BY o.id LIMIT 1", [ctx.empresaId, ctx.proveedorId, r.importacion_origen_id, r.id]);
            if (!o)
                throw new ErrorCB2("Consumo sin ORIGEN certificable.");
            if (r.factura_id === null)
                await c.execute("UPDATE flota_cb2_consumos SET factura_id=?,factura_asociada_por=?,factura_asociada_en=? WHERE empresa_id=? AND proveedor_id=? AND id=?", [fid, ctx.actor.id, ahoraLocal(), ctx.empresaId, ctx.proveedorId, r.id]);
            eventos.push({ importacion_id: Number(r.importacion_origen_id), revision: revisiones.get(Number(r.importacion_origen_id))! + 1, tipo: "ASOCIACION_FACTURA", origen_fila_id: Number(o.id), hoja_indice: o.hoja_indice, hoja_nombre: o.hoja_nombre, fila_excel: o.fila_excel, resultado: r.factura_id === null ? "FACTURA_ASOCIADA" : "SIN_CAMBIO", consumo_id: Number(r.id), factura_anterior_id: r.factura_id === null ? null : fid, factura_nueva_id: fid, datos_origen: null, decision: JSON.stringify({ version: 1, documento: op.documento }), motivo: op.motivo });
        }
        for (const iid of iids)
            await proyectar(c, ctx, iid, revisiones.get(iid)! + 1, eventos.filter(e => e.importacion_id === iid));
        return { eventos: await diario(c, ctx, "ASOCIAR_FACTURA", op.clave, request, eventos), repetida: false };
    });
}
export type FiltrosCB2 = { proveedorId?: number; estado?: string; desde?: string; hasta?: string; buscar?: string };
export async function consultar(empresa: number, tipo: "importaciones" | "consumos" | "facturas" | "filas", importacion?: number, limite = 100, despues = 0, filtros: FiltrosCB2 = {}) {
    const c = await getPool().getConnection();
    try {
        const table = { importaciones: "flota_cb2_importaciones", consumos: "flota_cb2_consumos", facturas: "flota_cb2_facturas", filas: "flota_cb2_filas" }[tipo];
        const columns = tipo === "importaciones" ? "id,proveedor_id,proveedor_nombre,perfil,archivo_nombre,archivo_sha256,estado,revision,resumen_actual,creado_en" : tipo === "filas" ? "id,importacion_id,revision,tipo,origen_fila_id,consumo_id,hoja_nombre,fila_excel,resultado,datos_origen,decision,motivo,operacion_clave,creado_en" : "*";
        const where = ["empresa_id=?", "id>?"]; const args: (string|number)[] = [empresa, despues];
        if (importacion && tipo === "filas") { where.push("importacion_id=?"); args.push(importacion); }
        if (filtros.proveedorId) { where.push("proveedor_id=?"); args.push(filtros.proveedorId); }
        if (filtros.estado && (tipo === "consumos" || tipo === "importaciones")) { where.push(`${tipo === "consumos" ? "estado_factura" : "estado"}=?`); args.push(filtros.estado); }
        if (tipo === "consumos") for (const [op, value] of [[">=", filtros.desde],["<=", filtros.hasta]]) if (value) {where.push(`fecha_consumo ${op} ?`);args.push(value);}
        if (filtros.buscar && tipo !== "filas") {
            const campos = tipo === "consumos" ? ["vale_norm","placa_normalizada"] : tipo === "facturas" ? ["serie_norm","numero_norm"] : ["archivo_nombre","proveedor_nombre"];
            where.push(`(${campos.map(c => `LOCATE(UPPER(?),UPPER(${c}))>0`).join(" OR ")})`);
            args.push(...campos.map(() => filtros.buscar!));
        }
        return await rows(c, `SELECT ${columns} FROM ${table} WHERE ${where.join(" AND ")} ORDER BY id LIMIT ?`, [...args, limite]);
    }
    finally {
        c.release();
    }
}
export async function archivo(empresa: number, id: number) {
    const c = await getPool().getConnection();
    try {
        const [h] = await rows(c, "SELECT archivo_ruta,archivo_sha256,archivo_nombre FROM flota_cb2_importaciones WHERE empresa_id=? AND id=?", [empresa, id]);
        if (!h)
            throw new ErrorCB2("Importacion no encontrada.", 404);
        return { buffer: await storage.leer(empresa, h.archivo_ruta, h.archivo_sha256), nombre: h.archivo_nombre };
    }
    finally {
        c.release();
    }
}
