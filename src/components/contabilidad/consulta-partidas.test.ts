import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ConsultaPartidas } from "./consulta-partidas";
it("muestra totales y botón de lectura sin controles de escritura", () => {
  const html = renderToStaticMarkup(createElement(ConsultaPartidas, { url: "/api?entidad=9",
    asientos: [{ id: 12, numero: "P-1", fecha: "2026-08-31", glosa: "<script>prueba</script>", total_debe: "0.30", total_haber: "0.30" }] }));
  expect(html).toContain("Ver detalle");
  expect(html).toContain("0.30");
  expect(html).not.toContain("disabled");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("Eliminar");
});
it("lista vacía no ofrece partidas ficticias", () => {
  const html = renderToStaticMarkup(createElement(ConsultaPartidas, { url: "/api?entidad=9", asientos: [] }));
  expect(html).toContain("Sin partidas registradas");
  expect(html).not.toContain("Ver detalle");
});
