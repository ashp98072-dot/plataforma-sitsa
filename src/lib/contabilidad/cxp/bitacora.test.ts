import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ guard: vi.fn(), listar: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantCxp: m.guard }));
vi.mock("./bitacora", async (orig) => ({ ...(await orig<typeof import("./bitacora")>()), listarBitacoraCxp: m.listar }));
import { ACCIONES_BITACORA_CXP, cambiosConfig, parsearEventoCxp } from "./bitacora";
import { listarBitacoraCxpHttp } from "./http";

const fila = (accion: string, detalle: unknown, extra: Record<string, unknown> = {}) =>
  ({ id: 10, usuario: "conta", accion, detalle: JSON.stringify(detalle), creado_en: "2026-10-19 10:42:05", ...extra });
const res = {
  proveedores: new Map([[3, "Proveedor Uno"]]),
  facturas: new Map([[7, { documento: "A-100", proveedorId: 3, total: "11200.00" }]]),
};

describe("formato de la bitácora de CxP (puro)", () => {
  it("factura registrada: quién, cuándo, proveedor, documento, monto, ISR", () => {
    const e = parsearEventoCxp(fila("cxp_registrar_factura", { entidadId: 5, facturaId: 7, proveedorId: 3, usuarioId: 91, documento: "A-100", total: "11200.00", isr: "500.00", neto: "10700.00" }), res);
    expect(e).toMatchObject({ usuario: "conta", usuarioId: 91, proveedor: "Proveedor Uno", documento: "A-100", monto: "11200.00", fecha: "2026-10-19 10:42:05" });
    expect(e.resumen).toBe("Registró factura A-100 · Proveedor Uno · Q11,200.00 · ISR Q500.00 · Pagadero Q10,700.00");
  });
  it("anulación con motivo; los eventos anteriores (sin documento/proveedor) se completan al leer", () => {
    const e = parsearEventoCxp(fila("cxp_anular_factura", { entidadId: 5, facturaId: 7, usuarioId: 91, motivo: "Capturada por error", antes: "REGISTRADA", despues: "ANULADA" }), res);
    expect(e.resumen).toBe("Anuló factura A-100 · Proveedor Uno · Q11,200.00 · Motivo: Capturada por error");
    expect(e.motivo).toBe("Capturada por error");
  });
  it("pago y reversión: monto, medio, referencia, facturas aplicadas y motivo", () => {
    const p = parsearEventoCxp(fila("cxp_registrar_pago", { entidadId: 5, pagoId: 9, usuarioId: 91, proveedorId: 3, montoTotal: "123.45", medioPago: "Transferencia", referencia: "CH-77", aplicaciones: [{ facturaId: 7, monto: "123.45" }] }), res);
    expect(p.resumen).toBe("Registró pago #9 · Proveedor Uno · Q123.45 · Transferencia · Ref. CH-77 · Facturas: A-100");
    const r = parsearEventoCxp(fila("cxp_reversar_pago", { entidadId: 5, pagoId: 9, usuarioId: 91, proveedorId: 3, montoTotal: "123.45", motivo: "Error de banco", aplicaciones: [{ facturaId: 7, documento: "A-100", monto: "123.45" }] }), res);
    expect(r.resumen).toBe("Reversó pago #9 · Proveedor Uno · Q123.45 · Facturas: A-100 · Motivo: Error de banco");
  });
  it("configuración fiscal: muestra antes → después solo de lo que cambió", () => {
    const antes = { regimenFiscal: "GENERAL", sujetoIsr: false, cuentaProveedorId: 1, cuentaAnticipoId: null, cuentaGastoId: null, activo: true };
    const despues = { ...antes, sujetoIsr: true, cuentaGastoId: 4 };
    expect(cambiosConfig(antes, despues)).toEqual([{ campo: "Sujeto a ISR", antes: "No", despues: "Sí" }, { campo: "Cuenta de gasto", antes: null, despues: "4" }]);
    const e = parsearEventoCxp(fila("cxp_actualizar_config_proveedor", { entidadId: 5, proveedorId: 3, usuarioId: 91, antes, despues }), res);
    expect(e.resumen).toBe("Actualizó configuración fiscal del proveedor · Proveedor Uno");
    expect(e.cambios).toHaveLength(2);
    expect(cambiosConfig(null, despues).length).toBeGreaterThan(0); // creación: todo es «nuevo»
  });
  it("un detalle ilegible no rompe la lectura", () => {
    const e = parsearEventoCxp({ id: 1, usuario: null, accion: "cxp_anular_factura", detalle: "{no json", creado_en: "2026-10-19 10:00:00" });
    expect(e.usuario).toBeNull();
    expect(e.resumen).toBe("Anuló factura");
  });
});

describe("GET bitácora de CxP: permiso propio, ámbito y filtros", () => {
  const req = (qs = "entidad=5") => new Request(`http://l/x?${qs}`);
  beforeEach(() => {
    vi.resetAllMocks();
    m.guard.mockResolvedValue({ empresa: { id: 1 }, session: { id: 91, username: "op", rol: "Contabilidad" } });
    m.listar.mockResolvedValue({ eventos: [], totalReal: 0, page: 1, pageSize: 25 });
  });
  it("exige cxp_bitacora:ver y no consulta sin permiso", async () => {
    m.guard.mockResolvedValue({ error: new Response("{}", { status: 403 }) });
    expect((await listarBitacoraCxpHttp(req(), "e")).status).toBe(403);
    expect(m.guard.mock.calls[0].slice(1, 3)).toEqual(["cxp_bitacora", "ver"]);
    expect(m.listar).not.toHaveBeenCalled();
  });
  it("empresa de la sesión y entidad del ámbito; filtros saneados", async () => {
    const r = await listarBitacoraCxpHttp(req("entidad=5&accion=cxp_reversar_pago&usuario=conta&fechaDesde=2026-10-01&fechaHasta=basura&page=2&empresaId=99"), "e");
    expect(r.status).toBe(200);
    expect(m.listar).toHaveBeenCalledWith(1, 5, { accion: "cxp_reversar_pago", usuario: "conta", fechaDesde: "2026-10-01", fechaHasta: undefined, page: 2, pageSize: undefined });
  });
  it("rechaza una acción desconocida y requiere entidad", async () => {
    expect((await listarBitacoraCxpHttp(req("entidad=5&accion=drop_table"), "e")).status).toBe(400);
    expect((await listarBitacoraCxpHttp(req(""), "e")).status).toBeGreaterThanOrEqual(400);
    expect(m.listar).not.toHaveBeenCalled();
  });
});

describe("arquitectura: solo lectura, sin tabla nueva, y los eventos son transaccionales", () => {
  const leer = (p: string) => readFileSync(p, "utf8");
  it("bitacora.ts no escribe (sin INSERT/UPDATE/DELETE) y consulta `auditoria` acotada por empresa y entidad", () => {
    const src = leer("src/lib/contabilidad/cxp/bitacora.ts");
    expect(src).not.toMatch(/INSERT|UPDATE |DELETE|DROP|ALTER/i);
    expect(src).toContain("a.empresa_id = ?");
    expect(src).toContain("$.entidadId");
  });
  it("cada movimiento escribe su evento con la conexión de la transacción (antes del commit)", () => {
    for (const [f, accion] of [["facturas", "cxp_registrar_factura"], ["facturas", "cxp_anular_factura"], ["pagos", "cxp_registrar_pago"], ["pagos", "cxp_reversar_pago"], ["proveedor-fiscal", "cxp_crear_config_proveedor"]] as const) {
      const src = leer(`src/lib/contabilidad/cxp/${f}.ts`);
      const i = src.indexOf(accion);
      expect(i, accion).toBeGreaterThan(0);
      expect(src.lastIndexOf("registrarAuditoriaTx(conn", i), accion).toBeGreaterThan(0);
      expect(src.indexOf("conn.commit()", i), accion).toBeGreaterThan(i);
    }
    expect(ACCIONES_BITACORA_CXP).toContain("cxp_actualizar_config_proveedor");
  });
  it("la UI muestra la pestaña solo con puedeVerBitacora y la página lo toma del permiso propio", () => {
    const ui = leer("src/components/contabilidad/cxp-client.tsx"), pagina = leer("src/app/e/[slug]/contabilidad/cxp/page.tsx");
    expect(ui).toMatch(/puedeVerBitacora && <button .*>Bitácora<\/button>/);
    expect(ui).toMatch(/vista === "bitacora" && puedeVerBitacora/);
    expect(pagina).toContain('puedeVerBitacora: p("cxp_bitacora", "ver")');
  });
});
