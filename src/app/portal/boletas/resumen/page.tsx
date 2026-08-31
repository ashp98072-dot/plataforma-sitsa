import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import { hoyLocal } from "@/lib/rrhh/dates";
import { rangoMes, resumenMensualPropio } from "@/lib/rrhh/resumen-mensual";

const q = (n: number) => n.toLocaleString("es-GT", { style: "currency", currency: "GTQ" });
const estados: Record<string, string> = { PROGRAMADO: "Programado (pendiente)", AUTORIZADO: "Autorizado (pendiente de entrega)", ENTREGADO: "Entregado", LIQUIDADO: "Liquidado" };
export default async function ResumenPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const session = await getColaboradorSession();
  if (!session) redirect("/portal/login");
  const mes = (await searchParams).mes ?? hoyLocal().slice(0, 7);
  try { rangoMes(mes); } catch { notFound(); }
  const { nomina, viaticos, viaticosRechazados } = await resumenMensualPropio(session.empresaId, session.empleadoId, mes);
  const sum = (key: "neto", pagado: boolean) => nomina.filter((n) => (n.estado === "Pagado") === pagado).reduce((total, n) => total + Math.round(n[key] * 100), 0) / 100;
  const conceptos = [
    ["Salario del período", "salario"], ["Bono incentivo", "incentivo"], ["Bono herramientas", "herramientas"],
    ["Otros ingresos incluidos", "adicionales"], ["Descuentos", "descuentos"], ["IGSS laboral", "igss"], ["ISR", "isr"],
  ] as const;
  return <main className="mx-auto max-w-3xl space-y-5 p-6">
    <Link href="/portal/boletas" className="underline">← Boletas por período</Link>
    <h1 className="text-2xl font-semibold">Resumen mensual de pagos</h1>
    <form className="flex gap-3"><label>Mes <input type="month" name="mes" defaultValue={mes} required className="rounded border bg-[var(--input)] p-2" /></label><button className="rounded bg-[var(--accent)] px-4">Consultar</button></form>
    <p className="text-sm">Planillas cerradas o pagadas cuyo período inicia en este mes. Los descuentos ya están aplicados al neto; no se restan otra vez. No sustituye las boletas.</p>
    <p>Neto con pago registrado: {q(sum("neto", true))} · Neto pendiente de pago: {q(sum("neto", false))}</p>
    <details className="rounded-xl border border-[var(--border)] p-4"><summary>Totales del mes por concepto (ya incluidos en las boletas)</summary>
      <dl className="mt-3 space-y-2">{conceptos.map(([label, key]) => <div key={key} className="flex justify-between"><dt>{label}</dt><dd>{q(nomina.reduce((total, n) => total + Math.round(n[key] * 100), 0) / 100)}</dd></div>)}</dl>
    </details>
    {!nomina.length ? <p>No hay boletas cerradas en este mes.</p> : nomina.map((n) => <section key={n.periodoId} className="space-y-2 rounded-xl border border-[var(--border)] p-4">
      <Link className="font-semibold underline" href={`/portal/boletas/${n.periodoId}`}>{n.codigo} — Ver boleta y motivos</Link>
      <p>Salario: {q(n.salario)} · Bono incentivo: {q(n.incentivo)} · Bono herramientas: {q(n.herramientas)}</p>
      <p>Otros ingresos incluidos: {q(n.adicionales)}</p>
      <p>Descuentos aplicados: {q(n.descuentos)} · IGSS laboral: {q(n.igss)} · ISR: {q(n.isr)}</p>
      <p className="font-semibold">Neto: {q(n.neto)} — {n.estado}</p>
    </section>)}
    <section className="space-y-2 rounded-xl border border-[var(--border)] p-4">
      <h2 className="font-semibold">Viáticos operativos — separados de nómina</h2>
      <p className="text-sm">Agrupados por fecha del viaje y estado actual, no por fecha de desembolso. No se suman al neto ni se clasifican como salario.</p>
      {viaticos === null ? <p>No disponible: no se pudo consultar el historial de viáticos.</p> : viaticos.length ? viaticos.map((v) => <p key={v.estado}>{estados[v.estado] ?? v.estado}: {q(v.monto)}</p>) : <p>Sin viáticos registrados para viajes de este mes.</p>}
      {/* VIATICOS-RECHAZADO-1 (sección 16, CRÍTICO) — contador informativo,
          NUNCA un monto: un rechazo no es dinero recibido/entregado/pagado. */}
      {viaticosRechazados ? <p>Rechazados: {viaticosRechazados}</p> : null}
      <Link href="/portal/viaticos" className="underline">Ver historial de viáticos</Link>
    </section>
    <p className="text-xs">No se asignan automáticamente categorías fiscales a bonos, festivos o pagos adicionales. Los importes conservan la clasificación registrada por RRHH.</p>
  </main>;
}
