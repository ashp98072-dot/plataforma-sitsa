import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ requireTenantRrhh: vi.fn(), previsualizarHistorial: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: m.requireTenantRrhh }));
vi.mock("@/lib/rrhh/vacaciones-historial-preview", () => ({ previsualizarHistorial: m.previsualizarHistorial }));

import { NextResponse } from "next/server";
import { POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "kt-monaco" }) };
const peticion = (nombre: string | null, contenido = "codigo,fecha_inicio,fecha_fin,dias_habiles\nE-1,2024-06-03,2024-06-14,11") => {
  const form = new FormData();
  if (nombre) form.set("archivo", new File([contenido], nombre, { type: "text/csv" }));
  return new Request("http://local", { method: "POST", body: form });
};

beforeEach(() => {
  vi.resetAllMocks();
  m.requireTenantRrhh.mockResolvedValue({ empresa: { id: 7 }, session: { id: 3 } });
  m.previsualizarHistorial.mockResolvedValue({ modo: "PREVIEW", escribio: false, puedeAplicarse: true });
});

describe("POST importar-historial/preview", () => {
  it("exige RRHH · Vacaciones · editar; sin permiso devuelve el 403 del guard y no procesa nada", async () => {
    m.requireTenantRrhh.mockResolvedValue({ error: NextResponse.json({ error: "Sin permiso" }, { status: 403 }) });
    const r = await POST(peticion("h.csv"), ctx);
    expect(r.status).toBe(403);
    expect(m.requireTenantRrhh).toHaveBeenCalledWith("kt-monaco", "vacaciones", "editar");
    expect(m.previsualizarHistorial).not.toHaveBeenCalled();
  });

  it("procesa un CSV y usa la empresa de la SESIÓN (nunca una del archivo)", async () => {
    const r = await POST(peticion("h.csv", "codigo,empresa_id,fecha_inicio,fecha_fin,dias_habiles\nE-1,999,2024-06-03,2024-06-14,11"), ctx);
    expect(r.status).toBe(200);
    expect(m.previsualizarHistorial).toHaveBeenCalledOnce();
    expect(m.previsualizarHistorial.mock.calls[0][0]).toBe(7);
    expect(m.previsualizarHistorial.mock.calls[0][1].encabezados).toContain("empresa_id"); // columna ajena: se informará como ignorada
    const body = await r.json();
    expect(body).toMatchObject({ modo: "PREVIEW", escribio: false });
    expect(r.headers.get("Cache-Control")).toContain("no-store");
  });

  it("rechaza archivo ausente, formato no soportado y archivos demasiado grandes", async () => {
    expect((await POST(peticion(null), ctx)).status).toBe(400);
    expect((await POST(peticion("h.pdf"), ctx)).status).toBe(400);
    const grande = "x".repeat(5 * 1024 * 1024 + 1);
    expect((await POST(peticion("h.csv", grande), ctx)).status).toBe(413);
    expect(m.previsualizarHistorial).not.toHaveBeenCalled();
  });

  it("un archivo ilegible responde 422 sin filtrar detalles internos", async () => {
    m.previsualizarHistorial.mockRejectedValue(new Error("detalle interno"));
    const r = await POST(peticion("h.csv"), ctx);
    expect(r.status).toBe(422);
    expect(JSON.stringify(await r.json())).not.toContain("detalle interno");
  });
});
