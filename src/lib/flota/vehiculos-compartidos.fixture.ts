/**
 * Fixture ESTÁNDAR de vehículos compartidos (solo pruebas). Base simulada en memoria que evalúa la MISMA regla que el SQL de Flota
 * (`predicadoVehiculoAccesible`: propio OR fila en `flota_vehiculo_acceso`) con los parámetros reales que manda el código:
 *
 *   Empresa A = Frescofresh (3)      Empresa B = Logiservicios Mónaco (7)      Empresa Z = otro tenant (99)
 *   C-091BXF  propiedad A, COMPARTIDO con B          ← el caso real
 *   M-001MON  propiedad B (propio)
 *   C-777NOC  propiedad A, NO compartido
 *   X-999OTR  propiedad Z (otro tenant)
 *   C-INACT   propiedad A, compartido con B, INACTIVO
 */
export const EMPRESA_A = 3;
export const EMPRESA_B = 7;
export const EMPRESA_Z = 99;
export const EMPRESAS: Record<number, string> = { [EMPRESA_A]: "Frescofresh", [EMPRESA_B]: "Logiservicios Mónaco", [EMPRESA_Z]: "Otro tenant" };

export type VehiculoFixture = { id: number; empresa_id: number; placa: string; marca: string; modelo: string; descripcion: string | null; activo: number };
export const VEHICULOS: VehiculoFixture[] = [
  { id: 1, empresa_id: EMPRESA_B, placa: "M-001MON", marca: "Hino", modelo: "500", descripcion: null, activo: 1 },
  { id: 2, empresa_id: EMPRESA_A, placa: "C-091BXF", marca: "Volvo", modelo: "FH", descripcion: "Cabezal", activo: 1 },
  { id: 3, empresa_id: EMPRESA_A, placa: "C-777NOC", marca: "Isuzu", modelo: "NPR", descripcion: null, activo: 1 },
  { id: 4, empresa_id: EMPRESA_Z, placa: "X-999OTR", marca: "Kia", modelo: "K2700", descripcion: null, activo: 1 },
  { id: 5, empresa_id: EMPRESA_A, placa: "C-INACT", marca: "Hino", modelo: "300", descripcion: null, activo: 0 },
];
export const ACCESOS = [
  { vehiculo_id: 2, empresa_id: EMPRESA_B },
  { vehiculo_id: 5, empresa_id: EMPRESA_B },
];

export const ID = { PROPIO: 1, COMPARTIDO: 2, NO_COMPARTIDO: 3, OTRO_TENANT: 4, INACTIVO: 5, INEXISTENTE: 424242 };

/** La regla de Flota evaluada en memoria. */
export function accesible(empresaId: number, vehiculoId: number): VehiculoFixture | null {
  const v = VEHICULOS.find((x) => x.id === vehiculoId);
  if (!v) return null;
  return v.empresa_id === empresaId || ACCESOS.some((a) => a.vehiculo_id === v.id && a.empresa_id === empresaId) ? v : null;
}

/** Respuesta de `obtenerVehiculoAccesibleTx`: params = [empresa, vehiculo, empresa, empresa]. */
export function filaAccesibleTx(params: unknown[]) {
  const [empresaId, vehiculoId] = params as number[];
  const v = accesible(empresaId, vehiculoId);
  return v ? [{ ...v, compartido: v.empresa_id === empresaId ? 0 : 1 }] : [];
}

/** Respuesta de `listarVehiculosAccesibles`: params = [empresa, empresa, empresa]; mismo orden que el SQL (activo DESC, placa). */
export function filasListado(params: unknown[]) {
  const empresaId = (params as number[])[0];
  return VEHICULOS.filter((v) => accesible(empresaId, v.id))
    .sort((a, b) => b.activo - a.activo || a.placa.localeCompare(b.placa))
    .map((v) => ({
      ...v, empresa_duena_codigo: null, empresa_duena_nombre: EMPRESAS[v.empresa_id],
      compartido: v.empresa_id === empresaId ? 0 : 1,
    }));
}

/** ¿El SQL es la consulta de ACCESIBILIDAD (y no una lectura cruda por id)? */
export const esConsultaAccesible = (sql: string) => sql.includes("FROM flota_vehiculos") && sql.includes("flota_vehiculo_acceso");
