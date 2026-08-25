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

/** VIAT-5 — identidad de una fila de importación de rutas (Operaciones > Rutas > Importar Excel). */
export function identidadRutaImport(opts: {
  codigo?: string | null;
  cliente?: string | null;
}): string {
  const codigo = (opts.codigo ?? "").trim();
  const cliente = (opts.cliente ?? "").trim();
  if (codigo && cliente) return `Código ${codigo} (${cliente})`;
  if (codigo) return `Código ${codigo}`;
  if (cliente) return `Ruta de ${cliente} sin código`;
  return "Fila sin código";
}
