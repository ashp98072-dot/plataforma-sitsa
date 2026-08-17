import { hoyLocal } from "./dates";

/**
 * Convierte una fecha "YYYY-MM-DD" a un Date en mediodía Guatemala
 * (18:00 UTC, ya que Guatemala es UTC-6). Centraliza el parseo para
 * evitar bordes de fecha y detectar fechas inválidas temprano.
 */
function fechaUtcMediodiaGuatemala(fechaIso: string): Date {
  const partes = fechaIso.slice(0, 10).split("-").map(Number);
  const [y, m, d] = partes;
  if (
    partes.length !== 3 ||
    !Number.isInteger(y) ||
    !Number.isInteger(m) ||
    !Number.isInteger(d) ||
    m < 1 ||
    m > 12 ||
    d < 1 ||
    d > 31
  ) {
    throw new Error(
      `Fecha inválida en horario-teorico: "${fechaIso}" (se esperaba formato YYYY-MM-DD)`,
    );
  }
  const utc = Date.UTC(y, m - 1, d, 18, 0, 0); // 12:00 Guatemala
  const fecha = new Date(utc);
  // Date.UTC normaliza días fuera de rango (ej. 31 de febrero -> marzo),
  // así que validamos que el mes resultante coincida con el solicitado.
  if (fecha.getUTCMonth() !== m - 1) {
    throw new Error(
      `Fecha inválida en horario-teorico: "${fechaIso}" no es una fecha calendario real`,
    );
  }
  return fecha;
}

/** Día de la semana en Guatemala (0=dom … 6=sáb) para fecha YYYY-MM-DD. */
export function diaSemanaFecha(fechaIso: string): number {
  return fechaUtcMediodiaGuatemala(fechaIso).getUTCDay();
}

export function esSabado(fechaIso: string): boolean {
  return diaSemanaFecha(fechaIso) === 6;
}

export function esDomingo(fechaIso: string): boolean {
  return diaSemanaFecha(fechaIso) === 0;
}

/** Lunes (YYYY-MM-DD) de la semana que contiene `fechaIso`. */
export function lunesDeSemana(fechaIso: string): string {
  const fecha = fechaUtcMediodiaGuatemala(fechaIso);
  const dow = fecha.getUTCDay(); // 0 dom
  const delta = dow === 0 ? -6 : 1 - dow;
  const lun = new Date(fecha.getTime() + delta * 86400000);
  const yy = lun.getUTCFullYear();
  const mm = String(lun.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(lun.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export function horarioTeoricoParaFecha(opts: {
  fecha: string;
  horaEntradaEmp: string;
  horaSalidaEmp: string;
  horaEntradaDefault?: string;
  horaSalidaDefault?: string;
  horaSalidaSabado?: string;
  horaEntradaDomingo?: string;
  horaSalidaDomingo?: string;
}): { entrada: string; salida: string } {
  let entrada = opts.horaEntradaEmp || opts.horaEntradaDefault || "07:00:00";
  let salida = opts.horaSalidaEmp || opts.horaSalidaDefault || "16:00:00";

  if (esSabado(opts.fecha) && opts.horaSalidaSabado) {
    salida = opts.horaSalidaSabado;
  }

  // Personal que sí labora domingo (seguridad en turnos 24x48, pilotos con
  // rutas dominicales, etc.). Si no se configura horario de domingo, se usa
  // el horario normal/default; la bonificación correspondiente se calcula
  // en el módulo de planillas, no aquí.
  if (esDomingo(opts.fecha)) {
    if (opts.horaEntradaDomingo) entrada = opts.horaEntradaDomingo;
    if (opts.horaSalidaDomingo) salida = opts.horaSalidaDomingo;
  }

  return { entrada, salida };
}

export function semanaActualGuatemala(): { lunes: string; domingo: string } {
  const hoy = hoyLocal();
  const lunes = lunesDeSemana(hoy);
  const [y, m, d] = lunes.split("-").map(Number);
  const dom = new Date(Date.UTC(y, m - 1, d + 6, 18, 0, 0));
  const domingo = `${dom.getUTCFullYear()}-${String(dom.getUTCMonth() + 1).padStart(2, "0")}-${String(dom.getUTCDate()).padStart(2, "0")}`;
  return { lunes, domingo };
}