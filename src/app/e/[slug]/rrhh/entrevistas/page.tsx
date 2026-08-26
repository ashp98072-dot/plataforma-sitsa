"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { EmpleadoPicker, type EmpOpt } from "@/components/rrhh/empleado-picker";
import { EntrevistaDocumentos } from "@/components/rrhh/entrevista-documentos";

type Entrevista = {
  id: number;
  candidatoNombre: string;
  candidatoTelefono: string | null;
  candidatoEmail: string | null;
  puesto: string;
  fechaHora: string;
  entrevistadorEmpleadoId: number | null;
  entrevistadorNombre?: string;
  modalidad: "Presencial" | "Virtual";
  lugarOEnlace: string | null;
  estado: "Programada" | "Realizada" | "Cancelada" | "No asistió";
  resultado: "Pendiente" | "Aprobado" | "Rechazado";
  notas: string | null;
};

const MESES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre",
];

const ESTADO_COLOR: Record<Entrevista["estado"], string> = {
  Programada: "bg-blue-500/20 text-blue-300 border-blue-500/40",
  Realizada: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  Cancelada: "bg-red-500/20 text-red-300 border-red-500/40",
  "No asistió": "bg-amber-500/20 text-amber-300 border-amber-500/40",
};

function vacio() {
  return {
    id: 0,
    candidatoNombre: "",
    candidatoTelefono: "",
    candidatoEmail: "",
    puesto: "",
    fecha: new Date().toISOString().slice(0, 10),
    hora: "09:00",
    entrevistadorEmpleadoId: 0,
    modalidad: "Presencial" as "Presencial" | "Virtual",
    lugarOEnlace: "",
    notas: "",
  };
}

export default function EntrevistasPage() {
  const slug = String(useParams().slug);
  const hoy = new Date();
  const [anio, setAnio] = useState(hoy.getFullYear());
  const [mes, setMes] = useState(hoy.getMonth() + 1); // 1-12
  const [entrevistas, setEntrevistas] = useState<Entrevista[]>([]);
  const [empleados, setEmpleados] = useState<EmpOpt[]>([]);
  const [diaSel, setDiaSel] = useState<string | null>(null);
  const [form, setForm] = useState(vacio());
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    const res = await fetch(
      `/api/empresas/${slug}/rrhh/entrevistas?anio=${anio}&mes=${mes}`,
    );
    const data = await res.json();
    setEntrevistas(data.entrevistas ?? []);
    setCargando(false);
  }, [slug, anio, mes]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- carga remota al cambiar el mes
    void cargar();
  }, [cargar]);

  useEffect(() => {
    void (async () => {
      const res = await fetch(
        `/api/empresas/${slug}/empleados?estado=Activo`,
      );
      const data = await res.json();
      setEmpleados(data.empleados ?? []);
    })();
  }, [slug]);

  // Agrupa entrevistas por día (YYYY-MM-DD) para pintar el calendario.
  const porDia = useMemo(() => {
    const map = new Map<string, Entrevista[]>();
    for (const ent of entrevistas) {
      const dia = ent.fechaHora.slice(0, 10);
      const lista = map.get(dia) ?? [];
      lista.push(ent);
      map.set(dia, lista);
    }
    return map;
  }, [entrevistas]);

  const diasDelMes = useMemo(() => {
    const total = new Date(anio, mes, 0).getDate();
    const primerDiaSemana = new Date(anio, mes - 1, 1).getDay(); // 0=Dom
    const celdas: (string | null)[] = Array(primerDiaSemana).fill(null);
    for (let d = 1; d <= total; d++) {
      celdas.push(`${anio}-${String(mes).padStart(2, "0")}-${String(d).padStart(2, "0")}`);
    }
    return celdas;
  }, [anio, mes]);

  function cambiarMes(delta: number) {
    let m = mes + delta;
    let a = anio;
    if (m < 1) { m = 12; a -= 1; }
    if (m > 12) { m = 1; a += 1; }
    setMes(m);
    setAnio(a);
  }

  function abrirNueva(diaIso?: string) {
    setEditandoId(null);
    setForm({ ...vacio(), fecha: diaIso ?? vacio().fecha });
    setDiaSel(diaIso ?? null);
  }

  function seleccionarDia(diaIso: string) {
    setDiaSel(diaIso);
    setEditandoId(null);
    setForm((actual) => ({ ...actual, id: 0, fecha: diaIso }));
  }

  function abrirEditar(ent: Entrevista) {
    setEditandoId(ent.id);
    setForm({
      id: ent.id,
      candidatoNombre: ent.candidatoNombre,
      candidatoTelefono: ent.candidatoTelefono ?? "",
      candidatoEmail: ent.candidatoEmail ?? "",
      puesto: ent.puesto,
      fecha: ent.fechaHora.slice(0, 10),
      hora: ent.fechaHora.slice(11, 16),
      entrevistadorEmpleadoId: ent.entrevistadorEmpleadoId ?? 0,
      modalidad: ent.modalidad,
      lugarOEnlace: ent.lugarOEnlace ?? "",
      notas: ent.notas ?? "",
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMsg("");
    const body = {
      candidatoNombre: form.candidatoNombre,
      candidatoTelefono: form.candidatoTelefono || null,
      candidatoEmail: form.candidatoEmail || null,
      puesto: form.puesto,
      fechaHora: `${form.fecha}T${form.hora}`,
      entrevistadorEmpleadoId: form.entrevistadorEmpleadoId || null,
      modalidad: form.modalidad,
      lugarOEnlace: form.lugarOEnlace || null,
      notas: form.notas || null,
    };

    const res = editandoId
      ? await fetch(`/api/empresas/${slug}/rrhh/entrevistas/${editandoId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        })
      : await fetch(`/api/empresas/${slug}/rrhh/entrevistas`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

    const data = await res.json();
    setMsg(data.mensaje || data.error || "");
    if (res.ok) {
      setForm({ ...vacio(), fecha: diaSel ?? form.fecha });
      setEditandoId(null);
      await cargar();
    }
  }

  async function cambiarEstado(id: number, estado: Entrevista["estado"]) {
    await fetch(`/api/empresas/${slug}/rrhh/entrevistas/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ estado }),
    });
    await cargar();
  }

  async function cambiarResultado(id: number, resultado: Entrevista["resultado"]) {
    await fetch(`/api/empresas/${slug}/rrhh/entrevistas/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resultado }),
    });
    await cargar();
  }

  async function eliminar(id: number) {
    await fetch(`/api/empresas/${slug}/rrhh/entrevistas/${id}`, {
      method: "DELETE",
    });
    if (editandoId === id) {
      setForm(vacio());
      setEditandoId(null);
    }
    await cargar();
  }

  const input =
    "rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm";
  const entrevistasDelDia = diaSel ? porDia.get(diaSel) ?? [] : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Entrevistas</h1>
        <p className="text-sm text-[var(--muted)]">
          Calendario de entrevistas de candidatos. Clic en un día para ver o
          programar.
        </p>
      </div>

      <div className="flex items-center justify-between rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
        <button
          type="button"
          className="rounded border border-[var(--border)] px-3 py-1 text-sm"
          onClick={() => cambiarMes(-1)}
        >
          ← Anterior
        </button>
        <span className="text-lg font-medium">
          {MESES[mes - 1]} {anio}
        </span>
        <button
          type="button"
          className="rounded border border-[var(--border)] px-3 py-1 text-sm"
          onClick={() => cambiarMes(1)}
        >
          Siguiente →
        </button>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center text-xs text-[var(--muted)]">
        {["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"].map((d) => (
          <div key={d} className="py-1">{d}</div>
        ))}
        {diasDelMes.map((diaIso, i) => {
          if (!diaIso) return <div key={`vacio-${i}`} />;
          const lista = porDia.get(diaIso) ?? [];
          const esHoy = diaIso === hoy.toISOString().slice(0, 10);
          return (
            <button
              key={diaIso}
              type="button"
              onClick={() => seleccionarDia(diaIso)}
              className={`min-h-[4.5rem] rounded border p-1 text-left text-xs transition ${
                diaSel === diaIso
                  ? "border-[var(--accent)] bg-[var(--accent)]/10"
                  : "border-[var(--border)] bg-[var(--card)] hover:border-[var(--accent)]/50"
              }`}
            >
              <span className={esHoy ? "font-bold text-[var(--accent)]" : ""}>
                {Number(diaIso.slice(8, 10))}
              </span>
              <div className="mt-1 space-y-0.5">
                {lista.slice(0, 2).map((ent) => (
                  <div
                    key={ent.id}
                    className={`truncate rounded border px-1 ${ESTADO_COLOR[ent.estado]}`}
                  >
                    {ent.fechaHora.slice(11, 16)} {ent.candidatoNombre}
                  </div>
                ))}
                {lista.length > 2 ? (
                  <div className="text-[10px] opacity-70">+{lista.length - 2} más</div>
                ) : null}
              </div>
            </button>
          );
        })}
      </div>

      {cargando ? <p className="text-sm text-[var(--muted)]">Cargando…</p> : null}

      {diaSel ? (
        <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-medium">
              {diaSel} — {entrevistasDelDia.length} entrevista(s)
            </h2>
            <button
              type="button"
              className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white"
              onClick={() => abrirNueva(diaSel)}
            >
              + Nueva entrevista
            </button>
          </div>

          <ul className="space-y-2">
            {entrevistasDelDia.map((ent) => (
              <li
                key={ent.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded border border-[var(--border)] px-3 py-2 text-sm"
              >
                <div>
                  <span className="font-medium">{ent.fechaHora.slice(11, 16)}</span>
                  {" · "}
                  {ent.candidatoNombre} — {ent.puesto}
                  {ent.entrevistadorNombre ? ` · Entrevistador: ${ent.entrevistadorNombre}` : ""}
                  <span className={`ml-2 rounded border px-1.5 py-0.5 text-xs ${ESTADO_COLOR[ent.estado]}`}>
                    {ent.estado}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  <select
                    className={input}
                    value={ent.estado}
                    onChange={(e) =>
                      cambiarEstado(ent.id, e.target.value as Entrevista["estado"])
                    }
                  >
                    <option value="Programada">Programada</option>
                    <option value="Realizada">Realizada</option>
                    <option value="Cancelada">Cancelada</option>
                    <option value="No asistió">No asistió</option>
                  </select>
                  <select
                    className={input}
                    value={ent.resultado}
                    onChange={(e) =>
                      cambiarResultado(ent.id, e.target.value as Entrevista["resultado"])
                    }
                    aria-label={`Resultado de ${ent.candidatoNombre}`}
                  >
                    <option value="Pendiente">Resultado pendiente</option>
                    <option value="Aprobado">Aprobado</option>
                    <option value="Rechazado">Rechazado</option>
                  </select>
                  {ent.resultado === "Aprobado" ? (
                    <Link
                      href={`/e/${slug}/rrhh/empleados?entrevista=${ent.id}`}
                      className="rounded bg-emerald-600 px-2 py-1 text-xs text-white"
                    >
                      Crear empleado
                    </Link>
                  ) : null}
                  <button
                    type="button"
                    className="rounded border border-[var(--border)] px-2 py-1 text-xs"
                    onClick={() => abrirEditar(ent)}
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    className="rounded border border-red-500/40 px-2 py-1 text-xs text-red-300"
                    onClick={() => eliminar(ent.id)}
                  >
                    Eliminar
                  </button>
                </div>
              </li>
            ))}
            {entrevistasDelDia.length === 0 ? (
              <li className="text-sm text-[var(--muted)]">
                Sin entrevistas este día.
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}

      <form
        onSubmit={onSubmit}
        className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
      >
        <h2 className="text-lg font-medium">
          {editandoId ? `Editar entrevista #${editandoId}` : "Programar entrevista"}
        </h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <input
            className={input}
            placeholder="Nombre del candidato"
            value={form.candidatoNombre}
            onChange={(e) => setForm({ ...form, candidatoNombre: e.target.value })}
            required
          />
          <input
            className={input}
            placeholder="Puesto al que aplica"
            value={form.puesto}
            onChange={(e) => setForm({ ...form, puesto: e.target.value })}
            required
          />
          <input
            className={input}
            placeholder="Teléfono (opcional)"
            value={form.candidatoTelefono}
            onChange={(e) => setForm({ ...form, candidatoTelefono: e.target.value })}
          />
          <input
            className={input}
            type="email"
            placeholder="Email (opcional)"
            value={form.candidatoEmail}
            onChange={(e) => setForm({ ...form, candidatoEmail: e.target.value })}
          />
          <input
            className={input}
            type="date"
            value={form.fecha}
            onChange={(e) => setForm({ ...form, fecha: e.target.value })}
            required
          />
          <input
            className={input}
            type="time"
            value={form.hora}
            onChange={(e) => setForm({ ...form, hora: e.target.value })}
            required
          />
          <select
            className={input}
            value={form.modalidad}
            onChange={(e) =>
              setForm({ ...form, modalidad: e.target.value as "Presencial" | "Virtual" })
            }
          >
            <option value="Presencial">Presencial</option>
            <option value="Virtual">Virtual</option>
          </select>
          <input
            className={input}
            placeholder={form.modalidad === "Virtual" ? "Enlace de la videollamada" : "Lugar"}
            value={form.lugarOEnlace}
            onChange={(e) => setForm({ ...form, lugarOEnlace: e.target.value })}
          />
        </div>

        <EmpleadoPicker
          empleados={empleados}
          value={form.entrevistadorEmpleadoId}
          onChange={(id) => setForm({ ...form, entrevistadorEmpleadoId: id })}
          label="Entrevistador (empleado que la realizará)"
        />

        <textarea
          className={`${input} w-full`}
          placeholder="Comentarios y evaluación: experiencia, fortalezas, disponibilidad, observaciones y motivo del resultado (opcional)"
          aria-label="Comentarios y evaluación de la entrevista"
          rows={4}
          value={form.notas}
          onChange={(e) => setForm({ ...form, notas: e.target.value })}
        />

        {editandoId ? (
          <EntrevistaDocumentos slug={slug} entrevistaId={editandoId} />
        ) : (
          <p className="text-xs text-[var(--muted)]">
            Guarda primero la entrevista para habilitar la papelería del candidato.
          </p>
        )}

        <div className="flex gap-2">
          <button className="rounded bg-[var(--accent)] px-3 py-1 text-sm text-white">
            {editandoId ? "Guardar cambios" : "Programar"}
          </button>
          {editandoId ? (
            <button
              type="button"
              className="rounded border border-[var(--border)] px-3 py-1 text-sm"
              onClick={() => {
                setForm(vacio());
                setEditandoId(null);
              }}
            >
              Cancelar edición
            </button>
          ) : null}
        </div>
        {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}
      </form>
    </div>
  );
}
