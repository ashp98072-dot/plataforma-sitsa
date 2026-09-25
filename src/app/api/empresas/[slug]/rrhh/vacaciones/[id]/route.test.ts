import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: vi.fn() }));
vi.mock("@/lib/rrhh/vacaciones-eliminar", () => ({ eliminarRegistroVacaciones: vi.fn() }));

import { requireTenantRrhh } from "@/lib/tenant";
import { eliminarRegistroVacaciones } from "@/lib/rrhh/vacaciones-eliminar";
import { tienePermiso, type PermisoModulo } from "@/lib/permisos-shared";
import { DELETE } from "./route";

/** DELETE /rrhh/vacaciones/[id]: permiso, validación del id y mapeo de resultados (la lógica transaccional se prueba en vacaciones-eliminar.test.ts). */
const ctx = (id: string) => ({ params: Promise.resolve({ slug: "prueba", id }) });
const del = (id: string) => DELETE(new Request("https://local.test", { method: "DELETE" }), ctx(id));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantRrhh).mockResolvedValue({ empresa: { id: 3 }, session: { username: "rrhh.ana" } } as never);
});

describe("DELETE /rrhh/vacaciones/[id]", () => {
  it("exige el permiso vacaciones:eliminar y la empresa/usuario salen de la sesión", async () => {
    vi.mocked(eliminarRegistroVacaciones).mockResolvedValue({ ok: true, mensaje: "m", diasRestaurados: 2, empleadoId: 7, desglose: [], diasAjustadosPorTope: 0, diasNoRestaurados: 0, espejoEliminado: true, advertencias: [] });
    await del("501");
    expect(requireTenantRrhh).toHaveBeenCalledWith("prueba", "vacaciones", "eliminar");
    expect(eliminarRegistroVacaciones).toHaveBeenCalledWith(3, 501, "rrhh.ana");
  });

  it("6) sin permiso de eliminar -> 403 y no se ejecuta nada", async () => {
    vi.mocked(requireTenantRrhh).mockResolvedValue({ error: NextResponse.json({ error: "Sin permiso para eliminar en vacaciones." }, { status: 403 }) } as never);
    const r = await del("501");
    expect(r.status).toBe(403);
    expect(eliminarRegistroVacaciones).not.toHaveBeenCalled();
  });

  it("7) ver / crear / editar NO alcanzan: la regla de permisos exige puedeEliminar", () => {
    const base = { modulo: "vacaciones", puedeVer: false, puedeCrear: false, puedeEditar: false, puedeEliminar: false } as unknown as PermisoModulo;
    for (const k of ["puedeVer", "puedeCrear", "puedeEditar"] as const) {
      expect(tienePermiso([{ ...base, [k]: true } as PermisoModulo], "vacaciones", "eliminar")).toBe(false);
    }
    expect(tienePermiso([{ ...base, puedeEliminar: true } as PermisoModulo], "vacaciones", "eliminar")).toBe(true);
  });

  it("éxito: 200 con mensaje, días restaurados y empleado", async () => {
    vi.mocked(eliminarRegistroVacaciones).mockResolvedValue({ ok: true, mensaje: "Registro eliminado y 2 día(s) restaurados.", diasRestaurados: 2, empleadoId: 7, desglose: [], diasAjustadosPorTope: 0, diasNoRestaurados: 0, espejoEliminado: true, advertencias: [] });
    const r = await del("501");
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ ok: true, mensaje: "Registro eliminado y 2 día(s) restaurados.", diasRestaurados: 2, empleadoId: 7 });
  });

  it("404 / 409 / 400 del núcleo se propagan con su mensaje", async () => {
    for (const status of [404, 409, 400] as const) {
      vi.mocked(eliminarRegistroVacaciones).mockResolvedValue({ ok: false, status, error: `e${status}` });
      const r = await del("501");
      expect(r.status).toBe(status);
      expect(await r.json()).toEqual({ error: `e${status}` });
    }
  });

  it("id inválido -> 400 sin llegar al núcleo", async () => {
    for (const id of ["abc", "0", "-5", "1.5", "12abc", ""]) {
      expect((await del(id)).status).toBe(400);
    }
    expect(eliminarRegistroVacaciones).not.toHaveBeenCalled();
  });

  it("fallo inesperado -> 500 con mensaje genérico (el núcleo ya hizo ROLLBACK)", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(eliminarRegistroVacaciones).mockRejectedValue(new Error("boom interno"));
    const r = await del("501");
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("boom");
  });
});
