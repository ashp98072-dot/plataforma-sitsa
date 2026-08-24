"use client";

import { useCallback, useEffect, useState } from "react";

type Credencial = {
  id: number;
  empleadoId: number;
  username: string;
  activo: boolean;
  debeCambiarPassword: boolean;
  ultimoAcceso: string | null;
  creadoEn: string;
};

type Props = {
  slug: string;
  empleadoId: number;
  empleadoNombre: string;
  onClose: () => void;
  onChanged?: () => void;
};

function sugerirUsername(nombre: string): string {
  return nombre
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .join(".")
    .replace(/[^a-z0-9.]/g, "");
}

export function PortalAccesoModal({
  slug,
  empleadoId,
  empleadoNombre,
  onClose,
  onChanged,
}: Props) {
  const [credencial, setCredencial] = useState<Credencial | null>(null);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState("");
  const [mensaje, setMensaje] = useState("");
  const [enviando, setEnviando] = useState(false);

  // Formulario para crear acceso por primera vez.
  const [username, setUsername] = useState(() => sugerirUsername(empleadoNombre));
  const [passwordInicial, setPasswordInicial] = useState("");

  // Formulario para resetear contraseña (cuando ya tiene acceso).
  const [passwordNueva, setPasswordNueva] = useState("");
  const [mostrarReset, setMostrarReset] = useState(false);
  const [mostrarUsername, setMostrarUsername] = useState(false);
  const [usernameNuevo, setUsernameNuevo] = useState("");

  const cargar = useCallback(async () => {
    setCargando(true);
    setError("");
    try {
      const res = await fetch(
        `/api/empresas/${slug}/rrhh/empleados/${empleadoId}/portal-acceso`,
      );
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error al consultar el acceso.");
      const actual = (data.credencial ?? null) as Credencial | null;
      setCredencial(actual);
      if (actual) setUsernameNuevo(actual.username);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Error al consultar el acceso.");
    } finally {
      setCargando(false);
    }
  }, [slug, empleadoId]);

  useEffect(() => {
    // La carga es asíncrona y sincroniza este modal con la credencial remota.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void cargar();
  }, [cargar]);

  async function crearAcceso() {
    setError("");
    setMensaje("");
    setEnviando(true);
    try {
      const res = await fetch(
        `/api/empresas/${slug}/rrhh/empleados/${empleadoId}/portal-acceso`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username, passwordInicial }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo crear el acceso.");
        return;
      }
      setMensaje(data.mensaje ?? "Acceso al portal creado.");
      setPasswordInicial("");
      await cargar();
      onChanged?.();
    } catch {
      setError("Error de red al crear el acceso.");
    } finally {
      setEnviando(false);
    }
  }

  async function resetearPassword() {
    setError("");
    setMensaje("");
    setEnviando(true);
    try {
      const res = await fetch(
        `/api/empresas/${slug}/rrhh/empleados/${empleadoId}/portal-acceso`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accion: "resetear", passwordNueva }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo reiniciar la contraseña.");
        return;
      }
      setMensaje(data.mensaje ?? "Contraseña reiniciada.");
      setPasswordNueva("");
      setMostrarReset(false);
      await cargar();
      onChanged?.();
    } catch {
      setError("Error de red al reiniciar la contraseña.");
    } finally {
      setEnviando(false);
    }
  }

  async function alternarActivo(activo: boolean) {
    setError("");
    setMensaje("");
    setEnviando(true);
    try {
      const res = await fetch(
        `/api/empresas/${slug}/rrhh/empleados/${empleadoId}/portal-acceso`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accion: "activar", activo }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo actualizar el acceso.");
        return;
      }
      setMensaje(data.mensaje ?? "Acceso actualizado.");
      await cargar();
      onChanged?.();
    } catch {
      setError("Error de red al actualizar el acceso.");
    } finally {
      setEnviando(false);
    }
  }

  async function cambiarUsername() {
    setError("");
    setMensaje("");
    setEnviando(true);
    try {
      const res = await fetch(
        `/api/empresas/${slug}/rrhh/empleados/${empleadoId}/portal-acceso`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ accion: "cambiar-username", username: usernameNuevo }),
        },
      );
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "No se pudo cambiar el usuario.");
        return;
      }
      setMensaje(data.mensaje ?? "Nombre de usuario actualizado.");
      setMostrarUsername(false);
      await cargar();
      onChanged?.();
    } catch {
      setError("Error de red al cambiar el usuario.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold">Acceso al portal</h3>
            <p className="text-sm text-[var(--muted)]">{empleadoNombre}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md bg-[#37474F] px-3 py-1 text-sm text-white"
          >
            Cerrar
          </button>
        </div>

        {error ? <p className="mt-2 text-sm text-[#f0a0a0]">{error}</p> : null}
        {mensaje ? <p className="mt-2 text-sm text-[#8fd4a0]">{mensaje}</p> : null}

        {cargando ? (
          <p className="mt-4 text-sm text-[var(--muted)]">Cargando…</p>
        ) : credencial ? (
          <div className="mt-4 space-y-3">
            <div className="rounded-lg border border-[var(--border)] p-3 text-sm">
              <p>
                Usuario: <span className="font-medium">{credencial.username}</span>
              </p>
              <p className="mt-1 text-[var(--muted)]">
                Estado:{" "}
                <span className={credencial.activo ? "text-[#8fd4a0]" : "text-[#f0a0a0]"}>
                  {credencial.activo ? "Activo" : "Desactivado"}
                </span>
              </p>
              <p className="mt-1 text-[var(--muted)]">
                Último acceso:{" "}
                {credencial.ultimoAcceso
                  ? new Date(credencial.ultimoAcceso).toLocaleString()
                  : "nunca"}
              </p>
              {credencial.debeCambiarPassword ? (
                <p className="mt-1 text-xs text-[var(--muted)]">
                  Debe cambiar su contraseña en el próximo ingreso.
                </p>
              ) : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={enviando}
                onClick={() => setMostrarUsername((v) => !v)}
                className="rounded-md bg-[#455A64] px-3 py-2 text-sm text-white disabled:opacity-40"
              >
                Cambiar usuario
              </button>
              <button
                type="button"
                disabled={enviando}
                onClick={() => setMostrarReset((v) => !v)}
                className="rounded-md bg-[var(--accent)] px-3 py-2 text-sm text-white disabled:opacity-40"
              >
                Reiniciar contraseña
              </button>
              <button
                type="button"
                disabled={enviando}
                onClick={() => void alternarActivo(!credencial.activo)}
                className={`rounded-md px-3 py-2 text-sm text-white disabled:opacity-40 ${
                  credencial.activo ? "bg-[#8B0000]" : "bg-[#1F6AA5]"
                }`}
              >
                {credencial.activo ? "Desactivar acceso" : "Reactivar acceso"}
              </button>
            </div>

            {mostrarUsername ? (
              <div className="space-y-2 rounded-lg border border-[var(--border)] p-3">
                <label className="block text-sm text-[var(--muted)]">
                  Nombre de usuario nuevo
                  <input
                    type="text"
                    autoComplete="off"
                    value={usernameNuevo}
                    onChange={(e) => setUsernameNuevo(e.target.value)}
                    className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm"
                  />
                </label>
                <button
                  type="button"
                  disabled={
                    enviando ||
                    usernameNuevo.trim().length < 3 ||
                    usernameNuevo.trim() === credencial.username
                  }
                  onClick={() => void cambiarUsername()}
                  className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-40"
                >
                  Guardar usuario nuevo
                </button>
                <p className="text-xs text-[var(--muted)]">
                  La contraseña y el estado del acceso no cambian.
                </p>
              </div>
            ) : null}

            {mostrarReset ? (
              <div className="space-y-2 rounded-lg border border-[var(--border)] p-3">
                <label className="block text-sm text-[var(--muted)]">
                  Contraseña nueva (mínimo 6 caracteres)
                  <input
                    type="text"
                    value={passwordNueva}
                    onChange={(e) => setPasswordNueva(e.target.value)}
                    className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm"
                  />
                </label>
                <button
                  type="button"
                  disabled={enviando || passwordNueva.length < 6}
                  onClick={() => void resetearPassword()}
                  className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-40"
                >
                  Guardar contraseña nueva
                </button>
                <p className="text-xs text-[var(--muted)]">
                  El colaborador deberá cambiarla en su próximo ingreso al portal.
                </p>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="mt-4 space-y-2 rounded-lg border border-[var(--border)] p-3">
            <p className="text-sm text-[var(--muted)]">
              Este empleado todavía no tiene acceso al portal de autogestión.
            </p>
            <label className="block text-sm text-[var(--muted)]">
              Usuario
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm"
              />
            </label>
            <label className="block text-sm text-[var(--muted)]">
              Contraseña inicial (mínimo 6 caracteres)
              <input
                type="text"
                value={passwordInicial}
                onChange={(e) => setPasswordInicial(e.target.value)}
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm"
              />
            </label>
            <button
              type="button"
              disabled={enviando || username.trim().length < 3 || passwordInicial.length < 6}
              onClick={() => void crearAcceso()}
              className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-40"
            >
              Crear acceso al portal
            </button>
            <p className="text-xs text-[var(--muted)]">
              El colaborador deberá cambiar esta contraseña en su primer ingreso.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
