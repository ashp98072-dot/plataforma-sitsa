function extraerHoraTexto(valor: string): Date | null {
  if (!valor) return null;
  const parte = (valor.includes(" ") ? valor.split(" ").pop() : valor)
    ?.trim()
    .slice(0, 8);
  if (!parte) return null;
  const m = parte.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = Number(m[3] ?? "0");
  if (hh > 23 || mm > 59 || ss > 59) return null;
  return new Date(2000, 0, 1, hh, mm, ss);
}

/** Minutos de retraso (0 si a tiempo o temprano). */
export function minutosRetraso(
  horaEntradaReal: string,
  horaEntradaTeorica: string,
): number {
  const horaReal = extraerHoraTexto(horaEntradaReal);
  const horaTeorica = extraerHoraTexto(horaEntradaTeorica);
  if (!horaReal || !horaTeorica) return 0;
  const diferenciaMinutos = Math.floor(
    (horaReal.getTime() - horaTeorica.getTime()) / 60000,
  );
  return Math.max(0, diferenciaMinutos);
}

/**
 * @param toleranciaDiaria minutos de gracia del día (0 = desde minuto 1)
 * @param toleranciaSemanal tope semanal de minutos de retraso “perdonados”
 * @param minutosYaUsadosSemana suma de retrasos de días previos en la semana
 */
export function calcularEstadoAsistenciaSync(
  horaEntradaReal: string,
  horaEntradaTeorica: string,
  toleranciaDiaria: number,
  opts?: {
    toleranciaSemanal?: number;
    minutosYaUsadosSemana?: number;
  },
): { estado: string; minutos: number } {
  const horaReal = extraerHoraTexto(horaEntradaReal);
  const horaTeorica = extraerHoraTexto(horaEntradaTeorica);
  if (!horaReal || !horaTeorica) {
    return { estado: "Presente", minutos: 0 };
  }
  const diferenciaMinutos = Math.floor(
    (horaReal.getTime() - horaTeorica.getTime()) / 60000,
  );
  if (diferenciaMinutos <= toleranciaDiaria) {
    return { estado: "A tiempo", minutos: 0 };
  }

  const late = diferenciaMinutos;
  const tolSem = opts?.toleranciaSemanal ?? 0;
  const usados = opts?.minutosYaUsadosSemana ?? 0;
  if (tolSem > 0) {
    const disponible = Math.max(0, tolSem - usados);
    if (late <= disponible) {
      return { estado: "A tiempo", minutos: 0 };
    }
    return { estado: "Retraso", minutos: late - disponible };
  }

  return { estado: "Retraso", minutos: late };
}