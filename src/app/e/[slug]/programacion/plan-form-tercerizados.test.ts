import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PROGRAMACION-VIAJES-TERCERIZADOS-1 — guarda de regresión sobre el CÓDIGO
 * FUENTE de plan-form.tsx (este proyecto no tiene @testing-library/react,
 * mismo criterio ya usado en programacion-exportar-imagen-wiring.test.ts y
 * en las notas del propio plan-form.test.ts: probar la lógica extraíble —
 * aquí, `camposTipoViaje()` no está exportada porque depende de `form`
 * (estado del componente), así que se ejercita como texto fuente — nunca
 * el renderizado).
 *
 * Cubre el contrato del ticket (sección 16/17/18/27 CAMBIO DE TIPO):
 * - Propio nunca cambia de comportamiento (selectores internos intactos).
 * - Tercerizado usa SOLO texto libre, nunca mezcla ids internos con
 *   snapshot externo al alternar.
 * - El "motivo del cambio" nunca se exige para un plan Tercerizado.
 * - Editar un plan cuyo tipo cambia (o que YA es Tercerizado) manda
 *   PRIMERO el PATCH dedicado (tipoViaje), aislado del PATCH normal.
 */
const planForm = readFileSync(join(__dirname, "plan-form.tsx"), "utf-8").replace(/\r\n/g, "\n");
/** indexOf con `from` opcional — evita que una coincidencia MÁS TEMPRANA en otra parte del archivo (p.ej. otro "if (!esEdicion) {" o otro ") : (") arruine el recorte. */
const pos = (texto: string, from = 0) => {
  const i = planForm.indexOf(texto, from);
  expect(i, `no se encontró (desde ${from}): ${texto}`).toBeGreaterThan(-1);
  return i;
};

describe("plan-form.tsx — camposTipoViaje()", () => {
  const fn = () => planForm.slice(pos("function camposTipoViaje()"), pos("async function onSubmit"));

  it("siempre manda tipoViaje; los 5 campos de texto libre solo cuando tipoViaje === 'Tercerizado' (undefined en Propio)", () => {
    const f = fn();
    expect(f).toContain("tipoViaje: form.tipoViaje");
    for (const campo of ["pilotoExternoNombre", "unidadExternaPlaca", "unidadExternaDescripcion", "transportistaExterno"]) {
      expect(f).toContain(`form.tipoViaje === "Tercerizado" ? form.${campo}`);
    }
    expect(f).toContain('form.tipoViaje === "Tercerizado"');
    expect(f).toContain("form.auxiliaresExternosTexto");
  });

  it("costoTercerizado también queda undefined salvo Tercerizado con valor no vacío (nunca 0 falso-vacío)", () => {
    const f = fn();
    expect(f).toContain('form.tipoViaje === "Tercerizado" && form.costoTercerizado !== "" ? Number(form.costoTercerizado) : undefined');
  });

  it("auxiliaresExternos se parte por línea aquí, una sola vez (el backend solo vuelve a unir con \\n, nunca reinterpreta)", () => {
    expect(fn()).toContain("form.auxiliaresExternosTexto.split(/\\r?\\n/).map((n) => n.trim()).filter(Boolean)");
  });
});

describe("plan-form.tsx — validación de creación (Tercerizado vs Propio)", () => {
  const inicio = pos("if (!esEdicion) {");
  const fn = () => planForm.slice(inicio, pos("const salidaProgramada =", inicio));

  it("Tercerizado exige pilotoExternoNombre; Propio sigue exigiendo pilotoEmpleadoId/pilotoNombre (sin cambios)", () => {
    const f = fn();
    expect(f).toContain('if (form.tipoViaje === "Tercerizado") {');
    expect(f).toContain("Indica el nombre del piloto externo.");
    expect(f).toContain("!form.pilotoEmpleadoId && !form.pilotoNombre.trim()");
    expect(f).toContain("Indica el piloto (elige de RRHH o escríbelo).");
  });
});

describe("plan-form.tsx — cambioSensible nunca exige motivo para un plan Tercerizado", () => {
  it("gatea con tipoViaje actual Y original antes de calcularCambioSensible (evita el falso 'motivo requerido')", () => {
    const inicio = pos("const cambioSensible =");
    const f = planForm.slice(inicio, pos("// Mejora Programación (Opción A, punto 1/7)", inicio));
    expect(f).toContain('form.tipoViaje !== "Tercerizado"');
    expect(f).toContain('(plan?.tipo_viaje ?? "Propio") !== "Tercerizado"');
    expect(f.indexOf('form.tipoViaje !== "Tercerizado"')).toBeLessThan(f.indexOf("calcularCambioSensible("));
  });
});

describe("plan-form.tsx — POST (creación): incluye camposTipoViaje() en el mismo body", () => {
  it("una sola llamada, sin un endpoint/formulario separado para Tercerizado", () => {
    // Segundo "if (!esEdicion) {" del archivo: el primero es la validación de arriba, este es el propio fetch POST.
    const primerIf = pos("if (!esEdicion) {");
    const segundoIf = pos("if (!esEdicion) {", primerIf + 1);
    const f = planForm.slice(segundoIf, pos("const data = await res.json();", segundoIf));
    expect(f).toContain('method: "POST"');
    expect(f).toContain("...camposTipoViaje(),");
  });
});

describe("plan-form.tsx — PATCH (edición): PATCH dedicado de tipo ANTES del PATCH normal", () => {
  const inicio = pos("const tipoViajeOriginal =");
  const fn = () => planForm.slice(inicio, pos("const esTercerizadoAhora =", inicio));

  it("dispara el PATCH dedicado cuando el tipo cambió, o cuando el plan YA es/queda Tercerizado (nunca solo en el primer caso)", () => {
    const f = fn();
    expect(f).toContain('form.tipoViaje !== tipoViajeOriginal || form.tipoViaje === "Tercerizado"');
  });

  it("el PATCH dedicado manda SOLO {id, ...camposTipoViaje()} — nunca mezclado con el resto de campos del formulario", () => {
    const f = fn();
    expect(f).toContain('method: "PATCH"');
    expect(f).toContain("body: JSON.stringify({ id: plan!.id, ...camposTipoViaje() })");
  });

  it("si el PATCH dedicado falla, se corta ANTES de llegar al PATCH normal (no hay guardado parcial)", () => {
    const f = fn();
    expect(f).toContain("if (!resTipo.ok) {");
    const iError = f.indexOf("if (!resTipo.ok) {");
    expect(f.slice(iError, iError + 120)).toContain("return;");
  });
});

describe("plan-form.tsx — PATCH normal: nunca reenvía piloto/placa/auxiliares/motivo para un Tercerizado", () => {
  it("camposSensibles queda con los 4 campos + motivoCambio en undefined cuando el plan es Tercerizado ahora", () => {
    const inicio = pos("const esTercerizadoAhora =");
    const f = planForm.slice(inicio, pos('method: "PATCH"', inicio));
    expect(f).toContain('const esTercerizadoAhora = form.tipoViaje === "Tercerizado";');
    expect(f).toMatch(/esTercerizadoAhora\s*\n\s*\?\s*\{\s*pilotoNombre: undefined, placa: undefined, auxiliarEmpleadoIds: undefined, auxiliarNombres: undefined, motivoCambio: undefined,?\s*(pilotoExtraEmpleadoId: undefined,?\s*)?\}/);
  });
});

describe("plan-form.tsx — UI: toggle + Propio intacto + Tercerizado en texto libre, nunca un formulario aparte", () => {
  const inicioSelector = pos("Tipo de viaje");
  const inicioPropio = pos('{form.tipoViaje === "Propio" ?', inicioSelector);
  const inicioTercerizado = pos(") : (", inicioPropio);
  const finTercerizado = pos("Nunca crea empleados en RRHH ni unidades en Flota", inicioTercerizado);

  it("el <select> Tipo de viaje existe, con Propio como primera opción (default)", () => {
    const f = planForm.slice(inicioSelector, inicioPropio);
    expect(f).toContain('<option value="Propio">Propio</option>');
    expect(f).toContain('<option value="Tercerizado">Tercerizado</option>');
    expect(f.indexOf('value="Propio"')).toBeLessThan(f.indexOf('value="Tercerizado"'));
  });

  it("Propio sigue usando PlacaSelect/PilotoSelect/AuxiliaresSelect sin cambios (mismo bloque de siempre)", () => {
    const f = planForm.slice(inicioPropio, inicioTercerizado);
    expect(f).toContain("<PlacaSelect");
    expect(f).toContain("<PilotoSelect");
    expect(f).toContain("<AuxiliaresSelect");
  });

  it("Tercerizado usa SOLO inputs de texto libre (nunca PlacaSelect/PilotoSelect/AuxiliaresSelect en esa rama)", () => {
    const f = planForm.slice(inicioTercerizado, finTercerizado);
    expect(f).not.toContain("<PlacaSelect");
    expect(f).not.toContain("<PilotoSelect");
    expect(f).not.toContain("<AuxiliaresSelect");
    expect(f).toContain("Piloto (texto libre — no consulta RRHH)");
    expect(f).toContain("Transportista / proveedor");
    expect(f).toContain("Unidad / placa (texto libre — no consulta Flota)");
    expect(f).toContain("Auxiliares externos (uno por línea — no consulta RRHH)");
    expect(f).toContain("Costo tercerizado (opcional — control interno)");
  });

  it("nota explícita: nunca crea RRHH/Flota, nunca genera viáticos ni valida disponibilidad interna", () => {
    expect(planForm).toContain("Nunca crea empleados en RRHH ni unidades en Flota — se guarda solo como texto de este viaje.");
    expect(planForm).toContain("No genera viáticos ni valida disponibilidad interna");
  });
});
