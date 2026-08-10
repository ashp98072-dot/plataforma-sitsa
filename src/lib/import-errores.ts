/** Formatea un error de importación Excel con fila + identidad + motivo. */
export function formatoErrorImport(opts: {
  filaExcel?: number | null;
  identidad: string;
  detalle: string;
}): string {
  const partes: string[] = [];
  if (opts.filaExcel != null && opts.filaExcel > 0) {
    partes.push(`Fila ${opts.filaExcel}`);
  }
  const id = opts.identidad.trim();
  if (id) partes.push(id);
  const cabeza = partes.length ? partes.join(" · ") : "Fila desconocida";
  const detalle = opts.detalle.trim() || "error desconocido";
  return `${cabeza}: ${detalle}`;
}

export function identidadEmpleadoImport(opts: {
  codigo?: string | null;
  nombre?: string | null;
}): string {
  const codigo = (opts.codigo ?? "").trim();
  const nombre = (opts.nombre ?? "").trim();
  if (codigo && nombre) return `Empleado ${codigo} (${nombre})`;
  if (codigo) return `Empleado ${codigo}`;
  if (nombre) return `Empleado (${nombre})`;
  return "Empleado sin código";
}

export function identidadVehiculoImport(opts: {
  placa?: string | null;
  descripcion?: string | null;
}): string {
  const placa = (opts.placa ?? "").trim().toUpperCase();
  const desc = (opts.descripcion ?? "").trim();
  if (placa && desc) return `Vehículo ${placa} (${desc})`;
  if (placa) return `Vehículo ${placa}`;
  if (desc) return `Vehículo (${desc})`;
  return "Vehículo sin placa";
}
