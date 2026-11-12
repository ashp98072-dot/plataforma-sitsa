/** Solo fixtures sintéticos: expresa el antiguo alta combinada como tres operaciones independientes. */
import { registrarPiloto, registrarUnidad, crearAsociacion } from "./terceros";
import type { ContextoTerceros } from "./terceros-transaccion";
export async function registrarTerceros(ctx: ContextoTerceros, op: { pilotoReferencia: string; nombre: string; unidadReferencia: string; placa: string; tipo: string; descripcion: string; relacion: string; evidencia: string; proveedorId?: number }) {
  const piloto = await registrarPiloto(ctx, { confirmarCoincidencias: true, referencia: op.pilotoReferencia, nombre: op.nombre });
  const unidad = await registrarUnidad(ctx, { confirmarCoincidencias: true, referencia: op.unidadReferencia, placa: op.placa, tipo: op.tipo, descripcion: op.descripcion });
  return crearAsociacion(ctx, { pilotoId: piloto.id, unidadId: unidad.id, relacion: op.relacion, evidencia: op.evidencia });
}
