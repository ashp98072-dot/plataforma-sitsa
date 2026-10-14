"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { NovalvionIcono } from "@/components/novalvion-brand";
import { cerrarSesion, seleccionarEmpresa, salidaStaffSolicitada } from "@/lib/session-navigation";

type Empresa = { id: number; codigo: string; nombre: string; slug: string; modulos: string[] };
type Props = { empresas: Empresa[]; user: { username: string; rol: string } };

export function SelectEmpresaClient({ empresas, user }: Props) {
  const [error, setError] = useState("");
  const [pendiente, setPendiente] = useState<number | "salir" | null>(null);
  // Ref síncrono: dos clics antes del siguiente render tampoco duplican el POST.
  const enCurso = useRef<number | "salir" | null>(null);
  const automaticoIntentado = useRef(false);

  const elegir = useCallback(async (id: number) => {
    if (enCurso.current !== null) return;
    enCurso.current = id;
    setPendiente(id);
    setError("");
    try {
      const res = await seleccionarEmpresa(fetch, id);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "No se pudo seleccionar la empresa.");
      if (typeof data.redirect !== "string" || !data.redirect.startsWith("/e/")) throw new Error("Respuesta de selección inválida.");
      if (salidaStaffSolicitada()) throw new Error("La sesión se está cerrando.");
      // Límite de tenant: documento nuevo, sin reutilizar payloads privados del Router Cache anterior.
      window.location.replace(data.redirect);
    } catch (e) {
      enCurso.current = null;
      setPendiente(null);
      setError(e instanceof Error ? e.message : "No se pudo seleccionar la empresa. Intenta nuevamente.");
    }
  }, []);

  useEffect(() => {
    if (empresas.length !== 1 || automaticoIntentado.current) return;
    automaticoIntentado.current = true;
    void elegir(empresas[0].id);
  }, [empresas, elegir]);

  async function logout() {
    if (enCurso.current !== null) return;
    enCurso.current = "salir";
    setPendiente("salir");
    setError("");
    try { await cerrarSesion(fetch, (ruta) => window.location.replace(ruta)); }
    catch {
      enCurso.current = null;
      setPendiente(null);
      setError("No se pudo cerrar sesión. Intenta nuevamente.");
    }
  }

  const hint = user.rol === "RRHH"
    ? "Elige la empresa para abrir su panel de Recursos Humanos (personal, vacaciones, marcajes)."
    : user.rol === "Contabilidad" ? "Elige la empresa para abrir Contabilidad." : "Elige la empresa con la que vas a trabajar.";

  return (
    <main className="mx-auto max-w-4xl px-4 py-12" aria-busy={pendiente !== null}>
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <div className="mb-3 flex items-center gap-2">
            <NovalvionIcono className="h-7 w-7" />
            <p className="text-lg font-semibold tracking-wide">Novalvion</p>
          </div>
          <h1 className="text-3xl font-semibold">Seleccionar empresa</h1>
          <p className="mt-1 text-[var(--muted)]">{user.username} · {user.rol}</p>
          <p className="mt-2 text-sm text-[var(--muted)]">{hint}</p>
        </div>
        <button type="button" onClick={() => void logout()} disabled={pendiente !== null} className="rounded-lg bg-[#5C2525] px-3 py-2 text-sm disabled:opacity-60">
          {pendiente === "salir" ? "Saliendo…" : "Salir"}
        </button>
      </div>
      {error ? <p role="alert" className="mb-4 text-red-300">{error}</p> : null}
      {pendiente !== null ? <p role="status" className="mb-4">{pendiente === "salir" ? "Saliendo…" : "Cargando empresa…"}</p> : null}
      <div className="grid gap-4 sm:grid-cols-2">
        {empresas.map(e => (
          <button key={e.id} type="button" onClick={() => void elegir(e.id)} disabled={pendiente !== null}
            className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 text-left transition hover:border-[var(--accent)] hover:bg-[var(--nav-hover)] disabled:opacity-60">
            <p className="text-xs uppercase tracking-wider text-[var(--muted)]">{e.codigo}</p>
            <h2 className="mt-1 text-xl font-medium">{e.nombre}</h2>
            <p className="mt-2 text-xs text-[var(--muted)]">Módulos: {(e.modulos || []).join(", ") || "—"}</p>
          </button>
        ))}
      </div>
    </main>
  );
}
