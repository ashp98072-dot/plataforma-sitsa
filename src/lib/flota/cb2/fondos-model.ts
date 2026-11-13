import Decimal from "decimal.js";
import { nombreComparable } from "../combustible-coincidencias";
/** Contraste informativo. Nunca modifica importes, fechas o nombres ni autoriza pagos. */
export function contrastarFondo(consumo: {monto:string;fecha:string;piloto:string;moneda:string}, fondo: {monto:string;fecha:string;persona:string}) {
  const diferencia = new Decimal(consumo.monto).sub(fondo.monto).toFixed();
  const diferencias:string[]=[];
  if (consumo.moneda!=="GTQ") diferencias.push("MONEDA_NO_COMPARABLE");
  else if (!new Decimal(diferencia).isZero()) diferencias.push("MONTO");
  if (consumo.fecha!==fondo.fecha) diferencias.push("FECHA");
  if (nombreComparable(consumo.piloto)!==nombreComparable(fondo.persona)) diferencias.push("PERSONA");
  return {diferencias,diferenciaMonto:consumo.moneda==="GTQ"?diferencia:null};
}
