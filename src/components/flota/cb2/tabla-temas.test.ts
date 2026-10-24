import { readFileSync } from "node:fs";
import { parse } from "postcss";
import { expect, it } from "vitest";

const globales = parse(readFileSync("src/app/globals.css", "utf8"));
const tabla = parse(readFileSync("src/components/flota/cb2/panel.module.css", "utf8"));
const rgb = (hex: string) => hex.replace("#", "").match(/../g)!.map(n => parseInt(n, 16));
function luminancia(rgb: number[]) {
    const c = rgb.map(n => { const v = n / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
    return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
}
function contraste(a: number[], b: number[]) {
    const x = luminancia(a), y = luminancia(b);
    return (Math.max(x, y) + .05) / (Math.min(x, y) + .05);
}

// Prueba numérica de los colores declarados, no de renderizado ni del scroll.
it.each(["light", "dark"])("texto secundario de la tabla supera 4,5:1 en tema %s", tema => {
    const tokens = new Map<string, string>();
    globales.walkRules(rule => {
        if (rule.selectors.includes(`[data-theme="${tema}"]`)) rule.walkDecls(d => { tokens.set(d.prop, d.value); });
    });
    let mezcla = "";
    tabla.walkDecls("--cb2-review-muted", d => { mezcla = d.value; });
    const partes = mezcla.match(/^color-mix\(in srgb, var\((--[\w-]+)\) (\d+)%[, ]+var\((--[\w-]+)\)\)$/)!;
    expect(partes).not.toBeNull();
    const a = rgb(tokens.get(partes[1])!), b = rgb(tokens.get(partes[3])!), peso = Number(partes[2]) / 100;
    const texto = a.map((n, i) => n * peso + b[i] * (1 - peso));
    for (const superficie of ["--card", "--bg", "--thead"]) {
        expect(contraste(texto, rgb(tokens.get(superficie)!)), superficie).toBeGreaterThanOrEqual(4.5);
    }
});
