import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * PROGRAMACION-EXPORT-IMAGEN-1 (ajuste: mismo formato que el reporte
 * tradicional) — guarda de regresión sobre el CÓDIGO FUENTE (este proyecto
 * no tiene @testing-library/react, mismo criterio que
 * programacion-export-filtros.test.ts): confirma que "Exportar imagen"
 * reutiliza exactamente `visibles` (los viajes ya filtrados en pantalla —
 * mismo rango/Estado/Piloto/Unidad/Cliente que Excel/PDF) y arma cada
 * celda con el MISMO criterio que ya usa el reporte tradicional Excel/PDF
 * (mesDia, origenDestino, lugar_descarga_historico, hora en 24h) — nunca
 * reinventa esas reglas.
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
    const fn = programacionClient.slice(pos("async function exportarImagen"), pos("const rango ="));
    expect(fn).toContain("visibles.map((p) =>");
    expect(fn).not.toMatch(/fetch\(/);
  });

  it("Mes/Día: reutiliza mesDia() (misma tabla de abreviaturas que el reporte tradicional) sobre fecha_plan", () => {
    const fn = programacionClient.slice(pos("async function exportarImagen"), pos("const rango ="));
    expect(fn).toContain("mesDia(p.fecha_plan)");
  });

  it("Lugar de Carga: reutiliza origenDestino(p.paradas) — misma búsqueda de parada tipo Carga que ya usa el tablero", () => {
    const fn = programacionClient.slice(pos("async function exportarImagen"), pos("const rango ="));
    expect(fn).toContain("origenDestino(p.paradas)");
    expect(fn).toContain("lugarCarga: origen");
  });

  it("Lugar de Descarga: usa lugar_descarga_historico — NUNCA una parada (regla VIAT-4b del reporte tradicional)", () => {
    const fn = programacionClient.slice(pos("async function exportarImagen"), pos("const rango ="));
    expect(fn).toContain("lugarDescarga: p.lugar_descarga_historico");
  });

  it("Hora en 24h (slice, sin formatearHora12/AM-PM) — mismo formato que el reporte tradicional", () => {
    const fn = programacionClient.slice(pos("async function exportarImagen"), pos("const rango ="));
    expect(fn).toContain("hora: p.hora_carga ? p.hora_carga.slice(0, 5) : \"\"");
    expect(fn).not.toContain("formatearHora12(p.hora_carga)");
  });

  it("Auxiliar 1 / Auxiliar 2 separados (primeros dos, nunca combinados en una sola columna)", () => {
    const fn = programacionClient.slice(pos("async function exportarImagen"), pos("const rango ="));
    expect(fn).toContain("auxiliar1: p.auxiliares[0] ?? \"\"");
    expect(fn).toContain("auxiliar2: p.auxiliares[1] ?? \"\"");
    expect(fn).not.toContain("p.auxiliares.join");
  });

  it("nunca arma código, estado, regreso estimado, tarifa comercial ni una columna de ruta combinada", () => {
    const fn = programacionClient.slice(pos("async function exportarImagen"), pos("const rango ="));
    expect(fn).not.toContain("codigo:");
    expect(fn).not.toContain("estadoVisible(p)");
    expect(fn).not.toContain("regresoEstimado");
    expect(fn).not.toContain("tarifaComercial");
    expect(fn).not.toContain("ruta:");
  });

  it("mismo criterio de rango/filtros que reporteQueryString (Excel/PDF): PendienteCierre sin fechas, Estado/Piloto/Unidad/Cliente activos", () => {
    const fn = programacionClient.slice(pos("async function exportarImagen"), pos("const input ="));
    expect(fn).toContain('filtroRapido === "PendienteCierre"');
    expect(fn).toContain("fPiloto ? `Piloto: ${fPiloto}` : null");
    expect(fn).toContain("fUnidad ? `Unidad: ${fUnidad}` : null");
    expect(fn).toContain("fCliente ? `Cliente: ${fCliente}` : null");
  });

  it("usa el nombre real de la empresa (useEmpresaSession), no un texto fijo salvo fallback", () => {
    expect(programacionClient).toContain("const { empresaNombre } = useEmpresaSession();");
    expect(programacionClient).toContain('empresa: empresaNombre || "Programación"');
  });

  it("deshabilita ambos botones mientras genera (evita doble clic/doble descarga)", () => {
    const seccion = programacionClient.slice(pos("Exportar PDF"), pos("Importar Excel"));
    expect(seccion.match(/disabled=\{exportandoImagen\}/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("«Exportar imagen» solo existe en Programación — ningún otro módulo importa programacion-exportar-imagen ni programacion-imagen", () => {
    // Mismo criterio que el resto de las pruebas de este archivo (código
    // fuente, sin cwd explícito): vitest ya corre desde la raíz del repo.
    const salida = execFileSync(
      "git",
      ["grep", "-l", "-E", "programacion-exportar-imagen|programacion-imagen", "--", "src"],
      { encoding: "utf8" },
    ).trim().split(/\r?\n/).filter(Boolean);
    const fueraDePrograma = salida.filter((p) => !p.includes("/programacion/") && !p.includes("/tms/programacion-"));
    expect(fueraDePrograma).toEqual([]);
  });
});
