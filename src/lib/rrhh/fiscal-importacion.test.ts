import ExcelJS from "exceljs";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), getPool: vi.fn() }));

import {
  analizarFilas, construirItemsImportacion, desprotegerTextoExcel, ErrorArchivoAcumulados, generarPlantillaAcumulados, leerArchivoAcumulados,
  normalizarFecha, normalizarMonto, protegerTextoExcel, type DatosAnalisis,
} from "./fiscal-importacion";
import { COLUMNAS_ACUMULADOS, MAX_FILAS_ACUMULADOS, puedeImportar } from "./fiscal-importacion-ui";

/**
 * IMPORTACIÓN MASIVA de acumulados fiscales (Excel): plantilla, lectura segura y análisis (dry-run). Los .xlsx de prueba se
 * generan con exceljs (sin archivos binarios en el repo). Reloj fijo: 2026-10-05.
 */
const HOY = "2026-10-05";
type Celdas = unknown[];
const fila = (over: Partial<Record<number, unknown>> = {}): Celdas => {
  const base: Celdas = ["E1", "", "Ana López", 2026, "15/09/2026", 45000, 2000, 2173.5, 1250, "Sistema anterior", "obs"];
  for (const [i, v] of Object.entries(over)) base[Number(i)] = v;
  return base;
};
async function libro(filas: Celdas[], opciones: { hoja?: string; encabezados?: readonly string[] } = {}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(opciones.hoja ?? "Acumulados");
  ws.addRow([...(opciones.encabezados ?? COLUMNAS_ACUMULADOS)]);
  for (const f of filas) ws.addRow(f as ExcelJS.CellValue[]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const datos = (over: Partial<DatosAnalisis> = {}): DatosAnalisis => ({
  empleados: [
    { id: 1, codigo: "E1", dpi: "1234567890101", nombre: "Ana López", estado: "Activo" },
    { id: 2, codigo: "E2", dpi: "2222222220101", nombre: "Beto Pérez", estado: "Baja" },
    { id: 3, codigo: "E3", dpi: "", nombre: "Carla Ruiz", estado: "Activo" },
  ],
  revisiones: new Map(), periodos: new Map(), ...over,
});
const analizar = async (filas: Celdas[], d: DatosAnalisis = datos()) => {
  const { filas: crudas, omitidasSinDatos } = await leerArchivoAcumulados(await libro(filas));
  return analizarFilas(crudas, d, omitidasSinDatos, HOY);
};
const unica = async (filas: Celdas[], d?: DatosAnalisis) => (await analizar(filas, d)).filas[0];

describe("PLANTILLA", () => {
  const empleados = [{ codigo: "E1", dpi: "1234567890101", nombre: "Ana López" }, { codigo: "E2", dpi: null, nombre: "=HYPERLINK(\"http://x\")" }];
  it("1/2) genera un .xlsx válido con las 11 columnas exactas y la hoja Acumulados", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await generarPlantillaAcumulados(empleados, 2026)) as never);
    const ws = wb.getWorksheet("Acumulados")!;
    expect(ws.getRow(1).values).toEqual([undefined, ...COLUMNAS_ACUMULADOS]);
    expect(COLUMNAS_ACUMULADOS).toEqual(["Código empleado", "DPI", "Nombre empleado", "Ejercicio", "Fecha de corte", "Ingresos gravados acumulados", "Ingresos exentos acumulados", "IGSS laboral acumulado", "ISR retenido acumulado", "Referencia / origen", "Observaciones"]);
  });
  it("3/4) prellena solo los empleados recibidos (código, DPI, nombre, ejercicio) y deja vacíos fecha, importes, referencia y observaciones", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await generarPlantillaAcumulados(empleados.slice(0, 1), 2026)) as never);
    const ws = wb.getWorksheet("Acumulados")!;
    expect(ws.rowCount).toBe(2);
    expect([1, 2, 3, 4].map((c) => ws.getRow(2).getCell(c).value)).toEqual(["E1", "1234567890101", "Ana López", 2026]);
    for (let c = 5; c <= 11; c++) expect(ws.getRow(2).getCell(c).value ?? null).toBeNull();
  });
  it("6) protección contra inyección de fórmulas: texto de la BD que empieza con = + - @ se prefija; no se crean fórmulas", async () => {
    for (const peligroso of ["=1+1", "+cmd", "-2", "@SUM(A1)", "\tX"]) {
      expect(protegerTextoExcel(peligroso)).toBe(`'${peligroso}`);
      expect(desprotegerTextoExcel(protegerTextoExcel(peligroso))).toBe(peligroso); // ida y vuelta exacta
    }
    expect(protegerTextoExcel("Ana")).toBe("Ana");
    expect(desprotegerTextoExcel("'texto normal")).toBe("'texto normal"); // solo se quita si protege un carácter peligroso
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await generarPlantillaAcumulados(empleados, 2026)) as never);
    const v = wb.getWorksheet("Acumulados")!.getRow(3).getCell(3).value;
    expect(typeof v).toBe("string");
    expect(String(v).startsWith("'=")).toBe(true);
  });
});

describe("LECTURA / PARSEO del archivo", () => {
  it("7) un archivo válido produce la fila completa y sin errores", async () => {
    const r = await analizar([fila()]);
    expect(r).toMatchObject({ totalFilas: 1, validas: 1, advertencias: 0, errores: 0 });
    expect(r.filas[0]).toMatchObject({ numeroFila: 2, empleadoId: 1, codigo: "E1", ejercicio: 2026, fechaCorte: "2026-09-15", gravado: "45000.00", exento: "2000.00", igss: "2173.50", isr: "1250.00", referencia: "Sistema anterior", estado: "VALIDA" });
    expect(puedeImportar(r)).toBe(true);
  });
  it("8) filas completamente vacías se ignoran; filas prellenadas SIN datos fiscales (E–K vacías) se omiten y no son error", async () => {
    const { filas, omitidasSinDatos } = await leerArchivoAcumulados(await libro([fila(), [], ["E2", "", "Beto", 2026, null, null, null, null, null, null, null], [null, null, null, null, null, null, null, null, null, null, null]]));
    expect(filas).toHaveLength(1);
    expect(omitidasSinDatos).toBe(1);
  });
  it("una fila con algún dato fiscal pero incompleta es ERROR (no se completa en silencio)", async () => {
    const f = await unica([fila({ 5: null, 8: null })]);
    expect(f.estado).toBe("ERROR");
    expect(f.mensajes.join(" ")).toMatch(/Ingresos gravados acumulados: es obligatorio/);
  });
  it("9) identifica por código exacto", async () => expect((await unica([fila({ 0: "E2" })])).empleadoId).toBe(2));
  it("10) fallback por DPI cuando el código viene vacío (con o sin guiones/espacios)", async () => {
    expect((await unica([fila({ 0: "", 1: "2222222220101" })])).empleadoId).toBe(2);
    expect((await unica([fila({ 0: "", 1: "2222 22222 0101" })])).empleadoId).toBe(2);
  });
  it("11) código y DPI de empleados DISTINTOS → error", async () => {
    const f = await unica([fila({ 0: "E1", 1: "2222222220101" })]);
    expect(f.estado).toBe("ERROR");
    expect(f.mensajes.join(" ")).toContain("empleados distintos");
  });
  it("código correcto con DPI que no coincide con nadie: advertencia informativa (se usa el código)", async () => {
    const f = await unica([fila({ 1: "9999999990101" })]);
    expect(f.estado).toBe("ADVERTENCIA");
    expect(f.empleadoId).toBe(1);
  });
  it("12) empleado inexistente → error; sin código ni DPI → error; NUNCA se busca por nombre", async () => {
    expect((await unica([fila({ 0: "NOEXISTE" })])).mensajes.join(" ")).toContain("no corresponde a ningún empleado");
    const sinId = await unica([fila({ 0: "", 1: "", 2: "Ana López" })]); // el nombre coincide con E1 pero no se usa
    expect(sinId.estado).toBe("ERROR");
    expect(sinId.empleadoId).toBeNull();
    expect((await unica([fila({ 0: "", 1: "0000000000000" })])).estado).toBe("ERROR");
  });
  it("13) un empleado de OTRA empresa no aparece entre los empleados de la sesión → error (el análisis solo conoce los de su empresa)", async () => {
    const soloOtra = datos({ empleados: [{ id: 99, codigo: "X9", dpi: "", nombre: "Otro", estado: "Activo" }] });
    const f = await unica([fila({ 0: "E1" })], soloOtra);
    expect(f.estado).toBe("ERROR");
    expect(f.empleadoId).toBeNull();
    expect(JSON.stringify(f)).not.toContain("Otro"); // no expone datos ajenos
  });
  it("14) el MISMO empleado dos veces (una por código y otra por DPI) → error en todo el grupo", async () => {
    const r = await analizar([fila({ 0: "E1" }), fila({ 0: "", 1: "1234567890101" }), fila({ 0: "E2", 2: "Beto Pérez" })]);
    expect(r.filas.map((f) => f.estado)).toEqual(["ERROR", "ERROR", "VALIDA"]);
    expect(r.filas[0].mensajes[0]).toContain("más de una vez");
    expect(puedeImportar(r)).toBe(false);
  });
  it("15) fecha como Excel date real", async () => expect((await unica([fila({ 4: new Date(Date.UTC(2026, 8, 15)) })])).fechaCorte).toBe("2026-09-15"));
  it("16) fecha texto dd/mm/aaaa (incluida 1 dígito)", async () => {
    expect((await unica([fila({ 4: "15/09/2026" })])).fechaCorte).toBe("2026-09-15");
    expect(normalizarFecha({ tipo: "texto", valor: "5/9/2026" }).fecha).toBe("2026-09-05");
  });
  it("17) fecha ISO aaaa-mm-dd", async () => expect((await unica([fila({ 4: "2026-09-15" })])).fechaCorte).toBe("2026-09-15"));
  it("18) fecha futura → error (regla del modelo fiscal reutilizada)", async () => expect((await unica([fila({ 4: "2026-10-06" })])).mensajes.join(" ")).toContain("posterior a hoy"));
  it("19) fecha fuera del ejercicio → error", async () => expect((await unica([fila({ 4: "2025-12-31" })])).mensajes.join(" ")).toContain("ejercicio"));
  it("fecha vacía, inválida o irreal → error; nunca se inventa una fecha", async () => {
    expect((await unica([fila({ 4: null })])).mensajes.join(" ")).toContain("obligatoria");
    expect(normalizarFecha({ tipo: "texto", valor: "31/02/2026" }).fecha).toBeNull();
    expect(normalizarFecha({ tipo: "texto", valor: "ayer" }).fecha).toBeNull();
    expect(normalizarFecha({ tipo: "numero", valor: 46000 }).fecha).toBeNull(); // serial numérico crudo: no se adivina
  });
  it("20/21/22) montos enteros, con 1 y con 2 decimales se normalizan a 2 decimales", async () => {
    const f = await unica([fila({ 5: 45000, 6: 45000.5, 7: "45000.50", 8: 0 })]);
    expect([f.gravado, f.exento, f.igss, f.isr]).toEqual(["45000.00", "45000.50", "45000.50", "0.00"]); // 0 es válido
    expect(f.estado).toBe("VALIDA");
  });
  it("23) negativos → error", async () => expect((await unica([fila({ 5: -1 })])).mensajes.join(" ")).toContain("no puede ser negativo"));
  it("24) más de 2 decimales → error (sin perder precisión en silencio)", async () => {
    expect((await unica([fila({ 6: 10.123 })])).estado).toBe("ERROR");
    expect(normalizarMonto({ tipo: "texto", valor: "1.005" }, "X").monto).toBeNull();
  });
  it("texto no numérico, notación científica, NaN y valores absurdos → error", async () => {
    for (const malo of ["abc", "1e3", "1,000.00", "NaN", "9999999999999.99"]) expect(normalizarMonto({ tipo: "texto", valor: malo }, "X").monto).toBeNull();
    expect(normalizarMonto({ tipo: "numero", valor: 1e15 }, "X").monto).toBeNull();
  });
  it("25) una FÓRMULA en una celda monetaria se rechaza con mensaje claro (no se evalúa)", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Acumulados");
    ws.addRow([...COLUMNAS_ACUMULADOS]);
    ws.addRow(fila());
    ws.getRow(2).getCell(6).value = { formula: "40000+5000", result: 45000 };
    const { filas, omitidasSinDatos } = await leerArchivoAcumulados(Buffer.from(await wb.xlsx.writeBuffer()));
    const f = analizarFilas(filas, datos(), omitidasSinDatos, HOY).filas[0];
    expect(f.estado).toBe("ERROR");
    expect(f.mensajes.join(" ")).toContain("fórmula");
    expect(f.gravado).toBeNull(); // el resultado cacheado de la fórmula NO se usa
  });
  it("una fórmula en una celda de texto o fecha también rechaza la fila", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Acumulados");
    ws.addRow([...COLUMNAS_ACUMULADOS]);
    ws.addRow(fila());
    ws.getRow(2).getCell(10).value = { formula: '"a"&"b"', result: "ab" };
    const { filas } = await leerArchivoAcumulados(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(analizarFilas(filas, datos(), 0, HOY).filas[0].estado).toBe("ERROR");
  });
  it("26) referencia / origen vacía → error", async () => expect((await unica([fila({ 9: null })])).mensajes.join(" ")).toContain("origen / referencia"));
  it("27) más de 2,000 filas de datos → error", async () => {
    const muchas = Array.from({ length: MAX_FILAS_ACUMULADOS + 1 }, () => fila());
    await expect(leerArchivoAcumulados(await libro(muchas))).rejects.toThrow("supera el máximo de 2000 filas");
  }, 60000);
  it("28) un archivo que no es .xlsx (texto/CSV) o supera 5 MB se rechaza", async () => {
    await expect(leerArchivoAcumulados(Buffer.from("codigo,dpi\nE1,123"))).rejects.toThrow("no es un libro .xlsx");
    const enorme = Buffer.alloc(5 * 1024 * 1024 + 1); enorme[0] = 0x50; enorme[1] = 0x4b;
    await expect(leerArchivoAcumulados(enorme)).rejects.toMatchObject({ status: 413 });
  });
  it("29) un .xlsx corrupto (firma ZIP pero contenido dañado) se rechaza con mensaje claro", async () => {
    const corrupto = Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.from("esto no es un zip valido".repeat(20))]);
    await expect(leerArchivoAcumulados(corrupto)).rejects.toBeInstanceOf(ErrorArchivoAcumulados);
  });
  it("libro sin la hoja esperada o con encabezados distintos → error", async () => {
    await expect(leerArchivoAcumulados(await libro([fila()], { hoja: "Otra" }))).rejects.toThrow('no tiene la hoja "Acumulados"');
    await expect(leerArchivoAcumulados(await libro([fila()], { encabezados: [...COLUMNAS_ACUMULADOS].map((c, i) => (i === 5 ? "Gravado" : c)) }))).rejects.toThrow("La columna F");
  });
  it("un archivo sin filas con datos se rechaza", async () => {
    await expect(leerArchivoAcumulados(await libro([]))).rejects.toThrow("no tiene filas con datos");
  });
});

describe("REVISIÓN FISCAL existente y anti doble conteo (análisis)", () => {
  it("30) sin revisión → válida", async () => expect((await unica([fila()])).estado).toBe("VALIDA"));
  it("31) borrador existente → error (no se sobrescribe)", async () => {
    const f = await unica([fila()], datos({ revisiones: new Map([["1:2026", { existe: true, confirmada: false }]]) }));
    expect(f.estado).toBe("ERROR");
    expect(f.mensajes).toContain("Ya existe un borrador fiscal. Debes resolverlo antes de importar.");
  });
  it("32) revisión confirmada existente → error (no se reemplaza automáticamente)", async () => {
    const f = await unica([fila()], datos({ revisiones: new Map([["1:2026", { existe: true, confirmada: true }]]) }));
    expect(f.mensajes).toContain("El empleado ya tiene una revisión fiscal confirmada para este ejercicio.");
  });
  it("otro ejercicio con revisión no bloquea este ejercicio", async () => {
    expect((await unica([fila()], datos({ revisiones: new Map([["1:2025", { existe: true, confirmada: true }]]) }))).estado).toBe("VALIDA");
  });
  it("34) planilla AUTORIZADA que se solapa con enero→corte → error con el mensaje de doble conteo", async () => {
    const f = await unica([fila({ 4: "30/09/2026" })], datos({ periodos: new Map([[1, [{ fechaInicio: "2026-09-16", fechaFin: "2026-09-30", codigo: "2026-09-Q2" }]]]) }));
    expect(f.estado).toBe("ERROR");
    expect(f.mensajes.join(" ")).toContain("se solapa con una planilla autorizada del sistema");
    expect(f.mensajes.join(" ")).toContain("doble conteo");
  });
  it("corte anterior a la primera planilla nueva: correcto", async () => {
    const f = await unica([fila({ 4: "15/09/2026" })], datos({ periodos: new Map([[1, [{ fechaInicio: "2026-09-16", fechaFin: "2026-09-30", codigo: "2026-09-Q2" }]]]) }));
    expect(f.estado).toBe("VALIDA");
  });
  it("35) el origen de los ítems a importar es ACUMULADO_INICIAL_MIGRACION y solo se construyen filas sin error", async () => {
    const r = await analizar([fila(), fila({ 0: "E2", 5: -1 })]);
    const items = construirItemsImportacion(r, HOY);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ numeroFila: 2, empleadoId: 1, ejercicio: 2026 });
    expect((items[0].antecedente as { datos: { declaracionAntecedentes: string; migracion: { referenciaOrigen: string } } }).datos).toMatchObject({
      declaracionAntecedentes: "ACUMULADO_INICIAL_MIGRACION", migracion: { referenciaOrigen: "Sistema anterior" } });
  });
  it("una fila con error no impide ver las demás (vista previa completa) pero bloquea importar", async () => {
    const r = await analizar([fila(), fila({ 0: "E2", 2: "Beto Pérez", 5: -1 }), fila({ 0: "E3", 2: "Carla Ruiz" })]);
    expect(r).toMatchObject({ totalFilas: 3, validas: 2, errores: 1 });
    expect(r.filas.map((f) => f.estado)).toEqual(["VALIDA", "ERROR", "VALIDA"]);
    expect(puedeImportar(r)).toBe(false);
  });
});
