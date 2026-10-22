import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { CombustiblesClient } from "../combustibles-client";
import { capacidadesCombustible } from "@/lib/flota/combustible-permisos";
describe("ubicacion y compatibilidad de Combustibles", () => {
    it("conserva la unica opcion existente entre Planes/Viajes y Viaticos", () => { const nav = readFileSync("src/components/app-shell.tsx", "utf8"); expect(nav.match(/label: "Combustibles"/g)).toHaveLength(1); const planes = nav.indexOf('key: "planes"'), combustibles = nav.indexOf('key: "combustibles"'), viaticos = nav.indexOf('key: "viaticos"'); expect(planes).toBeLessThan(combustibles); expect(combustibles).toBeLessThan(viaticos); expect(nav).toContain('href: `${base}/combustibles`'); });
    it("misma pantalla conserva vales, estaciones y conciliacion historica", () => {
        const html = renderToStaticMarkup(createElement(CombustiblesClient, { slug: "demo", capacidades: capacidadesCombustible([], true), admin: true, actorId: 1 }));
        for (const text of ["Consumos y facturas de proveedor", "Registrar vale", "Estaciones de combustible", "Importaciones históricas / conciliación", "Vales actuales: revisión y conciliación"])
            expect(html).toContain(text);
        for (const ruta of ["/e/demo/combustibles/nuevo", "/e/demo/combustibles/estaciones", "/e/demo/combustibles/importaciones"])
            expect(html).toContain(ruta);
        expect(html).not.toContain("/flota/combustibles");
    });
});
