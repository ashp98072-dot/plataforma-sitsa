import { clasificarProducto } from "@/lib/flota/cb2/clasificacion";
import type { DecisionAsignacion } from "./asignacion";
import DecimalJS from "decimal.js";
const Decimal = DecimalJS.clone({ precision: 48, rounding: DecimalJS.ROUND_HALF_UP });
import { buscarCoincidencias, identificarPlaca, placaCompatible } from "@/lib/flota/combustible-coincidencias";
import type { CatalogosCB2, FilaCB2 } from "./client";
export const estadosPreview = ["LISTO", "PENDIENTE", "BLOQUEADO", "RESUELTO", "IGNORADO"] as const;
export function coincidencias(f: FilaCB2, cat: CatalogosCB2) {
    return identificarPlaca(f.placaNormalizada || f.placa, cat.vehiculos, v => v.placa).candidatos;
}
export function sugerenciaVehiculo(f: FilaCB2, cat: CatalogosCB2) { return buscarCoincidencias(f.placaNormalizada || f.placa, cat.vehiculos, v => v.placa, "placa"); }
export function sugerenciaPiloto(f: FilaCB2, cat: CatalogosCB2) { return buscarCoincidencias(f.origen?.piloto ?? "", cat.pilotos ?? [], v => v.nombre, "piloto"); }
export function asignacionesExactas(filas: FilaCB2[], cat: CatalogosCB2) {
    const seleccion: Record<string, string> = {};
    for (const grupo of agruparCandidatos(filas).values()) {
        const activas = grupo.filter(f => f.estado !== "RESUELTA"), ids = activas.map(f => { const m = coincidencias(f, cat); return elegible(f) && m.length === 1 ? String(m[0].id) : ""; });
        if (ids.length && ids.every(id => id && id === ids[0])) seleccion[activas[0].candidato!] = ids[0];
    }
    return seleccionSegura(filas, cat, seleccion);
}
export function agruparCandidatos(filas: FilaCB2[]) {
    const grupos = new Map<string, FilaCB2[]>();
    for (const f of filas) if (f.candidato && f.estado !== "IGNORADA") { const grupo = grupos.get(f.candidato) ?? []; grupo.push(f); grupos.set(f.candidato, grupo); }
    return grupos;
}
export function elegible(f: FilaCB2) { return !!f.candidato && !f.bloqueada && !["IGNORADA", "RESUELTA"].includes(f.estado); }
type Decisiones = Record<string, DecisionAsignacion>;
export function seleccionSegura(filas: FilaCB2[], cat: CatalogosCB2, seleccion: Record<string, string>, omitidos: Record<string, boolean> = {}, decisiones: Decisiones = {}) {
    const result: Record<string, string> = {};
    const grupos = new Map<string, FilaCB2[]>(), unidades = new Set(cat.vehiculos.map(v => String(v.id)));
    for (const f of filas) if (f.candidato && !["RESUELTA", "IGNORADA"].includes(f.estado)) {
        const group = grupos.get(f.candidato) ?? []; group.push(f); grupos.set(f.candidato, group);
    }
    for (const [key, value] of Object.entries(seleccion)) {
        const originales = grupos.get(key) ?? [];
        const motivo = decisiones[key]?.motivoUnidad?.trim() ?? "";
        if (!omitidos[key] && value && (!motivo || motivo.length >= 10) && originales.length && originales.every(f => elegible(f) && (!decisiones[key]?.exigirProducto || !!(decisiones[key]?.productoClasificado ?? clasificarProducto(f.origen?.producto))) && (!decisiones[key]?.empleadoId || !!cat.empleados?.some(e => e.id === decisiones[key].empleadoId)) && (placaCompatible(f.placaNormalizada || f.placa, Number(value), cat.vehiculos) || motivo.length >= 10)) && unidades.has(value)) result[key] = value;
    }
    return result;
}
export function estadoVisual(f: FilaCB2, seleccion: Record<string, string>) {
    if (f.estado === "IGNORADA") return "IGNORADO";
    if (f.estado === "RESUELTA") return "RESUELTO";
    if (!elegible(f)) return "BLOQUEADO";
    if (!seleccion[f.candidato!]) return "PENDIENTE";
    return "LISTO";
}
export type NivelAviso = "INFORMATIVA" | "REVISION" | "BLOQUEO";
export function nivelAviso(f: FilaCB2, motivo: string): NivelAviso {
    if (["Piloto sin determinar", "Serie/factura incompleta", "serie", "factura"].includes(motivo)) return "INFORMATIVA";
    if (["Producto no informado", "Kilometraje conservado como texto"].includes(motivo) || motivo.startsWith("Galones × precio") || motivo.startsWith("Fecha fuera del mes")) return "REVISION";
    return f.bloqueada ? "BLOQUEO" : "REVISION";
}
export function diferencia(f: FilaCB2) {
    const valid = (v: string | null) => v !== null && /^\d+(\.\d+)?$/.test(v) && new Decimal(v).gt(0);
    if (![f.galones, f.precio, f.monto].every(valid)) return null;
    const calculado = new Decimal(f.galones!).mul(f.precio!), delta = calculado.sub(f.monto!);
    return { calculado: calculado.toFixed(), diferencia: delta.toFixed(), advertencia: delta.abs().gt("0.01") };
}
export function avisos(f: FilaCB2): string[] {
    const valor = (v: string | undefined) => v?.trim() ? `«${v}»` : "no informado";
    return [...new Set([...f.motivos, ...f.errores])].map(m => {
        const nivel = nivelAviso(f, m);
        const impacto = nivel === "BLOQUEO" ? "El servidor bloquea esta aparición; no se puede confirmar." : nivel === "INFORMATIVA" ? "Información: no bloquea por sí sola ni asocia un piloto al catálogo." : "Advertencia: no bloquea por sí sola; revisa antes de confirmar.";
        if (m === "Producto no informado") return `Producto ${valor(f.origen?.producto)}: el archivo no identifica claramente el tipo de combustible. Verifica con el proveedor; no se asume diésel, regular ni superior. ${impacto}`;
        if (m === "Kilometraje conservado como texto") return `Kilometraje original ${valor(f.origen?.km)}: ${f.kilometraje ? `interpretado como ${f.kilometraje}` : "no interpretable como kilometraje numérico con la precisión admitida"}. Revisa el dato con el proveedor; el texto original se conserva. ${impacto}`;
        if (m.startsWith("Galones × precio")) {
            const d = diferencia(f);
            return d ? `Galones ${f.galones} × precio ${f.moneda} ${f.precio} = ${f.moneda} ${d.calculado}; monto del Excel ${f.moneda} ${f.monto}; diferencia (calculado − Excel) ${f.moneda} ${d.diferencia}. Supera la tolerancia de 0.01. Revisa redondeo o precio con el proveedor; no se corrigen valores. ${impacto}` : `No se puede calcular la diferencia: faltan valores numéricos válidos. Galones ${valor(f.origen?.galones)}, precio ${valor(f.origen?.precio)}, monto ${valor(f.origen?.monto)}. Revisa el archivo; no se inventan importes. ${impacto}`;
        }
        const campos: Record<string, string> = { fecha: "fecha", vale: "vale", placa: "placa", piloto: "piloto", galones: "galones", precio: "precio", monto: "monto", serie: "serie", factura: "factura", km: "km", producto: "producto", lote: "lote" };
        const campo = campos[m.split(":")[0]];
        const original = campo ? ` Valor original de ${campo}: ${valor(f.origen?.[campo as keyof NonNullable<FilaCB2["origen"]>])}.` : "";
        return `${m}.${original} Revisa la evidencia original y corrige el archivo o la asignación cuando corresponda. ${impacto}`;
    });
}
export function avisosDetallados(f: FilaCB2) {
    const motivos = [...new Set([...f.motivos, ...f.errores])], mensajes = avisos(f);
    return motivos.map((m, i) => ({ nivel: nivelAviso(f, m), mensaje: mensajes[i] }));
}
export function revisionCandidatos(filas: FilaCB2[], cat: CatalogosCB2, seleccion: Record<string, string>, omitidos: Record<string, boolean> = {}, revisados: Record<string, boolean> = {}, decisiones: Decisiones = {}) {
    const asignadas = seleccionSegura(filas, cat, seleccion, {}, decisiones);
    return [...agruparCandidatos(filas)].map(([clave, apariciones]) => {
        const activas = apariciones.filter(f => f.estado !== "RESUELTA"), resuelto = !activas.length;
        const bloqueado = !resuelto && activas.some(f => !elegible(f));
        const unidadValida = !bloqueado && !resuelto && !!asignadas[clave];
        const estado = resuelto ? "RESUELTO" : bloqueado ? "BLOQUEADO" : unidadValida ? "LISTO" : "PENDIENTE";
        const conAdvertencias = activas.some(f => f.motivos.length || f.errores.length);
        return { clave, apariciones, activas, fila: activas[0] ?? apariciones[0], estado, unidadValida, seleccionado: unidadValida && !omitidos[clave], conAdvertencias, advertenciasPendientes: conAdvertencias && !revisados[clave], vehiculoId: seleccion[clave] ?? "" };
    });
}
export type CandidatoRevision = ReturnType<typeof revisionCandidatos>[number];
export function resumenPreview(filas: FilaCB2[], cat: CatalogosCB2, seleccion: Record<string, string>, omitidos: Record<string, boolean> = {}, revisados: Record<string, boolean> = {}, decisiones: Decisiones = {}) {
    return resumirRevision(filas, cat, seleccion, omitidos, revisados, decisiones);
}
export function resumirRevision(filas: FilaCB2[], cat: CatalogosCB2, seleccion: Record<string, string>, omitidos: Record<string, boolean> = {}, revisados: Record<string, boolean> = {}, decisiones: Decisiones = {}) {
    const segura = seleccionSegura(filas, cat, seleccion, omitidos, decisiones), revision = revisionCandidatos(filas, cat, seleccion, omitidos, revisados, decisiones);
    const cantidades = { detectados: revision.length, listos: revision.filter(g => g.estado === "LISTO").length, elegibles: revision.filter(g => g.unidadValida).length, seleccionados: Object.keys(segura).length, pendientes: revision.filter(g => g.estado === "PENDIENTE").length, advertencias: revision.filter(g => g.conAdvertencias).length, advertenciasPendientes: revision.filter(g => g.advertenciasPendientes).length, bloqueados: revision.filter(g => g.estado === "BLOQUEADO").length, resueltos: revision.filter(g => g.estado === "RESUELTO").length, sinIdentidad: filas.filter(f => !f.candidato && f.estado !== "IGNORADA").length, ignoradas: filas.filter(f => f.estado === "IGNORADA").length };
    const totales: Record<string, string> = {}, totalesSeleccionados: Record<string, string> = {};
    for (const { activas, fila: f, unidadValida, seleccionado } of revision) {
        if (!unidadValida) continue;
        // Never aggregate inconsistent duplicates or invent absent amounts.
        if (activas.every(g => g.monto === f.monto && g.moneda === f.moneda) && f.monto && /^\d+(\.\d+)?$/.test(f.monto) && new Decimal(f.monto).gt(0))
            { totales[f.moneda] = new Decimal(totales[f.moneda] ?? 0).add(f.monto).toFixed(); if (seleccionado) totalesSeleccionados[f.moneda] = new Decimal(totalesSeleccionados[f.moneda] ?? 0).add(f.monto).toFixed(); }
    }
    return { ...cantidades, totales, totalesSeleccionados, segura, revision };
}
