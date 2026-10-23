import DecimalJS from "decimal.js";
const Decimal = DecimalJS.clone({ precision: 48, rounding: DecimalJS.ROUND_HALF_UP });
import { buscarCoincidencias, placaComparable } from "@/lib/flota/combustible-coincidencias";
import type { CatalogosCB2, FilaCB2 } from "./client";
export const estadosPreview = ["PENDIENTE", "BLOQUEADO", "ADVERTENCIA", "LISTO", "IGNORADO", "RESUELTO"] as const;
export function coincidencias(f: FilaCB2, cat: CatalogosCB2) {
    const placa = placaComparable(f.placaNormalizada || f.placa);
    return placa ? cat.vehiculos.filter(v => placaComparable(v.placa) === placa) : [];
}
export function sugerenciaVehiculo(f: FilaCB2, cat: CatalogosCB2) { return buscarCoincidencias(f.placaNormalizada || f.placa, cat.vehiculos, v => v.placa, "placa"); }
export function sugerenciaPiloto(f: FilaCB2, cat: CatalogosCB2) { return buscarCoincidencias(f.origen?.piloto ?? "", cat.pilotos ?? [], v => v.nombre, "piloto"); }
export function asignacionesExactas(filas: FilaCB2[], cat: CatalogosCB2) {
    const seleccion: Record<string, string> = {};
    for (const f of filas) { const m = coincidencias(f, cat); if (elegible(f) && m.length === 1) seleccion[f.candidato!] = String(m[0].id); }
    return seleccionSegura(filas, cat, seleccion);
}
export function elegible(f: FilaCB2) { return !!f.candidato && !f.bloqueada && !["IGNORADA", "RESUELTA"].includes(f.estado); }
export function seleccionSegura(filas: FilaCB2[], cat: CatalogosCB2, seleccion: Record<string, string>) {
    const result: Record<string, string> = {};
    const grupos = new Map<string, FilaCB2[]>(), unidades = new Set(cat.vehiculos.map(v => String(v.id)));
    for (const f of filas) if (f.candidato && !["RESUELTA", "IGNORADA"].includes(f.estado)) {
        const group = grupos.get(f.candidato) ?? []; group.push(f); grupos.set(f.candidato, group);
    }
    for (const [key, value] of Object.entries(seleccion)) {
        const originales = grupos.get(key) ?? [];
        if (value && originales.length && originales.every(elegible) && unidades.has(value)) result[key] = value;
    }
    return result;
}
export function estadoVisual(f: FilaCB2, seleccion: Record<string, string>) {
    if (f.estado === "IGNORADA") return "IGNORADO";
    if (f.estado === "RESUELTA") return "RESUELTO";
    if (!elegible(f)) return "BLOQUEADO";
    if (!seleccion[f.candidato!]) return "PENDIENTE";
    return f.motivos.length || f.errores.length ? "ADVERTENCIA" : "LISTO";
}
export function diferencia(f: FilaCB2) {
    const valid = (v: string | null) => v !== null && /^\d+(\.\d+)?$/.test(v) && new Decimal(v).gt(0);
    if (![f.galones, f.precio, f.monto].every(valid)) return null;
    const calculado = new Decimal(f.galones!).mul(f.precio!), delta = calculado.sub(f.monto!);
    return { calculado: calculado.toFixed(), diferencia: delta.toFixed(), advertencia: delta.abs().gt("0.01") };
}
export function avisos(f: FilaCB2): string[] {
    const valor = (v: string | undefined) => v?.trim() ? `«${v}»` : "no informado";
    const impacto = f.bloqueada ? "El servidor bloquea esta aparición; no se puede confirmar." : "Advertencia: no bloquea por sí sola; revisa antes de confirmar.";
    return [...new Set([...f.motivos, ...f.errores])].map(m => {
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
export function resumenPreview(filas: FilaCB2[], cat: CatalogosCB2, seleccion: Record<string, string>) {
    const segura = seleccionSegura(filas, cat, seleccion), grupos = new Map<string, FilaCB2[]>();
    filas.forEach(f => { if (f.candidato && f.estado !== "IGNORADA") { const grupo = grupos.get(f.candidato) ?? []; grupo.push(f); grupos.set(f.candidato, grupo); } });
    const gruposValidos = [...grupos.values()];
    const cantidades = { detectados: grupos.size, listos: 0, pendientes: 0, advertencias: 0, bloqueados: 0, resueltos: 0, sinIdentidad: filas.filter(f => !f.candidato && f.estado !== "IGNORADA").length, ignoradas: filas.filter(f => f.estado === "IGNORADA").length };
    const totales: Record<string, string> = {};
    for (const grupo of gruposValidos) {
        if (grupo.every(g => g.estado === "RESUELTA")) { cantidades.resueltos++; continue; }
        const activas = grupo.filter(g => g.estado !== "RESUELTA"), f = activas[0], bloqueado = activas.some(g => !elegible(g));
        if (bloqueado) { cantidades.bloqueados++; continue; }
        const warning = activas.some(g => g.motivos.length || g.errores.length);
        if (warning) cantidades.advertencias++;
        if (!segura[f.candidato!]) cantidades.pendientes++;
        else if (!warning) cantidades.listos++;
        // Never aggregate inconsistent duplicates or invent absent amounts.
        if (activas.every(g => g.monto === f.monto && g.moneda === f.moneda) && f.monto && /^\d+(\.\d+)?$/.test(f.monto) && new Decimal(f.monto).gt(0))
            totales[f.moneda] = new Decimal(totales[f.moneda] ?? 0).add(f.monto).toFixed();
    }
    return { ...cantidades, totales, segura };
}
