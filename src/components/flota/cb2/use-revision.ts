"use client";
import { useMemo, useState, type Dispatch, type SetStateAction } from "react";
import type { CatalogosCB2, FilaCB2 } from "./client";
import type { DecisionAsignacion } from "./asignacion";
import { asignacionesExactas, resumirRevision } from "./preview-model";

/** Autopropuestas derivadas del catálogo actual, con decisiones manuales por encima.
 * Una corrección o borrado explícito nunca se pierde por carga asíncrona o paginación. */
export function useRevisionCB2(filas: FilaCB2[], cat: CatalogosCB2, decisiones: Record<string, DecisionAsignacion> = {}, setDecisiones?: Dispatch<SetStateAction<Record<string, DecisionAsignacion>>>) {
    const [manuales, setManuales] = useState<Record<string, string>>({});
    const [omitidos, setOmitidos] = useState<Record<string, boolean>>({});
    const [revisados, setRevisados] = useState<Record<string, boolean>>({});
    const automaticas = useMemo(() => asignacionesExactas(filas, cat), [filas, cat]);
    const asignaciones = useMemo(() => ({ ...automaticas, ...manuales }), [automaticas, manuales]);
    const resumen = useMemo(() => resumirRevision(filas, cat, asignaciones, omitidos, revisados, decisiones), [filas, cat, asignaciones, omitidos, revisados, decisiones]);
    const solicitudes = Object.fromEntries(Object.entries(asignaciones).filter(([key, value]) => value && !omitidos[key]));
    return {
        asignaciones, manuales, omitidos, revisados, resumen, solicitudes,
        asignar: (clave: string, vehiculoId: string) => {
            setManuales(prev => ({ ...prev, [clave]: vehiculoId }));
            // El selector general es una decisión posterior: no conservar una asociación de otra unidad.
            if (vehiculoId !== (asignaciones[clave] ?? "")) setDecisiones?.(prev => ({ ...prev, [clave]: { ...prev[clave], pilotoExternoId: null, unidadExternaId: Number(vehiculoId) < 0 ? -Number(vehiculoId) : null, asociacionExternaId: null } }));
        },
        cambiarDecision: (clave: string, nueva: DecisionAsignacion) => {
            const anterior = decisiones[clave] ?? {};
            const cambiaIdentidad = anterior.pilotoExternoId !== nueva.pilotoExternoId || anterior.unidadExternaId !== nueva.unidadExternaId || anterior.asociacionExternaId !== nueva.asociacionExternaId;
            setDecisiones?.(prev => ({ ...prev, [clave]: nueva }));
            // Combustible, empleado y motivo nunca reaplican decisiones de vehículo anteriores.
            if (!cambiaIdentidad) return;
            const asociacion = cat.terceros?.find(a => a.id === nueva.asociacionExternaId && a.estado === "VERIFICADA");
            const unidad = nueva.unidadExternaId === undefined ? asociacion?.unidad_id : nueva.unidadExternaId;
            setManuales(prev => ({ ...prev, [clave]: unidad ? String(-unidad) : "" }));
        },
        seleccionar: (clave: string, valor: boolean) => setOmitidos(prev => ({ ...prev, [clave]: !valor })),
        revisar: (clave: string, valor: boolean) => setRevisados(prev => ({ ...prev, [clave]: valor })),
        reset: () => { setManuales({}); setOmitidos({}); setRevisados({}); },
    };
}
