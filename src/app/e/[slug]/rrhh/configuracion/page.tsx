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
    "mt-1 w-full rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1 text-sm";

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
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="rounded bg-[#334155] px-3 py-1.5 text-xs text-white"
              onClick={() => {
                setGpsMsg("");
                if (!navigator.geolocation) {
                  setGpsMsg("Este navegador no soporta GPS.");
                  return;
                }
                navigator.geolocation.getCurrentPosition(
                  (pos) => {
                    setParams((p) => ({
                      ...p,
                      geocerca_lat: String(pos.coords.latitude),
                      geocerca_lng: String(pos.coords.longitude),
                    }));
                    setGpsMsg(
                      "Ubicación del dispositivo cargada. Guarda parámetros.",
                    );
                  },
                  () =>
                    setGpsMsg(
                      "No se pudo leer GPS. Revisa permisos del navegador.",
                    ),
                  { enableHighAccuracy: true, timeout: 12000 },
                );
              }}
            >
              Usar mi ubicación actual como predio
            </button>
            {gpsMsg ? (
              <span className="text-xs text-sky-200">{gpsMsg}</span>
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
          className="rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1 text-sm"
          placeholder="Descripción feriado"
          value={desc}
          onChange={(e) => setDesc(e.target.value)}
          required
        />
        <input
          type="date"
          className="rounded border border-[var(--border)] bg-[#0b1217] px-2 py-1 text-sm"
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
