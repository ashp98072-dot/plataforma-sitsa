export type SaldoAlerta = {
  empleadoId: number; codigo: string; nombre: string; dpi: string | null;
  diasDisponibles: number; fechaContratacion: string | null;
};
export type FiltrosSaldo = { nombre: string; desde: string; hasta: string; orden: string };
const normalizar = (s: string) => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
export function filtrarSaldos(saldos: SaldoAlerta[], filtro: FiltrosSaldo) {
  const texto = normalizar(filtro.nombre);
  return saldos.filter((s) => {
    if (!normalizar([s.nombre, s.codigo, s.dpi ?? ""].join(" ")).includes(texto)) return false;
    if ((filtro.desde || filtro.hasta) && !s.fechaContratacion) return false;
    return (!filtro.desde || s.fechaContratacion! >= filtro.desde) && (!filtro.hasta || s.fechaContratacion! <= filtro.hasta);
  }).sort((a, b) => {
    if (filtro.orden === "antiguedad" || filtro.orden === "reciente") {
      if (!a.fechaContratacion && b.fechaContratacion) return 1;
      if (a.fechaContratacion && !b.fechaContratacion) return -1;
      const fechas = (a.fechaContratacion ?? "").localeCompare(b.fechaContratacion ?? "");
      if (fechas) return filtro.orden === "antiguedad" ? fechas : -fechas;
    }
    if (filtro.orden === "saldo" && a.diasDisponibles !== b.diasDisponibles) return b.diasDisponibles - a.diasDisponibles;
    return a.nombre.localeCompare(b.nombre, "es") || a.empleadoId - b.empleadoId;
  });
}
export function resumenNotificacionesVacaciones(slug: string, pendientes: number, umbral: number) {
  const items: { id: string; tipo: "aprobacion" | "alerta"; titulo: string; detalle: string; enlace: string; creadoAt: null }[] = [];
  if (pendientes > 0) items.push({
    id: "vacaciones-solicitudes-pendientes", tipo: "aprobacion",
    titulo: `${pendientes} solicitud(es) de vacaciones pendiente(s)`,
    detalle: "Pendientes de revisión. Consulta el listado para aprobar o rechazar.",
    enlace: `/e/${slug}/rrhh/vacaciones`, creadoAt: null,
  });
  if (umbral > 0) items.push({
    id: "vacaciones-saldo-15-resumen", tipo: "alerta",
    titulo: `${umbral} colaborador(es) alcanzaron el umbral de 15 días`,
    detalle: "Tienen 15 días o más de vacaciones disponibles. No equivale a solicitudes pendientes.",
    enlace: `/e/${slug}/rrhh/vacaciones`, creadoAt: null,
  });
  return items;
}
