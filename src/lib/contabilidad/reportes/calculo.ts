/**
 * Reportes contables base (M-4) — aritmética PURA en centavos enteros (BigInt): nunca se suma dinero con punto flotante.
 * Seguro para componentes cliente (sin dependencias de servidor).
 */
export type Centavos = bigint;

/** «1234.5» | «1234.50» | «0» | null → centavos. Acepta lo que devuelve DECIMAL(14,2) (también «-12.30» de saldos). */
export function aCentavos(valor: unknown): Centavos {
  if (valor === null || valor === undefined || valor === "") return BigInt(0);
  const t = String(valor).trim();
  const m = /^(-?)(\d+)(?:\.(\d{1,2})\d*)?$/.exec(t);
  if (!m) throw new Error(`Importe contable inválido: ${t}`);
  const c = BigInt(m[2]) * BigInt(100) + BigInt((m[3] ?? "").padEnd(2, "0") || "0");
  return m[1] ? -c : c;
}

/** centavos → «1234.50» (sin separadores; el formato visual lo hace la interfaz). */
export function deCentavos(c: Centavos): string {
  const neg = c < BigInt(0);
  const abs = neg ? -c : c;
  return `${neg ? "-" : ""}${abs / BigInt(100)}.${String(abs % BigInt(100)).padStart(2, "0")}`;
}

export type Linea = { debe: unknown; haber: unknown };
export function totalizar(lineas: Linea[]) {
  let debe = BigInt(0), haber = BigInt(0);
  for (const l of lineas) { debe += aCentavos(l.debe); haber += aCentavos(l.haber); }
  return { debe: deCentavos(debe), haber: deCentavos(haber), diferencia: deCentavos(debe - haber), cuadra: debe === haber };
}

/** Saldo acumulado línea a línea (debe − haber). `saldoInicial` solo existe si el llamador lo conoce; hoy no hay saldo inicial formal → 0. */
export function conSaldoAcumulado<T extends Linea>(lineas: T[], saldoInicial: Centavos = BigInt(0)) {
  let saldo = saldoInicial;
  return lineas.map((l) => {
    saldo += aCentavos(l.debe) - aCentavos(l.haber);
    return { ...l, saldo: deCentavos(saldo) };
  });
}

/** Saldo deudor/acreedor de una cuenta a partir de sus acumulados. */
export function saldosDeCuenta(debito: unknown, credito: unknown) {
  const neto = aCentavos(debito) - aCentavos(credito);
  return {
    saldoDeudor: deCentavos(neto > BigInt(0) ? neto : BigInt(0)),
    saldoAcreedor: deCentavos(neto < BigInt(0) ? -neto : BigInt(0)),
  };
}

export type FilaBalance = { debito: string; credito: string; saldoDeudor: string; saldoAcreedor: string };
export function totalesBalance(filas: FilaBalance[]) {
  let d = BigInt(0), c = BigInt(0), sd = BigInt(0), sa = BigInt(0);
  for (const f of filas) { d += aCentavos(f.debito); c += aCentavos(f.credito); sd += aCentavos(f.saldoDeudor); sa += aCentavos(f.saldoAcreedor); }
  return {
    totalDebe: deCentavos(d), totalHaber: deCentavos(c), diferencia: deCentavos(d - c),
    totalSaldoDeudor: deCentavos(sd), totalSaldoAcreedor: deCentavos(sa), cuadra: d === c && sd === sa,
  };
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;
export function fechaValida(v: string | null | undefined): string | undefined {
  if (!v || !FECHA.test(v)) return undefined;
  const d = new Date(`${v}T00:00:00.000Z`);
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === v ? v : undefined;
}

/** Nota que acompaña SIEMPRE al Mayor mientras no exista un saldo inicial formal (ver docs/CONTABILIDAD-REPORTES-M4.md). */
export const NOTA_SALDO_ACUMULADO =
  "El saldo acumulado se calcula únicamente con los asientos registrados dentro del rango consultado. La plataforma aún no tiene saldo inicial certificado: no se arrastra ningún saldo anterior al rango.";
