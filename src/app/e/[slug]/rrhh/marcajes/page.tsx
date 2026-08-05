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
  const [geocercaLat, setGeocercaLat] = useState<number | null>(null);
  const [geocercaLng, setGeocercaLng] = useState<number | null>(null);
  const [empresaNombre, setEmpresaNombre] = useState("");
  const [rolUsuario, setRolUsuario] = useState("");
  const [loading, setLoading] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [detectandoGps, setDetectandoGps] = useState(false);
  const [gpsActual, setGpsActual] = useState<{
    lat: number;
    lng: number;
    metros: number | null;
  } | null>(null);
  const [gpsInfo, setGpsInfo] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState("");
  const [tipoOk, setTipoOk] = useState<"Entrada" | "Salida" | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const hoy = new Date().toISOString().slice(0, 10);

  function metrosEntre(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): number {
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) *
        Math.cos(toRad(lat2)) *
        Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  }

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
        { enableHighAccuracy: true, timeout: 12000, maximumAge: 15_000 },
      );
    });
  }

  async function detectarUbicacion() {
    setDetectandoGps(true);
    setGpsInfo("");
    setError("");
    const gps = await obtenerGps();
    setDetectandoGps(false);
    if (!gps) {
      setGpsActual(null);
      setGpsInfo(
        "No se pudo detectar GPS. Permite la ubicación en el navegador (candado → Ubicación → Permitir) y vuelve a intentar.",
      );
      return;
    }
    let metros: number | null = null;
    if (geocercaLat != null && geocercaLng != null) {
      metros = Math.round(
        metrosEntre(geocercaLat, geocercaLng, gps.lat, gps.lng),
      );
    }
    setGpsActual({ lat: gps.lat, lng: gps.lng, metros });
    if (metros != null && geocercaActiva) {
      setGpsInfo(
        metros <= geocercaRadio
          ? `Ubicación OK: estás a ~${metros} m del predio (límite ${geocercaRadio} m).`
          : `Fuera de zona: ~${metros} m del predio (límite ${geocercaRadio} m). Acércate para marcar.`,
      );
    } else {
      setGpsInfo(
        `Ubicación detectada: ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}`,
      );
    }
  }

  useEffect(() => {
    const id = setInterval(() => setReloj(formatReloj(new Date())), 1000);
    return () => clearInterval(id);
  }, []);

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const [m, me] = await Promise.all([
        fetch(
          `/api/empresas/${slug}/rrhh/marcajes?desde=${hoy}&hasta=${hoy}`,
        ).then((r) => r.json()),
        fetch("/api/auth/me").then((r) => r.json()),
      ]);
      setMarcajes(m.marcajes ?? []);
      if (m.empresa?.nombre) setEmpresaNombre(String(m.empresa.nombre));
      if (m.horario) {
        setHoraEntrada(m.horario.horaEntrada ?? "08:00:00");
        setHoraSalida(m.horario.horaSalida ?? "17:00:00");
        setTolerancia(Number(m.horario.tolerancia ?? 10) || 10);
      }
      if (m.geocerca) {
        setGeocercaActiva(Boolean(m.geocerca.activa));
        setGeocercaRadio(Number(m.geocerca.radioM ?? 150) || 150);
        setGeocercaLat(
          typeof m.geocerca.lat === "number" ? m.geocerca.lat : null,
        );
        setGeocercaLng(
          typeof m.geocerca.lng === "number" ? m.geocerca.lng : null,
        );
      }
      if (me.user?.rol) setRolUsuario(String(me.user.rol));
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
      let latitud: number | null = gpsActual?.lat ?? null;
      let longitud: number | null = gpsActual?.lng ?? null;
      if (latitud == null || longitud == null) {
        const gps = await obtenerGps();
        if (gps) {
          latitud = gps.lat;
          longitud = gps.lng;
        }
      }
      if (geocercaActiva && (latitud == null || longitud == null)) {
        setError(
          "Activa la ubicación (GPS). Usa «Detectar mi ubicación» o permite el permiso del navegador.",
        );
        return;
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
        {rolUsuario && rolUsuario !== "Marcaje" ? (
          <Link
            href={`/e/${slug}/rrhh/marcajes/manual`}
            className="rounded-lg bg-[#1e293b] px-3 py-2 text-xs text-[var(--muted)] hover:text-white"
          >
            Corrección manual RRHH →
          </Link>
        ) : null}
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 md:p-10">
        <div className="mx-auto max-w-md rounded-xl bg-[#0b1217] px-6 py-4 text-center">
          <p className="font-mono text-2xl font-semibold tracking-wide text-[#2F8FD1] md:text-3xl">
            {reloj}
          </p>
        </div>

        <form onSubmit={onSubmit} className="mx-auto mt-8 max-w-md">
          <div className="mb-5 rounded-lg border border-sky-800/40 bg-sky-950/25 p-3 text-left">
            <p className="text-xs font-medium text-sky-100">
              Ubicación del dispositivo
            </p>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">
              {geocercaActiva
                ? "La geocerca está activa: detecta tu ubicación antes de marcar."
                : "Opcional: puedes detectar GPS aunque la geocerca esté apagada."}
            </p>
            <button
              type="button"
              disabled={detectandoGps || enviando}
              onClick={() => void detectarUbicacion()}
              className="mt-2 w-full rounded bg-[#0ea5e9] px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {detectandoGps ? "Detectando…" : "Detectar mi ubicación"}
            </button>
            {gpsActual ? (
              <p className="mt-2 font-mono text-[11px] text-sky-200">
                GPS: {gpsActual.lat.toFixed(5)}, {gpsActual.lng.toFixed(5)}
                {gpsActual.metros != null
                  ? ` · ~${gpsActual.metros} m del predio`
                  : ""}
              </p>
            ) : null}
            {gpsInfo ? (
              <p
                className={`mt-1 text-xs ${
                  gpsActual?.metros != null &&
                  geocercaActiva &&
                  gpsActual.metros > geocercaRadio
                    ? "text-rose-300"
                    : "text-emerald-300"
                }`}
              >
                {gpsInfo}
              </p>
            ) : null}
          </div>

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
