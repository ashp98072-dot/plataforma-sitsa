import { describe, expect, it } from "vitest";
import {
  agregarLineaDescarga,
  agruparLineas,
  aEntradaServidor,
  calcularLineasFactura,
  desagruparLinea,
  descripcionSugerida,
  esRetencionIvaValida,
  firmaLineasFactura,
  lineasPorDefecto,
  moverLinea,
  quitarViajeDeLineas,
  valorLinea,
  viajesSinLinea,
  type LineaFacturaEntrada,
  type ViajeBaseLinea,
} from "./lineas-factura";

const V = (planId: number, over: Partial<ViajeBaseLinea> = {}): ViajeBaseLinea => ({
  planId, codigo: `V-${planId}`, fechaPlan: "2026-09-01", origen: "Bodega", destino: `Destino ${planId}`, montoAsignado: 100, precioIncluyeIva: true, ...over,
});
const L = (planIds: number[], over: Partial<LineaFacturaEntrada> = {}): LineaFacturaEntrada => ({
  planIds, cantidad: 1, descripcion: "Servicio", precioUnitario: 100, clasificacion: "SERVICIO", precioIncluyeIva: true, ...over,
});
let n = 0;
const clave = () => `k${++n}`;

describe("calcularLineasFactura — valor, IVA por línea y totales", () => {
  it("cantidad × precio unitario = valor; IVA incluido: 89.29 + 10.71 = 100.00", () => {
    const r = calcularLineasFactura({ lineas: [L([1])], planIdsFactura: [1] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lineas[0]).toMatchObject({ orden: 1, cantidad: 1, precioUnitario: 100, valor: 100, base: 89.29, iva: 10.71, total: 100 });
    expect([r.subtotal, r.iva, r.total]).toEqual([89.29, 10.71, 100]);
  });

  it("varios viajes en UNA línea: 3 × 2 217.36 = 6 652.08 (cantidad real, no 1 viaje = 1 línea)", () => {
    const r = calcularLineasFactura({ lineas: [L([1, 2, 3], { cantidad: 3, precioUnitario: 2217.36 })], planIdsFactura: [1, 2, 3] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lineas).toHaveLength(1);
    expect(r.lineas[0].valor).toBe(6652.08);
    expect(r.lineas[0].planIds).toEqual([1, 2, 3]); // trazabilidad: la línea conserva sus 3 viajes
    expect(r.total).toBe(6652.08);
  });

  it("descarga como línea aparte ligada a los MISMOS viajes (un viaje en dos líneas)", () => {
    const r = calcularLineasFactura({
      lineas: [L([1, 2], { cantidad: 2, precioUnitario: 1383.71, descripcion: "Flete" }), L([1, 2], { cantidad: 2, precioUnitario: 1042.55, descripcion: "Descarga" })],
      planIdsFactura: [1, 2],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lineas.map((l) => l.valor)).toEqual([2767.42, 2085.1]);
    expect(r.total).toBe(4852.52);
  });

  it("IVA mixto: cada línea con SU tratamiento; el total es la suma de las líneas (nunca recalculado)", () => {
    const r = calcularLineasFactura({
      lineas: [L([1], { precioIncluyeIva: true }), L([2], { precioIncluyeIva: false })],
      planIdsFactura: [1, 2],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.lineas.map((l) => [l.base, l.iva, l.total])).toEqual([[89.29, 10.71, 100], [100, 12, 112]]);
    expect([r.subtotal, r.iva, r.total]).toEqual([189.29, 22.71, 212]);
    expect(r.precioIncluyeIva).toBeNull(); // resumen: mezcla
  });

  it("clasificación BIEN o SERVICIO se conserva (decidirá la cuenta de ventas; sin números de cuenta aquí)", () => {
    const r = calcularLineasFactura({ lineas: [L([1], { clasificacion: "BIEN" }), L([2])], planIdsFactura: [1, 2] });
    expect(r.ok && r.lineas.map((l) => l.clasificacion)).toEqual(["BIEN", "SERVICIO"]);
  });

  it("valorLinea redondea half-up a 2 decimales", () => {
    expect(valorLinea(3, 333.335)).toBe(1000.01);
    expect(valorLinea(0.5, 0.01)).toBe(0.01);
  });
});

describe("calcularLineasFactura — validaciones (todas del lado del servidor)", () => {
  const caso = (lineas: LineaFacturaEntrada[], planIds: number[]) => calcularLineasFactura({ lineas, planIdsFactura: planIds });

  it("exige al menos una línea y no más de 200", () => {
    expect(caso([], [1])).toMatchObject({ ok: false, status: 400 });
    expect(caso(Array.from({ length: 201 }, () => L([1])), [1])).toMatchObject({ ok: false });
  });

  it("cada línea necesita viajes, y solo de ESTA factura, sin repetirlos", () => {
    expect(caso([L([])], [1])).toMatchObject({ ok: false });
    expect(caso([L([99])], [1])).toMatchObject({ ok: false, error: expect.stringContaining("no pertenece a esta factura") });
    expect(caso([L([1, 1])], [1])).toMatchObject({ ok: false, error: expect.stringContaining("repite") });
  });

  it("todo viaje debe estar en al menos una línea", () => {
    const r = caso([L([1])], [1, 2]);
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining("sin línea de factura (#2)") });
  });

  it("cantidad y precio: > 0 y como máximo 2 decimales; nunca NaN/Infinity", () => {
    for (const mala of [{ cantidad: 0 }, { cantidad: -1 }, { cantidad: 1.005 }, { cantidad: Number.NaN }, { precioUnitario: 0 }, { precioUnitario: -5 }, { precioUnitario: 10.123 }, { precioUnitario: Number.POSITIVE_INFINITY }]) {
      expect(caso([L([1], mala)], [1]), JSON.stringify(mala)).toMatchObject({ ok: false });
    }
  });

  it("descripción obligatoria (≤ 500) y clasificación válida", () => {
    expect(caso([L([1], { descripcion: "   " })], [1])).toMatchObject({ ok: false });
    expect(caso([L([1], { descripcion: "x".repeat(501) })], [1])).toMatchObject({ ok: false });
    expect(caso([L([1], { clasificacion: "OTRO" as never })], [1])).toMatchObject({ ok: false });
    expect(caso([L([1], { precioIncluyeIva: undefined as never })], [1])).toMatchObject({ ok: false });
  });

  it("un valor que no cabe en DECIMAL(14,2) se rechaza", () => {
    expect(caso([L([1], { cantidad: 9999999999, precioUnitario: 99999999 })], [1])).toMatchObject({ ok: false, error: expect.stringContaining("demasiado grande") });
  });
});

describe("operaciones de la pantalla «Preparar líneas de factura»", () => {
  const viajes = new Map([1, 2, 3].map((id) => [id, V(id, { montoAsignado: 100 * id })]));

  it("por defecto: una línea por viaje, SERVICIO, cantidad 1, precio = monto del viaje", () => {
    const ls = lineasPorDefecto([V(1), V(2, { precioIncluyeIva: false })], clave);
    expect(ls.map((l) => [l.planIds, l.cantidad, l.precioUnitario, l.clasificacion, l.precioIncluyeIva])).toEqual([[[1], 1, 100, "SERVICIO", true], [[2], 1, 100, "SERVICIO", false]]);
    expect(ls[0].descripcion).toBe("Servicio de transporte – Bodega → Destino 1 – 01/09/2026");
  });

  it("agrupar con el MISMO precio: cantidad = suma; con precios distintos: cantidad 1 y precio = suma de valores", () => {
    const iguales = lineasPorDefecto([V(1), V(2)], clave);
    const a = agruparLineas(iguales, iguales.map((l) => l.clave), new Map([[1, V(1)], [2, V(2)]]), clave);
    expect(a.ok && a.lineas).toHaveLength(1);
    expect(a.ok && a.lineas[0]).toMatchObject({ planIds: [1, 2], cantidad: 2, precioUnitario: 100 });
    expect(a.ok && a.lineas[0].descripcion).toContain("2 servicios de transporte");

    const distintas = lineasPorDefecto([V(1), V(2, { montoAsignado: 250.5 })], clave);
    const b = agruparLineas(distintas, distintas.map((l) => l.clave), new Map([[1, V(1)], [2, V(2)]]), clave);
    expect(b.ok && b.lineas[0]).toMatchObject({ cantidad: 1, precioUnitario: 350.5 });
  });

  it("agrupar conserva el orden: la línea agrupada queda donde estaba la primera", () => {
    const ls = lineasPorDefecto([V(1), V(2), V(3)], clave);
    const r = agruparLineas(ls, [ls[1].clave, ls[2].clave], viajes, clave);
    expect(r.ok && r.lineas.map((l) => l.planIds)).toEqual([[1], [2, 3]]);
  });

  it("no agrupa con distinto IVA ni distinta clasificación, ni con menos de dos líneas", () => {
    const ls = lineasPorDefecto([V(1), V(2, { precioIncluyeIva: false })], clave);
    expect(agruparLineas(ls, ls.map((l) => l.clave), viajes, clave)).toMatchObject({ ok: false, error: expect.stringContaining("IVA") });
    const m = lineasPorDefecto([V(1), V(2)], clave);
    m[1].clasificacion = "BIEN";
    expect(agruparLineas(m, m.map((l) => l.clave), viajes, clave)).toMatchObject({ ok: false, error: expect.stringContaining("clasificación") });
    expect(agruparLineas(m, [m[0].clave], viajes, clave)).toMatchObject({ ok: false });
  });

  it("desagrupar devuelve una línea por viaje con el monto de cada viaje", () => {
    const ls = lineasPorDefecto([V(1), V(2), V(3)], clave);
    const g = agruparLineas(ls, ls.map((l) => l.clave), viajes, clave);
    if (!g.ok) throw new Error(g.error);
    const d = desagruparLinea(g.lineas, g.lineas[0].clave, viajes, clave);
    expect(d.ok && d.lineas.map((l) => [l.planIds, l.precioUnitario])).toEqual([[[1], 100], [[2], 200], [[3], 300]]);
    expect(desagruparLinea(d.ok ? d.lineas : [], d.ok ? d.lineas[0].clave : "", viajes, clave)).toMatchObject({ ok: false });
  });

  it("TRAZABILIDAD: agrupar/desagrupar/descarga nunca pierden ni duplican un viaje; agrupar flete+descarga no repite el viaje en la línea", () => {
    const conjunto = (ls: { planIds: number[] }[]) => [...new Set(ls.flatMap((l) => l.planIds))].sort((x, y) => x - y);
    const ls = lineasPorDefecto([V(1), V(2), V(3)], clave);
    const g = agruparLineas(ls, ls.map((l) => l.clave), viajes, clave);
    if (!g.ok) throw new Error(g.error);
    expect(conjunto(g.lineas)).toEqual([1, 2, 3]);
    expect(g.lineas[0].planIds).toEqual([1, 2, 3]); // sin repetidos
    const conDescarga = agregarLineaDescarga(g.lineas, g.lineas[0].clave, clave);
    if (!conDescarga.ok) throw new Error(conDescarga.error);
    expect(conjunto(conDescarga.lineas)).toEqual([1, 2, 3]);
    expect(conDescarga.lineas.map((l) => l.planIds)).toEqual([[1, 2, 3], [1, 2, 3]]);
    // agrupar flete + descarga (mismo IVA/clasificación) deja cada viaje UNA sola vez en la línea
    conDescarga.lineas[1].precioUnitario = 50;
    const unida = agruparLineas(conDescarga.lineas, conDescarga.lineas.map((l) => l.clave), viajes, clave);
    expect(unida.ok && unida.lineas[0].planIds).toEqual([1, 2, 3]);
    // desagrupar vuelve a una línea por viaje: mismo conjunto
    const d = desagruparLinea(g.lineas, g.lineas[0].clave, viajes, clave);
    expect(d.ok && conjunto(d.lineas)).toEqual([1, 2, 3]);
    expect(d.ok && d.lineas).toHaveLength(3);
    // el servidor acepta ese resultado: todo viaje en ≥ 1 línea, solo de esta factura, sin repetirlos dentro de una línea
    const r = calcularLineasFactura({ lineas: aEntradaServidor(conDescarga.lineas), planIdsFactura: [1, 2, 3] });
    expect(r.ok).toBe(true);
  });

  it("agregar descarga: línea nueva debajo, ligada a los MISMOS viajes y con precio 0 (debe capturarse)", () => {
    const ls = lineasPorDefecto([V(1), V(2)], clave);
    const r = agregarLineaDescarga(ls, ls[0].clave, clave);
    expect(r.ok && r.lineas.map((l) => l.planIds)).toEqual([[1], [1], [2]]);
    expect(r.ok && r.lineas[1]).toMatchObject({ descripcion: "Servicio de descarga", precioUnitario: 0 });
    // sin precio no se puede facturar: la validación exige > 0
    const calc = calcularLineasFactura({ lineas: aEntradaServidor(r.ok ? r.lineas : []), planIdsFactura: [1, 2] });
    expect(calc).toMatchObject({ ok: false, error: expect.stringContaining("precio unitario de la línea 2") });
  });

  it("mover, quitar viaje y viajes sin línea", () => {
    const ls = lineasPorDefecto([V(1), V(2), V(3)], clave);
    expect(moverLinea(ls, ls[2].clave, -1).map((l) => l.planIds[0])).toEqual([1, 3, 2]);
    expect(moverLinea(ls, ls[0].clave, -1)).toBe(ls); // en el borde no hace nada
    const g = agruparLineas(ls, [ls[0].clave, ls[1].clave], viajes, clave);
    const sin2 = quitarViajeDeLineas(g.ok ? g.lineas : [], 2);
    expect(sin2.map((l) => l.planIds)).toEqual([[1], [3]]);
    expect(viajesSinLinea(sin2, [1, 2, 3])).toEqual([2]);
  });

  it("descripción sugerida de un grupo: cantidad de servicios, destinos únicos y fechas", () => {
    const t = descripcionSugerida([V(1, { destino: "Xela", fechaPlan: "2026-09-01" }), V(2, { destino: "Xela", fechaPlan: "2026-09-02" }), V(3, { destino: "Cobán", fechaPlan: "2026-09-02" })]);
    expect(t).toBe("3 servicios de transporte – Xela, Cobán – fechas 1-9-2026, 2-9-2026");
  });

  it("la huella cambia con cualquier dato que afecta al cálculo (cantidad, precio, viajes, IVA, texto)", () => {
    const base = [L([1, 2])];
    const f0 = firmaLineasFactura(base);
    for (const cambio of [{ cantidad: 2 }, { precioUnitario: 101 }, { precioIncluyeIva: false }, { descripcion: "Otro" }, { planIds: [1] }, { clasificacion: "BIEN" as const }]) {
      expect(firmaLineasFactura([{ ...base[0], ...cambio }]), JSON.stringify(cambio)).not.toBe(f0);
    }
    expect(firmaLineasFactura([L([2, 1])])).toBe(f0); // el orden de los viajes dentro de la línea no cambia el resultado
  });
});

describe("retención de IVA", () => {
  it("solo 0, 15 o 30", () => {
    for (const v of [0, 15, 30]) expect(esRetencionIvaValida(v)).toBe(true);
    for (const v of [5, 10, 100, -15, 15.5, "15", null, undefined]) expect(esRetencionIvaValida(v)).toBe(false);
  });
});
