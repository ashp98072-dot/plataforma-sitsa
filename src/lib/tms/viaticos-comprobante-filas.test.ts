import { describe, expect, it } from "vitest";
import { filasComprobante, totalGeneralComprobante, type ViaticoComprobanteItem } from "./viaticos-comprobante-filas";

const ITEM_BASE: ViaticoComprobanteItem = {
  planCodigo: "VJ-001",
  fechaPlan: "2026-09-15",
  personalNombre: "Juan Pérez",
  rol: "Piloto",
  puesto: "Piloto Senior",
  unidadPlaca: "P-123ABC",
  cliente: "PriceSmart",
  lugarDescarga: "Zona 12",
  montoAsignado: 100,
};

describe("filasComprobante", () => {
  it("8. Fecha de solicitud: NO es una columna (no existe en tms_viaticos) — la fila no tiene esa propiedad", () => {
    const [fila] = filasComprobante([ITEM_BASE]);
    expect(fila).not.toHaveProperty("fechaSolicitud");
  });

  it("9. Fecha viaje: formatea fechaPlan (YYYY-MM-DD) a DD/MM/YYYY", () => {
    const [fila] = filasComprobante([ITEM_BASE]);
    expect(fila.fechaViaje).toBe("15/09/2026");
  });

  it("10. Nombre: se mapea tal cual", () => {
    const [fila] = filasComprobante([ITEM_BASE]);
    expect(fila.nombre).toBe("Juan Pérez");
  });

  it("12. Cargo: usa `puesto` cuando existe", () => {
    const [fila] = filasComprobante([ITEM_BASE]);
    expect(fila.cargo).toBe("Piloto Senior");
  });

  it("Cargo: cae a `rol` cuando puesto viene vacío/null (objeto de prueba sin el fallback de mapDetalle)", () => {
    const [fila] = filasComprobante([{ ...ITEM_BASE, puesto: "" }]);
    expect(fila.cargo).toBe("Piloto");
    const [fila2] = filasComprobante([{ ...ITEM_BASE, puesto: "   " }]);
    expect(fila2.cargo).toBe("Piloto");
  });

  it("13. Placa: se mapea tal cual; null -> '—'", () => {
    expect(filasComprobante([ITEM_BASE])[0].placa).toBe("P-123ABC");
    expect(filasComprobante([{ ...ITEM_BASE, unidadPlaca: null }])[0].placa).toBe("—");
  });

  it("14. Cliente: se mapea tal cual; null -> '—'", () => {
    expect(filasComprobante([ITEM_BASE])[0].cliente).toBe("PriceSmart");
    expect(filasComprobante([{ ...ITEM_BASE, cliente: null }])[0].cliente).toBe("—");
  });

  it("15. Cantidad: siempre 1 — invariante estructural (cada tms_viaticos ya es un único viático por persona/viaje), no un campo propio", () => {
    expect(filasComprobante([ITEM_BASE])[0].cantidad).toBe(1);
    expect(filasComprobante([{ ...ITEM_BASE, montoAsignado: 999 }])[0].cantidad).toBe(1);
  });

  it("16. Destino (Lugar de descarga): snapshot histórico de tms_planes_viaje.lugar_descarga_historico; null -> '—'", () => {
    expect(filasComprobante([ITEM_BASE])[0].lugarDescarga).toBe("Zona 12");
    expect(filasComprobante([{ ...ITEM_BASE, lugarDescarga: null }])[0].lugarDescarga).toBe("—");
  });

  it("17. Total: monto_asignado, número sin formatear (el PDF/Excel aplican su propio formato de moneda)", () => {
    expect(filasComprobante([ITEM_BASE])[0].total).toBe(100);
  });

  it("mapea varios items en el mismo orden recibido", () => {
    const items = [ITEM_BASE, { ...ITEM_BASE, planCodigo: "VJ-002", montoAsignado: 50 }];
    const filas = filasComprobante(items);
    expect(filas).toHaveLength(2);
    expect(filas[0].viaje).toBe("VJ-001");
    expect(filas[1].viaje).toBe("VJ-002");
  });
});

describe("totalGeneralComprobante", () => {
  it("suma exacta de los totales de las filas", () => {
    const filas = filasComprobante([ITEM_BASE, { ...ITEM_BASE, montoAsignado: 250.5 }]);
    expect(totalGeneralComprobante(filas)).toBe(350.5);
  });

  it("lista vacía -> 0", () => {
    expect(totalGeneralComprobante([])).toBe(0);
  });
});
