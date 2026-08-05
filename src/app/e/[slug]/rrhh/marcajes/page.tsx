"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

type Marcaje = {
  id: number;
  nombre: string;
  codigo: string;
  entrada: string;
  salida: string;
  incidencia: string;
  estado: string;
  viajeLargo: boolean;
};

function formatReloj(d: Date): string {
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");
  const dia = d.getDate().toString().padStart(2, "0");
  const mes = (d.getMonth() + 1).toString().padStart(2, "0");
  const anio = d.getFullYear();
  return `${hh}:${mm}:${ss} — ${dia}/${mes}/${anio}`;
}

export default function MarcajesKioskoPage() {
  const slug = String(useParams().slug);
  const [reloj, setReloj] = useState(() => formatReloj(new Date()));
  const [codigo, setCodigo] = useState("");
  const [esVariable, setEsVariable] = useState(false);
  const [viajeLargo, setViajeLargo] = useState(false);
  const [marcajes, setMarcajes] = useState<Marcaje[]>([]);
  const [horaEntrada, setHoraEntrada] = useState("08:00:00");
  const [horaSalida, setHoraSalida] = useState("17:00:00");
  const [tolerancia, setTolerancia] = useState(10);
  const [geocercaActiva, setGeocercaActiva] = useState(false);
  const [geocercaRadio, setGeocercaRadio] = useState(150);
  const [empresaNombre, setEmpresaNombre] = useState("");
  const [loading, setLoading] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState("");
  const [tipoOk, setTipoOk] = useState<"Entrada" | "Salida" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hoy = new Date().toISOString().slice(0, 10);

  function obtenerGps(): Promise<{ lat: number; lng: number } | null> {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => {
      navigator.geolocation.getCurrentPosition(
        (pos) =>
          resolve({
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          }),
        () => resolve(null),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 30_000 },
      );
    });
  }

  useEffect(() => {
    const id = setInterval(() => setReloj(formatReloj(new Date())), 1000);
    return () => clearInterval(id);
  }, []);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [m, cfg, dash] = await Promise.all([
        fetch(
          `/api/empresas/${slug}/rrhh/marcajes?desde=${hoy}&hasta=${hoy}`,
        ).then((r) => r.json()),
        fetch(`/api/empresas/${slug}/rrhh/configuracion`).then((r) => r.json()),
        fetch(`/api/empresas/${slug}/rrhh/dashboard`).then((r) => r.json()),
      ]);
      setMarcajes(m.marcajes ?? []);
      if (cfg.parametros) {
        setHoraEntrada(cfg.parametros.hora_entrada_default ?? "08:00:00");
        setHoraSalida(cfg.parametros.hora_salida_default ?? "17:00:00");
        setTolerancia(Number(cfg.parametros.minutos_tolerancia ?? 10));
        setGeocercaActiva(String(cfg.parametros.geocerca_activa ?? "0") === "1");
        setGeocercaRadio(Number(cfg.parametros.geocerca_radio_m ?? 150) || 150);
      }
      if (dash.empresa) setEmpresaNombre(dash.empresa);
    } finally {
      setLoading(false);
    }
  }, [slug, hoy]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    if (!codigo.trim()) {
      setEsVariable(false);
      setViajeLargo(false);
      return;
    }
    const t = setTimeout(async () => {
      const res = await fetch(
        `/api/empresas/${slug}/rrhh/marcajes/empleado?codigo=${encodeURIComponent(codigo)}`,
      );
      const data = await res.json();
      if (res.ok && data.info?.esVariable) setEsVariable(true);
      else {
        setEsVariable(false);
        setViajeLargo(false);
      }
    }, 200);
    return () => clearTimeout(t);
  }, [codigo, slug]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (enviando) return;
    setError("");
    setMensaje("");
    setTipoOk(null);
    setEnviando(true);
    try {
      let latitud: number | null = null;
      let longitud: number | null = null;
      if (geocercaActiva) {
        const gps = await obtenerGps();
        if (!gps) {
          setError(
            "Activa la ubicación (GPS) del navegador. Esta empresa solo permite marcar cerca del predio.",
          );
          return;
        }
        latitud = gps.lat;
        longitud = gps.lng;
      } else {
        const gps = await obtenerGps();
        if (gps) {
          latitud = gps.lat;
          longitud = gps.lng;
        }
      }

      const res = await fetch(`/api/empresas/${slug}/rrhh/marcajes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          modo: "kiosko",
          codigo,
          viajeLargo,
          latitud,
          longitud,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo registrar");
        return;
      }
      setMensaje(data.mensaje);
      setTipoOk(data.tipo ?? null);
      setCodigo("");
      setEsVariable(false);
      setViajeLargo(false);
      await cargar();
      inputRef.current?.focus();
    } catch {
      setError("Error de red. Intenta de nuevo.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold">
            Registro de Marcajes
            {empresaNombre ? ` – ${empresaNombre}` : ""}
          </h1>
          <p className="text-sm text-[var(--muted)]">
            Entrada / salida automática por código (misma lógica que Control de
            Asistencias).
          </p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Horario referencia: {horaEntrada} — {horaSalida} | Tolerancia:{" "}
            {tolerancia} min
            {geocercaActiva
              ? ` | Geocerca activa (±${geocercaRadio} m del predio)`
              : ""}
          </p>
          {geocercaActiva ? (
            <p className="mt-1 text-xs text-amber-200">
              Solo se permite marcar dentro del radio configurado. El navegador
              pedirá permiso de ubicación.
            </p>
          ) : null}
        </div>
        <Link
          href={`/e/${slug}/rrhh/marcajes/manual`}
          className="rounded-lg bg-[#1e293b] px-3 py-2 text-xs text-[var(--muted)] hover:text-white"
        >
          Corrección manual RRHH →
        </Link>
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 md:p-10">
        <div className="mx-auto max-w-md rounded-xl bg-[#0b1217] px-6 py-4 text-center">
          <p className="font-mono text-2xl font-semibold tracking-wide text-[#2F8FD1] md:text-3xl">
            {reloj}
          </p>
        </div>

        <form onSubmit={onSubmit} className="mx-auto mt-8 max-w-md">
          <label className="block text-center text-sm font-semibold">
            Ingrese su Código o DPI
            <input
              ref={inputRef}
              className="mt-3 w-full rounded-lg border-2 border-[var(--accent)] bg-[#0b1217] px-4 py-3 text-center text-lg outline-none focus:ring-2 focus:ring-[#2F8FD1]"
              value={codigo}
              onChange={(e) => setCodigo(e.target.value)}
              placeholder="Ej: EMP001"
              autoFocus
              disabled={enviando}
              autoComplete="off"
            />
          </label>

          {esVariable ? (
            <label className="mt-4 flex items-center justify-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={viajeLargo}
                onChange={(e) => setViajeLargo(e.target.checked)}
                disabled={enviando}
              />
              Inicia viaje largo
            </label>
          ) : null}

          <button
            type="submit"
            disabled={enviando || !codigo.trim()}
            className="mt-6 w-full rounded-lg bg-[var(--accent)] px-4 py-3 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
          >
            {enviando ? "Registrando…" : "Registrar Marcaje"}
          </button>
        </form>

        {error ? (
          <p className="mx-auto mt-4 max-w-md text-center text-sm text-[#f0a0a0]">
            {error}
          </p>
        ) : null}
        {mensaje ? (
          <p
            className={[
              "mx-auto mt-4 max-w-md rounded-lg px-4 py-3 text-center text-sm",
              tipoOk === "Entrada"
                ? "bg-emerald-950/40 text-[#8fd4a0]"
                : "bg-rose-950/40 text-[#f0b0b0]",
            ].join(" ")}
          >
            {mensaje}
          </p>
        ) : null}

        <div className="mt-10">
          <h2 className="mb-3 text-sm font-semibold">Últimos marcajes de hoy</h2>
          <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-[#1F6AA5] text-white">
                <tr>
                  <th className="px-3 py-2">Empleado</th>
                  <th className="px-3 py-2">Entrada</th>
                  <th className="px-3 py-2">Salida</th>
                  <th className="px-3 py-2">Incid.</th>
                  <th className="px-3 py-2">Estado</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-[var(--muted)]">
                      Cargando…
                    </td>
                  </tr>
                ) : marcajes.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-3 py-6 text-[var(--muted)]">
                      No se han registrado marcajes el día de hoy.
                    </td>
                  </tr>
                ) : (
                  marcajes.map((m, idx) => (
                    <tr
                      key={`${m.id}-${idx}`}
                      className={[
                        "border-t border-[var(--border)]",
                        idx % 2 === 0 ? "bg-[#152028]" : "bg-[#121a20]",
                      ].join(" ")}
                    >
                      <td className="px-3 py-2">
                        {m.nombre}
                        {m.viajeLargo ? (
                          <span className="ml-2 text-[10px] uppercase text-[#e0c36a]">
                            viaje
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-2">{m.entrada}</td>
                      <td className="px-3 py-2">{m.salida}</td>
                      <td
                        className={[
                          "px-3 py-2",
                          m.incidencia === "Retraso"
                            ? "text-[#E67E22]"
                            : m.incidencia === "A tiempo"
                              ? "text-[#2ECC71]"
                              : "text-[var(--muted)]",
                        ].join(" ")}
                      >
                        {m.incidencia}
                      </td>
                      <td
                        className={[
                          "px-3 py-2",
                          m.estado === "ABIERTA" || m.estado === "En curso"
                            ? "text-[#5DADE2]"
                            : "text-[var(--muted)]",
                        ].join(" ")}
                      >
                        {m.estado}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
