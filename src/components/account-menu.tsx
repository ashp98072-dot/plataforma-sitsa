"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { labelRol } from "@/lib/permisos-shared";

/**
 * MENÚ DE CUENTA — reemplaza los botones sueltos del pie del sidebar (Mi firma / Cambiar empresa / Salir) por un único
 * menú en el header, y agrega "Cambiar contraseña". Dropdown propio (sin librería): cerrado por defecto; se cierra al
 * elegir una opción, al hacer clic fuera, con Escape y al navegar.
 */
export type OpcionMenuCuenta =
  | { key: "firma" | "password" | "empresa"; label: string; href: string }
  | { key: "salir"; label: string; peligro: true };

/** Opciones del menú. "Cambiar empresa" se oculta en dominio de empresa (mismo criterio que tenía el sidebar). */
export function opcionesMenuCuenta(slug: string, dominioEmpresa: boolean): OpcionMenuCuenta[] {
  return [
    { key: "firma", label: "Mi firma", href: `/e/${slug}/mi-firma` },
    { key: "password", label: "Cambiar contraseña", href: `/e/${slug}/cambiar-password` },
    ...(!dominioEmpresa ? [{ key: "empresa" as const, label: "Cambiar empresa", href: "/select-empresa" }] : []),
    { key: "salir", label: "Salir", peligro: true },
  ];
}

/** Misma lógica de salida que tenía el sidebar: POST /api/auth/logout y luego /login. */
export async function cerrarSesion(fetchFn: typeof fetch, irA: (ruta: string) => void): Promise<void> {
  await fetchFn("/api/auth/logout", { method: "POST" });
  irA("/login");
}

export const inicialesUsuario = (username: string) => (username.trim().charAt(0) || "?").toUpperCase();

function IconEngrane() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export function AccountMenu({
  slug,
  empresaNombre,
  username,
  rol,
  dominioEmpresa,
}: {
  slug: string;
  empresaNombre: string;
  username: string;
  rol: string;
  dominioEmpresa: boolean;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [abierto, setAbierto] = useState(false);
  const contenedorRef = useRef<HTMLDivElement>(null);
  const botonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const opciones = opcionesMenuCuenta(slug, dominioEmpresa);

  // Cerrar al navegar.
  useEffect(() => {
    const t = window.setTimeout(() => setAbierto(false), 0);
    return () => window.clearTimeout(t);
  }, [pathname]);

  // Abierto: clic fuera cierra; foco a la primera opción.
  useEffect(() => {
    if (!abierto) return;
    const alPulsar = (e: MouseEvent | TouchEvent) => {
      if (contenedorRef.current && !contenedorRef.current.contains(e.target as Node)) setAbierto(false);
    };
    document.addEventListener("mousedown", alPulsar);
    document.addEventListener("touchstart", alPulsar);
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener("mousedown", alPulsar);
      document.removeEventListener("touchstart", alPulsar);
    };
  }, [abierto]);

  function cerrar(devolverFoco = false) {
    setAbierto(false);
    if (devolverFoco) botonRef.current?.focus();
  }

  function alTeclear(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === "Escape") {
      e.preventDefault();
      cerrar(true);
      return;
    }
    if (e.key === "Tab") {
      setAbierto(false);
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    const items = [...(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    if (!items.length) return;
    e.preventDefault();
    const i = items.indexOf(document.activeElement as HTMLElement);
    const siguiente =
      e.key === "Home" ? 0
        : e.key === "End" ? items.length - 1
          : e.key === "ArrowDown" ? (i + 1) % items.length
            : (i - 1 + items.length) % items.length;
    items[siguiente].focus();
  }

  const item = "block w-full rounded-md px-3 py-2 text-left text-sm hover:bg-[var(--nav-hover)] focus:bg-[var(--nav-hover)] focus:outline-none";

  return (
    <div ref={contenedorRef} className="relative" onKeyDown={abierto ? alTeclear : undefined}>
      <button
        ref={botonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={abierto}
        aria-controls="menu-cuenta"
        aria-label={`Cuenta de ${username}`}
        title="Cuenta y configuración"
        onClick={() => setAbierto((v) => !v)}
        onKeyDown={(e) => {
          if (!abierto && e.key === "ArrowDown") {
            e.preventDefault();
            setAbierto(true);
          }
        }}
        className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] p-2 text-[var(--text)] sm:px-2.5 sm:py-1.5"
      >
        <IconEngrane />
        <span className="hidden max-w-[10rem] truncate text-sm sm:inline">{username}</span>
      </button>

      {abierto ? (
        <div
          id="menu-cuenta"
          ref={menuRef}
          role="menu"
          aria-label="Menú de cuenta"
          className="absolute right-0 top-full z-50 mt-2 w-64 max-w-[calc(100vw-1.5rem)] rounded-xl border border-[var(--border)] bg-[var(--card)] p-1.5 shadow-xl"
        >
          <div className="flex items-start gap-2 border-b border-[var(--border)] px-2.5 pb-2.5 pt-1.5">
            <span aria-hidden className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[var(--accent)] text-sm font-semibold text-white">
              {inicialesUsuario(username)}
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{username}</p>
              <p className="text-xs text-[var(--muted)]">{labelRol(rol)}</p>
              <p className="mt-1 text-[11px] text-[var(--muted)]">Empresa activa:</p>
              <p className="truncate text-xs">{empresaNombre}</p>
            </div>
          </div>
          <div className="pt-1">
            {opciones.map((o) =>
              o.key === "salir" ? (
                <div key={o.key} className="mt-1 border-t border-[var(--border)] pt-1">
                  <button
                    type="button"
                    role="menuitem"
                    className={`${item} text-[var(--danger)]`}
                    onClick={() => {
                      cerrar();
                      void cerrarSesion(fetch, (ruta) => router.push(ruta));
                    }}
                  >
                    {o.label}
                  </button>
                </div>
              ) : (
                <Link key={o.key} href={o.href} prefetch={false} role="menuitem" className={item} onClick={() => cerrar()}>
                  {o.label}
                </Link>
              ),
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
