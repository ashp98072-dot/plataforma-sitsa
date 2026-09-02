import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { query } from "@/lib/db";
import { listarAsignacionesOperativasEmpleado } from "./viajes-piloto";

describe("historial operativo del colaborador", () => {
  beforeEach(() => vi.clearAllMocks());

  it("consulta hasta doce meses, conserva los viajes abiertos y mantiene el tenant", async () => {
    vi.mocked(query).mockResolvedValueOnce([]);

    await listarAsignacionesOperativasEmpleado(7, 23);

    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("p.empresa_id = ?");
    expect(sql).toContain("INTERVAL 12 MONTH");
    expect(sql).toContain("OR fv.estado = 'abierto'");
    expect(sql).toContain("LIMIT 250");
    expect(params).toEqual([7, 23, 23, 23]);
  });
});
