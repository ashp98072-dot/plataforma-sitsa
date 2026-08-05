import Link from "next/link";

type Props = {
  slug: string;
  detalle?: string;
};

export function SinAccesoRrhh({ slug, detalle }: Props) {
  return (
    <div className="mx-auto max-w-lg space-y-3 rounded-xl border border-amber-800/50 bg-amber-950/20 p-6">
      <h1 className="text-lg font-semibold text-amber-100">
        Sin acceso a RRHH / Personal
      </h1>
      <p className="text-sm text-[var(--muted)]">
        {detalle ??
          "Tu usuario no tiene permisos de Control de Asistencias. Si necesitas consultar pilotos, úsalos desde TMS u Operaciones; el alta de personal es solo para RRHH."}
      </p>
      <div className="flex flex-wrap gap-2 pt-1">
        <Link
          href={`/e/${slug}/dashboard-operaciones`}
          className="rounded bg-[var(--accent)] px-3 py-1.5 text-sm text-white"
        >
          Ir a Operaciones
        </Link>
        <Link
          href={`/e/${slug}/tms`}
          className="rounded bg-[#334155] px-3 py-1.5 text-sm text-white"
        >
          Ir a TMS
        </Link>
      </div>
    </div>
  );
}
