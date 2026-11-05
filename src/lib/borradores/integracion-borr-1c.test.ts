import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

/**
 * BORR-1c — guardas de ALCANCE sobre el código fuente (el comportamiento está en las pruebas de controlador, coordinación y
 * componentes): el autoguardado todavía NO se conecta a ningún formulario oficial ni a ninguna ruta, no envía nada al servidor,
 * no guarda contenido fuera de IndexedDB y no toca autenticación ni permisos.
 */
const cache = new Map<string, string>();
const leer = (ruta: string) => { let t = cache.get(ruta); if (t === undefined) { t = readFileSync(join(process.cwd(), ruta), "utf8"); cache.set(ruta, t); } return t; }; // el árbol se lee una vez (la suite completa corre en paralelo)
vi.setConfig({ testTimeout: 60_000 });
/** Código sin comentarios: las guardas miran lo que SE EJECUTA, no lo que la documentación menciona. */
const codigo = (ruta: string) => leer(ruta).replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
function archivos(dir: string, acumulado: string[] = []): string[] {
  for (const nombre of readdirSync(join(process.cwd(), dir))) {
    const ruta = `${dir}/${nombre}`;
    if (statSync(join(process.cwd(), ruta)).isDirectory()) archivos(ruta, acumulado);
    else if (/\.(ts|tsx)$/.test(nombre) && !/\.test\.tsx?$/.test(nombre)) acumulado.push(ruta);
  }
  return acumulado;
}
const produccion = archivos("src");

describe("el autoguardado no está instalado en formularios ni rutas (eso es BORR-1d/1e/1f)", () => {
  const OFICIALES = [
    "src/app/e/[slug]/fondos/page.tsx",
    "src/app/e/[slug]/gastos/page.tsx",
    "src/components/compras/requerimiento-form-client.tsx",
    "src/components/compras/lineas-compra-client.tsx",
    "src/components/tms/fondo-lineas-client.tsx",
    "src/components/tms/gastos-listado.tsx",
    "src/app/api/empresas/[slug]/tms/fondos/route.ts",
    "src/app/api/empresas/[slug]/tms/gastos/route.ts",
    "src/app/api/empresas/[slug]/compras/requerimientos/route.ts",
    "src/lib/tms/fondos.ts",
    "src/lib/tms/gastos.ts",
    "src/lib/compras/requerimientos.ts",
  ];
  it.each(OFICIALES)("%s no usa el hook, el controlador ni los componentes de borradores", (ruta) => {
    expect(leer(ruta)).not.toMatch(/borradores|useBorradorLocal|DemoAutoguardado/i);
  });

  it("ningún archivo de producción fuera de lib/borradores y components/borradores usa el hook, el controlador, la demo o los diálogos", () => {
    // BORR-1d: ÚNICA integración autorizada = el componente de autoguardado de Nuevo requerimiento de compra (y su adaptador/puente,
    // que importan tipos del controlador). Fondos (BORR-1e) y Gastos (BORR-1f) siguen sin instalarse.
    const AUTORIZADOS = new Set(["src/components/compras/requerimiento-autoguardado.tsx", "src/lib/compras/requerimiento-borrador.ts", "src/lib/compras/requerimiento-borrador-envio.ts",
      // BORR-1e: Solicitudes de fondo (solo creación).
      "src/components/tms/fondo-autoguardado.tsx", "src/lib/tms/fondo-borrador.ts",
      // BORR-1f: Gastos operativos (solo creación).
      "src/components/tms/gasto-autoguardado.tsx", "src/lib/tms/gasto-borrador.ts"]);
    const ajenos = produccion.filter((f) => !f.startsWith("src/lib/borradores/") && !f.startsWith("src/components/borradores/") && !AUTORIZADOS.has(f));
    const usan = ajenos.filter((f) => /use-borrador-local|borradores\/controlador|demo-autoguardado|dialogo-recuperacion|advertencia-conflicto|indicador-autoguardado|control-persistencia-local/.test(leer(f)));
    expect(usan).toEqual([]);
  });

  it("la demostración solo la importan las pruebas: no hay ninguna ruta (src/app) que la monte", () => {
    const usan = produccion.filter((f) => f !== "src/components/borradores/demo-autoguardado.tsx" && /demo-autoguardado|DemoAutoguardado/.test(leer(f)));
    expect(usan).toEqual([]);
    expect(produccion.filter((f) => f.startsWith("src/app/") && /autoguardado|borrador-local/i.test(f))).toEqual([]);
    expect(leer("src/components/borradores/demo-autoguardado.tsx")).toMatch(/SOLO PRUEBAS Y DEMOSTRACIÓN LOCAL/);
  });

  it("los únicos importadores del hook son la demostración y los autoguardados de Nuevo requerimiento y Nueva solicitud de fondo (BORR-1d/1e)", () => {
    expect(produccion.filter((f) => /use-borrador-local/.test(leer(f))).sort()).toEqual(["src/components/borradores/demo-autoguardado.tsx", "src/components/compras/requerimiento-autoguardado.tsx", "src/components/tms/fondo-autoguardado.tsx", "src/components/tms/gasto-autoguardado.tsx"]); // BORR-1d / 1e / 1f
  });
});

describe("contenido solo en IndexedDB, sin red, sin identidades inventadas", () => {
  const NUCLEO_CLIENTE = ["controlador", "coordinacion", "canal", "use-borrador-local", "etiquetas"].map((f) => `src/lib/borradores/${f}.ts`);
  const UI = ["dialogo-base", "dialogo-recuperacion", "advertencia-conflicto", "advertencia-borrador", "indicador-autoguardado", "control-persistencia-local", "demo-autoguardado"].map((f) => `src/components/borradores/${f}.tsx`);

  it.each([...NUCLEO_CLIENTE, ...UI])("%s no usa localStorage/sessionStorage para el contenido ni red ni beforeunload ni el ownerKey del servidor", (ruta) => {
    const fuente = codigo(ruta);
    expect(fuente).not.toMatch(/sessionStorage|document\.cookie/);
    expect(fuente).not.toMatch(/\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket/);
    expect(fuente).not.toMatch(/beforeunload|unload"/);
    expect(fuente).not.toMatch(/owner-key|node:crypto|AUTH_SECRET|BORRADORES_OWNER_SECRET/);
    expect(fuente).not.toMatch(/localStorage/); // la única lectura de localStorage (preferencia) vive en preferencia.ts
  });

  it("el hook toma la identidad del contexto autenticado y no la inventa", () => {
    const hook = codigo("src/lib/borradores/use-borrador-local.ts");
    expect(hook).toContain("useContextoBorradores()");
    expect(hook).not.toMatch(/ownerKey\s*[:=]\s*["'`]/); // sin valores literales
  });

  it("no se escribe en el almacén fuera del núcleo: el controlador solo usa la API del núcleo (guardar/eliminar/leer…)", () => {
    const c = codigo("src/lib/borradores/controlador.ts");
    expect(c).not.toMatch(/indexedDB|\.transaction\(|objectStore/);
    expect(c).toMatch(/nucleo\.guardar\(/);
  });

  it("la coordinación de salida y el guard de expiración siguen separados: el guard no conoce el autoguardado", () => {
    expect(leer("src/components/session-inactivity-guard.tsx")).not.toMatch(/borradores|suspender|autoguard/i);
    expect(leer("src/lib/session-navigation.ts")).not.toMatch(/suspenderEscrituras|controlador|autoguard/i);
  });

  it("autenticación y permisos intactos", () => {
    for (const f of ["src/lib/tenant.ts", "src/lib/permisos.ts", "src/lib/permisos-shared.ts", "src/lib/permisos-catalogo.ts", "src/lib/session.ts", "src/lib/auth-secret.ts", "src/lib/api-guard.ts", "src/middleware.ts", "src/lib/borradores/owner-key.ts"]) {
      expect(leer(f)).not.toMatch(/ControladorBorrador|useBorradorLocal|coordinacion/);
    }
  });
});
