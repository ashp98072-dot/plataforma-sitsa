"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { mapaDominios } from "@/lib/dominios";
import {
  FLOTA_NAV,
  RRHH_NAV,
  esPlataformaPermisible,
  labelRol,
  tienePermiso,
  type PermisoModulo,
} from "@/lib/permisos-shared";
import { MODULO_LABEL, type Modulo } from "@/lib/roles";
import { NotificacionesBell } from "@/components/notificaciones-bell";
import { ThemeToggle } from "@/components/theme-toggle";

type Props = {
  slug: string;
  empresaNombre: string;
  username: string;
  rol: string;
  modulos: Modulo[];
  permisos?: PermisoModulo[];
  children: React.ReactNode;
};

type NavLink = { href: string; label: string; key: string };

type NavGroup = {
  id: string;
  label: string;
  icon: React.ReactNode;
  links: NavLink[];
};

function IconChevron({ open }: { open: boolean }) {
  return (
    <svg
      viewBox="0 0 20 20"
      className={[
        "h-3.5 w-3.5 shrink-0 transition-transform",
        open ? "rotate-90" : "",
      ].join(" ")}
      fill="currentColor"
      aria-hidden
    >
      <path d="M7 5l6 5-6 5V5z" />
    </svg>
  );
}

function IconUsers() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="3" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a3 3 0 0 1 0 5.74" />
    </svg>
  );
}

function IconOps() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <path d="M3 7h13l5 5v5H3V7z" />
      <circle cx="7.5" cy="17.5" r="1.5" />
      <circle cx="17.5" cy="17.5" r="1.5" />
    </svg>
  );
}

function IconFlota() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="3" y="10" width="18" height="8" rx="1.5" />
      <path d="M5 10V7h8l4 3" />
      <circle cx="7.5" cy="18" r="1.5" />
      <circle cx="16.5" cy="18" r="1.5" />
    </svg>
  );
}

function IconConta() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  );
}

function IconWeb() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18" />
    </svg>
  );
}

function IconAdmin() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  );
}

function IconMenu() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M4 7h16M4 12h16M4 17h16" />
    </svg>
  );
}

function IconClose() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

function linkActive(pathname: string, href: string) {
  const pathOnly = href.split("?")[0];
  if (pathname === pathOnly) return true;
  if (pathOnly !== "/" && pathname.startsWith(pathOnly + "/")) return true;
  return false;
}

export function AppShell({
  slug,
  empresaNombre,
  username,
  rol,
  modulos,
  permisos = [],
  children,
}: Props) {
  const pathname = usePathname();
  const router = useRouter();
  const base = `/e/${slug}`;
  const [dominioEmpresa, setDominioEmpresa] = useState(false);
  const [abiertos, setAbiertos] = useState<Record<string, boolean>>({});
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    const host = window.location.hostname.toLowerCase();
    setDominioEmpresa(Boolean(mapaDominios()[host]));
  }, []);

  // Cerrar drawer al navegar (móvil)
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  // Evitar scroll del body con el menú abierto
  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  const isAdmin = rol === "Admin";
  const homeRrhh = dominioEmpresa ? "/dashboard-rrhh" : `${base}/dashboard-rrhh`;
  const homeOps = dominioEmpresa
    ? "/dashboard-operaciones"
    : `${base}/dashboard-operaciones`;

  const groups = useMemo(() => {
    const g: NavGroup[] = [];

    const rrhhLinks: NavLink[] = [];
    if (rol === "RRHH" || isAdmin || modulos.includes("rrhh")) {
      if (rol === "RRHH" || isAdmin) {
        rrhhLinks.push({
          href: homeRrhh,
          label: "Dashboard RRHH",
          key: "dash-rrhh",
        });
      }
      if (modulos.includes("rrhh")) {
        for (const item of RRHH_NAV) {
          if (
            !isAdmin &&
            permisos.length > 0 &&
            !tienePermiso(permisos, item.sub, "ver")
          ) {
            continue;
          }
          rrhhLinks.push({
            href: dominioEmpresa
              ? `/${item.path === "empleados" ? "personal" : item.path === "configuracion" ? "configuracion-rrhh" : item.path}`
              : `${base}/rrhh/${item.path}`,
            label: item.label,
            key: `rrhh-${item.sub}`,
          });
        }
      }
    }
    if (rrhhLinks.length) {
      g.push({
        id: "rrhh",
        label: "RRHH",
        icon: <IconUsers />,
        links: rrhhLinks,
      });
    }

    const opsLinks: NavLink[] = [];
    if (
      rol === "Operaciones" ||
      rol === "CoordinadorPredios" ||
      isAdmin
    ) {
      opsLinks.push({
        href: homeOps,
        label: "Dashboard Operaciones",
        key: "dash-ops",
      });
    }
    for (const m of ["tms", "reciclaje", "tarimas"] as Modulo[]) {
      if (!modulos.includes(m)) continue;
      if (
        !isAdmin &&
        permisos.length > 0 &&
        esPlataformaPermisible(m) &&
        !tienePermiso(permisos, m, "ver")
      ) {
        continue;
      }
      opsLinks.push({
        href: `${base}/${m}`,
        label: MODULO_LABEL[m] ?? m,
        key: m,
      });
    }
    if (opsLinks.length) {
      g.push({
        id: "operaciones",
        label: "Operaciones",
        icon: <IconOps />,
        links: opsLinks,
      });
    }

    const flotaLinks: NavLink[] = [];
    if (modulos.includes("flota")) {
      // Piloto: ir directo a registrar viaje
      if (rol === "Piloto") {
        flotaLinks.push({
          href: `${base}/flota?tab=piloto`,
          label: "Registrar viaje",
          key: "flota-piloto",
        });
      } else {
        flotaLinks.push({
          href: `${base}/flota`,
          label: "Dashboard flota",
          key: "flota-home",
        });
        for (const item of FLOTA_NAV) {
          if (
            !isAdmin &&
            permisos.length > 0 &&
            !tienePermiso(permisos, item.sub, "ver")
          ) {
            continue;
          }
          flotaLinks.push({
            href: `${base}/flota?tab=${item.path}`,
            label: item.label,
            key: `flota-${item.path}`,
          });
        }
      }
    }
    if (flotaLinks.length) {
      g.push({
        id: "flota",
        label: "Flota / Predios",
        icon: <IconFlota />,
        links: flotaLinks,
      });
    }

    if (modulos.includes("contabilidad")) {
      if (
        isAdmin ||
        permisos.length === 0 ||
        tienePermiso(permisos, "contabilidad", "ver")
      ) {
        g.push({
          id: "contabilidad",
          label: "Contabilidad",
          icon: <IconConta />,
          links: [
            {
              href: `${base}/contabilidad`,
              label: MODULO_LABEL.contabilidad,
              key: "contabilidad",
            },
          ],
        });
      }
    }

    if (modulos.includes("cms")) {
      if (
        isAdmin ||
        permisos.length === 0 ||
        tienePermiso(permisos, "cms", "ver")
      ) {
        g.push({
          id: "cms",
          label: "Sitio Web",
          icon: <IconWeb />,
          links: [
            { href: `${base}/cms`, label: MODULO_LABEL.cms, key: "cms" },
          ],
        });
      }
    }

    if (isAdmin && modulos.includes("usuarios")) {
      g.push({
        id: "admin",
        label: "Administración",
        icon: <IconAdmin />,
        links: [
          { href: `${base}/usuarios`, label: "Usuarios", key: "usuarios" },
          {
            href: `${base}/admin/limpiar`,
            label: "Limpiar módulo",
            key: "limpiar",
          },
          { href: `${base}/dashboard`, label: "Gerencia", key: "gerencia" },
        ],
      });
    } else if (
      !g.length ||
      (modulos.includes("gerencia") &&
        !isAdmin &&
        rol !== "RRHH" &&
        rol !== "Operaciones" &&
        rol !== "CoordinadorPredios")
    ) {
      g.push({
        id: "gerencia",
        label: "Inicio",
        icon: <IconAdmin />,
        links: [
          { href: `${base}/dashboard`, label: "Dashboard", key: "gerencia" },
        ],
      });
    }

    return g;
  }, [
    base,
    dominioEmpresa,
    homeOps,
    homeRrhh,
    isAdmin,
    modulos,
    permisos,
    rol,
  ]);

  // Abrir el grupo activo automáticamente
  useEffect(() => {
    const activo = groups.find((gr) =>
      gr.links.some((l) => linkActive(pathname, l.href)),
    );
    if (!activo) return;
    setAbiertos((prev) =>
      prev[activo.id] ? prev : { ...prev, [activo.id]: true },
    );
  }, [pathname, groups]);

  function toggle(id: string) {
    setAbiertos((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  const nav = (
    <>
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-wider text-[var(--muted)]">
              SITSA
            </p>
            <h1 className="mt-1 text-lg font-semibold leading-tight">
              {empresaNombre}
            </h1>
            <p className="mt-1 text-xs text-[var(--muted)]">
              {username} · {labelRol(rol)}
            </p>
          </div>
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] p-2 text-[var(--muted)] md:hidden"
            onClick={() => setMenuOpen(false)}
            aria-label="Cerrar menú"
          >
            <IconClose />
          </button>
        </div>
      </div>

      <nav className="space-y-1 px-2 pb-3">
        {groups.map((gr) => {
          const open = Boolean(abiertos[gr.id]);
          const groupActive = gr.links.some((l) =>
            linkActive(pathname, l.href),
          );
          return (
            <div key={gr.id} className="rounded-lg">
              <button
                type="button"
                onClick={() => toggle(gr.id)}
                className={[
                  "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm font-medium",
                  groupActive
                    ? "bg-[var(--nav-active)] text-[var(--nav-text-strong)]"
                    : "text-[var(--muted)] hover:bg-[var(--nav-hover)] hover:text-[var(--nav-text-strong)]",
                ].join(" ")}
              >
                <IconChevron open={open} />
                <span className="text-[var(--accent-2)]">{gr.icon}</span>
                <span className="flex-1">{gr.label}</span>
                <span className="text-[10px] text-[var(--muted)]">
                  {gr.links.length}
                </span>
              </button>
              {open ? (
                <div className="ml-3 mt-0.5 space-y-0.5 border-l border-[var(--border)] pl-2">
                  {gr.links.map((l) => {
                    const active = linkActive(pathname, l.href);
                    return (
                      <Link
                        key={l.key}
                        href={l.href}
                        prefetch={false}
                        onClick={() => setMenuOpen(false)}
                        className={[
                          "block rounded-md px-2.5 py-1.5 text-sm",
                          active
                            ? "bg-[var(--accent)] text-white"
                            : "text-[var(--muted)] hover:bg-[var(--nav-hover)] hover:text-[var(--nav-text-strong)]",
                        ].join(" ")}
                      >
                        {l.label}
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>

      <div className="mt-auto space-y-2 border-t border-[var(--border)] p-3">
        {!dominioEmpresa ? (
          <Link
            href="/select-empresa"
            prefetch={false}
            onClick={() => setMenuOpen(false)}
            className="block rounded-lg bg-[var(--panel)] px-3 py-2 text-center text-sm"
          >
            Cambiar empresa
          </Link>
        ) : null}
        <button
          type="button"
          onClick={() => void logout()}
          className="w-full rounded-lg bg-[var(--danger)] px-3 py-2 text-sm text-white"
        >
          Salir
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen md:grid md:grid-cols-[260px_1fr]">
      {menuOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-black/40 md:hidden"
          aria-label="Cerrar menú"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <aside
        className={[
          "fixed inset-y-0 left-0 z-50 flex w-[min(100vw-3rem,280px)] flex-col border-r border-[var(--border)] bg-[var(--sidebar)] transition-transform duration-150 ease-out md:static md:z-auto md:w-auto md:translate-x-0 md:transition-none",
          menuOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        ].join(" ")}
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain">
          {nav}
        </div>
      </aside>

      <div className="flex min-w-0 flex-col pb-8 md:pb-7">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-[var(--border)] bg-[var(--sidebar)] px-3 py-2 md:justify-end md:px-6">
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-2 text-[var(--text)] md:hidden"
            onClick={() => setMenuOpen(true)}
            aria-label="Abrir menú"
          >
            <IconMenu />
          </button>
          <div className="min-w-0 flex-1 md:hidden">
            <p className="truncate text-sm font-semibold leading-tight">
              {empresaNombre}
            </p>
            <p className="truncate text-[11px] text-[var(--muted)]">
              {username} · {labelRol(rol)}
            </p>
          </div>
          <NotificacionesBell slug={slug} rol={rol} />
          <ThemeToggle />
        </header>
        <main className="flex-1 p-3 sm:p-4 md:p-6">{children}</main>
      </div>
      <footer className="fixed bottom-0 left-0 right-0 z-20 border-t border-[var(--border)] bg-[var(--sidebar)] px-3 py-1 text-[10px] text-[var(--muted)] md:left-[260px] md:text-xs">
        Empresa: {empresaNombre} · Usuario: {username}
      </footer>
    </div>
  );
}
