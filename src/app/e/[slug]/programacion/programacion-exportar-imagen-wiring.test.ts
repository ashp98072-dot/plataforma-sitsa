import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PROGRAMACION-EXPORT-IMAGEN-1 — guarda de regresión sobre el CÓDIGO FUENTE
 * (este proyecto no tiene @testing-library/react, mismo criterio que
 * programacion-export-filtros.test.ts): confirma que "Exportar imagen"
 * reutiliza exactamente `visibles` (los viajes ya filtrados en pantalla —
 * mismo rango/Estado/Piloto/Unidad/Cliente que Excel/PDF) y los MISMOS
 * helpers que ya pinta el tablero, en vez de reinventar el filtrado o el
 * formateo de estado/ruta/hora.
 */
const programacionClient = readFileSync(join(__dirname, "programacion-client.tsx"), "utf-8");
const pos = (texto: string) => {
  const i = programacionClient.indexOf(texto);
  expect(i, `no se encontró: ${texto}`).toBeGreaterThan(-1);
  return i;
};

describe("programacion-client.tsx — Exportar imagen", () => {
  it("hay un botón PNG (principal) y una opción JPG (secundaria)", () => {
    expect(programacionClient).toContain('exportarImagen("png")');
    expect(programacionClient).toContain('exportarImagen("jpeg")');
    expect(programacionClient).toContain("Exportar imagen (PNG)");
  });

  it("construye las filas desde `visibles` — nunca una consulta nueva al servidor", () => {
    const fn = programacionClient.slice(pos("async function exportarImagen"), pos("const input ="));
    expect(fn).toContain("visibles.map((p) =>");
    expect(fn).not.toMatch(/fetch\(/);
  });

  it("reutiliza estadoVisible/origenDestino/formatearHora12/formatearFechaHora12 — nunca reimplementa cómo se ve un estado, una ruta o una hora", () => {
    const fn = programacionClient.slice(pos("async function exportarImagen"), pos("const input ="));
    expect(fn).toContain("estadoVisible(p).label");
    expect(fn).toContain("origenDestino(p.paradas)");
    expect(fn).toContain("formatearHora12(p.hora_carga)");
    expect(fn).toContain("formatearFechaHora12(p.regreso_estimado)");
  });

  it("mismo criterio de rango/filtros que reporteQueryString (Excel/PDF): PendienteCierre sin fechas, Estado/Piloto/Unidad/Cliente activos", () => {
    const fn = programacionClient.slice(pos("async function exportarImagen"), pos("const input ="));
    expect(fn).toContain('filtroRapido === "PendienteCierre"');
    expect(fn).toContain("fPiloto ? `Piloto: ${fPiloto}` : null");
    expect(fn).toContain("fUnidad ? `Unidad: ${fUnidad}` : null");
    expect(fn).toContain("fCliente ? `Cliente: ${fCliente}` : null");
  });

  it("regreso estimado y tarifa comercial quedan en blanco cuando el viaje no los tiene — nunca se inventa un valor", () => {
    const fn = programacionClient.slice(pos("async function exportarImagen"), pos("const input ="));
    expect(fn).toContain('p.regreso_estimado ? formatearFechaHora12(p.regreso_estimado) : ""');
    expect(fn).toContain('p.tarifa_comercial != null');
  });

  it("usa el nombre real de la empresa (useEmpresaSession), no un texto fijo salvo fallback", () => {
    expect(programacionClient).toContain("const { empresaNombre } = useEmpresaSession();");
    expect(programacionClient).toContain('empresa: empresaNombre || "Programación"');
  });

  it("deshabilita ambos botones mientras genera (evita doble clic/doble descarga)", () => {
    const seccion = programacionClient.slice(pos("Exportar PDF"), pos("Importar Excel"));
    expect(seccion.match(/disabled=\{exportandoImagen\}/g)?.length).toBeGreaterThanOrEqual(2);
  });
});
