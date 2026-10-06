import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/flota/schema", () => ({ asegurarSchemaFlota: vi.fn() }));
vi.mock("@/lib/empresas", () => ({ listarEmpresasActivas: vi.fn() }));
import { query } from "@/lib/db";
import { obtenerVehiculoAccesible } from "./acceso";
import { decidirEdicionVehiculo } from "./edicion-vehiculo";

/**
 * «Accesible desde la empresa activa» NO es una condición paralela: es la regla REAL de obtenerVehiculoAccesible (acceso.ts), la misma con la que
 * un vehículo compartido aparece en la lista de la empresa activa y la que usa el PATCH para encontrar el vehículo. Aquí se ejecuta esa función real
 * (con una base simulada que respeta su SQL) y se compone con la decisión de edición.
 */
const MONACO = 2, FRESCOFRESH = 9, KUIQ = 1, OTRO_TENANT = 77;
// Vehículos: 1 propio de Mónaco; 2 de Frescofresh COMPARTIDO con Mónaco; 3 de Frescofresh NO compartido; 4 de otro tenant.
const VEHICULOS = [{ id: 1, empresa_id: MONACO }, { id: 2, empresa_id: FRESCOFRESH }, { id: 3, empresa_id: FRESCOFRESH }, { id: 4, empresa_id: OTRO_TENANT }];
const ACCESO = [{ vehiculo_id: 2, empresa_id: MONACO }, { vehiculo_id: 2, empresa_id: KUIQ }];

beforeEach(() => {
  vi.resetAllMocks();
  // Interpreta la consulta de obtenerVehiculoAccesible: WHERE v.id = ? AND (v.empresa_id = ? OR EXISTS (acceso a.vehiculo_id = v.id AND a.empresa_id = ?)).
  vi.mocked(query).mockImplementation((async (sql: string, params: number[]) => {
    expect(sql).toContain("v.id = ?"); expect(sql).toContain("v.empresa_id = ?"); expect(sql).toContain("flota_vehiculo_acceso");
    const [, vehiculoId, empresaDuena, empresaAcceso] = params;
    const v = VEHICULOS.find((x) => x.id === vehiculoId && (x.empresa_id === empresaDuena || ACCESO.some((a) => a.vehiculo_id === x.id && a.empresa_id === empresaAcceso)));
    return v ? [{ ...v, compartido: v.empresa_id === params[0] ? 0 : 1 }] : [];
  }) as never);
});

/** Lo que hace el PATCH: busca desde la empresa activa y decide. */
async function editable(empresaActivaId: number, vehiculoId: number, permisoTransversal: boolean) {
  const fila = await obtenerVehiculoAccesible(empresaActivaId, vehiculoId);
  if (!fila) return { status: 404 as const };
  const d = decidirEdicionVehiculo({ empresaActivaId, empresaDuenaId: Number(fila.empresa_id), permisoTransversal, vehiculoAccesibleDesdeEmpresaActiva: true });
  return { status: d.puede ? (200 as const) : (403 as const), propietaria: Number(fila.empresa_id), transversal: d.porPermisoTransversal };
}

describe("accesible desde la empresa activa (regla real) + permiso transversal", () => {
  it("1. vehículo propio de Mónaco: edita con o sin permiso", async () => {
    expect((await editable(MONACO, 1, false)).status).toBe(200);
    expect((await editable(MONACO, 1, true)).status).toBe(200);
  });
  it("2. vehículo de Frescofresh COMPARTIDO con Mónaco + permiso: edita (no se pide acceso a Frescofresh); la propietaria sigue siendo Frescofresh", async () => {
    expect(await editable(MONACO, 2, true)).toEqual({ status: 200, propietaria: FRESCOFRESH, transversal: true });
  });
  it("3. el mismo vehículo compartido SIN permiso: 403", async () => {
    expect((await editable(MONACO, 2, false)).status).toBe(403);
  });
  it("4. vehículo de Frescofresh NO compartido con Mónaco + permiso: no es accesible => 404 (no se puede editar)", async () => {
    expect((await editable(MONACO, 3, true)).status).toBe(404);
    expect((await editable(MONACO, 3, false)).status).toBe(404);
  });
  it("5. vehículo de otro tenant + permiso: nunca es accesible => 404; ids inexistentes también", async () => {
    expect((await editable(MONACO, 4, true)).status).toBe(404);
    expect((await editable(KUIQ, 4, true)).status).toBe(404);
    expect((await editable(MONACO, 99999, true)).status).toBe(404);
  });
  it("la accesibilidad es POR empresa activa: compartido con Mónaco y KuiqTrans, pero no con otra", async () => {
    expect((await editable(KUIQ, 2, true)).status).toBe(200);
    expect((await editable(OTRO_TENANT, 2, true)).status).toBe(404);
    expect((await editable(FRESCOFRESH, 3, false)).status).toBe(200); // la propietaria edita lo suyo, compartido o no
  });
  it("la consulta usa SIEMPRE la empresa activa para ambos predicados (propiedad y acceso compartido)", async () => {
    await obtenerVehiculoAccesible(MONACO, 2);
    expect(vi.mocked(query).mock.calls[0][1]).toEqual([MONACO, 2, MONACO, MONACO]);
  });
});
