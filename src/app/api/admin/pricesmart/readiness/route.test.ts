import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSession = vi.fn();
vi.mock("@/lib/api-guard", () => ({ requireSession: () => requireSession() }));
import * as route from "./route";

const user = (rol: string, empresaId = 1) => ({ user: { id: 7, username: "u", rol, nombre: "U", empresaId } });
beforeEach(() => requireSession.mockReset());

describe("GET /api/admin/pricesmart/readiness", () => {
  it("sin sesión: 401 y no calcula nada", async () => {
    requireSession.mockResolvedValue({ error: NextResponse.json({ error: "No autenticado." }, { status: 401 }) });
    expect((await route.GET()).status).toBe(401);
  });
  it("roles no Admin (incluso con empresa asignada): 403 sin datos del diagnóstico", async () => {
    for (const rol of ["Programacion", "Operaciones", "Contabilidad", "RRHH", "Piloto", "Cliente"]) {
      requireSession.mockResolvedValue(user(rol));
      const res = await route.GET(); expect(res.status).toBe(403);
      const body = await res.json(); expect(Object.keys(body)).toEqual(["error"]);
    }
  });
  it("Admin: 200, sin caché, informe de solo lectura con la integración cerrada", async () => {
    requireSession.mockResolvedValue(user("Admin"));
    const res = await route.GET(); expect(res.status).toBe(200); expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await res.json(); expect(body.handlerInstalled).toBe(false); expect(body.ready).toBe(false); expect(body.blockers).toContain("PORTS_NOT_WIRED");
  });
  it("el resultado no depende de la empresa de la sesión ni contiene datos de empresas", async () => {
    requireSession.mockResolvedValue(user("Admin", 1)); const a = await (await route.GET()).json();
    requireSession.mockResolvedValue(user("Admin", 2)); const b = await (await route.GET()).json();
    const strip = (r: Record<string, unknown>) => ({ ...r, generatedAt: 0 });
    expect(strip(a)).toEqual(strip(b)); expect(JSON.stringify(a)).not.toMatch(/empresa|tenant|cliente_id|solicitud/i);
  });
  it("solo expone GET", () => {
    expect(Object.keys(route).filter(k => /^(POST|PUT|PATCH|DELETE)$/.test(k))).toEqual([]);
  });
});
