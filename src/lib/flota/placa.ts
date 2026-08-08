/** Normaliza placa para comparar (sin espacios ni guiones). */
export function normalizarPlaca(placa: string): string {
  return String(placa ?? "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "");
}

/**
 * Resuelve una unidad por placa exacta o coincidencia única parcial
 * (ej. "147CCT" → "C-147CCT" si solo hay una).
 */
export function resolverVehiculoPorPlacaInput<
  T extends { id: number; placa: string },
>(vehiculos: T[], placaRaw: string): T | null {
  const n = normalizarPlaca(placaRaw);
  if (!n) return null;
  const exact = vehiculos.find((v) => normalizarPlaca(v.placa) === n);
  if (exact) return exact;
  const parciales = vehiculos.filter((v) => {
    const p = normalizarPlaca(v.placa);
    return p.includes(n) || n.includes(p);
  });
  return parciales.length === 1 ? parciales[0] : null;
}
