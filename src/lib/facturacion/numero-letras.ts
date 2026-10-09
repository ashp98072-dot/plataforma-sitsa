/**
 * Total en letras de una factura, en quetzales y centavos: «UN MIL DOSCIENTOS TREINTA Y NUEVE CON 44/100».
 *
 * Determinista y sin dependencias (no usa servicios externos). Convenciones:
 * - Antes de «MIL» / «MILLÓN(ES)» el uno se apocopa («UN MIL», «VEINTIÚN MIL», «UN MILLÓN»); al final queda «UNO» /
 *   «VEINTIUNO».
 * - Los centavos van siempre con dos cifras sobre 100 («CON 05/100»), sin nombre de moneda, como en la factura actual.
 * - Admite de 0 a 999,999,999,999.99; fuera de ese rango (o NaN/∞/negativos) lanza `RangeError`: un total inválido nunca
 *   debe imprimirse como letras.
 */

const MENORES_DE_30 = [
  "CERO", "UNO", "DOS", "TRES", "CUATRO", "CINCO", "SEIS", "SIETE", "OCHO", "NUEVE",
  "DIEZ", "ONCE", "DOCE", "TRECE", "CATORCE", "QUINCE", "DIECISÉIS", "DIECISIETE", "DIECIOCHO", "DIECINUEVE",
  "VEINTE", "VEINTIUNO", "VEINTIDÓS", "VEINTITRÉS", "VEINTICUATRO", "VEINTICINCO", "VEINTISÉIS", "VEINTISIETE", "VEINTIOCHO", "VEINTINUEVE",
];
const DECENAS = ["", "", "", "TREINTA", "CUARENTA", "CINCUENTA", "SESENTA", "SETENTA", "OCHENTA", "NOVENTA"];
const CENTENAS = ["", "CIENTO", "DOSCIENTOS", "TRESCIENTOS", "CUATROCIENTOS", "QUINIENTOS", "SEISCIENTOS", "SETECIENTOS", "OCHOCIENTOS", "NOVECIENTOS"];

/** 1..999 */
function menorDeMil(n: number, apocopar: boolean): string {
  if (n === 100) return "CIEN";
  const partes: string[] = [];
  const c = Math.floor(n / 100);
  const r = n % 100;
  if (c) partes.push(CENTENAS[c]);
  if (r) {
    if (r < 30) partes.push(MENORES_DE_30[r]);
    else {
      const d = Math.floor(r / 10);
      const u = r % 10;
      partes.push(u ? `${DECENAS[d]} Y ${MENORES_DE_30[u]}` : DECENAS[d]);
    }
  }
  const texto = partes.join(" ");
  if (!apocopar) return texto;
  return texto.replace(/VEINTIUNO$/, "VEINTIÚN").replace(/UNO$/, "UN");
}

function enteroALetras(n: number, apocopar: boolean): string {
  if (n === 0) return "CERO";
  const millones = Math.floor(n / 1_000_000);
  const resto = n % 1_000_000;
  const partes: string[] = [];
  if (millones) partes.push(millones === 1 ? "UN MILLÓN" : `${enteroALetras(millones, true)} MILLONES`);
  const miles = Math.floor(resto / 1000);
  if (miles) partes.push(`${menorDeMil(miles, true)} MIL`);
  const unidades = resto % 1000;
  if (unidades) partes.push(menorDeMil(unidades, apocopar));
  return partes.join(" ");
}

export function totalEnLetras(monto: number): string {
  if (typeof monto !== "number" || !Number.isFinite(monto) || monto < 0) throw new RangeError("Monto inválido para el total en letras.");
  const centavosTotales = Math.round(monto * 100);
  const entero = Math.floor(centavosTotales / 100);
  if (entero >= 1_000_000_000_000) throw new RangeError("Monto fuera de rango para el total en letras.");
  const centavos = centavosTotales % 100;
  return `${enteroALetras(entero, false)} CON ${String(centavos).padStart(2, "0")}/100`;
}
