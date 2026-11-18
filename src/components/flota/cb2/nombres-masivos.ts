import { nombreEmpleadoComparable } from "@/lib/flota/cb2/empleados-coincidencias";
import type { DecisionNombre, RevisionNombre } from "@/lib/flota/cb2/pilotos-nombres";

/**
 * Decisiones MASIVAS de nombres de pilotos (Shell). Solo actúan sobre nombres SIN decisión y nunca asignan una persona por parecido:
 *  - `reportado`: el nombre no tiene NINGÚN candidato entre los empleados (ni equivalencia previa) → piloto reportado (no acredita empleo ni identidad).
 *  - `empleado`: hay UN solo candidato y TODAS las palabras del nombre del archivo (mínimo dos) aparecen EXACTAS en el nombre del empleado. Las coincidencias aproximadas
 *    (ortografía distinta, nombre de otra persona con apellido igual, p. ej. «Mario» frente a «María») NO se aplican: quedan para revisión uno por uno.
 * Los nombres con varios candidatos o con equivalencia previa también quedan manuales (homónimos).
 */
export function decisionesMasivas(nombres: RevisionNombre[], decisiones: Record<string, DecisionNombre | undefined>) {
  const sinDecidir = nombres.filter((n) => !decisiones[n.clave]);
  const reportado = sinDecidir.filter((n) => n.candidatos.length === 0 && !n.propuesta && !n.equivalencia);
  const empleado = sinDecidir.filter((n) => {
    if (n.candidatos.length !== 1 || n.equivalencia) return false;
    const palabras = nombreEmpleadoComparable(n.originales[0] ?? "").split(" ").filter(Boolean);
    // Activo o Baja se tratan igual; las fechas laborales solo generan advertencias informativas en la revisión.
    const del = nombreEmpleadoComparable(n.candidatos[0].nombre).split(" ");
    return palabras.length >= 2 && palabras.every((p) => del.includes(p));
  });
  const manuales = sinDecidir.length - reportado.length - empleado.length;
  return { sinDecidir: sinDecidir.length, reportado, empleado, manuales };
}
