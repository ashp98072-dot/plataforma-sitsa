import { pilotoDirecto } from "./identidad-directa";
import { pilotoIndependiente, politicaIndependiente, pilotoReportadoPermitido } from "./piloto-independiente";
import { tipoTerceroCompatible } from "@/lib/flota/cb2/identidad-directa";
import { unidadTerceraCompatible } from "@/lib/flota/cb2/terceros-busqueda";
import { nombreComparable, placaCompatible } from "@/lib/flota/combustible-coincidencias";
import { clasificarProducto } from "@/lib/flota/cb2/clasificacion";
import type { CatalogosCB2 } from "./client";
import type { DecisionAsignacion } from "./asignacion";
import { avisosDetallados, type CandidatoRevision } from "./preview-model";

/** Explica la selección actual; nunca convierte un diagnóstico en autorización. */
export function causasAsignacion(g: CandidatoRevision, cat: CatalogosCB2, d: DecisionAsignacion = {}) {
  if (g.estado === "RESUELTO") return [];
  const causas: string[] = [];
  if (g.estado === "BLOQUEADO") causas.push(...g.activas.flatMap(f => [...f.errores, ...avisosDetallados(f).filter(a => a.nivel === "BLOQUEO").map(a => a.mensaje)]), "El servidor bloquea este candidato; corregir la asignación no elimina el conflicto histórico o del archivo.");
  if (!g.vehiculoId) {
    causas.push("Falta seleccionar una unidad válida. Las coincidencias ambiguas no se asignan automáticamente.");
  } else if (!cat.vehiculos.some(v => String(v.id) === g.vehiculoId)) causas.push(`Unidad #${g.vehiculoId} ausente del catálogo disponible de esta empresa.`);
  if (politicaIndependiente(cat)) {
    const p = pilotoIndependiente(g.fila, cat, d);
    if (!p && !pilotoReportadoPermitido(d,Number(g.vehiculoId),cat)) causas.push("Falta un piloto interno o tercerizado inequívoco; selecciona una sola identidad.");
    if (Number(g.vehiculoId) < 0) {
      const unidad = cat.unidadesExternas?.find(u => u.id === -Number(g.vehiculoId));
      if (!cat.tercerosHabilitados || !unidad || g.activas.some(f => !tipoTerceroCompatible(f.placaNormalizada || f.placa, unidad) || !unidadTerceraCompatible(f.placaNormalizada || f.placa, unidad.id, cat.unidadesExternas ?? [], d.motivoUnidad))) causas.push("Unidad externa pendiente o incompatible con la placa o el tipo.");
    } else if (g.vehiculoId && g.activas.some(f => !placaCompatible(f.placaNormalizada || f.placa, Number(g.vehiculoId), cat.vehiculos)) && (d.motivoUnidad?.trim().length ?? 0) < 10) causas.push("La unidad necesita revisión y una justificación de al menos 10 caracteres.");
  } else if (Number(g.vehiculoId) < 0 && cat.tercerosDirectos) {
    const p = pilotoDirecto(g.fila, cat, d);
    const unidad = cat.unidadesExternas?.find(u => u.id === -Number(g.vehiculoId));
    if (!p || !unidad || !cat.tercerosHabilitados || g.activas.some(f => !tipoTerceroCompatible(f.placaNormalizada || f.placa, unidad) || nombreComparable(p.nombre) !== nombreComparable(f.origen?.piloto ?? "") || !unidadTerceraCompatible(f.placaNormalizada || f.placa, -Number(g.vehiculoId), cat.unidadesExternas ?? [], d.motivoUnidad))) causas.push("Piloto, unidad o tipo externos pendientes o incompatibles con el Excel.");
  } else if (Number(g.vehiculoId) < 0) {
    const id = d.asociacionExternaId === undefined ? g.fila.asociacionExterna?.id : d.asociacionExternaId;
    const a = cat.terceros?.find(a => a.id === id && -a.unidad_id === Number(g.vehiculoId));
    if (!cat.tercerosHabilitados) causas.push("Política D2 aprobada; tercerizados deshabilitados por configuración. La activación corresponde al propietario.");
    if (!a || a.estado !== "VERIFICADA") causas.push("La asociación externa no está disponible o verificada; puede haber sido revocada.");
    else if (g.activas.some(f => nombreComparable(a.nombre) !== nombreComparable(f.origen?.piloto ?? "") || !unidadTerceraCompatible(f.placaNormalizada || f.placa, a.unidad_id, cat.unidadesExternas ?? (cat.terceros ?? []).filter((v,i,all) => all.findIndex(x => x.unidad_id === v.unidad_id) === i).map(v => ({ id: v.unidad_id, placa: v.placa })), d.motivoUnidad))) causas.push("El piloto o la placa originales no corresponden a la asociación externa elegida.");
  } else if (g.vehiculoId) {
    const motivo = d.motivoUnidad?.trim() ?? "";
    if (g.activas.some(f => !placaCompatible(f.placaNormalizada || f.placa, Number(g.vehiculoId), cat.vehiculos)) && motivo.length < 10) causas.push("La unidad no coincide inequívocamente con la placa del Excel; revisa el ID o justifica la excepción con al menos 10 caracteres.");
    else if (motivo && motivo.length < 10) causas.push("La justificación de unidad debe tener al menos 10 caracteres.");
    if (d.empleadoId && !cat.empleados?.some(e => e.id === d.empleadoId)) causas.push("El empleado elegido ya no está disponible en esta empresa.");
  }
  if (d.exigirProducto && g.activas.some(f => !(d.productoClasificado ?? clasificarProducto(f.origen?.producto)))) causas.push("Falta clasificar el combustible; puede elegirse NO DETERMINADO tras revisar el original.");
  return [...new Set(causas)];
}
