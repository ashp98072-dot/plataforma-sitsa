import Link from "next/link";

export const ACCESOS_LOGISTICOS = [
  { ruta: "programacion", titulo: "Programación", descripcion: "Crear, asignar y editar viajes." },
  { ruta: "planes", titulo: "Planes / Viajes", descripcion: "Seguimiento, evidencias y cierres." },
  { ruta: "viaticos", titulo: "Viáticos", descripcion: "Autorizar, entregar y liquidar viáticos." },
  { ruta: "clientes", titulo: "Clientes", descripcion: "Consultar y administrar clientes." },
  { ruta: "portales-proveedores", titulo: "Accesos proveedores", descripcion: "Consultar portales, usuarios y contraseñas asignadas." },
] as const;

type ViajeResumen = { estado: string; pendiente_cierre: number };

export function resumenLogistico(planes: readonly ViajeResumen[]) {
  return {
    visibles: planes.length,
    enRuta: planes.filter((p) => p.estado === "En ruta").length,
    pendientes: planes.filter((p) => Boolean(p.pendiente_cierre)).length,
    cerrados: planes.filter((p) => p.estado === "Cerrado").length,
  };
}

export function TmsQuickLinks({ slug }: { slug: string }) {
  return (
    <nav aria-label="Accesos rápidos de logística" className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
      {ACCESOS_LOGISTICOS.map((acceso) => (
        <Link key={acceso.ruta} href={`/e/${slug}/${acceso.ruta}`} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 transition-colors hover:border-[var(--accent)] focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
          <span className="font-semibold text-[var(--accent)]">{acceso.titulo} →</span>
          <p className="mt-1 text-sm text-[var(--muted)]">{acceso.descripcion}</p>
        </Link>
      ))}
    </nav>
  );
}

export function TmsSummaryCards({ planes, loading }: { planes: readonly ViajeResumen[]; loading: boolean }) {
  const resumen = resumenLogistico(planes);
  const tarjetas = [
    ["Viajes visibles", resumen.visibles], ["En ruta", resumen.enRuta],
    ["Pendientes de cierre", resumen.pendientes], ["Cerrados", resumen.cerrados],
  ] as const;
  return (
    <section aria-labelledby="resumen-operativo" className="space-y-3">
      <h2 id="resumen-operativo" className="text-lg font-semibold">Resumen operativo</h2>
      <p className="text-xs text-[var(--muted)]">Resumen de los viajes cargados que coinciden con los filtros del seguimiento; no representa el histórico completo.</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-busy={loading}>
        {tarjetas.map(([titulo, cantidad]) => (
          <div key={titulo} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <p className="text-sm text-[var(--muted)]">{titulo}</p>
            <p className="mt-1 text-2xl font-semibold">{loading ? "…" : cantidad}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
