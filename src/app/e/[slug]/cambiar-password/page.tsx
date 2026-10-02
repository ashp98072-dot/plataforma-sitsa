"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { PASSWORD_MIN, validarCambioPassword } from "@/lib/cambio-password";

/**
 * MENÚ DE CUENTA — "Cambiar contraseña" del usuario interno autenticado (cualquier rol, como Mi firma). Vive bajo
 * /e/[slug]/ por conveniencia de sesión; la contraseña es global por usuario. El servidor identifica al usuario por la
 * sesión, vuelve a validar y, si el cambio procede, cierra la sesión actual: se redirige a /login.
 */
const REDIRECCION_MS = 1800;

export default function CambiarPasswordPage() {
  const router = useRouter();
  const [passwordActual, setPasswordActual] = useState("");
  const [passwordNueva, setPasswordNueva] = useState("");
  const [confirmarPassword, setConfirmarPassword] = useState("");
  const [error, setError] = useState("");
  const [exito, setExito] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);

  useEffect(() => {
    if (!exito) return;
    const t = window.setTimeout(() => router.replace("/login"), REDIRECCION_MS);
    return () => window.clearTimeout(t);
  }, [exito, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (enviandoRef.current || exito) return;
    const datos = { passwordActual, passwordNueva, confirmarPassword };
    const previo = validarCambioPassword(datos);
    if (previo) {
      setError(previo);
      return;
    }
    enviandoRef.current = true;
    setEnviando(true);
    setError("");
    try {
      const res = await fetch("/api/auth/cambiar-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(datos),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "No se pudo cambiar la contraseña.");
        return;
      }
      setPasswordActual("");
      setPasswordNueva("");
      setConfirmarPassword("");
      setExito(true);
    } catch {
      setError("Error de conexión. Intenta de nuevo.");
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  }

  const campo = "mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2 text-sm";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Cambiar contraseña</h1>
        <p className="text-sm text-[var(--muted)]">
          Al guardar se cerrará tu sesión y deberás ingresar de nuevo con la nueva contraseña.
        </p>
      </div>

      {exito ? (
        <p role="status" className="max-w-md rounded-lg border border-emerald-700/60 bg-emerald-900/20 px-4 py-3 text-sm text-emerald-300">
          Contraseña actualizada. Tu sesión se cerró; te llevamos al inicio de sesión…
        </p>
      ) : (
        <form onSubmit={onSubmit} noValidate className="max-w-md space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
          <label className="block text-sm text-[var(--muted)]">
            Contraseña actual
            <input
              type="password"
              autoComplete="current-password"
              className={campo}
              value={passwordActual}
              onChange={(e) => setPasswordActual(e.target.value)}
              required
              autoFocus
            />
          </label>
          <label className="block text-sm text-[var(--muted)]">
            Nueva contraseña
            <input
              type="password"
              autoComplete="new-password"
              className={campo}
              value={passwordNueva}
              onChange={(e) => setPasswordNueva(e.target.value)}
              required
              minLength={PASSWORD_MIN}
              aria-describedby="password-politica"
            />
          </label>
          <p id="password-politica" className="text-xs text-[var(--muted)]">
            Mínimo {PASSWORD_MIN} caracteres y distinta a la actual.
          </p>
          <label className="block text-sm text-[var(--muted)]">
            Confirmar nueva contraseña
            <input
              type="password"
              autoComplete="new-password"
              className={campo}
              value={confirmarPassword}
              onChange={(e) => setConfirmarPassword(e.target.value)}
              required
              minLength={PASSWORD_MIN}
            />
          </label>

          {error ? (
            <p role="alert" className="text-sm text-rose-300">
              {error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={enviando}
            className="w-full rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {enviando ? "Guardando…" : "Cambiar contraseña"}
          </button>
        </form>
      )}
    </div>
  );
}
