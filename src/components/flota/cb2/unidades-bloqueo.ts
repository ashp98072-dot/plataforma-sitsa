/** Una unidad de Flota solo puede recibir consumos si está «Activo» (el servidor exige representante canónico activo con acceso vigente).
 * Las unidades externas registradas aquí no traen estado y se consideran operables. */
export function motivoUnidadNoOperable(v: { placa: string; estado?: string | null }): string | null {
  return v.estado && v.estado !== "Activo"
    ? `La unidad ${v.placa} está «${v.estado}» en Flota: no puede recibir consumos hasta que se reactive allí. La fila queda pendiente.` : null;
}
export const unidadOperable = (v: { placa: string; estado?: string | null }) => motivoUnidadNoOperable(v) === null;
