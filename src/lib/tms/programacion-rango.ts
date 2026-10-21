/** Intervalo inclusivo de fechas de calendario, compartido por UI y endpoints. */
export type IntervaloProgramacion = { desde: string; hasta: string };

export function errorRangoProgramacion(desde: string, hasta: string): string | null {
  if (!desde || !hasta) return "Selecciona ambas fechas: Desde y Hasta.";
  const valida = (valor: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(valor)) return false;
    const fecha = new Date(`${valor}T00:00:00Z`);
    return !Number.isNaN(fecha.getTime()) && fecha.toISOString().slice(0, 10) === valor;
  };
  if (!valida(desde) || !valida(hasta)) return "Indica fechas válidas en Desde y Hasta.";
  if (desde > hasta) return "La fecha Desde no puede ser posterior a Hasta.";
  return null;
}

/** Un extremo presente activa Rango, incluso si es inválido: nunca cae silenciosamente a Mañana. */
export function rangoProgramacionDesdeParams(params: { desde?: string | string[]; hasta?: string | string[] }): IntervaloProgramacion | undefined {
  if (params.desde === undefined && params.hasta === undefined) return undefined;
  const primero = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
  return { desde: primero(params.desde), hasta: primero(params.hasta) };
}

/** Serialización del estado de Rango; conserva query params ajenos y hash, sin navegar/refetch RSC. */
export function urlRangoProgramacion(actual: string, intervalo: IntervaloProgramacion | null): string {
  const url = new URL(actual);
  if (intervalo) {
    url.searchParams.set("desde", intervalo.desde);
    url.searchParams.set("hasta", intervalo.hasta);
  } else {
    url.searchParams.delete("desde");
    url.searchParams.delete("hasta");
  }
  return `${url.pathname}${url.search}${url.hash}`;
}
