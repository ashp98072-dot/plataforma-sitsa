import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * El repositorio no renderiza componentes React en las pruebas (entorno node); la lógica del guard y de la clave está
 * probada en clave-envio.test.ts / gastos-envio-cliente.test.ts. Estas pruebas fijan el CABLEADO de las páginas para que
 * una refactorización no retire la protección sin que falle algo.
 */
function fuente(ruta: string): string {
  return readFileSync(join(process.cwd(), ...ruta.split("/")), "utf8").replace(/\r\n/g, "\n");
}

const PAGINAS = [
  { nombre: "Fondos", ruta: "src/app/e/[slug]/fondos/page.tsx", etiqueta: "Crear solicitud" },
  { nombre: "Gastos", ruta: "src/app/e/[slug]/gastos/page.tsx", etiqueta: "Guardar" },
];

describe.each(PAGINAS)("Formulario de $nombre — protección de doble envío", ({ ruta, etiqueta }) => {
  const src = fuente(ruta);

  it("usa el guard síncrono de envío único y el estado de guardado", () => {
    expect(src).toContain('from "@/lib/idempotencia/clave-envio"');
    expect(src).toContain("crearGuardEnvio()");
    expect(src).toMatch(/await guardEnvio\.ejecutar\(/);
    expect(src).toContain("setGuardando(true)");
    // El estado se libera siempre (éxito o error) para rehabilitar el botón.
    expect(src).toMatch(/finally \{\s*setGuardando\(false\);/);
  });

  it("el botón principal se deshabilita mientras guarda y muestra «Guardando…»", () => {
    expect(src).toContain("disabled={guardando}");
    expect(src).toContain('aria-busy={guardando}');
    expect(src).toContain('guardando ? "Guardando…"');
    expect(src).toContain(etiqueta);
  });

  it("genera la clave de envío una vez por registro y la reinicia al cerrar/crear nuevo", () => {
    expect(src).toContain("const claveEnvioRef = useRef<string | null>(null)");
    expect(src).toContain("claveEnvioRef.current ??= nuevaClaveEnvio()");
    expect(src).toMatch(/claveEnvioRef\.current = null;/);
  });

  it("no hay una segunda vía de envío: el único disparador de guardar es el botón", () => {
    const disparadores = src.match(/void guardar\(\)/g) ?? [];
    expect(disparadores).toHaveLength(1);
  });
});

describe("Formulario de Gastos — comprobante con reintento seguro", () => {
  const src = fuente("src/app/e/[slug]/gastos/page.tsx");

  it("delega crear + comprobante en enviarGasto (misma clave en el reintento)", () => {
    expect(src).toContain('from "@/lib/tms/gastos-envio-cliente"');
    expect(src).toContain("enviarGasto({ fetchFn: fetch");
    expect(src).toContain("claveIdempotencia: clave");
  });

  it("si el comprobante falla, conserva la clave (no la reinicia) y avisa que no se creará otro gasto", () => {
    const rama = src.slice(src.indexOf('if (r.fase === "comprobante")'), src.indexOf("claveEnvioRef.current = null;\n    setMsg("));
    expect(rama).toContain("no se creará otro gasto");
    expect(rama).not.toContain("claveEnvioRef.current = null");
  });
});
