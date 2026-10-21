/**
 * Detalle del vehículo en los selectores de Fondos/Gastos: marca y modelo, y —para una unidad compartida con la empresa activa— la
 * empresa dueña y la marca «Compartido» (p. ej. «Volvo FH · Frescofresh · Compartido»). La placa sigue siendo la etiqueta principal.
 */
export type VehiculoCatalogo = {
  marca?: string | null;
  modelo?: string | null;
  compartido?: boolean;
  empresaDuenaNombre?: string | null;
};

export function detalleVehiculoCatalogo(v: VehiculoCatalogo): string {
  const base = [v.marca, v.modelo].filter(Boolean).join(" ");
  if (!v.compartido) return base;
  return [base, v.empresaDuenaNombre, "Compartido"].filter(Boolean).join(" · ");
}
