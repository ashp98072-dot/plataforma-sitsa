import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TablaPreviewProveedorV2 } from "./combustible-preview-v2";
import { analizarProveedorV2 } from "@/lib/flota/combustible-importacion-v2";
import { fixtureHalelV2 } from "@/lib/flota/combustible-importacion-v2.fixture";

describe("vista previa común", () => {
  it("muestra candidatos, conflicto, origen, facturas y totales sin confirmar consumos", async () => {
    const data = await analizarProveedorV2(await fixtureHalelV2(), "HALEL");
    const html = renderToStaticMarkup(createElement(TablaPreviewProveedorV2, { data }));
    for (const text of ["Consumos candidatos: 21", "Conflictos bloqueados: 1", "CONFLICTO BLOQUEADO", "Fecha de consumo", "Serie / factura", "Celdas originales", "4000", "duplicados, conflictos, inválidas y posibles previos"]) expect(html).toContain(text);
    expect(html).not.toContain("Confirmar importación");
  });
});
