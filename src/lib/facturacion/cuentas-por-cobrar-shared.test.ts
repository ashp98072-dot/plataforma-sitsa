import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  COLUMNAS_EXPORTACION,
  LIMITE_EXPORTACION,
  NOTA_EXPORTACION,
  PAGE_SIZE_MAXIMO,
  ROTULO_SALDO_INFORMATIVO,
  esCarteraAbierta,
  estadoDerivado,
  filaExportacion,
  filtrosDesdeParams,
  importe,
  paginacionEfectiva,
  saldoInformativo,
  type FilaCxc,
} from "./cuentas-por-cobrar-shared";

describe("M-2a · saldo informativo y estados derivados (lógica pura)", () => {
  it("A. saldo: 1000 sin pagos = 1000 · 1000 con 400 = 600 · 1000 con 1000 = 0", () => {
    expect(saldoInformativo(1000, 0)).toBe("1000.00");
    expect(saldoInformativo("1000.00", "400.00")).toBe("600.00");
    expect(saldoInformativo(1000, 1000)).toBe("0.00");
  });

  it("aritmética exacta (sin errores de coma flotante) y sin NaN", () => {
    expect(saldoInformativo("0.30", "0.10")).toBe("0.20");
    expect(saldoInformativo("10", "0.1")).toBe("9.90");
    expect(importe("abc")).toBe("0.00");
    expect(importe(null)).toBe("0.00");
  });

  it("B. estados: SIN_PAGOS · PARCIAL · PAGADA · ANULADA (y Borrador no participa)", () => {
    expect(estadoDerivado("Emitida", 1000, 0)).toBe("SIN_PAGOS");
    expect(estadoDerivado("Emitida", 1000, 400)).toBe("PARCIAL");
    expect(estadoDerivado("Emitida", 1000, 1000)).toBe("PAGADA");
    expect(estadoDerivado("Emitida", 1000, 1000.01)).toBe("PAGADA");
    expect(estadoDerivado("Anulada", 1000, 0)).toBe("ANULADA");
    expect(estadoDerivado("Borrador", 1000, 0)).toBeNull();
  });

  it("cartera abierta = Emitida con saldo informativo > 0", () => {
    expect(esCarteraAbierta("Emitida", 1000, 999.99)).toBe(true);
    expect(esCarteraAbierta("Emitida", 1000, 1000)).toBe(false);
    expect(esCarteraAbierta("Anulada", 1000, 0)).toBe(false);
    expect(esCarteraAbierta("Borrador", 1000, 0)).toBe(false);
  });

  it("filtros: parseo estricto; lo desconocido se ignora", () => {
    const f = filtrosDesdeParams(
      new URLSearchParams("vista=historial&alcance=pagadas&clienteId=12&entidad=sin&estado=PARCIAL&estadoAdmin=Emitida&fechaDesde=2026-09-01&fechaHasta=2026-02-30&numeroFactura=FE-1&page=3&pageSize=9999"),
    );
    expect(f).toMatchObject({ vista: "historial", alcance: "pagadas", clienteId: 12, entidad: "sin", estadoDerivado: "PARCIAL", estadoAdmin: "Emitida", fechaDesde: "2026-09-01", numeroFactura: "FE-1", page: 3 });
    expect(f.fechaHasta).toBeUndefined(); // 30 de febrero no existe
    const malo = filtrosDesdeParams(new URLSearchParams("vista=x&alcance=y&clienteId=-1&entidad=abc&estado=VENCIDA&estadoAdmin=Borrador&empresaId=999"));
    expect(malo).toMatchObject({ vista: "cartera" });
    expect(malo.alcance).toBeUndefined();
    expect(malo.clienteId).toBeUndefined();
    expect(malo.entidad).toBeUndefined();
    expect(malo.estadoDerivado).toBeUndefined(); // «VENCIDA» no existe en M-2a
    expect(malo.estadoAdmin).toBeUndefined(); // Borrador no participa
    expect(JSON.stringify(malo)).not.toContain("999"); // la empresa nunca viene de la query
  });

  it("G. paginación efectiva: tamaño acotado y página mínima 1", () => {
    expect(paginacionEfectiva({})).toEqual({ page: 1, pageSize: 25, offset: 0 });
    expect(paginacionEfectiva({ page: 3, pageSize: 10 })).toEqual({ page: 3, pageSize: 10, offset: 20 });
    expect(paginacionEfectiva({ page: 0, pageSize: 100000 }).pageSize).toBe(PAGE_SIZE_MAXIMO);
    expect(LIMITE_EXPORTACION).toBeGreaterThan(1000);
  });

  it("exportación: columnas exactas y fila coherente con la lista", () => {
    expect([...COLUMNAS_EXPORTACION]).toEqual([
      "Cliente", "Factura", "Entidad", "Fecha emisión", "Monto original", "Total pagado", "Saldo informativo",
      "Estado", "Condición de pago", "Retención esperada", "Neto esperado", "Último pago", "Referencia",
    ]);
    const fila: FilaCxc = {
      facturaId: 1, clienteId: 1, cliente: "Alfa", numeroFactura: "FE-1", entidadId: null, entidad: "Sin entidad", fechaEmision: "2026-09-01",
      estadoAdmin: "Emitida", estadoFinanciero: "PARCIAL", condicionPago: null, montoOriginal: "1000.00", totalPagado: "400.00",
      saldoInformativo: "600.00", retencionEsperada: { porcentaje: 15, monto: "160.71" }, netoEsperado: "839.29", cantidadPagos: 1,
      ultimaFechaPago: "2026-09-20", ultimaReferenciaPago: null,
      confirmacionBancaria: { cantidadActivas: 1, totalConfirmado: "400.00", ultima: { id: 1, estado: "CONFIRMADA", monto: "400.00", fechaAcreditacion: "2026-09-21", referencia: "DEP-1", banco: "B", alias: "A" } },
      vencimiento: "No disponible",
    };
    const r = filaExportacion(fila);
    expect(r).toHaveLength(COLUMNAS_EXPORTACION.length);
    expect(r).toEqual(["Alfa", "FE-1", "Sin entidad", "2026-09-01", "1000.00", "400.00", "600.00", "Pago parcial", "—", "15% · 160.71", "839.29", "2026-09-20", "DEP-1"]);
  });

  it("rótulos obligatorios (texto exacto)", () => {
    expect(ROTULO_SALDO_INFORMATIVO).toBe("Saldo informativo — documentos registrados en plataforma. No es la cartera legal de Milenium.");
    expect(NOTA_EXPORTACION).toBe("Datos informativos de plataforma; no sustituyen la cartera legal de Milenium.");
  });
});

describe("M-2a · arquitectura: fuente única, solo lectura y sin vencimiento inventado", () => {
  const leer = (p: string) => readFileSync(p, "utf8");
  const archivos = [
    "src/lib/facturacion/cuentas-por-cobrar.ts",
    "src/lib/facturacion/cuentas-por-cobrar-shared.ts",
    "src/lib/facturacion/cuentas-por-cobrar-excel.ts",
    "src/components/facturacion/cuentas-por-cobrar-panel.tsx",
    "src/app/api/empresas/[slug]/facturacion/cuentas-por-cobrar/route.ts",
    "src/app/api/empresas/[slug]/facturacion/cuentas-por-cobrar/clientes/route.ts",
    "src/app/api/empresas/[slug]/facturacion/cuentas-por-cobrar/clientes/[clienteId]/route.ts",
    "src/app/api/empresas/[slug]/facturacion/cuentas-por-cobrar/export/route.ts",
  ];

  it("D. ningún archivo de M-2a usa `cont_cxc` ni contabilidad, FEL o INFILE", () => {
    for (const a of archivos) {
      const t = leer(a).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      expect(t, a).not.toMatch(/cont_cxc|cont_cxp|cont_asientos/i);
      expect(t, a).not.toMatch(/from "@\/lib\/(contabilidad|fel)\//);
      expect(t, a).not.toMatch(/infile|fel_documentos/i);
    }
  });

  it("J. solo lectura: sin escrituras SQL y las rutas exportan únicamente GET", () => {
    for (const a of archivos) {
      const t = leer(a).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      expect(t, a).not.toMatch(/\b(INSERT\s+INTO|UPDATE\s+\w+\s+SET|DELETE\s+FROM|ALTER\s+TABLE|DROP\s+TABLE|TRUNCATE|CREATE\s+TABLE|execute\()/i);
      if (a.includes("/api/")) {
        expect(t, a).toMatch(/export async function GET\(/);
        expect(t, a).not.toMatch(/export async function (POST|PUT|PATCH|DELETE)\(/);
        expect(t, a).toMatch(/requireTenantFacturacion\(slug, "ver"\)/);
      }
    }
  });

  it("no inventa vencimiento ni antigüedad: sin días vencidos, rangos ni estado «vencida»", () => {
    for (const a of archivos.filter((x) => !x.endsWith("-excel.ts"))) {
      const t = leer(a).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      expect(t, a).not.toMatch(/diasVencidos|dias_vencidos|rangoAntig|antig(ü|u)edad|DATEDIFF|fecha_vencimiento/i);
      expect(t, a).not.toMatch(/"VENCIDA"|'VENCIDA'|"NO_VENCIDA"/);
    }
    expect(leer("src/components/facturacion/cuentas-por-cobrar-panel.tsx")).toContain("TEXTO_VENCIMIENTO_NO_DISPONIBLE");
  });

  it("el panel muestra el rótulo permanente y nunca habla de «saldo legal» ni «cartera legal» como propio", () => {
    const t = leer("src/components/facturacion/cuentas-por-cobrar-panel.tsx");
    expect(t).toContain("ROTULO_SALDO_INFORMATIVO");
    expect(t).not.toMatch(/saldo legal/i);
    expect(t).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)/);
  });

  it("la acción de «Cuentas por cobrar» está integrada en Facturación", () => {
    const t = leer("src/components/facturacion/facturacion-client.tsx");
    expect(t).toContain('label: "Cuentas por cobrar"');
    expect(t).toMatch(/<CuentasPorCobrarPanel slug=\{slug\}/);
  });
});
