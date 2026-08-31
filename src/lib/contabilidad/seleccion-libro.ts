/** Solo selecciona automáticamente cuando no existe ambigüedad. */
export function libroUnicoActivo(libros: { id: number; activa: number }[]): string {
  const activos = libros.filter((l) => Number(l.activa) === 1);
  return activos.length === 1 ? String(activos[0].id) : "";
}
