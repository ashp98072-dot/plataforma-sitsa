/**
 * Fixture de pruebas: sustituye SOLO el acceso a BD del vehículo solicitado (catálogo + valor actual del viaje) para las pruebas de
 * POST/PATCH /tms/planes que no tratan de ese campo y que, desde que es OBLIGATORIO, necesitan un perfil válido y un viaje que ya lo tenga.
 * Las pruebas del propio vehículo solicitado NO usan este fixture (modelan el catálogo y los casos históricos a mano).
 */
export const VEHICULO_FIXTURE = { id: 1, nombre: "Camión 2.5 toneladas" };

export function conVehiculoSolicitado<T extends object>(original: T): T {
  return {
    ...original,
    resolverVehiculoSolicitado: async (_empresaId: number, perfilId: number) => ({ id: perfilId, nombre: VEHICULO_FIXTURE.nombre }),
    vehiculoSolicitadoDelPlan: async () => ({ ...VEHICULO_FIXTURE }),
  };
}
