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
import { hoyLocal, TZ_GUATEMALA } from "@/lib/rrhh/dates";
import { useEmpresaSession } from "@/lib/empresa-session";

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

type InfoEmpleadoMarcaje = {
  encontrado: boolean;
  numeroEmpleado?: string;
  nombre?: string;
  empresaId?: number;
  empresaNombre?: string;
  tipoHorario?: string;
  esVariable?: boolean;
  estado?: string;
};

function formatReloj(d: Date): string {
  const parts = new Intl.DateTimeFormat("es-GT", {
    timeZone: TZ_GUATEMALA,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hourCycle: "h23",
  }).formatToParts(d);

  const get = (t: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === t)?.value ?? "";

  return `${get("hour")}:${get("minute")}:${get("second")} — ${get("day")}/${get("month")}/${get("year")}`;
}

export default function MarcajesKioskoPage() {
  const slug = String(useParams().slug);
  const { rol: rolSesion, empresaNombre: nombreSesion } = useEmpresaSession();

  const [reloj, setReloj] = useState(() => formatReloj(new Date()));
  const [numeroEmpleado, setNumeroEmpleado] = useState("");
  const [infoEmpleado, setInfoEmpleado] =
    useState<InfoEmpleadoMarcaje | null>(null);
  const [buscandoEmpleado, setBuscandoEmpleado] = useState(false);

  const [esVariable, setEsVariable] = useState(false);
  const [viajeLargo, setViajeLargo] = useState(false);

  const [marcajes, setMarcajes] = useState<Marcaje[]>([]);
  const [horaEntrada, setHoraEntrada] = useState("08:00:00");
  const [horaSalida, setHoraSalida] = useState("17:00:00");
  const [tolerancia, setTolerancia] = useState(10);
  const [empresaNombre, setEmpresaNombre] = useState("");

  const [loading, setLoading] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [detectandoGps, setDetectandoGps] = useState(false);

  const [gpsActual, setGpsActual] = useState<{
    lat: number;
    lng: number;
  } | null>(null);

  const [gpsInfo, setGpsInfo] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState("");
  const [tipoOk, setTipoOk] = useState<"Entrada" | "Salida" | null>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const hoy = hoyLocal();

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
        {
          enableHighAccuracy: true,
          timeout: 12000,
          maximumAge: 15_000,
        },
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

    setGpsActual({
      lat: gps.lat,
      lng: gps.lng,
    });

    setGpsInfo(
      `Ubicación detectada: ${gps.lat.toFixed(5)}, ${gps.lng.toFixed(5)}. El servidor validará automáticamente la ubicación autorizada más cercana.`,
    );
  }

  useEffect(() => {
    const id = setInterval(() => {
      setReloj(formatReloj(new Date()));
    }, 1000);

    return () => clearInterval(id);
  }, []);

  const cargar = useCallback(async () => {
    setLoading(true);

    try {
      const m = await fetch(
        `/api/empresas/${slug}/rrhh/marcajes?desde=${hoy}&hasta=${hoy}`,
      ).then((r) => r.json());

      setMarcajes(m.marcajes ?? []);

      if (m.empresa?.nombre) {
        setEmpresaNombre(String(m.empresa.nombre));
      }

      if (m.horario) {
        setHoraEntrada(m.horario.horaEntrada ?? "08:00:00");
        setHoraSalida(m.horario.horaSalida ?? "17:00:00");
        setTolerancia(Number(m.horario.tolerancia ?? 10) || 10);
      }
    } finally {
      setLoading(false);
    }
  }, [slug, hoy]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  useEffect(() => {
    const numero = numeroEmpleado.trim();

    if (!numero) {
      setInfoEmpleado(null);
      setBuscandoEmpleado(false);
      setEsVariable(false);
      setViajeLargo(false);
      return;
    }

    let cancelado = false;

    const t = setTimeout(async () => {
      setBuscandoEmpleado(true);

      try {
        const res = await fetch(
          `/api/empresas/${slug}/rrhh/marcajes/empleado?codigo=${encodeURIComponent(numero)}`,
        );

        const data = await res.json();

        if (cancelado) return;

        const info: InfoEmpleadoMarcaje =
          data.info ?? { encontrado: false };

        setInfoEmpleado(info);

        if (res.ok && info.encontrado && info.esVariable) {
          setEsVariable(true);
        } else {
          setEsVariable(false);
          setViajeLargo(false);
        }
      } catch {
        if (!cancelado) {
          setInfoEmpleado({ encontrado: false });
          setEsVariable(false);
          setViajeLargo(false);
        }
      } finally {
        if (!cancelado) {
          setBuscandoEmpleado(false);
        }
      }
    }, 250);

    return () => {
      cancelado = true;
      clearTimeout(t);
    };
  }, [numeroEmpleado, slug]);

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

          setGpsActual({
            lat: gps.lat,
            lng: gps.lng,
          });
        }
      }

      const res = await fetch(`/api/empresas/${slug}/rrhh/marcajes`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          modo: "kiosko",

          // La API conserva temporalmente el nombre "codigo",
          // pero ahora recibe el numero_empleado global.
          codigo: numeroEmpleado.trim(),

          viajeLargo,
          latitud,
          longitud,
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error ?? "No se pudo registrar el marcaje.");
        return;
      }

      const ubicacion =
        data.ubicacionNombre && data.metros != null
          ? ` · ${data.ubicacionNombre} (~${data.metros} m)`
          : data.ubicacionNombre
            ? ` · ${data.ubicacionNombre}`
            : "";

      setMensaje(`${data.mensaje}${ubicacion}`);
      setTipoOk(data.tipo ?? null);

      setNumeroEmpleado("");
      setInfoEmpleado(null);
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
            {empresaNombre || nombreSesion
              ? ` – ${empresaNombre || nombreSesion}`
              : ""}
          </h1>

          <p className="text-sm text-[var(--muted)]">
            Entrada / salida automática por número de empleado global.
          </p>

          <p className="mt-1 text-sm text-[var(--muted)]">
            Horario referencia del kiosko: {horaEntrada} — {horaSalida} |
            Tolerancia: {tolerancia} min
          </p>

          <p className="mt-1 text-xs text-amber-200">
            El GPS se valida en el servidor contra todas las ubicaciones de
            marcaje activas del grupo.
          </p>
        </div>

        {rolSesion && rolSesion !== "Marcaje" ? (
          <Link
            href={`/e/${slug}/rrhh/marcajes/manual`}
            className="rounded-lg bg-[#1e293b] px-3 py-2 text-xs text-[var(--muted)] hover:text-white"
          >
            Corrección manual RRHH →
          </Link>
        ) : null}
      </div>

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 md:p-10">
        <div className="mx-auto max-w-md rounded-xl bg-[var(--input)] px-6 py-4 text-center">
          <p className="font-mono text-2xl font-semibold tracking-wide text-[#2F8FD1] md:text-3xl">
            {reloj}
          </p>
        </div>

        <form onSubmit={onSubmit} className="mx-auto mt-8 max-w-md">
          <label className="block text-center text-sm font-semibold">
            Número de empleado
            <input
              ref={inputRef}
              className="mt-3 w-full rounded-lg border-2 border-[var(--accent)] bg-[var(--input)] px-4 py-3 text-center text-lg outline-none focus:ring-2 focus:ring-[#2F8FD1]"
              value={numeroEmpleado}
              onChange={(e) => setNumeroEmpleado(e.target.value)}
              placeholder="Ej: 000028"
              autoFocus
              disabled={enviando}
              autoComplete="off"
              inputMode="numeric"
            />
          </label>

          {numeroEmpleado.trim() ? (
            <div className="mt-4 rounded-lg border border-[var(--border)] bg-[var(--panel)] p-3 text-sm">
              {buscandoEmpleado ? (
                <p className="text-[var(--muted)]">
                  Buscando empleado…
                </p>
              ) : infoEmpleado?.encontrado ? (
                <div className="space-y-1">
                  <p>
                    <span className="text-[var(--muted)]">Empleado: </span>
                    <span className="font-medium">
                      {infoEmpleado.nombre}
                    </span>
                  </p>

                  <p>
                    <span className="text-[var(--muted)]">Empresa: </span>
                    <span className="font-medium">
                      {infoEmpleado.empresaNombre || "—"}
                    </span>
                  </p>

                  <p>
                    <span className="text-[var(--muted)]">
                      No. empleado:{" "}
                    </span>
                    <span className="font-mono">
                      {infoEmpleado.numeroEmpleado || numeroEmpleado}
                    </span>
                  </p>

                  {infoEmpleado.estado === "Baja" ? (
                    <p className="text-rose-300">
                      Este empleado está de Baja y no puede marcar.
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-rose-300">
                  No se encontró ningún empleado con ese número.
                </p>
              )}
            </div>
          ) : null}

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

          <div className="mt-5 rounded-lg border border-sky-800/40 bg-sky-950/25 p-3 text-left">
            <p className="text-xs font-medium text-sky-100">
              Ubicación del dispositivo
            </p>

            <p className="mt-0.5 text-[11px] text-[var(--muted)]">
              Detecta tu GPS. El servidor determinará automáticamente si estás
              dentro de una ubicación autorizada y cuál es la más cercana.
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
              </p>
            ) : null}

            {gpsInfo ? (
              <p
                className={`mt-1 text-xs ${
                  gpsActual ? "text-emerald-300" : "text-rose-300"
                }`}
              >
                {gpsInfo}
              </p>
            ) : null}
          </div>

          <button
            type="submit"
            disabled={
              enviando ||
              !numeroEmpleado.trim() ||
              buscandoEmpleado ||
              infoEmpleado?.encontrado === false ||
              infoEmpleado?.estado === "Baja"
            }
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
          <h2 className="mb-3 text-sm font-semibold">
            Últimos marcajes de hoy
          </h2>

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
                    <td
                      colSpan={5}
                      className="px-3 py-6 text-[var(--muted)]"
                    >
                      Cargando…
                    </td>
                  </tr>
                ) : marcajes.length === 0 ? (
                  <tr>
                    <td
                      colSpan={5}
                      className="px-3 py-6 text-[var(--muted)]"
                    >
                      No se han registrado marcajes el día de hoy.
                    </td>
                  </tr>
                ) : (
                  marcajes.map((m, idx) => (
                    <tr
                      key={`${m.id}-${idx}`}
                      className={[
                        "border-t border-[var(--border)] text-[var(--text)]",
                        idx % 2 === 0
                          ? "bg-[var(--panel)]"
                          : "bg-[var(--card)]",
                      ].join(" ")}
                    >
                      <td className="px-3 py-2 font-medium text-[var(--text)]">
                        {m.nombre}

                        {m.viajeLargo ? (
                          <span className="ml-2 text-[10px] uppercase text-amber-600">
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
                            ? "text-orange-600"
                            : m.incidencia === "A tiempo"
                              ? "text-emerald-600"
                              : "text-[var(--muted)]",
                        ].join(" ")}
                      >
                        {m.incidencia}
                      </td>

                      <td
                        className={[
                          "px-3 py-2",
                          m.estado === "ABIERTA" ||
                          m.estado === "En curso"
                            ? "text-sky-600"
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