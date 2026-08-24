"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export default function PortalLoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/portal/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Error");
      const solicitado = new URLSearchParams(window.location.search).get("next");
      const retornoSeguro = solicitado?.startsWith("/portal/") && !solicitado.startsWith("//")
        ? solicitado
        : null;
      if (data.redirect === "/portal/cambiar-password" && retornoSeguro) {
        window.sessionStorage.setItem("portal_next", retornoSeguro);
      }
      router.push(data.redirect === "/portal/cambiar-password" ? data.redirect : retornoSeguro ?? data.redirect ?? "/portal");
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
        <h1 className="mt-2 text-3xl font-semibold">Portal de Colaboradores</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Boletas, vacaciones y datos de tu ingreso
        </p>

        <label className="mt-6 block text-sm text-[var(--muted)]">
          Usuario
          <input
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
            autoFocus
          />
        </label>
        <label className="mt-3 block text-sm text-[var(--muted)]">
          Contraseña
          <input
            type="password"
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--input)] px-3 py-2"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
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
          {loading ? "Ingresando…" : "Ingresar"}
        </button>
      </form>
    </main>
  );
}
