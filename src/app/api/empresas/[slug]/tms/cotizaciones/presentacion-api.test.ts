import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantCotizaciones: vi.fn(), requireTenantCotizacionesAjustes: vi.fn(), requireTenantCotizacionesCosteo: vi.fn() }));
vi.mock("@/lib/tms/cotizacion-presentacion", () => ({ obtenerPresentacionComercial: vi.fn(), guardarPresentacionComercial: vi.fn() }));
vi.mock("@/lib/tms/cotizaciones", async (importarOriginal) => ({
  ...(await importarOriginal<typeof import("@/lib/tms/cotizaciones")>()),
  crearCotizacion: vi.fn(), actualizarCotizacion: vi.fn(), obtenerCotizacion: vi.fn(),
}));

import { requireTenantCotizaciones, requireTenantCotizacionesAjustes } from "@/lib/tenant";
import { guardarPresentacionComercial, obtenerPresentacionComercial } from "@/lib/tms/cotizacion-presentacion";
import { crearCotizacion, actualizarCotizacion } from "@/lib/tms/cotizaciones";
import { COTIZACION_DOC } from "@/lib/tms/cotizacion-documento.fixture";
import { GET as getDefaults } from "./presentacion/route";
import { POST as guardarDefaults } from "./ajustes/presentacion/route";
import { POST as crear } from "./route";
import { PATCH as editar } from "./[id]/route";

const ctx = { params: Promise.resolve({ slug: "kt-monaco" }) };
const ctxId = { params: Promise.resolve({ slug: "kt-monaco", id: "123" }) };
const json = (body: unknown, method = "POST") => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const DEFAULTS = {
  KUIQTRANS: { mensaje: "Saludo KuiqTrans default.", cierre: "Cierre KuiqTrans default." },
  MONACO: { mensaje: "Saludo Mónaco default.", cierre: "Cierre Mónaco default." },
};
const BASE = { clienteId: 3, tarifaCotizada: 1400, fechaEmision: "2026-09-08" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantCotizaciones).mockResolvedValue({ error: null, empresa: { id: 7 }, session: { username: "admin" } } as never);
  vi.mocked(requireTenantCotizacionesAjustes).mockResolvedValue({ error: null, empresa: { id: 7 }, session: { username: "admin" } } as never);
  vi.mocked(obtenerPresentacionComercial).mockResolvedValue(DEFAULTS as never);
  vi.mocked(crearCotizacion).mockResolvedValue(COTIZACION_DOC);
  vi.mocked(actualizarCotizacion).mockResolvedValue(COTIZACION_DOC);
});

describe("GET /tms/cotizaciones/presentacion — lectura para el formulario", () => {
  it("responde los defaults con el permiso base de Cotizaciones (no exige Ajustes)", async () => {
    const res = await getDefaults(new Request("http://x/api"), ctx);
    expect(res.status).toBe(200);
    expect((await res.json()).presentacion).toEqual(DEFAULTS);
    expect(requireTenantCotizaciones).toHaveBeenCalledWith("kt-monaco", "ver");
    expect(obtenerPresentacionComercial).toHaveBeenCalledWith(7);
  });

  it("sin permiso, propaga el error del guard y no consulta nada", async () => {
    vi.mocked(requireTenantCotizaciones).mockResolvedValue({ error: new Response("{}", { status: 403 }) } as never);
    const res = await getDefaults(new Request("http://x/api"), ctx);
    expect(res.status).toBe(403);
    expect(obtenerPresentacionComercial).not.toHaveBeenCalled();
  });

  it("sin caché (private, no-store)", async () => {
    const res = await getDefaults(new Request("http://x/api"), ctx);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });
});

describe("POST /tms/cotizaciones/ajustes/presentacion — guardar defaults", () => {
  it("exige el permiso de Ajustes (editar), no el permiso base de Cotizaciones", async () => {
    await guardarDefaults(new Request("http://x/api", json({ MONACO: { mensaje: "Nuevo." } })), ctx);
    expect(requireTenantCotizacionesAjustes).toHaveBeenCalledWith("kt-monaco", "editar");
  });

  it("sin ese permiso, no llama a guardarPresentacionComercial", async () => {
    vi.mocked(requireTenantCotizacionesAjustes).mockResolvedValue({ error: new Response("{}", { status: 403 }) } as never);
    const res = await guardarDefaults(new Request("http://x/api", json({ MONACO: { mensaje: "x" } })), ctx);
    expect(res.status).toBe(403);
    expect(guardarPresentacionComercial).not.toHaveBeenCalled();
  });

  it("guarda con la empresa de la sesión y devuelve los defaults actualizados", async () => {
    const res = await guardarDefaults(new Request("http://x/api", json({ MONACO: { mensaje: "Nuevo mensaje." } })), ctx);
    expect(res.status).toBe(200);
    expect(guardarPresentacionComercial).toHaveBeenCalledWith(7, { MONACO: { mensaje: "Nuevo mensaje." } });
    expect((await res.json()).presentacion).toEqual(DEFAULTS);
  });

  it("mensaje/cierre de más de 2000 caracteres => 400 sin guardar (rechazado por zod)", async () => {
    const res = await guardarDefaults(new Request("http://x/api", json({ MONACO: { mensaje: "x".repeat(2001) } })), ctx);
    expect(res.status).toBe(400);
    expect(guardarPresentacionComercial).not.toHaveBeenCalled();
  });

  it("un error de la capa de datos (p. ej. texto inválido) llega como 400 con su mensaje", async () => {
    vi.mocked(guardarPresentacionComercial).mockRejectedValue(new Error("El mensaje predeterminado de KuiqTrans no puede exceder 2000 caracteres."));
    const res = await guardarDefaults(new Request("http://x/api", json({ KUIQTRANS: { mensaje: "x" } })), ctx);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("no puede exceder");
  });
});

describe("POST /tms/cotizaciones — resuelve el default al crear cuando se omite", () => {
  it("sin mensajeComercial/cierreComercial: resuelve el default de la MARCA elegida y lo guarda en la cotización", async () => {
    await crear(new Request("http://x/api", json({ ...BASE, documentoEmisor: "MONACO" })), ctx);
    expect(obtenerPresentacionComercial).toHaveBeenCalledWith(7);
    const datos = vi.mocked(crearCotizacion).mock.calls[0][1];
    expect(datos.mensajeComercial).toBe(DEFAULTS.MONACO.mensaje);
    expect(datos.cierreComercial).toBe(DEFAULTS.MONACO.cierre);
  });

  it("sin marca explícita, resuelve el default de KUIQTRANS (el default de la marca)", async () => {
    await crear(new Request("http://x/api", json(BASE)), ctx);
    const datos = vi.mocked(crearCotizacion).mock.calls[0][1];
    expect(datos.mensajeComercial).toBe(DEFAULTS.KUIQTRANS.mensaje);
  });

  it("con mensajeComercial explícito: se respeta tal cual, sin consultar los defaults", async () => {
    await crear(new Request("http://x/api", json({ ...BASE, mensajeComercial: "Mensaje escrito a mano.", cierreComercial: "Cierre a mano." })), ctx);
    expect(obtenerPresentacionComercial).not.toHaveBeenCalled();
    const datos = vi.mocked(crearCotizacion).mock.calls[0][1];
    expect(datos).toMatchObject({ mensajeComercial: "Mensaje escrito a mano.", cierreComercial: "Cierre a mano." });
  });

  it("mensajeComercial en blanco (solo espacios) se trata como omitido: se resuelve el default", async () => {
    await crear(new Request("http://x/api", json({ ...BASE, mensajeComercial: "   " })), ctx);
    expect(vi.mocked(crearCotizacion).mock.calls[0][1].mensajeComercial).toBe(DEFAULTS.KUIQTRANS.mensaje);
  });

  it("el default se resuelve con la empresa de la SESIÓN, nunca con una enviada por el cliente", async () => {
    await crear(new Request("http://x/api", json({ ...BASE, empresaId: 999 })), ctx);
    expect(obtenerPresentacionComercial).toHaveBeenCalledWith(7);
  });
});

describe("PATCH /tms/cotizaciones/[id] — no re-resuelve defaults", () => {
  it("cambiar de marca sin tocar mensajeComercial no lo pisa: no se consulta ningún default", async () => {
    await editar(new Request("http://x/api", { ...json({ documentoEmisor: "MONACO" }), method: "PATCH" }), ctxId);
    expect(obtenerPresentacionComercial).not.toHaveBeenCalled();
    expect(vi.mocked(actualizarCotizacion).mock.calls[0][2]).toEqual({ documentoEmisor: "MONACO" });
  });

  it("con mensajeComercial explícito, se pasa tal cual a la capa de datos", async () => {
    await editar(new Request("http://x/api", { ...json({ mensajeComercial: "Editado." }), method: "PATCH" }), ctxId);
    expect(vi.mocked(actualizarCotizacion).mock.calls[0][2]).toMatchObject({ mensajeComercial: "Editado." });
  });

  it("mensajeComercial de más de 2000 caracteres => 400, sin llamar a la capa de datos", async () => {
    const res = await editar(new Request("http://x/api", { ...json({ mensajeComercial: "x".repeat(2001) }), method: "PATCH" }), ctxId);
    expect(res.status).toBe(400);
    expect(actualizarCotizacion).not.toHaveBeenCalled();
  });
});
