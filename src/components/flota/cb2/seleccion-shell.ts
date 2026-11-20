import type { DecisionAsignacion } from "./asignacion";
import type { CatalogosCB2, FilaCB2 } from "./client";
import { seleccionPilotoIndependiente } from "./piloto-independiente";
import { vinculoPorDefecto } from "./unidad-shell";

/** La selección externa explícita conserva su ID; no crea una equivalencia laboral. */
export function seleccionShell(fila: FilaCB2, cat: CatalogosCB2, decision: DecisionAsignacion, vehiculoId: number) {
    if (decision.pilotoTipo === "EXTERNO") return seleccionPilotoIndependiente(fila, cat, decision, vehiculoId);
    const nombre = decision.decisionNombre;
    return {
        ...(vehiculoId === 0 ? { vinculoUnidad: vinculoPorDefecto(fila, cat) ?? undefined } : {}),
        empleadoId: nombre?.tipo === "EMPLEADO" ? nombre.empleadoId : null,
        metodoEmpleado: nombre?.tipo === "EMPLEADO" ? "MANUAL" as const : "SIN_ASIGNACION" as const,
        ...(vehiculoId < 0 ? nombre?.tipo === "EMPLEADO"
            ? { pilotoTipo: "INTERNO" as const, metodoPiloto: "MANUAL" as const }
            : { pilotoTipo: "REPORTADO" as const } : {}),
        ...(nombre ? { decisionNombre: nombre } : {}),
    };
}
