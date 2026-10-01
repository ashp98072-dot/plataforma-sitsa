import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantModulo: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn() }));

import { requireTenantModulo } from "@/lib/tenant";
import { query } from "@/lib/db";
import { GET, PUT } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba" }) };

/**
 * TMS-PROGRAMACION-HABILITACIONES-1 — endpoint de administración de habilitaciones operativas. Mismo
 * permiso `tms` ya existente (ver para GET, editar para PUT) — sin permiso nuevo. empresa_id SIEMPRE sale
 * del guard, nunca del cliente.
 */
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantModulo).mockResolvedValue(
    { empresa: { id: 7, nombre: "SITSA" }, session: { id: 8, username: "op1", nombre: "Ana", rol: "JefeOperaciones" } } as Awaited<
      ReturnType<typeof requireTenantModulo>
    >,
  );
});
afterEach(() => vi.restoreAllMocks());

function req(body: unknown) {
  return new Request("http://localhost/x", { method: "PUT", body: JSON.stringify(body) });
}

describe("GET /tms/personal-habilitaciones", () => {
  it("exige tms:ver — tenant/permiso incorrecto -> error del guard, nunca llega a consultar BD", async () => {
    vi.mocked(requireTenantModulo).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<
      ReturnType<typeof requireTenantModulo>
    >);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(403);
    expect(requireTenantModulo).toHaveBeenCalledWith("prueba", "tms", false);
    expect(query).not.toHaveBeenCalled();
  });

  it("devuelve empleados activos de la empresa con sus habilitaciones anexadas (activas e inactivas)", async () => {
    vi.mocked(query).mockImplementation((async (sql: string) => {
      if (sql.includes("FROM empleados")) {
        return [{ id: 1, codigo: "E-1", nombre: "Juan Pérez", puesto: "Auxiliar", categoria_ops: "Auxiliar", estado: "Activo" }];
      }
      if (sql.includes("FROM tms_personal_habilitaciones")) {
        return [
          { id: 10, empleado_id: 1, rol: "AUXILIAR", estado: "HABILITADO", activo: 1 },
          { id: 11, empleado_id: 1, rol: "PILOTO", estado: "CAPACITACION", activo: 1 },
        ];
      }
      return [];
    }) as typeof query);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.empleados).toHaveLength(1);
    expect(body.empleados[0]).toMatchObject({
      id: 1,
      nombre: "Juan Pérez",
      puesto: "Auxiliar",
      categoriaOps: "Auxiliar",
    });
    expect(body.empleados[0].habilitaciones).toEqual(
      expect.arrayContaining([
        { rol: "AUXILIAR", estado: "HABILITADO", activo: true },
        { rol: "PILOTO", estado: "CAPACITACION", activo: true },
      ]),
    );
  });

  it("empresa_id de las consultas SIEMPRE sale del guard (7), nunca de un parámetro del cliente", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await GET(new Request("http://localhost/x?empresa_id=999"), ctx);
    for (const call of vi.mocked(query).mock.calls) {
      expect(call[1]).toContain(7);
      expect(call[1]).not.toContain(999);
    }
  });
});

describe("PUT /tms/personal-habilitaciones", () => {
  it("exige tms:editar — usuario sin permiso rechazado", async () => {
    vi.mocked(requireTenantModulo).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<
      ReturnType<typeof requireTenantModulo>
    >);
    const res = await PUT(req({ empleadoId: 1, rol: "PILOTO", estado: "HABILITADO" }), ctx);
    expect(res.status).toBe(403);
    expect(requireTenantModulo).toHaveBeenCalledWith("prueba", "tms", true);
    expect(query).not.toHaveBeenCalled();
  });

  it("rol inválido (ni PILOTO ni AUXILIAR) rechazado con 400, nunca llega a la lib", async () => {
    const res = await PUT(req({ empleadoId: 1, rol: "CAPITAN", estado: "HABILITADO" }), ctx);
    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("estado inválido (ni HABILITADO/CAPACITACION/null) rechazado con 400", async () => {
    const res = await PUT(req({ empleadoId: 1, rol: "PILOTO", estado: "EXPERTO" }), ctx);
    expect(res.status).toBe(400);
    expect(query).not.toHaveBeenCalled();
  });

  it("empleadoId ausente/no numérico rechazado con 400", async () => {
    const res = await PUT(req({ rol: "PILOTO", estado: "HABILITADO" }), ctx);
    expect(res.status).toBe(400);
  });

  it("empleado inexistente/inactivo en esta empresa -> 404, sin escribir nada", async () => {
    vi.mocked(query).mockResolvedValue([] as never); // SELECT ... WHERE estado='Activo' no encuentra nada
    const res = await PUT(req({ empleadoId: 999, rol: "PILOTO", estado: "HABILITADO" }), ctx);
    expect(res.status).toBe(404);
  });

  it("empleadoId válido en ESTA empresa -> upsert correcto, 200 ok:true", async () => {
    vi.mocked(query).mockResolvedValue([{ id: 1 }] as never); // el SELECT de validación lo encuentra
    const { execute } = await import("@/lib/db");
    const res = await PUT(req({ empleadoId: 1, rol: "PILOTO", estado: "CAPACITACION" }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(vi.mocked(execute)).toHaveBeenCalledWith(
      expect.stringContaining("ON DUPLICATE KEY UPDATE"),
      [7, 1, "PILOTO", "CAPACITACION"],
    );
  });

  it("estado: null desactiva (UPDATE activo=0), nunca hace DELETE", async () => {
    vi.mocked(query).mockResolvedValue([{ id: 1 }] as never);
    const { execute } = await import("@/lib/db");
    const res = await PUT(req({ empleadoId: 1, rol: "AUXILIAR", estado: null }), ctx);
    expect(res.status).toBe(200);
    expect(vi.mocked(execute)).toHaveBeenCalledWith(expect.stringContaining("SET activo = 0"), [7, 1, "AUXILIAR"]);
    expect(vi.mocked(execute)).not.toHaveBeenCalledWith(expect.stringContaining("DELETE"), expect.anything());
  });

  it("la validación de empleado activo se hace SIEMPRE contra el empresa_id del guard (7), nunca cruza empresas", async () => {
    vi.mocked(query).mockResolvedValue([{ id: 1 }] as never);
    await PUT(req({ empleadoId: 1, rol: "PILOTO", estado: "HABILITADO" }), ctx);
    const [, params] = vi.mocked(query).mock.calls[0];
    expect(params).toEqual([7, 1]);
  });
});
