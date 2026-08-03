"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

type Empresa = {
  id: number;
  codigo: string;
  nombre: string;
  slug: string;
};

export default function RrhhCentralPage() {
  const router = useRouter();
  const [empresas, setEmpresas] = useState<Empresa[]>([]);
  const [user, setUser] = useState<{ username: string; rol: string } | null>(
    null,
  );
  const [error, setError] = useState("");

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/auth/me");
      const data = await res.json();
      if (!res.ok) {
        router.push("/login");
        return;
      }
      if (data.user.rol !== "Admin" && data.user.rol !== "RRHH") {
        setError("Solo RRHH / Admin entran al panel central de personal.");
        return;
      }
      setUser(data.user);
      setEmpresas(data.empresas ?? []);
    })();
  }, [router]);

  async function entrar(empresaId: number, destino: "empleados" | "vacaciones" | "marcajes") {
    const res = await fetch("/api/auth/select-empresa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ empresaId, destinoRrhh: destino }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Error");
      return;
    }
    router.push(data.redirect);
  }

  return (
    <main className="mx-auto max-w-5xl px-4 py-10">
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-[var(--muted)]">
            Recursos Humanos
          </p>
          <h1 className="mt-1 text-3xl font-semibold">
            Control de personal (todas las empresas)
          </h1>
          <p className="mt-2 text-sm text-[var(--muted)]">
            Elige la empresa y entra a Personal, Vacaciones o Marcajes. Los
            empleados se registran por empresa; la asistencia usa esa misma base.
          </p>
          {user ? (
            <p className="mt-1 text-xs text-[var(--muted)]">
              {user.username} · {user.rol}
            </p>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Link
            href="/select-empresa"
            className="rounded-lg bg-[#1e293b] px-3 py-2 text-sm"
          >
            Selector general
          </Link>
          <button
            type="button"
            className="rounded-lg bg-[#5C2525] px-3 py-2 text-sm"
            onClick={async () => {
              await fetch("/api/auth/logout", { method: "POST" });
              router.push("/login");
            }}
          >
            Salir
          </button>
        </div>
      </div>

      {error ? <p className="mb-4 text-red-300">{error}</p> : null}

      <div className="grid gap-4">
        {empresas.map((e) => (
          <article
            key={e.id}
            className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5"
          >
            <p className="text-xs uppercase tracking-wider text-[var(--muted)]">
              {e.codigo}
            </p>
            <h2 className="mt-1 text-xl font-medium">{e.nombre}</h2>
            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void entrar(e.id, "empleados")}
                className="rounded-lg bg-[var(--accent)] px-3 py-2 text-sm text-white"
              >
                Personal / Empleados
              </button>
              <button
                type="button"
                onClick={() => void entrar(e.id, "vacaciones")}
                className="rounded-lg bg-[#0d9488] px-3 py-2 text-sm text-white"
              >
                Vacaciones
              </button>
              <button
                type="button"
                onClick={() => void entrar(e.id, "marcajes")}
                className="rounded-lg bg-[#334155] px-3 py-2 text-sm"
              >
                Marcajes
              </button>
            </div>
          </article>
        ))}
      </div>
    </main>
  );
}
