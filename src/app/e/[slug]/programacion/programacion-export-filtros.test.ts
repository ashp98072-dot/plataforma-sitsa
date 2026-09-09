import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PROGRAMACION-EXPORT-PROGRAMADOS-FIX-1 — causa raíz del bug reportado:
 * "la pantalla mostraba 2 Programados, el Excel devolvió otro conjunto".
 * `programacion-client.tsx` tenía un eje de fecha PROPIO para el widget de
 * exportación (exportDesde/exportHasta, useState independiente
 * inicializado siempre en `hoy`), separado del rango realmente visible en
 * el tablero (`desde`/`hasta`, derivado de `rango` — que además abre en
 * "Mañana", no en "Hoy", VIAT-4 punto 5). Al agregar Estado/Piloto/Unidad/
 * Cliente a la exportación (PROGRAMACION-REPORTES-FILTROS-1) sin also
 * sincronizar la fecha, un usuario que filtraba Estado=Programado podía
 * exportar un archivo con el estado correcto pero para un rango de días
 * totalmente distinto al que tenía en pantalla.
 *
 * Este proyecto no tiene @testing-library/react — no hay forma de
 * "renderizar" el componente y simular clics. Como guarda de regresión,
 * esta prueba verifica el CÓDIGO FUENTE: que el eje de fecha independiente
 * ya no existe, y que `reporteQueryString` (el único constructor de la URL
 * de exportación) usa `desde`/`hasta` — las MISMAS variables que ya
 * deciden qué trae el GET de planes y qué se pinta en el tablero — nunca
 * un estado propio del widget de exportación.
 */
const programacionClient = readFileSync(
  join(__dirname, "programacion-client.tsx"),
  "utf-8",
);

describe("programacion-client.tsx — el export ya no tiene un eje de fecha propio", () => {
  it("no queda ningún estado exportDesde/exportHasta (la causa raíz del bug — el comentario que explica la corrección sí puede mencionarlos en prosa)", () => {
    expect(programacionClient).not.toMatch(/const \[exportDesde/);
    expect(programacionClient).not.toMatch(/const \[exportHasta/);
    expect(programacionClient).not.toMatch(/value=\{exportDesde\}/);
    expect(programacionClient).not.toMatch(/value=\{exportHasta\}/);
  });

  it("reporteQueryString arma fechaDesde/fechaHasta a partir de `desde`/`hasta` (el rango realmente visible en el tablero)", () => {
    expect(programacionClient).toMatch(/fechaDesde:\s*desde,\s*fechaHasta:\s*hasta/);
  });

  it("el estado enviado es filtroRapido tal cual — nunca se traduce ni se pierde antes de llegar al endpoint", () => {
    // p.set("estado", filtroRapido) — la MISMA variable que decide qué
    // tarjetas se ven en el tablero (`visibles`), sin transformación
    // intermedia que pudiera perder o traducir "Programado" a otro valor.
    expect(programacionClient).toMatch(/p\.set\("estado",\s*filtroRapido\)/);
  });

  it("los dos enlaces de exportación (Excel y PDF) usan el mismo constructor reporteQueryString — nunca dos armados de URL distintos", () => {
    const ocurrencias = programacionClient.match(/reporteQueryString\("(xlsx|pdf)"\)/g) ?? [];
    expect(ocurrencias).toHaveLength(2);
  });
});
