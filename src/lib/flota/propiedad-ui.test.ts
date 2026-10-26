import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { PropiedadFields } from "@/app/e/[slug]/flota/propiedad-fields";
it("externo pide nombre y tipo sin selector de empresa propietaria", () => {
  const html = renderToStaticMarkup(createElement(PropiedadFields, { value: { tipoPropiedad: "EXTERNO", empresaPropietariaId: null, propietarioExterno: "Mensajero", tipoVehiculo: "Motocicleta" }, onChange: () => {}, empresas: [{ id: 1, nombre: "Empresa interna" }], input: "" }));
  expect(html).toContain("Nombre del propietario externo"); expect(html).toContain("Motocicleta");
  expect(html).not.toContain("Empresa interna"); expect(html).toContain("no recibe acceso");
});
it("propio muestra empresa actual y admite conservar una inactiva", () => {
  const html = renderToStaticMarkup(createElement(PropiedadFields, { value: { tipoPropiedad: "EMPRESA", empresaPropietariaId: 2, propietarioExterno: "", tipoVehiculo: "" }, onChange: () => {}, empresas: [{ id: 1, nombre: "Administradora" }], input: "", disabled: true }));
  expect(html).toContain("Empresa actual #2 (inactiva)"); expect(html).toContain("disabled"); expect(html).not.toContain("Nombre del propietario externo");
});
