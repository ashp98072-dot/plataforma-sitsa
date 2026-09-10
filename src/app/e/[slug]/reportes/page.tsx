import Link from "next/link";

type Props = { params: Promise<{ slug: string }> };

const REPORTES = [
  { ruta: "diario", nombre: "Reporte diario de viajes", descripcion: "Viajes por fecha con unidad, personal, ruta, estado y tarifa comercial histórica." },
  { ruta: "viajes", nombre: "Reporte de viajes / historial", descripcion: "Histórico de viajes con filtros completos, indicadores, facturación agregada y exportación Excel / PDF." },
  { ruta: "viaticos", nombre: "Reporte de viáticos", descripcion: "Detalle de viáticos con filtros propios y exportación." },
  { ruta: "gastos", nombre: "Reporte de gastos operativos", descripcion: "Detalle de gastos operativos con sus filtros y totales." },
  { ruta: "fondos", nombre: "Reporte de solicitudes de fondo", descripcion: "Solicitudes y líneas de fondo por fechas, empleado, cliente y estado." },
];

export default async function ReportesPage({ params }: Props) {
  const { slug } = await params;
  return (
    <div className="space-y-5">
      <header>
        <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">Operaciones</p>
        <h1 className="mt-1 text-2xl font-semibold">Reportes</h1>
        <p className="text-sm text-[var(--muted)]">Selecciona el reporte que deseas consultar. Cada reporte conserva su propia vista, filtros y exportaciones.</p>
      </header>
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {REPORTES.map((reporte) => (
          <article key={reporte.ruta} className="flex min-h-40 flex-col rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h2 className="font-semibold">{reporte.nombre}</h2>
            <p className="mt-2 flex-1 text-sm text-[var(--muted)]">{reporte.descripcion}</p>
            <Link href={`/e/${slug}/reportes/${reporte.ruta}`} className="mt-4 w-fit rounded bg-[var(--accent)] px-3 py-2 text-sm font-medium text-white">Ver reporte</Link>
          </article>
        ))}
      </section>
    </div>
  );
}
