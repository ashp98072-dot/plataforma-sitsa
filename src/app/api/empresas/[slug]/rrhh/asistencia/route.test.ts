import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: vi.fn() }));
vi.mock("@/lib/rrhh/dates", () => ({ hoyLocal: () => "2026-09-23" }));
vi.mock("@/lib/rrhh/asistencia-diaria", () => ({
  obtenerAsistenciaDia: vi.fn(),
  cerrarAsistenciaDia: vi.fn(),
  validarFechaAsistencia: (f: string, hoy: string) => (f > hoy ? "No se puede tomar asistencia de una fecha futura." : null),
}));

import { requireTenantRrhh } from "@/lib/tenant";
import { cerrarAsistenciaDia, obtenerAsistenciaDia } from "@/lib/rrhh/asistencia-diaria";
import { GET, POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "acme" }) };
const sesion = (rol: string) => ({ session: { rol, username: "rrhh1" }, empresa: { id: 7 } });
const post = (body: unknown) => new Request("http://x/api", { method: "POST", body: JSON.stringify(body) });

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantRrhh).mockResolvedValue(sesion("RRHH") as never);
  vi.mocked(obtenerAsistenciaDia).mockResolvedValue({ fecha: "2026-09-23", laborable: true, empleados: [], resumen: {} } as never);
  vi.mocked(cerrarAsistenciaDia).mockResolvedValue({ ok: true, creados: 1 } as never);
});

describe("API rrhh/asistencia — seguridad", () => {
  it("exige el permiso marcajes/crear del tenant; si falla, devuelve ese error sin tocar datos", async () => {
    vi.mocked(requireTenantRrhh).mockResolvedValue({ error: NextResponse.json({ error: "no" }, { status: 403 }) } as never);
    expect((await GET(new Request("http://x/api"), ctx)).status).toBe(403);
    expect((await POST(post({ fecha: "2026-09-23", empleadoIds: [1] }), ctx)).status).toBe(403);
    expect(requireTenantRrhh).toHaveBeenCalledWith("acme", "marcajes", "crear");
    expect(obtenerAsistenciaDia).not.toHaveBeenCalled();
    expect(cerrarAsistenciaDia).not.toHaveBeenCalled();
  });

  it("el rol Marcaje (kiosco) recibe 403 en GET y POST", async () => {
    vi.mocked(requireTenantRrhh).mockResolvedValue(sesion("Marcaje") as never);
    expect((await GET(new Request("http://x/api"), ctx)).status).toBe(403);
    expect((await POST(post({ fecha: "2026-09-23", empleadoIds: [1] }), ctx)).status).toBe(403);
    expect(cerrarAsistenciaDia).not.toHaveBeenCalled();
  });

  it("la empresa sale de la sesión; un empresa_id enviado por el cliente se ignora", async () => {
    await POST(post({ fecha: "2026-09-23", empleadoIds: [1], empresa_id: 99, empresaId: 99 }), ctx);
    expect(vi.mocked(cerrarAsistenciaDia).mock.calls[0][0]).toBe(7);
    expect(vi.mocked(cerrarAsistenciaDia).mock.calls[0][1]).toMatchObject({ usuario: "rrhh1", hoy: "2026-09-23" });
    await GET(new Request("http://x/api?fecha=2026-09-20&empresa_id=99"), ctx);
    expect(vi.mocked(obtenerAsistenciaDia).mock.calls[0]).toEqual([7, "2026-09-20"]);
  });

  it("GET: fecha por defecto = hoy; futura -> 400; respuesta no cacheable", async () => {
    await GET(new Request("http://x/api"), ctx);
    expect(vi.mocked(obtenerAsistenciaDia).mock.calls[0][1]).toBe("2026-09-23");
    expect((await GET(new Request("http://x/api?fecha=2026-09-24"), ctx)).status).toBe(400);
    const ok = await GET(new Request("http://x/api"), ctx);
    expect(ok.headers.get("Cache-Control")).toBe("private, no-store");
    expect((await ok.json()).hoy).toBe("2026-09-23");
  });

  it("POST: cuerpo inválido -> 400 sin cerrar nada", async () => {
    for (const b of [null, { fecha: "2026-09-23" }, { fecha: "2026-09-23", empleadoIds: ["a"] }, { fecha: "2026-09-23", empleadoIds: [-1] }]) {
      expect((await POST(post(b), ctx)).status).toBe(400);
    }
    expect(cerrarAsistenciaDia).not.toHaveBeenCalled();
  });

  it("POST: propaga el status del cierre (409/400) y un fallo interno da 500 sin filtrar detalles", async () => {
    vi.mocked(cerrarAsistenciaDia).mockResolvedValueOnce({ ok: false, status: 409, error: "en curso" } as never);
    expect((await POST(post({ fecha: "2026-09-23", empleadoIds: [1] }), ctx)).status).toBe(409);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(cerrarAsistenciaDia).mockRejectedValueOnce(new Error("secreto SQL"));
    const r = await POST(post({ fecha: "2026-09-23", empleadoIds: [1] }), ctx);
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("secreto");
  });
});
