/** DATE calendario estricto. UTC solo representa coordenadas del calendario, no instantes laborales. */
export class RangoVacacionesInvalido extends Error {}
const MS_DIA=86400000;
export function diaCalendarioIso(s:string):number {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||s.startsWith("0000")) throw new RangoVacacionesInvalido("Usa fechas válidas en formato YYYY-MM-DD.");
  const [y,m,d]=s.split("-").map(Number);
  const t=new Date(0);t.setUTCFullYear(y,m-1,d);t.setUTCHours(0,0,0,0);
  if(t.getUTCFullYear()!==y||t.getUTCMonth()!==m-1||t.getUTCDate()!==d)throw new RangoVacacionesInvalido("Fecha calendario inválida.");
  return t.valueOf()/MS_DIA;
}
export function diasCalendarioInclusivos(inicio:string,fin:string):number {
  const n=diaCalendarioIso(fin)-diaCalendarioIso(inicio)+1;
  if(!Number.isSafeInteger(n)||n<=0)throw new RangoVacacionesInvalido("La fecha de fin no puede ser anterior a la de inicio.");
  return n;
}
export function validarDiasCalculados(inicio:string,fin:string,dias:number):number {
  const n=diasCalendarioInclusivos(inicio,fin);
  if(!Number.isSafeInteger(dias)||dias<0||dias>n)throw new RangoVacacionesInvalido("El cálculo de días no corresponde al rango calendario.");
  return dias;
}
export function contarDiasVacacionesCalendario(inicio:string,fin:string,feriados:ReadonlySet<string>=new Set()):number {
  const n=diasCalendarioInclusivos(inicio,fin),primero=diaCalendarioIso(inicio);
  const weekday=((primero+4)%7+7)%7;
  const domingos=Math.floor(n/7)+(((7-weekday)%7)<n%7?1:0);
  let dias=n-domingos;
  // O(feriados), no O(años/días): una captura intermedia no bloquea el runtime.
  for(const f of feriados) {
    try { const v=diaCalendarioIso(f);if(v>=primero&&v<primero+n&&((v+4)%7+7)%7!==0)dias--; } catch { /* Feriado inválido no coincide con ninguna fecha real. */ }
  }
  return validarDiasCalculados(inicio,fin,dias);
}
export type CalculoVacaciones={clave:string;dias:number};
export function diasPreviewActual(calculo:CalculoVacaciones|null,clave:string,inicio:string,fin:string):number|null {
  if(!calculo||calculo.clave!==clave)return null;
  try{return validarDiasCalculados(inicio,fin,calculo.dias);}catch{return null;}
}
export function puedeRegistrarRango(dias:number|null,saldo:number|null,usaSaldo:boolean,historico:boolean=false) {
  return dias!==null&&Number.isSafeInteger(dias)&&dias>0&&(!usaSaldo||historico||(saldo!==null&&Number.isFinite(saldo)&&saldo>=dias));
}
