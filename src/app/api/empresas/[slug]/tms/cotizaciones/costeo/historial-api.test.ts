import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/tenant", () => ({ requireTenantCotizaciones: vi.fn(), requireTenantCotizacionesCosteo: vi.fn() }));
vi.mock("@/lib/tms/cotizaciones", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tms/cotizaciones")>();
  return { ...actual, obtenerCotizacion: vi.fn() };
});
vi.mock("@/lib/tms/cotizacion-costeo-db", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tms/cotizacion-costeo-db")>();
  return { ...actual, listarHistorialCosteos: vi.fn() };
});
vi.mock("@/lib/tms/cotizacion-costeo-historial", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/tms/cotizacion-costeo-historial")>();
  return { ...actual, seleccionarCosteo: vi.fn() };
});
vi.mock("@/lib/db", () => ({ query: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));

import { requireTenantCotizaciones, requireTenantCotizacionesCosteo } from "@/lib/tenant";
import { obtenerCotizacion } from "@/lib/tms/cotizaciones";
import { listarHistorialCosteos } from "@/lib/tms/cotizacion-costeo-db";
import { ErrorSeleccionCosteo, MENSAJE_SELECCION_SOLO_BORRADOR, seleccionarCosteo } from "@/lib/tms/cotizacion-costeo-historial";
import { GET as historialGET } from "../[id]/costeo/historial/route";
import { POST as seleccionarPOST } from "../[id]/costeo/seleccionar/route";

const ctx = (id = "10") => ({ params: Promise.resolve({ slug: "kt", id }) });
const post = (body: unknown) => new Request("http://x/api", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const ok = (empresaId = 1) => ({ session: { id: 8, username: "admin", nombre: "Admin", rol: "Admin" }, empresa: { id: empresaId, modulos: ["tms"] } }) as never;
const denegado = () => ({ error: NextResponse.json({ error: "Sin permiso para el costeo interno de cotizaciones." }, { status: 403 }) }) as never;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantCotizaciones).mockResolvedValue(ok());
  vi.mocked(requireTenantCotizacionesCosteo).mockResolvedValue(ok());
});

describe("GET cotizaciones/[id]/costeo/historial", () => {
  it("exige cotizaciones_costeo:ver (el mismo permiso del costeo interno): sin él => 403 y no toca la base", async () => {
    vi.mocked(requireTenantCotizacionesCosteo).mockResolvedValue(denegado());
    const res = await historialGET(new Request("http://x"), ctx());
    expect(res.status).toBe(403); expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(requireTenantCotizacionesCosteo).toHaveBeenCalledWith("kt", "ver");
    expect(obtenerCotizacion).not.toHaveBeenCalled(); expect(listarHistorialCosteos).not.toHaveBeenCalled();
  });
  it("devuelve todas las versiones con la empresa del guard (nunca la del cliente), no-store", async () => {
    vi.mocked(requireTenantCotizacionesCosteo).mockResolvedValue(ok(3));
    vi.mocked(obtenerCotizacion).mockResolvedValue({ id: 10 } as never);
    vi.mocked(listarHistorialCosteos).mockResolvedValue([{ id: 57, version: 3 }, { id: 55, version: 1 }] as never);
    const res = await historialGET(new Request("http://x"), ctx("10"));
    expect(res.status).toBe(200); expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(obtenerCotizacion).toHaveBeenCalledWith(3, 10); expect(listarHistorialCosteos).toHaveBeenCalledWith(3, 10);
    expect((await res.json()).historial.map((h: { version: number }) => h.version)).toEqual([3, 1]);
  });
  it("cotización de otra empresa / inexistente => 404 sin leer costeos; id inválido => 404", async () => {
    vi.mocked(obtenerCotizacion).mockResolvedValue(null);
    expect((await historialGET(new Request("http://x"), ctx())).status).toBe(404);
    expect(listarHistorialCosteos).not.toHaveBeenCalled();
    for (const id of ["abc", "0", "-1", "99999999999"]) expect((await historialGET(new Request("http://x"), ctx(id))).status).toBe(404);
  });
  it("una cotización sin costeos devuelve historial vacío (200), no un error", async () => {
    vi.mocked(obtenerCotizacion).mockResolvedValue({ id: 10 } as never);
    vi.mocked(listarHistorialCosteos).mockResolvedValue([]);
    const res = await historialGET(new Request("http://x"), ctx());
    expect(res.status).toBe(200); expect(await res.json()).toEqual({ historial: [] });
  });
  it("es de solo lectura: el módulo de la ruta no exporta POST/PATCH/DELETE", async () => {
    const modulo = await import("../[id]/costeo/historial/route");
    expect(Object.keys(modulo).sort()).toEqual(["GET"]);
  });
});

describe("POST cotizaciones/[id]/costeo/seleccionar", () => {
  it("exige editar la cotización Y el costeo interno; sin permiso de costeo => 403 sin tocar nada", async () => {
    vi.mocked(requireTenantCotizacionesCosteo).mockResolvedValue(denegado());
    const res = await seleccionarPOST(post({ costeoId: 55 }), ctx());
    expect(res.status).toBe(403);
    expect(requireTenantCotizaciones).toHaveBeenCalledWith("kt", "editar"); expect(requireTenantCotizacionesCosteo).toHaveBeenCalledWith("kt", "editar");
    expect(seleccionarCosteo).not.toHaveBeenCalled();
  });
  it("sin permiso de editar la cotización => se devuelve el error del guard y no se selecciona", async () => {
    vi.mocked(requireTenantCotizaciones).mockResolvedValue({ error: NextResponse.json({ error: "Sin permiso." }, { status: 403 }) } as never);
    expect((await seleccionarPOST(post({ costeoId: 55 }), ctx())).status).toBe(403);
    expect(seleccionarCosteo).not.toHaveBeenCalled();
  });
  it("selecciona con empresa y usuario DE LA SESIÓN y la cotización de la ruta; el cliente solo aporta costeoId", async () => {
    vi.mocked(requireTenantCotizaciones).mockResolvedValue(ok(3));
    vi.mocked(seleccionarCosteo).mockResolvedValue({ costeoId: 55, version: 2, cambio: true });
    const res = await seleccionarPOST(post({ costeoId: 55, empresaId: 99, cotizacionId: 77 }), ctx("10"));
    // Campos extra (empresaId/cotizacionId enviados por el cliente) se rechazan: el esquema es estricto.
    expect(res.status).toBe(400); expect(seleccionarCosteo).not.toHaveBeenCalled();
    const bueno = await seleccionarPOST(post({ costeoId: 55 }), ctx("10"));
    expect(bueno.status).toBe(200);
    expect(seleccionarCosteo).toHaveBeenCalledWith(3, 10, 55, "admin");
    expect(await bueno.json()).toMatchObject({ costeoId: 55, version: 2, cambio: true, mensaje: "Costeo versión 2 seleccionado." });
  });
  it("si la versión ya era la utilizada, lo informa sin error", async () => {
    vi.mocked(seleccionarCosteo).mockResolvedValue({ costeoId: 55, version: 1, cambio: false });
    const res = await seleccionarPOST(post({ costeoId: 55 }), ctx());
    expect(res.status).toBe(200); expect((await res.json()).mensaje).toContain("ya era el utilizado");
  });
  it("revalida: costeo de otra cotización/empresa => 404; cotización no editable => 409 con su mensaje", async () => {
    vi.mocked(seleccionarCosteo).mockRejectedValueOnce(new ErrorSeleccionCosteo("Costeo no encontrado en esta cotización.", 404));
    expect((await seleccionarPOST(post({ costeoId: 91 }), ctx())).status).toBe(404);
    vi.mocked(seleccionarCosteo).mockRejectedValueOnce(new ErrorSeleccionCosteo(MENSAJE_SELECCION_SOLO_BORRADOR, 409));
    const res = await seleccionarPOST(post({ costeoId: 56 }), ctx());
    expect(res.status).toBe(409); expect((await res.json()).error).toBe(MENSAJE_SELECCION_SOLO_BORRADOR);
  });
  it("un error inesperado NO se expone: 500 con mensaje genérico", async () => {
    vi.mocked(seleccionarCosteo).mockRejectedValueOnce(new Error("ER_LOCK_DEADLOCK secreto interno"));
    const res = await seleccionarPOST(post({ costeoId: 55 }), ctx());
    expect(res.status).toBe(500); expect(JSON.stringify(await res.json())).not.toContain("DEADLOCK");
  });
  it("datos inválidos (sin costeoId, no entero, 0, negativo) y id de cotización inválido no llegan al servicio", async () => {
    for (const body of [{}, { costeoId: "55" }, { costeoId: 1.5 }, { costeoId: 0 }, { costeoId: -1 }, { costeoId: 99999999999 }]) expect((await seleccionarPOST(post(body), ctx())).status).toBe(400);
    for (const id of ["abc", "0", "-1", "99999999999"]) expect((await seleccionarPOST(post({ costeoId: 55 }), ctx(id))).status).toBe(404);
    expect(seleccionarCosteo).not.toHaveBeenCalled();
  });
});
