"use client";

import {
  useCallback,
  useEffect,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

type Ubicacion = {
  id: number;
  nombre: string;
  lat: number;
  lng: number;
  radioM: number;
  activa: boolean;
};

const FORM_INICIAL = {
  nombre: "",
  lat: "",
  lng: "",
  radioM: "150",
};

export default function UbicacionesMarcajePage() {
  const slug = String(useParams().slug);

  const [ubicaciones, setUbicaciones] = useState<Ubicacion[]>([]);
  const [form, setForm] = useState(FORM_INICIAL);
  const [editandoId, setEditandoId] = useState<number | null>(null);
  const [msg, setMsg] = useState("");
  const [error, setError] = useState("");
  const [gpsMsg, setGpsMsg] = useState("");
  const [cargando, setCargando] = useState(true);
  const [guardando, setGuardando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);

    try {
      const res = await fetch(
        `/api/empresas/${slug}/rrhh/ubicaciones-marcaje`,
      );

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "No se pudieron cargar las ubicaciones.");
        return;
      }

      setUbicaciones(data.ubicaciones ?? []);
      setError("");
    } catch {
      setError("No se pudieron cargar las ubicaciones.");
    } finally {
      setCargando(false);
    }
  }, [slug]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  function limpiarFormulario() {
    setForm(FORM_INICIAL);
    setEditandoId(null);
    setGpsMsg("");
  }

  function detectarUbicacion() {
    setGpsMsg("Detectando ubicación…");

    if (!navigator.geolocation) {
      setGpsMsg("Este navegador no soporta GPS.");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        let lng = pos.coords.longitude;

        if (lng > 0 && lng < 100) {
          lng = -lng;
        }

        setForm((actual) => ({
          ...actual,
          lat: pos.coords.latitude.toFixed(7),
          lng: lng.toFixed(7),
        }));

        setGpsMsg(
          `Detectado: ${pos.coords.latitude.toFixed(5)}, ${lng.toFixed(5)}.`,
        );
      },
      (err) => {
        setGpsMsg(
          err.code === 1
            ? "Permiso de ubicación denegado. Habilita la ubicación en el navegador."
            : "No se pudo obtener la ubicación GPS.",
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 15000,
      },
    );
  }

  async function guardar(e: FormEvent) {
    e.preventDefault();

    setMsg("");
    setError("");

    const lat = Number(form.lat);
    const lng = Number(form.lng);
    const radioM = Number(form.radioM);

    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      setError("La latitud debe estar entre -90 y 90.");
      return;
    }

    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      setError("La longitud debe estar entre -180 y 180.");
      return;
    }

    if (
      !Number.isInteger(radioM) ||
      radioM < 30 ||
      radioM > 5000
    ) {
      setError("El radio debe estar entre 30 y 5000 metros.");
      return;
    }

    setGuardando(true);

    try {
      const body =
        editandoId == null
          ? {
              action: "crear",
              nombre: form.nombre.trim(),
              lat,
              lng,
              radioM,
            }
          : {
              action: "editar",
              id: editandoId,
              nombre: form.nombre.trim(),
              lat,
              lng,
              radioM,
            };

      const res = await fetch(
        `/api/empresas/${slug}/rrhh/ubicaciones-marcaje`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
        },
      );

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "No se pudo guardar la ubicación.");
        return;
      }

      setMsg(data.mensaje || "Ubicación guardada.");
      limpiarFormulario();
      await cargar();
    } catch {
      setError("No se pudo guardar la ubicación.");
    } finally {
      setGuardando(false);
    }
  }

  function editar(ubicacion: Ubicacion) {
    setEditandoId(ubicacion.id);

    setForm({
      nombre: ubicacion.nombre,
      lat: String(ubicacion.lat),
      lng: String(ubicacion.lng),
      radioM: String(ubicacion.radioM),
    });

    setMsg("");
    setError("");
    setGpsMsg("");

    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  }

  async function toggle(ubicacion: Ubicacion) {
    setMsg("");
    setError("");

    try {
      const res = await fetch(
        `/api/empresas/${slug}/rrhh/ubicaciones-marcaje`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            action: "toggle",
            id: ubicacion.id,
            activa: !ubicacion.activa,
          }),
        },
      );

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "No se pudo actualizar la ubicación.");
        return;
      }

      setMsg(data.mensaje || "Ubicación actualizada.");
      await cargar();
    } catch {
      setError("No se pudo actualizar la ubicación.");
    }
  }

  const input =
    "mt-1 w-full rounded border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">
          Ubicaciones de marcaje
        </h1>

        <p className="text-sm text-[var(--muted)]">
          Administra los predios donde los colaboradores pueden realizar
          marcajes mediante GPS.{" "}
          <Link
            href={`/e/${slug}/dashboard-rrhh`}
            className="text-[var(--accent)] underline"
          >
            Dashboard
          </Link>
        </p>
      </div>

      <form
        onSubmit={guardar}
        className="grid gap-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 sm:grid-cols-2"
      >
        <div className="sm:col-span-2">
          <h2 className="font-medium">
            {editandoId == null
              ? "Nueva ubicación"
              : "Editar ubicación"}
          </h2>
        </div>

        <label className="text-sm text-[var(--muted)] sm:col-span-2">
          Nombre
          <input
            className={input}
            maxLength={100}
            placeholder="Ej. Sede principal, Bodega zona 12..."
            value={form.nombre}
            onChange={(e) =>
              setForm({
                ...form,
                nombre: e.target.value,
              })
            }
            required
          />
        </label>

        <label className="text-sm text-[var(--muted)]">
          Latitud
          <input
            className={input}
            type="number"
            step="0.0000001"
            min="-90"
            max="90"
            value={form.lat}
            onChange={(e) =>
              setForm({
                ...form,
                lat: e.target.value,
              })
            }
            required
          />
        </label>

        <label className="text-sm text-[var(--muted)]">
          Longitud
          <input
            className={input}
            type="number"
            step="0.0000001"
            min="-180"
            max="180"
            value={form.lng}
            onChange={(e) =>
              setForm({
                ...form,
                lng: e.target.value,
              })
            }
            required
          />
        </label>

        <label className="text-sm text-[var(--muted)]">
          Radio permitido (metros)
          <input
            className={input}
            type="number"
            min="30"
            max="5000"
            step="1"
            value={form.radioM}
            onChange={(e) =>
              setForm({
                ...form,
                radioM: e.target.value,
              })
            }
            required
          />
        </label>

        <div className="flex items-end">
          <button
            type="button"
            onClick={detectarUbicacion}
            className="w-full rounded bg-[#0ea5e9] px-3 py-2 text-sm font-medium text-white"
          >
            Detectar mi ubicación
          </button>
        </div>

        {gpsMsg ? (
          <p className="text-xs text-sky-200 sm:col-span-2">
            {gpsMsg}
          </p>
        ) : null}

        {form.lng &&
        Number(form.lng) > 0 &&
        Number(form.lng) < 100 ? (
          <p className="text-xs text-amber-300 sm:col-span-2">
            La longitud parece positiva. En Guatemala normalmente será
            negativa.
          </p>
        ) : null}

        <div className="flex gap-2 sm:col-span-2">
          <button
            disabled={guardando}
            className="rounded bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            {guardando
              ? "Guardando..."
              : editandoId == null
                ? "Agregar ubicación"
                : "Guardar cambios"}
          </button>

          {editandoId != null ? (
            <button
              type="button"
              onClick={limpiarFormulario}
              className="rounded border border-[var(--border)] px-4 py-2 text-sm"
            >
              Cancelar
            </button>
          ) : null}
        </div>
      </form>

      {msg ? (
        <p className="text-sm text-emerald-300">{msg}</p>
      ) : null}

      {error ? (
        <p className="text-sm text-red-300">{error}</p>
      ) : null}

      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-medium">
            Ubicaciones registradas
          </h2>
          <p className="text-xs text-[var(--muted)]">
            Solo las ubicaciones activas participan en la validación
            del marcaje.
          </p>
        </div>

        {cargando ? (
          <p className="text-sm text-[var(--muted)]">
            Cargando...
          </p>
        ) : ubicaciones.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-sm text-[var(--muted)]">
            Esta empresa todavía no tiene ubicaciones de marcaje.
          </div>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {ubicaciones.map((ubicacion) => (
              <div
                key={ubicacion.id}
                className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h3 className="font-medium">
                      {ubicacion.nombre}
                    </h3>

                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {ubicacion.lat.toFixed(7)},{" "}
                      {ubicacion.lng.toFixed(7)}
                    </p>

                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Radio: {ubicacion.radioM} m
                    </p>
                  </div>

                  <span
                    className={
                      ubicacion.activa
                        ? "rounded-full bg-emerald-950 px-2 py-1 text-xs text-emerald-300"
                        : "rounded-full bg-zinc-800 px-2 py-1 text-xs text-zinc-300"
                    }
                  >
                    {ubicacion.activa ? "Activa" : "Inactiva"}
                  </span>
                </div>

                <div className="mt-4 flex gap-3">
                  <button
                    type="button"
                    onClick={() => editar(ubicacion)}
                    className="text-sm text-[var(--accent)] underline"
                  >
                    Editar
                  </button>

                  <button
                    type="button"
                    onClick={() => void toggle(ubicacion)}
                    className="text-sm text-[var(--accent-2)] underline"
                  >
                    {ubicacion.activa
                      ? "Desactivar"
                      : "Activar"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}