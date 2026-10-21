"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { useEmpresaSession } from "@/lib/empresa-session";
import { tienePermiso } from "@/lib/permisos-shared";
import { esFilaFalta } from "@/lib/rrhh/justificaciones-faltas-shared";
import { JustificarFaltaModal } from "@/components/rrhh/justificar-falta-modal";

type Fila = {
  fecha: string;
  fechaUi: string;
  codigo: string;
  nombre: string;
  horaEntrada: string | null;
  horaSalida: string | null;
  estadoEntrada: string;
  estadoSalida: string;
  motivo: string;
  tipoHorario: string;
  fotoEntradaId: number | null;
  fotoSalidaId: number | null;
  idEmpleado?: number;
  justificacion?: { id: number; tipo: string } | null;
};

const PERIODOS = [
  "Hoy",
  "Ayer",
  "Últimos 7 días",
  "Últimos 30 días",
  "Mes actual",
  "Mes anterior",
  "Quincena 1 (día 1 al 15)",
  "Quincena 2 (día 16 al fin de mes)",
  "Rango personalizado",
];

export default function ReportesPage() {
  const slug = String(useParams().slug);
  const [periodo, setPeriodo] = useState("Hoy");
  const [desde, setDesde] = useState(new Date().toISOString().slice(0, 10));
  const [hasta, setHasta] = useState(new Date().toISOString().slice(0, 10));
  const [tipo, setTipo] = useState("Todos");
  const [horario, setHorario] = useState("Todos");
  const [filas, setFilas] = useState<Fila[]>([]);
  const [rango, setRango] = useState({ desde: "", hasta: "" });
  const [loading, setLoading] = useState(false);
  // Justificación de faltas: doble clic sobre una fila «Falta» (o el botón «Justificar»). Los permisos solo habilitan controles;
  // el servidor los vuelve a exigir.
  const { rol, permisos } = useEmpresaSession();
  const puedeCrearJustificacion = rol === "Admin" || tienePermiso(permisos, "incidencias", "crear");
  const puedeEditarJustificacion = rol === "Admin" || tienePermiso(permisos, "incidencias", "editar");
  const [justificando, setJustificando] = useState<Fila | null>(null);
  const abreJustificacion = (f: Fila) => esFilaFalta(f) && f.idEmpleado != null;

  const cargar = useCallback(async () => {
    setLoading(true);
    const qs = new URLSearchParams({
      periodo,
      desde,
      hasta,
      tipo,
      horario,
      modo: "asistencias",
    });
    const res = await fetch(`/api/empresas/${slug}/rrhh/reportes?${qs}`);
    const data = await res.json();
    setFilas(data.filas ?? []);
    setRango({ desde: data.desde ?? "", hasta: data.hasta ?? "" });
    setLoading(false);
  }, [slug, periodo, desde, hasta, tipo, horario]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  function descargar(formato: "xlsx" | "pdf") {
    const qs = new URLSearchParams({
      periodo,
      desde,
      hasta,
      tipo,
      horario,
      formato,
    });
    window.open(`/api/empresas/${slug}/rrhh/reportes?${qs}`, "_blank");
  }

  const input =
    "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Reportes de asistencia</h1>
        <p className="text-sm text-[var(--muted)]">
          Calendario laboral como en Control de Asistencias: faltas, en ruta,
          vacaciones, retrasos.{" "}
          <Link
            href={`/e/${slug}/rrhh/incidencias`}
            className="text-[var(--accent)] underline"
          >
            Resumen incidencias
          </Link>
          {" · "}
          <Link
            href={`/e/${slug}/rrhh/reportes/cumpleanios`}
            className="text-[var(--accent)] underline"
          >
            Cumpleaños por mes
          </Link>
        </p>
      </div>

      <div className="flex flex-wrap gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <select
          className={input}
          value={periodo}
          onChange={(e) => setPeriodo(e.target.value)}
        >
          {PERIODOS.map((p) => (
            <option key={p}>{p}</option>
          ))}
        </select>
        {periodo === "Rango personalizado" ? (
          <>
            <input
              type="date"
              className={input}
              value={desde}
              onChange={(e) => setDesde(e.target.value)}
            />
            <input
              type="date"
              className={input}
              value={hasta}
              onChange={(e) => setHasta(e.target.value)}
            />
          </>
        ) : null}
        <select
          className={input}
          value={tipo}
          onChange={(e) => setTipo(e.target.value)}
        >
          {[
            "Todos",
            "Falta",
            "Falta justificada",
            "Retraso",
            "En Ruta",
            "Vacaciones",
            "A tiempo",
          ].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select
          className={input}
          value={horario}
          onChange={(e) => setHorario(e.target.value)}
        >
          <option>Todos</option>
          <option>Fijo</option>
          <option>Variable</option>
        </select>
        <button
          type="button"
          className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white"
          onClick={() => void cargar()}
        >
          Actualizar
        </button>
        <button
          type="button"
          className="rounded bg-[#0d9488] px-3 py-1 text-sm text-white"
          onClick={() => descargar("xlsx")}
        >
          Excel
        </button>
        <button
          type="button"
          className="rounded bg-[#1e293b] px-3 py-1 text-sm"
          onClick={() => descargar("pdf")}
        >
          PDF
        </button>
      </div>

      <p className="text-xs text-[var(--muted)]">
        Periodo: {rango.desde} → {rango.hasta} · {filas.length} filas
        {loading ? " · cargando…" : ""}
      </p>

      <div className="max-h-[70vh] overflow-auto rounded-xl border border-[var(--border)]">
        <table className="w-full text-left text-xs">
          <thead className="sticky top-0 bg-[var(--thead)] text-[var(--muted)]">
            <tr>
              <th className="px-2 py-2">Fecha</th>
              <th className="px-2 py-2">Código</th>
              <th className="px-2 py-2">Empleado</th>
              <th className="px-2 py-2">Entrada</th>
              <th className="px-2 py-2">Salida</th>
              <th className="px-2 py-2">Est. ent.</th>
              <th className="px-2 py-2">Est. sal.</th>
              <th className="px-2 py-2">Motivo</th>
              <th className="px-2 py-2">Fotografías</th>
              <th className="px-2 py-2">Acción</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((f, i) => (
              <tr
                key={`${f.codigo}-${f.fecha}-${i}`}
                className={`border-t border-[var(--border)] ${abreJustificacion(f) ? "cursor-pointer hover:bg-[var(--accent)]/10" : ""}`}
                onDoubleClick={abreJustificacion(f) ? () => setJustificando(f) : undefined}
                title={abreJustificacion(f) ? (f.justificacion ? "Doble clic para ver la justificación" : "Doble clic para justificar") : undefined}
              >
                <td className="px-2 py-1.5">{f.fechaUi || f.fecha}</td>
                <td className="px-2 py-1.5">{f.codigo}</td>
                <td className="px-2 py-1.5">{f.nombre}</td>
                <td className="px-2 py-1.5">{f.horaEntrada ?? "—"}</td>
                <td className="px-2 py-1.5">{f.horaSalida ?? "—"}</td>
                <td className="px-2 py-1.5">{f.estadoEntrada}</td>
                <td className="px-2 py-1.5">{f.estadoSalida}</td>
                <td className="px-2 py-1.5">{f.motivo}</td>
                <td className="px-2 py-1.5">
                  <div className="flex gap-2">
                    {f.fotoEntradaId ? (
                      <a
                        href={`/api/empresas/${slug}/rrhh/marcajes/evidencias/${f.fotoEntradaId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sky-300 hover:underline"
                      >
                        Entrada
                      </a>
                    ) : null}
                    {f.fotoSalidaId ? (
                      <a
                        href={`/api/empresas/${slug}/rrhh/marcajes/evidencias/${f.fotoSalidaId}`}
                        target="_blank"
                        rel="noreferrer"
                        className="text-sky-300 hover:underline"
                      >
                        Salida
                      </a>
                    ) : null}
                    {!f.fotoEntradaId && !f.fotoSalidaId ? "—" : null}
                  </div>
                </td>
                <td className="px-2 py-1.5">
                  {abreJustificacion(f) ? (
                    <button
                      type="button"
                      onClick={() => setJustificando(f)}
                      className="rounded border border-[var(--border)] px-2 py-0.5 text-[11px] hover:border-[var(--accent)]"
                      aria-label={`${f.justificacion ? "Ver justificación" : "Justificar"} de ${f.nombre} del ${f.fechaUi || f.fecha}`}
                    >
                      {f.justificacion ? "Ver justificación" : "Justificar"}
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {justificando && justificando.idEmpleado != null ? (
        <JustificarFaltaModal
          slug={slug}
          empleadoId={justificando.idEmpleado}
          codigo={justificando.codigo}
          nombre={justificando.nombre}
          fecha={justificando.fecha}
          fechaUi={justificando.fechaUi || justificando.fecha}
          estadoActual={justificando.estadoEntrada}
          puedeCrear={puedeCrearJustificacion}
          puedeEditar={puedeEditarJustificacion}
          onClose={() => setJustificando(null)}
          onCambio={() => void cargar()}
        />
      ) : null}
    </div>
  );
}
