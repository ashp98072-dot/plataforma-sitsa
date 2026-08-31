import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import { CapturaPartida } from "./captura-partida";

it("renderiza captura vacía sin valores demo ni registro automático", () => {
  const guardar = vi.fn();
  const html = renderToStaticMarkup(createElement(CapturaPartida, {
    cuentas: [{ id: 1, codigo: "1101", nombre: "Cuenta de prueba" }], ocupado: false, guardar,
  }));
  expect(html).toContain("Número de partida");
  expect(html).toContain("Cuenta línea 1");
  expect(html).toContain("Cuenta línea 2");
  expect(html).toContain("Total Debe: Q0.00");
  expect(html).toContain("Cuenta de prueba");
  expect(html).not.toContain("Asiento demo");
  expect(guardar).not.toHaveBeenCalled();
});
it("sin cuentas informa requisito y deshabilita registro", () => {
  const html = renderToStaticMarkup(createElement(CapturaPartida, { cuentas: [], ocupado: false, guardar: vi.fn() }));
  expect(html).toContain("Crea una cuenta activa");
  expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Registrar partida/);
});
it("bloquea la captura durante una operación en curso", () => {
  const html = renderToStaticMarkup(createElement(CapturaPartida, { cuentas: [], ocupado: true, guardar: vi.fn() }));
  expect(html).toMatch(/<fieldset[^>]*disabled=""/);
});
