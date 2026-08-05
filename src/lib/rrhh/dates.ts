export class FechaInvalidaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FechaInvalidaError";
  }
}

/** Acepta DD/MM/AAAA o YYYY-MM-DD → ISO YYYY-MM-DD */
export function formatearFecha(entrada: string): string {
  if (!entrada || !entrada.trim()) {
    throw new FechaInvalidaError("La fecha no puede estar vacía.");
  }
  const texto = entrada.trim().replace(/[-.\s]/g, "/");
  const partes = texto.split("/").filter(Boolean);
  if (partes.length !== 3) {
    throw new FechaInvalidaError(`Fecha inválida: ${entrada}`);
  }
  let anio: string;
  let mes: string;
  let dia: string;
  if (partes[0].length === 4) [anio, mes, dia] = partes;
  else [dia, mes, anio] = partes;
  if (anio.length === 2) anio = (Number(anio) <= 79 ? "20" : "19") + anio;
  const diaI = Number(dia);
  const mesI = Number(mes);
  const anioI = Number(anio);
  const fecha = new Date(anioI, mesI - 1, diaI);
  if (
    fecha.getFullYear() !== anioI ||
    fecha.getMonth() !== mesI - 1 ||
    fecha.getDate() !== diaI
  ) {
    throw new FechaInvalidaError(`Fecha inválida: ${entrada}`);
  }
  return `${String(anioI).padStart(4, "0")}-${String(mesI).padStart(2, "0")}-${String(diaI).padStart(2, "0")}`;
}

export function formatearFechaVisible(
  fechaIso: string | null | undefined,
): string {
  if (!fechaIso) return "";
  const parte = String(fechaIso).slice(0, 10);
  const [anio, mes, dia] = parte.split("-");
  if (!anio || !mes || !dia) return String(fechaIso);
  return `${dia}/${mes}/${anio}`;
}

export function hoyLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function ahoraLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${y}-${m}-${day} ${hh}:${mm}:${ss}`;
}

export function horaAhora(): string {
  const d = new Date();
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/** Extrae HH:MM de un timestamp. */
export function horaCorta(value: string | Date | null | undefined): string {
  const ts = fmtTs(value);
  if (!ts) return "";
  const parte = ts.includes(" ") ? ts.split(" ")[1] : ts;
  return (parte || "").slice(0, 5);
}

export function fmtTs(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    const hh = String(value.getHours()).padStart(2, "0");
    const mm = String(value.getMinutes()).padStart(2, "0");
    const ss = String(value.getSeconds()).padStart(2, "0");
    return `${y}-${m}-${d} ${hh}:${mm}:${ss}`;
  }
  return String(value).replace("T", " ").slice(0, 19);
}

export function formatearTimestampVisible(
  value: string | null | undefined,
): string {
  if (!value) return "—";
  const s = String(value).replace("T", " ").slice(0, 19);
  const [fecha, hora] = s.split(" ");
  if (!fecha) return s;
  const [y, m, d] = fecha.split("-");
  if (!y || !m || !d) return s;
  return hora ? `${d}/${m}/${y} ${hora}` : `${d}/${m}/${y}`;
}

export function normalizarHora(valor: string): string | null {
  const t = valor.trim();
  const m = t.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const hh = Number(m[1]);
  const mm = Number(m[2]);
  const ss = Number(m[3] ?? "0");
  if (hh > 23 || mm > 59 || ss > 59) return null;
  return `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
}

export function toIsoDate(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const y = value.getFullYear();
    const m = String(value.getMonth() + 1).padStart(2, "0");
    const d = String(value.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  return String(value).slice(0, 10);
}
