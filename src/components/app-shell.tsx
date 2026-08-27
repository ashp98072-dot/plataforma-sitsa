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
import { ShellNavLink } from "@/components/shell-nav-link";
import { EmpresaSessionProvider } from "@/lib/empresa-session";
import { alcanceFacturacion } from "@/lib/facturacion/alcance";
import { puedeUsarPortalesProveedores } from "@/lib/proveedores/acceso";
import type { RolGlobal } from "@/lib/roles";

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
  const [sidebarVisible, setSidebarVisible] = useState(true);
  const [navPending, setNavPending] = useState(false);

  useEffect(() => {
    const t = window.setTimeout(() => {
      const host = window.location.hostname.toLowerCase();
      setDominioEmpresa(Boolean(mapaDominios()[host]));
    }, 0);
    return () => window.clearTimeout(t);
  }, []);

  // Cerrar drawer al cambiar de ruta
  useEffect(() => {
    const t = window.setTimeout(() => setMenuOpen(false), 0);
    return () => window.clearTimeout(t);
  }, [pathname]);

  // Quitar indicador al completar (pathname o ?tab= de Flota vía nuevo RSC).
  useEffect(() => {
    const t = window.setTimeout(() => setNavPending(false), 0);
    return () => window.clearTimeout(t);
  }, [pathname, children]);

  // Seguridad: no dejar la barra colgada si la nav se cancela.
  useEffect(() => {
    if (!navPending) return;
    const t = window.setTimeout(() => setNavPending(false), 8000);
    return () => window.clearTimeout(t);
  }, [navPending]);

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
    const opsMods = (["tms", "reciclaje", "tarimas"] as Modulo[]).filter(
      (m) => {
        if (!modulos.includes(m)) return false;
        if (
          !isAdmin &&
          permisos.length > 0 &&
          esPlataformaPermisible(m) &&
          !tienePermiso(permisos, m, "ver")
        ) {
          return false;
        }
        return true;
      },
    );
    // Dashboard Operaciones solo si el usuario tiene algún módulo de ops (no Predios puro).
    if (isAdmin || rol === "Operaciones" || opsMods.length > 0) {
      opsLinks.push({
        href: homeOps,
        label: "Dashboard Operaciones",
        key: "dash-ops",
      });
    }
    // Disponibilidad flota (aditivo): Operaciones / TMS / Flota (no kiosco piloto).
    const puedeDisponibilidad =
      rol !== "Piloto" &&
      (isAdmin ||
        rol === "Operaciones" ||
        opsMods.includes("tms") ||
        (modulos.includes("flota") &&
          (permisos.length === 0 ||
            tienePermiso(permisos, "flota_vehiculos", "ver") ||
            tienePermiso(permisos, "flota_reportes", "ver") ||
            tienePermiso(permisos, "tms", "ver"))));
    if (puedeDisponibilidad) {
      opsLinks.push({
        href: `${base}/disponibilidad`,
        label: "Disponibilidad flota",
        key: "disp-flota",
      });
    }
    // Corrección de matriz de permisos: Programación ya NO depende
    // exclusivamente de "tms" — si el usuario tiene una matriz de
    // permisos configurada, además exige "programacion:ver" explícito
    // (igual que Viáticos exige sus propios permisos más abajo). Sin
    // matriz configurada (permisos.length === 0, legado) se mantiene el
    // criterio anterior, sin regresión.
    const puedeProgramacion =
      rol !== "Piloto" &&
      (isAdmin ||
        rol === "Operaciones" ||
        (opsMods.includes("tms") &&
          (permisos.length === 0 || tienePermiso(permisos, "programacion", "ver"))));
    if (puedeProgramacion) {
      opsLinks.push({
        href: `${base}/programacion`,
        label: "Programación",
        key: "programacion",
      });
    }
    // Viáticos (VIAT-3): módulo propio, visible con CUALQUIERA de los tres
    // permisos de viáticos (viaticos/viaticos_autorizar/viaticos_pagar) —
    // "viaticos" no es un Modulo de empresa/rol (roles.ts), es un permiso
    // de acción dentro de TMS, por eso se checa aparte de opsMods.
    const puedeViaticos =
      rol !== "Piloto" &&
      modulos.includes("tms") &&
      (isAdmin ||
        permisos.length === 0 ||
        tienePermiso(permisos, "viaticos", "ver") ||
        tienePermiso(permisos, "viaticos_autorizar", "ver") ||
        tienePermiso(permisos, "viaticos_pagar", "ver"));
    if (puedeViaticos) {
      opsLinks.push({
        href: `${base}/viaticos`,
        label: "Viáticos",
        key: "viaticos",
      });
    }
    // Rutas (VIAT-4 / OPS-5.2a): catálogo maestro de rutas/servicios por
    // cliente. Ya NO depende únicamente de la audiencia gruesa de TMS —
    // si el usuario tiene una matriz de permisos configurada, exige
    // "rutas:ver" O "tms:ver" explícito (compatibilidad histórica: quien
    // hoy edita rutas vía tms:editar sigue viendo el link, ver
    // requireTenantRutas en tenant.ts). Sin matriz configurada
    // (permisos.length === 0, legado) se mantiene el criterio anterior.
    // A diferencia de Programación arriba, NO se conserva el bypass
    // incondicional `rol === "Operaciones"` — si la matriz de un usuario
    // Operaciones niega explícitamente rutas Y tms, el link se oculta:
    // la matriz fina es la autoridad real, nunca el rol por sí solo.
    const puedeRutas =
      rol !== "Piloto" &&
      (isAdmin ||
        (opsMods.includes("tms") &&
          (permisos.length === 0 ||
            tienePermiso(permisos, "rutas", "ver") ||
            tienePermiso(permisos, "tms", "ver"))));
    if (puedeRutas) {
      opsLinks.push({
        href: `${base}/rutas`,
        label: "Rutas",
        key: "rutas",
      });
    }
    // Multas y sanciones (MULTAS-2/3): permiso propio "multas", exige TMS
    // habilitado (requireTenantMultas). Mismo criterio que Rutas arriba —
    // SOLO permisos efectivos, nunca un bypass por rol (sección 21 del
    // ticket lo pide explícito: "Usar permiso multas:ver. NO usar rol.").
    const puedeMultas =
      rol !== "Piloto" &&
      opsMods.includes("tms") &&
      (isAdmin || permisos.length === 0 || tienePermiso(permisos, "multas", "ver"));
    if (puedeMultas) {
      opsLinks.push({
        href: `${base}/operaciones/multas`,
        label: "Multas y sanciones",
        key: "multas",
      });
    }
    if (puedeUsarPortalesProveedores(rol as RolGlobal)) {
      opsLinks.push({
        href: `${base}/portales-proveedores`,
        label: "Accesos proveedores",
        key: "portales-proveedores",
      });
    }
    const alcanceFact = alcanceFacturacion(rol);
    const puedeVerFact =
      isAdmin ||
      permisos.length === 0 ||
      tienePermiso(permisos, "facturacion", "ver");
    // Operaciones: facturación por cliente (también Admin, aparte de Conta).
    if (
      modulos.includes("facturacion") &&
      puedeVerFact &&
      alcanceFact.verClientes
    ) {
      opsLinks.push({
        href: `${base}/facturacion?vista=clientes`,
        label: "Facturación clientes",
        key: "fact-cli",
      });
    }
    for (const m of opsMods) {
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

    const clientesLinks: NavLink[] = [];
    if (modulos.includes("clientes")) {
      if (
        isAdmin ||
        permisos.length === 0 ||
        tienePermiso(permisos, "clientes", "ver")
      ) {
        clientesLinks.push({
          href: `${base}/clientes`,
          label: MODULO_LABEL.clientes,
          key: "clientes",
        });
      }
    }
    if (clientesLinks.length) {
      g.push({
        id: "clientes",
        label: "Clientes",
        icon: <IconUsers />,
        links: clientesLinks,
      });
    }

    const contaLinks: NavLink[] = [];
    // Contabilidad (y Admin): facturación de la empresa.
    if (
      modulos.includes("facturacion") &&
      puedeVerFact &&
      alcanceFact.verEmpresa
    ) {
      contaLinks.push({
        href: `${base}/facturacion?vista=empresa`,
        label: "Facturación empresa",
        key: "facturacion",
      });
    }
    if (modulos.includes("contabilidad")) {
      if (
        isAdmin ||
        permisos.length === 0 ||
        tienePermiso(permisos, "contabilidad", "ver")
      ) {
        contaLinks.push({
          href: `${base}/contabilidad`,
          label: MODULO_LABEL.contabilidad,
          key: "contabilidad",
        });
      }
    }
    if (contaLinks.length) {
      g.push({
        id: "contabilidad",
        label: "Contabilidad",
        icon: <IconConta />,
        links: contaLinks,
      });
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
    const t = window.setTimeout(() => {
      setAbiertos((prev) =>
        prev[activo.id] ? prev : { ...prev, [activo.id]: true },
      );
    }, 0);
    return () => window.clearTimeout(t);
  }, [pathname, groups]);

  function toggle(id: string) {
    setAbiertos((prev) => ({ ...prev, [id]: !prev[id] }));
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  return (
    <EmpresaSessionProvider
      rol={rol}
      permisos={permisos ?? []}
      empresaNombre={empresaNombre}
      username={username}
    >
    <div
      className={[
        "min-h-screen max-w-full overflow-x-hidden md:grid",
        sidebarVisible
          ? "md:grid-cols-[260px_minmax(0,1fr)]"
          : "md:grid-cols-[0_minmax(0,1fr)]",
      ].join(" ")}
    >
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
          // Altura de viewport + sticky en desktop: la lista puede hacer scroll.
          "fixed inset-y-0 left-0 z-50 flex h-dvh max-h-dvh w-[min(100vw-3rem,280px)] overflow-hidden border-r border-[var(--border)] bg-[var(--sidebar)] transition-all duration-200 ease-out md:sticky md:top-0 md:z-auto md:h-screen md:max-h-screen",
          menuOpen ? "translate-x-0" : "-translate-x-full",
          sidebarVisible
            ? "md:w-[260px] md:translate-x-0 md:opacity-100"
            : "md:pointer-events-none md:w-0 md:-translate-x-full md:border-r-0 md:opacity-0",
        ].join(" ")}
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 p-4">
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

          <nav className="min-h-0 flex-1 space-y-1 overflow-y-auto overscroll-contain px-2 pb-3 [scrollbar-gutter:stable]">
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
                          <ShellNavLink
                            key={l.key}
                            href={l.href}
                            onNavigate={() => {
                              setMenuOpen(false);
                              if (!active) setNavPending(true);
                            }}
                            className={[
                              "rounded-md px-2.5 py-1.5 text-sm",
                              active
                                ? "bg-[var(--accent)] text-white"
                                : "text-[var(--muted)] hover:bg-[var(--nav-hover)] hover:text-[var(--nav-text-strong)]",
                            ].join(" ")}
                          >
                            {l.label}
                          </ShellNavLink>
                        );
                      })}
                    </div>
                  ) : null}
                </div>
              );
            })}
          </nav>

          <div className="shrink-0 space-y-2 border-t border-[var(--border)] p-3">
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
        </div>
      </aside>

      <div className="relative flex min-w-0 max-w-full flex-col overflow-x-hidden pb-8 md:pb-7">
        {navPending ? (
          <div
            className="pointer-events-none absolute inset-x-0 top-0 z-40 h-0.5 overflow-hidden bg-[var(--border)]"
            aria-hidden
          >
            <div className="h-full w-full origin-left animate-pulse bg-[var(--accent)]" />
          </div>
        ) : null}
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-[var(--border)] bg-[var(--sidebar)] px-3 py-2 md:justify-end md:px-6">
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-2 text-[var(--text)] md:hidden"
            onClick={() => setMenuOpen(true)}
            aria-label="Abrir menú"
          >
            <IconMenu />
          </button>
          <button
            type="button"
            className="hidden rounded-lg border border-[var(--border)] bg-[var(--card)] p-2 text-[var(--text)] md:inline-flex"
            onClick={() => setSidebarVisible((visible) => !visible)}
            aria-label={sidebarVisible ? "Ocultar menú lateral" : "Mostrar menú lateral"}
            title={sidebarVisible ? "Ocultar menú lateral" : "Mostrar menú lateral"}
            aria-expanded={sidebarVisible}
          >
            <IconMenu />
          </button>
          <div className="hidden min-w-0 flex-1 md:block" />
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
        <main
          className={[
            "min-w-0 max-w-full flex-1 overflow-x-hidden p-3 transition-opacity duration-150 sm:p-4 md:p-6",
            navPending ? "opacity-70" : "opacity-100",
          ].join(" ")}
        >
          {children}
        </main>
      </div>
      <footer
        className={[
          "fixed bottom-0 left-0 right-0 z-20 border-t border-[var(--border)] bg-[var(--sidebar)] px-3 py-1 text-[10px] text-[var(--muted)] transition-[left] duration-200 md:text-xs",
          sidebarVisible ? "md:left-[260px]" : "md:left-0",
        ].join(" ")}
      >
        Empresa: {empresaNombre} · Usuario: {username}
      </footer>
    </div>
    </EmpresaSessionProvider>
  );
}
