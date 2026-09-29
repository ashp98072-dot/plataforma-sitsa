import { expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));

import { redirect } from "next/navigation";
import EntrevistasRedirect from "./page";

/**
 * ATRACCION-TALENTO-1 (sección 19 del ticket) — la ruta histórica
 * /e/[slug]/rrhh/entrevistas ya NO renderiza el calendario: redirige de
 * forma permanente a /e/[slug]/atraccion-talento/entrevistas, preservando
 * la query string. Nunca 404.
 */
it("9) redirige a la nueva ruta bajo atraccion-talento", async () => {
  await EntrevistasRedirect({
    params: Promise.resolve({ slug: "kt-monaco" }),
    searchParams: Promise.resolve({}),
  });
  expect(redirect).toHaveBeenCalledWith("/e/kt-monaco/atraccion-talento/entrevistas");
});

it("preserva la query string cuando existe (p. ej. un futuro deep-link ?entrevista=ID)", async () => {
  await EntrevistasRedirect({
    params: Promise.resolve({ slug: "kt-monaco" }),
    searchParams: Promise.resolve({ entrevista: "41" }),
  });
  expect(redirect).toHaveBeenCalledWith("/e/kt-monaco/atraccion-talento/entrevistas?entrevista=41");
});

it("usa el slug real de la empresa (nunca un valor fijo)", async () => {
  await EntrevistasRedirect({
    params: Promise.resolve({ slug: "sitsa" }),
    searchParams: Promise.resolve({}),
  });
  expect(redirect).toHaveBeenCalledWith("/e/sitsa/atraccion-talento/entrevistas");
});
