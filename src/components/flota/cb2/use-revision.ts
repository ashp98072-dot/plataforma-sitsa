"use client";
import { useMemo, useState } from "react";
import type { CatalogosCB2, FilaCB2 } from "./client";
import type { DecisionAsignacion } from "./asignacion";
import { asignacionesExactas, resumirRevision } from "./preview-model";

/** Autopropuestas derivadas del catálogo actual, con decisiones manuales por encima.
 * Una corrección o borrado explícito nunca se pierde por carga asíncrona o paginación. */
export function useRevisionCB2(filas: FilaCB2[], cat: CatalogosCB2, decisiones: Record<string, DecisionAsignacion> = {}) {
    const [manuales, setManuales] = useState<Record<string, string>>({});
    const [omitidos, setOmitidos] = useState<Record<string, boolean>>({});
    const [revisados, setRevisados] = useState<Record<string, boolean>>({});
    const automaticas = useMemo(() => asignacionesExactas(filas, cat), [filas, cat]);
    const asignaciones = useMemo(() => ({ ...automaticas, ...manuales }), [automaticas, manuales]);
    const resumen = useMemo(() => resumirRevision(filas, cat, asignaciones, omitidos, revisados, decisiones), [filas, cat, asignaciones, omitidos, revisados, decisiones]);
    const solicitudes = Object.fromEntries(Object.entries(asignaciones).filter(([key, value]) => value && !omitidos[key]));
    return {
        asignaciones, manuales, omitidos, revisados, resumen, solicitudes,
        asignar: (clave: string, vehiculoId: string) => setManuales(prev => ({ ...prev, [clave]: vehiculoId })),
        seleccionar: (clave: string, valor: boolean) => setOmitidos(prev => ({ ...prev, [clave]: !valor })),
        revisar: (clave: string, valor: boolean) => setRevisados(prev => ({ ...prev, [clave]: valor })),
        reset: () => { setManuales({}); setOmitidos({}); setRevisados({}); },
    };
}
