import { nombreComparable, identificarPlaca } from "@/lib/flota/combustible-coincidencias";
import { identificarEmpleado } from "@/lib/flota/cb2/empleados-coincidencias";
import type { CatalogosCB2, FilaCB2 } from "./client";
import type { DecisionAsignacion } from "./asignacion";
export const politicaIndependiente = (cat: CatalogosCB2) => !!cat.tercerosDirectos && !!cat.identidadesIndependientes;
export function pilotoIndependiente(f: FilaCB2, cat: CatalogosCB2, d: DecisionAsignacion = {}) {
  if (d.pilotoTipo === "REPORTADO" || (f.perfil==="SHELL" && !d.pilotoTipo && d.empleadoId==null && d.pilotoExternoId==null)) return null;
  const nombre = f.origen?.piloto ?? "";
  if (d.pilotoTipo === "INTERNO" || (!d.pilotoTipo && d.empleadoId != null)) {
    const p = cat.empleados?.find(p=>p.id===d.empleadoId);
    return p ? {tipo:"INTERNO" as const,...p,manual:true} : null;
  }
  if (d.pilotoTipo === "EXTERNO" || (!d.pilotoTipo && d.pilotoExternoId != null)) {
    const p = cat.pilotosExternos?.find(p=>p.id===d.pilotoExternoId);
    return p ? {tipo:"EXTERNO" as const,...p,manual:true} : null;
  }
  if (d.empleadoId === null || d.pilotoExternoId === null) return null;
  const internos = identificarEmpleado(nombre,cat.empleados??[]);
  const externos = (cat.pilotosExternos??[]).filter(p=>nombreComparable(p.nombre)===nombreComparable(nombre));
  if (internos.candidatos.length===0 && externos.length===1) return {tipo:"EXTERNO" as const,...externos[0],manual:false};
  if (internos.estado === "EXACTA" && internos.candidatos.length===1 && externos.length===0) return {tipo:"INTERNO" as const,...internos.candidatos[0],manual:false};
  return null;
}
export function unidadIndependiente(f: FilaCB2, cat: CatalogosCB2) {
  const m = identificarPlaca(f.placaNormalizada||f.placa,cat.vehiculos,v=>v.placa).candidatos;
  return m.length===1 ? m[0] : null;
}
/** El nombre del proveedor no implica una relacion laboral. Una eleccion de catalogo invalida si bloquea. */
export function pilotoReportadoPermitido(d: DecisionAsignacion, vehiculoId: number, cat?: CatalogosCB2) {
  return (vehiculoId > 0 || (vehiculoId < 0 && !!cat?.pilotoReportadoExterno)) && (!d.pilotoTipo || d.pilotoTipo === "REPORTADO") && d.empleadoId == null && d.pilotoExternoId == null;
}
export function seleccionPilotoIndependiente(f: FilaCB2, cat: CatalogosCB2, d: DecisionAsignacion, vehiculoId = 0) {
  const p = pilotoIndependiente(f,cat,d);
  if (!p && pilotoReportadoPermitido(d,vehiculoId,cat)) return {empleadoId:null,metodoEmpleado:"SIN_ASIGNACION" as const, ...(vehiculoId<0?{pilotoTipo:"REPORTADO" as const}: {})};
  if (!p) throw Error("Selecciona un piloto válido de la empresa o tercerizado.");
  return {pilotoTipo:p.tipo,metodoPiloto:p.manual ? "MANUAL" as const : "AUTOMATICA" as const,
    empleadoId:p.tipo==="INTERNO"?p.id:null, ...(p.tipo==="EXTERNO"?{pilotoExternoId:p.id}:{}),
    metodoEmpleado:p.tipo==="INTERNO" ? p.manual ? "MANUAL" as const : "EXACTA_NORMALIZADA" as const : "SIN_ASIGNACION" as const};
}
