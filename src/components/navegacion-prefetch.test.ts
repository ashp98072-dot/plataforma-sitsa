import { readFileSync } from "node:fs";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ prefetch, ...props }: { prefetch?: boolean }) => createElement("a", { ...props, "data-prefetch": String(prefetch) }),
  useLinkStatus: () => ({ pending: false }),
}));
import { ShellNavLink } from "./shell-nav-link";
import { TmsQuickLinks } from "./tms/centro-logistico-resumen";

const source = (path: string) => readFileSync(path, "utf8");
describe("navegación bajo demanda", () => {
  it("sidebar conserva href/click cliente y elimina todos los disparadores de prefetch", () => {
    const navegar = vi.fn();
    const link = ShellNavLink({ href: "/e/a/rrhh/vacaciones", children: "Vacaciones", onNavigate: navegar }) as ReactElement<{
      href: string; prefetch: boolean; onClick: () => void; onMouseEnter?: unknown; onFocus?: unknown; onTouchStart?: unknown;
    }>;
    expect(link.props.href).toBe("/e/a/rrhh/vacaciones");
    expect(link.props.prefetch).toBe(false);
    expect(link.props.onMouseEnter).toBeUndefined();
    expect(link.props.onFocus).toBeUndefined();
    expect(link.props.onTouchStart).toBeUndefined();
    link.props.onClick();
    expect(navegar).toHaveBeenCalledOnce();
    expect(source("src/components/shell-nav-link.tsx")).not.toMatch(/router\.prefetch|schedulePrefetch|setTimeout/);
    expect(renderToStaticMarkup(link)).toContain('href="/e/a/rrhh/vacaciones"');
  });
  it("grupos cerrados no montan enlaces y conserva permisos y estructura", () => {
    const shell = source("src/components/app-shell.tsx");
    expect(shell).toContain('useState<Record<string, boolean>>({})');
    expect(shell).toMatch(/\{open \? \([\s\S]*?gr\.links\.map[\s\S]*?<ShellNavLink[\s\S]*?\) : null\}/);
    expect(shell).toContain('tienePermisoBase(permisos, "compras_requerimientos")');
    expect(shell).toContain('tienePermisoBase(permisos, "compras_proveedores")');
    expect(shell).not.toMatch(/router\.prefetch|<Link\b/);
  });
  it.each([
    ["src/app/e/[slug]/rrhh/page.tsx", "href={c.href}"],
    ["src/app/e/[slug]/reportes/page.tsx", "href={`/e/${slug}/reportes/${reporte.ruta}`}"],
    ["src/components/tms/centro-logistico-resumen.tsx", "href={`/e/${slug}/${acceso.ruta}`}"],
    ["src/components/notificaciones-bell.tsx", "href={n.enlace}"],
  ])("menú masivo %s conserva ruta sin precarga", (path, href) => {
    const opening = source(path).split("<Link").find(part => part.split(">", 1)[0].includes(href))?.split(">", 1)[0];
    expect(opening).toContain("prefetch={false}");
  });
  it("los 5 accesos logísticos conservan rutas y ningún prefetch", () => {
    const html = renderToStaticMarkup(createElement(TmsQuickLinks, { slug: "a" }));
    expect(html.match(/data-prefetch="false"/g)).toHaveLength(5);
    for (const route of ["programacion", "planes", "viaticos", "clientes", "portales-proveedores"]) expect(html).toContain(`href="/e/a/${route}"`);
  });
  it("activity impide validación GET durante POST y conserva throttle/validación de sesión", () => {
    const guard = source("src/components/session-inactivity-guard.tsx");
    expect(guard).toContain("validationInFlight.current || activityInFlight.current || loggingOut.current");
    expect(guard).toContain("shouldSendActivityPing(lastPing, now)");
    expect(guard).toContain("if (response.status === 401) return void logout()");
    expect(guard).toContain('cache: "no-store"');
  });
});
