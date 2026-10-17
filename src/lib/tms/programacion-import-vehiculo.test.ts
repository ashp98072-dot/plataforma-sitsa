import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/operaciones/disponibilidad", () => ({ listarDisponibilidadVehiculos: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
vi.mock("@/lib/tms/personal-resolucion", () => ({ personalDesdeEmpleado: vi.fn(async () => 500) }));
vi.mock("@/lib/tms/plan-comunes", () => ({ upsertLugar: vi.fn(async () => 1), guardarAuxiliaresPlan: vi.fn(async () => undefined) }));
vi.mock("@/lib/tms/paradas", () => ({ guardarParadasPlan: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/tms/viaticos", () => ({ sincronizarViaticosPlan: vi.fn(async () => undefined) }));
vi.mock("@/lib/tms/ruta-tarifas", () => ({ tarifasActivasDeVariasRutas: vi.fn(async () => new Map()) }));
vi.mock("@/lib/tms/codigo-plan", () => ({ asegurarCodigoPlanUnico: vi.fn(async () => "PLAN-NUEVO") }));

import { getPool, query } from "@/lib/db";
import { listarDisponibilidadVehiculos } from "@/lib/operaciones/disponibilidad";
import {
  ENCABEZADO_TC,
  ENCABEZADO_VEHICULO,
  ENCABEZADOS_PROGRAMACION,
  generarPlantillaProgramacion,
  parsearExcelProgramacion,
  type FilaProgramacionExcel,
} from "./programacion-import-excel";
import { confirmarImportacionProgramacion, previsualizarImportacionProgramacion } from "./programacion-import";

/**
 * Invariante: ningún viaje nuevo creado por Programación queda sin «Vehículo solicitado». La importación Excel lo exige
 * por fila (columna O: nombre o código del perfil), lo valida contra los perfiles ACTIVOS de la empresa en la vista
 * previa —antes de cualquier INSERT— y guarda id + snapshot del nombre en el mismo INSERT. Nunca se infiere.
 */

// ---------------------------------------------------------------- parser + plantilla
async function libro(cabeceras: string[], filas: (string | number)[][] = []): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Programacion");
  ws.addRow(cabeceras);
  const ejemplo = ["2026-09-20", "08:00", "EJEMPLO-NO-IMPORTAR", "x", "1", "P-0", "", "", "", 0, "", "", "", "", ""];
  ws.addRow(ejemplo);
  ws.addRow(ejemplo);
  for (const f of filas) ws.addRow(f);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const base13 = [...ENCABEZADOS_PROGRAMACION];
const datos13 = ["2026-09-21", "09:00", "1001", "123456-7", "P-1", "p-123abc", "", "", "Carga", 1500, "2026-09-21", "17:00", "obs"];

describe("parser: columna «Vehículo solicitado» (O)", () => {
  it("archivo de 15 columnas: lee el texto con espacios normalizados", async () => {
    const filas = await parsearExcelProgramacion(await libro([...base13, ENCABEZADO_TC, ENCABEZADO_VEHICULO], [[...datos13, "", "  Camión   5 toneladas "]]));
    expect(filas[0].vehiculoSolicitadoExcel).toBe("Camión 5 toneladas");
    expect(filas[0].erroresSintacticos).toEqual([]); // la obligatoriedad se valida contra el catálogo en la vista previa
  });

  it("archivos antiguos (13 y 14 columnas) se siguen leyendo, pero SIN propiedad de vehículo (la vista previa los rechaza)", async () => {
    const f13 = await parsearExcelProgramacion(await libro(base13, [datos13]));
    const f14 = await parsearExcelProgramacion(await libro([...base13, ENCABEZADO_TC], [[...datos13, ""]]));
    expect("vehiculoSolicitadoExcel" in f13[0]).toBe(false);
    expect("vehiculoSolicitadoExcel" in f14[0]).toBe(false);
  });

  it("encabezado desconocido en la columna 15 o columna 15 sin la 14 (TC): se rechaza el archivo, no se adivina", async () => {
    await expect(parsearExcelProgramacion(await libro([...base13, ENCABEZADO_TC, "Otra cosa"], [[...datos13, "", "x"]]))).rejects.toThrow(/columna O/);
    await expect(parsearExcelProgramacion(await libro([...base13, "", ENCABEZADO_VEHICULO], [[...datos13, "", "x"]]))).rejects.toThrow(/columna N/);
  });

  it("una fila que solo trae vehículo (resto vacío) no se ignora como vacía", async () => {
    const filas = await parsearExcelProgramacion(await libro([...base13, ENCABEZADO_TC, ENCABEZADO_VEHICULO], [["", "", "", "", "", "", "", "", "", "", "", "", "", "", "Cabezal"]]));
    expect(filas).toHaveLength(1);
    expect(filas[0].erroresSintacticos.length).toBeGreaterThan(0);
  });
});

describe("plantilla: incluye «Vehículo solicitado» con el catálogo ACTIVO de la empresa", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(listarDisponibilidadVehiculos).mockResolvedValue({ vehiculos: [] } as never);
    vi.mocked(query).mockImplementation((async (sql: string, params: unknown[]) => {
      if (String(sql).includes("FROM tms_cotizacion_costeo_perfiles")) {
        expect(String(sql)).toContain("empresa_id = ?");
        expect(String(sql)).toContain("activo = 1");
        expect(params).toEqual([7]);
        return [{ id: 11, codigo: "CAM_5T", nombre: "Camión 5 toneladas" }, { id: 12, codigo: "CABEZAL", nombre: "Cabezal" }];
      }
      return [];
    }) as never);
  });

  it("columna 15, hoja de catálogo, dropdown e instrucciones; el ejemplo trae vehículo y el archivo se lee con su propio parser", async () => {
    const buf = await generarPlantillaProgramacion(7);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet("Programacion")!;
    expect(ws.getCell(1, 14).value).toBe(ENCABEZADO_TC);
    expect(ws.getCell(1, 15).value).toBe("Vehículo solicitado");
    expect(ws.getCell(2, 15).value).toBeTruthy();
    expect((ws.getCell(4, 15).dataValidation as { formulae?: string[] }).formulae).toEqual(["LISTA_VEHICULOS_SOLICITABLES"]);
    const hoja = wb.getWorksheet("VehiculosSolicitables")!;
    expect((hoja.getColumn(1).values as unknown[]).slice(2)).toEqual(["Camión 5 toneladas", "Cabezal"]);
    const instrucciones = (wb.getWorksheet("Instrucciones")!.getColumn(1).values as unknown[]).map(String);
    expect(instrucciones).toContain("Vehículo solicitado *");
    expect(await parsearExcelProgramacion(buf)).toEqual([]);
  });
});

// ---------------------------------------------------------------- vista previa y confirmación
const flota = [{ id: 1, placa: "P-123ABC", marca: "M", modelo: "X", descripcion: null, tipoUnidad: "VEHICULO", activo: true, enTaller: false, estado: "activo", kmActual: 0, empresaId: 7, compartido: false, esPropio: true, puedeEnviar: true, motivoNoDisponible: null, estadoDisponibilidad: "disponible" }];
let perfiles: { id: number; codigo: string; nombre: string }[];
let consultaPerfiles: { sql: string; params: unknown[] }[];
const conn = { query: vi.fn(), execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };

const fila = (over: Partial<FilaProgramacionExcel> = {}): FilaProgramacionExcel => ({
  filaExcel: 4, fechaSalidaExcel: "2026-09-21", horaSalidaExcel: "08:00", codigoRutaExcel: "1001", clienteExcel: "123456-7",
  pilotoCodigoExcel: "P-1", placaExcel: "P-123ABC", auxiliar1CodigoExcel: "", auxiliar2CodigoExcel: "", tipoTrasladoExcel: "Carga",
  tarifaExcel: 1500, fechaRegresoExcel: null, horaRegresoExcel: null, observacionesExcel: "", vehiculoSolicitadoExcel: "Camión 5 toneladas", erroresSintacticos: [], ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  perfiles = [{ id: 11, codigo: "CAM_5T", nombre: "Camión 5 toneladas" }, { id: 12, codigo: "CABEZAL", nombre: "Cabezal" }];
  consultaPerfiles = [];
  vi.mocked(listarDisponibilidadVehiculos).mockResolvedValue({ vehiculos: flota } as never);
  vi.mocked(query).mockImplementation((async (sql: string, params: unknown[]) => {
    const s = String(sql);
    if (s.includes("FROM tms_cotizacion_costeo_perfiles")) {
      consultaPerfiles.push({ sql: s, params });
      return perfiles;
    }
    if (s.includes("FROM tms_cliente_rutas")) {
      return [{ id: 10, codigo: "1001", cliente_id: 3, activo: 1, tarifa_referencia: 1500, lugar_carga_texto: "Bodega", destino_descripcion: "Xela",
        contacto_nombre: null, contacto_cargo: null, contacto_telefono: null, cliente_nombre: "Acme", cliente_nit: "123456-7" }];
    }
    if (s.includes("FROM empleados")) return [{ id: 100, codigo: "P-1", nombre: "Juan", estado: "Activo" }];
    return [];
  }) as never);
});

const preview = (f: FilaProgramacionExcel[]) => previsualizarImportacionProgramacion(7, f);

describe("vista previa: «Vehículo solicitado» obligatorio por fila", () => {
  it("vehículo válido (nombre exacto): fila ok y datos con id + snapshot del nombre del catálogo", async () => {
    const r = (await preview([fila()])).filas[0];
    expect(r.estado).toBe("ok");
    expect(r.datos).toMatchObject({ vehiculoSolicitadoPerfilId: 11, vehiculoSolicitadoNombre: "Camión 5 toneladas" });
  });

  it("acepta el CÓDIGO del perfil y no distingue mayúsculas, acentos ni espacios repetidos; el snapshot es el nombre canónico", async () => {
    for (const texto of ["CAM_5T", "cam_5t", "camion  5 TONELADAS"]) {
      const r = (await preview([fila({ vehiculoSolicitadoExcel: texto })])).filas[0];
      expect(r.estado, texto).toBe("ok");
      expect(r.datos).toMatchObject({ vehiculoSolicitadoPerfilId: 11, vehiculoSolicitadoNombre: "Camión 5 toneladas" });
    }
  });

  it("fila SIN vehículo (vacío) se rechaza con mensaje claro y no genera datos", async () => {
    const r = (await preview([fila({ vehiculoSolicitadoExcel: "" })])).filas[0];
    expect(r.estado).toBe("error");
    expect(r.errores).toEqual(["Vehículo solicitado es obligatorio: indique el vehículo que pidió el cliente (columna «Vehículo solicitado»)."]);
    expect(r.datos).toBeNull();
  });

  it("archivo antiguo (sin la columna: propiedad ausente) se rechaza igual: no hay vehículo por defecto", async () => {
    const sinColumna = fila();
    delete sinColumna.vehiculoSolicitadoExcel;
    const r = (await preview([sinColumna])).filas[0];
    expect(r.estado).toBe("error");
    expect(r.errores[0]).toContain("Vehículo solicitado es obligatorio");
  });

  it("vehículo inexistente, inactivo o de otra empresa (no figura en el catálogo ACTIVO de ESTA empresa) se rechaza; nunca coincidencia parcial", async () => {
    for (const texto of ["Camión 9 toneladas", "Camión 5", "Perfil inactivo", "Perfil de otra empresa"]) {
      const r = (await preview([fila({ vehiculoSolicitadoExcel: texto })])).filas[0];
      expect(r.estado, texto).toBe("error");
      expect(r.errores).toEqual([`El vehículo solicitado "${texto}" no existe en el catálogo de esta empresa o no está activo.`]);
    }
    // El catálogo se consulta solo con perfiles ACTIVOS y de la empresa de la importación.
    expect(consultaPerfiles.length).toBeGreaterThan(0);
    for (const c of consultaPerfiles) {
      expect(c.sql).toContain("empresa_id = ?");
      expect(c.sql).toContain("activo = 1");
      expect(c.params).toEqual([7]);
    }
  });

  it("texto ambiguo (dos perfiles activos coinciden) se rechaza: no se elige uno", async () => {
    perfiles = [{ id: 11, codigo: "A", nombre: "Pickup" }, { id: 12, codigo: "B", nombre: "pickup" }];
    const r = (await preview([fila({ vehiculoSolicitadoExcel: "Pickup" })])).filas[0];
    expect(r.estado).toBe("error");
    expect(r.errores[0]).toContain("coincide con más de un perfil activo");
  });

  it("NO se infiere de la placa/unidad: aunque la placa o el texto coincidan con la unidad, sin vehículo solicitado la fila se rechaza", async () => {
    const r = (await preview([fila({ vehiculoSolicitadoExcel: "P-123ABC" })])).filas[0];
    expect(r.estado).toBe("error");
    expect(r.errores[0]).toContain("no existe en el catálogo");
    const vacia = (await preview([fila({ vehiculoSolicitadoExcel: "" })])).filas[0];
    expect(vacia.datos).toBeNull();
  });

  it("lote mixto: solo la fila sin vehículo falla (su error es por fila, con su número)", async () => {
    const r = await preview([fila({ filaExcel: 4 }), fila({ filaExcel: 5, pilotoCodigoExcel: "P-1", fechaSalidaExcel: "2026-09-22", vehiculoSolicitadoExcel: "" })]);
    expect(r.filas.map((f) => f.estado)).toEqual(["ok", "error"]);
    expect(r.resumen).toEqual({ totalFilas: 2, filasOk: 1, filasConError: 1 });
  });
});

describe("confirmación: guarda id + snapshot en el mismo INSERT y no inserta nada si alguna fila no tiene vehículo", () => {
  beforeEach(() => {
    conn.query.mockImplementation(async (sql: string) => (String(sql).includes("GET_LOCK") ? [[{ l: 1 }]] : [[]]));
    conn.execute.mockImplementation(async (sql: string) => {
      if (String(sql).includes("INSERT INTO tms_unidades")) return [{ insertId: 30 }];
      if (String(sql).includes("INSERT INTO tms_planes_viaje")) return [{ insertId: 900 }];
      return [{ affectedRows: 1 }];
    });
    vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conn) } as never);
  });
  const confirmar = (f: FilaProgramacionExcel[]) => confirmarImportacionProgramacion(7, "jefe", "prog.xlsx", "hash", f);
  const inserts = () => conn.execute.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO tms_planes_viaje"));

  it("con vehículo válido: el INSERT del plan lleva vehiculo_solicitado_perfil_id y vehiculo_solicitado_nombre (id y nombre del CATÁLOGO, no el texto del Excel)", async () => {
    const r = await confirmar([fila({ vehiculoSolicitadoExcel: "cam_5t" })]);
    expect(r).toMatchObject({ resultado: "exitoso", filasImportadas: 1 });
    expect(inserts()).toHaveLength(1);
    const [sql, params] = inserts()[0] as [string, unknown[]];
    expect(sql).toContain("vehiculo_solicitado_perfil_id, vehiculo_solicitado_nombre");
    expect(params.slice(-2)).toEqual([11, "Camión 5 toneladas"]);
    // Un solo INSERT: no hay «crear sin vehículo y completar después».
    expect(conn.execute.mock.calls.some(([q]) => /UPDATE tms_planes_viaje\s+SET vehiculo_solicitado/.test(String(q)))).toBe(false);
  });

  it("una fila sin vehículo rechaza TODO el lote: no abre transacción ni inserta (ni la fila buena)", async () => {
    const r = await confirmar([fila({ filaExcel: 4 }), fila({ filaExcel: 5, fechaSalidaExcel: "2026-09-22", vehiculoSolicitadoExcel: "" })]);
    expect(r.resultado).toBe("error");
    expect(r.resultado === "error" && r.erroresPorFila?.[0].filaExcel).toBe(5);
    expect(conn.beginTransaction).not.toHaveBeenCalled();
    expect(inserts()).toHaveLength(0);
  });

  it("archivo antiguo (sin columna de vehículo) no se puede confirmar", async () => {
    const sinColumna = fila();
    delete sinColumna.vehiculoSolicitadoExcel;
    const r = await confirmar([sinColumna]);
    expect(r.resultado).toBe("error");
    expect(inserts()).toHaveLength(0);
  });

  it("perfil desactivado entre la vista previa y la confirmación: la revalidación bajo candado lo rechaza y no se inserta nada", async () => {
    expect((await preview([fila()])).filas[0].estado).toBe("ok");
    perfiles = []; // se desactivó
    const r = await confirmar([fila()]);
    expect(r.resultado).toBe("error");
    expect(inserts()).toHaveLength(0);
  });
});
