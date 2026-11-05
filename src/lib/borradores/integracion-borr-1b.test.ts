import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { permitirSalidaExplicita, registrarAntesDeSalidaExplicita } from "../session-navigation";

/**
 * BORR-1b — guardas sobre el CÓDIGO FUENTE (el proyecto no tiene @testing-library/react; mismo criterio que
 * account-menu.test.ts): dónde se calcula la identidad, qué rutas de salida limpian y qué NO se tocó.
 */
const leer = (ruta: string) => readFileSync(join(process.cwd(), ruta), "utf8");

const layout = leer("src/app/e/[slug]/layout.tsx");
const shell = leer("src/components/app-shell.tsx");
const provider = leer("src/lib/empresa-session.tsx");
const menu = leer("src/components/account-menu.tsx");
const selector = leer("src/app/select-empresa/select-empresa-client.tsx");
const selectorPagina = leer("src/app/select-empresa/layout.tsx");
const guard = leer("src/components/session-inactivity-guard.tsx");
const navegacion = leer("src/lib/session-navigation.ts");

describe("identidad: se calcula en el SERVIDOR a partir de la sesión y la empresa validada", () => {
  it("el layout deriva el ownerKey del id interno de la sesión (no del username) y usa la empresa ya autorizada", () => {
    expect(layout).toContain("ownerKeyDeUsuario(session.id)");
    expect(layout).not.toMatch(/ownerKeyDeUsuario\(session\.username/);
    expect(layout).toMatch(/empresaId: empresa\.id/);
    expect(layout).toMatch(/empresaSlug: empresa\.slug/);
    // La empresa se valida (redirect) ANTES de construir el contexto.
    expect(layout.indexOf('redirect("/select-empresa")')).toBeLessThan(layout.indexOf("construirContextoBorradores("));
  });

  it("el selector de empresa obtiene el ownerKey en su layout servidor, igual derivado del id de sesión", () => {
    expect(selectorPagina).toContain("ownerKeyDeUsuario(session.id)");
    expect(selectorPagina).toContain("<RegistroSalidaBorradores");
    expect(selector).not.toMatch(/ownerKey|owner-key|prepararSalidaDelNavegador/); // el cliente del selector no recibe ni calcula identidad
    expect(leer("src/app/select-empresa/page.tsx")).not.toMatch(/borradores|ownerKey/i); // la página (y su contrato de props) no cambia
  });

  it("ningún módulo cliente importa owner-key (node:crypto) ni el índice lo exporta", () => {
    expect(leer("src/lib/borradores/index.ts")).not.toMatch(/from\s+["']\.\/owner-key["']/);
    for (const f of [shell, provider, menu, selector]) expect(f).not.toContain("owner-key");
    for (const f of ["contexto", "preferencia", "cierre-sesion", "salida-navegador"]) {
      expect(leer(`src/lib/borradores/${f}.ts`)).not.toMatch(/from\s+["'][^"']*owner-key["']|node:crypto/);
    }
  });

  it("el cliente no genera secretos ni identidades: sin aleatoriedad ni criptografía en el contexto, la preferencia ni la política de salida", () => {
    for (const f of ["contexto", "preferencia", "cierre-sesion", "salida-navegador"]) {
      expect(leer(`src/lib/borradores/${f}.ts`)).not.toMatch(/Math\.random|randomUUID|getRandomValues|crypto\./);
    }
    expect(provider).not.toMatch(/Math\.random|randomUUID|getRandomValues/);
  });

  it("el provider transporta el contexto en un contexto SEPARADO (sin tocar el valor de sesión memoizado por ref), sin JWT ni secretos", () => {
    expect(provider).toContain("createContext<ContextoBorradores | null>(null)");
    expect(provider).toContain("useContext(BorradoresContext)");
    expect(provider).not.toMatch(/AUTH_SECRET|BORRADORES_OWNER_SECRET|token/i);
    // EmpresaSessionValue (rol, permisos, empresaNombre, username) conserva exactamente su forma original.
    const tipo = provider.slice(provider.indexOf("export type EmpresaSessionValue"), provider.indexOf("};", provider.indexOf("export type EmpresaSessionValue")));
    expect(tipo).not.toMatch(/borradores/i);
    expect(tipo).toMatch(/rol: string;[\s\S]*permisos: PermisoModulo\[\];[\s\S]*empresaNombre: string;[\s\S]*username: string;/);
  });
});

describe("cierre de sesión: solo la salida EXPLÍCITA limpia; la expiración no", () => {
  it("menú de cuenta y selector de empresa consultan el gancho ANTES de cerrar sesión y respetan «cancelar»", () => {
    for (const f of [menu, selector]) {
      expect(f).toContain("permitirSalidaExplicita()");
      expect(f.indexOf("permitirSalidaExplicita()")).toBeLessThan(f.indexOf("await cerrarSesion(fetch"));
      expect(f).toMatch(/!\(await permitirSalidaExplicita\(\)\)/);
    }
  });

  it("el gancho lo registra un componente montado en el shell (layout) y en el layout del selector, con el ownerKey del servidor", () => {
    expect(layout).toContain("<RegistroSalidaBorradores ownerKey={borradores?.ownerKey ?? null} />");
    expect(leer("src/components/borradores/registro-salida.tsx")).toContain("registrarAntesDeSalidaExplicita(");
  });

  it("SessionInactivityGuard (expiración/401) NO usa borradores ni el gancho, y cerrarSesion tampoco lo invoca", () => {
    expect(guard).not.toMatch(/borradores|permitirSalidaExplicita|antesDeSalidaExplicita/i);
    const cuerpo = navegacion.slice(navegacion.indexOf("export function cerrarSesion"), navegacion.indexOf("// BORR-1b"));
    expect(cuerpo.length).toBeGreaterThan(200);
    expect(cuerpo).not.toMatch(/permitirSalidaExplicita|antesDeSalidaExplicita|borradores/i);
  });

  it("el logout del servidor no cambia (solo borra la cookie)", () => {
    const logout = leer("src/app/api/auth/logout/route.ts");
    expect(logout).not.toMatch(/borradores/i);
    expect(logout).toContain("clearSessionCookie");
  });

  it("gancho: sin registrar permite salir; registrado puede cancelar; un error del gancho no bloquea; se puede retirar", async () => {
    expect(await permitirSalidaExplicita()).toBe(true);
    const retirar = registrarAntesDeSalidaExplicita(async () => false);
    expect(await permitirSalidaExplicita()).toBe(false);
    retirar();
    expect(await permitirSalidaExplicita()).toBe(true);
    const retirar2 = registrarAntesDeSalidaExplicita(async () => { throw new Error("falla del gancho"); });
    expect(await permitirSalidaExplicita()).toBe(true);
    retirar2();
    // Un retiro tardío de un gancho viejo no quita al nuevo.
    const viejo = registrarAntesDeSalidaExplicita(async () => true);
    const nuevo = registrarAntesDeSalidaExplicita(async () => false);
    viejo();
    expect(await permitirSalidaExplicita()).toBe(false);
    nuevo();
  });
});

describe("ninguna ruta de logout explícito evade la política", () => {
  function archivos(dir: string, acumulado: string[] = []): string[] {
    for (const nombre of readdirSync(join(process.cwd(), dir))) {
      const ruta = `${dir}/${nombre}`;
      if (statSync(join(process.cwd(), ruta)).isDirectory()) archivos(ruta, acumulado);
      else if (/\.(ts|tsx)$/.test(nombre) && !/\.test\.tsx?$/.test(nombre)) acumulado.push(ruta);
    }
    return acumulado;
  }

  it("solo estos módulos de producción cierran la sesión de staff (si aparece otro, esta prueba obliga a revisarlo)", () => {
    const usan = archivos("src").filter((f) => {
      const t = leer(f);
      return /cerrarSesion\(/.test(t) || t.includes("/api/auth/logout") || /endpoints\.logout/.test(t);
    }).sort();
    expect(usan).toEqual([
      "src/components/account-menu.tsx", //             salida explícita → gancho
      "src/components/session-inactivity-guard.tsx", // expiración / 401 → SIN limpieza
      "src/lib/session-activity-client.ts", //          constantes de endpoints
      "src/lib/session-navigation.ts", //               definición de cerrarSesion
      "src/app/select-empresa/select-empresa-client.tsx", // salida explícita → gancho
    ].sort());
  });

  it("las dos salidas explícitas consultan el gancho exactamente una vez y justo antes de cerrar sesión", () => {
    for (const f of [menu, selector]) {
      expect(f.match(/permitirSalidaExplicita\(\)/g)).toHaveLength(1);
      expect(f.match(/await cerrarSesion\(/g)).toHaveLength(1);
    }
    // «Cambiar empresa» (Link / seleccionarEmpresa) no pasa por el gancho ni borra nada.
    expect(menu.slice(menu.indexOf("onNavigate"))).not.toMatch(/permitirSalidaExplicita|borradores/i);
    expect(selector.slice(selector.indexOf("const elegir"), selector.indexOf("async function logout"))).not.toMatch(/permitirSalidaExplicita/);
  });
});

describe("alcance: no se tocaron formularios, endpoints oficiales ni permisos", () => {
  const formularios = [
    "src/app/e/[slug]/fondos/page.tsx",
    "src/app/e/[slug]/gastos/page.tsx",
    "src/components/compras/requerimiento-form-client.tsx",
    "src/app/api/empresas/[slug]/tms/fondos/route.ts",
    "src/app/api/empresas/[slug]/tms/gastos/route.ts",
    "src/app/api/empresas/[slug]/compras/requerimientos/route.ts",
    "src/lib/compras/requerimiento-api.ts",
    "src/lib/tms/fondos.ts",
    "src/lib/tms/gastos.ts",
    "src/lib/compras/requerimientos.ts",
  ];
  it.each(formularios)("%s no usa el núcleo de borradores todavía", (ruta) => {
    expect(leer(ruta)).not.toMatch(/borradores/i);
  });

  it("permisos y autenticación sin cambios: el layout sigue pasando los mismos permisos y ningún módulo de permisos/tenant/sesión conoce los borradores", () => {
    expect(layout).toContain("permisos={permisos}");
    expect(layout).toContain("modulos={finalMods}");
    for (const f of ["src/lib/tenant.ts", "src/lib/permisos.ts", "src/lib/permisos-shared.ts", "src/lib/permisos-catalogo.ts", "src/lib/session.ts", "src/lib/auth-secret.ts", "src/lib/api-guard.ts", "src/middleware.ts"]) {
      expect(leer(f)).not.toMatch(/borradores/i);
    }
  });

  it("AppShell solo reenvía el contexto al provider", () => {
    expect(shell).toContain("borradores={borradores}");
    expect(shell.match(/borradores/g)!.length).toBeLessThanOrEqual(6);
  });
});
