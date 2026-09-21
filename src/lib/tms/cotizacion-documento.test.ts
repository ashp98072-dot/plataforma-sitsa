import { describe, expect, it } from "vitest";
import { COTIZACION_DOC } from "./cotizacion-documento.fixture";
import {
  DOCUMENTOS_EMISOR,
  DOCUMENTO_EMISOR_DEFAULT,
  MARCAS_DOCUMENTO,
  condicionesComerciales,
  construirDocumentoComercial,
  encabezadoPrecio,
  esDocumentoEmisor,
  fechaLarga,
  formatoMoneda,
  lineasComerciales,
  nombreArchivoCotizacionPdf,
  normalizarDocumentoEmisor,
  textoOpcional,
} from "./cotizacion-documento";

describe("catálogo de marcas del documento", () => {
  it("solo KUIQTRANS y MONACO; el default explícito es KUIQTRANS", () => {
    expect([...DOCUMENTOS_EMISOR]).toEqual(["KUIQTRANS", "MONACO"]);
    expect(DOCUMENTO_EMISOR_DEFAULT).toBe("KUIQTRANS");
    expect(MARCAS_DOCUMENTO.KUIQTRANS.nombre).toBe("KuiqTrans");
    expect(MARCAS_DOCUMENTO.MONACO.nombre).toBe("Logiservicios Mónaco");
  });

  it("esDocumentoEmisor valida el catálogo cerrado (sin normalizar mayúsculas ni espacios)", () => {
    expect(esDocumentoEmisor("KUIQTRANS")).toBe(true);
    expect(esDocumentoEmisor("MONACO")).toBe(true);
    for (const malo of ["kuiqtrans", "Monaco", " MONACO", "SITSA", "", null, undefined, 1]) expect(esDocumentoEmisor(malo)).toBe(false);
  });

  it("lectura de histórico: ausente o desconocido cae a KUIQTRANS; valores válidos se respetan", () => {
    expect(normalizarDocumentoEmisor(undefined)).toBe("KUIQTRANS");
    expect(normalizarDocumentoEmisor(null)).toBe("KUIQTRANS");
    expect(normalizarDocumentoEmisor("OTRA")).toBe("KUIQTRANS");
    expect(normalizarDocumentoEmisor("MONACO")).toBe("MONACO");
  });

  it("cada marca tiene su propio texto introductorio (no es la misma plantilla con otro nombre)", () => {
    expect(MARCAS_DOCUMENTO.KUIQTRANS.saludo).not.toBe(MARCAS_DOCUMENTO.MONACO.saludo);
    expect(MARCAS_DOCUMENTO.MONACO.saludo).toContain("Es un gusto saludarles");
  });
});

describe("semántica única del IVA", () => {
  it("el encabezado de la columna declara la base del precio", () => {
    expect(encabezadoPrecio(false)).toBe("Precio sin IVA");
    expect(encabezadoPrecio(true)).toBe("Precio IVA incluido");
  });

  it("el documento imprime siempre tarifaCotizada como precio (sin subtotal ni total + IVA)", () => {
    for (const incluyeIva of [true, false]) {
      const doc = construirDocumentoComercial({ ...COTIZACION_DOC, incluyeIva, tarifaCotizada: 1234.5 });
      expect(doc.lineas[0].precio).toBe(1234.5);
      expect(doc.encabezadoPrecio).toBe(incluyeIva ? "Precio IVA incluido" : "Precio sin IVA");
    }
  });
});

describe("líneas y condiciones comerciales", () => {
  it("una cotización = una línea con origen, destino, unidad y precio; preparado para varias líneas", () => {
    expect(lineasComerciales(COTIZACION_DOC)).toEqual([
      { origen: "Bodega Zona 12", destino: "Puerto Barrios, Izabal", unidad: "Camión 5 toneladas", precio: 1400 },
    ]);
    expect(Array.isArray(construirDocumentoComercial(COTIZACION_DOC).lineas)).toBe(true);
  });

  it("campos vacíos se muestran con guion, sin inventar valores", () => {
    const [linea] = lineasComerciales({ ...COTIZACION_DOC, origenTexto: null, destinoTexto: "  ", unidadDescripcion: null });
    expect(linea).toMatchObject({ origen: "—", destino: "—", unidad: "—" });
  });

  it("solo lista condiciones que aplican, en orden, con km y tarifa por km", () => {
    expect(condicionesComerciales(COTIZACION_DOC)).toEqual([
      "Piloto incluido", "GPS", "Seguro contra terceros", "Servicio refrigerado",
      "50 km incluidos", "Q12.50 por km adicional", "Pago contra entrega.", "Vigencia sujeta a disponibilidad.",
    ]);
  });

  it("no imprime «No» para lo que no aplica: todo apagado => sin condiciones", () => {
    const vacio = condicionesComerciales({
      ...COTIZACION_DOC, pilotoIncluido: false, gpsIncluido: false, seguroMercaderiaIncluido: false, seguroTercerosIncluido: false,
      servicioRefrigerado: false, kmIncluidos: null, tarifaKmAdicional: null, condicionesAdicionales: null,
    });
    expect(vacio).toEqual([]);
  });

  it("servicio refrigerado solo aparece como texto «Servicio refrigerado» (sin parámetros internos)", () => {
    const items = condicionesComerciales({ ...COTIZACION_DOC, servicioRefrigerado: true }).join("|");
    expect(items).toContain("Servicio refrigerado");
    expect(items.toLowerCase()).not.toMatch(/thermo|deprec/);
  });
});

describe("construirDocumentoComercial: datos guardados en la fila", () => {
  it("toma marca, atención, cargo y unidad de la cotización guardada", () => {
    const doc = construirDocumentoComercial(COTIZACION_DOC);
    expect(doc.emisor).toBe("MONACO");
    expect(doc.marca.nombre).toBe("Logiservicios Mónaco");
    expect(doc).toMatchObject({ cliente: "Distribuidora Ejemplo, S.A.", atencionNombre: "Claudia Cordero", atencionCargo: "Compras / Logística" });
    expect(doc.observaciones).toEqual(["Cliente frecuente."]);
  });

  it("atención y cargo son opcionales (vacíos => null)", () => {
    const doc = construirDocumentoComercial({ ...COTIZACION_DOC, atencionNombre: "  ", atencionCargo: null });
    expect(doc.atencionNombre).toBeNull();
    expect(doc.atencionCargo).toBeNull();
  });

  it("cotización histórica sin marca guardada sale como KuiqTrans", () => {
    const doc = construirDocumentoComercial({ ...COTIZACION_DOC, documentoEmisor: undefined as never });
    expect(doc.emisor).toBe("KUIQTRANS");
  });

  it("la marca no se deduce de cliente, ruta, empresa ni nombre: solo de documentoEmisor", () => {
    const monaco = construirDocumentoComercial({ ...COTIZACION_DOC, clienteNombre: "KuiqTrans", documentoEmisor: "MONACO" });
    const kuiq = construirDocumentoComercial({ ...COTIZACION_DOC, clienteNombre: "Logiservicios Mónaco", documentoEmisor: "KUIQTRANS" });
    expect(monaco.emisor).toBe("MONACO");
    expect(kuiq.emisor).toBe("KUIQTRANS");
  });
});

describe("helpers de formato", () => {
  it("moneda y fecha larga en es-GT", () => {
    expect(formatoMoneda(1400)).toBe("Q1,400.00");
    expect(formatoMoneda(1400, "USD")).toBe("USD 1,400.00");
    expect(fechaLarga("2026-09-08")).toBe("8 de septiembre de 2026");
    expect(fechaLarga(null)).toBe("");
  });

  it("textoOpcional recorta y convierte vacío en null", () => {
    expect(textoOpcional("  hola ")).toBe("hola");
    expect(textoOpcional("   ")).toBeNull();
    expect(textoOpcional(undefined)).toBeNull();
  });
});

describe("nombre de archivo del PDF", () => {
  it("COT-000123-KuiqTrans.pdf / COT-000123-Monaco.pdf", () => {
    expect(nombreArchivoCotizacionPdf("COT-000123", "KUIQTRANS")).toBe("COT-000123-KuiqTrans.pdf");
    expect(nombreArchivoCotizacionPdf("COT-000123", "MONACO")).toBe("COT-000123-Monaco.pdf");
  });

  it("sanitiza el código (sin comillas, saltos de línea, rutas ni espacios) y cae a KuiqTrans si la marca es desconocida", () => {
    const nombre = nombreArchivoCotizacionPdf('COT-1"\r\n../x y', "??");
    expect(nombre).toBe("COT-1xy-KuiqTrans.pdf");
    expect(nombre).toMatch(/^[A-Za-z0-9_-]+-KuiqTrans\.pdf$/);
    expect(nombreArchivoCotizacionPdf("", "MONACO")).toBe("COTIZACION-Monaco.pdf");
  });

  it("no incluye nombre de cliente ni datos internos", () => {
    const nombre = nombreArchivoCotizacionPdf(COTIZACION_DOC.codigo, COTIZACION_DOC.documentoEmisor);
    expect(nombre).not.toContain("Distribuidora");
    expect(nombre).toBe("COT-000123-Monaco.pdf");
  });
});
