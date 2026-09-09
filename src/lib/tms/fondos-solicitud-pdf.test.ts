import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import PDFDocument from "pdfkit";

vi.mock("@/lib/tms/fondos", () => ({ obtenerSolicitudFondo: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/uploads", () => ({ absPathFromRelative: vi.fn((r: string) => `/abs/${r}`) }));
vi.mock("fs", () => ({ existsSync: vi.fn(() => false), readFileSync: vi.fn() }));

import { obtenerSolicitudFondo } from "@/lib/tms/fondos";
import { query } from "@/lib/db";
import { existsSync, readFileSync } from "fs";
import { generarPdfSolicitudFondoAutorizada } from "./fondos-solicitud-pdf";

/**
 * SOLICITUD-FONDOS-PDF-AUTORIZADO-1 — mismo criterio que
 * viaticos-comprobante-pdf.test.ts: pdfkit comprime el contenido
 * (FlateDecode), así que se espía PDFDocument.prototype.text (delegando
 * a la implementación real) para verificar EXACTAMENTE qué texto se
 * dibuja, y se cuentan páginas con el marcador estructural `/Type /Page`
 * (no comprimido) en vez de inspeccionar el stream de contenido.
 */
function espiarTexto() {
  return vi.spyOn(PDFDocument.prototype, "text");
}
function llamadaTexto(call: unknown[]): { texto: string; opciones: Record<string, unknown> | undefined } {
  const opciones = call.find((a): a is Record<string, unknown> => typeof a === "object" && a !== null && !Array.isArray(a));
  return { texto: String(call[0]), opciones };
}
function contarPaginas(buf: Buffer): number {
  return (buf.toString("latin1").match(/\/Type\s*\/Page(?!s)\b/g) ?? []).length;
}

function linea(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, categoria: "Combustible", descripcion: "Diesel", cantidad: 2, monto: 100, orden: 0,
    fechaViaje: "2026-09-02", empleadoId: 4, empleadoNombre: "Heber Sitan", cargo: "Piloto", cuenta: "1234567890",
    vehiculoId: 9, placa: "P111AAA", clienteId: 5, clienteNombre: "Cliente A", planId: null,
    ...overrides,
  };
}

function solicitud(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 1, empresaId: 7, codigo: "FONDO-000001", requirenteEmpleadoId: null, requirenteNombre: "Mario Caal",
    fechaRequerimiento: "2026-09-04", total: 200, autorizanteEmpleadoId: null, autorizanteNombre: "Heber Sitan",
    estado: "Autorizada", autorizadoEn: "2026-09-04 10:00:00", rechazadoEn: null, motivoRechazo: null, liquidadoEn: null,
    observaciones: null, creadoPor: "mcaal", creadoEn: "2026-09-04 09:00:00",
    lineas: [linea()],
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(existsSync).mockReturnValue(false);
  // Default seguro: ninguna firma histórica ni usuario encontrado — los
  // tests que necesitan una fila real lo sobreescriben.
  vi.mocked(query).mockResolvedValue([] as never);
});
afterEach(() => vi.restoreAllMocks());

describe("generarPdfSolicitudFondoAutorizada — estado (§6 del ticket)", () => {
  it("solicitud inexistente -> 404, nunca genera un PDF", async () => {
    vi.mocked(obtenerSolicitudFondo).mockResolvedValue(null);
    const r = await generarPdfSolicitudFondoAutorizada(7, 999, "SITSA");
    expect(r).toEqual({ ok: false, status: 404, error: "Solicitud no encontrada." });
  });

  it.each(["Pendiente", "Rechazada"] as const)("estado %s -> 400, NUNCA se presenta como PDF autorizado", async (estado) => {
    vi.mocked(obtenerSolicitudFondo).mockResolvedValue(solicitud({ estado }) as never);
    const r = await generarPdfSolicitudFondoAutorizada(7, 1, "SITSA");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.error).toContain(estado);
    }
  });

  it("Autorizada -> genera el PDF oficial", async () => {
    vi.mocked(obtenerSolicitudFondo).mockResolvedValue(solicitud({ estado: "Autorizada" }) as never);
    const r = await generarPdfSolicitudFondoAutorizada(7, 1, "SITSA");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
  });

  it("Liquidada conserva acceso al MISMO PDF histórico (autorizado)", async () => {
    vi.mocked(obtenerSolicitudFondo).mockResolvedValue(solicitud({ estado: "Liquidada", liquidadoEn: "2026-09-05 08:00:00" }) as never);
    const r = await generarPdfSolicitudFondoAutorizada(7, 1, "SITSA");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.buffer.subarray(0, 4).toString("latin1")).toBe("%PDF");
      expect(r.nombreArchivo).toBe("solicitud-fondo-FONDO-000001.pdf");
    }
  });
});

describe("generarPdfSolicitudFondoAutorizada — tabla de detalle (§2 del ticket)", () => {
  it("dibuja EXACTAMENTE las 10 columnas pedidas, en este orden", async () => {
    vi.mocked(obtenerSolicitudFondo).mockResolvedValue(solicitud() as never);
    const spy = espiarTexto();
    await generarPdfSolicitudFondoAutorizada(7, 1, "SITSA");
    const textos = spy.mock.calls.map((c) => llamadaTexto(c).texto);
    const idxFecha = textos.indexOf("Fecha de solicitud");
    expect(idxFecha).toBeGreaterThanOrEqual(0);
    expect(textos.slice(idxFecha, idxFecha + 10)).toEqual([
      "Fecha de solicitud", "Fecha de viaje", "Nombre", "Cuenta", "Cargo", "Placa", "Cliente", "Cantidad", "Descripción", "Valor",
    ]);
  });

  it("incluye la columna Cuenta con el snapshot de la línea (empleados.cuenta_bancaria congelado)", async () => {
    vi.mocked(obtenerSolicitudFondo).mockResolvedValue(solicitud({ lineas: [linea({ cuenta: "9988776655" })] }) as never);
    const spy = espiarTexto();
    await generarPdfSolicitudFondoAutorizada(7, 1, "SITSA");
    const textos = spy.mock.calls.map((c) => llamadaTexto(c).texto);
    expect(textos).toContain("9988776655");
  });

  it("línea sin empleado/vehículo/cliente asociado muestra '—' en Cuenta (nunca revienta ni inventa un dato)", async () => {
    vi.mocked(obtenerSolicitudFondo).mockResolvedValue(solicitud({
      lineas: [linea({ empleadoId: null, empleadoNombre: null, cargo: null, cuenta: null, vehiculoId: null, placa: null, clienteId: null, clienteNombre: null, fechaViaje: null })],
    }) as never);
    const r = await generarPdfSolicitudFondoAutorizada(7, 1, "SITSA");
    expect(r.ok).toBe(true);
  });

  it("cantidad centrada y Valor alineado a la derecha", async () => {
    vi.mocked(obtenerSolicitudFondo).mockResolvedValue(solicitud() as never);
    const spy = espiarTexto();
    await generarPdfSolicitudFondoAutorizada(7, 1, "SITSA");
    const llamadas = spy.mock.calls.map(llamadaTexto);
    const cantidad = llamadas.find((c) => c.texto === "2");
    const valor = llamadas.find((c) => c.texto === "Q 200.00");
    expect(cantidad?.opciones?.align).toBe("center");
    expect(valor?.opciones?.align).toBe("right");
  });

  it("nunca hace JOIN en vivo a empleados/flota/clientes: usa SOLO el snapshot ya guardado en la línea", async () => {
    vi.mocked(obtenerSolicitudFondo).mockResolvedValue(solicitud() as never);
    await generarPdfSolicitudFondoAutorizada(7, 1, "SITSA");
    const sqlsConsultados = vi.mocked(query).mock.calls.map((c) => String(c[0]));
    for (const sql of sqlsConsultados) {
      expect(sql).not.toMatch(/FROM empleados|FROM flota_vehiculos|FROM tms_clientes/);
    }
  });
});

describe("generarPdfSolicitudFondoAutorizada — total (§3 del ticket)", () => {
  it("el TOTAL mostrado es la suma real de las líneas, NUNCA el valor ya guardado en la solicitud si no coincide", async () => {
    // total desalineado a propósito (350 guardado vs 200 real de sus líneas)
    vi.mocked(obtenerSolicitudFondo).mockResolvedValue(solicitud({ total: 350, lineas: [linea({ cantidad: 2, monto: 100 })] }) as never);
    const spy = espiarTexto();
    await generarPdfSolicitudFondoAutorizada(7, 1, "SITSA");
    const textos = spy.mock.calls.map((c) => llamadaTexto(c).texto);
    expect(textos).toContain("TOTAL: Q 200.00");
    expect(textos).not.toContain("TOTAL: Q 350.00");
  });

  it("suma correctamente varias líneas con cantidad y monto distintos", async () => {
    vi.mocked(obtenerSolicitudFondo).mockResolvedValue(solicitud({
      lineas: [linea({ id: 1, cantidad: 2, monto: 100 }), linea({ id: 2, cantidad: 1, monto: 8650 })],
    }) as never);
    const spy = espiarTexto();
    await generarPdfSolicitudFondoAutorizada(7, 1, "SITSA");
    const textos = spy.mock.calls.map((c) => llamadaTexto(c).texto);
    expect(textos).toContain("TOTAL: Q 8,850.00");
  });
});

describe("generarPdfSolicitudFondoAutorizada — firmas (§4/§5 del ticket)", () => {
  it("muestra el nombre real del autorizante (ya guardado en autorizanteNombre) en el bloque de firma", async () => {
    vi.mocked(obtenerSolicitudFondo).mockResolvedValue(solicitud({ autorizanteNombre: "Heber Sitan" }) as never);
    const spy = espiarTexto();
    await generarPdfSolicitudFondoAutorizada(7, 1, "SITSA");
    const textos = spy.mock.calls.map((c) => llamadaTexto(c).texto);
    expect(textos).toContain("FIRMA DEL AUTORIZANTE");
    expect(textos).toContain("Heber Sitan");
  });

  it("si autorizanteNombre quedó guardado como username (bug pre-existente ya corregido en el endpoint), lo resuelve al nombre real vía usuarios.nombre", async () => {
    vi.mocked(obtenerSolicitudFondo).mockResolvedValue(solicitud({ autorizanteNombre: "hsitan" }) as never);
    vi.mocked(query).mockImplementation((async (sql: string, params?: unknown[]) => {
      if (sql.includes("FROM usuarios") && (params as unknown[])?.[0] === "hsitan") return [{ nombre: "Heber Sitan" }];
      return [];
    }) as typeof query);
    const spy = espiarTexto();
    await generarPdfSolicitudFondoAutorizada(7, 1, "SITSA");
    const textos = spy.mock.calls.map((c) => llamadaTexto(c).texto);
    expect(textos).toContain("Heber Sitan");
    expect(textos).not.toContain("hsitan");
  });

  it("resuelve el nombre real del SOLICITANTE (creadoPor guarda username) — nunca muestra el username", async () => {
    vi.mocked(obtenerSolicitudFondo).mockResolvedValue(solicitud({ creadoPor: "mcaal" }) as never);
    vi.mocked(query).mockImplementation((async (sql: string, params?: unknown[]) => {
      if (sql.includes("FROM usuarios") && (params as unknown[])?.[0] === "mcaal") return [{ nombre: "Mario Caal Jr." }];
      return [];
    }) as typeof query);
    const spy = espiarTexto();
    await generarPdfSolicitudFondoAutorizada(7, 1, "SITSA");
    const textos = spy.mock.calls.map((c) => llamadaTexto(c).texto);
    expect(textos).toContain("FIRMA DEL SOLICITANTE");
    expect(textos).toContain("Mario Caal Jr.");
    expect(textos).not.toContain("mcaal");
  });

  it("sin ningún dato en usuarios ni rol en ningún lugar del documento — nunca aparece '(admin)' ni un rol entre paréntesis", async () => {
    vi.mocked(obtenerSolicitudFondo).mockResolvedValue(solicitud() as never);
    const spy = espiarTexto();
    await generarPdfSolicitudFondoAutorizada(7, 1, "SITSA");
    const textos = spy.mock.calls.map((c) => llamadaTexto(c).texto);
    for (const t of textos) {
      expect(t).not.toContain("(admin)");
      expect(t).not.toContain("(usuario)");
    }
  });

  it("firma histórica de autorización con imagen (firmas_electronicas, modulo FONDOS): se consulta acotada por empresa/entidad y no revienta el PDF", async () => {
    const PNG_1X1 = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
      "base64",
    );
    vi.mocked(obtenerSolicitudFondo).mockResolvedValue(solicitud() as never);
    vi.mocked(query).mockImplementation((async (sql: string, params?: unknown[]) => {
      if (sql.includes("firmas_electronicas")) {
        expect(sql).toContain("modulo = 'FONDOS'");
        expect(sql).toContain("entidad_tipo = 'SOLICITUD_FONDO'");
        expect(params).toEqual([7, 1]);
        return [{ payload_canonico: JSON.stringify({ nombreFirmante: "Ana Gómez" }), imagen_ruta: "firmas/x.png", imagen_mime: "image/png" }];
      }
      return [];
    }) as typeof query);
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readFileSync).mockReturnValue(PNG_1X1 as never);
    const spy = espiarTexto();
    const r = await generarPdfSolicitudFondoAutorizada(7, 1, "SITSA");
    expect(r.ok).toBe(true);
    // La firma histórica SÍ manda sobre autorizanteNombre cuando existe.
    const textos = spy.mock.calls.map((c) => llamadaTexto(c).texto);
    expect(textos).toContain("Ana Gómez");
  });

  it("sin flujo de firma manuscrita para Fondos (caso actual): requirente y solicitante muestran nombre + espacio en blanco, sin inventar ninguna firma", async () => {
    vi.mocked(obtenerSolicitudFondo).mockResolvedValue(solicitud({ requirenteNombre: "Mario Caal" }) as never);
    const spy = espiarTexto();
    await generarPdfSolicitudFondoAutorizada(7, 1, "SITSA");
    const textos = spy.mock.calls.map((c) => llamadaTexto(c).texto);
    expect(textos).toContain("FIRMA DEL REQUIRIENTE");
    expect(textos).toContain("Mario Caal");
  });
});

describe("generarPdfSolicitudFondoAutorizada — multiempresa (§11 del ticket)", () => {
  it("consulta la solicitud SIEMPRE con el empresaId del guard del endpoint, nunca uno distinto", async () => {
    vi.mocked(obtenerSolicitudFondo).mockResolvedValue(solicitud() as never);
    await generarPdfSolicitudFondoAutorizada(7, 1, "SITSA");
    expect(obtenerSolicitudFondo).toHaveBeenCalledWith(7, 1);
  });

  it("la firma histórica se busca acotada a empresa_id + entidad_id (nunca a otra empresa)", async () => {
    vi.mocked(obtenerSolicitudFondo).mockResolvedValue(solicitud({ id: 42 }) as never);
    await generarPdfSolicitudFondoAutorizada(9, 42, "SITSA");
    const llamadaFirma = vi.mocked(query).mock.calls.find((c) => String(c[0]).includes("firmas_electronicas"));
    expect(llamadaFirma?.[1]).toEqual([9, 42]);
  });

  it("solicitud inexistente para esta empresa (obtenerSolicitudFondo ya filtra por empresa_id) -> 404, nunca datos de otra empresa", async () => {
    vi.mocked(obtenerSolicitudFondo).mockResolvedValue(null); // simula id de otra empresa
    const r = await generarPdfSolicitudFondoAutorizada(9, 1, "SITSA");
    expect(r).toEqual({ ok: false, status: 404, error: "Solicitud no encontrada." });
  });
});

describe("generarPdfSolicitudFondoAutorizada — paginación (§8 del ticket)", () => {
  it("pocas líneas -> exactamente 1 página, sin páginas vacías", async () => {
    vi.mocked(obtenerSolicitudFondo).mockResolvedValue(solicitud() as never);
    const r = await generarPdfSolicitudFondoAutorizada(7, 1, "SITSA");
    expect(r.ok).toBe(true);
    if (r.ok) expect(contarPaginas(r.buffer)).toBe(1);
  });

  it("muchas líneas -> varias páginas, repitiendo el encabezado de la tabla en cada una", async () => {
    const muchasLineas = Array.from({ length: 40 }, (_, i) => linea({
      id: i + 1, descripcion: `Gasto de viaje número ${i + 1} con una descripción larga para forzar el ancho de columna`,
    }));
    vi.mocked(obtenerSolicitudFondo).mockResolvedValue(solicitud({ lineas: muchasLineas }) as never);
    const spy = espiarTexto();
    const r = await generarPdfSolicitudFondoAutorizada(7, 1, "SITSA");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(contarPaginas(r.buffer)).toBeGreaterThan(1);
      const repeticionesEncabezado = spy.mock.calls.filter((c) => llamadaTexto(c).texto === "Fecha de solicitud").length;
      expect(repeticionesEncabezado).toBeGreaterThan(1);
    }
  });

  it("las firmas y las notas de pie aparecen UNA sola vez, después de toda la tabla (nunca en medio de las líneas)", async () => {
    const muchasLineas = Array.from({ length: 40 }, (_, i) => linea({ id: i + 1 }));
    vi.mocked(obtenerSolicitudFondo).mockResolvedValue(solicitud({ lineas: muchasLineas }) as never);
    const spy = espiarTexto();
    await generarPdfSolicitudFondoAutorizada(7, 1, "SITSA");
    const textos = spy.mock.calls.map((c) => llamadaTexto(c).texto);
    expect(textos.filter((t) => t === "FIRMA DEL AUTORIZANTE")).toHaveLength(1);
    expect(textos.filter((t) => t === "Notas:")).toHaveLength(1);
  });
});

describe("generarPdfSolicitudFondoAutorizada — notas de pie (§7 del ticket)", () => {
  it("incluye las 5 notas y el lema final, tal como los pidió el ticket", async () => {
    vi.mocked(obtenerSolicitudFondo).mockResolvedValue(solicitud() as never);
    const spy = espiarTexto();
    await generarPdfSolicitudFondoAutorizada(7, 1, "SITSA");
    const textos = spy.mock.calls.map((c) => llamadaTexto(c).texto);
    expect(textos).toContain("1. Recordar que las facturas deben salir a nombre y NIT de la empresa requirente.");
    expect(textos).toContain("5. Se recomienda enviar los requerimientos con anticipación para programar los pagos.");
    expect(textos).toContain("EL ORDEN Y LA DISCIPLINA SON LA BASE PARA UN SERVICIO DE CALIDAD, EFICIENCIA Y SATISFACCIÓN A NUESTRO CLIENTE");
  });
});

describe("generarPdfSolicitudFondoAutorizada — encabezado (§1 del ticket)", () => {
  it("título centrado y los 3 datos pedidos, con datos reales de la solicitud", async () => {
    vi.mocked(obtenerSolicitudFondo).mockResolvedValue(solicitud({ fechaRequerimiento: "2026-09-04", requirenteNombre: "Mario Caal" }) as never);
    const spy = espiarTexto();
    await generarPdfSolicitudFondoAutorizada(7, 1, "TRANSPORTES SITSA KUIQ TRANS");
    const llamadas = spy.mock.calls.map(llamadaTexto);
    const titulo = llamadas.find((c) => c.texto === "SOLICITUD DE FONDO");
    expect(titulo?.opciones?.align).toBe("center");
    const textos = llamadas.map((c) => c.texto);
    expect(textos).toContain("FECHA DEL REQUERIMIENTO: 04/09/2026");
    expect(textos).toContain("EMPRESA REQUIRIENTE: TRANSPORTES SITSA KUIQ TRANS");
    expect(textos).toContain("PERSONA QUE REQUIERE: MARIO CAAL");
  });
});
