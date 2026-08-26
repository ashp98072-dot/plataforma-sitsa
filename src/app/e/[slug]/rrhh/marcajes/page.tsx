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
import { CamaraMarcaje } from "./camara-marcaje";

type Marcaje = {
  id: number;
  nombre: string;
  codigo: string;
  entrada: string;
  salida: string;
  incidencia: string;
  estado: string;
  viajeLargo: boolean;
  fotoEntradaId: number | null;
  fotoSalidaId: number | null;
};

type JornadaPendiente = {
  id: number;
  codigo: string;
  nombre: string;
  fechaJornada: string;
  entrada: string;
};

type InfoEmpleadoMarcaje = {
  encontrado: boolean;
  numeroEmpleado?: string;
  dpiEnmascarado?: string;
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
  const [pendientesCierre, setPendientesCierre] = useState<JornadaPendiente[]>([]);
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
    actualizadoEn: Date;
  } | null>(null);

  const [gpsInfo, setGpsInfo] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [error, setError] = useState("");
  const [tipoOk, setTipoOk] = useState<"Entrada" | "Salida" | null>(null);
  const [fotoMarcaje, setFotoMarcaje] = useState<Blob | null>(null);
  const [capturaKey, setCapturaKey] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const hoy = hoyLocal();

  const obtenerGps = useCallback((): Promise<{ lat: number; lng: number } | null> => {
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
          maximumAge: 10_000,
        },
      );
    });
  }, []);

  const detectarUbicacion = useCallback(async () => {
    setDetectandoGps(true);
    setGpsInfo("");

    const gps = await obtenerGps();

    setDetectandoGps(false);

    if (!gps) {
      setGpsActual(null);
      setGpsInfo(
        "No se pudo detectar GPS. Permite la ubicación en el navegador (candado → Ubicación → Permitir). El sistema volverá a intentarlo automáticamente.",
      );
      return;
    }

    setGpsActual({
      lat: gps.lat,
      lng: gps.lng,
      actualizadoEn: new Date(),
    });

    setGpsInfo(
      "GPS disponible. El servidor validará automáticamente la ubicación autorizada más cercana.",
    );
  }, [obtenerGps]);

  useEffect(() => {
    // Se solicita al abrir el kiosco y se renueva para evitar usar una posición antigua.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void detectarUbicacion();
    const id = window.setInterval(() => void detectarUbicacion(), 30_000);
    return () => window.clearInterval(id);
  }, [detectarUbicacion]);

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
        `/api/empresas/${slug}/rrhh/marcajes?desde=${hoy}&hasta=${hoy}&incluirPendientes=${rolSesion && rolSesion !== "Marcaje" ? "true" : "false"}`,
      ).then((r) => r.json());

      setMarcajes(m.marcajes ?? []);
      setPendientesCierre(m.pendientesCierre ?? []);

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
  }, [slug, hoy, rolSesion]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  useEffect(() => {
    const numero = numeroEmpleado.trim();

    if (!numero || numero.length !== 13) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
          `/api/empresas/${slug}/rrhh/marcajes/empleado?dpi=${encodeURIComponent(numero)}`,
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
      if (!fotoMarcaje) {
        setError("Toma una fotografía desde la cámara antes de registrar el marcaje.");
        return;
      }
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
            actualizadoEn: new Date(),
          });
        }
      }

      if (latitud == null || longitud == null) {
        setError("Activa y autoriza el GPS antes de registrar el marcaje.");
        return;
      }

      const form = new FormData();
      form.set("modo", "kiosko");
      form.set("dpi", numeroEmpleado.trim());
      form.set("viajeLargo", String(viajeLargo));
      form.set("latitud", String(latitud));
      form.set("longitud", String(longitud));
      form.set("foto", fotoMarcaje, `marcaje_${Date.now()}.jpg`);
      const res = await fetch(`/api/empresas/${slug}/rrhh/marcajes`, {
        method: "POST",
        body: form,
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
      setFotoMarcaje(null);
      setCapturaKey((actual) => actual + 1);

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
            Entrada / salida por DPI, fotografía en vivo y ubicación GPS.
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

      {rolSesion && rolSesion !== "Marcaje" && pendientesCierre.length > 0 ? (
        <section className="mb-4 rounded-xl border border-amber-700/50 bg-amber-950/20 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold text-amber-200">
                Jornadas anteriores pendientes de cierre ({pendientesCierre.length})
              </h2>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Revisa la hora real de salida. El sistema no cerrará jornadas automáticamente.
              </p>
            </div>
            <Link
              href={`/e/${slug}/rrhh/marcajes/manual`}
              className="rounded bg-amber-700 px-3 py-2 text-xs text-white"
            >
              Completar en modo manual
            </Link>
          </div>
          <ul className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
            {pendientesCierre.map((jornada) => (
              <li key={jornada.id} className="rounded border border-amber-800/40 p-2">
                <span className="font-medium">{jornada.nombre}</span>
                <span className="text-[var(--muted)]"> · {jornada.codigo}</span>
                <br />
                <span className="text-xs text-[var(--muted)]">
                  {jornada.fechaJornada} · entrada {jornada.entrada}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <div className="rounded-2xl border border-[var(--border)] bg-[var(--card)] p-6 md:p-10">
        <div className="mx-auto max-w-md rounded-xl bg-[var(--input)] px-6 py-4 text-center">
          <p className="font-mono text-2xl font-semibold tracking-wide text-[#2F8FD1] md:text-3xl">
            {reloj}
          </p>
        </div>

        <form onSubmit={onSubmit} className="mx-auto mt-8 max-w-md">
          <label className="block text-center text-sm font-semibold">
            DPI
            <input
              ref={inputRef}
              className="mt-3 w-full rounded-lg border-2 border-[var(--accent)] bg-[var(--input)] px-4 py-3 text-center text-lg outline-none focus:ring-2 focus:ring-[#2F8FD1]"
              value={numeroEmpleado}
              onChange={(e) => {
                setNumeroEmpleado(e.target.value.replace(/\D/g, "").slice(0, 13));
                setFotoMarcaje(null);
                setCapturaKey((actual) => actual + 1);
              }}
              placeholder="13 dígitos"
              autoFocus
              disabled={enviando}
              autoComplete="off"
              inputMode="numeric"
              maxLength={13}
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
                      DPI:{" "}
                    </span>
                    <span className="font-mono">
                      {infoEmpleado.dpiEnmascarado || "*************"}
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

          <CamaraMarcaje
            key={capturaKey}
            disabled={enviando || !infoEmpleado?.encontrado || infoEmpleado.estado === "Baja"}
            onCapture={setFotoMarcaje}
          />

          <div className="mt-5 rounded-lg border border-sky-800/40 bg-sky-950/25 p-3 text-left">
            <p className="text-xs font-medium text-sky-100">
              Ubicación del dispositivo
            </p>

            <p className="mt-0.5 text-[11px] text-[var(--muted)]">
              El GPS se detecta al abrir esta pantalla y se actualiza
              automáticamente cada 30 segundos. El servidor determinará si
              estás dentro de una ubicación autorizada.
            </p>

            {gpsActual ? (
              <p className="mt-2 text-[11px] text-emerald-300">
                GPS activo · actualizado a las {gpsActual.actualizadoEn.toLocaleTimeString("es-GT")}
              </p>
            ) : (
              <p className="mt-2 text-[11px] text-amber-200">
                {detectandoGps ? "Detectando ubicación automáticamente…" : "Esperando señal GPS…"}
              </p>
            )}

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
              infoEmpleado?.estado === "Baja" ||
              !fotoMarcaje ||
              !gpsActual
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
                  {rolSesion !== "Marcaje" ? <th className="px-3 py-2">Fotografías</th> : null}
                </tr>
              </thead>

              <tbody>
                {loading ? (
                  <tr>
                    <td
                      colSpan={rolSesion !== "Marcaje" ? 6 : 5}
                      className="px-3 py-6 text-[var(--muted)]"
                    >
                      Cargando…
                    </td>
                  </tr>
                ) : marcajes.length === 0 ? (
                  <tr>
                    <td
                      colSpan={rolSesion !== "Marcaje" ? 6 : 5}
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
                      {rolSesion !== "Marcaje" ? (
                        <td className="px-3 py-2">
                          <div className="flex gap-2 text-xs">
                            {m.fotoEntradaId ? <a href={`/api/empresas/${slug}/rrhh/marcajes/evidencias/${m.fotoEntradaId}`} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">Entrada</a> : null}
                            {m.fotoSalidaId ? <a href={`/api/empresas/${slug}/rrhh/marcajes/evidencias/${m.fotoSalidaId}`} target="_blank" rel="noreferrer" className="text-sky-300 hover:underline">Salida</a> : null}
                            {!m.fotoEntradaId && !m.fotoSalidaId ? <span className="text-[var(--muted)]">—</span> : null}
                          </div>
                        </td>
                      ) : null}
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
