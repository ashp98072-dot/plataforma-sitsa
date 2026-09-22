import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const leer = (ruta: string) => readFileSync(ruta, "utf8").replace(/\r\n/g, "\n");

describe("Formulario de Cotizaciones — «Rutas adicionales» (AJUSTES FINALES: varias rutas por cotización)", () => {
  const page = leer("src/app/e/[slug]/cotizaciones/page.tsx");
  const pos = (texto: string) => {
    const i = page.indexOf(texto);
    expect(i, `no se encontró: ${texto}`).toBeGreaterThan(-1);
    return i;
  };

  it("la sección va después de los catálogos rápidos y antes de B. Presentación comercial (ruta principal arriba, adicionales después)", () => {
    const orden = ["CotizacionCatalogosRapidos", "Rutas adicionales (opcional)", "B. Presentación comercial"].map(pos);
    expect(orden).toEqual([...orden].sort((a, b) => a - b));
  });

  it("cada fila permite editar punto de carga, punto de descarga, unidad y precio — cada uno con su propio input", () => {
    const seccion = page.slice(pos("Rutas adicionales (opcional)"), pos("B. Presentación comercial"));
    expect(seccion).toContain("Punto de carga");
    expect(seccion).toContain("Punto de descarga");
    expect(seccion).toContain("value={l.origenTexto}");
    expect(seccion).toContain("value={l.destinoTexto}");
    expect(seccion).toContain("value={l.unidadDescripcion}");
    expect(seccion).toContain("value={l.tarifaCotizada}");
    expect(seccion).toContain("Quitar ruta");
    expect(seccion).toContain("Agregar ruta");
  });

  it("agregar/quitar/editar una línea usan setForm inmutable (map/filter), nunca mutan el arreglo en sitio", () => {
    expect(page).toContain("function agregarLinea() {");
    expect(page).toContain("function actualizarLinea(indice: number, cambios: Partial<LineaForm>) {");
    expect(page).toContain("function quitarLinea(indice: number) {");
    const agregar = page.slice(pos("function agregarLinea()"), pos("function actualizarLinea"));
    expect(agregar).toContain("lineasAdicionales: [...f.lineasAdicionales, { ...LINEA_FORM_VACIA }]");
    const actualizar = page.slice(pos("function actualizarLinea"), pos("function quitarLinea"));
    expect(actualizar).toContain("f.lineasAdicionales.map((l, i) => (i === indice ? { ...l, ...cambios } : l))");
    const quitar = page.slice(pos("function quitarLinea"), pos("function guardar()"));
    expect(quitar).toContain("f.lineasAdicionales.filter((_, i) => i !== indice)");
  });

  it("guardar(): descarta filas totalmente vacías, exige precio > 0 en las que sí tienen datos, y SIEMPRE manda lineasAdicionales (reemplazo completo al editar)", () => {
    const guardar = page.slice(pos("async function guardar()"), pos("async function cambiarEstado"));
    expect(guardar).toContain('l.origenTexto.trim() || l.destinoTexto.trim() || l.unidadDescripcion.trim() || l.tarifaCotizada.trim()');
    expect(guardar).toContain("if (lineasAdicionales.some((l) => !(l.tarifaCotizada > 0)))");
    expect(guardar).toContain("lineasAdicionales,");
  });

  it("editar(c) precarga las líneas adicionales ya guardadas de esa cotización", () => {
    const editar = page.slice(pos("function editar(c: Cotizacion)"), pos("function agregarLinea"));
    expect(editar).toContain("lineasAdicionales: (c.lineasAdicionales ?? []).map((l) => ({");
    expect(editar).toContain("tarifaCotizada: String(l.tarifaCotizada),");
  });

  it("«Nueva cotización» arranca sin rutas adicionales (FORM_VACIO incluye lineasAdicionales: [])", () => {
    expect(page).toContain("lineasAdicionales: [] as LineaForm[],");
  });

  it("el detalle de la lista muestra las rutas adicionales guardadas, cada una con su propio precio", () => {
    expect(page).toContain("Rutas adicionales:");
    expect(page).toContain("{l.origenTexto ?? \"—\"} → {l.destinoTexto ?? \"—\"} · {l.unidadDescripcion ?? \"—\"} · {money(l.tarifaCotizada)}");
  });

  it("el costeo interno nunca referencia rutas adicionales: sigue leyendo solo tarifaCotizada/incluyeIva de la línea principal", () => {
    const costeoPanel = page.slice(pos("<CotizacionCosteoPanel"), pos("<div className=\"flex gap-2\">"));
    expect(costeoPanel).not.toContain("lineasAdicionales");
  });
});
