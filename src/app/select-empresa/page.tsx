"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Empresa = {
  id: number;
  codigo: string;
  nombre: string;
  slug: string;
  modulos: string[];
};

export default function SelectEmpresaPage() {
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
      setUser(data.user);
      setEmpresas(data.empresas ?? []);
      if (data.empresas?.length === 1) {
        const sel = await fetch("/api/auth/select-empresa", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ empresaId: data.empresas[0].id }),
        });
        const selData = await sel.json();
        if (sel.ok) router.push(selData.redirect);
      }
    })();
  }, [router]);

  async function elegir(id: number) {
    setError("");
    const res = await fetch("/api/auth/select-empresa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ empresaId: id }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.error ?? "Error");
      return;
    }
    router.push(data.redirect);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <main className="mx-auto max-w-4xl px-4 py-12">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold">Seleccionar empresa</h1>
          <p className="mt-1 text-[var(--muted)]">
            {user
              ? `${user.username} · ${user.rol}`
              : "Cargando…"}
          </p>
          <p className="mt-2 text-sm text-[var(--muted)]">
            RRHH y Contabilidad pueden operar cualquiera de las 5 empresas.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void logout()}
          className="rounded-lg bg-[#5C2525] px-3 py-2 text-sm"
        >
          Salir
        </button>
      </div>

      {error ? <p className="mb-4 text-red-300">{error}</p> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        {empresas.map((e) => (
          <button
            key={e.id}
            type="button"
            onClick={() => void elegir(e.id)}
            className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5 text-left transition hover:border-[var(--accent)] hover:bg-[#172234]"
          >
            <p className="text-xs uppercase tracking-wider text-[var(--muted)]">
              {e.codigo}
            </p>
            <h2 className="mt-1 text-xl font-medium">{e.nombre}</h2>
            <p className="mt-2 text-xs text-[var(--muted)]">
              Módulos: {(e.modulos || []).join(", ") || "—"}
            </p>
          </button>
        ))}
      </div>
    </main>
  );
}
