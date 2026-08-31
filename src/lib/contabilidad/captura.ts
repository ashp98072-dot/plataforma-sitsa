// Validación de interfaz sin dependencias de servidor. El backend vuelve a validar.
export type LineaCaptura = { cuentaId: string; debe: string; haber: string };
export function importeCentavos(texto: string): bigint | null {
  const valor = texto.trim().replace(",", ".");
  if (!valor) return BigInt(0);
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(valor)) return null;
  const [entero, decimal = ""] = valor.split(".");
  return BigInt(entero) * BigInt(100) + BigInt(decimal.padEnd(2, "0"));
}
export function mostrarCentavos(valor: bigint): string {
  const absoluto = valor < BigInt(0) ? -valor : valor;
  return `${valor < BigInt(0) ? "-" : ""}${absoluto / BigInt(100)}.${String(absoluto % BigInt(100)).padStart(2, "0")}`;
}
export function resumirCaptura(lineas: LineaCaptura[]) {
  let debe = BigInt(0), haber = BigInt(0);
  const errores: string[] = [];
  lineas.forEach((l, i) => {
    const d = importeCentavos(l.debe), h = importeCentavos(l.haber);
    if (d === null || h === null) errores.push(`Línea ${i + 1}: usa importes positivos con máximo dos decimales, sin separadores de miles.`);
    else {
      debe += d; haber += h;
      if (!((d > BigInt(0) && h === BigInt(0)) || (h > BigInt(0) && d === BigInt(0)))) {
        errores.push(`Línea ${i + 1}: coloca un importe positivo únicamente en Debe o Haber.`);
      }
    }
  });
  return { debe, haber, diferencia: debe - haber, errores };
}
export function prepararCaptura(numero: string, fecha: string, glosa: string, lineas: LineaCaptura[], cuentasActivas: number[]) {
  if (!numero.trim() || numero.trim().length > 40) throw new Error("Ingresa un número de partida de hasta 40 caracteres.");
  const dia = new Date(`${fecha}T00:00:00.000Z`);
  if (!/^[1-9]\d{3}-\d{2}-\d{2}$/.test(fecha) || !Number.isFinite(dia.getTime()) || dia.toISOString().slice(0, 10) !== fecha) throw new Error("Selecciona una fecha válida.");
  if (!glosa.trim() || glosa.trim().length > 500) throw new Error("Describe el motivo de la partida (máximo 500 caracteres).");
  if (lineas.length < 2 || lineas.length > 500) throw new Error("La partida necesita entre 2 y 500 líneas.");
  for (const [i, l] of lineas.entries()) {
    if (!/^[1-9]\d*$/.test(l.cuentaId) || !cuentasActivas.includes(Number(l.cuentaId))) throw new Error(`Línea ${i + 1}: selecciona una cuenta activa de esta entidad.`);
  }
  const resumen = resumirCaptura(lineas);
  if (resumen.errores.length) throw new Error(resumen.errores[0]);
  if (resumen.diferencia !== BigInt(0)) throw new Error("La partida no cuadra. Debe y Haber deben ser iguales.");
  return { numero: numero.trim(), fecha, glosa: glosa.trim(), lineas: lineas.map((l) => ({
    cuentaId: Number(l.cuentaId), debe: Number(mostrarCentavos(importeCentavos(l.debe)!)), haber: Number(mostrarCentavos(importeCentavos(l.haber)!)),
  })) };
}
