import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: vi.fn(), useRouter: vi.fn() }));

import { cerrarSesion, inicialesUsuario, opcionesMenuCuenta } from "./account-menu";

/**
 * MENÚ DE CUENTA — opciones y salida (funciones puras) + guardas sobre el CÓDIGO FUENTE del menú y del sidebar (el
 * proyecto no tiene @testing-library/react; mismo criterio que app-shell-operaciones.test.ts).
 */
const menu = readFileSync(new URL("./account-menu.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("./app-shell.tsx", import.meta.url), "utf8");
const claves = (dominio: boolean) => opcionesMenuCuenta("kuiqtrans", dominio).map((o) => o.key);

describe("opciones del menú de cuenta", () => {
  it("Mi firma apunta a la ruta existente /e/[slug]/mi-firma", () => {
    expect(opcionesMenuCuenta("kuiqtrans", false).find((o) => o.key === "firma")).toMatchObject({ label: "Mi firma", href: "/e/kuiqtrans/mi-firma" });
  });
  it("Cambiar contraseña apunta a /e/[slug]/cambiar-password", () => {
    expect(opcionesMenuCuenta("kuiqtrans", false).find((o) => o.key === "password")).toMatchObject({ href: "/e/kuiqtrans/cambiar-password" });
  });
  it("Cambiar empresa aparece SOLO fuera de dominio de empresa (!dominioEmpresa) y apunta a /select-empresa", () => {
    expect(claves(false)).toEqual(["firma", "password", "empresa", "salir"]);
    expect(opcionesMenuCuenta("x", false).find((o) => o.key === "empresa")).toMatchObject({ href: "/select-empresa" });
  });
  it("Cambiar empresa se oculta en dominio de empresa", () => {
    expect(claves(true)).toEqual(["firma", "password", "salir"]);
  });
  it("Salir es la última opción y va marcada como acción peligrosa", () => {
    expect(opcionesMenuCuenta("x", true).at(-1)).toEqual({ key: "salir", label: "Salir", peligro: true });
    expect(menu).toContain("text-[var(--danger)]");
  });
  it("Salir usa el endpoint actual (POST /api/auth/logout) y luego /login", async () => {
    const fetchFn = vi.fn(async () => new Response("{}"));
    const irA = vi.fn();
    await cerrarSesion(fetchFn as unknown as typeof fetch, irA);
    expect(fetchFn).toHaveBeenCalledWith("/api/auth/logout", { method: "POST" });
    expect(irA).toHaveBeenCalledWith("/login");
    expect(menu).toContain("void cerrarSesion(fetch, (ruta) => router.push(ruta))");
  });
  it("iniciales del avatar", () => {
    expect(inicialesUsuario("walter")).toBe("W");
    expect(inicialesUsuario("  ")).toBe("?");
  });
});

describe("account-menu.tsx — contenido y accesibilidad", () => {
  it("muestra username, rol (labelRol) y empresa activa", () => {
    expect(menu).toContain("{username}</p>");
    expect(menu).toContain("{labelRol(rol)}");
    expect(menu).toContain("Empresa activa:");
    expect(menu).toContain("{empresaNombre}");
  });
  it("botón con aria-haspopup/aria-expanded; menú role=menu con menuitems", () => {
    expect(menu).toContain('aria-haspopup="menu"');
    expect(menu).toContain("aria-expanded={abierto}");
    expect(menu).toContain('role="menu"');
    expect(menu).toContain('role="menuitem"');
  });
  it("cerrado por defecto; se cierra con Escape, clic fuera, al elegir opción y al navegar", () => {
    expect(menu).toContain("const [abierto, setAbierto] = useState(false);");
    expect(menu).toContain('e.key === "Escape"');
    expect(menu).toContain('document.addEventListener("mousedown", alPulsar)');
    expect(menu).toContain("onClick={() => cerrar()}");
    expect(menu).toMatch(/setAbierto\(false\), 0\);[\s\S]{0,80}\}, \[pathname\]\);/);
  });
  it("navegación por teclado (flechas/Home/End) sin librería de dropdown", () => {
    expect(menu).toContain('"ArrowDown"');
    expect(menu).toContain('"Home"');
    const imports = menu.match(/^import .+ from "(.+)";$/gm) ?? [];
    expect(imports.every((l) => /"(next\/link|next\/navigation|react|@\/lib\/permisos-shared)"/.test(l))).toBe(true);
  });
  it("en móvil solo el icono (el nombre se oculta bajo sm)", () => {
    expect(menu).toContain('className="hidden max-w-[10rem] truncate text-sm sm:inline">{username}</span>');
  });
});

describe("app-shell.tsx — sidebar más limpio y menú en el header", () => {
  it("el sidebar ya no contiene los botones antiguos Mi firma / Cambiar empresa / Salir ni su logout", () => {
    expect(shell).not.toContain("/mi-firma");
    expect(shell).not.toContain('href="/select-empresa"');
    expect(shell).not.toMatch(/>\s*Salir\s*</);
    expect(shell).not.toContain("/api/auth/logout");
    expect(shell).not.toContain("bg-[var(--danger)]");
  });
  it("el header monta AccountMenu después de notificaciones y tema, con la regla de dominioEmpresa", () => {
    const header = shell.slice(shell.indexOf("<header"), shell.indexOf("</header>"));
    expect(header.indexOf("<NotificacionesBell")).toBeLessThan(header.indexOf("<ThemeToggle"));
    expect(header.indexOf("<ThemeToggle")).toBeLessThan(header.indexOf("<AccountMenu"));
    expect(header).toContain("dominioEmpresa={dominioEmpresa}");
  });
  it("se conservan empresa activa, usuario/rol, navegación y footer", () => {
    expect(shell).toContain("{empresaNombre}");
    expect(shell).toContain("{username} · {labelRol(rol)}");
    expect(shell).toContain("<nav ");
    expect(shell).toContain("Empresa: {empresaNombre} · Usuario: {username}");
  });
});
