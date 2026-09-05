import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import {
  HEADERS_EMPLEADOS,
  parsearPlantillaEmpleados,
  parsearPlantillaEmpleadosConAdvertencias,
} from "./empleados-export";

async function crearLibro(filas: string[][]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Empleados");
  ws.addRow([...HEADERS_EMPLEADOS]);
  for (const fila of filas) ws.addRow(fila);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Igual que crearLibro(), pero el Excel simulado NO tiene columna(s) `omitir` en absoluto — para distinguir "columna ausente" de "columna presente pero vacía". */
async function crearLibroSinColumnas(
  filas: Record<string, string>[],
  omitir: string[],
): Promise<Buffer> {
  const headers = HEADERS_EMPLEADOS.filter((h) => !omitir.includes(h));
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Empleados");
  ws.addRow([...headers]);
  for (const fila of filas) {
    ws.addRow(headers.map((h) => fila[h] ?? ""));
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

function filaCompletaObj(
  overrides: Partial<Record<(typeof HEADERS_EMPLEADOS)[number], string>> = {},
): Record<string, string> {
  const base: Record<string, string> = {
    codigo: "1234567890123",
    dpi: "1234567890123",
    primer_nombre: "Juan",
    segundo_nombre: "",
    primer_apellido: "Pérez",
    segundo_apellido: "",
    apellido_casada: "",
    nombre: "Juan Pérez",
    nit: "",
    igss: "",
    irtra: "",
    sexo: "M",
    fecha_nacimiento: "",
    puesto: "Piloto",
    area: "Transporte",
    tipo_horario: "Fijo",
    tipo_contrato: "fijo",
    forma_pago: "transferencia",
    profesion: "",
    fecha_contratacion: "01/01/2024",
    fecha_ingreso: "01/01/2024",
    hora_entrada_teorica: "07:00",
    hora_salida_teorica: "16:00",
    estado_laboral: "Activo",
    sueldo_base: "3500",
    bono_incentivo: "0",
    bono_herramientas: "0",
    telefono: "",
    email: "",
    direccion: "",
    pais_origen: "",
    municipio: "",
    etnia: "",
    religion: "",
    idioma: "",
    licencia_numero: "",
    licencia_tipo: "",
    licencia_vence: "",
    cuenta_bancaria: "",
    tipo_cuenta: "",
    banco: "",
    contacto_emergencia: "",
    observaciones: "",
    ...overrides,
  };
  return base;
}

function filaCompleta(
  overrides: Partial<Record<(typeof HEADERS_EMPLEADOS)[number], string>> = {},
): string[] {
  const base = filaCompletaObj(overrides);
  return HEADERS_EMPLEADOS.map((h) => base[h] ?? "");
}

describe("parsearPlantillaEmpleados — filas sin identidad", () => {
  it("una fila sin código se omite (no crea ni actualiza)", async () => {
    const buffer = await crearLibro([
      filaCompleta({ codigo: "", dpi: "" }),
      filaCompleta({ codigo: "9999999999999", dpi: "9999999999999" }),
    ]);

    const filas = await parsearPlantillaEmpleados(buffer);

    expect(filas).toHaveLength(1);
    expect(filas[0].codigo).toBe("9999999999999");
  });

  it("una fila sin nombre (y sin primer_nombre/primer_apellido) se omite", async () => {
    const buffer = await crearLibro([
      filaCompleta({
        codigo: "8888888888888",
        dpi: "8888888888888",
        nombre: "",
        primer_nombre: "",
        primer_apellido: "",
      }),
      filaCompleta({ codigo: "9999999999999", dpi: "9999999999999" }),
    ]);

    const filas = await parsearPlantillaEmpleados(buffer);

    expect(filas).toHaveLength(1);
    expect(filas[0].codigo).toBe("9999999999999");
  });
});

describe("parsearPlantillaEmpleadosConAdvertencias — descartadas visibles con motivo", () => {
  it("fila con nombre pero sin código/DPI => aparece en descartadas con motivo específico", async () => {
    const buffer = await crearLibro([
      filaCompleta({ codigo: "", dpi: "", nombre: "Jason Mayorga", primer_nombre: "", primer_apellido: "" }),
    ]);

    const { filas, descartadas } =
      await parsearPlantillaEmpleadosConAdvertencias(buffer);

    expect(filas).toHaveLength(0);
    expect(descartadas).toEqual([
      expect.objectContaining({
        codigo: "",
        nombre: "Jason Mayorga",
        motivo: "Fila sin código identificador.",
      }),
    ]);
  });

  it("fila con código pero sin nombre (ni primer_nombre/primer_apellido) => descartada con motivo específico", async () => {
    const buffer = await crearLibro([
      filaCompleta({
        codigo: "9999999999999",
        dpi: "9999999999999",
        nombre: "",
        primer_nombre: "",
        primer_apellido: "",
      }),
    ]);

    const { filas, descartadas } =
      await parsearPlantillaEmpleadosConAdvertencias(buffer);

    expect(filas).toHaveLength(0);
    expect(descartadas).toEqual([
      expect.objectContaining({
        codigo: "9999999999999",
        nombre: "",
        motivo: "Fila sin nombre.",
      }),
    ]);
  });

  it("una fila realmente vacía (separador) no genera advertencia", async () => {
    const buffer = await crearLibro([
      filaCompleta({ codigo: "", dpi: "", nombre: "", primer_nombre: "", primer_apellido: "" }),
      filaCompleta({ codigo: "9999999999999", dpi: "9999999999999" }),
    ]);

    const { filas, descartadas } =
      await parsearPlantillaEmpleadosConAdvertencias(buffer);

    expect(filas).toHaveLength(1);
    expect(descartadas).toHaveLength(0);
  });
});

describe("parsearPlantillaEmpleadosConAdvertencias — camposConDefault (ausencia de columna != valor default)", () => {
  it("columna tipo_horario ausente => camposConDefault marca 'tipoHorario'", async () => {
    const buffer = await crearLibroSinColumnas(
      [filaCompletaObj()],
      ["tipo_horario"],
    );

    const { filas } = await parsearPlantillaEmpleadosConAdvertencias(buffer);

    expect(filas).toHaveLength(1);
    expect(filas[0].camposConDefault.has("tipoHorario")).toBe(true);
    // El default sigue siendo "Fijo" para poder dar de alta un nuevo empleado.
    expect(filas[0].tipoHorario).toBe("Fijo");
  });

  it("columna tipo_horario presente con 'Variable' => NO se marca como default", async () => {
    const buffer = await crearLibro([
      filaCompleta({ tipo_horario: "Variable" }),
    ]);

    const { filas } = await parsearPlantillaEmpleadosConAdvertencias(buffer);

    expect(filas[0].camposConDefault.has("tipoHorario")).toBe(false);
    expect(filas[0].tipoHorario).toBe("Variable");
  });

  it("columna estado_laboral ausente => camposConDefault marca 'estado'", async () => {
    const buffer = await crearLibroSinColumnas(
      [filaCompletaObj()],
      ["estado_laboral"],
    );

    const { filas } = await parsearPlantillaEmpleadosConAdvertencias(buffer);

    expect(filas[0].camposConDefault.has("estado")).toBe(true);
    expect(filas[0].estado).toBe("Activo");
  });

  it("columna tipo_contrato ausente => camposConDefault marca 'tipoContrato'", async () => {
    const buffer = await crearLibroSinColumnas(
      [filaCompletaObj()],
      ["tipo_contrato"],
    );

    const { filas } = await parsearPlantillaEmpleadosConAdvertencias(buffer);

    expect(filas[0].camposConDefault.has("tipoContrato")).toBe(true);
    expect(filas[0].tipoContrato).toBe("fijo");
  });

  it("columna forma_pago ausente => camposConDefault marca 'formaPago'", async () => {
    const buffer = await crearLibroSinColumnas(
      [filaCompletaObj()],
      ["forma_pago"],
    );

    const { filas } = await parsearPlantillaEmpleadosConAdvertencias(buffer);

    expect(filas[0].camposConDefault.has("formaPago")).toBe(true);
    expect(filas[0].formaPago).toBe("transferencia");
  });

  it("columna hora_entrada_teorica ausente => camposConDefault marca 'horaEntradaTeorica'", async () => {
    const buffer = await crearLibroSinColumnas(
      [filaCompletaObj()],
      ["hora_entrada_teorica"],
    );

    const { filas } = await parsearPlantillaEmpleadosConAdvertencias(buffer);

    expect(filas[0].camposConDefault.has("horaEntradaTeorica")).toBe(true);
    expect(filas[0].horaEntradaTeorica).toBe("07:00");
  });

  it("columna hora_salida_teorica ausente => camposConDefault marca 'horaSalidaTeorica'", async () => {
    const buffer = await crearLibroSinColumnas(
      [filaCompletaObj()],
      ["hora_salida_teorica"],
    );

    const { filas } = await parsearPlantillaEmpleadosConAdvertencias(buffer);

    expect(filas[0].camposConDefault.has("horaSalidaTeorica")).toBe(true);
    expect(filas[0].horaSalidaTeorica).toBe("16:00");
  });

  it("con todas las columnas presentes, camposConDefault queda vacío", async () => {
    const buffer = await crearLibro([filaCompleta()]);

    const { filas } = await parsearPlantillaEmpleadosConAdvertencias(buffer);

    expect(filas[0].camposConDefault.size).toBe(0);
  });
});
