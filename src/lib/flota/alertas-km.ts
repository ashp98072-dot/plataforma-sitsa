export function kmPendienteServicio(
  kmActual: number | null,
  kmUltimo: number | null,
  intervalo: number,
): number | null {
  if (kmActual == null) return null;
  const ultimo = kmUltimo ?? 0;
  return intervalo - (kmActual - ultimo);
}

export function estiloAlertaKm(pendiente: number | null): {
  badge: string;
  texto: string;
  footer: string;
} {
  if (pendiente == null) {
    return {
      badge: "bg-slate-700 text-slate-200",
      texto: "Sin datos",
      footer: "Sin datos",
    };
  }
  if (pendiente <= 0) {
    return {
      badge: "bg-red-900/50 text-red-200 border border-red-700",
      texto: `Vencido (${Math.abs(pendiente).toLocaleString("es-GT")} km)`,
      footer: "Servicio vencido",
    };
  }
  const faltan = pendiente.toLocaleString("es-GT");
  if (pendiente <= 500) {
    return {
      badge: "bg-red-900/40 text-red-200 border border-red-700",
      texto: `Faltan ${faltan} km`,
      footer: "Crítico",
    };
  }
  if (pendiente <= 1500) {
    return {
      badge: "bg-amber-900/40 text-amber-200 border border-amber-700",
      texto: `Faltan ${faltan} km`,
      footer: "Próximo servicio",
    };
  }
  return {
    badge: "bg-emerald-900/40 text-emerald-200 border border-emerald-700",
    texto: `Faltan ${faltan} km`,
    footer: "Al día",
  };
}
