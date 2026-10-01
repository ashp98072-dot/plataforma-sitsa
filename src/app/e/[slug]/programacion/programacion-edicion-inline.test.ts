import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * TMS-PROGRAMACION-EDICION-INLINE-1 — el formulario de edición (PlanForm) ya NO se dibuja arriba de todo el
 * tablero: se dibuja INMEDIATAMENTE debajo de la tarjeta del viaje que se está editando, dentro del propio
 * `.map()` de `visibles`. Mismo criterio que el resto de este repo para componentes sin harness de pruebas:
 * se verifica el código fuente directamente.
 */
const src = readFileSync("src/app/e/[slug]/programacion/programacion-client.tsx", "utf8").replace(/\r\n/g, "\n");

function cuerpoDe(nombreFuncion: string): string {
  const inicio = src.indexOf(`function ${nombreFuncion}`);
  expect(inicio).toBeGreaterThan(-1);
  // Corta en el primer "\n  }" al mismo nivel de indentación de función de módulo (2 espacios) después del inicio.
  const fin = src.indexOf("\n  }", inicio);
  return src.slice(inicio, fin);
}

describe("TMS-PROGRAMACION-EDICION-INLINE-1 — máximo un editor, mismo estado editandoId", () => {
  it("editandoId sigue siendo un ÚNICO valor (number | null), nunca un Set — así 'máximo un editor abierto' queda garantizado por el propio tipo", () => {
    expect(src).toContain("useState<number | null>(planInicialId)");
    expect(src).not.toMatch(/editandoId.*Set</);
  });

  it("no se creó ningún sistema paralelo de edición (sin un segundo useState tipo 'editandoIdInline' o similar)", () => {
    const ocurrencias = src.match(/const \[editando\w*,/g) ?? [];
    expect(ocurrencias).toHaveLength(1);
  });
});

describe("TMS-PROGRAMACION-EDICION-INLINE-1 — el PlanForm de edición se dibuja dentro de la tarjeta, no arriba del tablero", () => {
  it("el bloque de arriba del tablero SOLO cubre el caso sin tarjeta visible (planEditando && !planEditandoVisible), no el caso general", () => {
    expect(src).toContain("planEditando && !planEditandoVisible");
    // Ya NO debe existir el render incondicional de antes ("{planEditando ? (" sin el `&& !planEditandoVisible`).
    expect(src).not.toMatch(/\{planEditando \? \(\s*\n\s*<PlanForm/);
  });

  it("planEditandoVisible se calcula sobre `visibles` (la lista realmente mostrada), no sobre `planes` a secas", () => {
    expect(src).toContain("const planEditandoVisible = editandoId != null && visibles.some((p) => p.id === editandoId);");
  });

  it("dentro del `.map()` de `visibles`, el PlanForm inline está gateado por `editandoId === p.id`", () => {
    const inicioMap = src.indexOf("visibles.map((p) => {");
    const finMap = src.indexOf("{!visibles.length && !loading", inicioMap);
    expect(inicioMap).toBeGreaterThan(-1);
    expect(finMap).toBeGreaterThan(inicioMap);
    const bloqueMap = src.slice(inicioMap, finMap);
    expect(bloqueMap).toContain("editandoId === p.id && planEditando ? (");
    expect(bloqueMap).toContain("<PlanForm");
    expect(bloqueMap).toContain("onCancel={cerrarFormulario}");
  });

  it("el PlanForm inline usa key={p.id} — estado nunca se contamina entre viajes al cambiar de tarjeta", () => {
    const inicioMap = src.indexOf("visibles.map((p) => {");
    const finMap = src.indexOf("{!visibles.length && !loading", inicioMap);
    const bloqueMap = src.slice(inicioMap, finMap);
    const inicioInline = bloqueMap.indexOf("editandoId === p.id && planEditando");
    const bloqueInline = bloqueMap.slice(inicioInline, inicioInline + 400);
    expect(bloqueInline).toMatch(/key=\{p\.id\}/);
  });

  it("la tarjeta y su editor inline están envueltos en un Fragment con key={p.id} (un solo root por item del .map, sin <div> extra que altere el layout de la lista)", () => {
    expect(src).toContain("import { Fragment, useEffect, useMemo, useRef, useState } from \"react\";");
    expect(src).toContain("<Fragment key={p.id}>");
  });
});

describe("TMS-PROGRAMACION-EDICION-INLINE-1 — comportamiento de alGuardar() al editar vs. crear", () => {
  it("alGuardar captura `mostrarCrear` ANTES de limpiar estado, para distinguir crear de editar", () => {
    const fn = cuerpoDe("alGuardar");
    expect(fn).toContain("const eraCreacion = mostrarCrear;");
  });

  it("tras EDITAR (eraCreacion=false) el formulario se CIERRA (editandoId -> null) después del refetch", () => {
    const fn = cuerpoDe("alGuardar");
    expect(fn).toContain("setEditandoId(eraCreacion ? info.id : null);");
  });

  it("tras CREAR (eraCreacion=true) se mantiene el comportamiento de siempre: pasa a modo edición del viaje recién creado", () => {
    const fn = cuerpoDe("alGuardar");
    // Misma línea cubre ambos casos (ternario) — confirma que el modo creación sigue recibiendo info.id.
    expect(fn).toMatch(/eraCreacion \? info\.id : null/);
  });

  it("el cierre de un plan (info.cerrado) sigue limpiando editandoId y redirigiendo, sin cambios", () => {
    const fn = cuerpoDe("alGuardar");
    expect(fn).toContain("if (info.cerrado) {");
    expect(fn).toContain("router.push(destinoTrasCerrarPlan(slug, info.id));");
  });
});

describe("TMS-PROGRAMACION-EDICION-INLINE-1 — cancelar cierra sin refetch, sin cambiar de posición", () => {
  it("cerrarFormulario() no llama a cargar() (sin refetch innecesario al cancelar)", () => {
    const fn = cuerpoDe("cerrarFormulario");
    expect(fn).not.toContain("cargar(");
    expect(fn).toContain("setEditandoId(null);");
    expect(fn).toContain("setMostrarCrear(false);");
  });

  it("no se agregó ningún scrollIntoView/scrollTo/scroll( al abrir, cancelar o guardar — la posición de scroll nunca se toca explícitamente", () => {
    expect(src).not.toMatch(/scrollIntoView|scrollTo|window\.scroll\(/);
  });
});

describe("TMS-PROGRAMACION-EDICION-INLINE-1 — el formulario de creación 'Nuevo viaje' no cambió de lugar", () => {
  it("'+ Nuevo viaje' sigue controlado por mostrarCrear, renderizado en el mismo bloque de siempre (arriba del tablero)", () => {
    expect(src).toContain('{mostrarCrear ? "Cancelar" : "+ Nuevo viaje"}');
    const inicioCrear = src.indexOf("{mostrarCrear ? (");
    const inicioResumen = src.indexOf("{/* Resumen");
    expect(inicioCrear).toBeGreaterThan(-1);
    expect(inicioResumen).toBeGreaterThan(inicioCrear); // el bloque de creación sigue ANTES del resumen/tablero.
  });
});
