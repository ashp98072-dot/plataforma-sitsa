import { describe, expect, it } from "vitest";
import {
  construirBorrador,
  descripcionLinea,
  esMonedaSoportada,
  evaluarPlanFacturable,
  MENSAJE_MONEDA_NO_SOPORTADA,
  normalizarMoneda,
  tratamientoEncabezado,
  type PlanParaFactura,
} from "./borrador-calculo";

const PLAN: PlanParaFactura = {
  id: 1,
  codigo: "PLAN-1",
  empresaId: 7,
  clienteTmsId: 501,
  estado: "Cerrado",
  fechaPlan: "2026-08-27",
  tarifaComercial: 1000,
  monedaRaw: "GTQ",
  rutaCodigo: "RUTA-01",
  origen: "Guatemala",
  destino: "Xela",
};
const CTX = { empresaId: 7, tmsClienteId: 501, vinculoFacturaId: null, facturaIdExcluir: null };

describe("evaluarPlanFacturable — un viaje no es facturable solo por existir", () => {
  it("1) viaje cerrado, del cliente, con tarifa y ruta, sin factura → facturable", () => {
    expect(evaluarPlanFacturable(PLAN, CTX)).toEqual({ ok: true });
  });

  it("2) viaje abierto (En ruta / Programado / Descargado / Cancelado) → 409, no facturable", () => {
    for (const estado of ["Programado", "En ruta", "Descargado", "Cancelado"]) {
      const r = evaluarPlanFacturable({ ...PLAN, estado }, CTX);
      expect(r.ok).toBe(false);
      if (!r.ok) { expect(r.status).toBe(409); expect(r.error).toContain("no está Cerrado"); }
    }
  });

  it("3) viaje ya facturado (vinculado a otra factura viva) → 409", () => {
    const r = evaluarPlanFacturable(PLAN, { ...CTX, vinculoFacturaId: 99 });
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.status).toBe(409); expect(r.error).toContain("ya está vinculado"); }
  });

  it("4) un viaje del propio borrador que se edita NO cuenta como «ya vinculado»", () => {
    expect(evaluarPlanFacturable(PLAN, { ...CTX, vinculoFacturaId: 5, facturaIdExcluir: 5 })).toEqual({ ok: true });
  });

  it("5) viaje de otra empresa → 404 (se comporta como inexistente, sin revelar que existe)", () => {
    const r = evaluarPlanFacturable({ ...PLAN, empresaId: 8 }, CTX);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
  });

  it("6) viaje de otro cliente → 400", () => {
    const r = evaluarPlanFacturable({ ...PLAN, clienteTmsId: 999 }, CTX);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.status).toBe(400); expect(r.error).toContain("no pertenece al cliente"); }
  });

  it("7) viaje sin cliente → no es del cliente pedido", () => {
    expect(evaluarPlanFacturable({ ...PLAN, clienteTmsId: null }, CTX).ok).toBe(false);
  });

  it("8) sin tarifa comercial válida (null, 0 o negativa) → 409", () => {
    for (const tarifaComercial of [null, 0, -5, Number.NaN]) {
      const r = evaluarPlanFacturable({ ...PLAN, tarifaComercial }, CTX);
      expect(r.ok).toBe(false);
      if (!r.ok) { expect(r.status).toBe(409); expect(r.error).toContain("tarifa comercial válida"); }
    }
  });

  it("9) sin ruta ni destino identificable → 409; con solo destino o solo ruta → facturable", () => {
    const sinNada = evaluarPlanFacturable({ ...PLAN, rutaCodigo: null, destino: "  " }, CTX);
    expect(sinNada.ok).toBe(false);
    if (!sinNada.ok) expect(sinNada.error).toContain("ruta ni destino");
    expect(evaluarPlanFacturable({ ...PLAN, rutaCodigo: null }, CTX).ok).toBe(true);
    expect(evaluarPlanFacturable({ ...PLAN, destino: null }, CTX).ok).toBe(true);
  });
});

describe("descripcionLinea", () => {
  it("«Servicio de transporte – {origen} → {destino} – {fecha}» con fecha dd/mm/aaaa", () => {
    expect(descripcionLinea({ origen: "Guatemala", destino: "Xela", fechaPlan: "2026-08-27" })).toBe(
      "Servicio de transporte – Guatemala → Xela – 27/08/2026",
    );
  });

  it("origen/destino desconocidos se muestran como «—»", () => {
    expect(descripcionLinea({ origen: null, destino: " ", fechaPlan: "2026-01-05" })).toBe("Servicio de transporte – — → — – 05/01/2026");
  });
});

describe("normalizarMoneda / esMonedaSoportada — Fase 1 solo admite GTQ", () => {
  it("vacío/null/Q/QTZ/GTQ (en cualquier caja y con espacios) → GTQ; el resto queda en mayúsculas", () => {
    for (const raw of [null, undefined, "", "  ", "Q", " q ", "QTZ", "qtz", "GTQ", "gtq"]) {
      expect(normalizarMoneda(raw)).toBe("GTQ");
      expect(esMonedaSoportada(raw)).toBe(true);
    }
    expect(normalizarMoneda("usd")).toBe("USD");
    expect(normalizarMoneda(" eur ")).toBe("EUR");
  });

  it("USD, EUR y cualquier otra moneda NO están soportadas", () => {
    for (const raw of ["USD", "usd", "EUR", "MXN", "Quetzales", "$"]) expect(esMonedaSoportada(raw)).toBe(false);
  });
});

describe("moneda en la elegibilidad del viaje", () => {
  it("GTQ, null, Q y QTZ son facturables", () => {
    for (const monedaRaw of ["GTQ", null, "Q", "QTZ"]) {
      expect(evaluarPlanFacturable({ ...PLAN, monedaRaw }, CTX), String(monedaRaw)).toEqual({ ok: true });
    }
  });

  it("USD / EUR → 409 con el mensaje exacto de la fase, y no se les aplica ninguna política de IVA", () => {
    for (const monedaRaw of ["USD", "EUR"]) {
      const r = evaluarPlanFacturable({ ...PLAN, monedaRaw }, CTX);
      expect(r).toEqual({ ok: false, status: 409, error: MENSAJE_MONEDA_NO_SOPORTADA });
    }
    expect(MENSAJE_MONEDA_NO_SOPORTADA).toBe(
      "Esta fase de Facturación solo admite GTQ. La facturación en moneda extranjera está pendiente de definición contable.",
    );
  });
});

const L = (plan: PlanParaFactura, montoAsignado: number, precioIncluyeIva: boolean) => ({ plan, montoAsignado, precioIncluyeIva });
const PLAN2: PlanParaFactura = { ...PLAN, id: 2, codigo: "PLAN-2", destino: "Cobán", fechaPlan: "2026-08-28" };

describe("construirBorrador — política de IVA POR LÍNEA", () => {
  it("1) una línea con IVA INCLUIDO: 1000 → 892.86 + 107.14 = 1000 (cantidad 1, descripción y ruta congeladas)", () => {
    const r = construirBorrador([L(PLAN, 1000, true)]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const b = r.borrador;
    expect(b.lineas).toHaveLength(1);
    expect(b.lineas[0]).toMatchObject({
      planId: 1, codigo: "PLAN-1", cantidad: 1, montoAsignado: 1000, precioIncluyeIva: true, porcentajeIva: 12,
      base: 892.86, iva: 107.14, total: 1000, descripcion: "Servicio de transporte – Guatemala → Xela – 27/08/2026", rutaCodigo: "RUTA-01",
    });
    expect(b).toMatchObject({ moneda: "GTQ", porcentajeIva: 12, precioIncluyeIva: true, subtotal: 892.86, iva: 107.14, total: 1000 });
  });

  it("2) una línea con IVA AGREGADO: 1000 → 1000 + 120 = 1120", () => {
    const r = construirBorrador([L(PLAN, 1000, false)]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.borrador.lineas[0]).toMatchObject({ precioIncluyeIva: false, porcentajeIva: 12, base: 1000, iva: 120, total: 1120 });
    expect(r.borrador).toMatchObject({ precioIncluyeIva: false, subtotal: 1000, iva: 120, total: 1120 });
  });

  it("3) MEZCLA en una misma factura: Q100 incluido + Q100 agregado → subtotal 189.29, IVA 22.71, total 212.00", () => {
    const r = construirBorrador([L(PLAN, 100, true), L(PLAN2, 100, false)]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [a, b] = r.borrador.lineas;
    expect([a.precioIncluyeIva, a.base, a.iva, a.total]).toEqual([true, 89.29, 10.71, 100]);
    expect([b.precioIncluyeIva, b.base, b.iva, b.total]).toEqual([false, 100, 12, 112]);
    expect(r.borrador).toMatchObject({ subtotal: 189.29, iva: 22.71, total: 212 });
    // el documento es la SUMA de las líneas, nunca un IVA recalculado sobre el total agregado
    expect(r.borrador.subtotal).toBe(Number((a.base + b.base).toFixed(2)));
    expect(r.borrador.iva).toBe(Number((a.iva + b.iva).toFixed(2)));
    expect(r.borrador.total).toBe(Number((a.total + b.total).toFixed(2)));
    expect(Number((r.borrador.subtotal + r.borrador.iva).toFixed(2))).toBe(r.borrador.total);
  });

  it("11) el encabezado NO finge una sola política cuando hay mezcla: precioIncluyeIva = null; con todas iguales, true/false", () => {
    const mezcla = construirBorrador([L(PLAN, 100, true), L(PLAN2, 100, false)]);
    const todasIncluidas = construirBorrador([L(PLAN, 100, true), L(PLAN2, 100, true)]);
    const todasAgregadas = construirBorrador([L(PLAN, 100, false), L(PLAN2, 100, false)]);
    expect(mezcla.ok && mezcla.borrador.precioIncluyeIva).toBeNull();
    expect(todasIncluidas.ok && todasIncluidas.borrador.precioIncluyeIva).toBe(true);
    expect(todasAgregadas.ok && todasAgregadas.borrador.precioIncluyeIva).toBe(false);
  });

  it("cambiar SOLO una línea recalcula solo esa línea y los totales", () => {
    const antes = construirBorrador([L(PLAN, 100, true), L(PLAN2, 100, true)]);
    const despues = construirBorrador([L(PLAN, 100, true), L(PLAN2, 100, false)]);
    expect(antes.ok && despues.ok).toBe(true);
    if (!antes.ok || !despues.ok) return;
    expect(despues.borrador.lineas[0]).toEqual(antes.borrador.lineas[0]); // la línea 1 no cambia
    expect(despues.borrador.lineas[1].total).toBe(112);
    expect(antes.borrador.total).toBe(200);
    expect(despues.borrador.total).toBe(212);
  });

  it("dos viajes del mismo cliente se agrupan: el total es la suma exacta (ambos con IVA incluido)", () => {
    const r = construirBorrador([L(PLAN, 1000, true), L(PLAN2, 500.5, true)]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.borrador.lineas).toHaveLength(2);
      expect(r.borrador.total).toBe(1500.5);
      expect(Number((r.borrador.subtotal + r.borrador.iva).toFixed(2))).toBe(1500.5);
    }
  });

  it("una factura SOLO en USD se bloquea (defensa en profundidad: nunca se calcula IVA sobre otra moneda)", () => {
    expect(construirBorrador([L({ ...PLAN, monedaRaw: "USD" }, 1000, true)])).toEqual({ ok: false, status: 409, error: MENSAJE_MONEDA_NO_SOPORTADA });
  });

  it("mezclar GTQ con USD también se bloquea", () => {
    expect(construirBorrador([L(PLAN, 1000, true), L({ ...PLAN2, monedaRaw: "USD" }, 100, false)])).toEqual({ ok: false, status: 409, error: MENSAJE_MONEDA_NO_SOPORTADA });
  });

  it("moneda ausente en un viaje cuenta como GTQ (no mezcla con otro GTQ explícito)", () => {
    expect(construirBorrador([L({ ...PLAN, monedaRaw: null }, 10, true), L({ ...PLAN2, monedaRaw: "GTQ" }, 10, true)]).ok).toBe(true);
  });

  it("9) el snapshot previo manda sobre los datos vivos del viaje (editar el borrador no refresca lo congelado)", () => {
    const r = construirBorrador([
      {
        plan: { ...PLAN, destino: "Destino NUEVO", rutaCodigo: "RUTA-NUEVA" },
        montoAsignado: 1000,
        precioIncluyeIva: true,
        snapshotPrevio: {
          fechaPlan: "2026-08-27", rutaCodigo: "RUTA-01", origen: "Guatemala", destino: "Xela",
          descripcion: "Servicio de transporte – Guatemala → Xela – 27/08/2026",
        },
      },
    ]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.borrador.lineas[0].destino).toBe("Xela");
      expect(r.borrador.lineas[0].rutaCodigo).toBe("RUTA-01");
      expect(r.borrador.lineas[0].descripcion).toContain("Xela");
    }
  });
});

describe("tratamientoEncabezado", () => {
  it("true/false si todas coinciden; null con mezcla o sin líneas", () => {
    expect(tratamientoEncabezado([true, true])).toBe(true);
    expect(tratamientoEncabezado([false])).toBe(false);
    expect(tratamientoEncabezado([true, false])).toBeNull();
    expect(tratamientoEncabezado([])).toBeNull();
  });
});
