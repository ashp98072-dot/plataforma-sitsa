import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { sincronizarScroll, TablaConBarraHorizontal } from "./tabla-con-barra-horizontal";

describe("sincronización de la barra horizontal", () => {
  it("copia scrollLeft solo si difiere y nunca entra en bucle", () => {
    const tabla = { scrollLeft: 0 }, barra = { scrollLeft: 0 };
    expect(sincronizarScroll(barra, tabla)).toBe(false); // iguales: no hay asignación (no dispara scroll)
    barra.scrollLeft = 340;
    expect(sincronizarScroll(barra, tabla)).toBe(true); // barra → tabla
    expect(tabla.scrollLeft).toBe(340);
    expect(sincronizarScroll(tabla, barra)).toBe(false); // el eco tabla → barra ya no hace nada
    tabla.scrollLeft = 12;
    expect(sincronizarScroll(tabla, barra)).toBe(true); // tabla → barra
    expect(barra.scrollLeft).toBe(12);
    expect(sincronizarScroll(barra, tabla)).toBe(false);
  });
  it("tolera elementos ausentes", () => {
    expect(sincronizarScroll(null, { scrollLeft: 1 })).toBe(false);
    expect(sincronizarScroll({ scrollLeft: 1 }, null)).toBe(false);
  });
});

describe("contenedor de la tabla", () => {
  it("conserva la barra nativa (overflow-x-auto) y la barra extra nace oculta, solo ≥ lg y sin leer a los lectores de pantalla", () => {
    const html = renderToStaticMarkup(createElement(TablaConBarraHorizontal as never, { className: "rounded-xl" }, createElement("table")));
    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("data-tabla-scroll");
    expect(html).toMatch(/data-barra-horizontal[^>]*aria-hidden="true"[^>]*class="hidden"|class="hidden"[^>]*data-barra-horizontal/);
  });
  it("la barra visible es sticky abajo, solo en lg+, y no toca el scroll vertical", () => {
    const src = readFileSync("src/components/tms/tabla-con-barra-horizontal.tsx", "utf8");
    expect(src).toContain("sticky bottom-0");
    expect(src).toContain("hidden overflow-x-auto overflow-y-hidden");
    expect(src).toContain("lg:block");
    expect(src).not.toMatch(/setTimeout|setInterval|requestAnimationFrame|scrollTop|window\.scroll/);
  });
});

describe("Planes / Viajes: columna Vehículo solicitado y columnas fijas", () => {
  const cliente = readFileSync("src/app/e/[slug]/planes/planes-viajes-client.tsx", "utf8");
  const css = readFileSync("src/app/globals.css", "utf8");
  it("columna propia entre Ruta y Placa / Unidad (cabecera y celda en la misma posición)", () => {
    const cols = cliente.slice(cliente.indexOf("const columnas = ["), cliente.indexOf("return (", cliente.indexOf("const columnas = [")));
    expect(cols).toMatch(/"Código", "Fecha", "Cliente", "Ruta", ETIQUETA_VEHICULO_SOLICITADO, "Placa \/ Unidad", "Piloto"/);
    const fila = cliente.slice(cliente.indexOf('{p.rutaCodigo ?? "—"}'), cliente.indexOf("<PilotosCelda"));
    expect(fila.indexOf("celda-vehiculo-solicitado")).toBeGreaterThan(-1);
    expect(fila.indexOf("celda-vehiculo-solicitado")).toBeLessThan(fila.indexOf("{p.placa"));
  });
  it("el dato mostrado es la fotografía guardada en el viaje (no se recalcula desde ruta, catálogo ni unidad)", () => {
    expect(cliente).toContain("textoVehiculoSolicitado(p.vehiculoSolicitado)");
    expect(cliente).not.toMatch(/vehiculoSolicitado\s*=\s*.*(unidadCapacidad|rutaCodigo)/);
  });
  it("solo 4 columnas fijas, solo en ≥ 1024 px y con fondo opaco heredado de la fila", () => {
    expect(cliente).toContain('"Sel.": "col-fija col-sel", "Código": "col-fija col-codigo", "Fecha": "col-fija col-fecha", "Cliente": "col-fija col-cliente"');
    const bloque = css.slice(css.indexOf("PLANES / VIAJES — columnas fijas"));
    expect(bloque).toContain("@media (min-width: 1024px)");
    expect(bloque).toContain("background-color: inherit");
    expect(bloque.match(/position: sticky/g)).toHaveLength(1);
    expect(cliente.match(/col-fija /g)!.length).toBeGreaterThanOrEqual(4);
  });
  it("las filas de grupo siguen ocupando todo el ancho (colSpan) y las columnas no cambian la lógica de cierre/selección", () => {
    expect(cliente).toContain("colSpan={columnas.length}");
    expect(cliente).toContain("alternarSeleccion(p)");
  });
});
