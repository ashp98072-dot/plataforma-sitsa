"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function ClientePortalCambiarPasswordPage() {
  const router = useRouter();
  const [passwordActual, setPasswordActual] = useState("");
  const [passwordNueva, setPasswordNueva] = useState("");
  const [confirmar, setConfirmar] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (passwordNueva !== confirmar) {
      setError("Las contraseñas nuevas no coinciden.");
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/cliente-portal/auth/cambiar-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passwordActual, passwordNueva }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      const solicitado = window.sessionStorage.getItem("cliente_portal_next");
      window.sessionStorage.removeItem("cliente_portal_next");
      const retornoSeguro =
        solicitado?.startsWith("/cliente-portal/") && !solicitado.startsWith("//")
          ? solicitado
          : null;
      router.push(retornoSeguro ?? data.redirect ?? "/cliente-portal");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center p-4">
      <form
        onSubmit={onSubmit}
        className="w-full max-w-md rounded-2xl border border-[var(--border)] bg-[var(--card)] p-8 shadow-2xl"
      >
        <p className="text-sm uppercase tracking-[0.2em] text-[var(--muted)]">
          Grupo SITSA
        </p>
        <h1 className="mt-2 text-3xl font-semibold">Cambia tu contraseña</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Es tu primer ingreso al portal (o te la reiniciaron). Antes de
          continuar, define una contraseña nueva.
        </p>

        <label className="mt-6 block text-sm text-[var(--muted)]">
          Contraseña actual
          <input
            type="password"
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2"
            value={passwordActual}
            onChange={(e) => setPasswordActual(e.target.value)}
            required
            autoFocus
          />
        </label>
        <label className="mt-3 block text-sm text-[var(--muted)]">
          Contraseña nueva
          <input
            type="password"
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2"
            value={passwordNueva}
            onChange={(e) => setPasswordNueva(e.target.value)}
            required
            minLength={6}
          />
        </label>
        <label className="mt-3 block text-sm text-[var(--muted)]">
          Confirmar contraseña nueva
          <input
            type="password"
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2"
            value={confirmar}
            onChange={(e) => setConfirmar(e.target.value)}
            required
            minLength={6}
          />
        </label>

        {error ? (
          <p className="mt-3 text-sm text-red-300" role="alert">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={loading}
          className="mt-6 w-full rounded-lg bg-[var(--accent)] px-4 py-2.5 font-medium text-white hover:brightness-110 disabled:opacity-50"
        >
          {loading ? "Guardando…" : "Cambiar contraseña"}
        </button>
      </form>
    </main>
  );
}
