import { existsSync, readFileSync, statSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { NovalvionIcono, NovalvionLogo } from "./novalvion-brand";

/**
 * Branding global Novalvion: solo presentación. Inspección de fuente + render estático (mismo criterio del repo, sin harness de
 * componentes). El nombre real de la empresa NO se reemplaza nunca por la marca de la plataforma.
 */
const leer = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const login = leer("src/app/login/page.tsx");
const layout = leer("src/app/layout.tsx");
const shell = leer("src/components/app-shell.tsx");
const selector = leer("src/app/select-empresa/page.tsx");

describe("assets de marca", () => {
  it("logo horizontal e icono existen bajo public/branding (no bajo public/brands de las empresas)", () => {
    for (const f of ["public/branding/novalvion-logo.png", "public/branding/novalvion-icon.png"]) {
      expect(existsSync(f)).toBe(true);
      expect(statSync(f).size).toBeGreaterThan(1000);
    }
    expect(existsSync("public/brands/kuiqtrans")).toBe(true); // logos de empresas intactos
    expect(existsSync("public/brands/monaco")).toBe(true);
  });
  it("favicon/app icon: src/app/icon.png (convención App Router) con el monograma; favicon.ico viejo reemplazado, no el logo horizontal", () => {
    expect(existsSync("src/app/icon.png")).toBe(true);
    const png = readFileSync("src/app/icon.png");
    expect(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))).toBe(true);
    // Icono cuadrado (monograma): ancho = alto en la cabecera IHDR.
    expect(png.readUInt32BE(16)).toBe(png.readUInt32BE(20));
    expect(existsSync("src/app/favicon.ico")).toBe(true);
    const ico = readFileSync("src/app/favicon.ico");
    expect(ico.readUInt16LE(0)).toBe(0); // cabecera ICO válida
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBeGreaterThanOrEqual(1);
  });
});

describe("componentes de marca", () => {
  it("logo horizontal: alt='Novalvion'; el monograma decorativo va aria-hidden sin alt", () => {
    const html = renderToStaticMarkup(createElement(NovalvionLogo));
    expect(html).toContain('src="/branding/novalvion-logo.png"');
    expect(html).toContain('alt="Novalvion"');
    const icono = renderToStaticMarkup(createElement(NovalvionIcono));
    expect(icono).toContain('src="/branding/novalvion-icon.png"');
    expect(icono).toContain('aria-hidden="true"');
    expect(icono).toContain('alt=""');
  });
  it("tema claro: el texto del PNG es casi blanco, así que se muestra monograma + texto vivo con colores del tema", () => {
    const html = renderToStaticMarkup(createElement(NovalvionLogo));
    expect(html).toContain("Novalvion</span>");
    expect(html).toContain("Plataforma Corporativa");
    expect(html).toContain("var(--text)");
    expect(html).toContain("[[data-theme=light]_&amp;]:hidden"); // el PNG se oculta en claro
  });
});

describe("login", () => {
  it("ya no presenta el producto como Grupo SITSA y muestra Novalvion", () => {
    expect(login).not.toContain("Grupo SITSA");
    expect(login).not.toMatch(/SITSA/);
    expect(login).toContain('import { NovalvionLogo } from "@/components/novalvion-brand"');
    expect(login).toContain("<NovalvionLogo");
    expect(login).toContain("Plataforma Corporativa"); // nombre accesible del h1
    expect(login).toContain("Multiempresa · RRHH · TMS · Flota · Contabilidad");
  });
  it("no cambia el comportamiento: mismos endpoints y redirects", () => {
    expect(login).toContain('fetch("/api/auth/login"');
    expect(login).toContain('fetch("/api/auth/select-empresa"');
    expect(login).toContain('router.push("/select-empresa")');
    expect(login).toContain("if (data.redirect)");
  });
});

describe("metadata", () => {
  it("título y descripción globales son Novalvion, sin SITSA", () => {
    expect(layout).toContain('title: "Novalvion | Plataforma Corporativa"');
    expect(layout).toContain('description: "Plataforma corporativa para RRHH, TMS, Flota y Contabilidad"');
    expect(layout).not.toMatch(/title: "SITSA/);
  });
  it("no se renombra la clave de tema en localStorage (preferencias existentes de los usuarios)", () => {
    expect(layout).toContain("localStorage.getItem('sitsa-theme')");
  });
});

describe("app-shell (sidebar)", () => {
  it("muestra la marca Novalvion y CONSERVA el nombre de la empresa activa, usuario y rol", () => {
    expect(shell).toContain('import { NovalvionIcono } from "@/components/novalvion-brand"');
    expect(shell).toContain(">Novalvion</p>");
    expect(shell).toContain("Empresa activa");
    expect(shell).toContain("{empresaNombre}");
    expect(shell).toContain("{username} · {labelRol(rol)}");
    expect(shell).not.toMatch(/>\s*SITSA\s*</);
  });
  it("el nombre de la empresa sigue siendo el <h1> y va después de la marca", () => {
    const iMarca = shell.indexOf(">Novalvion</p>");
    const iEmpresa = shell.indexOf("{empresaNombre}", iMarca);
    expect(iMarca).toBeGreaterThan(0);
    expect(iEmpresa).toBeGreaterThan(iMarca);
    expect(shell.slice(iMarca, iEmpresa)).toContain("<h1");
  });
  it("la marca nunca sustituye empresaNombre/slug/tenant", () => {
    expect(shell).not.toMatch(/empresaNombre\s*=\s*["'`]Novalvion/);
    expect(shell).not.toMatch(/\{\s*["']Novalvion["']\s*\}/);
  });
});

describe("selector de empresa", () => {
  it("muestra la marca Novalvion y mantiene los nombres reales de cada empresa", () => {
    expect(selector).toContain(">Novalvion</p>");
    expect(selector).toContain("Seleccionar empresa");
    expect(selector).toContain("{e.nombre}");
    expect(selector).toContain("{e.codigo}");
    expect(selector).not.toMatch(/SITSA/);
  });
});

describe("alcance: sin tocar tenant/dominios/auth", () => {
  it("middleware (tenant/dominios) sin referencias nuevas a Novalvion", () => {
    expect(leer("src/middleware.ts")).not.toMatch(/novalvion/i);
  });
});
