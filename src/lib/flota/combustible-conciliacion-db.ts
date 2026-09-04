import {
  listarCargasCombustibleParaConciliacion,
} from "./combustible";

import type {
  CargaSistemaConciliacion,
} from "./combustible-conciliacion";

export async function obtenerCargasSistemaParaConciliacion(
  empresaId: number,
  desde: string,
  hasta: string,
): Promise<CargaSistemaConciliacion[]> {
  if (!Number.isInteger(empresaId) || empresaId <= 0) {
    throw new Error("empresaId inválido.");
  }

  if (!desde || !hasta || desde > hasta) {
    throw new Error("Rango de fechas inválido.");
  }

  const cargas =
    await listarCargasCombustibleParaConciliacion(
      empresaId,
      desde,
      hasta,
    );

  return cargas.map((carga) => ({
    id: carga.id,
    numeroVale: carga.numeroVale,
    fechaConsumo: carga.fechaConsumo,
    placa: carga.placa,
    pilotoNombre: carga.pilotoNombre,
    producto: carga.tipoCombustible,
    galones: carga.galones,
    precioGalon: carga.precioGalon,
    monto: carga.monto,
    // Estado operativo AL MOMENTO de conciliar — metadata histórica, ver
    // JSDoc de CargaSistemaConciliacion.estadoSistema.
    estadoSistema: carga.estado,
  }));
}