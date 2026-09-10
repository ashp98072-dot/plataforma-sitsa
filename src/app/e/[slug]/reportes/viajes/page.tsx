"use client";

import { Suspense } from "react";
import PlanesViajesClient from "../../planes/planes-viajes-client";

/**
 * Operaciones → Reportes → "Reporte de viajes / historial"
 * (OPERACIONES-UX-PLANES-REPORTES-1).
 *
 * Vista de CONSULTA y ANÁLISIS del histórico de viajes: reutiliza tal
 * cual el mismo componente, backend y consultas de Planes / Viajes
 * (GET /tms/reportes/viajes), en `modo="reporte"`:
 *  - filtros históricos completos (los mismos de Planes / Viajes);
 *  - indicadores/KPIs + bloque de facturación (que se movieron aquí
 *    desde Planes / Viajes);
 *  - exportación Excel / PDF sobre todo el filtro;
 *  - tabla histórica de viajes en solo consulta (Ver expediente + PDF),
 *    sin acciones operativas — el cierre y la edición siguen viviendo
 *    exclusivamente en Planes / Viajes y Programación.
 *
 * Antes esta ruta redirigía a /e/[slug]/planes.
 */
export default function ReporteViajesPage() {
  return (
    <Suspense fallback={<p className="text-sm text-[var(--muted)]">Cargando reporte de viajes…</p>}>
      <PlanesViajesClient modo="reporte" />
    </Suspense>
  );
}
