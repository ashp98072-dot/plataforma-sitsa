import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantProgramacion: vi.fn() }));
vi.mock("@/lib/tms/programacion-import-excel", () => ({
  generarPlantillaProgramacion: vi.fn(),
  parsearExcelProgramacion: vi.fn(),
}));
vi.mock("@/lib/tms/programacion-import", () => ({
  previsualizarImportacionProgramacion: vi.fn(),
  confirmarImportacionProgramacion: vi.fn(),
}));

import { requireTenantProgramacion } from "@/lib/tenant";
import { generarPlantillaProgramacion, parsearExcelProgramacion } from "@/lib/tms/programacion-import-excel";
import { previsualizarImportacionProgramacion, confirmarImportacionProgramacion } from "@/lib/tms/programacion-import";
import { GET, POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "sitsa" }) };

/**
 * TMS-IMPORTACION-PROGRAMACION-EXCEL (PR 6 de 6) — el endpoint es
 * puramente de integración: no reimplementa ninguna regla ya cerrada en
 * los PR 1-5, así que estos tests mockean las 4 funciones de las que
 * depende (parsearExcelProgramacion / generarPlantillaProgramacion /
 * previsualizarImportacionProgramacion / confirmarImportacionProgramacion)
 * y verifican SOLO el trabajo del endpoint: guard, forma del
 * multipart/form-data, límites de archivo, y que la respuesta HTTP
 * refleje fielmente lo que devuelven esas funciones — nunca más, nunca
 * menos.
 */
function filaExcelFixture(overrides: Partial<{
  filaExcel: number; fechaSalidaExcel: string | null; horaSalidaExcel: string | null;
  codigoRutaExcel: string; clienteExcel: string; pilotoCodigoExcel: string; placaExcel: string;
  auxiliar1CodigoExcel: string; auxiliar2CodigoExcel: string; tipoTrasladoExcel: string;
  tarifaExcel: number | null; fechaRegresoExcel: string | null; horaRegresoExcel: string | null;
  observacionesExcel: string; erroresSintacticos: string[];
}> = {}) {
  return {
    filaExcel: 4,
    fechaSalidaExcel: "2026-09-20",
    horaSalidaExcel: "08:00",
    codigoRutaExcel: "1001",
    clienteExcel: "123456-7",
    pilotoCodigoExcel: "P-1",
    placaExcel: "P-123ABC",
    auxiliar1CodigoExcel: "",
    auxiliar2CodigoExcel: "",
    tipoTrasladoExcel: "Carga completa",
    tarifaExcel: 1500,
    fechaRegresoExcel: "2026-09-20",
    horaRegresoExcel: "17:00",
    observacionesExcel: "",
    erroresSintacticos: [],
    ...overrides,
  };
}

function reqConArchivo(opts: { accion?: string; nombre?: string; bytes?: Uint8Array; sinArchivo?: boolean } = {}): Request {
  const form = new FormData();
  if (!opts.sinArchivo) {
    form.append(
      "archivo",
      new File([(opts.bytes ?? new Uint8Array([1, 2, 3])) as BlobPart], opts.nombre ?? "programacion.xlsx", {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      }),
    );
  }
  if (opts.accion !== undefined) form.append("accion", opts.accion);
  return new Request("http://localhost/x", { method: "POST", body: form });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantProgramacion).mockResolvedValue(
    { empresa: { id: 7, nombre: "SITSA" }, session: { id: 8, username: "ops1" } } as Awaited<ReturnType<typeof requireTenantProgramacion>>,
  );
});
afterEach(() => vi.restoreAllMocks());

describe("GET /tms/programacion/importar — descarga de plantilla", () => {
  it("con permiso 'ver': genera y descarga la plantilla con el Content-Type/Content-Disposition correctos", async () => {
    vi.mocked(generarPlantillaProgramacion).mockResolvedValue(Buffer.from("xlsx-bytes"));
    const res = await GET(new Request("http://localhost/x"), ctx);

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe(
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    expect(res.headers.get("Content-Disposition")).toContain("excel-modelo-programacion.xlsx");
    expect(requireTenantProgramacion).toHaveBeenCalledWith("sitsa", "ver");
    expect(generarPlantillaProgramacion).toHaveBeenCalledWith(7);
  });

  it("sin permiso: devuelve el error del guard sin generar nada", async () => {
    vi.mocked(requireTenantProgramacion).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<
      ReturnType<typeof requireTenantProgramacion>
    >);
    const res = await GET(new Request("http://localhost/x"), ctx);
    expect(res.status).toBe(403);
    expect(generarPlantillaProgramacion).not.toHaveBeenCalled();
  });
});

describe("POST /tms/programacion/importar — validaciones de archivo/request", () => {
  it("archivo ausente: 400, sin llamar al parser", async () => {
    const res = await POST(reqConArchivo({ sinArchivo: true, accion: "validar" }), ctx);
    expect(res.status).toBe(400);
    expect(parsearExcelProgramacion).not.toHaveBeenCalled();
  });

  it("acción inválida: 400, sin llamar al parser", async () => {
    const res = await POST(reqConArchivo({ accion: "borrar" }), ctx);
    expect(res.status).toBe(400);
    expect(parsearExcelProgramacion).not.toHaveBeenCalled();
  });

  it("extensión inválida (no .xlsx): 400, sin llamar al parser", async () => {
    const res = await POST(reqConArchivo({ accion: "validar", nombre: "programacion.csv" }), ctx);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain(".xlsx");
    expect(parsearExcelProgramacion).not.toHaveBeenCalled();
  });

  it("archivo mayor a 15 MB: 400, sin llamar al parser", async () => {
    const bytes = new Uint8Array(15 * 1024 * 1024 + 1);
    const res = await POST(reqConArchivo({ accion: "validar", bytes }), ctx);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toContain("15 MB");
    expect(parsearExcelProgramacion).not.toHaveBeenCalled();
  });

  it("el parser rechaza el archivo (encabezado alterado, >500 filas, etc.): 400 con el mensaje real del parser", async () => {
    vi.mocked(parsearExcelProgramacion).mockRejectedValue(new Error("Encabezado inválido en la columna A."));
    const res = await POST(reqConArchivo({ accion: "validar" }), ctx);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("Encabezado inválido en la columna A.");
    expect(previsualizarImportacionProgramacion).not.toHaveBeenCalled();
  });

  it("el archivo parsea a 0 filas de datos: 400, sin llamar a previsualizar", async () => {
    vi.mocked(parsearExcelProgramacion).mockResolvedValue([]);
    const res = await POST(reqConArchivo({ accion: "validar" }), ctx);
    expect(res.status).toBe(400);
    expect(previsualizarImportacionProgramacion).not.toHaveBeenCalled();
  });
});

describe("POST /tms/programacion/importar — accion=validar", () => {
  it("archivo válido: llama previsualizarImportacionProgramacion con la empresa de la sesión y las filas parseadas, y NUNCA llama a confirmar (no escribe nada)", async () => {
    const filas = [filaExcelFixture()];
    vi.mocked(parsearExcelProgramacion).mockResolvedValue(filas);
    vi.mocked(previsualizarImportacionProgramacion).mockResolvedValue({
      filas: [{ filaExcel: 4, estado: "ok", errores: [], advertencias: [], datos: {
        rutaId: 10, rutaCodigo: "1001", clienteId: 5, clienteNombre: "Acme S.A.",
        pilotoEmpleadoId: 20, pilotoNombre: "Juan Pérez", pilotoPersonalId: null,
        auxiliares: [], unidadPlaca: "P-123ABC", unidadId: null, tarifaVigente: 1500,
        regresoEstimado: "2026-09-20T17:00", lugarCargaTexto: null, destinoDescripcion: null,
        contactoNombre: null, contactoCargo: null, contactoTelefono: null,
      } }],
      resumen: { totalFilas: 1, filasOk: 1, filasConError: 0 },
    });

    const res = await POST(reqConArchivo({ accion: "validar" }), ctx);
    expect(res.status).toBe(200);
    expect(previsualizarImportacionProgramacion).toHaveBeenCalledWith(7, filas);
    expect(confirmarImportacionProgramacion).not.toHaveBeenCalled();

    const data = await res.json();
    expect(data.accion).toBe("validar");
    expect(data.resumen).toEqual({ totalFilas: 1, filasOk: 1, filasConError: 0 });
    expect(data.filas).toHaveLength(1);
    expect(data.filas[0]).toMatchObject({
      filaExcel: 4,
      estado: "ok",
      errores: [],
      advertencias: [],
      // Crudo del Excel, para que la UI pueda mostrarlo si hace falta.
      codigoRutaExcel: "1001",
      pilotoCodigoExcel: "P-1",
    });
    // Lo mostrado como "resuelto" viene de BD, no del texto del Excel.
    expect(data.filas[0].resuelto).toMatchObject({
      rutaCodigo: "1001",
      clienteNombre: "Acme S.A.",
      pilotoNombre: "Juan Pérez",
      unidadPlaca: "P-123ABC",
      tarifaVigente: 1500,
    });
  });

  it("preview con errores: la fila con error no trae 'resuelto', pero sí conserva el crudo del Excel y los mensajes de error", async () => {
    const filas = [filaExcelFixture({ codigoRutaExcel: "9999" })];
    vi.mocked(parsearExcelProgramacion).mockResolvedValue(filas);
    vi.mocked(previsualizarImportacionProgramacion).mockResolvedValue({
      filas: [{ filaExcel: 4, estado: "error", errores: ['La ruta "9999" no existe.'], advertencias: [], datos: null }],
      resumen: { totalFilas: 1, filasOk: 0, filasConError: 1 },
    });

    const res = await POST(reqConArchivo({ accion: "validar" }), ctx);
    const data = await res.json();
    expect(data.resumen.filasConError).toBe(1);
    expect(data.filas[0].estado).toBe("error");
    expect(data.filas[0].errores).toEqual(['La ruta "9999" no existe.']);
    expect(data.filas[0].resuelto).toBeNull();
    expect(data.filas[0].codigoRutaExcel).toBe("9999"); // crudo, para que el usuario vea qué escribió
  });
});

describe("POST /tms/programacion/importar — accion=importar", () => {
  it("archivo válido: calcula un hash SHA-256 real y llama confirmarImportacionProgramacion con empresa/usuario/nombre/hash/filas — nunca llama a previsualizar", async () => {
    const filas = [filaExcelFixture()];
    vi.mocked(parsearExcelProgramacion).mockResolvedValue(filas);
    vi.mocked(confirmarImportacionProgramacion).mockResolvedValue({
      resultado: "exitoso", filasTotales: 1, filasImportadas: 1, planIds: [501],
    });

    const res = await POST(reqConArchivo({ accion: "importar", nombre: "lote-septiembre.xlsx" }), ctx);
    expect(res.status).toBe(200);
    expect(previsualizarImportacionProgramacion).not.toHaveBeenCalled();
    expect(confirmarImportacionProgramacion).toHaveBeenCalledOnce();
    const [empresaId, usuario, nombreArchivo, hashArchivo, filasLlamada] = vi.mocked(confirmarImportacionProgramacion).mock.calls[0];
    expect(empresaId).toBe(7);
    expect(usuario).toBe("ops1");
    expect(nombreArchivo).toBe("lote-septiembre.xlsx");
    expect(hashArchivo).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(filasLlamada).toEqual(filas);

    const data = await res.json();
    expect(data.accion).toBe("importar");
    expect(data.resultado).toEqual({ resultado: "exitoso", filasTotales: 1, filasImportadas: 1, planIds: [501] });
  });

  it("importar devuelve error de validación por fila: la respuesta HTTP sigue siendo 200 con el detalle por fila tal cual lo entrega confirmarImportacionProgramacion, sin reinterpretarlo", async () => {
    vi.mocked(parsearExcelProgramacion).mockResolvedValue([filaExcelFixture(), filaExcelFixture({ filaExcel: 5, codigoRutaExcel: "9999" })]);
    vi.mocked(confirmarImportacionProgramacion).mockResolvedValue({
      resultado: "error",
      mensaje: "1 de 2 fila(s) no pasaron la validación. No se importó ninguna fila (todo o nada).",
      erroresPorFila: [{ filaExcel: 5, errores: ['La ruta "9999" no existe.'] }],
    });

    const res = await POST(reqConArchivo({ accion: "importar" }), ctx);
    expect(res.status).toBe(200); // el rechazo es una respuesta de negocio válida, no un error HTTP
    const data = await res.json();
    expect(data.resultado.resultado).toBe("error");
    expect(data.resultado.erroresPorFila).toEqual([{ filaExcel: 5, errores: ['La ruta "9999" no existe.'] }]);
  });

  it("éxito: la respuesta expone filasImportadas y planIds tal como los devuelve confirmarImportacionProgramacion", async () => {
    vi.mocked(parsearExcelProgramacion).mockResolvedValue([filaExcelFixture(), filaExcelFixture({ filaExcel: 5 })]);
    vi.mocked(confirmarImportacionProgramacion).mockResolvedValue({
      resultado: "exitoso", filasTotales: 2, filasImportadas: 2, planIds: [501, 502],
    });

    const res = await POST(reqConArchivo({ accion: "importar" }), ctx);
    const data = await res.json();
    expect(data.resultado.filasImportadas).toBe(2);
    expect(data.resultado.planIds).toEqual([501, 502]);
  });

  it("fallo inesperado (excepción no controlada) de confirmarImportacionProgramacion: 500, sin exponer el detalle interno del error", async () => {
    vi.mocked(parsearExcelProgramacion).mockResolvedValue([filaExcelFixture()]);
    vi.mocked(confirmarImportacionProgramacion).mockRejectedValue(new Error("ECONNRESET detalle interno de BD"));

    const res = await POST(reqConArchivo({ accion: "importar" }), ctx);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).not.toContain("ECONNRESET");
    expect(data.error).toContain("No se guardó ningún cambio");
  });
});
