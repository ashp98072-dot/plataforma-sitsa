import { hoyLocal } from "./dates";

/** Día de la semana en Guatemala (0=dom … 6=sáb) para fecha YYYY-MM-DD. */
export function diaSemanaFecha(fechaIso: string): number {
  const [y, m, d] = fechaIso.slice(0, 10).split("-").map(Number);
  // Mediodía UTC-6 ≈ evita bordes; usamos UTC noon + offset conceptual
  const utc = Date.UTC(y, m - 1, d, 18, 0, 0); // 12:00 Guatemala
  return new Date(utc).getUTCDay();
}

export function esSabado(fechaIso: string): boolean {
  return diaSemanaFecha(fechaIso) === 6;
}

export function esDomingo(fechaIso: string): boolean {
  return diaSemanaFecha(fechaIso) === 0;
}

/** Lunes (YYYY-MM-DD) de la semana que contiene `fechaIso`. */
export function lunesDeSemana(fechaIso: string): string {
  const [y, m, d] = fechaIso.slice(0, 10).split("-").map(Number);
  const utc = Date.UTC(y, m - 1, d, 18, 0, 0);
  const dow = new Date(utc).getUTCDay(); // 0 dom
  const delta = dow === 0 ? -6 : 1 - dow;
  const lun = new Date(utc + delta * 86400000);
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
}): { entrada: string; salida: string } {
  const entrada =
    opts.horaEntradaEmp || opts.horaEntradaDefault || "07:00:00";
  let salida = opts.horaSalidaEmp || opts.horaSalidaDefault || "16:00:00";
  if (esSabado(opts.fecha) && opts.horaSalidaSabado) {
    salida = opts.horaSalidaSabado;
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
