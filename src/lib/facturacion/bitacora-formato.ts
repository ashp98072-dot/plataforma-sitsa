/** Formato PURO (seguro para componentes cliente) de una línea de bitácora: «19/10/2026 10:38 · admin · Emitió factura TEST-CXC-001». */
export type EventoBitacoraVista = { id: number; fecha: string; usuario: string | null; resumen: string; cambios?: { campo: string; antes: string | null; despues: string | null }[] };

/** «YYYY-MM-DD HH:mm:ss» → «DD/MM/YYYY HH:mm» (sin convertir zona horaria: la fecha ya viene de la base). */
export function fechaHoraBitacora(fecha: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/.exec(fecha);
  return m ? `${m[3]}/${m[2]}/${m[1]} ${m[4]}:${m[5]}` : fecha;
}

export function lineaBitacora(e: EventoBitacoraVista): string {
  return `${fechaHoraBitacora(e.fecha)} · ${e.usuario ?? "sistema"} · ${e.resumen}`;
}
