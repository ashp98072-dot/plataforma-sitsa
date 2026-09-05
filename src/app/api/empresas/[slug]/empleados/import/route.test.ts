import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  CampoConDefaultImport,
  FilaImportEmpleado,
} from "@/lib/rrhh/empleados-export";
import type { Empleado } from "@/lib/rrhh/empleados";

vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: vi.fn() }));
vi.mock("@/lib/rrhh/empleados", () => ({
  actualizarEmpleado: vi.fn(),
  crearEmpleado: vi.fn(),
  obtenerEmpleadoPorCodigo: vi.fn(),
}));
vi.mock("@/lib/rrhh/empleados-export", () => ({
  parsearPlantillaEmpleadosConAdvertencias: vi.fn(),
}));
vi.mock("@/lib/rrhh/config", () => ({
  obtenerParametros: vi.fn(),
}));

import { requireTenantRrhh } from "@/lib/tenant";
import {
  actualizarEmpleado,
  crearEmpleado,
  obtenerEmpleadoPorCodigo,
} from "@/lib/rrhh/empleados";
import { parsearPlantillaEmpleadosConAdvertencias } from "@/lib/rrhh/empleados-export";
import { obtenerParametros } from "@/lib/rrhh/config";
import { POST } from "./route";

const ctx = { params: Promise.resolve({ slug: "sitsa" }) };

function reqConArchivo(): Request {
  const form = new FormData();
  form.append(
    "file",
    new File([new Uint8Array([1, 2, 3])], "empleados.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }),
  );
  return new Request("http://localhost/x", { method: "POST", body: form });
}

/** Fila de importación con defaults razonables — override solo lo que cada test necesita. Por default NINGÚN campo viene de un default del parser (camposConDefault vacío). */
function fila(
  overrides: Partial<FilaImportEmpleado> = {},
): FilaImportEmpleado {
  return {
    filaExcel: 2,
    codigo: "2374186060101",
    nombre: "Juan Pérez",
    dpi: "2374186060101",
    primerNombre: "Juan",
    segundoNombre: "",
    primerApellido: "Pérez",
    segundoApellido: "",
    apellidoCasada: "",
    nit: "",
    igss: "",
    irtra: "",
    sexo: "M",
    fechaNacimiento: "",
    puesto: "Piloto",
    categoriaOps: "Transporte",
    tipoHorario: "Fijo",
    tipoContrato: "fijo",
    formaPago: "transferencia",
    profesion: "",
    fechaAlta: "01/01/2024",
    fechaInicioLaboral: null,
    horaEntradaTeorica: "07:00",
    horaSalidaTeorica: "16:00",
    estado: "Activo",
    sueldoBase: 3500,
    bonoIncentivo: 250,
    bonoHerramientas: 0,
    telefono: "",
    email: "",
    direccion: "",
    paisOrigen: "",
    municipio: "",
    etnia: "",
    religion: "",
    idioma: "",
    licenciaNumero: "",
    licenciaTipo: "",
    licenciaVence: "",
    cuentaBancaria: "",
    tipoCuenta: "",
    banco: "",
    contactoEmergencia: "",
    observaciones: "",
    camposConDefault: new Set<CampoConDefaultImport>(),
    ...overrides,
  };
}

/** Empleado existente con defaults — override solo lo que cada test necesita. */
function empleadoExistente(overrides: Partial<Empleado> = {}): Empleado {
  return {
    id: 42,
    numeroEmpleado: "000042",
    codigo: "2374186060101",
    nombre: "Juan Pérez",
    puesto: "Piloto",
    categoriaOps: "Transporte",
    tipoHorario: "Fijo",
    fechaAlta: "2020-01-01",
    fechaInicioLaboral: "2020-01-01",
    horaEntradaTeorica: "07:00:00",
    horaSalidaTeorica: "16:00:00",
    estado: "Activo",
    dpi: "2374186060101",
    email: "juan@empresa.com",
    igss: "123456",
    tipoContrato: "fijo",
    formaPago: "transferencia",
    horasExtraHabilitado: false,
    fechaEgreso: null,
    ...overrides,
  };
}

/** Mock por defecto de parsearPlantillaEmpleadosConAdvertencias: una fila válida, sin descartes. */
function mockParseo(
  filas: FilaImportEmpleado[],
  descartadas: Array<{ filaExcel: number; codigo: string; nombre: string; motivo: string }> = [],
) {
  vi.mocked(parsearPlantillaEmpleadosConAdvertencias).mockResolvedValue({
    filas,
    descartadas,
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(requireTenantRrhh).mockResolvedValue({
    empresa: { id: 7 },
    session: { username: "rrhh1" },
  } as unknown as Awaited<ReturnType<typeof requireTenantRrhh>>);
  vi.mocked(obtenerParametros).mockResolvedValue({
    hora_entrada_default: "07:00:00",
    hora_salida_default: "16:00:00",
  } as unknown as Awaited<ReturnType<typeof obtenerParametros>>);
  vi.mocked(obtenerEmpleadoPorCodigo).mockResolvedValue(null);
  vi.mocked(crearEmpleado).mockResolvedValue(99);
  vi.mocked(actualizarEmpleado).mockResolvedValue(true);
});
afterEach(() => vi.restoreAllMocks());

describe("POST /api/empresas/[slug]/empleados/import — import segura", () => {
  it("empleado existente + email placeholder '48' => conserva el email actual", async () => {
    mockParseo([fila({ email: "48" })]);
    vi.mocked(obtenerEmpleadoPorCodigo).mockResolvedValue(
      empleadoExistente({ email: "juan@empresa.com" }),
    );

    const res = await POST(reqConArchivo(), ctx);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(data.actualizados).toBe(1);
    expect(vi.mocked(actualizarEmpleado)).toHaveBeenCalledTimes(1);
    const [, , payload] = vi.mocked(actualizarEmpleado).mock.calls[0];
    expect(payload.email).toBe("juan@empresa.com");
  });

  it("empleado existente + IGSS 'N/A' => conserva el IGSS actual", async () => {
    mockParseo([fila({ igss: "N/A" })]);
    vi.mocked(obtenerEmpleadoPorCodigo).mockResolvedValue(
      empleadoExistente({ igss: "123456" }),
    );

    await POST(reqConArchivo(), ctx);

    const [, , payload] = vi.mocked(actualizarEmpleado).mock.calls[0];
    expect(payload.igss).toBe("123456");
  });

  it("empleado existente + campo vacío => conserva el valor actual", async () => {
    mockParseo([fila({ telefono: "" })]);
    vi.mocked(obtenerEmpleadoPorCodigo).mockResolvedValue(
      empleadoExistente({ telefono: "5555-1234" }),
    );

    await POST(reqConArchivo(), ctx);

    const [, , payload] = vi.mocked(actualizarEmpleado).mock.calls[0];
    expect(payload.telefono).toBe("5555-1234");
  });

  it("empleado existente + valor válido nuevo => sí actualiza", async () => {
    mockParseo([fila({ email: "nuevo@empresa.com" })]);
    vi.mocked(obtenerEmpleadoPorCodigo).mockResolvedValue(
      empleadoExistente({ email: "viejo@empresa.com" }),
    );

    await POST(reqConArchivo(), ctx);

    const [, , payload] = vi.mocked(actualizarEmpleado).mock.calls[0];
    expect(payload.email).toBe("nuevo@empresa.com");
  });

  it("horasExtraHabilitado=true existente => la reimportación no lo cambia a false", async () => {
    mockParseo([fila()]);
    vi.mocked(obtenerEmpleadoPorCodigo).mockResolvedValue(
      empleadoExistente({ horasExtraHabilitado: true }),
    );

    await POST(reqConArchivo(), ctx);

    const [, , payload] = vi.mocked(actualizarEmpleado).mock.calls[0];
    expect(payload.horasExtraHabilitado).toBe(true);
  });

  it("supervisorIds existentes => la importación no los toca (undefined, no [])", async () => {
    mockParseo([fila()]);
    vi.mocked(obtenerEmpleadoPorCodigo).mockResolvedValue(
      empleadoExistente(),
    );

    await POST(reqConArchivo(), ctx);

    const [, , payload] = vi.mocked(actualizarEmpleado).mock.calls[0];
    expect(payload.supervisorIds).toBeUndefined();
  });

  it("fechaEgreso histórica => la reimportación no la reemplaza por hoy, ni siquiera si el Excel trae estado Baja", async () => {
    mockParseo([fila({ estado: "Baja" })]);
    vi.mocked(obtenerEmpleadoPorCodigo).mockResolvedValue(
      empleadoExistente({ estado: "Baja", fechaEgreso: "2022-06-15" }),
    );

    await POST(reqConArchivo(), ctx);

    const [, , payload] = vi.mocked(actualizarEmpleado).mock.calls[0];
    expect(payload.fechaEgreso).toBe("2022-06-15");
  });

  it("empleado existente marcado Baja sin fechaEgreso previa => la reimportación NO le asigna hoyLocal()", async () => {
    mockParseo([fila({ estado: "Baja" })]);
    vi.mocked(obtenerEmpleadoPorCodigo).mockResolvedValue(
      empleadoExistente({ estado: "Activo", fechaEgreso: null }),
    );

    await POST(reqConArchivo(), ctx);

    const [, , payload] = vi.mocked(actualizarEmpleado).mock.calls[0];
    expect(payload.fechaEgreso).toBeNull();
  });

  it("placeholders case-insensitive: n/a, N/A, pendiente, PENDIENTE se tratan todos igual", async () => {
    mockParseo([
      fila({ igss: "n/a", irtra: "N/A", profesion: "pendiente", nit: "PENDIENTE" }),
    ]);
    vi.mocked(obtenerEmpleadoPorCodigo).mockResolvedValue(
      empleadoExistente({
        igss: "IGSS-1",
        irtra: "IRTRA-1",
        profesion: "Piloto profesional",
        nit: "NIT-1",
      }),
    );

    await POST(reqConArchivo(), ctx);

    const [, , payload] = vi.mocked(actualizarEmpleado).mock.calls[0];
    expect(payload.igss).toBe("IGSS-1");
    expect(payload.irtra).toBe("IRTRA-1");
    expect(payload.profesion).toBe("Piloto profesional");
    expect(payload.nit).toBe("NIT-1");
  });

  it("empleado nuevo con datos válidos => se crea correctamente, sin protección de placeholders", async () => {
    mockParseo([fila()]);
    vi.mocked(obtenerEmpleadoPorCodigo).mockResolvedValue(null);

    const res = await POST(reqConArchivo(), ctx);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(crearEmpleado).toHaveBeenCalledTimes(1);
    expect(actualizarEmpleado).not.toHaveBeenCalled();
    expect(data.creados).toBe(1);
  });

  it("si una fila falla, el resto sigue procesándose", async () => {
    mockParseo([
      fila({ filaExcel: 2, codigo: "1001", dpi: "1001" }),
      fila({ filaExcel: 3, codigo: "1002", dpi: "1002" }),
    ]);
    vi.mocked(obtenerEmpleadoPorCodigo).mockResolvedValue(null);
    vi.mocked(crearEmpleado)
      .mockRejectedValueOnce(new Error("fallo fila 2"))
      .mockResolvedValueOnce(100);

    const res = await POST(reqConArchivo(), ctx);
    const data = await res.json();

    expect(crearEmpleado).toHaveBeenCalledTimes(2);
    expect(data.creados).toBe(1);
    expect(data.errores).toHaveLength(1);
    expect(data.errores[0]).toContain("fallo fila 2");
  });
});

describe("POST import — ausencia de columna != valor default (camposConDefault)", () => {
  it("1) BD tipoHorario=Variable, Excel SIN columna tipo_horario => conserva Variable", async () => {
    mockParseo([
      fila({
        tipoHorario: "Fijo", // el parser puso "Fijo" solo porque no había columna
        camposConDefault: new Set<CampoConDefaultImport>(["tipoHorario"]),
      }),
    ]);
    vi.mocked(obtenerEmpleadoPorCodigo).mockResolvedValue(
      empleadoExistente({ tipoHorario: "Variable" }),
    );

    await POST(reqConArchivo(), ctx);

    const [, , payload] = vi.mocked(actualizarEmpleado).mock.calls[0];
    expect(payload.tipoHorario).toBe("Variable");
  });

  it("2) BD estado=Baja, Excel SIN columna estado_laboral => conserva Baja", async () => {
    mockParseo([
      fila({
        estado: "Activo", // el parser puso "Activo" solo porque no había columna
        camposConDefault: new Set<CampoConDefaultImport>(["estado"]),
      }),
    ]);
    vi.mocked(obtenerEmpleadoPorCodigo).mockResolvedValue(
      empleadoExistente({ estado: "Baja", fechaEgreso: "2023-05-01" }),
    );

    await POST(reqConArchivo(), ctx);

    const [, , payload] = vi.mocked(actualizarEmpleado).mock.calls[0];
    expect(payload.estado).toBe("Baja");
  });

  it("3) BD tipoContrato=temporal, Excel SIN columna tipo_contrato => conserva temporal", async () => {
    mockParseo([
      fila({
        tipoContrato: "fijo",
        camposConDefault: new Set<CampoConDefaultImport>(["tipoContrato"]),
      }),
    ]);
    vi.mocked(obtenerEmpleadoPorCodigo).mockResolvedValue(
      empleadoExistente({ tipoContrato: "temporal" }),
    );

    await POST(reqConArchivo(), ctx);

    const [, , payload] = vi.mocked(actualizarEmpleado).mock.calls[0];
    expect(payload.tipoContrato).toBe("temporal");
  });

  it("4) BD formaPago=cheque, Excel SIN columna forma_pago => conserva cheque", async () => {
    mockParseo([
      fila({
        formaPago: "transferencia",
        camposConDefault: new Set<CampoConDefaultImport>(["formaPago"]),
      }),
    ]);
    vi.mocked(obtenerEmpleadoPorCodigo).mockResolvedValue(
      empleadoExistente({ formaPago: "cheque" }),
    );

    await POST(reqConArchivo(), ctx);

    const [, , payload] = vi.mocked(actualizarEmpleado).mock.calls[0];
    expect(payload.formaPago).toBe("cheque");
  });

  it("5) BD horaEntrada=08:00:00, Excel SIN columna hora_entrada => conserva 08:00:00", async () => {
    mockParseo([
      fila({
        horaEntradaTeorica: "07:00",
        camposConDefault: new Set<CampoConDefaultImport>([
          "horaEntradaTeorica",
        ]),
      }),
    ]);
    vi.mocked(obtenerEmpleadoPorCodigo).mockResolvedValue(
      empleadoExistente({ horaEntradaTeorica: "08:00:00" }),
    );

    await POST(reqConArchivo(), ctx);

    const [, , payload] = vi.mocked(actualizarEmpleado).mock.calls[0];
    expect(payload.horaEntradaTeorica).toBe("08:00:00");
  });

  it("6) Excel SÍ trae tipo_horario=Fijo explícito, BD=Variable => sí actualiza a Fijo", async () => {
    mockParseo([
      fila({
        tipoHorario: "Fijo",
        camposConDefault: new Set<CampoConDefaultImport>(), // columna SÍ presente
      }),
    ]);
    vi.mocked(obtenerEmpleadoPorCodigo).mockResolvedValue(
      empleadoExistente({ tipoHorario: "Variable" }),
    );

    await POST(reqConArchivo(), ctx);

    const [, , payload] = vi.mocked(actualizarEmpleado).mock.calls[0];
    expect(payload.tipoHorario).toBe("Fijo");
  });

  it("11) empleado NUEVO válido con columnas opcionales ausentes => se crea usando los defaults necesarios", async () => {
    mockParseo([
      fila({
        tipoHorario: "Fijo",
        estado: "Activo",
        tipoContrato: "fijo",
        formaPago: "transferencia",
        horaEntradaTeorica: "07:00",
        horaSalidaTeorica: "16:00",
        camposConDefault: new Set<CampoConDefaultImport>([
          "tipoHorario",
          "estado",
          "tipoContrato",
          "formaPago",
          "horaEntradaTeorica",
          "horaSalidaTeorica",
        ]),
      }),
    ]);
    vi.mocked(obtenerEmpleadoPorCodigo).mockResolvedValue(null);

    const res = await POST(reqConArchivo(), ctx);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(crearEmpleado).toHaveBeenCalledTimes(1);
    expect(data.creados).toBe(1);
    const [, payload] = vi.mocked(crearEmpleado).mock.calls[0];
    expect(payload.tipoHorario).toBe("Fijo");
    expect(payload.estado).toBe("Activo");
    expect(payload.tipoContrato).toBe("fijo");
    expect(payload.formaPago).toBe("transferencia");
  });
});

describe("POST import — código sospechoso: NUNCA crea ni actualiza automáticamente", () => {
  it("7) código '3' + DPI válido de 13 dígitos, NO existe empleado => NO crea, omitido + advertencia", async () => {
    mockParseo([fila({ codigo: "3", dpi: "2374186060101" })]);
    vi.mocked(obtenerEmpleadoPorCodigo).mockResolvedValue(null);

    const res = await POST(reqConArchivo(), ctx);
    const data = await res.json();

    expect(crearEmpleado).not.toHaveBeenCalled();
    expect(actualizarEmpleado).not.toHaveBeenCalled();
    expect(data.creados).toBe(0);
    expect(data.omitidos).toBe(1);
    expect(data.advertencias).toEqual([
      expect.objectContaining({
        codigo: "3",
        motivo: expect.stringContaining("Código sospechoso"),
      }),
    ]);
  });

  it("8) código '3' + DPI válido de 13 dígitos, SÍ existe empleado => NO actualiza, omitido + advertencia", async () => {
    mockParseo([fila({ codigo: "3", dpi: "2374186060101" })]);
    vi.mocked(obtenerEmpleadoPorCodigo).mockResolvedValue(
      empleadoExistente({ codigo: "3" }),
    );

    const res = await POST(reqConArchivo(), ctx);
    const data = await res.json();

    expect(actualizarEmpleado).not.toHaveBeenCalled();
    expect(crearEmpleado).not.toHaveBeenCalled();
    expect(data.actualizados).toBe(0);
    expect(data.omitidos).toBe(1);
    expect(data.advertencias).toEqual([
      expect.objectContaining({
        codigo: "3",
        motivo: expect.stringContaining("Código sospechoso"),
      }),
    ]);
    // No debería ni haberse consultado si existe (no importa: pero
    // sobre todo nunca debe llamarse a actualizarEmpleado/crearEmpleado).
  });
});

describe("POST import — filas sin identidad (descartadas por el parser)", () => {
  it("9) fila con nombre pero sin código/DPI => omitida + advertencia visible", async () => {
    mockParseo(
      [],
      [
        {
          filaExcel: 5,
          codigo: "",
          nombre: "Jason Mayorga",
          motivo: "Fila sin código identificador.",
        },
      ],
    );

    const res = await POST(reqConArchivo(), ctx);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(crearEmpleado).not.toHaveBeenCalled();
    expect(actualizarEmpleado).not.toHaveBeenCalled();
    expect(data.omitidos).toBe(1);
    expect(data.advertencias).toEqual([
      {
        filaExcel: 5,
        codigo: "",
        nombre: "Jason Mayorga",
        motivo: "Fila sin código identificador.",
      },
    ]);
  });

  it("10) fila sin nombre => omitida + advertencia", async () => {
    mockParseo(
      [],
      [
        {
          filaExcel: 6,
          codigo: "9999999999999",
          nombre: "",
          motivo: "Fila sin nombre.",
        },
      ],
    );

    const res = await POST(reqConArchivo(), ctx);
    const data = await res.json();

    expect(res.status).toBe(200);
    expect(crearEmpleado).not.toHaveBeenCalled();
    expect(data.omitidos).toBe(1);
    expect(data.advertencias[0].motivo).toBe("Fila sin nombre.");
  });
});
