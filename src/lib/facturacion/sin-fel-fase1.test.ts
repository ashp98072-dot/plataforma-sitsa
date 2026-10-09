import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * FACT-2 — prueba de ARQUITECTURA: el flujo viaje cerrado → borrador de factura NO emite FEL.
 * Revisa el CÓDIGO FUENTE (sin comentarios) del flujo y exige que no importe ni llame al certificador
 * (INFILE), a la SAT, ni use credenciales/llaves FEL, y que no haga HTTP hacia afuera.
 *
 * Alcance: los archivos del flujo de borradores. NO incluye `cuestionario.ts` ni `facturacion-client.tsx`
 * (son los cuestionarios de configuración, que mencionan «FEL» solo como texto de preguntas).
 */

const RAIZ = process.cwd();

const ARCHIVOS_FLUJO = [
  "src/lib/facturacion/facturas.ts",
  "src/lib/facturacion/borrador-calculo.ts",
  "src/lib/facturacion/impuestos.ts",
  "src/lib/facturacion/ui-logica.ts",
  "src/components/facturacion/viajes-pendientes-panel.tsx",
  "src/components/facturacion/factura-borrador-form.tsx",
  "src/components/facturacion/facturas-panel.tsx",
];

function archivosRuta(dir: string): string[] {
  return readdirSync(dir).flatMap((nombre) => {
    const ruta = join(dir, nombre);
    if (statSync(ruta).isDirectory()) return archivosRuta(ruta);
    return /\.ts$/.test(nombre) && !/\.test\.ts$/.test(nombre) ? [ruta] : [];
  });
}

function fuentes(): { archivo: string; codigo: string }[] {
  const rutasApi = archivosRuta(join(RAIZ, "src/app/api/empresas/[slug]/facturacion")).filter((f) => {
    // Configuración de la empresa y requisitos de clientes: cuestionarios, fuera del flujo de borradores.
    const rel = relative(RAIZ, f).replace(/\\/g, "/");
    return !rel.includes("/facturacion/empresa/") && !rel.includes("/facturacion/clientes/");
  });
  const todos = [...ARCHIVOS_FLUJO.map((a) => join(RAIZ, a)), ...rutasApi];
  return todos.map((ruta) => ({ archivo: relative(RAIZ, ruta).replace(/\\/g, "/"), codigo: sinComentarios(readFileSync(ruta, "utf8")) }));
}

/** Quita los comentarios de línea y de bloque (pueden explicar «sin FEL»; solo importa el código). */
function sinComentarios(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

describe("Fase 1 NO usa FEL: ni INFILE, ni SAT, ni credenciales, ni HTTP externo", () => {
  const archivos = fuentes();

  it("hay archivos que revisar (la prueba no es vacía)", () => {
    expect(archivos.length).toBeGreaterThanOrEqual(12);
    expect(archivos.some((a) => a.archivo === "src/lib/facturacion/facturas.ts")).toBe(true);
    expect(archivos.some((a) => a.archivo.endsWith("facturas/preview/route.ts"))).toBe(true);
  });

  it("nada importa un módulo de FEL / INFILE / certificación / SAT", () => {
    for (const { archivo, codigo } of archivos) {
      const imports = [...codigo.matchAll(/(?:import|from)\s+["']([^"']+)["']/g)].map((m) => m[1]);
      for (const spec of imports) {
        expect(spec, `${archivo} importa ${spec}`).not.toMatch(/infile|(^|[/_-])fel([/_.-]|$)|certific|(^|[/_-])sat([/_.-]|$)|dte/i);
      }
    }
  });

  it("ningún código menciona al certificador, la SAT, el DTE, UUID/serie FEL, XML certificado ni llaves/credenciales FEL", () => {
    const prohibido = /infile|certificador|certificad[oa]|certificaci[oó]n|\bsat\b|\bdte\b|\bfel\b|xml_certificado|firma_electr|llave_(firma|certificaci)|alias_fel|\buuid\b|authorization:|apikey|api_key/i;
    for (const { archivo, codigo } of archivos) {
      const hallazgo = codigo.match(prohibido);
      expect(hallazgo?.[0], `${archivo} contiene «${hallazgo?.[0]}»`).toBeUndefined();
    }
  });

  it("ningún código lee variables de entorno ni secretos", () => {
    for (const { archivo, codigo } of archivos) {
      expect(codigo, archivo).not.toMatch(/process\.env/);
    }
  });

  it("no hay URLs absolutas ni librerías de red: el único fetch es hacia la propia API interna (/api/empresas/…)", () => {
    for (const { archivo, codigo } of archivos) {
      expect(codigo, `${archivo} tiene una URL absoluta`).not.toMatch(/https?:\/\//i);
      expect(codigo, archivo).not.toMatch(/\baxios\b|\bnode-fetch\b|\bundici\b|node:https?|from\s+["']https?["']|XMLHttpRequest|WebSocket/);
      for (const m of codigo.matchAll(/\bfetch\(\s*([`"'])([^`"']{0,40})/g)) {
        expect(m[2], `${archivo}: fetch fuera de la API interna`).toMatch(/^\/api\/empresas\//);
      }
      // fetch(variable): solo se admite cuando la variable se arma con la API interna en el mismo archivo.
      for (const m of codigo.matchAll(/\bfetch\(\s*([A-Za-z_$][\w$]*)\s*[,)]/g)) {
        expect(codigo, `${archivo}: fetch(${m[1]})`).toMatch(new RegExp(`(const|let)\\s+${m[1]}\\s*=[^;]*\\/api\\/empresas\\/`));
      }
    }
  });

  it("la interfaz no ofrece acciones de FEL: ni «Certificar», ni «Enviar a SAT», ni «Emitir FEL», ni «XML»/«UUID»", () => {
    const ui = archivos.filter((a) => a.archivo.startsWith("src/components/facturacion/"));
    expect(ui.length).toBe(3);
    for (const { archivo, codigo } of ui) {
      expect(codigo, archivo).not.toMatch(/Certificar|Enviar a SAT|Emitir FEL|\bXML\b|\bUUID\b/i);
    }
  });

  it("el modelo del borrador (SQL propuesto) no agrega columnas de FEL", () => {
    const sql = readFileSync(join(RAIZ, "sql/migrate-2026-10-fact-2-borrador-snapshots-iva.sql"), "utf8");
    const columnas = [...sql.matchAll(/ADD COLUMN IF NOT EXISTS\s+(\w+)/g)].map((m) => m[1]);
    expect(columnas.length).toBeGreaterThan(10);
    for (const c of columnas) expect(c).not.toMatch(/uuid|serie|dte|xml|certific|autoriz|firma/i);
  });
});
