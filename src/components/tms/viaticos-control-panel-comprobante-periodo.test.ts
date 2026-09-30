import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * VIATICOS-COMPROBANTE-PERIODO — el bloque "Comprobante de autorización" del panel "Operaciones > Viáticos" ya
 * NO es un <a href> directo al endpoint (abría el JSON de error crudo en el navegador cuando no había
 * AUTORIZADO=0, y el comprobante dependía de estado="AUTORIZADO" — bug de diseño descrito en el ticket). Ahora es
 * un selector Día/Semana/Mes + botón que descarga por fetch+blob, con el mensaje de error quedando en esta misma
 * pantalla. Mismo criterio que viaticos-control-panel-agrupacion.test.ts: no hay harness de componentes en este
 * repo, se verifica el código fuente directamente.
 */
const src = readFileSync("src/components/tms/viaticos-control-panel.tsx", "utf8").replace(/\r\n/g, "\n");

describe("VIATICOS-COMPROBANTE-PERIODO — ya no existe el <a href> directo al endpoint", () => {
  it("26) no queda ningún <a href> apuntando al endpoint del comprobante", () => {
    expect(src).not.toMatch(/<a\s+href=\{`\/api\/empresas\/\$\{slug\}\/tms\/viaticos\/comprobante-autorizacion-pdf/);
  });
});

describe("VIATICOS-COMPROBANTE-PERIODO — selector de período", () => {
  it("27) selector Día", () => {
    expect(src).toContain('<option value="DIA">Día</option>');
  });

  it("28) selector Semana", () => {
    expect(src).toContain('<option value="SEMANA">Semana</option>');
  });

  it("29) selector Mes", () => {
    expect(src).toContain('<option value="MES">Mes</option>');
  });

  it("input dinámico: type=date para DÍA, type=week para SEMANA, type=month para MES (nunca un solo tipo fijo)", () => {
    expect(src).toMatch(/type=\{tipoPeriodoComprobante === "DIA" \? "date" : tipoPeriodoComprobante === "SEMANA" \? "week" : "month"\}/);
  });

  it("valor por defecto: DÍA + fecha de hoy Guatemala (hoyLocal, nunca new Date() del navegador)", () => {
    expect(src).toContain('import { hoyLocal } from "@/lib/rrhh/dates"');
    expect(src).toContain('useState<TipoPeriodoComprobante>("DIA")');
    expect(src).toContain("useState(() => hoyLocal())");
  });
});

describe("VIATICOS-COMPROBANTE-PERIODO — descarga por fetch+blob, nunca navegación directa", () => {
  it("30) descargarComprobante hace fetch al endpoint con ?periodo=&valor=", () => {
    expect(src).toContain("async function descargarComprobante()");
    expect(src).toContain("params = new URLSearchParams({ periodo: tipoPeriodoComprobante, valor: valorPeriodoComprobante })");
    expect(src).toContain("fetch(`/api/empresas/${slug}/tms/viaticos/comprobante-autorizacion-pdf?");
  });

  it("31) si la respuesta no es OK, el error se guarda en estado (queda en pantalla) y NO se descarga nada", () => {
    const fn = src.slice(src.indexOf("async function descargarComprobante"), src.indexOf("\n  }", src.indexOf("async function descargarComprobante")));
    expect(fn).toContain("if (!res.ok)");
    expect(fn).toContain("setErrorComprobante(data.error");
    expect(fn).toContain("return;");
  });

  it("32) nunca usa window.open/window.location ni un <a href> para navegar al endpoint — el único <a> es el sintético del blob", () => {
    expect(src).not.toContain("window.open(");
    expect(src).not.toMatch(/window\.location(\.href)?\s*=\s*`\/api\/empresas/);
  });

  it("33) el botón se deshabilita mientras descarga (evita doble clic)", () => {
    expect(src).toMatch(/disabled=\{descargandoComprobante \|\| !valorPeriodoComprobante\}/);
    expect(src).toContain('{descargandoComprobante ? "Generando…" : "Descargar PDF"}');
  });

  it("34) el nombre de archivo usa el Content-Disposition del backend, con un fallback seguro calculado localmente", () => {
    const fn = src.slice(src.indexOf("async function descargarComprobante"), src.indexOf("\n  }", src.indexOf("async function descargarComprobante")));
    expect(fn).toContain('res.headers.get("Content-Disposition")');
    expect(fn).toContain("const nombreServidor = /filename=");
    expect(fn).toContain("a.download = nombreServidor || `viaticos-autorizados-${valorPeriodoComprobante}.pdf`");
  });

  it("el blob se descarga con URL.createObjectURL + <a download> sintético + revokeObjectURL (mismo patrón que ViaticosPorPagarPanel)", () => {
    const fn = src.slice(src.indexOf("async function descargarComprobante"), src.indexOf("\n  }", src.indexOf("async function descargarComprobante")));
    expect(fn).toContain("const blob = await res.blob()");
    expect(fn).toContain("URL.createObjectURL(blob)");
    expect(fn).toContain("URL.revokeObjectURL(url)");
  });
});

describe("VIATICOS-COMPROBANTE-PERIODO — independencia total del listado", () => {
  // Se aísla el JSX real del bloque, EXCLUYENDO el comentario que lo precede (ese comentario menciona en prosa
  // los filtros de los que es independiente — "fEstado/fFechaDesde/..." — lo cual haría fallar las propias
  // aserciones de "no contiene" si se incluyera).
  const inicioBloque = src.indexOf("{puedeComprobantes ? (\n        <div className=\"flex flex-wrap items-end gap-2 rounded-lg");
  const finBloque = src.indexOf(') : null}\n\n      <div className="flex flex-wrap items-end gap-2">', inicioBloque);
  const bloqueComprobante = src.slice(inicioBloque, finBloque);

  it("el bloque del comprobante existe y se pudo aislar del resto del panel (control del propio test)", () => {
    expect(inicioBloque).toBeGreaterThan(-1);
    expect(finBloque).toBeGreaterThan(inicioBloque);
    expect(bloqueComprobante).toContain("puedeComprobantes");
  });

  it("35) el selector de período no lee ni escribe fEstado", () => {
    expect(bloqueComprobante).not.toContain("fEstado");
  });

  it("36) el selector de período no lee ni escribe fFechaDesde/fFechaHasta/modoAgrupacion (filtros del listado de abajo)", () => {
    expect(bloqueComprobante).not.toContain("fFechaDesde");
    expect(bloqueComprobante).not.toContain("fFechaHasta");
    expect(bloqueComprobante).not.toContain("modoAgrupacion");
  });

  it("descargarComprobante nunca usa fEstado/fFechaDesde/fFechaHasta/modoAgrupacion en su cuerpo", () => {
    const fn = src.slice(src.indexOf("async function descargarComprobante"), src.indexOf("\n  }", src.indexOf("async function descargarComprobante")));
    for (const filtroAjeno of ["fEstado", "fFechaDesde", "fFechaHasta", "modoAgrupacion"]) {
      expect(fn).not.toContain(filtroAjeno);
    }
  });
});
