"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { EvidenciasModal } from "@/components/rrhh/evidencias-modal";

type Emp = { id: number; codigo: string; nombre: string };
type Detalle = {
  fecha: string;
  fechaUi: string;
  tipo: string;
  incidenciaId: number | null;
};
type Resumen = {
  idEmpleado?: number;
  codigo: string;
  empleado: string;
  totalRetrasos: number;
  totalSalidasTempranas: number;
  totalFaltas: number;
  totalDiasAsistidos: number;
  detalle?: Detalle[];
};

const TIPOS = [
  "Vacaciones",
  "Permiso con goce",
  "Permiso sin goce",
  "IGSS",
  "Médico",
  "Fallecimiento de Familiar",
  "Nacimiento de Hijo",
  "Enfermedad",
  "Sin Goce de Salario",
  "Matrimonio",
  "Citaciones Judiciales",
  "A cuenta de Vacaciones",
  "Cumpleaños",
  "Falta",
  "Suspensión",
  "Otro",
];

export default function IncidenciasPage() {
  const slug = String(useParams().slug);
  const [tab, setTab] = useState<"resumen" | "registro">("resumen");
  const [empleados, setEmpleados] = useState<Emp[]>([]);
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [resumen, setResumen] = useState<Resumen[]>([]);
  const [seleccion, setSeleccion] = useState<Resumen | null>(null);
  const [ampliado, setAmpliado] = useState(false);
  const [empleadoId, setEmpleadoId] = useState(0);
  const [tipo, setTipo] = useState("Permiso con goce");
  const [fechaInicio, setFechaInicio] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [fechaFin, setFechaFin] = useState(
    new Date().toISOString().slice(0, 10),
  );
  const [periodo, setPeriodo] = useState("Mes actual");
  const [msg, setMsg] = useState("");
  const [evModal, setEvModal] = useState<{
    id: number;
    titulo: string;
  } | null>(null);
  const [adjuntando, setAdjuntando] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    const e = await fetch(`/api/empresas/${slug}/empleados`).then((r) =>
      r.json(),
    );
    setEmpleados(e.empleados ?? []);
    if (!empleadoId && e.empleados?.[0]) setEmpleadoId(e.empleados[0].id);

    if (tab === "registro") {
      const i = await fetch(`/api/empresas/${slug}/rrhh/incidencias`).then(
        (r) => r.json(),
      );
      setRows(i.incidencias ?? []);
    } else {
      const qs = new URLSearchParams({
        modo: "incidencias",
        periodo,
      });
      const r = await fetch(`/api/empresas/${slug}/rrhh/reportes?${qs}`).then(
        (x) => x.json(),
      );
      setResumen(r.resumen ?? []);
      setSeleccion(null);
      setAmpliado(false);
    }
  }, [slug, tab, periodo, empleadoId]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/empresas/${slug}/rrhh/incidencias`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        empleadoId,
        tipo,
        fechaInicio,
        fechaFin,
        diasHabiles: 1,
      }),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error);
    if (res.ok) await cargar();
  }

  async function adjuntarFoto(d: Detalle) {
    if (!seleccion) return;
    const empId =
      seleccion.idEmpleado ||
      empleados.find((x) => x.codigo === seleccion.codigo)?.id;
    if (!empId) {
      setMsg("No se encontró el empleado para adjuntar.");
      return;
    }
    setAdjuntando(`${d.fecha}-${d.tipo}`);
    try {
      let incidenciaId = d.incidenciaId;
      if (!incidenciaId) {
        const res = await fetch(
          `/api/empresas/${slug}/rrhh/incidencias/anexo`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              empleadoId: empId,
              fecha: d.fecha,
              tipo: d.tipo.split(" + ")[0] || "Falta",
            }),
          },
        );
        const data = await res.json();
        if (!res.ok) {
          setMsg(data.error ?? "No se pudo preparar el adjunto");
          return;
        }
        incidenciaId = data.incidenciaId;
      }
      setEvModal({
        id: Number(incidenciaId),
        titulo: `${seleccion.empleado} · ${d.fechaUi} · ${d.tipo}`,
      });
    } finally {
      setAdjuntando(null);
    }
  }

  const input =
    "rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1 text-sm";

  function DetalleLista({ compact }: { compact?: boolean }) {
    if (!seleccion) {
      return (
        <p className="mt-2 text-sm text-[var(--muted)]">
          Haz clic o doble clic en una fila para ver el detalle.
        </p>
      );
    }
    return (
      <>
        <p className="mt-1 text-sm text-[var(--muted)]">{seleccion.empleado}</p>
        <p className="text-xs text-[var(--muted)]">Periodo: {periodo}</p>
        <ul
          className={`mt-3 space-y-1 overflow-y-auto text-sm ${compact ? "max-h-80" : "max-h-[60vh]"}`}
        >
          {(seleccion.detalle ?? []).length === 0 ? (
            <li className="text-[var(--muted)]">Sin detalle.</li>
          ) : (
            (seleccion.detalle ?? []).map((d) => (
              <li
                key={`${d.fecha}-${d.tipo}`}
                className="flex items-center justify-between gap-2 border-b border-[var(--border)] py-2"
              >
                <div className="min-w-0">
                  <span className="mr-2">{d.fechaUi || d.fecha}</span>
                  <span
                    className={
                      /falta/i.test(d.tipo) ? "font-medium text-red-300" : ""
                    }
                  >
                    {d.tipo}
                  </span>
                </div>
                <button
                  type="button"
                  disabled={adjuntando === `${d.fecha}-${d.tipo}`}
                  className="shrink-0 rounded bg-[#1F6AA5] px-2 py-1 text-xs text-white disabled:opacity-50"
                  onClick={() => void adjuntarFoto(d)}
                  title="Adjuntar foto / PDF"
                >
                  📎 Foto
                </button>
              </li>
            ))
          )}
        </ul>
      </>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Resumen de Incidencias</h1>
        <p className="text-sm text-[var(--muted)]">
          Retrasos y salidas tempranas con hora; faltas día a día. Usa{" "}
          <strong>Ampliar</strong> para ver el detalle completo y{" "}
          <strong>📎 Foto</strong> para adjuntar pruebas.{" "}
          <Link
            href={`/e/${slug}/rrhh/reportes`}
            className="text-[var(--accent)] underline"
          >
            Reportes
          </Link>
        </p>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          className={`rounded px-3 py-1 text-sm ${tab === "resumen" ? "bg-[var(--accent)] text-white" : "bg-[#334155]"}`}
          onClick={() => setTab("resumen")}
        >
          Resumen operativo
        </button>
        <button
          type="button"
          className={`rounded px-3 py-1 text-sm ${tab === "registro" ? "bg-[var(--accent)] text-white" : "bg-[#334155]"}`}
          onClick={() => setTab("registro")}
        >
          Registrar permiso
        </button>
      </div>

      {tab === "resumen" ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_minmax(280px,360px)]">
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <select
                className={input}
                value={periodo}
                onChange={(e) => setPeriodo(e.target.value)}
              >
                {[
                  "Hoy",
                  "Últimos 7 días",
                  "Mes actual",
                  "Quincena 1 (día 1 al 15)",
                  "Quincena 2 (día 16 al fin de mes)",
                ].map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
              <button
                type="button"
                className="rounded bg-[#0d9488] px-3 py-1 text-sm text-white"
                onClick={() =>
                  window.open(
                    `/api/empresas/${slug}/rrhh/reportes?modo=incidencias&periodo=${encodeURIComponent(periodo)}&formato=xlsx`,
                    "_blank",
                  )
                }
              >
                Excel
              </button>
              <button
                type="button"
                className="rounded bg-[#1e293b] px-3 py-1 text-sm"
                onClick={() =>
                  window.open(
                    `/api/empresas/${slug}/rrhh/reportes?modo=incidencias&periodo=${encodeURIComponent(periodo)}&formato=pdf`,
                    "_blank",
                  )
                }
              >
                PDF
              </button>
            </div>
            <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
              <table className="w-full text-left text-sm">
                <thead className="bg-[#0d1522] text-[var(--muted)]">
                  <tr>
                    <th className="px-3 py-2">Código</th>
                    <th className="px-3 py-2">Empleado</th>
                    <th className="px-3 py-2">Retrasos</th>
                    <th className="px-3 py-2">Sal. tempranas</th>
                    <th className="px-3 py-2">Faltas</th>
                    <th className="px-3 py-2">Días asistidos</th>
                  </tr>
                </thead>
                <tbody>
                  {resumen.map((r) => (
                    <tr
                      key={r.codigo}
                      className={`cursor-pointer border-t border-[var(--border)] hover:bg-white/5 ${seleccion?.codigo === r.codigo ? "bg-[var(--accent)]/20" : ""}`}
                      onDoubleClick={() => {
                        setSeleccion(r);
                        setAmpliado(true);
                      }}
                      onClick={() => setSeleccion(r)}
                      title="Clic: detalle · Doble clic: ampliar"
                    >
                      <td className="px-3 py-2">{r.codigo}</td>
                      <td className="px-3 py-2">{r.empleado}</td>
                      <td className="px-3 py-2">{r.totalRetrasos}</td>
                      <td className="px-3 py-2">{r.totalSalidasTempranas}</td>
                      <td className="px-3 py-2">{r.totalFaltas}</td>
                      <td className="px-3 py-2">{r.totalDiasAsistidos}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <div className="flex items-start justify-between gap-2">
              <h2 className="font-semibold">Detalle de incidencias</h2>
              {seleccion ? (
                <button
                  type="button"
                  className="rounded bg-[var(--accent)] px-2 py-1 text-xs text-white"
                  onClick={() => setAmpliado(true)}
                >
                  Ampliar
                </button>
              ) : null}
            </div>
            <DetalleLista compact />
          </aside>
        </div>
      ) : (
        <>
          <form
            onSubmit={onSubmit}
            className="flex flex-wrap gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
          >
            <select
              className={input}
              value={empleadoId}
              onChange={(e) => setEmpleadoId(Number(e.target.value))}
            >
              {empleados.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.codigo} — {e.nombre}
                </option>
              ))}
            </select>
            <select
              className={input}
              value={tipo}
              onChange={(e) => setTipo(e.target.value)}
            >
              {TIPOS.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
            <input
              type="date"
              className={input}
              value={fechaInicio}
              onChange={(e) => setFechaInicio(e.target.value)}
            />
            <input
              type="date"
              className={input}
              value={fechaFin}
              onChange={(e) => setFechaFin(e.target.value)}
            />
            <button className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white">
              Guardar
            </button>
          </form>
          {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}
          <ul className="space-y-1 text-sm">
            {rows.map((r) => (
              <li
                key={String(r.id)}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--border)] px-3 py-2"
              >
                <span>
                  {String(r.emp_codigo)} — {String(r.tipo)} ·{" "}
                  {String(r.fecha_inicio).slice(0, 10)} →{" "}
                  {String(r.fecha_fin).slice(0, 10)}
                </span>
                <button
                  type="button"
                  className="rounded bg-[#1F6AA5] px-2 py-1 text-xs text-white"
                  onClick={() =>
                    setEvModal({
                      id: Number(r.id),
                      titulo: `${String(r.emp_codigo)} — ${String(r.tipo)}`,
                    })
                  }
                >
                  📎 Evidencias
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {msg && tab === "resumen" ? (
        <p className="text-sm text-amber-200">{msg}</p>
      ) : null}

      {ampliado && seleccion ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-3 md:p-6">
          <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] p-4">
              <div>
                <h2 className="text-lg font-semibold">
                  Detalle de incidencias — {seleccion.empleado}
                </h2>
                <p className="text-sm text-[var(--muted)]">
                  Periodo: {periodo} · Usa 📎 Foto en cada día para adjuntar
                  imágenes o PDF
                </p>
              </div>
              <button
                type="button"
                className="rounded bg-[#37474F] px-3 py-1 text-sm text-white"
                onClick={() => setAmpliado(false)}
              >
                Cerrar
              </button>
            </div>
            <div className="overflow-y-auto p-4">
              <DetalleLista />
            </div>
          </div>
        </div>
      ) : null}

      {evModal ? (
        <EvidenciasModal
          slug={slug}
          incidenciaId={evModal.id}
          titulo={evModal.titulo}
          onClose={() => setEvModal(null)}
          onChanged={() => void cargar()}
        />
      ) : null}
    </div>
  );
}
