/**
 * Resumen de fondos del viaje en Programación: viáticos + otros fondos = total general. Solo es VISUAL (se recalcula al editar los montos); lo que se persiste y consolida en
 * Solicitudes de fondo sigue siendo el guardado del viaje + `sincronizarFondosDePlanes`, que ya descarta montos en Q0 (mismas reglas: monto > 0).
 */
const aMonto = (v: unknown) => { const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", ".")); return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : 0; };

export type ResumenFondosViaje = { totalViaticos: number; totalOtros: number; totalGeneral: number; filasViaticos: number; filasOtros: number };

export function resumenFondosViaje(viaticos: readonly unknown[], otros: readonly unknown[]): ResumenFondosViaje {
  const v = viaticos.map(aMonto).filter((m) => m > 0), o = otros.map(aMonto).filter((m) => m > 0);
  const suma = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100;
  const totalViaticos = suma(v), totalOtros = suma(o);
  return { totalViaticos, totalOtros, totalGeneral: Math.round((totalViaticos + totalOtros) * 100) / 100, filasViaticos: v.length, filasOtros: o.length };
}
