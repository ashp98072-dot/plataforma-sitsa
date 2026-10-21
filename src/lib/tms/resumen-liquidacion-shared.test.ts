import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import {
  ETIQUETA_SUBTOTAL_COMERCIAL,
  construirBloqueComercial,
  difiereSnapshot,
  estadoLiquidacionResumen,
  montoDecimal,
  subtotalComercial,
  sumaMontos,
} from "./resumen-liquidacion-shared";

const cargo = (id: number, monto: string) => ({ id, concepto: `Cargo ${id}`, monto, observacion: null });

describe("Resumen comercial · Fase 5 · aritmética pura", () => {
  it("tarifa sin cargos: subtotal = tarifa; moneda por defecto GTQ; IVA siempre PENDIENTE", () => {
    const b = construirBloqueComercial({ tarifaBase: 1000, moneda: null, cargosVigentes: [] });
    expect(b).toMatchObject({ tarifaBase: "1000.00", moneda: "GTQ", subtotalComercial: "1000.00", tratamientoIva: "PENDIENTE" });
    expect(b.cargosAdicionales).toEqual({ cantidad: 0, total: "0.00", items: [] });
  });

  it("varios cargos: suma exacta sin error de coma flotante", () => {
    const b = construirBloqueComercial({ tarifaBase: "1000", moneda: "GTQ", cargosVigentes: [cargo(1, "0.10"), cargo(2, "0.20")] });
    expect(b.cargosAdicionales.total).toBe("0.30");
    expect(b.subtotalComercial).toBe("1000.30");
  });

  it("sin tarifa: no hay subtotal (no se inventa una base)", () => {
    const b = construirBloqueComercial({ tarifaBase: null, moneda: "GTQ", cargosVigentes: [cargo(1, "75")] });
    expect(b.tarifaBase).toBeNull();
    expect(b.subtotalComercial).toBeNull();
    expect(b.cargosAdicionales.total).toBe("75.00");
  });

  it("no calcula IVA: 1000 + 0 cargos nunca es 1120", () => {
    expect(subtotalComercial(1000, "0.00")).toBe("1000.00");
    expect(construirBloqueComercial({ tarifaBase: 1000, moneda: "GTQ", cargosVigentes: [] }).subtotalComercial).not.toBe("1120.00");
  });

  it("montos no numéricos o vacíos no producen NaN", () => {
    expect(montoDecimal("abc")).toBeNull();
    expect(montoDecimal("")).toBeNull();
    expect(montoDecimal(null)).toBeNull();
    expect(montoDecimal(Number.NaN)).toBeNull();
    expect(sumaMontos(["1.10", null, "2.20"])).toBe("3.30");
  });

  it("estado visual: EN_AJUSTE = sujeto a cambios; LIQUIDADO = finalizado", () => {
    expect(estadoLiquidacionResumen("EN_AJUSTE")).toEqual({ sujetoACambios: true, finalizada: false });
    expect(estadoLiquidacionResumen("LIQUIDADO")).toEqual({ sujetoACambios: false, finalizada: true });
    expect(estadoLiquidacionResumen("REPORTE_RECIBIDO")).toEqual({ sujetoACambios: false, finalizada: false });
    expect(estadoLiquidacionResumen(null)).toEqual({ sujetoACambios: false, finalizada: false });
  });

  it("difiereSnapshot compara con Decimal y no marca diferencia si falta alguno", () => {
    expect(difiereSnapshot("1150.00", "1150.0")).toBe(false);
    expect(difiereSnapshot("1200.00", "1150.00")).toBe(true);
    expect(difiereSnapshot(null, "1150.00")).toBe(false);
  });

  it("la etiqueta nunca se llama «total factura»", () => {
    expect(ETIQUETA_SUBTOTAL_COMERCIAL).toMatch(/antes de impuestos/i);
    expect(ETIQUETA_SUBTOTAL_COMERCIAL).not.toMatch(/total factura/i);
  });
});

describe("Resumen comercial · Fase 5 · los costos NO pueden entrar al subtotal (por construcción)", () => {
  const src = readFileSync("src/lib/tms/resumen-liquidacion-shared.ts", "utf8");

  it("construirBloqueComercial no recibe costos/gastos/fondos como parámetro", () => {
    const firma = src.slice(src.indexOf("export function construirBloqueComercial"), src.indexOf("}): BloqueComercial"));
    expect(firma).toMatch(/tarifaBase/);
    expect(firma).toMatch(/cargosVigentes/);
    expect(firma).not.toMatch(/gasto|costo|fondo|anticipo/i);
  });

  it("el servidor jamás pasa costos al bloque comercial ni los suma al subtotal", () => {
    const srv = readFileSync("src/lib/tms/resumen-liquidacion.ts", "utf8");
    const llamada = srv.slice(srv.indexOf("construirBloqueComercial({"), srv.indexOf("});", srv.indexOf("construirBloqueComercial({")));
    expect(llamada).not.toMatch(/gasto|costo|fondo|anticipo/i);
    // El subtotal comercial sale únicamente de construirBloqueComercial / subtotalComercial(tarifa, cargos).
    expect(srv).not.toMatch(/subtotalComercial\([^)]*(costo|gasto|fondo)/i);
  });

  it("nada de IVA/impuestos en el cálculo (solo texto de «pendiente»)", () => {
    const srv = readFileSync("src/lib/tms/resumen-liquidacion.ts", "utf8");
    expect(srv).not.toMatch(/\*\s*1\.12|\*\s*0\.12|IVA\s*\*/);
  });

  it("el servicio es de solo lectura: ningún INSERT/UPDATE/DELETE/ALTER", () => {
    const srv = readFileSync("src/lib/tms/resumen-liquidacion.ts", "utf8");
    expect(srv).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|ALTER\s+TABLE|DROP\s+TABLE|TRUNCATE)\b/i);
  });

  it("el endpoint solo pide costos con requireTenantGastos(ver) y el reporte no consulta gastos", () => {
    const ruta = readFileSync("src/app/api/empresas/[slug]/tms/planes/[id]/resumen-liquidacion/route.ts", "utf8");
    expect(ruta).toMatch(/requireTenantGastos\(slug, "ver"\)/);
    const rep = readFileSync("src/lib/tms/reportes-viajes.ts", "utf8");
    expect(rep).not.toMatch(/tms_gastos_operativos|tms_solicitud_fondo_lineas/);
  });
});
