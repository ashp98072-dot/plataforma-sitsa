import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ requireTenantRrhh: vi.fn(), previsualizarHistorialActual: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: m.requireTenantRrhh }));
vi.mock("@/lib/rrhh/vacaciones-historial-actual", () => ({ previsualizarHistorialActual: m.previsualizarHistorialActual }));

import { NextResponse } from "next/server";
import * as ruta from "./route";

const ctx = { params: Promise.resolve({ slug: "kt-monaco" }) };

beforeEach(() => {
  vi.resetAllMocks();
  m.requireTenantRrhh.mockResolvedValue({ empresa: { id: 7 }, session: { id: 3 } });
  m.previsualizarHistorialActual.mockResolvedValue({ exportacion: { problemas: [], resumen: {} }, preview: { modo: "PREVIEW", escribio: false, puedeAplicarse: true } });
});

describe("GET exportar-historial/preview", () => {
  it("solo expone GET: no hay POST/PUT/PATCH/DELETE que escriba", () => {
    expect(Object.keys(ruta).filter((k) => /^(GET|POST|PUT|PATCH|DELETE)$/.test(k))).toEqual(["GET"]);
  });

  it("exige RRHH · Vacaciones · editar; sin permiso no procesa nada", async () => {
    m.requireTenantRrhh.mockResolvedValue({ error: NextResponse.json({ error: "Sin permiso" }, { status: 403 }) });
    const r = await ruta.GET(new Request("http://local"), ctx);
    expect(r.status).toBe(403);
    expect(m.requireTenantRrhh).toHaveBeenCalledWith("kt-monaco", "vacaciones", "editar");
    expect(m.previsualizarHistorialActual).not.toHaveBeenCalled();
  });

  it("usa la empresa de la SESIÓN, responde sin cache y marca el resultado como PREVIEW que no escribió", async () => {
    const r = await ruta.GET(new Request("http://local?empresa_id=999"), ctx);
    expect(r.status).toBe(200);
    expect(m.previsualizarHistorialActual).toHaveBeenCalledWith(7);
    expect(r.headers.get("Cache-Control")).toContain("no-store");
    expect((await r.json()).preview).toMatchObject({ modo: "PREVIEW", escribio: false });
  });

  it("un fallo interno responde 500 sin filtrar detalles", async () => {
    m.previsualizarHistorialActual.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await ruta.GET(new Request("http://local"), ctx);
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("boom");
  });
});
