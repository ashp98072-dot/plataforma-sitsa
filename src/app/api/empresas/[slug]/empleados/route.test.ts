import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: vi.fn() }));
vi.mock("@/lib/rrhh/empleados", () => ({
  listarEmpleados: vi.fn(),
  crearEmpleado: vi.fn(),
  codigoDuplicado: vi.fn(),
}));
vi.mock("@/lib/rrhh/config", () => ({ obtenerParametros: vi.fn() }));

import { requireTenantRrhh } from "@/lib/tenant";
import { listarEmpleados } from "@/lib/rrhh/empleados";
import { obtenerParametros } from "@/lib/rrhh/config";
import { GET } from "./route";

/**
 * RRHH-EMPLEADOS-LISTADO-STALE — el listado de "Entrada lab."/"Contratación"
 * quedaba stale tras editar un empleado aunque la BD ya tuviera el valor
 * correcto (verificado en producción: empleado 3287850831608, Wilson
 * Leonardo Bá Caal). GET /api/empresas/[slug]/empleados debe marcar
 * explícitamente no-store/private para que ni el navegador ni el CDN
 * delante de Hostinger sirvan una respuesta cacheada — el next.config
 * headers() global de no-store solo cubre rutas de página (/e/:path*), no
 * /api/:path*.
 */

const ctx = { params: Promise.resolve({ slug: "sitsa" }) };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantRrhh).mockResolvedValue({
    empresa: { id: 7 },
    session: { username: "rrhh1" },
  } as unknown as Awaited<ReturnType<typeof requireTenantRrhh>>);
  vi.mocked(listarEmpleados).mockResolvedValue([]);
  vi.mocked(obtenerParametros).mockResolvedValue({
    hora_entrada_default: "07:00:00",
    hora_salida_default: "16:00:00",
  } as unknown as Awaited<ReturnType<typeof obtenerParametros>>);
});

describe("GET /api/empresas/[slug]/empleados — Cache-Control", () => {
  it("responde con Cache-Control: private, no-store (nunca cacheado por navegador/CDN)", async () => {
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
  });

  it("conserva el comportamiento de filtros: q/tipoContrato/formaPago/estado se pasan a listarEmpleados", async () => {
    await GET(
      new Request(
        "http://localhost/x?q=Wilson&tipoContrato=fijo&formaPago=transferencia&estado=Activo",
      ),
      ctx,
    );
    expect(listarEmpleados).toHaveBeenCalledWith(7, "Wilson", {
      tipoContrato: "fijo",
      formaPago: "transferencia",
      estado: "Activo",
    });
  });

  it("sigue devolviendo empleados y horarioDefault en el body, sin cambiar el contrato de datos", async () => {
    vi.mocked(listarEmpleados).mockResolvedValue([
      { id: 1, codigo: "3287850831608", nombre: "Wilson Leonardo Bá Caal" },
    ] as unknown as Awaited<ReturnType<typeof listarEmpleados>>);
    const res = await GET(new Request("http://localhost/x"), ctx);
    const data = await res.json();
    expect(data.empleados).toHaveLength(1);
    expect(data.horarioDefault).toEqual({ entrada: "07:00", salida: "16:00" });
  });
});
