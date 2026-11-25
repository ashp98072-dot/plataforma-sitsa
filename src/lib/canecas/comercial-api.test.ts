import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ acceso: vi.fn(), query: vi.fn(), venta: vi.fn(), anular: vi.fn(), pertenece: vi.fn(), redis: vi.fn(), revRedis: vi.fn(), resumen: vi.fn(), porProducto: vi.fn(), historial: vi.fn(), pendientes: vi.fn(), mapeos: vi.fn(), reversarSalida: vi.fn(), registrarSalida: vi.fn() }));
vi.mock("@/lib/canecas/acceso", () => ({ accesoCanecas: mocks.acceso }));
vi.mock("@/lib/db", () => ({ getPool: () => ({ marca: "pool" }), query: mocks.query }));
vi.mock("@/lib/canecas/ventas", () => ({ registrarVenta: mocks.venta, anularVenta: mocks.anular, salidaPerteneceAVenta: mocks.pertenece }));
vi.mock("@/lib/canecas/redistribucion", () => ({ registrarRedistribucion: mocks.redis, reversarRedistribucion: mocks.revRedis }));
vi.mock("@/lib/canecas/reportes", () => ({ reporteResumen: mocks.resumen, reportePorProducto: mocks.porProducto, historialVentas: mocks.historial }));
vi.mock("@/lib/canecas/historico-proveedores", () => ({ comprasPendientesDeMapeo: mocks.pendientes, mapeosRealizados: mocks.mapeos }));
vi.mock("@/lib/canecas/salidas-fifo", () => ({ registrarSalidaFifo: mocks.registrarSalida, reversarSalidaFifo: mocks.reversarSalida }));
import { GET, POST } from "@/app/api/empresas/[slug]/canecas/[recurso]/route";
const ctx = (recurso: string) => ({ params: Promise.resolve({ slug: "uno", recurso }) });
const sesion = { empresa: { id: 5 }, session: { id: 7, username: "u" } };
const denegado = { error: new Response(null, { status: 403 }) };
const k = "a0000000-0000-4000-8000-000000000001";
const venta = { cliente_id: 2, producto_id: 3, ubicacion_id: 4, fecha_venta: "2026-11-10", documento: "FAC-1", cantidad: 8, precio_unitario: "95.00", clave_operacion: k };
const post = (recurso: string, cuerpo: unknown) => POST(new Request("http://local", { method: "POST", body: JSON.stringify(cuerpo) }), ctx(recurso));
const get = (recurso: string, qs = "") => GET(new Request(`http://local/x${qs}`), ctx(recurso));

describe("API comercial de Canecas", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.acceso.mockResolvedValue(sesion); });
  describe("ventas_pos (venta tipo POS)", () => {
    const pos = { cliente_id: 2, ubicacion_id: 4, direccion_entrega: "Zona 4, Ciudad", cantidad: 8, precio_unitario: "95.00", clave_operacion: k };
    it("registra con empresa y usuario de la sesión, sin producto, fecha ni documento, y devuelve el número automático", async () => {
      mocks.venta.mockResolvedValue({ id: "9", documento: "VTA-000009", total: "Q 760.00", costo: "Q 640.00", utilidad: "Q 120.00", yaRegistrada: false });
      const res = await post("ventas_pos", pos);
      expect(res.status).toBe(201);
      expect(mocks.venta).toHaveBeenCalledWith({ marca: "pool" }, 5, 7, { clienteId: 2, ubicacionId: 4, direccionEntrega: "Zona 4, Ciudad", cantidad: 8, precio: "95.00", claveOperacion: k });
      expect(await res.json()).toMatchObject({ id: "9", documento: "VTA-000009", mensaje: "Venta VTA-000009 registrada: ingreso Q 760.00, costo FIFO Q 640.00, utilidad bruta Q 120.00." });
    });
    it.each([{ producto_id: 3 }, { documento: "FAC-1" }, { fecha_venta: "2026-11-10" }, { empresa_id: 9 }, { moneda: "USD" }, { direccion_entrega: "" }, { direccion_entrega: "x".repeat(501) }, { cantidad: 0 }, { clave_operacion: "no" }])("rechaza lo que el servidor decide o lo inválido: %j", async extra => {
      expect((await post("ventas_pos", { ...pos, ...extra })).status).toBe(400);
      expect(mocks.venta).not.toHaveBeenCalled();
    });
    it("exige la dirección de entrega y traduce el error de caneca ambigua", async () => {
      const { direccion_entrega: _omitida, ...sinDireccion } = pos; void _omitida;
      expect((await post("ventas_pos", sinDireccion)).status).toBe(400);
      mocks.venta.mockRejectedValue(new Error("PRODUCTO_AMBIGUO"));
      const res = await post("ventas_pos", pos);
      expect(res.status).toBe(409); expect((await res.json()).error).toContain("más de una caneca");
    });
    it("el recurso histórico ventas sigue aceptando su esquema anterior (producto, fecha y documento)", async () => {
      mocks.venta.mockResolvedValue({ id: "9", total: "Q 1.00", costo: "Q 0.00", utilidad: "Q 1.00", yaRegistrada: false });
      expect((await post("ventas", { cliente_id: 2, producto_id: 3, ubicacion_id: 4, fecha_venta: "2026-11-10", documento: "FAC-1", cantidad: 8, precio_unitario: "95.00", clave_operacion: k })).status).toBe(201);
      expect(mocks.venta.mock.calls[0][3]).toEqual({ clienteId: 2, productoId: 3, ubicacionId: 4, fechaVenta: "2026-11-10", documento: "FAC-1", cantidad: 8, precio: "95.00", claveOperacion: k });
    });
  });
  describe("ventas", () => {
    it("registra con la empresa y el usuario de la sesión y muestra costo y utilidad solo con permiso de costos", async () => {
      mocks.venta.mockResolvedValue({ id: "9", total: "Q 760.00", costo: "Q 640.00", utilidad: "Q 120.00", yaRegistrada: false });
      const res = await post("ventas", venta);
      expect(res.status).toBe(201);
      expect(mocks.acceso).toHaveBeenCalledWith("uno", "ventas");
      expect(mocks.venta).toHaveBeenCalledWith({ marca: "pool" }, 5, 7, { clienteId: 2, productoId: 3, ubicacionId: 4, fechaVenta: "2026-11-10", documento: "FAC-1", cantidad: 8, precio: "95.00", claveOperacion: k });
      expect((await res.json()).mensaje).toBe("Venta registrada: ingreso Q 760.00, costo FIFO Q 640.00, utilidad bruta Q 120.00.");
      mocks.acceso.mockResolvedValueOnce(sesion).mockResolvedValueOnce(denegado);
      const sinCostos = await (await post("ventas", { ...venta, clave_operacion: "a0000000-0000-4000-8000-000000000002" })).json();
      expect(sinCostos).toMatchObject({ mensaje: "Venta registrada: ingreso Q 760.00." });
      expect(sinCostos).not.toHaveProperty("costo"); expect(sinCostos).not.toHaveProperty("utilidad");
    });
    it("un reintento ya registrado responde 200", async () => {
      mocks.venta.mockResolvedValue({ id: "9", total: "Q 1.00", costo: "Q 0.00", utilidad: "Q 1.00", yaRegistrada: true });
      expect((await post("ventas", venta)).status).toBe(200);
    });
    it("deniega sin permiso de ventas y no toca la base", async () => {
      mocks.acceso.mockResolvedValue(denegado);
      expect((await post("ventas", venta)).status).toBe(403);
      expect((await post("anular_venta", { venta_id: "1", motivo: "x" })).status).toBe(403);
      expect((await post("redistribuciones", { compra_id: 1, ubicacion_id: 1, cantidad_final: 2, motivo: "x", clave_operacion: k })).status).toBe(403);
      expect(mocks.venta).not.toHaveBeenCalled(); expect(mocks.anular).not.toHaveBeenCalled(); expect(mocks.redis).not.toHaveBeenCalled();
    });
    it.each([{ empresa_id: 99 }, { creado_por: 99 }, { moneda: "USD" }, { total: "1" }, { costo: "0" }])("rechaza datos que el cliente no debe enviar: %j", async extra => {
      expect((await post("ventas", { ...venta, ...extra })).status).toBe(400);
      expect(mocks.venta).not.toHaveBeenCalled();
    });
    it.each([{ cantidad: 0 }, { cantidad: 1.5 }, { fecha_venta: "10/11/2026" }, { documento: "" }, { clave_operacion: "no" }, { cliente_id: "x" }])("rechaza entradas inválidas: %j", async cambio => {
      expect((await post("ventas", { ...venta, ...cambio })).status).toBe(400);
    });
    it.each([["SALDO_INSUFICIENTE", 409, "No hay suficientes canecas"], ["CLIENTE_INVALIDO", 409, "inactivo"], ["COSTO_PENDIENTE", 409, "sin costo conocido"], ["VENTA_INVALIDA", 400, "mayor que Q0.00"], ["CLAVE_REUTILIZADA", 409, "otros datos"], ["RESERVAS_PENDIENTES", 409, "reservadas"]])("traduce %s a un mensaje claro", async (codigo, estado, texto) => {
      mocks.venta.mockRejectedValue(new Error(codigo));
      const res = await post("ventas", venta);
      expect(res.status).toBe(estado);
      expect((await res.json()).error).toContain(texto);
    });
    it("no expone detalles de errores inesperados", async () => {
      mocks.venta.mockRejectedValue(new Error("ER_SECRETO: tabla interna"));
      const res = await post("ventas", venta);
      expect(res.status).toBe(500);
      expect(JSON.stringify(await res.json())).not.toMatch(/ER_SECRETO|tabla interna/);
    });
    it("anula con el usuario de la sesión y responde 404 si la venta no es de la empresa", async () => {
      mocks.anular.mockResolvedValue({ yaAnulada: false });
      expect((await post("anular_venta", { venta_id: "12", motivo: "Devolución" })).status).toBe(200);
      expect(mocks.anular).toHaveBeenCalledWith({ marca: "pool" }, 5, 7, "12", "Devolución");
      mocks.anular.mockRejectedValue(new Error("VENTA_NO_ENCONTRADA"));
      expect((await post("anular_venta", { venta_id: "13", motivo: "x" })).status).toBe(404);
    });
    it("una salida que pertenece a una venta no se revierte por separado", async () => {
      mocks.pertenece.mockResolvedValue(true);
      const res = await post("reversar_salida", { salida_id: "5", motivo: "x" });
      expect(res.status).toBe(409);
      expect((await res.json()).error).toContain("anule la venta");
      expect(mocks.reversarSalida).not.toHaveBeenCalled();
      expect(mocks.pertenece).toHaveBeenCalledWith({ marca: "pool" }, 5, "5");
    });
  });
  describe("Ajuste de canecas (redistribución)", () => {
    it("registra el ajuste con la cantidad final y un documento generado", async () => {
      mocks.redis.mockResolvedValue({ id: "3", yaRegistrada: false });
      const res = await post("redistribuciones", { compra_id: 8, ubicacion_id: 1, cantidad_final: 25, motivo: "Salieron 5 canecas extra", clave_operacion: k });
      expect(res.status).toBe(201);
      expect(mocks.redis).toHaveBeenCalledWith({ marca: "pool" }, 5, 7, { compraId: 8, ubicacionId: 1, cantidadResultante: 25, documento: "Ajuste de canecas (compra 8)", motivo: "Salieron 5 canecas extra", claveOperacion: k });
      expect((await res.json()).mensaje).toBe("Ajuste de canecas registrado.");
    });
    it.each([["RESERVAS_PENDIENTES", "reservadas"], ["COSTO_PENDIENTE", "sin costo conocido"], ["CAPAS_INSUFICIENTES", "No hay canecas disponibles"], ["REDISTRIBUCION_CONSUMIDA", "anule primero"]])("explica %s", async (codigo, texto) => {
      mocks.redis.mockRejectedValue(new Error(codigo)); mocks.revRedis.mockRejectedValue(new Error(codigo));
      const a = await post("redistribuciones", { compra_id: 8, ubicacion_id: 1, cantidad_final: 25, motivo: "x", clave_operacion: k });
      const b = await post("reversar_redistribucion", { redistribucion_id: "4", motivo: "x" });
      for (const r of [a, b]) { expect(r.status).toBe(409); expect((await r.json()).error).toContain(texto); }
    });
    it("rechaza cantidades finales no enteras o cero", async () => {
      for (const cantidad_final of [0, -2, 2.5]) expect((await post("redistribuciones", { compra_id: 8, ubicacion_id: 1, cantidad_final, motivo: "x", clave_operacion: k })).status).toBe(400);
    });
  });
  describe("reportes y consultas", () => {
    it("lee los filtros, usa la empresa de la sesión y oculta costos sin permiso", async () => {
      mocks.resumen.mockResolvedValue({ vendidas: 1 });
      mocks.acceso.mockResolvedValueOnce(sesion).mockResolvedValueOnce(denegado);
      const res = await get("reporte_resumen", "?desde=2026-11-01&hasta=2026-11-30&producto_id=3&cliente_id=2");
      expect(res.status).toBe(200);
      expect(mocks.resumen).toHaveBeenCalledWith({ marca: "pool" }, 5, { desde: "2026-11-01", hasta: "2026-11-30", productoId: 3, clienteId: 2 }, false);
      expect(mocks.acceso.mock.calls.map(c => c[1])).toEqual(["ventas", "compras"]);
      mocks.acceso.mockResolvedValue(sesion);
      mocks.historial.mockResolvedValue([]);
      await get("ventas");
      expect(mocks.historial).toHaveBeenCalledWith({ marca: "pool" }, 5, { desde: undefined, hasta: undefined, productoId: undefined, clienteId: undefined }, true);
    });
    it("responde 400 ante filtros inválidos y 403 sin permiso, sin consultar", async () => {
      mocks.resumen.mockRejectedValue(new Error("FILTRO_INVALIDO"));
      expect((await get("reporte_resumen", "?desde=ayer")).status).toBe(400);
      mocks.acceso.mockResolvedValue(denegado);
      for (const r of ["ventas", "reporte_resumen", "reporte_productos", "redistribuciones", "compras_historicas", "mapeos_proveedor"]) expect((await get(r)).status).toBe(403);
      expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.pendientes).not.toHaveBeenCalled();
    });
    it("el listado de ajustes filtra por la empresa de la sesión y oculta el costo sin permiso", async () => {
      mocks.query.mockResolvedValue([]);
      mocks.acceso.mockResolvedValueOnce(sesion).mockResolvedValueOnce(denegado);
      expect((await get("redistribuciones")).status).toBe(200);
      expect(mocks.query.mock.calls[0][0]).not.toMatch(/costo_total/);
      expect(mocks.query.mock.calls[0][0]).toMatch(/WHERE r\.empresa_id=\?/);
      expect(mocks.query.mock.calls[0][1]).toEqual([5]);
    });
    it("la información histórica de proveedores exige permiso de catálogo", async () => {
      mocks.pendientes.mockResolvedValue([]); mocks.mapeos.mockResolvedValue([]);
      expect((await get("compras_historicas")).status).toBe(200);
      expect((await get("mapeos_proveedor")).status).toBe(200);
      expect(mocks.acceso.mock.calls.every(c => c[1] === "catalogo")).toBe(true);
      expect(mocks.pendientes).toHaveBeenCalledWith({ marca: "pool" }, 5);
    });
  });
});
