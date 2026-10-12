import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * El repositorio no renderiza componentes React con eventos en las pruebas (entorno node). La lógica del guard y de la clave
 * está probada en src/lib/idempotencia/clave-envio.test.ts y la idempotencia del servidor en
 * requerimiento-idempotencia-creacion.test.ts; estas pruebas fijan el CABLEADO del formulario para que una refactorización
 * no retire la protección sin que falle algo.
 */
const src = readFileSync(join(process.cwd(), "src", "components", "compras", "requerimiento-form-client.tsx"), "utf8").replace(/\r\n/g, "\n");

describe("Formulario de Requerimientos de Compras — doble envío e idempotencia", () => {
  it("usa el guard síncrono de envío único (además del estado `guardando`, que solo pinta el botón)", () => {
    expect(src).toContain('from "@/lib/idempotencia/clave-envio"');
    expect(src).toContain("useState(() => crearEnvioUnico())");
    expect(src).toMatch(/await envio\.ejecutar\(\(\) => enviarRequerimiento\(\)\)/);
    expect(src).toMatch(/finally \{ setGuardando\(false\); \}/);
  });

  it("el único disparador del envío es el submit del formulario (Enter y clic comparten el mismo guard)", () => {
    expect(src).toContain("<form onSubmit={guardar}");
    expect((src.match(/type="submit"/g) ?? []).length).toBe(1);
    expect((src.match(/onSubmit=/g) ?? []).length).toBe(1);
  });

  it("la clave de envío se genera al primer guardado y SOLO al crear (no al editar)", () => {
    expect(src).toMatch(/\.\.\.\(detalle \? \{ version: detalle\.version \} : \{ clave_idempotencia: envio\.clave\(\) \}\)/);
    expect((src.match(/envio\.clave\(\)/g) ?? []).length).toBe(1); // una única fuente de la clave (la de «+ Agregar línea» usa crypto.randomUUID para keys de React)
  });

  it("la clave se conserva en errores y respuestas inciertas: no se reinicia en el catch ni en el finally", () => {
    expect(src).not.toContain("reiniciarClave");
    const catchFinally = src.slice(src.indexOf("} catch (e) { setError("), src.indexOf("const deshabilitado"));
    expect(catchFinally).not.toContain("envio.");
  });

  it("tras el éxito confirmado el formulario queda bloqueado mientras navega (un envío tardío no puede crear otro)", () => {
    expect(src).toContain("const [completado, setCompletado] = useState(false)");
    expect(src).toMatch(/setCompletado\(true\);[^\n]*\n\s+const fallidos = await subirPendientesCompra/);
    expect(src).toContain("const deshabilitado = !editable || guardando || conflicto || completado;");
  });

  it("el botón de guardar se deshabilita mientras guarda y muestra «Guardando…»", () => {
    expect(src).toContain("disabled={deshabilitado || !catalogos || bloqueoFactura}");
    expect(src).toContain('{guardando ? "Guardando…" : "Guardar requerimiento"}');
  });
});
