import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantGastos: vi.fn() }));

import { query } from "@/lib/db";
import { requireTenantGastos } from "@/lib/tenant";
import { GET } from "./route";

const ctx = { params: Promise.resolve({ slug: "kt-monaco" }) };

function datosCatalogos() {
  vi.mocked(query)
    .mockResolvedValueOnce([
      { id: 1, codigo: "EMP-1", nombre: "Carlos Abel Pineda", puesto: "Piloto", cuenta_bancaria: "123456" },
      { id: 8, codigo: "EMP-8", nombre: "Empleado con cuenta", puesto: "Contador", cuenta_bancaria: "00123456789" },
    ] as never)
    .mockResolvedValueOnce([{ id: 2, placa: "C-130BQ", marca: "Hino", modelo: "500" }] as never)
    .mockResolvedValueOnce([{ id: 3, nombre: "Cliente Uno", nit: "123-4" }] as never)
    .mockResolvedValueOnce([{
      id: 4, codigo: "PLAN-1", cliente_id: 3, cliente_nombre: "Cliente Uno", fecha_plan: "2026-09-09",
      vehiculo_id: 2, placa: "C-130BQ", empleado_id: 1, empleado_nombre: "Carlos Abel Pineda",
      empleado_puesto: "Piloto", empleado_cuenta: "123456",
    }] as never)
    .mockResolvedValueOnce([
      { id: 5, nombre: "Operador Uno", rol_global: "Operaciones" },
      { id: 6, nombre: "Contadora", rol_global: "Contabilidad" },
    ] as never)
    .mockResolvedValueOnce([
      { id: 10, codigo: "KT", nombre: "Kuiqtrans" },
      { id: 11, codigo: "MONACO", nombre: "Logiservicios Mónaco" },
    ] as never);
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantGastos).mockResolvedValue({ error: null, empresa: { id: 7 } } as never);
});

describe("GET catálogos de Gastos/Fondos", () => {
  it("retorna empleados, vehículos, clientes, planes, usuarios y solicitantes con sus datos", async () => {
    datosCatalogos();
    const response = await GET(new Request("http://local"), ctx);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.empleados).toEqual([
      { id: 1, codigo: "EMP-1", nombre: "Carlos Abel Pineda", puesto: "Piloto", cuentaBancaria: "123456" },
      { id: 8, codigo: "EMP-8", nombre: "Empleado con cuenta", puesto: "Contador", cuentaBancaria: "00123456789" },
    ]);
    expect(body.vehiculos).toEqual([{ id: 2, placa: "C-130BQ", marca: "Hino", modelo: "500" }]);
    expect(body.clientes).toEqual([{ id: 3, codigo: null, nombre: "Cliente Uno", nit: "123-4" }]);
    expect(body.planes).toEqual([{
      id: 4, codigo: "PLAN-1", clienteId: 3, clienteNombre: "Cliente Uno", fechaPlan: "2026-09-09",
      vehiculoId: 2, placa: "C-130BQ", empleadoId: 1, empleadoNombre: "Carlos Abel Pineda",
      empleadoPuesto: "Piloto", empleadoCuenta: "123456",
    }]);
    expect(body.usuarios).toHaveLength(2);
    expect(body.solicitantes).toEqual([{ id: 5, nombre: "Operador Uno" }]);
    expect(body.entidadesRequirentes).toEqual([
      { id: 10, codigo: "KT", nombre: "Kuiqtrans" },
      { id: 11, codigo: "MONACO", nombre: "Logiservicios Mónaco" },
    ]);
  });

  /**
   * FONDOS-GASTOS-METODO-PAGO-1 — Fondos reutiliza este MISMO catálogo
   * compartido (ya usado para empleados/vehículos/clientes/planes) para
   * el selector de método de pago, sin duplicar el catálogo de Gastos.
   */
  it("incluye el catálogo de métodos de pago (mismo que ya usa Gastos)", async () => {
    datosCatalogos();
    const response = await GET(new Request("http://local"), ctx);
    const body = await response.json();
    expect(body.metodosPago).toEqual(["Efectivo", "Transferencia", "Transferencia móvil", "Tarjeta", "Cheque", "Otro"]);
  });

  it("incluye cualquier empleado activo de la empresa sin filtrar por puesto o vínculo TMS", async () => {
    datosCatalogos();
    const response = await GET(new Request("http://local"), ctx);
    const body = await response.json();
    expect(body.empleados.map((e: { puesto: string }) => e.puesto)).toEqual(["Piloto", "Contador"]);
    const sql = String(vi.mocked(query).mock.calls[0][0]);
    expect(sql).toContain("empresa_id = ? AND estado = 'Activo'");
    expect(sql).not.toMatch(/puesto\s*(=|IN)|tms_personal/i);
  });

  it("mantiene empresa_id del tenant en todas las consultas", async () => {
    datosCatalogos();
    await GET(new Request("http://local"), ctx);
    expect(requireTenantGastos).toHaveBeenCalledWith("kt-monaco", "ver");
    for (const llamada of vi.mocked(query).mock.calls) expect(llamada[1]).toContain(7);
  });

  it("la consulta de clientes usa solo columnas reales y no solicita codigo", async () => {
    datosCatalogos();
    await GET(new Request("http://local"), ctx);
    const sql = String(vi.mocked(query).mock.calls[2][0]);
    expect(sql).toContain("SELECT id, nombre, nit FROM tms_clientes");
    expect(sql).not.toMatch(/SELECT[^]*\bcodigo\b[^]*FROM tms_clientes/);
  });

  it("resuelve unidad y piloto del plan mediante sus vínculos reales y por empresa", async () => {
    datosCatalogos();
    await GET(new Request("http://local"), ctx);
    const sql = String(vi.mocked(query).mock.calls[3][0]);
    expect(sql).toContain("u.flota_vehiculo_id");
    expect(sql).toContain("pil.id_empleado");
    expect(sql).toContain("u.empresa_id = p.empresa_id");
    expect(sql).toContain("pil.empresa_id = p.empresa_id");
    expect(sql).toContain("e.empresa_id = p.empresa_id");
  });

  it("si una consulta crítica falla devuelve error claro y registra el catálogo", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(query).mockRejectedValueOnce(new Error("Unknown column"));
    const response = await GET(new Request("http://local"), ctx);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "No se pudo cargar el catálogo de empleados." });
    expect(spy).toHaveBeenCalledWith(expect.stringContaining("empleados"), expect.any(Error));
    spy.mockRestore();
  });
});
