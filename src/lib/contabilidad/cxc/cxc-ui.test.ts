import { existsSync, readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CxcClient } from "@/components/contabilidad/cxc-client";

const leer = (f: string) => readFileSync(f, "utf8");
const cliente = leer("src/components/contabilidad/cxc-client.tsx");
const general = leer("src/app/e/[slug]/contabilidad/page.tsx");
const layout = leer("src/app/e/[slug]/contabilidad/layout.tsx");

describe("navegación de Contabilidad", () => {
  it("el menú separa Cuentas y asientos, Cuentas por cobrar, Cuentas por pagar y Configurar libros contables, en ese orden", () => {
    const i = [">Cuentas y asientos<", ">Cuentas por cobrar<", ">Cuentas por pagar<", ">Configurar libros contables<"].map((t) => layout.indexOf(t));
    expect(i.every((x) => x > -1)).toBe(true);
    expect([...i].sort((a, b) => a - b)).toEqual(i);
    expect(layout).toContain("/contabilidad/cxc`");
    expect(existsSync("src/app/e/[slug]/contabilidad/cxc/page.tsx")).toBe(true);
  });
  it("la página de CxC exige el permiso propio cxc_cuentas y pasa cxc_cobros a la UI (nunca permisos de Facturación)", () => {
    const page = leer("src/app/e/[slug]/contabilidad/cxc/page.tsx");
    expect(page).toContain('p("cxc_cuentas", "ver")');
    expect(page).toContain('p("cxc_cobros", "editar")');
    expect(page).not.toMatch(/facturacion/i);
  });
});

describe("pantalla de CxC", () => {
  const props = { slug: "e", puedeVer: true, puedeCobrar: true };
  it("rotula el origen real (Facturación), el saldo informativo, y la separación del registro manual", () => {
    const html = renderToStaticMarkup(createElement(CxcClient, props));
    expect(html).toContain("Cuentas por cobrar");
    expect(html).toMatch(/total de la factura − cobros registrados/);
    expect(html).toMatch(/no es la cartera legal de Milenium/);
    expect(html).toMatch(/registros manuales anteriores se consultan aparte/);
    expect(html).toContain("Seleccionar entidad");
  });
  it("sin permiso no muestra nada operativo", () => {
    const html = renderToStaticMarkup(createElement(CxcClient, { ...props, puedeVer: false, puedeCobrar: false }));
    expect(html).toContain("Sin permiso para ver Cuentas por cobrar");
    expect(html).not.toContain("Cobrar");
  });
  it("pestañas Documentos, Cobros y Registros manuales (legado); sin pestaña de configuración/clientes (no hay lógica que la respalde)", () => {
    for (const t of [">Documentos<", ">Cobros<", ">Registros manuales (legado)<"]) expect(cliente).toContain(t);
    expect(cliente).not.toMatch(/Clientes y configuración|Configuración de clientes/);
  });
  it("columnas de documentos: Fecha, Cliente, Documento, Total, Cobrado, Saldo, Situación; filtros y búsqueda", () => {
    for (const c of ['"Fecha"', '"Cliente"', '"Documento"', '"Total"', '"Cobrado"', '"Saldo"', '"Situación"']) expect(cliente).toContain(c);
    for (const t of ["Buscar cliente", "Buscar factura / documento", 'aria-label="Situación"', "Desde", "Hasta"]) expect(cliente).toContain(t);
  });
  it("el cobro solo se ofrece con permiso, sobre factura Emitida con saldo; no hay reversión (no existe) ni edición de cobros", () => {
    expect(cliente).toMatch(/puedeCobrar && x\.estadoAdmin === "Emitida" && Number\(x\.saldoInformativo\) > 0/);
    expect(cliente).not.toMatch(/Reversar|reversar|anular cobro|Anular/);
    expect(cliente).toContain("no existe esa función");
  });
  it("el cliente no calcula saldos: solo muestra lo que devuelve el servidor", () => {
    expect(cliente).not.toMatch(/Decimal|monto\s*-\s*|totalPagado\s*[-+]|montoOriginal\s*-/);
    expect(cliente).toContain("x.saldoInformativo");
  });
  it("el registro manual legado es solo lectura: la UI nunca hace POST a /contabilidad/cxc ni lo suma a saldos", () => {
    const legado = cliente.slice(cliente.indexOf("function LegadoManual"));
    expect(legado).not.toMatch(/method:\s*"POST"|api\(/);
    expect(legado).toContain("no forman parte de los saldos de Cuentas por cobrar");
  });
});

describe("retiro seguro del bloque antiguo y preservación de cont_cxc", () => {
  it("la pantalla general ya no tiene el formulario CxC/CxP ni el listado CxC; conserva cuentas, partidas y consulta", () => {
    for (const t of ['placeholder="Cliente CxC"', 'placeholder="Proveedor CxP"', "crearCxc", "crearCxp", "setCxc", "<h2 className=\"font-medium\">CxC ("]) expect(general).not.toContain(t);
    for (const t of ["crearCuenta", "CapturaPartida", "ConsultaPartidas", "Cuentas por cobrar y Cuentas por pagar tienen su propia pantalla"]) expect(general).toContain(t);
    expect(general).not.toMatch(/guardar\("cx[cp]"/);
  });
  it("los registros manuales de CxP siguen visibles en solo lectura (no se pierde acceso a datos sin otra pantalla)", () => {
    expect(general).toContain("legado, solo lectura");
    expect(general).toContain('"cxp"');
  });
  it("la API legada /contabilidad/cxc (GET/POST) y la tabla cont_cxc NO se eliminan ni se alteran; no hay migración nueva", () => {
    const legada = leer("src/app/api/empresas/[slug]/contabilidad/cxc/route.ts");
    expect(legada).toContain("export async function GET");
    expect(legada).toContain("export async function POST");
    const registros = leer("src/lib/contabilidad/registros.ts");
    expect(registros).toContain("INSERT INTO cont_cxc");
    expect(existsSync("sql/migrate-2026-11-cxc-contabilidad.sql")).toBe(false);
  });
  it("el código nuevo de CxC nunca escribe ni lee cont_cxc ni hace DDL/DML sobre tablas de CxP", () => {
    for (const f of ["src/lib/contabilidad/cxc/cxc.ts", "src/lib/contabilidad/cxc/http.ts"]) {
      const src = leer(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      expect(src, f).not.toMatch(/cont_cxc|cont_cxp|cxp_|ALTER TABLE|CREATE TABLE|DROP |DELETE FROM|UPDATE\s+\w+\s+SET/i);
      expect(src, f).not.toMatch(/INSERT INTO/i); // los cobros se insertan SOLO vía registrarPago de Facturación
    }
  });
  it("los cobros reutilizan registrarPago de Facturación (sobrepago, bloqueo y auditoría) y no duplican su lógica", () => {
    const src = leer("src/lib/contabilidad/cxc/cxc.ts");
    expect(src).toContain('import { registrarPago } from "@/lib/facturacion/facturas"');
    expect(src).toContain("listarCuentasPorCobrar");
  });
});
