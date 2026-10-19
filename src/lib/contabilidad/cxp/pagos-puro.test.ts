import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn() }));
import { validarPago } from "./pagos";

const base = { proveedorId: 3, fechaPago: "2026-11-10", medioPago: " Transferencia ", referencia: "TR-1", claveIdempotencia: "clave-12345678", aplicaciones: [{ facturaId: 7, monto: "100.10" }, { facturaId: 2, monto: "0.20" }] };

describe("validarPago (puro): el total y la huella los calcula el servidor", () => {
  it("total = suma exacta de las aplicaciones (sin coma flotante), aplicaciones ordenadas por factura", () => {
    const v = validarPago({ ...base, montoTotal: "1.00" } as never);
    expect(v.montoTotal).toBe("100.30");
    expect(v.aplicaciones.map(a => a.facturaId)).toEqual([2, 7]);
    expect(v.medioPago).toBe("Transferencia");
  });
  it("la huella es estable ante el orden de las aplicaciones y cambia si cambia el contenido", () => {
    const a = validarPago(base), b = validarPago({ ...base, aplicaciones: [...base.aplicaciones].reverse() }), c = validarPago({ ...base, referencia: "TR-2" });
    expect(a.huella).toBe(b.huella);
    expect(a.huella).not.toBe(c.huella);
    expect(a.huella).toMatch(/^[a-f0-9]{64}$/);
  });
  it("rechaza: sin aplicaciones, más de 50, factura repetida, montos inválidos, clave inválida, fecha y proveedor inválidos", () => {
    expect(() => validarPago({ ...base, aplicaciones: [] })).toThrow(/al menos una factura/);
    expect(() => validarPago({ ...base, aplicaciones: undefined })).toThrow(/al menos una factura/);
    expect(() => validarPago({ ...base, aplicaciones: Array.from({ length: 51 }, (_, i) => ({ facturaId: i + 1, monto: "1.00" })) })).toThrow(/hasta 50/);
    expect(() => validarPago({ ...base, aplicaciones: [{ facturaId: 1, monto: "1" }, { facturaId: 1, monto: "2" }] })).toThrow(/no puede repetirse/);
    for (const monto of ["0", "-1", "1.005", "x", "", null]) expect(() => validarPago({ ...base, aplicaciones: [{ facturaId: 1, monto }] })).toThrow();
    for (const clave of ["", "corta", "con espacios aqui", "x".repeat(65), 12345678]) expect(() => validarPago({ ...base, claveIdempotencia: clave })).toThrow(/Clave de operación/);
    expect(() => validarPago({ ...base, fechaPago: "2026-13-01" })).toThrow(/fecha/i);
    expect(() => validarPago({ ...base, proveedorId: 0 })).toThrow(/identificador/);
    expect(() => validarPago({ ...base, aplicaciones: ["x"] })).toThrow(/formato inválido/);
  });
});
