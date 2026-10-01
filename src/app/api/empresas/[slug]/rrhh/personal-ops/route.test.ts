import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenant: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/permisos", () => ({ esRrhhSubmodulo: vi.fn(() => false), permisosEfectivos: vi.fn(async () => []), tienePermiso: vi.fn(() => false) }));
vi.mock("@/lib/roles", () => ({ modulosPorRol: vi.fn(() => ["tms", "rrhh"]) }));
vi.mock("@/lib/tms/personal-habilitaciones", () => ({ listarHabilitacionesActivasDe: vi.fn() }));

import { requireTenant } from "@/lib/tenant";
import { query } from "@/lib/db";
import { listarHabilitacionesActivasDe } from "@/lib/tms/personal-habilitaciones";
import { GET } from "./route";

const ctx = { params: Promise.resolve({ slug: "prueba" }) };

/**
 * TMS-PROGRAMACION-HABILITACIONES-1 — personal-ops ahora anexa `habilitacionesOps` por empleado (aditivo).
 * No existía test previo para este endpoint; se agrega cobertura mínima centrada en el campo nuevo, sin
 * reescribir la matriz completa de permisos canTms/canRrhh/canProgramacion (fuera de alcance de este ticket).
 */
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenant).mockResolvedValue(
    { empresa: { id: 7, nombre: "SITSA", modulos: ["tms"] }, session: { id: 8, rol: "Admin" } } as Awaited<
      ReturnType<typeof requireTenant>
    >,
  );
});
afterEach(() => vi.restoreAllMocks());

describe("GET /rrhh/personal-ops — habilitacionesOps (aditivo)", () => {
  it("anexa habilitacionesOps por empleado sin cambiar id/codigo/nombre/puesto/categoriaOps/estado", async () => {
    vi.mocked(query).mockResolvedValue([
      { id: 1, codigo: "E-1", nombre: "Juan Pérez", puesto: "Auxiliar", categoria_ops: "Auxiliar", estado: "Activo" },
    ] as never);
    vi.mocked(listarHabilitacionesActivasDe).mockResolvedValue(
      new Map([[1, [{ rol: "PILOTO", estado: "CAPACITACION" }]]]) as never,
    );
    const res = await GET(new Request("http://localhost/x?tipo=all"), ctx);
    const body = await res.json();
    expect(body.personal[0]).toMatchObject({
      id: 1,
      codigo: "E-1",
      nombre: "Juan Pérez",
      puesto: "Auxiliar",
      categoriaOps: "Auxiliar",
      estado: "Activo",
      habilitacionesOps: [{ rol: "PILOTO", estado: "CAPACITACION" }],
    });
  });

  it("empleado sin habilitaciones activas recibe habilitacionesOps: [] (nunca undefined)", async () => {
    vi.mocked(query).mockResolvedValue([
      { id: 2, codigo: "E-2", nombre: "Ana López", puesto: "Piloto", categoria_ops: "Piloto", estado: "Activo" },
    ] as never);
    vi.mocked(listarHabilitacionesActivasDe).mockResolvedValue(new Map() as never);
    const res = await GET(new Request("http://localhost/x?tipo=all"), ctx);
    const body = await res.json();
    expect(body.personal[0].habilitacionesOps).toEqual([]);
  });

  it("si la tabla de habilitaciones aún no existe (error de la lib), el endpoint sigue respondiendo con habilitacionesOps: []", async () => {
    vi.mocked(query).mockResolvedValue([
      { id: 3, codigo: "E-3", nombre: "Marco Ruiz", puesto: "Piloto", categoria_ops: "Piloto", estado: "Activo" },
    ] as never);
    vi.mocked(listarHabilitacionesActivasDe).mockRejectedValue(new Error("tabla no existe aún"));
    const res = await GET(new Request("http://localhost/x?tipo=all"), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.personal[0].habilitacionesOps).toEqual([]);
  });

  it("empresa_id consultado SIEMPRE es el del guard (7), nunca del cliente", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    vi.mocked(listarHabilitacionesActivasDe).mockResolvedValue(new Map() as never);
    await GET(new Request("http://localhost/x?tipo=all&empresa_id=999"), ctx);
    expect(vi.mocked(listarHabilitacionesActivasDe).mock.calls[0][0]).toBe(7);
  });
});
