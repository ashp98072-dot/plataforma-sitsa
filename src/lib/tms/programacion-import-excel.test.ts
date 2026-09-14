import { beforeEach, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/operaciones/disponibilidad", () => ({ listarDisponibilidadVehiculos: vi.fn() }));

import { query } from "@/lib/db";
import { listarDisponibilidadVehiculos } from "@/lib/operaciones/disponibilidad";
import {
  ENCABEZADOS_PROGRAMACION,
  MAX_FILAS_PROGRAMACION,
  generarPlantillaProgramacion,
  parsearExcelProgramacion,
} from "./programacion-import-excel";

/**
 * TMS-IMPORTACION-PROGRAMACION-EXCEL (PR 2 de 6). Mismo criterio de
 * prueba que rutas-import-excel.test.ts: se construyen workbooks
 * ExcelJS a mano (sin pasar por la plantilla) para probar el parser de
 * forma aislada, y por separado se prueba que la plantilla generada es
 * compatible con ese mismo parser.
 */

const FILA_INICIO_DATOS = 4; // filas 2-3 son de ejemplo en la plantilla real

/** Construye un .xlsx con la hoja "Programacion", encabezados correctos y las filas de datos dadas a partir de la fila 4. */
async function construirHoja(filasData: unknown[][], opts?: { sinHoja?: boolean; encabezadoRoto?: number }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(opts?.sinHoja ? "OtraHoja" : "Programacion");
  ENCABEZADOS_PROGRAMACION.forEach((h, i) => {
    ws.getCell(1, i + 1).value = h;
  });
  if (opts?.encabezadoRoto != null) {
    ws.getCell(1, opts.encabezadoRoto).value = "Columna alterada";
  }
  filasData.forEach((fila, i) => {
    fila.forEach((v, colIndex) => {
      ws.getCell(FILA_INICIO_DATOS + i, colIndex + 1).value = v as ExcelJS.CellValue;
    });
  });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Fila válida completa por defecto — cada test la sobreescribe solo en lo que necesita. */
function filaBase(overrides: Partial<{
  fecha: unknown; hora: unknown; ruta: unknown; cliente: unknown; piloto: unknown; placa: unknown;
  aux1: unknown; aux2: unknown; tipo: unknown; tarifa: unknown; fechaReg: unknown; horaReg: unknown; obs: unknown;
}> = {}): unknown[] {
  const f = {
    fecha: "2026-09-20", hora: "08:00", ruta: "1001", cliente: "Acme S.A.",
    piloto: "P-1", placa: "P-123ABC", aux1: "", aux2: "", tipo: "Carga completa",
    tarifa: 1500, fechaReg: "2026-09-20", horaReg: "17:00", obs: "",
    ...overrides,
  };
  return [f.fecha, f.hora, f.ruta, f.cliente, f.piloto, f.placa, f.aux1, f.aux2, f.tipo, f.tarifa, f.fechaReg, f.horaReg, f.obs];
}

describe("parsearExcelProgramacion — casos generales", () => {
  it("archivo válido de 1 fila: se parsea sin errores sintácticos", async () => {
    const buf = await construirHoja([filaBase()]);
    const filas = await parsearExcelProgramacion(buf);
    expect(filas).toHaveLength(1);
    expect(filas[0].erroresSintacticos).toEqual([]);
    expect(filas[0].filaExcel).toBe(4);
    expect(filas[0]).toMatchObject({
      fechaSalidaExcel: "2026-09-20",
      horaSalidaExcel: "08:00",
      codigoRutaExcel: "1001",
      clienteExcel: "Acme S.A.",
      pilotoCodigoExcel: "P-1",
      placaExcel: "P-123ABC",
      tipoTrasladoExcel: "Carga completa",
      tarifaExcel: 1500,
      fechaRegresoExcel: "2026-09-20",
      horaRegresoExcel: "17:00",
    });
  });

  it("varias filas: conserva el orden y el número real de fila de Excel", async () => {
    const buf = await construirHoja([
      filaBase({ ruta: "1001" }),
      filaBase({ ruta: "1002" }),
      filaBase({ ruta: "1003" }),
    ]);
    const filas = await parsearExcelProgramacion(buf);
    expect(filas.map((f) => f.codigoRutaExcel)).toEqual(["1001", "1002", "1003"]);
    expect(filas.map((f) => f.filaExcel)).toEqual([4, 5, 6]);
  });

  it("misma ruta repetida varias veces con piloto/unidad distintos: se conservan todas las filas", async () => {
    const buf = await construirHoja([
      filaBase({ ruta: "2", piloto: "P-1", placa: "AAA111" }),
      filaBase({ ruta: "2", piloto: "P-2", placa: "BBB222" }),
      filaBase({ ruta: "2", piloto: "P-3", placa: "CCC333" }),
    ]);
    const filas = await parsearExcelProgramacion(buf);
    expect(filas).toHaveLength(3);
    expect(filas.every((f) => f.codigoRutaExcel === "2")).toBe(true);
    expect(filas.map((f) => f.pilotoCodigoExcel)).toEqual(["P-1", "P-2", "P-3"]);
  });

  it("filas completamente vacías intermedias: se ignoran, sin romper el conteo de filaExcel real", async () => {
    const buf = await construirHoja([
      filaBase({ ruta: "1001" }), // fila 4
      Array(13).fill(""), // fila 5, completamente vacía
      filaBase({ ruta: "1003" }), // fila 6
    ]);
    const filas = await parsearExcelProgramacion(buf);
    expect(filas).toHaveLength(2);
    expect(filas.map((f) => f.filaExcel)).toEqual([4, 6]);
  });

  it("fila de ejemplo (EJEMPLO-NO-IMPORTAR) se ignora igual que una fila vacía", async () => {
    const buf = await construirHoja([
      filaBase({ ruta: "EJEMPLO-NO-IMPORTAR" }),
      filaBase({ ruta: "1001" }),
    ]);
    const filas = await parsearExcelProgramacion(buf);
    expect(filas).toHaveLength(1);
    expect(filas[0].codigoRutaExcel).toBe("1001");
  });

  it("archivo vacío (sin filas de datos): devuelve un arreglo vacío, sin error", async () => {
    const buf = await construirHoja([]);
    const filas = await parsearExcelProgramacion(buf);
    expect(filas).toEqual([]);
  });

  it("buffer que no es un .xlsx válido: lanza un error claro", async () => {
    await expect(parsearExcelProgramacion(Buffer.from("esto no es un excel"))).rejects.toThrow(
      /Excel .xlsx válido/,
    );
  });

  it("hoja 'Programacion' inexistente: lanza un error claro", async () => {
    const buf = await construirHoja([filaBase()], { sinHoja: true });
    await expect(parsearExcelProgramacion(buf)).rejects.toThrow(/No se encontró la hoja "Programacion"/);
  });

  it.each([1, 4, 6, 10])("encabezado alterado en la columna %i: lanza un error claro y no procesa nada", async (col) => {
    const buf = await construirHoja([filaBase()], { encabezadoRoto: col });
    await expect(parsearExcelProgramacion(buf)).rejects.toThrow(/Encabezado inválido/);
  });

  it("más de 500 filas útiles: rechaza el archivo completo", async () => {
    const filas = Array.from({ length: MAX_FILAS_PROGRAMACION + 1 }, (_, i) => filaBase({ ruta: `R-${i}` }));
    const buf = await construirHoja(filas);
    await expect(parsearExcelProgramacion(buf)).rejects.toThrow(/límite de 500 filas/);
  });

  it("exactamente 500 filas: se acepta sin error", async () => {
    const filas = Array.from({ length: MAX_FILAS_PROGRAMACION }, (_, i) => filaBase({ ruta: `R-${i}` }));
    const buf = await construirHoja(filas);
    const resultado = await parsearExcelProgramacion(buf);
    expect(resultado).toHaveLength(MAX_FILAS_PROGRAMACION);
  });
});

describe("parsearExcelProgramacion — fecha", () => {
  it("fecha como texto ISO (YYYY-MM-DD)", async () => {
    const buf = await construirHoja([filaBase({ fecha: "2026-09-20" })]);
    const [fila] = await parsearExcelProgramacion(buf);
    expect(fila.fechaSalidaExcel).toBe("2026-09-20");
  });

  it("fecha como texto LATAM (DD/MM/YYYY)", async () => {
    const buf = await construirHoja([filaBase({ fecha: "20/09/2026" })]);
    const [fila] = await parsearExcelProgramacion(buf);
    expect(fila.fechaSalidaExcel).toBe("2026-09-20");
  });

  it("fecha como Date de ExcelJS (cuando la celda tiene formato de fecha real)", async () => {
    const buf = await construirHoja([filaBase({ fecha: new Date(Date.UTC(2026, 8, 20)) })]);
    const [fila] = await parsearExcelProgramacion(buf);
    expect(fila.fechaSalidaExcel).toBe("2026-09-20");
  });

  it("fecha como serial numérico de Excel (celda sin formato de fecha aplicado)", async () => {
    const serial = Math.round((Date.UTC(2026, 8, 20) - Date.UTC(1899, 11, 30)) / 86400000);
    const buf = await construirHoja([filaBase({ fecha: serial })]);
    const [fila] = await parsearExcelProgramacion(buf);
    expect(fila.fechaSalidaExcel).toBe("2026-09-20");
  });

  it("fecha vacía: error 'obligatoria', no 'inválida'", async () => {
    const buf = await construirHoja([filaBase({ fecha: "" })]);
    const [fila] = await parsearExcelProgramacion(buf);
    expect(fila.fechaSalidaExcel).toBeNull();
    expect(fila.erroresSintacticos).toContain("Fecha salida es obligatoria.");
  });

  it("fecha con texto no reconocible: error 'inválida'", async () => {
    const buf = await construirHoja([filaBase({ fecha: "no-es-una-fecha" })]);
    const [fila] = await parsearExcelProgramacion(buf);
    expect(fila.fechaSalidaExcel).toBeNull();
    expect(fila.erroresSintacticos.some((e) => e.includes("Fecha salida inválida"))).toBe(true);
  });
});

describe("parsearExcelProgramacion — hora", () => {
  it.each([
    ["04:00", "04:00"],
    ["15:00", "15:00"],
    ["04:00 AM", "04:00"],
    ["4:00am", "04:00"],
    ["03:00 PM", "15:00"],
    ["3:00pm", "15:00"],
    ["12:00 AM", "00:00"], // medianoche
    ["12:00 PM", "12:00"], // mediodía
    ["00:00", "00:00"],
    ["23:59:00", "23:59"], // HH:mm:ss también se acepta
  ])("hora '%s' se normaliza a '%s'", async (entrada, esperado) => {
    // fechaReg/horaReg vacíos: aísla esta prueba de la validación
    // "regreso posterior a salida" (probada aparte), que de otro modo
    // podría dispararse según la hora de salida usada en cada caso.
    const buf = await construirHoja([filaBase({ hora: entrada, fechaReg: "", horaReg: "" })]);
    const [fila] = await parsearExcelProgramacion(buf);
    expect(fila.horaSalidaExcel).toBe(esperado);
    expect(fila.erroresSintacticos).toEqual([]);
  });

  it("hora vacía: no es error (campo opcional a nivel de sistema)", async () => {
    const buf = await construirHoja([filaBase({ hora: "" })]);
    const [fila] = await parsearExcelProgramacion(buf);
    expect(fila.horaSalidaExcel).toBeNull();
    expect(fila.erroresSintacticos).toEqual([]);
  });

  it("hora con texto no reconocible: error 'inválida'", async () => {
    const buf = await construirHoja([filaBase({ hora: "mediodía y algo" })]);
    const [fila] = await parsearExcelProgramacion(buf);
    expect(fila.horaSalidaExcel).toBeNull();
    expect(fila.erroresSintacticos.some((e) => e.includes("Hora salida inválida"))).toBe(true);
  });

  it("hora fuera de rango (25:00): error 'inválida'", async () => {
    const buf = await construirHoja([filaBase({ hora: "25:00" })]);
    const [fila] = await parsearExcelProgramacion(buf);
    expect(fila.horaSalidaExcel).toBeNull();
    expect(fila.erroresSintacticos.some((e) => e.includes("Hora salida inválida"))).toBe(true);
  });
});

describe("parsearExcelProgramacion — campos obligatorios", () => {
  it("código de ruta vacío", async () => {
    const buf = await construirHoja([filaBase({ ruta: "" })]);
    const [fila] = await parsearExcelProgramacion(buf);
    expect(fila.erroresSintacticos).toContain("Código ruta es obligatorio.");
  });

  it("código de piloto vacío", async () => {
    const buf = await construirHoja([filaBase({ piloto: "" })]);
    const [fila] = await parsearExcelProgramacion(buf);
    expect(fila.erroresSintacticos).toContain("Código piloto es obligatorio.");
  });

  it("placa vacía", async () => {
    const buf = await construirHoja([filaBase({ placa: "" })]);
    const [fila] = await parsearExcelProgramacion(buf);
    expect(fila.erroresSintacticos).toContain("Placa es obligatoria.");
  });

  it("cliente vacío: NO es error en este PR (solo se valida formato/obligatoriedad de catálogo en fases posteriores)", async () => {
    const buf = await construirHoja([filaBase({ cliente: "" })]);
    const [fila] = await parsearExcelProgramacion(buf);
    expect(fila.clienteExcel).toBe("");
    expect(fila.erroresSintacticos).toEqual([]);
  });

  it("auxiliares vacíos: ambos opcionales, sin error", async () => {
    const buf = await construirHoja([filaBase({ aux1: "", aux2: "" })]);
    const [fila] = await parsearExcelProgramacion(buf);
    expect(fila.auxiliar1CodigoExcel).toBe("");
    expect(fila.auxiliar2CodigoExcel).toBe("");
    expect(fila.erroresSintacticos).toEqual([]);
  });

  it("código con ceros significativos (celda de texto): se conservan tal cual", async () => {
    const buf = await construirHoja([filaBase({ ruta: "007", piloto: "0099" })]);
    const [fila] = await parsearExcelProgramacion(buf);
    expect(fila.codigoRutaExcel).toBe("007");
    expect(fila.pilotoCodigoExcel).toBe("0099");
  });

  it("placa con espacios y minúsculas: se normaliza a mayúsculas sin espacios extremos", async () => {
    const buf = await construirHoja([filaBase({ placa: "  p-123abc  " })]);
    const [fila] = await parsearExcelProgramacion(buf);
    expect(fila.placaExcel).toBe("P-123ABC");
  });
});

describe("parsearExcelProgramacion — tarifa", () => {
  it("tarifa decimal válida", async () => {
    const buf = await construirHoja([filaBase({ tarifa: 1234.5 })]);
    const [fila] = await parsearExcelProgramacion(buf);
    expect(fila.tarifaExcel).toBe(1234.5);
    expect(fila.erroresSintacticos).toEqual([]);
  });

  it("tarifa como texto con formato monetario ('Q 1,250.75')", async () => {
    const buf = await construirHoja([filaBase({ tarifa: "Q 1,250.75" })]);
    const [fila] = await parsearExcelProgramacion(buf);
    expect(fila.tarifaExcel).toBe(1250.75);
  });

  it("tarifa negativa: error", async () => {
    const buf = await construirHoja([filaBase({ tarifa: -100 })]);
    const [fila] = await parsearExcelProgramacion(buf);
    expect(fila.tarifaExcel).toBeNull();
    expect(fila.erroresSintacticos.some((e) => e.includes("Tarifa GTQ"))).toBe(true);
  });

  it("tarifa no numérica: error", async () => {
    const buf = await construirHoja([filaBase({ tarifa: "no-es-numero" })]);
    const [fila] = await parsearExcelProgramacion(buf);
    expect(fila.tarifaExcel).toBeNull();
    expect(fila.erroresSintacticos.some((e) => e.includes("Tarifa GTQ"))).toBe(true);
  });

  it("tarifa vacía: no es error en este PR (se contrasta contra catálogo en una fase posterior)", async () => {
    const buf = await construirHoja([filaBase({ tarifa: "" })]);
    const [fila] = await parsearExcelProgramacion(buf);
    expect(fila.tarifaExcel).toBeNull();
    expect(fila.erroresSintacticos).toEqual([]);
  });
});

describe("parsearExcelProgramacion — regreso estimado", () => {
  it("regreso completamente vacío: opcional, sin error", async () => {
    const buf = await construirHoja([filaBase({ fechaReg: "", horaReg: "" })]);
    const [fila] = await parsearExcelProgramacion(buf);
    expect(fila.fechaRegresoExcel).toBeNull();
    expect(fila.horaRegresoExcel).toBeNull();
    expect(fila.erroresSintacticos).toEqual([]);
  });

  it("regreso parcial: fecha sin hora -> error 'incompleto'", async () => {
    const buf = await construirHoja([filaBase({ fechaReg: "2026-09-20", horaReg: "" })]);
    const [fila] = await parsearExcelProgramacion(buf);
    expect(fila.erroresSintacticos).toContain("Regreso estimado incompleto: falta la hora de regreso.");
  });

  it("regreso parcial: hora sin fecha -> error 'incompleto'", async () => {
    const buf = await construirHoja([filaBase({ fechaReg: "", horaReg: "17:00" })]);
    const [fila] = await parsearExcelProgramacion(buf);
    expect(fila.erroresSintacticos).toContain("Regreso estimado incompleto: falta la fecha de regreso.");
  });

  it("regreso anterior a la salida: error", async () => {
    const buf = await construirHoja([
      filaBase({ fecha: "2026-09-20", hora: "17:00", fechaReg: "2026-09-20", horaReg: "08:00" }),
    ]);
    const [fila] = await parsearExcelProgramacion(buf);
    expect(fila.erroresSintacticos).toContain("El regreso estimado debe ser posterior a la salida programada.");
  });

  it("regreso igual a la salida: error (no se acepta igual, debe ser estrictamente posterior)", async () => {
    const buf = await construirHoja([
      filaBase({ fecha: "2026-09-20", hora: "08:00", fechaReg: "2026-09-20", horaReg: "08:00" }),
    ]);
    const [fila] = await parsearExcelProgramacion(buf);
    expect(fila.erroresSintacticos).toContain("El regreso estimado debe ser posterior a la salida programada.");
  });

  it("regreso válido y posterior a la salida: sin error", async () => {
    const buf = await construirHoja([
      filaBase({ fecha: "2026-09-20", hora: "08:00", fechaReg: "2026-09-21", horaReg: "08:00" }),
    ]);
    const [fila] = await parsearExcelProgramacion(buf);
    expect(fila.erroresSintacticos).toEqual([]);
  });
});

describe("generarPlantillaProgramacion", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(query).mockResolvedValue([] as never);
    vi.mocked(listarDisponibilidadVehiculos).mockResolvedValue({
      vehiculos: [],
      resumen: { total: 0, disponibles: 0, enTaller: 0, enRuta: 0, inactivos: 0, propios: 0, compartidos: 0 },
      empresaId: 7,
    });
  });

  it("genera las 6 hojas esperadas", async () => {
    const buf = await generarPlantillaProgramacion(7);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual([
      "Programacion", "Rutas", "Vehiculos", "Empleados", "Clientes", "Instrucciones",
    ]);
  });

  it("la hoja Programacion tiene exactamente los 13 encabezados oficiales, en orden", async () => {
    const buf = await generarPlantillaProgramacion(7);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet("Programacion")!;
    const encabezados = ENCABEZADOS_PROGRAMACION.map((_, i) => ws.getCell(1, i + 1).value);
    expect(encabezados).toEqual([...ENCABEZADOS_PROGRAMACION]);
  });

  it("la plantilla generada es compatible con su propio parser (sin filas reales -> arreglo vacío, sin error)", async () => {
    const buf = await generarPlantillaProgramacion(7);
    const filas = await parsearExcelProgramacion(buf);
    expect(filas).toEqual([]);
  });

  it("puebla la hoja Rutas con el catálogo real de la empresa (solo rutas activas)", async () => {
    vi.mocked(query).mockImplementation(async (sql: string) => {
      if (sql.includes("FROM tms_cliente_rutas")) {
        return [
          { codigo: "1001", nombre: "Ruta Norte", cliente_nombre: "Acme", cliente_nit: "123456-7", tarifa_referencia: 1500, destino_descripcion: "Bodega Zona 12" },
        ] as never;
      }
      return [] as never;
    });
    const buf = await generarPlantillaProgramacion(7);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet("Rutas")!;
    expect(ws.getRow(1).values).toContain("Código ruta");
    expect(ws.getCell(2, 1).value).toBe("1001");
    expect(ws.getCell(2, 3).value).toBe("Acme");
    expect(ws.getCell(2, 5).value).toBe(1500);
    // Verifica que el llamado a BD filtró por empresa y por activo=1.
    const [sql, params] = vi.mocked(query).mock.calls.find(([s]) => String(s).includes("tms_cliente_rutas"))!;
    expect(sql).toContain("r.activo = 1");
    expect(params).toEqual([7]);
  });

  it("puebla la hoja Vehiculos únicamente con unidades activas (reutiliza listarDisponibilidadVehiculos)", async () => {
    vi.mocked(listarDisponibilidadVehiculos).mockResolvedValue({
      vehiculos: [
        { id: 1, placa: "AAA111", marca: "Freightliner", modelo: "Cascadia", descripcion: null, activo: true, enTaller: false, compartido: false, esPropio: true, empresaDuenaNombre: null, empresaDuenaCodigo: null, kmActual: 0, estadoDisponibilidad: "disponible", puedeEnviar: true, viajeAbierto: null, motivoNoDisponible: null },
        { id: 2, placa: "BBB222", marca: "Volvo", modelo: "VNL", descripcion: null, activo: false, enTaller: false, compartido: false, esPropio: true, empresaDuenaNombre: null, empresaDuenaCodigo: null, kmActual: 0, estadoDisponibilidad: "inactivo", puedeEnviar: false, viajeAbierto: null, motivoNoDisponible: "Unidad inactiva" },
      ],
      resumen: { total: 2, disponibles: 1, enTaller: 0, enRuta: 0, inactivos: 1, propios: 2, compartidos: 0 },
      empresaId: 7,
    });
    const buf = await generarPlantillaProgramacion(7);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet("Vehiculos")!;
    expect(ws.getCell(2, 1).value).toBe("AAA111");
    expect(ws.getCell(3, 1).value).toBeNull(); // la inactiva (BBB222) no aparece — ExcelJS devuelve null, no undefined, para una celda nunca escrita
  });

  it("puebla la hoja Empleados solo con Piloto/Auxiliar elegibles (excluye Administrativo)", async () => {
    vi.mocked(query).mockImplementation(async (sql: string) => {
      if (sql.includes("FROM empleados")) {
        return [
          { codigo: "P-1", nombre: "Juan Pérez", puesto: "Piloto", categoria_ops: "Piloto" },
          { codigo: "A-1", nombre: "María López", puesto: "Auxiliar de ruta", categoria_ops: "Auxiliar" },
        ] as never;
      }
      return [] as never;
    });
    const buf = await generarPlantillaProgramacion(7);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet("Empleados")!;
    expect(ws.getCell(2, 1).value).toBe("P-1");
    expect(ws.getCell(3, 1).value).toBe("A-1");
    // La query en sí ya excluye Administrativo/Bodega/Otro — se confirma el WHERE exacto.
    const [sql] = vi.mocked(query).mock.calls.find(([s]) => String(s).includes("FROM empleados"))!;
    expect(sql).toContain("categoria_ops IN ('Piloto', 'Auxiliar')");
    expect(sql).not.toContain("Administrativo");
  });

  it("puebla la hoja Clientes solo con clientes activos", async () => {
    vi.mocked(query).mockImplementation(async (sql: string) => {
      if (sql.includes("FROM tms_clientes")) {
        return [{ nombre: "Acme S.A.", nit: "123456-7" }] as never;
      }
      return [] as never;
    });
    const buf = await generarPlantillaProgramacion(7);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet("Clientes")!;
    expect(ws.getCell(2, 1).value).toBe("Acme S.A.");
    expect(ws.getCell(2, 2).value).toBe("123456-7");
    // Ojo: la query de Rutas también menciona "tms_clientes" (vía JOIN) —
    // se busca específicamente la que empieza desde esa tabla.
    const [sql] = vi.mocked(query).mock.calls.find(([s]) => String(s).includes("FROM tms_clientes"))!;
    expect(sql).toContain("estado = 'Activo'");
  });

  it("define named ranges de libro para los 3 catálogos usados en dropdowns", async () => {
    vi.mocked(query).mockImplementation(async (sql: string) => {
      // 2 filas a propósito: con exactamente 1 fila, ExcelJS normaliza el
      // rango de una sola celda ("$A$2:$A$2") a solo "$A$2" al escribirlo
      // -- con 2 filas el rango real ("$A$2:$A$3") se conserva tal cual y
      // no hay ambigüedad en la aserción.
      if (sql.includes("FROM tms_cliente_rutas")) {
        return [
          { codigo: "1001", nombre: "R1", cliente_nombre: "C", cliente_nit: "", tarifa_referencia: null, destino_descripcion: "" },
          { codigo: "1002", nombre: "R2", cliente_nombre: "C", cliente_nit: "", tarifa_referencia: null, destino_descripcion: "" },
        ] as never;
      }
      return [] as never;
    });
    const buf = await generarPlantillaProgramacion(7);
    const dir = "C:/Users/Admin/AppData/Local/Temp/claude/xlsxtest";
    const fs = await import("node:fs/promises");
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(`${dir}/plantilla-programacion-test.xlsx`, buf);
    const zip = await import("node:child_process");
    // Inspección directa del XML del libro: la forma más confiable de
    // confirmar que ExcelJS efectivamente escribió <definedName>, ya que
    // su propio lector (wb.definedNames.getNames()) es inestable en esta
    // versión (ver discovery §7).
    const unzip = zip.execSync(`unzip -p "${dir}/plantilla-programacion-test.xlsx" xl/workbook.xml`).toString("utf-8");
    expect(unzip).toContain('name="LISTA_RUTAS_CODIGOS"');
    expect(unzip).toContain('name="LISTA_VEHICULOS_PLACAS"');
    expect(unzip).toContain('name="LISTA_EMPLEADOS_CODIGOS"');
    expect(unzip).toContain("Rutas!$A$2:$A$3");
  });

  it("el dropdown de Código ruta/Placa/Piloto/Auxiliar apunta al named range correspondiente, sin bloquear valores fuera de lista", async () => {
    const buf = await generarPlantillaProgramacion(7);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet("Programacion")!;
    const dvRuta = ws.getCell(4, 3).dataValidation; // C4 = Código ruta
    const dvPlaca = ws.getCell(4, 6).dataValidation; // F4 = Placa
    const dvPiloto = ws.getCell(4, 5).dataValidation; // E4 = Código piloto
    const dvAux1 = ws.getCell(4, 7).dataValidation; // G4 = Código auxiliar 1
    const dvAux2 = ws.getCell(4, 8).dataValidation; // H4 = Código auxiliar 2
    // showErrorMessage:false no se escribe como atributo explícito en el
    // XML (es el valor por defecto) -- al recargar, la propiedad
    // simplemente está ausente (undefined), nunca `false` literal. Lo
    // importante -- y lo que se prueba aparte -- es que NUNCA sea `true`
    // (eso sí bloquearía valores fuera de la lista en Excel real).
    expect(dvRuta).toMatchObject({ type: "list", formulae: ["LISTA_RUTAS_CODIGOS"] });
    expect(dvPlaca).toMatchObject({ type: "list", formulae: ["LISTA_VEHICULOS_PLACAS"] });
    expect(dvPiloto).toMatchObject({ type: "list", formulae: ["LISTA_EMPLEADOS_CODIGOS"] });
    expect(dvAux1).toMatchObject({ type: "list", formulae: ["LISTA_EMPLEADOS_CODIGOS"] });
    expect(dvAux2).toMatchObject({ type: "list", formulae: ["LISTA_EMPLEADOS_CODIGOS"] });
    for (const dv of [dvRuta, dvPlaca, dvPiloto, dvAux1, dvAux2]) {
      expect(dv?.showErrorMessage).not.toBe(true);
    }
  });
});
