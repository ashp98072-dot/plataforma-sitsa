import { beforeEach, describe, expect, it, vi } from "vitest";

// Guard REAL de tenant/permisos; solo se simulan sesión, empresa, permisos efectivos y el modelo/exportación.
vi.mock("@/lib/session", () => ({ getSession: vi.fn(), createSessionToken: vi.fn(), setSessionCookie: vi.fn() }));
vi.mock("@/lib/empresas", () => ({ obtenerEmpresaPorSlug: vi.fn(), empresasParaUsuario: vi.fn() }));
vi.mock("@/lib/permisos", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/permisos")>();
  return { ...actual, permisosEfectivos: vi.fn() };
});
vi.mock("@/lib/tms/viaticos-requerimientos", () => ({ obtenerRequerimientoViatico: vi.fn() }));
vi.mock("@/lib/tms/viaticos-requerimientos-export", () => ({
  firmaHistoricaRequerimientoViatico: vi.fn().mockResolvedValue(null),
  firmaRequirenteRequerimientoViatico: vi.fn().mockResolvedValue(null),
  requerimientoViaticoPdf: vi.fn().mockResolvedValue(Buffer.from("%PDF")),
  requerimientoViaticoExcel: vi.fn().mockResolvedValue(Buffer.from("XLSX")),
}));

import { getSession } from "@/lib/session";
import { empresasParaUsuario, obtenerEmpresaPorSlug } from "@/lib/empresas";
import { permisosEfectivos } from "@/lib/permisos";
import { obtenerRequerimientoViatico } from "@/lib/tms/viaticos-requerimientos";
import { requerimientoViaticoExcel, requerimientoViaticoPdf } from "@/lib/tms/viaticos-requerimientos-export";
import { GET } from "./route";

const emp = (id = 1) => ({ id, slug: "kt", nombre: "KT", activa: true, modulos: ["tms"] }) as never;
const perm = (modulo: string) => ({ modulo, puedeVer: true, puedeCrear: false, puedeEditar: false, puedeEliminar: false });
const llamar = (formato = "pdf", slug = "kt") => GET(new Request(`http://localhost/x?formato=${formato}`), { params: Promise.resolve({ slug, id: "5" }) });

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue(emp());
  vi.mocked(empresasParaUsuario).mockResolvedValue([emp()]);
  vi.mocked(getSession).mockResolvedValue({ id: 2, username: "u", nombre: "U", rol: "Operaciones" } as never);
  vi.mocked(obtenerRequerimientoViatico).mockResolvedValue({ id: 5, codigo: "VR-1", estado: "AUTORIZADO", total: "1.00" } as never);
});

describe("exportar requerimiento (contiene No. de cuenta / banco) exige viaticos_pagar:ver", () => {
  it("viaticos:ver SIN viaticos_pagar:ver -> 403 (PDF y Excel) y no genera nada", async () => {
    vi.mocked(permisosEfectivos).mockResolvedValue([perm("viaticos")]);
    for (const f of ["pdf", "xlsx"]) expect((await llamar(f)).status).toBe(403);
    expect(obtenerRequerimientoViatico).not.toHaveBeenCalled();
    expect(requerimientoViaticoPdf).not.toHaveBeenCalled();
    expect(requerimientoViaticoExcel).not.toHaveBeenCalled();
  });

  it("viaticos_pagar:ver -> permitido (PDF y Excel)", async () => {
    vi.mocked(permisosEfectivos).mockResolvedValue([perm("viaticos_pagar")]);
    const pdf = await llamar("pdf");
    expect(pdf.status).toBe(200);
    expect(pdf.headers.get("Content-Type")).toBe("application/pdf");
    expect((await llamar("xlsx")).status).toBe(200);
  });

  it("Admin -> permitido", async () => {
    vi.mocked(getSession).mockResolvedValue({ id: 1, username: "a", rol: "Admin" } as never);
    expect((await llamar()).status).toBe(200);
  });

  it("sin sesión -> 401", async () => {
    vi.mocked(getSession).mockResolvedValue(null as never);
    expect((await llamar()).status).toBe(401);
  });

  it("tenant incorrecto: empresa a la que no tiene acceso -> 403; empresa inexistente -> 404; nunca lee el requerimiento", async () => {
    vi.mocked(permisosEfectivos).mockResolvedValue([perm("viaticos_pagar")]);
    vi.mocked(empresasParaUsuario).mockResolvedValue([emp(99)]); // el usuario pertenece a OTRA empresa
    expect((await llamar()).status).toBe(403);
    vi.mocked(obtenerEmpresaPorSlug).mockResolvedValue(null as never);
    expect((await llamar("pdf", "otra")).status).toBe(404);
    expect(obtenerRequerimientoViatico).not.toHaveBeenCalled();
  });

  it("el requerimiento se lee siempre acotado por la empresa de la sesión", async () => {
    vi.mocked(permisosEfectivos).mockResolvedValue([perm("viaticos_pagar")]);
    await llamar();
    expect(obtenerRequerimientoViatico).toHaveBeenCalledWith(1, 5);
  });
});
