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

export function calcularEstadoAsistenciaSync(
  horaEntradaReal: string,
  horaEntradaTeorica: string,
  tolerancia: number,
): { estado: string; minutos: number } {
  const horaReal = extraerHoraTexto(horaEntradaReal);
  const horaTeorica = extraerHoraTexto(horaEntradaTeorica);
  if (!horaReal || !horaTeorica) {
    return { estado: "Presente", minutos: 0 };
  }
  const diferenciaMinutos = Math.floor(
    (horaReal.getTime() - horaTeorica.getTime()) / 60000,
  );
  if (diferenciaMinutos > tolerancia) {
    return { estado: "Retraso", minutos: diferenciaMinutos };
  }
  return { estado: "A tiempo", minutos: 0 };
}
