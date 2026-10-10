import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FacturaLineasForm, type ContextoFacturaApi, type EdicionFact4 } from "./factura-lineas-form";
import type { LineaBorrador } from "./factura-borrador-form";

/**
 * FACT-4 — estado INICIAL de «Preparar líneas de factura» (renderToStaticMarkup: los efectos y los fetch no corren). Verifica
 * lo estructural: columnas Cantidad | Descripción | Precio unitario | Valor, una línea por viaje al empezar, viajes de origen,
 * condición de pago, banco solo al contado y la retención bloqueada sin permiso. El comportamiento de agrupar/desagrupar está
 * probado sobre las funciones puras en `lineas-factura.test.ts`.
 */

const VIAJES: LineaBorrador[] = [
  { planId: 1, codigo: "PLAN-1", fechaPlan: "2026-09-01", placa: "C-1", tarifaComercial: 1000, montoAsignado: 1000, precioIncluyeIva: true, moneda: "GTQ", origen: "Guatemala", destino: "Xela" },
  { planId: 2, codigo: "PLAN-2", fechaPlan: "2026-09-02", placa: "C-2", tarifaComercial: 1000, montoAsignado: 1000, precioIncluyeIva: true, moneda: "GTQ", origen: "Guatemala", destino: "Xela" },
];

const CONTEXTO: ContextoFacturaApi = {
  fact4Disponible: true,
  entidades: [{ id: 1, codigo: "KT", nombre: "Kuiqtrans" }, { id: 2, codigo: "MON", nombre: "Logiservicios Mónaco" }],
  cuentasBancarias: [{ id: 5, entidadId: 2, entidadNombre: "Logiservicios Mónaco", banco: "Banco Industrial", alias: "Monetaria Q", referencia: "***1234", moneda: "GTQ" }],
  retencionIvaClientePct: 15,
  puedeCambiarRetencion: false,
  retencionesPermitidas: [0, 15, 30],
};

function render(over: { contexto?: Partial<ContextoFacturaApi>; edicion?: EdicionFact4; facturaId?: number } = {}) {
  return renderToStaticMarkup(
    createElement(FacturaLineasForm, {
      slug: "e", clienteId: 20, clienteNombre: "Cliente X", facturaId: over.facturaId,
      viajesIniciales: VIAJES, contexto: { ...CONTEXTO, ...over.contexto }, edicion: over.edicion,
      onGuardado: () => undefined, onCancelar: () => undefined,
    }),
  );
}

describe("FacturaLineasForm — estado inicial", () => {
  it("muestra las columnas Cantidad | Descripción | Precio unitario | Valor y una línea por viaje (punto de partida, no regla)", () => {
    const html = render();
    for (const t of ["Cantidad", "Descripción", "Precio unitario", "Valor", "Agrupar en una línea"]) expect(html, t).toContain(t);
    expect(html).toContain("Cantidad de la línea 1");
    expect(html).toContain("Cantidad de la línea 2");
    expect(html).not.toContain("Cantidad de la línea 3");
    // descripción sugerida a partir del viaje y los viajes de origen (trazabilidad) visibles
    expect(html).toContain("Servicio de transporte");
    expect(html).toContain("PLAN-1");
    expect(html).toContain("PLAN-2");
  });

  it("agrupar está deshabilitado hasta marcar dos líneas; no hay ninguna acción FEL ni contable", () => {
    const html = render();
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Agrupar en una línea/);
    expect(html).not.toMatch(/FEL|certificar|póliza|asiento/i);
  });

  it("condición de pago CRÉDITO por defecto: sin selector de banco; entidad obligatoria cuando hay varias", () => {
    const html = render();
    expect(html).toContain('aria-label="Condición de pago"');
    expect(html).not.toContain('aria-label="Cuenta bancaria"');
    expect(html).toContain("— Elegir —"); // entidad sin preseleccionar (hay 2)
  });

  it("con una sola entidad, queda preseleccionada y bloqueada", () => {
    const html = render({ contexto: { entidades: [{ id: 9, codigo: "KT", nombre: "Kuiqtrans" }] } });
    expect(html).toMatch(/<select[^>]*disabled[^>]*>\s*<option value="9" selected/);
  });

  it("al editar un borrador CONTADO muestra la cuenta bancaria elegida y la retención congelada", () => {
    const html = render({
      facturaId: 77,
      edicion: {
        lineas: [{ planIds: [1, 2], cantidad: 2, descripcion: "2 servicios", precioUnitario: 1000, clasificacion: "SERVICIO", precioIncluyeIva: true }],
        entidadId: 2, condicionPago: "CONTADO", cuentaBancariaId: 5, retencionIvaPct: 30,
      },
    });
    expect(html).toContain("Editar Borrador #77");
    expect(html).toContain('aria-label="Cuenta bancaria"');
    expect(html).toContain("Banco Industrial");
    expect(html).toMatch(/<option value="5" selected/);
    expect(html).toMatch(/<option value="30" selected/);
    expect(html).toContain("Cantidad de la línea 1");
    expect(html).not.toContain("Cantidad de la línea 2"); // las dos viajes agrupados en una línea
  });

  it("la retención está BLOQUEADA sin el permiso y recuerda la del cliente; con permiso se habilita", () => {
    const sin = render();
    expect(sin).toMatch(/<select[^>]*aria-label="Retención de IVA"[^>]*disabled|<select[^>]*disabled[^>]*aria-label="Retención de IVA"/);
    expect(sin).toContain("Configurada para el cliente: 15 %");
    expect(sin).toContain("Editar requisitos de clientes");
    const con = render({ contexto: { puedeCambiarRetencion: true } });
    expect(con).not.toMatch(/<select[^>]*aria-label="Retención de IVA"[^>]*disabled/);
    expect(con).not.toMatch(/<select[^>]*disabled[^>]*aria-label="Retención de IVA"/);
  });

  it("precarga la retención del cliente (15) en una factura nueva", () => {
    expect(render()).toMatch(/<option value="15" selected/);
  });
});
