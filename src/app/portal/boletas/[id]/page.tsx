import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import {
  obtenerPeriodo,
  listarLineas,
  listarDescuentosDetalle,
  listarPrestacionesDetalle,
} from "@/lib/rrhh/planillas";
import { listarCuotasAplicadasDetalle } from "@/lib/rrhh/descuentos";
import { listarHorasExtraAplicadasDetalle } from "@/lib/rrhh/horas-extra";

const ESTADOS_VISIBLES_COLABORADOR = ["Cerrada", "Pagada"];

function formatQ(valor: number): string {
  return `Q${valor.toLocaleString("es-GT", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function Renglon({
  label,
  valor,
  resta,
}: {
  label: string;
  valor: number;
  resta?: boolean;
}) {
  if (valor === 0) return null;
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-sm text-[var(--muted)]">{label}</span>
      <span className="text-sm font-medium">
        {resta ? "− " : ""}
        {formatQ(valor)}
      </span>
    </div>
  );
}

export default async function BoletaDetallePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const session = await getColaboradorSession();
  if (!session) {
    redirect("/portal/login");
  }

  const periodoId = Number((await params).id);
  const periodo = Number.isFinite(periodoId)
    ? await obtenerPeriodo(session!.empresaId, periodoId)
    : null;

  if (!periodo || !ESTADOS_VISIBLES_COLABORADOR.includes(periodo.estado)) {
    notFound();
  }

  const lineas = await listarLineas(session!.empresaId, periodoId);
  const linea = lineas.find((l) => l.empleadoId === session!.empleadoId);
  if (!linea) {
    notFound();
  }

  const [prestacionesLegadoDetalle, descuentosLegadoDetalle, cuotasD1Detalle, horasExtraDetalle] =
    await Promise.all([
      listarPrestacionesDetalle(
        session!.empresaId,
        session!.empleadoId,
        periodo!.fechaInicio,
        periodo!.fechaFin,
      ),
      listarDescuentosDetalle(
        session!.empresaId,
        session!.empleadoId,
        periodo!.fechaInicio,
        periodo!.fechaFin,
      ),
      // Fase D2: cuotas del motor nuevo (rrhh_descuento_cuotas) aplicadas
      // específicamente a ESTE periodo — fuente adicional, no reemplaza el
      // detalle legado de arriba.
      listarCuotasAplicadasDetalle(session!.empresaId, session!.empleadoId, periodoId),
      // Fase H2: horas extra (horas_extra_registros) aplicadas
      // específicamente a ESTE periodo — igual que las cuotas D1, fuente
      // adicional sin solape con las prestaciones legado (H1/H2 ya no
      // escriben en rrhh_prestaciones).
      listarHorasExtraAplicadasDetalle(session!.empresaId, session!.empleadoId, periodoId),
    ]);
  const prestacionesDetalle = [...prestacionesLegadoDetalle, ...horasExtraDetalle];
  const descuentosDetalle = [...descuentosLegadoDetalle, ...cuotasD1Detalle];

  const sumaPrestacionesDetalle = prestacionesDetalle.reduce((a, i) => a + i.monto, 0);
  const sumaDescuentosDetalle = descuentosDetalle.reduce((a, i) => a + i.monto, 0);
  const prestacionesCuadran =
    Math.abs(sumaPrestacionesDetalle - linea!.otrosIngresos) < 0.01;
  const descuentosCuadran = Math.abs(sumaDescuentosDetalle - linea!.descuentos) < 0.01;

  const ingresos =
    linea!.sueldoBase + linea!.bonoIncentivo + linea!.bonoHerramientas + linea!.otrosIngresos;

  return (
    <main className="min-h-screen p-4 sm:p-8">
      <div className="mx-auto max-w-2xl">
        <Link
          href="/portal/boletas"
          className="text-sm text-[var(--muted)] hover:underline"
        >
          ← Volver a mis boletas
        </Link>

        <header className="mt-4">
          <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">
            Boleta de pago
          </p>
          <h1 className="mt-1 text-2xl font-semibold">{periodo!.codigo}</h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {periodo!.fechaInicio} → {periodo!.fechaFin}
          </p>
        </header>

        <section className="mt-6 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            Ingresos
          </h2>
          <div className="mt-2 divide-y divide-[var(--border)]">
            <Renglon label="Sueldo base" valor={linea!.sueldoBase} />
            <Renglon label="Bonificación incentivo" valor={linea!.bonoIncentivo} />
            <Renglon label="Bono herramientas" valor={linea!.bonoHerramientas} />
            {prestacionesDetalle.length > 0
              ? prestacionesDetalle.map((item, i) => (
                  <Renglon
                    key={i}
                    label={`${item.concepto} (${item.fecha})`}
                    valor={item.monto}
                  />
                ))
              : (
                  <Renglon label="Otros ingresos / viáticos" valor={linea!.otrosIngresos} />
                )}
          </div>
          {prestacionesDetalle.length > 0 && !prestacionesCuadran ? (
            <p className="mt-2 text-xs text-amber-600">
              El detalle ({formatQ(sumaPrestacionesDetalle)}) no coincide exactamente
              con el total registrado ({formatQ(linea!.otrosIngresos)}). Consulta con RRHH.
            </p>
          ) : null}
          <div className="mt-2 flex items-center justify-between border-t border-[var(--border)] pt-2">
            <span className="text-sm font-medium">Total ingresos</span>
            <span className="text-sm font-semibold">{formatQ(ingresos)}</span>
          </div>
        </section>

        <section className="mt-4 rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted)]">
            Descuentos
          </h2>
          <div className="mt-2 divide-y divide-[var(--border)]">
            <Renglon label="IGSS laboral" valor={linea!.igssLaboral} resta />
            <Renglon label="ISR" valor={linea!.isr} resta />
            {descuentosDetalle.length > 0
              ? descuentosDetalle.map((item, i) => (
                  <Renglon
                    key={i}
                    label={`${item.concepto} (${item.fecha})`}
                    valor={item.monto}
                    resta
                  />
                ))
              : (
                  <Renglon label="Otros descuentos" valor={linea!.descuentos} resta />
                )}
          </div>
          {descuentosDetalle.length > 0 && !descuentosCuadran ? (
            <p className="mt-2 text-xs text-amber-600">
              El detalle ({formatQ(sumaDescuentosDetalle)}) no coincide exactamente
              con el total registrado ({formatQ(linea!.descuentos)}). Consulta con RRHH.
            </p>
          ) : null}
          {linea!.igssLaboral === 0 && linea!.isr === 0 && linea!.descuentos === 0 ? (
            <p className="mt-2 text-sm text-[var(--muted)]">Sin descuentos este periodo.</p>
          ) : null}
        </section>

        <section className="mt-4 rounded-2xl border border-[var(--accent)] bg-[var(--card)] p-6">
          <div className="flex items-center justify-between">
            <span className="text-base font-semibold">Neto depositado</span>
            <span className="text-2xl font-bold">{formatQ(linea!.neto)}</span>
          </div>
          <p className="mt-2 text-xs text-[var(--muted)]">
            Forma de pago: {linea!.formaPago} · Estado: {linea!.estadoPago}
            {linea!.refPago ? ` · Ref: ${linea!.refPago}` : ""}
          </p>
        </section>

        <p className="mt-6 text-xs text-[var(--muted)]">
          ¿Algún monto no cuadra con lo esperado? Repórtalo con Recursos
          Humanos o Contabilidad — esta pantalla es solo de consulta.
        </p>
      </div>
    </main>
  );
}