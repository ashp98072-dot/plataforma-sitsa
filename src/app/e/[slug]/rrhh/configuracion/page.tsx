"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

export default function ConfigRrhhPage() {
  const slug = String(useParams().slug);
  const [params, setParams] = useState({
    hora_entrada_default: "08:00:00",
    hora_salida_default: "17:00:00",
    minutos_tolerancia: "10",
    ciclo_quincenal: "15",
    geocerca_activa: "0",
    geocerca_lat: "",
    geocerca_lng: "",
    geocerca_radio_m: "150",
  });
  const [feriados, setFeriados] = useState<
    { id: number; descripcion: string; fecha: string; activo: boolean }[]
  >([]);
  const [desc, setDesc] = useState("");
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [msg, setMsg] = useState("");
  const [gpsMsg, setGpsMsg] = useState("");

  const cargar = useCallback(async () => {
    const res = await fetch(`/api/empresas/${slug}/rrhh/configuracion`);
    const data = await res.json();
    if (res.ok) {
      setParams((p) => ({ ...p, ...(data.parametros ?? {}) }));
      setFeriados(data.feriados ?? []);
    }
  }, [slug]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  async function guardarParams(e: FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/empresas/${slug}/rrhh/configuracion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "params", parametros: params }),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error);
  }

  async function addFeriado(e: FormEvent) {
    e.preventDefault();
    const res = await fetch(`/api/empresas/${slug}/rrhh/configuracion`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "feriado", descripcion: desc, fecha }),
    });
    const data = await res.json();
    setMsg(data.mensaje || data.error);
    if (res.ok) {
      setDesc("");
      await cargar();
    }
  }

  const input =
    "mt-1 w-full rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Configuración RRHH</h1>
        <p className="text-sm text-[var(--muted)]">
          Tolerancia de retraso, horas por defecto y feriados de esta empresa.{" "}
          <Link
            href={`/e/${slug}/dashboard-rrhh`}
            className="text-[var(--accent)] underline"
          >
            Dashboard
          </Link>
        </p>
      </div>

      <form
        onSubmit={guardarParams}
        className="grid gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:grid-cols-2"
      >
        <label className="text-sm text-[var(--muted)]">
          Entrada default
          <input
            className={input}
            value={params.hora_entrada_default}
            onChange={(e) =>
              setParams({ ...params, hora_entrada_default: e.target.value })
            }
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Salida default
          <input
            className={input}
            value={params.hora_salida_default}
            onChange={(e) =>
              setParams({ ...params, hora_salida_default: e.target.value })
            }
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Minutos tolerancia
          <input
            className={input}
            value={params.minutos_tolerancia}
            onChange={(e) =>
              setParams({ ...params, minutos_tolerancia: e.target.value })
            }
          />
        </label>
        <label className="text-sm text-[var(--muted)]">
          Día corte quincena (1–28)
          <input
            className={input}
            value={params.ciclo_quincenal}
            onChange={(e) =>
              setParams({ ...params, ciclo_quincenal: e.target.value })
            }
          />
        </label>

        <div className="sm:col-span-2 mt-2 rounded-lg border border-sky-800/40 bg-sky-950/20 p-3 space-y-3">
          <div>
            <p className="text-sm font-medium text-sky-100">
              Geocerca de marcaje (ubicación)
            </p>
            <p className="text-[11px] text-[var(--muted)]">
              Si está activa, el kiosko solo deja marcar dentro del radio del
              predio (GPS del celular/navegador). La corrección manual de RRHH
              no se bloquea. Empleados «en ruta» pueden marcar fuera.
            </p>
          </div>
          <label className="flex items-center gap-2 text-sm text-[var(--fg)]">
            <input
              type="checkbox"
              checked={params.geocerca_activa === "1"}
              onChange={(e) =>
                setParams({
                  ...params,
                  geocerca_activa: e.target.checked ? "1" : "0",
                })
              }
            />
            Activar geocerca en kiosko
          </label>
          <div className="grid gap-3 sm:grid-cols-3">
            <label className="text-sm text-[var(--muted)]">
              Latitud predio
              <input
                className={input}
                placeholder="14.6349"
                value={params.geocerca_lat}
                onChange={(e) =>
                  setParams({ ...params, geocerca_lat: e.target.value })
                }
              />
            </label>
            <label className="text-sm text-[var(--muted)]">
              Longitud predio
              <input
                className={input}
                placeholder="-90.5069"
                value={params.geocerca_lng}
                onChange={(e) =>
                  setParams({ ...params, geocerca_lng: e.target.value })
                }
              />
            </label>
            <label className="text-sm text-[var(--muted)]">
              Radio (metros)
              <input
                className={input}
                type="number"
                min={30}
                max={5000}
                value={params.geocerca_radio_m}
                onChange={(e) =>
                  setParams({ ...params, geocerca_radio_m: e.target.value })
                }
              />
            </label>
          </div>
          <div className="flex flex-col gap-2">
            <button
              type="button"
              className="rounded bg-[#0ea5e9] px-3 py-2 text-sm font-medium text-white"
              onClick={() => {
                setGpsMsg("Detectando ubicación…");
                if (!navigator.geolocation) {
                  setGpsMsg("Este navegador no soporta GPS.");
                  return;
                }
                navigator.geolocation.getCurrentPosition(
                  (pos) => {
                    let lng = pos.coords.longitude;
                    // Guatemala / Centroamérica: longitud es negativa (oeste)
                    if (lng > 0 && lng < 100) lng = -lng;
                    setParams((p) => ({
                      ...p,
                      geocerca_lat: pos.coords.latitude.toFixed(6),
                      geocerca_lng: lng.toFixed(6),
                      geocerca_activa: "1",
                    }));
                    setGpsMsg(
                      `Detectado: ${pos.coords.latitude.toFixed(5)}, ${lng.toFixed(5)}. Pulsa «Guardar parámetros».`,
                    );
                  },
                  (err) =>
                    setGpsMsg(
                      err.code === 1
                        ? "Permiso de ubicación denegado. En el candado del navegador → Ubicación → Permitir."
                        : "No se pudo leer GPS. Intenta en HTTPS o acerca el dispositivo a una ventana.",
                    ),
                  { enableHighAccuracy: true, timeout: 15000 },
                );
              }}
            >
              Detectar ubicación actual del predio
            </button>
            {gpsMsg ? (
              <span className="text-xs text-sky-200">{gpsMsg}</span>
            ) : (
              <span className="text-[11px] text-[var(--muted)]">
                Tip: estate en el predio, pulsa detectar y luego Guardar. En
                Guatemala la longitud debe ir con signo negativo (ej. -90.50).
              </span>
            )}
            {params.geocerca_lng &&
            Number(params.geocerca_lng) > 0 &&
            Number(params.geocerca_lng) < 100 ? (
              <p className="text-xs text-amber-300">
                La longitud {params.geocerca_lng} parece positiva. En Guatemala
                suele ser negativa (ej. -{params.geocerca_lng}). Corrígela o
                vuelve a detectar.
              </p>
            ) : null}
          </div>
        </div>

        <button className="rounded bg-[var(--accent)] px-3 py-2 text-sm text-white sm:col-span-2">
          Guardar parámetros
        </button>
      </form>

      <form
        onSubmit={addFeriado}
        className="flex flex-wrap gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
      >
        <input
          className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm"
          placeholder="Descripción feriado"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          required
        />
        <input
          type="date"
          className="rounded border border-[var(--border)] bg-[var(--input)] px-2 py-1 text-sm"
          value={fecha}
          onChange={(e) => setFecha(e.target.value)}
        />
        <button className="rounded bg-[#0d9488] px-3 py-1 text-sm text-white">
          Agregar feriado
        </button>
      </form>

      {msg ? <p className="text-sm text-emerald-300">{msg}</p> : null}

      <ul className="space-y-1 text-sm">
        {feriados.map((f) => (
          <li
            key={f.id}
            className="flex items-center justify-between rounded border border-[var(--border)] px-3 py-2"
          >
            <span>
              {f.fecha} — {f.descripcion}{" "}
              <span className="text-[var(--muted)]">
                ({f.activo ? "activo" : "inactivo"})
              </span>
            </span>
            <button
              type="button"
              className="text-xs underline text-[var(--accent-2)]"
              onClick={async () => {
                await fetch(`/api/empresas/${slug}/rrhh/configuracion`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({
                    action: "toggleFeriado",
                    feriadoId: f.id,
                    activo: !f.activo,
                  }),
                });
                await cargar();
              }}
            >
              {f.activo ? "Desactivar" : "Activar"}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
