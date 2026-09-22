import PDFDocument from "pdfkit";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LOGO_KUIQTRANS_HEADER, LOGO_MONACO } from "@/lib/tms/cotizacion-pdf-assets";

vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantCotizaciones: vi.fn(), requireTenantCotizacionesCosteo: vi.fn() }));
vi.mock("@/lib/tms/cotizaciones", async (importarOriginal) => ({
  ...(await importarOriginal<typeof import("@/lib/tms/cotizaciones")>()),
  crearCotizacion: vi.fn(), actualizarCotizacion: vi.fn(), obtenerCotizacion: vi.fn(), duplicarCotizacion: vi.fn(), listarCotizaciones: vi.fn(),
}));

import { requireTenantCotizaciones } from "@/lib/tenant";
import { actualizarCotizacion, crearCotizacion, duplicarCotizacion, obtenerCotizacion } from "@/lib/tms/cotizaciones";
import { COTIZACION_DOC } from "@/lib/tms/cotizacion-documento.fixture";
import { POST as crear } from "./route";
import { PATCH as editar } from "./[id]/route";
import { POST as duplicar } from "./[id]/duplicar/route";
import { GET as pdf } from "./[id]/pdf/route";

const ctx = (id = "123") => ({ params: Promise.resolve({ slug: "kt-monaco", id }) });
const json = (body: unknown) => ({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const BASE = { clienteId: 3, tarifaCotizada: 1400, fechaEmision: "2026-09-08" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantCotizaciones).mockResolvedValue({ error: null, empresa: { id: 7, nombre: "Kuiqtrans / Logiservicios Mónaco" }, session: { username: "admin" } } as never);
  vi.mocked(crearCotizacion).mockResolvedValue(COTIZACION_DOC);
  vi.mocked(actualizarCotizacion).mockResolvedValue(COTIZACION_DOC);
  vi.mocked(obtenerCotizacion).mockResolvedValue(COTIZACION_DOC);
  vi.mocked(duplicarCotizacion).mockResolvedValue({ ...COTIZACION_DOC, id: 124, codigo: "COT-000124" });
});

describe("POST /tms/cotizaciones — documento comercial", () => {
  it("guarda marca, atención, cargo y unidad con la empresa de la sesión", async () => {
    const res = await crear(new Request("http://x/api", json({ ...BASE, documentoEmisor: "MONACO", atencionNombre: "Claudia Cordero", atencionCargo: "Compras", unidadDescripcion: "Camión 5 toneladas", empresaId: 99 })), ctx());
    expect(res.status).toBe(200);
    const [empresaId, datos] = vi.mocked(crearCotizacion).mock.calls[0];
    expect(empresaId).toBe(7);
    expect(datos).toMatchObject({ documentoEmisor: "MONACO", atencionNombre: "Claudia Cordero", atencionCargo: "Compras", unidadDescripcion: "Camión 5 toneladas" });
    expect(datos).not.toHaveProperty("empresaId");
  });

  it("sin documentoEmisor no lo inventa en la ruta (el default lo aplica la capa de datos)", async () => {
    await crear(new Request("http://x/api", json(BASE)), ctx());
    expect(vi.mocked(crearCotizacion).mock.calls[0][1].documentoEmisor).toBeUndefined();
  });

  it.each(["kuiqtrans", "SITSA", "", 5, null])("rechaza documentoEmisor inválido %j con 400 y sin crear", async (malo) => {
    const res = await crear(new Request("http://x/api", json({ ...BASE, documentoEmisor: malo })), ctx());
    expect(res.status).toBe(400);
    expect(crearCotizacion).not.toHaveBeenCalled();
  });

  it("rechaza atención/cargo/unidad de más de 160 caracteres", async () => {
    for (const campo of ["atencionNombre", "atencionCargo", "unidadDescripcion"]) {
      const res = await crear(new Request("http://x/api", json({ ...BASE, [campo]: "x".repeat(161) })), ctx());
      expect(res.status).toBe(400);
    }
    expect(crearCotizacion).not.toHaveBeenCalled();
  });

  it("atención, cargo y unidad aceptan null (opcionales)", async () => {
    const res = await crear(new Request("http://x/api", json({ ...BASE, atencionNombre: null, atencionCargo: null, unidadDescripcion: null })), ctx());
    expect(res.status).toBe(200);
  });
});

describe("POST /tms/cotizaciones — líneas adicionales (varias rutas/destinos)", () => {
  it("pasa lineasAdicionales tal cual a crearCotizacion", async () => {
    const lineas = [{ origenTexto: "PriceSmart Pradera", destinoTexto: "PriceSmart Pradera", unidadDescripcion: "1 Tonelada", tarifaCotizada: 937.5 }];
    const res = await crear(new Request("http://x/api", json({ ...BASE, lineasAdicionales: lineas })), ctx());
    expect(res.status).toBe(200);
    expect(vi.mocked(crearCotizacion).mock.calls[0][1].lineasAdicionales).toEqual(lineas);
  });

  it("rechaza una línea adicional con precio <= 0 (400, sin crear)", async () => {
    const res = await crear(new Request("http://x/api", json({ ...BASE, lineasAdicionales: [{ tarifaCotizada: 0 }] })), ctx());
    expect(res.status).toBe(400);
    expect(crearCotizacion).not.toHaveBeenCalled();
  });

  it("rechaza más de 50 líneas adicionales (400, sin crear)", async () => {
    const muchas = Array.from({ length: 51 }, () => ({ tarifaCotizada: 100 }));
    const res = await crear(new Request("http://x/api", json({ ...BASE, lineasAdicionales: muchas })), ctx());
    expect(res.status).toBe(400);
    expect(crearCotizacion).not.toHaveBeenCalled();
  });

  it("sin lineasAdicionales, el campo llega undefined a la capa de datos (comportamiento de siempre)", async () => {
    await crear(new Request("http://x/api", json(BASE)), ctx());
    expect(vi.mocked(crearCotizacion).mock.calls[0][1].lineasAdicionales).toBeUndefined();
  });
});

describe("PATCH /tms/cotizaciones/[id] — documento comercial", () => {
  const patch = (body: unknown) => editar(new Request("http://x/api", { ...json(body), method: "PATCH" }), ctx());

  it("en Borrador cambia la marca y pasa empresa e id de la sesión/ruta", async () => {
    const res = await patch({ documentoEmisor: "KUIQTRANS", unidadDescripcion: "Cabezal 53'" });
    expect(res.status).toBe(200);
    expect(vi.mocked(actualizarCotizacion).mock.calls[0].slice(0, 3)).toEqual([7, 123, { documentoEmisor: "KUIQTRANS", unidadDescripcion: "Cabezal 53'" }]);
  });

  it("valor inválido => 400 sin llamar a la capa de datos", async () => {
    const res = await patch({ documentoEmisor: "OTRA" });
    expect(res.status).toBe(400);
    expect(actualizarCotizacion).not.toHaveBeenCalled();
  });

  it("una cotización Enviada no se edita: el error de la capa de datos llega como 400 (sin bypass)", async () => {
    vi.mocked(actualizarCotizacion).mockRejectedValue(new Error('No se puede editar una cotización en estado "Enviada" — solo mientras está en Borrador.'));
    const res = await patch({ documentoEmisor: "MONACO" });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("solo mientras está en Borrador");
  });

  it("líneas adicionales: se pasan tal cual a actualizarCotizacion (incluido [] para vaciarlas)", async () => {
    const res = await patch({ lineasAdicionales: [] });
    expect(res.status).toBe(200);
    expect(vi.mocked(actualizarCotizacion).mock.calls[0][2]).toEqual({ lineasAdicionales: [] });
  });

  it("líneas adicionales: rechaza precio <= 0 (400, sin llamar a la capa de datos)", async () => {
    const res = await patch({ lineasAdicionales: [{ tarifaCotizada: -5 }] });
    expect(res.status).toBe(400);
    expect(actualizarCotizacion).not.toHaveBeenCalled();
  });
});

describe("POST /tms/cotizaciones/[id]/duplicar", () => {
  it("duplica con la empresa de la sesión (la capa de datos copia marca/atención/cargo/unidad)", async () => {
    const res = await duplicar(new Request("http://x/api", { method: "POST" }), ctx());
    expect(res.status).toBe(200);
    expect(vi.mocked(duplicarCotizacion).mock.calls[0]).toEqual([7, 123, "admin"]);
  });
});

describe("GET /tms/cotizaciones/[id]/pdf", () => {
  const texto = async (fn: () => Promise<Response>) => {
    const espiaTexto = vi.spyOn(PDFDocument.prototype, "text");
    const espiaImagen = vi.spyOn(PDFDocument.prototype, "image");
    const res = await fn();
    const textos = espiaTexto.mock.calls.map((c) => String(c[0]));
    const imagenes = espiaImagen.mock.calls.map((c) => c[0]);
    espiaTexto.mockRestore();
    espiaImagen.mockRestore();
    return { res, textos, imagenes };
  };

  it("nombre de archivo COT-000123-Monaco.pdf, PDF válido, sin caché", async () => {
    const { res } = await texto(() => pdf(new Request("http://x/api"), ctx()));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toBe('attachment; filename="COT-000123-Monaco.pdf"');
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("KUIQTRANS => COT-000123-KuiqTrans.pdf y plantilla KuiqTrans (logo real), aunque la empresa activa se llame «Kuiqtrans / Logiservicios Mónaco»", async () => {
    vi.mocked(obtenerCotizacion).mockResolvedValue({ ...COTIZACION_DOC, documentoEmisor: "KUIQTRANS" });
    const { res, textos, imagenes } = await texto(() => pdf(new Request("http://x/api"), ctx()));
    expect(res.headers.get("Content-Disposition")).toContain("COT-000123-KuiqTrans.pdf");
    expect(imagenes).toContain(LOGO_KUIQTRANS_HEADER);
    expect(imagenes).not.toContain(LOGO_MONACO);
    expect(textos.join("\n")).not.toContain("Kuiqtrans / Logiservicios Mónaco"); // el nombre de la empresa activa no se imprime ni decide
  });

  it("la marca guardada manda aunque cambien los defaults: MONACO sigue saliendo con el logo de Mónaco", async () => {
    const { imagenes } = await texto(() => pdf(new Request("http://x/api"), ctx()));
    expect(imagenes).toContain(LOGO_MONACO);
    expect(imagenes).not.toContain(LOGO_KUIQTRANS_HEADER);
  });

  it("aislamiento por empresa: relee la cotización con la empresa de la sesión; 404 si no existe en ella", async () => {
    vi.mocked(obtenerCotizacion).mockResolvedValue(null);
    const res = await pdf(new Request("http://x/api"), ctx("500"));
    expect(res.status).toBe(404);
    expect(obtenerCotizacion).toHaveBeenCalledWith(7, 500);
  });

  it("sin permiso: devuelve el error del guard y no consulta la cotización", async () => {
    vi.mocked(requireTenantCotizaciones).mockResolvedValue({ error: new Response("{}", { status: 403 }) } as never);
    const res = await pdf(new Request("http://x/api"), ctx());
    expect(res.status).toBe(403);
    expect(obtenerCotizacion).not.toHaveBeenCalled();
  });
});
