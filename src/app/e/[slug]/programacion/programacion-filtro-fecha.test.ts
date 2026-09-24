import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PROGRAMACION-FILTRO-FECHA-ESPECIFICA-1 — guarda de regresión sobre el
 * CÓDIGO FUENTE de programacion-client.tsx (este proyecto no tiene
 * @testing-library/react, mismo criterio ya usado en
 * programacion-export-filtros.test.ts y plan-form-tercerizados.test.ts):
 * el botón "Fecha" y su <input type="date"> reutilizan exactamente el
 * mismo mecanismo que ya usan Hoy/Mañana/Semana (desde/hasta derivados de
 * `rango`) — Estado/Piloto/Unidad/Cliente, exportaciones, contadores y el
 * botón "Actualizar" no necesitan ningún cambio propio porque todos ya
 * dependen de `desde`/`hasta` de forma genérica, no de qué botón los
 * produjo.
 */
const programacionClient = readFileSync(join(__dirname, "programacion-client.tsx"), "utf-8").replace(/\r\n/g, "\n");
const pos = (texto: string, from = 0) => {
  const i = programacionClient.indexOf(texto, from);
  expect(i, `no se encontró (desde ${from}): ${texto}`).toBeGreaterThan(-1);
  return i;
};

describe("programacion-client.tsx — Rango incluye 'fecha' como cuarto modo", () => {
  it("el tipo Rango tiene los 4 valores: hoy | manana | semana | fecha", () => {
    expect(programacionClient).toMatch(/export type Rango = "hoy" \| "manana" \| "semana" \| "fecha";/);
  });

  it("rangoQueContiene (navegación directa a un plan) sigue devolviendo SOLO hoy/manana/semana/null — nunca 'fecha' (no se rompe la navegación existente)", () => {
    const i = pos("export function rangoQueContiene(");
    const firma = programacionClient.slice(i, pos("{", i));
    expect(firma).toContain('"hoy" | "manana" | "semana" | null');
    expect(firma).not.toContain('"fecha"');
  });
});

describe("programacion-client.tsx — botón 'Fecha' + input date", () => {
  it("el arreglo de botones de rango incluye 'Fecha' como cuarta opción, después de Semana", () => {
    const i = pos('["hoy", "Hoy"]');
    const bloque = programacionClient.slice(i, pos(".map(([key, label]) => (", i));
    expect(bloque).toContain('["manana", "Mañana"]');
    expect(bloque).toContain('["semana", "Semana"]');
    expect(bloque).toContain('["fecha", "Fecha"]');
    // Orden: Hoy, Mañana, Semana, Fecha — la nueva opción va al final, sin reordenar las 3 de siempre.
    expect(bloque.indexOf('"semana"')).toBeLessThan(bloque.indexOf('"fecha"'));
  });

  it("el botón 'Fecha' usa el MISMO onClick que Hoy/Mañana/Semana (setRango(key) + limpia avisoRango) — sin un manejador aparte", () => {
    const i = pos('["hoy", "Hoy"]');
    const bloque = programacionClient.slice(i, pos("</div>", pos("</button>", i)));
    // Un solo onClick para las 4 opciones (mapeadas juntas), no 4 manejadores distintos.
    expect((bloque.match(/onClick=\{\(\) => \{/g) ?? []).length).toBe(1);
    expect(bloque).toContain("setRango(key);");
  });

  it("el <input type=\"date\"> solo se renderiza cuando rango === 'fecha' (condicional, no siempre visible)", () => {
    const i = pos('rango === "fecha" ? (');
    const bloque = programacionClient.slice(i, pos(") : null}", i));
    expect(bloque).toContain('type="date"');
    expect(bloque).toContain("value={fechaSeleccionada}");
  });

  it("el input date NUNCA tiene min/max — histórico completo y futuro sin restricción artificial", () => {
    const i = pos('rango === "fecha" ? (');
    const bloque = programacionClient.slice(i, pos(") : null}", i));
    expect(bloque).not.toMatch(/\bmin=/);
    expect(bloque).not.toMatch(/\bmax=/);
  });

  it("un valor vacío del input NO se aplica (evita un rango roto) — solo actualiza fechaSeleccionada si e.target.value es verdadero", () => {
    const i = pos('rango === "fecha" ? (');
    const bloque = programacionClient.slice(i, pos(") : null}", i));
    // Edición rápida PR-3: el valor vacío se descarta ANTES de la confirmación por cambios pendientes.
    expect(bloque).toContain("if (valor) siSePuedenPerderCambios(() => setFechaSeleccionada(valor));");
  });
});

describe("programacion-client.tsx — fechaSeleccionada persiste al alternar de modo (sección CAMBIO ENTRE MODOS)", () => {
  it("fechaSeleccionada es un estado aparte de `rango`, con valor inicial 'hoy' (nunca vacío)", () => {
    expect(programacionClient).toMatch(/const \[fechaSeleccionada, setFechaSeleccionada\] = useState\(hoy\);/);
  });

  it("cambiar a Hoy/Mañana/Semana/Fecha NUNCA reinicia fechaSeleccionada — solo cambia `rango` (el valor elegido se conserva al volver a 'Fecha')", () => {
    const i = pos('["hoy", "Hoy"]');
    const bloqueOnClick = programacionClient.slice(pos("onClick={() => {", i), pos("}}", pos("onClick={() => {", i)));
    expect(bloqueOnClick).not.toContain("setFechaSeleccionada");
  });
});

describe("programacion-client.tsx — Estado/Piloto/Unidad/Cliente, exportaciones, contadores y Actualizar reutilizan desde/hasta sin cambios propios", () => {
  it("enRango sigue filtrando SOLO por desde/hasta (genérico) — no distingue qué botón los produjo", () => {
    expect(programacionClient).toMatch(/p\.fecha_plan >= desde &&\s*\n\s*p\.fecha_plan <= hasta/);
  });

  it("resumen (contadores) se deriva de enRango — se recalcula automáticamente con cualquier rango, incluida una fecha específica", () => {
    const i = pos("const resumen = useMemo(");
    const bloque = programacionClient.slice(i, pos("[enRango, pendientesCierre]", i));
    expect(bloque).toContain("enRango.length");
    expect(bloque).toContain('enRango.filter((p) => p.estado === "Programado")');
  });

  it("reporteQueryString (Excel/PDF) sigue armando fechaDesde/fechaHasta desde `desde`/`hasta` — el modo Fecha las exporta automáticamente sin código nuevo", () => {
    expect(programacionClient).toMatch(/fechaDesde:\s*desde,\s*fechaHasta:\s*hasta/);
  });

  it("Exportar imagen sigue partiendo de `visibles` (ya filtrado por desde/hasta) — mismo mecanismo, sin una rama especial para 'fecha'", () => {
    const i = pos("async function exportarImagen");
    const bloque = programacionClient.slice(i, pos("const rango =", i));
    expect(bloque).toContain("visibles.map((p) =>");
  });

  it("el botón Actualizar (cargar()) usa desde/hasta capturados del cierre — nunca reinicia rango ni fechaSeleccionada (conserva la fecha tras actualizar)", () => {
    const i = pos("async function cargar() {");
    const bloque = programacionClient.slice(i, pos("\n  }\n", i));
    expect(bloque).toContain("obtenerProgramacion(slug, desde, hasta)");
    expect(bloque).not.toContain("setRango");
    expect(bloque).not.toContain("setFechaSeleccionada");
  });

  it("los filtros secundarios (fPiloto/fUnidad/fCliente) y filtroRapido no tienen ninguna condición especial atada a rango === 'fecha'", () => {
    const i = pos("const visibles = useMemo(() => {");
    const bloque = programacionClient.slice(i, pos("}, [baseFiltroRapido", i));
    expect(bloque).not.toContain('rango === "fecha"');
  });
});
