import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { diferencias, formatearDetalle, MARCA_BIT, parsearEvento } from "./bitacora";
import { fechaHoraBitacora, lineaBitacora } from "./bitacora-formato";

const fila = (accion: string, detalle: string, usuario = "admin") => ({ id: 1, usuario, accion, detalle, creado_en: "2026-10-19 10:38:00" });

describe("formato de la bitácora", () => {
  it("línea visible: fecha/hora · usuario · acción y documento", () => {
    const e = parsearEvento(fila("emitir_factura", formatearDetalle("Factura #5 emitida · número TEST-CXC-001", { facturaId: 5, usuarioId: 1, numero: "TEST-CXC-001", entidadId: 2 })));
    expect(lineaBitacora(e)).toBe("19/10/2026 10:38 · admin · Emitió factura TEST-CXC-001");
  });
  it("cobro: monto, medio y referencia", () => {
    const e = parsearEvento({ ...fila("registrar_pago", formatearDetalle("Factura #5 · pago Q1000", { facturaId: 5, usuarioId: 1, numero: "TEST-CXC-001", monto: "1000.00", medioPago: "Transferencia", referencia: "PRUEBA-CXC-001" })), creado_en: "2026-10-19 10:42:09" });
    expect(lineaBitacora(e)).toBe("19/10/2026 10:42 · admin · Registró cobro TEST-CXC-001 · Q1,000.00 · Transferencia · PRUEBA-CXC-001");
  });
  it("anulación con motivo; evento histórico sin JSON; JSON corrupto no rompe", () => {
    expect(parsearEvento(fila("anular_factura", formatearDetalle("Factura #5 anulada", { facturaId: 5, usuarioId: 1, numero: "F-1", motivo: "Duplicada" }))).resumen).toBe("Anuló factura F-1 · Motivo: Duplicada");
    expect(parsearEvento(fila("registrar_pago", "Factura #9 · pago Q5 · saldo restante Q0")).resumen).toBe("Registró cobro #9");
    expect(parsearEvento(fila("crear_factura", `Factura #9 (Borrador)${MARCA_BIT}{no es json`)).resumen).toBe("Creó borrador #9");
  });
  it("sin usuario se muestra «sistema»; fecha inválida se deja tal cual", () => {
    expect(lineaBitacora({ id: 1, fecha: "2026-10-19 08:05:59", usuario: null, resumen: "x" })).toBe("19/10/2026 08:05 · sistema · x");
    expect(fechaHoraBitacora("raro")).toBe("raro");
  });
  it("diferencias: solo lo que cambió, valores normalizados; el detalle acota textos largos", () => {
    expect(diferencias({ a: 1, b: "x", c: null }, { a: 1, b: "y", c: 3 })).toEqual([{ campo: "b", antes: "x", despues: "y" }, { campo: "c", antes: null, despues: "3" }]);
    const largo = "z".repeat(900);
    const d = formatearDetalle("Factura #1 x", { facturaId: 1, usuarioId: 1, motivo: largo, referencia: largo });
    const j = JSON.parse(d.slice(d.indexOf(MARCA_BIT) + MARCA_BIT.length));
    expect(j.motivo.length).toBe(500);
    expect(j.referencia.length).toBe(120);
    expect(j.v).toBe(1);
  });
});

describe("arquitectura de la bitácora", () => {
  const src = (f: string) => readFileSync(f, "utf8");
  it("reutiliza `auditoria`/registrarAuditoriaTx (sin segunda bitácora ni esquema nuevo) y es append-only", () => {
    const b = src("src/lib/facturacion/bitacora.ts").replace(/\/\*[\s\S]*?\*\//g, "");
    expect(b).toContain("registrarAuditoriaTx");
    expect(b).not.toMatch(/CREATE TABLE|ALTER TABLE|(UPDATE|DELETE\s+FROM)\s+auditoria|INSERT INTO/i);
  });
  it("los cinco movimientos y las confirmaciones bancarias registran vía la bitácora, con el actor", () => {
    const f = src("src/lib/facturacion/facturas.ts");
    for (const a of ["crear_factura", "editar_factura_borrador", "emitir_factura", "anular_factura", "registrar_pago"]) expect(f).toContain(`registrarBitacoraFactura(conn, actor, "${a}"`);
    expect(f).not.toContain("registrarAuditoriaTx(");
    const c = src("src/lib/facturacion/confirmaciones-bancarias.ts");
    expect(c).toContain('"confirmar_ingreso_bancario"');
    expect(c).toContain('"anular_confirmacion_bancaria"');
  });
  it("no hay migración SQL nueva", () => {
    expect(() => src("sql/migrate-2026-11-facturacion-bitacora.sql")).toThrow();
  });
  it("UI: el panel de la factura y la pestaña de CxC solo existen con su permiso propio", () => {
    const panel = src("src/components/facturacion/bitacora-factura-panel.tsx");
    expect(panel).toContain('tieneAccionCatalogo(permisos, "facturacion", "ver_bitacora")');
    expect(panel).toContain("if (!puedeVer) return null;");
    expect(src("src/components/facturacion/facturas-panel.tsx")).toContain("<BitacoraFacturaPanel");
    const cxc = src("src/components/contabilidad/cxc-client.tsx");
    expect(cxc).toContain("{puedeVerBitacora && <button");
    expect(cxc).toContain('vista === "bitacora" && puedeVerBitacora');
    expect(src("src/app/e/[slug]/contabilidad/cxc/page.tsx")).toContain('puedeVerBitacora={p("cxc_bitacora", "ver")}');
  });
});
