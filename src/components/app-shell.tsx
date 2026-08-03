"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { mapaDominios } from "@/lib/dominios";
import { MODULO_LABEL, type Modulo } from "@/lib/roles";

type Props = {
  slug: string;
  empresaNombre: string;
  username: string;
  rol: string;
  modulos: Modulo[];
  children: React.ReactNode;
};

export function AppShell({
  slug,
  empresaNombre,
  username,
  rol,
  modulos,
  children,
}: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const base = `/e/${slug}`;
  const [dominioEmpresa, setDominioEmpresa] = useState(false);

  useEffect(() => {
    const host = window.location.hostname.toLowerCase();
    setDominioEmpresa(Boolean(mapaDominios()[host]));
  }, []);

  type NavLink = { href: string; label: string; key: string };

  const homeRrhh = dominioEmpresa ? "/dashboard-rrhh" : `${base}/dashboard-rrhh`;
  const homeOps = dominioEmpresa
    ? "/dashboard-operaciones"
    : `${base}/dashboard-operaciones`;

  const links: NavLink[] = [];

  if (rol === "RRHH" || rol === "Admin") {
    links.push({ href: homeRrhh, label: "Dashboard RRHH", key: "dash-rrhh" });
  }
  if (
    rol === "Operaciones" ||
    rol === "CoordinadorPredios" ||
    rol === "Admin"
  ) {
    links.push({
      href: homeOps,
      label: "Dashboard Operaciones",
      key: "dash-ops",
    });
  }
  if (!links.length) {
    links.push({ href: `${base}/dashboard`, label: "Dashboard", key: "gerencia" });
  }

  if (modulos.includes("rrhh")) {
    links.push(
      {
        href: dominioEmpresa ? "/personal" : `${base}/rrhh/empleados`,
        label: "Personal",
        key: "rrhh-emp",
      },
      {
        href: dominioEmpresa ? "/marcajes" : `${base}/rrhh/marcajes`,
        label: "Marcajes",
        key: "rrhh-mar",
      },
      {
        href: dominioEmpresa ? "/vacaciones" : `${base}/rrhh/vacaciones`,
        label: "Vacaciones",
        key: "rrhh-vac",
      },
    );
  }

  for (const m of modulos) {
    if (m === "gerencia" || m === "rrhh") continue;
    links.push({
      href: `${base}/${m}`,
      label: MODULO_LABEL[m] ?? m,
      key: m,
    });
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <div className="min-h-screen md:grid md:grid-cols-[240px_1fr]">
      <aside className="border-b border-[var(--border)] bg-[#0d1522] md:min-h-screen md:border-b-0 md:border-r">
        <div className="p-4">
          <p className="text-xs uppercase tracking-wider text-[var(--muted)]">
            SITSA
          </p>
          <h1 className="mt-1 text-lg font-semibold leading-tight">
            {empresaNombre}
          </h1>
          <p className="mt-1 text-xs text-[var(--muted)]">
            {username} · {rol}
          </p>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-2 pb-3 md:flex-col md:overflow-visible">
          {links.map((l) => {
            const active =
              pathname === l.href || pathname.startsWith(l.href + "/");
            return (
              <Link
                key={l.key}
                href={l.href}
                className={[
                  "whitespace-nowrap rounded-lg px-3 py-2 text-sm",
                  active
                    ? "bg-[var(--accent)] text-white"
                    : "text-[var(--muted)] hover:bg-white/5 hover:text-white",
                ].join(" ")}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="space-y-2 border-t border-[var(--border)] p-3">
          {!dominioEmpresa ? (
            <Link
              href="/select-empresa"
              className="block rounded-lg bg-[#1e293b] px-3 py-2 text-center text-sm"
            >
              Cambiar empresa
            </Link>
          ) : null}
          <button
            type="button"
            onClick={() => void logout()}
            className="w-full rounded-lg bg-[#5C2525] px-3 py-2 text-sm"
          >
            Salir
          </button>
        </div>
      </aside>
      <main className="p-4 md:p-6">{children}</main>
      <footer className="fixed bottom-0 left-0 right-0 border-t border-[var(--border)] bg-[#0d1522]/90 px-3 py-1 text-xs text-[var(--muted)] backdrop-blur md:left-[240px]">
        Empresa: {empresaNombre} · Usuario: {username}
      </footer>
    </div>
  );
}
