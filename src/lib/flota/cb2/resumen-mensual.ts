import DecimalJS from "decimal.js";
const Decimal = DecimalJS.clone({ precision: 48, rounding: DecimalJS.ROUND_HALF_UP });
import { query } from "@/lib/db";
import type { RowDataPacket } from "mysql2";
import { rangoMes } from "@/lib/rrhh/resumen-mensual";
import { normalizarVale } from "../combustible-conciliacion";
export type OperacionResumen = { id: number; origen: "HISTORICO" | "CB2"; vehiculo_id: number; placa: string; proveedor_id: number | null; numero_vale: string | null; fecha_consumo: string | null; creado_at: string; galones: string; precio: string | null; monto: string; moneda: string; combustible: string };
function identidad(r: OperacionResumen) {
    return r.proveedor_id && r.numero_vale?.trim() && r.fecha_consumo ? JSON.stringify([r.proveedor_id,r.vehiculo_id,normalizarVale(r.numero_vale),r.fecha_consumo.slice(0,10)]) : null;
}
function firma(r: OperacionResumen) {
    if (!r.proveedor_id || !r.numero_vale?.trim() || !r.fecha_consumo || !r.precio || r.moneda !== "GTQ") return null;
    return JSON.stringify([r.proveedor_id, r.vehiculo_id, normalizarVale(r.numero_vale), r.fecha_consumo.slice(0, 10), new Decimal(r.galones).toFixed(), new Decimal(r.precio).toFixed(), new Decimal(r.monto).toFixed()]);
}
/**
 * Presentación en [desde, hasta): HISTORICO por fecha de registro (creado_at),
 * CB2 por fecha de consumo. No traslada registros históricos a otro mes.
 * Firmas, ambigüedades y totales comparten el mismo universo temporal: una
 * exclusión solo sustituye CB2 por un histórico que contribuye a este período.
 * Las operaciones recibidas pertenecen a una sola empresa (resumenIntegrado).
 */
export function consolidarMes(operaciones: OperacionResumen[], desde: string, hasta: string) {
    const delPeriodo = operaciones.filter(r => {
        const corte = r.origen === "HISTORICO" ? r.creado_at : r.fecha_consumo;
        return !!corte && corte.slice(0, 10) >= desde && corte.slice(0, 10) < hasta;
    });
    const firmas = new Map<string, OperacionResumen[]>();
    const identidadesHistoricas = new Set(delPeriodo.filter(o => o.origen === "HISTORICO").map(identidad).filter((s): s is string => s !== null));
    for (const op of delPeriodo) { const f = firma(op); if (f) firmas.set(f, [...(firmas.get(f) ?? []), op]); }
    const excluidas: { consumoId: number; cargaId: number; firma: string }[] = [], ambiguas: number[] = [];
    const grupos = new Map<string, { origen: string; vehiculoId: number; placa: string; combustible: string; moneda: string; galones: string; monto: string; operaciones: number }>();
    const subtotales: Record<string, { galones: string; monto: string }> = {};
    for (const r of delPeriodo) {
        const key = firma(r), iguales = key ? firmas.get(key)! : [], historicos = iguales.filter(o => o.origen === "HISTORICO"), cb2 = iguales.filter(o => o.origen === "CB2");
        if (r.origen === "CB2" && historicos.length === 1 && cb2.length === 1) { excluidas.push({ consumoId: r.id, cargaId: historicos[0].id, firma: key! }); continue; }
        if (r.origen === "CB2" && (historicos.length || identidadesHistoricas.has(identidad(r) ?? ""))) ambiguas.push(r.id);
        const k = JSON.stringify([r.origen, r.vehiculo_id, r.combustible, r.moneda]);
        const g = grupos.get(k) ?? { origen: r.origen, vehiculoId: r.vehiculo_id, placa: r.placa, combustible: r.combustible, moneda: r.moneda, galones: "0", monto: "0", operaciones: 0 };
        g.galones = new Decimal(g.galones).add(r.galones).toFixed(); g.monto = new Decimal(g.monto).add(r.monto).toFixed(); g.operaciones++; grupos.set(k, g);
        const subtotal = subtotales[`${r.origen}:${r.moneda}`] ?? { galones: "0", monto: "0" };
        subtotal.galones = new Decimal(subtotal.galones).add(r.galones).toFixed(); subtotal.monto = new Decimal(subtotal.monto).add(r.monto).toFixed(); subtotales[`${r.origen}:${r.moneda}`] = subtotal;
    }
    const totalGTQ = [...grupos.values()].filter(g => g.moneda === "GTQ").reduce((a, g) => ({ galones: new Decimal(a.galones).add(g.galones).toFixed(), monto: new Decimal(a.monto).add(g.monto).toFixed() }), { galones: "0", monto: "0" });
    return { grupos: [...grupos.values()], subtotales, totalGTQ, excluidas, ambiguas, provisional: ambiguas.length > 0 };
}
export async function resumenIntegrado(empresa: number, mes: string) {
    const [desde, hasta] = rangoMes(mes);
    const historicos = await query<RowDataPacket[]>(`SELECT c.id,c.vehiculo_id,v.placa,c.proveedor_id,c.numero_vale,c.fecha_consumo,c.creado_at,c.galones,c.precio_galon AS precio,c.monto,c.tipo_combustible FROM flota_combustible_cargas c JOIN flota_vehiculos v ON v.id=c.vehiculo_id WHERE c.empresa_id=? AND c.estado='APROBADO' AND ((c.creado_at>=? AND c.creado_at<?) OR (c.fecha_consumo>=? AND c.fecha_consumo<?))`, [empresa, desde, hasta, desde, hasta]);
    const consumos = await query<RowDataPacket[]>(`SELECT c.id,c.vehiculo_id,v.placa,c.proveedor_id,c.numero_vale,c.fecha_consumo,c.creado_en AS creado_at,c.galones,c.precio,c.monto,c.moneda,c.producto,c.producto_clasificado FROM flota_cb2_consumos c JOIN flota_vehiculos v ON v.id=c.vehiculo_id WHERE c.empresa_id=? AND c.fecha_consumo>=? AND c.fecha_consumo<?`, [empresa, desde, hasta]);
    const dia = (v: unknown) => v instanceof Date ? `${v.getFullYear()}-${String(v.getMonth()+1).padStart(2,"0")}-${String(v.getDate()).padStart(2,"0")}` : String(v ?? "").slice(0,10);
    const ops = (rows: RowDataPacket[], origen: OperacionResumen["origen"]) => rows.map(r => ({ ...r, id: Number(r.id), vehiculo_id: Number(r.vehiculo_id), placa: String(r.placa), proveedor_id: r.proveedor_id == null ? null : Number(r.proveedor_id), numero_vale: r.numero_vale == null ? null : String(r.numero_vale), fecha_consumo: r.fecha_consumo == null ? null : dia(r.fecha_consumo), creado_at: dia(r.creado_at), galones: String(r.galones), precio: r.precio == null ? null : String(r.precio), monto: String(r.monto), moneda: origen === "HISTORICO" ? "GTQ" : String(r.moneda), combustible: origen === "HISTORICO" ? r.tipo_combustible === "gasolina" ? "GASOLINA_HISTORICA_SIN_VARIANTE" : r.tipo_combustible === "diesel" ? "DIESEL" : "NO_DETERMINADO" : r.producto_clasificado ?? "NO_DETERMINADO", origen } satisfies OperacionResumen));
    return consolidarMes([...ops(historicos, "HISTORICO"), ...ops(consumos, "CB2")], desde, hasta);
}
