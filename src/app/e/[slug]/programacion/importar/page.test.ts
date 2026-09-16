import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  respuestaValidarValida,
  respuestaImportarValida,
  formatearFechaHoraSimple,
  formatearSalidaExcel,
  puedeConfirmarImportacion,
} from "./page";

/**
 * TMS-IMPORTACION-PROGRAMACION-EXCEL (PR 6 de 6) — Programación >
 * Importar Excel. Este proyecto no tiene harness de componentes React
 * (ver vitest.config.mts: environment "node", solo incluye `*.test.ts`,
 * nunca `*.test.tsx`) — mismo criterio que planes-navegacion.test.ts /
 * rango-que-contiene.test.ts: se prueba la lógica PURA extraída
 * directamente, y como guarda de regresión para el comportamiento que
 * depende de renderizar (qué se envía al hacer clic, qué queda
 * deshabilitado, a dónde apunta un link) se verifica el código fuente.
 */

describe("respuestaValidarValida", () => {
  it("acepta una respuesta bien formada de accion=validar", () => {
    expect(
      respuestaValidarValida({ accion: "validar", filas: [], resumen: { totalFilas: 0, filasOk: 0, filasConError: 0 } }),
    ).toBe(true);
  });

  it.each([
    { accion: "importar", filas: [], resumen: {} },
    { accion: "validar", filas: "no-es-array", resumen: {} },
    { accion: "validar", filas: [] }, // sin resumen
    {},
  ])("rechaza una forma inesperada: %j", (data) => {
    expect(respuestaValidarValida(data)).toBe(false);
  });
});

describe("respuestaImportarValida", () => {
  it("acepta una respuesta bien formada de accion=importar", () => {
    expect(respuestaImportarValida({ accion: "importar", resultado: { resultado: "exitoso" } })).toBe(true);
  });

  it.each([
    { accion: "validar", resultado: {} },
    { accion: "importar", resultado: "no-es-objeto" },
    { accion: "importar" },
  ])("rechaza una forma inesperada: %j", (data) => {
    expect(respuestaImportarValida(data)).toBe(false);
  });
});

describe("formatearFechaHoraSimple", () => {
  it("combina fecha + hora 12h a partir de 'YYYY-MM-DDTHH:mm'", () => {
    expect(formatearFechaHoraSimple("2026-09-20T08:00")).toBe("2026-09-20 08:00 AM");
    expect(formatearFechaHoraSimple("2026-09-20T17:30")).toBe("2026-09-20 05:30 PM");
  });

  it("null -> '—'", () => {
    expect(formatearFechaHoraSimple(null)).toBe("—");
  });
});

describe("formatearSalidaExcel", () => {
  it("combina fecha + hora 12h por separado (columnas independientes del Excel)", () => {
    expect(formatearSalidaExcel("2026-09-20", "14:00")).toBe("2026-09-20 02:00 PM");
  });

  it("sin fecha -> '—'", () => {
    expect(formatearSalidaExcel(null, "14:00")).toBe("—");
  });

  it("con fecha pero sin hora -> solo la fecha", () => {
    expect(formatearSalidaExcel("2026-09-20", null)).toBe("2026-09-20");
  });
});

describe("puedeConfirmarImportacion — mientras existan errores, NO se permite confirmar; advertencias SÍ permiten continuar", () => {
  it("sin preview: no se puede confirmar", () => {
    expect(puedeConfirmarImportacion(null)).toBe(false);
  });

  it("con filas con error: no se puede confirmar, aunque otras filas estén ok", () => {
    expect(puedeConfirmarImportacion({ resumen: { totalFilas: 2, filasOk: 1, filasConError: 1 } })).toBe(false);
  });

  it("sin errores y con al menos 1 fila ok: sí se puede confirmar", () => {
    expect(puedeConfirmarImportacion({ resumen: { totalFilas: 1, filasOk: 1, filasConError: 0 } })).toBe(true);
  });

  it("0 filas con error pero también 0 filas ok (archivo vacío tras filtrar): no se puede confirmar", () => {
    expect(puedeConfirmarImportacion({ resumen: { totalFilas: 0, filasOk: 0, filasConError: 0 } })).toBe(false);
  });

  it("advertencias no forman parte del resumen que bloquea -- una fila con SOLO advertencia ya cuenta como 'ok' en filasOk, así que no bloquea", () => {
    // Mismo criterio que previsualizarImportacionProgramacion (PR 4): una
    // fila con advertencia (p. ej. cliente validado por nombre sin NIT)
    // tiene estado "ok", así que ya está contada en filasOk, no en
    // filasConError -- la función no necesita mirar advertencias aparte.
    expect(puedeConfirmarImportacion({ resumen: { totalFilas: 1, filasOk: 1, filasConError: 0 } })).toBe(true);
  });
});

const src = readFileSync(join(__dirname, "page.tsx"), "utf-8");

describe("page.tsx — código fuente (guarda de regresión para lo que depende de renderizar)", () => {
  it("botón 'Descargar plantilla' apunta al endpoint GET de la plantilla", () => {
    expect(src).toMatch(/href=\{`\/api\/empresas\/\$\{slug\}\/tms\/programacion\/importar`\}/);
    expect(src).toMatch(/Descargar plantilla Excel/);
  });

  it("el selector de archivo acepta solo .xlsx y no valida/importa automáticamente al seleccionar", () => {
    expect(src).toMatch(/type="file"\s+accept="\.xlsx"\s+onChange=\{cambiarArchivo\}/);
    // cambiarArchivo solo actualiza estado -- no llama a validar() ni a importar().
    const cuerpoCambiarArchivo = src.match(/function cambiarArchivo\([^)]*\)\s*\{([\s\S]*?)\n  \}/)?.[1] ?? "";
    expect(cuerpoCambiarArchivo).not.toMatch(/validar\(\)|importar\(\)/);
  });

  it("'Validar archivo' envía accion=validar", () => {
    const cuerpoValidar = src.match(/async function validar\(\)\s*\{([\s\S]*?)\n  \}/)?.[1] ?? "";
    expect(cuerpoValidar).toMatch(/formData\.set\("accion", "validar"\)/);
  });

  it("'Confirmar importación' -> panel de confirmación explícita -> 'Sí, importar' envía accion=importar (nunca se envía directo al primer clic)", () => {
    expect(src).toMatch(/onClick=\{\(\) => setConfirmando\(true\)\}/);
    expect(src).toMatch(/Vas a crear.*viaje/);
    const cuerpoImportar = src.match(/async function importar\(\)\s*\{([\s\S]*?)\n  \}/)?.[1] ?? "";
    expect(cuerpoImportar).toMatch(/formData\.set\("accion", "importar"\)/);
  });

  it("mientras existan errores, el botón Confirmar importación queda deshabilitado (usa puedeConfirmarImportacion)", () => {
    expect(src).toMatch(/disabled=\{!puedeConfirmar \|\| importando \|\| validando \|\| confirmando\}/);
    expect(src).toMatch(/const puedeConfirmar = puedeConfirmarImportacion\(preview\)/);
  });

  it("doble submit bloqueado: guardas explícitas en validar()/importar() además de los `disabled` de los botones", () => {
    const cuerpoValidar = src.match(/async function validar\(\)\s*\{([\s\S]*?)\n  \}/)?.[1] ?? "";
    const cuerpoImportar = src.match(/async function importar\(\)\s*\{([\s\S]*?)\n  \}/)?.[1] ?? "";
    expect(cuerpoValidar).toMatch(/if \(validando \|\| importando\) return;/);
    expect(cuerpoImportar).toMatch(/if \(importando \|\| validando\) return;/);
    // Botones también deshabilitados mientras hay una petición activa.
    expect(src).toMatch(/disabled=\{!archivo \|\| validando \|\| importando\}/);
  });

  it("nunca muestra éxito cuando el backend devolvió resultado de error", () => {
    // El resultado se guarda TAL CUAL (sin reinterpretarlo) y el render
    // distingue resultado.resultado === "exitoso" vs "error" -- nunca
    // fuerza un mensaje de éxito genérico.
    expect(src).toMatch(/const exito = resultado\?\.resultado === "exitoso";/);
    expect(src).toMatch(/exito && resultado\.resultado === "exitoso"/);
    expect(src).toMatch(/resultado\.resultado === "error"/);
  });

  it("tras un éxito, ofrece volver a Programación (la navegación fuerza un remount que vuelve a pedir los datos)", () => {
    const bloqueExito = src.match(/exito && resultado\.resultado === "exitoso" \? \(([\s\S]*?)\) : resultado\.resultado/)?.[1] ?? "";
    expect(bloqueExito).toMatch(/href=\{`\/e\/\$\{slug\}\/programacion`\}/);
    expect(bloqueExito).toMatch(/Ver Programación/);
  });

  it("maneja 413 (archivo demasiado grande) y errores de red por separado, sin exponer detalles internos", () => {
    expect(src).toMatch(/res\.status === 413/);
    expect(src).toMatch(/catch \{\s*\n\s*setError\("Error de conexión al validar el archivo\."\);/);
    expect(src).toMatch(/catch \{\s*\n\s*setError\("Error de conexión al importar\."\);/);
  });
});
