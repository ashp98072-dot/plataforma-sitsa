"use client";
import type { DecisionNombre, RevisionNombre } from "@/lib/flota/cb2/pilotos-nombres";
import { normalizarNombreReportado } from "@/lib/flota/cb2/pilotos-nombres";
import { etiquetaEmpleado, textoVentana, ventanaLaboral, type EmpleadoCatalogo } from "@/lib/flota/cb2/empleados-baja";
import { CatalogoSearchSelect } from "@/components/tms/catalogo-search-select";
import { input } from "./controles";

/** Clave de agrupación del nombre del Excel (la misma que usa el servidor para equivalencias). */
export const claveNombreShell = (original: string | undefined | null) => normalizarNombreReportado(original ?? "");

/** Estado legible de la decisión de piloto de un vale Shell. */
export function textoDecisionPiloto(d: DecisionNombre | undefined, empleados: EmpleadoCatalogo[]) {
  if (!d) return "Pendiente: elige un empleado o confirma el nombre original como piloto reportado.";
  if (d.tipo === "EMPLEADO") {
    const e = empleados.find(p => p.id === d.empleadoId);
    return `Empleado ${e ? etiquetaEmpleado(e) : `#${d.empleadoId}`} ${d.confirmado ? "confirmado" : "reconocido automáticamente"}.`;
  }
  return d.reportadoId ? `Piloto reportado #${d.reportadoId} ya registrado (${d.confirmado ? "confirmado" : "reconocido"}).` : "Se guardará el nombre original como piloto reportado al importar.";
}

/** Etiqueta corta del tipo de piloto: interno (RRHH), externo (reportado, guardado) o pendiente. */
export function etiquetaTipoPiloto(d: DecisionNombre | undefined) {
  return d?.tipo === "EMPLEADO" ? "Piloto interno (RR. HH.)" : d?.tipo === "REPORTADO" ? "Piloto externo (reportado)" : "Piloto pendiente";
}

/**
 * Casilla única para guardar un piloto que no está en RR. HH. como piloto reportado (flota_cb2_pilotos_reportados). No crea empleados ni toca planilla. Al confirmar la importación el nombre
 * queda registrado y las importaciones siguientes (Shell y HALEL) lo reconocen solas, sin pedir confirmación otra vez. Marcada y bloqueada = ya guardado (reconocido o confirmado).
 */
export function CasillaPilotoReportado({ decision, instalado, disabled, onElegir }: { nombre?: RevisionNombre; decision?: DecisionNombre; instalado: boolean; disabled?: boolean; onElegir: (d: DecisionNombre) => void }) {
  const guardado = decision?.tipo === "REPORTADO";
  const etiqueta = "Guardar como piloto reportado para futuras importaciones";
  return <label className="flex items-start gap-2 text-sm">
    <input type="checkbox" checked={guardado} disabled={!instalado || disabled || guardado}
      onChange={e => { if (e.target.checked) onElegir({ tipo: "REPORTADO", ...(decision?.tipo === "REPORTADO" && decision.reportadoId ? { reportadoId: decision.reportadoId } : {}), confirmado: true }); }}/>
    <span>{etiqueta}{guardado ? " (ya guardado: se reconocerá automáticamente)" : ""}</span>
  </label>;
}

/**
 * Resolución del piloto DESDE el vale (sin panel global). El nombre original se muestra y se conserva tal cual; la decisión se aplica a todas las
 * filas que comparten ese nombre y solo se persiste al confirmar la importación. No crea ni modifica empleados.
 */
export function PilotoShellVale({ original, nombre, decision, empleados = [], instalado, disabled, onElegir, externo }: {
  externo?: string;
  original: string; nombre?: RevisionNombre; decision?: DecisionNombre; empleados?: EmpleadoCatalogo[]; instalado: boolean; disabled?: boolean; onElegir: (d: DecisionNombre) => void;
}) {
  const candidatos = nombre?.candidatos ?? [], elegibles = nombre?.elegibles ?? [];
  const opciones = [...new Map([...candidatos, ...empleados].map(p => [p.id, p])).values()];
  const seleccionado = decision?.tipo === "EMPLEADO" ? opciones.find(p => p.id === decision.empleadoId) : undefined;
  const ventana = seleccionado ? ventanaLaboral(seleccionado, nombre?.rango) : "ACTIVO";
  const ambiguo = elegibles.length > 1, conflicto = nombre?.conflictoEquivalencia;
  return <fieldset disabled={disabled} className="space-y-2" aria-label={`Piloto del vale`}>
    <legend className="text-sm font-semibold">Piloto del Excel</legend>
    <p>Nombre original: <strong>{original || "No informado"}</strong>{nombre && nombre.filas > 1 ? ` · se aplica a las ${nombre.filas} filas con este nombre` : ""}.</p>
    <p data-estado-piloto><strong>{externo ? "Piloto externo (tercerizado)" : etiquetaTipoPiloto(decision)}</strong></p>
    <p role="status">{externo ? `Piloto tercerizado elegido: ${externo}. Elige un empleado o confirma el nombre original para reemplazarlo.` : textoDecisionPiloto(decision, opciones)}</p>
    {conflicto && <p role="alert">Conflicto: una equivalencia guardada apunta al empleado #{conflicto.equivalenciaId}, pero hoy el nombre identifica al empleado #{conflicto.reconocidoId}. No se asigna ninguno automáticamente: elige y confirma.</p>}
    {ambiguo && <p role="alert">Varios empleados coinciden con dos o más palabras ({elegibles.length}): elige manualmente a la persona correcta.</p>}
    {candidatos.length === 0 && !decision && <p>Ningún empleado coincide. Si no está en RR. HH., confirma el nombre original como piloto reportado (no crea empleados).</p>}
    {seleccionado && ventana !== "ACTIVO" && <p role="alert">Empleado de baja{seleccionado.fechaBaja ? ` desde ${seleccionado.fechaBaja}` : ""} (informativo, no bloquea). {textoVentana[ventana]}</p>}
    <CatalogoSearchSelect label={`Empleado existente para ${original || "este vale"}`} placeholder="Buscar empleado activo o de baja" inputClassName={input}
      value={seleccionado ? String(seleccionado.id) : ""} options={opciones.map(p => ({ value: String(p.id), label: etiquetaEmpleado(p) }))}
      onChange={v => { if (v) onElegir({ tipo: "EMPLEADO", empleadoId: Number(v), confirmado: true }); }}/>
    <CasillaPilotoReportado nombre={nombre} decision={decision} instalado={instalado} disabled={disabled} onElegir={onElegir}/>
    {!instalado && <p role="alert">Registro de pilotos reportados no instalado: solo se pueden vincular empleados existentes.</p>}
  </fieldset>;
}
