import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { crearRutaSchema } from "@/lib/tms/rutas-validacion";

/**
 * Operaciones → Rutas — formulario en 7 secciones secuenciales en UNA sola pantalla (no wizard). Guardas sobre el
 * código fuente (el proyecto no tiene @testing-library/react): orden, ayudas y obligatorios alineados con el backend.
 */
const src = readFileSync("src/app/e/[slug]/rutas/page.tsx", "utf8");
const pos = (t: string) => {
  const i = src.indexOf(t);
  expect(i, `no se encontró: ${t}`).toBeGreaterThan(-1);
  return i;
};

describe("Rutas — formulario por secciones", () => {
  it("7 secciones en orden: datos básicos, origen/destino, horario, tarifas/unidad, contacto, personal, observaciones", () => {
    const titulos = ["Datos básicos", "Origen y destino", "Horario habitual", "Tarifas y unidad", "Contacto", "Personal habitual", "Observaciones"];
    const posiciones = titulos.map((t) => pos(`titulo="${t}"`));
    expect([...posiciones].sort((a, b) => a - b)).toEqual(posiciones);
    titulos.forEach((t, i) => expect(src.slice(pos(`numero={${i + 1}}`) + 1, pos(`titulo="${t}"`))).not.toContain("numero={"));
  });

  it("cada campo vive en su sección (cliente/código antes que carga/destino, hora después, tarifa después de la hora)", () => {
    expect(pos('label="Cliente *"')).toBeLessThan(pos("numero={2}"));
    expect(pos('data-campo="codigo"')).toBeLessThan(pos("numero={2}"));
    expect(pos('label="lugar de carga guardado"')).toBeGreaterThan(pos("numero={2}"));
    expect(pos('data-campo="destinoDescripcion"')).toBeLessThan(pos("numero={3}"));
    expect(pos("Paradas estructuradas (opcional)")).toBeLessThan(pos("numero={3}"));
    expect(pos('dataCampo="horaHabitual"')).toBeGreaterThan(pos("numero={3}"));
    expect(pos('data-campo="tarifaReferencia"')).toBeGreaterThan(pos("numero={4}"));
    expect(pos('selectDataCampo="unidadRecurrenteId"')).toBeGreaterThan(pos("numero={4}"));
    expect(pos('data-campo="contactoClienteId"')).toBeGreaterThan(pos("numero={5}"));
    expect(pos("+ Agregar personal habitual")).toBeGreaterThan(pos("numero={6}"));
    expect(pos('data-campo="observaciones"')).toBeGreaterThan(pos("numero={7}"));
  });

  it("ayudas: ruta = plantilla; destino (reportes) ≠ paradas (seguimiento); hora y tarifas son sugerencias", () => {
    expect(src).toContain("Primero identifica para qué cliente y qué ruta estás configurando.");
    expect(src).toContain("Luego Operaciones podrá ajustarlos para ese viaje sin modificar esta ruta.");
    expect(src).toContain("Esta descripción es lo que sale en el reporte tradicional");
    expect(src).toContain("Puntos reales del recorrido, en orden, para el seguimiento operativo.");
    expect(src).toContain("Se usará como hora sugerida en Programación. Podrá cambiarse en cada viaje.");
    expect(src).toContain("no bloquean cambios operativos posteriores");
    expect(src).toContain('ayuda="Se precargan como sugerencia al crear el viaje."');
  });

  it("obligatorios marcados = obligatorios del backend (solo Cliente y Código)", () => {
    const vacio = crearRutaSchema.safeParse({});
    const requeridos = vacio.success ? [] : [...new Set(vacio.error.issues.map((i) => String(i.path[0])))].sort();
    expect(requeridos).toEqual(["clienteId", "codigo"]);
    expect(src).toContain('label="Cliente *"');
    expect(src).toContain('Código <span className="text-rose-400" aria-hidden="true">*</span>');
    expect((src.match(/text-rose-400" aria-hidden="true">\*/g) ?? []).length).toBe(1);
  });

  it("al final: un solo botón de guardar con aviso de que los viajes existentes no cambian", () => {
    expect(src).toContain('"Guardar cambios"');
    expect(src).toContain("Se guardarán los cambios de esta ruta maestra. Los viajes ya creados no se modificarán.");
    expect(pos("Se guardarán los cambios de esta ruta maestra")).toBeGreaterThan(pos("numero={7}"));
  });
});
