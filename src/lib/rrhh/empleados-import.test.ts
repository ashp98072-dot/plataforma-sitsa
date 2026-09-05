import { describe, expect, it } from "vitest";
import type { Empleado, EmpleadoInput } from "./empleados";
import type { CampoConDefaultImport } from "./empleados-export";
import {
  codigoSospechosoImport,
  esPlaceholderImport,
  fusionarEmpleadoImport,
} from "./empleados-import";

/** Ningún campo vino de un default del parser — todos son datos explícitos del Excel. */
const SIN_DEFAULTS: ReadonlySet<CampoConDefaultImport> = new Set();

function conDefault(
  ...campos: CampoConDefaultImport[]
): ReadonlySet<CampoConDefaultImport> {
  return new Set(campos);
}

function empleado(overrides: Partial<Empleado> = {}): Empleado {
  return {
    id: 1,
    numeroEmpleado: "000001",
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
    sueldoBase: 3500,
    bonoIncentivo: 250,
    bonoHerramientas: 0,
    horasExtraHabilitado: false,
    fechaEgreso: null,
    ...overrides,
  };
}

function candidato(overrides: Partial<EmpleadoInput> = {}): EmpleadoInput {
  return {
    codigo: "2374186060101",
    nombre: "Juan Pérez",
    puesto: "Piloto",
    categoriaOps: "Transporte",
    tipoHorario: "Fijo",
    fechaAlta: "2024-01-01",
    horaEntradaTeorica: "07:00:00",
    horaSalidaTeorica: "16:00:00",
    estado: "Activo",
    tipoContrato: "fijo",
    formaPago: "transferencia",
    sueldoBase: 3500,
    bonoIncentivo: 250,
    bonoHerramientas: 0,
    ...overrides,
  };
}

describe("esPlaceholderImport", () => {
  it("reconoce placeholders case-insensitive y con espacios", () => {
    expect(esPlaceholderImport("")).toBe(true);
    expect(esPlaceholderImport("  ")).toBe(true);
    expect(esPlaceholderImport("48")).toBe(true);
    expect(esPlaceholderImport("n/a")).toBe(true);
    expect(esPlaceholderImport("N/A")).toBe(true);
    expect(esPlaceholderImport("NA")).toBe(true);
    expect(esPlaceholderImport("na")).toBe(true);
    expect(esPlaceholderImport("Pendiente")).toBe(true);
    expect(esPlaceholderImport("PENDIENTE")).toBe(true);
    expect(esPlaceholderImport("  pendiente  ")).toBe(true);
    expect(esPlaceholderImport("0000")).toBe(true);
    expect(esPlaceholderImport("-")).toBe(true);
    expect(esPlaceholderImport("—")).toBe(true);
    expect(esPlaceholderImport(null)).toBe(true);
    expect(esPlaceholderImport(undefined)).toBe(true);
  });

  it("no confunde un valor real con un placeholder", () => {
    expect(esPlaceholderImport("juan@empresa.com")).toBe(false);
    expect(esPlaceholderImport("123456")).toBe(false);
    expect(esPlaceholderImport("480")).toBe(false); // no es exactamente "48"
  });
});

describe("fusionarEmpleadoImport — placeholders y ausencia de dato (campos de texto/fecha/monto)", () => {
  it("email placeholder '48' => conserva el email actual", () => {
    const resultado = fusionarEmpleadoImport(
      empleado({ email: "juan@empresa.com" }),
      candidato({ email: "48" }),
      SIN_DEFAULTS,
    );
    expect(resultado.email).toBe("juan@empresa.com");
  });

  it("igss 'N/A' => conserva el igss actual", () => {
    const resultado = fusionarEmpleadoImport(
      empleado({ igss: "123456" }),
      candidato({ igss: "N/A" }),
      SIN_DEFAULTS,
    );
    expect(resultado.igss).toBe("123456");
  });

  it("campo vacío en el Excel => conserva el valor actual", () => {
    const resultado = fusionarEmpleadoImport(
      empleado({ telefono: "5555-1234" }),
      candidato({ telefono: "" }),
      SIN_DEFAULTS,
    );
    expect(resultado.telefono).toBe("5555-1234");
  });

  it("valor válido nuevo en el Excel => sí actualiza", () => {
    const resultado = fusionarEmpleadoImport(
      empleado({ email: "viejo@empresa.com" }),
      candidato({ email: "nuevo@empresa.com" }),
      SIN_DEFAULTS,
    );
    expect(resultado.email).toBe("nuevo@empresa.com");
  });

  it("existente.email vacío + excel con valor real => usa el del Excel", () => {
    const resultado = fusionarEmpleadoImport(
      empleado({ email: "" }),
      candidato({ email: "juan@empresa.com" }),
      SIN_DEFAULTS,
    );
    expect(resultado.email).toBe("juan@empresa.com");
  });

  it("horasExtraHabilitado=true existente => nunca lo cambia a false, aunque el candidato no lo envíe", () => {
    const resultado = fusionarEmpleadoImport(
      empleado({ horasExtraHabilitado: true }),
      candidato(), // candidato no trae horasExtraHabilitado (el importador no lo conoce)
      SIN_DEFAULTS,
    );
    expect(resultado.horasExtraHabilitado).toBe(true);
  });

  it("supervisorIds: siempre queda undefined (no tocar), incluso si el candidato trajera un valor", () => {
    const resultado = fusionarEmpleadoImport(
      empleado(),
      candidato({ supervisorIds: [5, 6] }),
      SIN_DEFAULTS,
    );
    expect(resultado.supervisorIds).toBeUndefined();
  });

  it("fechaEgreso histórica se preserva aunque el Excel marque Baja", () => {
    const resultado = fusionarEmpleadoImport(
      empleado({ estado: "Baja", fechaEgreso: "2022-06-15" }),
      candidato({ estado: "Baja" }),
      SIN_DEFAULTS,
    );
    expect(resultado.fechaEgreso).toBe("2022-06-15");
  });

  it("empleado sin fechaEgreso previa, Excel lo marca Baja => NO se autoasigna hoy, queda null", () => {
    const resultado = fusionarEmpleadoImport(
      empleado({ estado: "Activo", fechaEgreso: null }),
      candidato({ estado: "Baja" }),
      SIN_DEFAULTS,
    );
    expect(resultado.fechaEgreso).toBeNull();
  });

  it("placeholders case-insensitive: n/a, N/A, pendiente, PENDIENTE se comportan igual", () => {
    const base = empleado({
      igss: "IGSS-1",
      irtra: "IRTRA-1",
      profesion: "Piloto profesional",
    });

    expect(
      fusionarEmpleadoImport(base, candidato({ igss: "n/a" }), SIN_DEFAULTS)
        .igss,
    ).toBe("IGSS-1");
    expect(
      fusionarEmpleadoImport(base, candidato({ irtra: "N/A" }), SIN_DEFAULTS)
        .irtra,
    ).toBe("IRTRA-1");
    expect(
      fusionarEmpleadoImport(
        base,
        candidato({ profesion: "pendiente" }),
        SIN_DEFAULTS,
      ).profesion,
    ).toBe("Piloto profesional");
  });

  it("montos: una celda de sueldo ausente/no numérica conserva el monto actual", () => {
    const resultado = fusionarEmpleadoImport(
      empleado({ sueldoBase: 4000 }),
      candidato({ sueldoBase: null }),
      SIN_DEFAULTS,
    );
    expect(resultado.sueldoBase).toBe(4000);
  });

  it("montos: un valor numérico real en el Excel sí actualiza el sueldo", () => {
    const resultado = fusionarEmpleadoImport(
      empleado({ sueldoBase: 4000 }),
      candidato({ sueldoBase: 4500 }),
      SIN_DEFAULTS,
    );
    expect(resultado.sueldoBase).toBe(4500);
  });

  it("fechas opcionales: sin fecha de nacimiento en el Excel, conserva la existente", () => {
    const resultado = fusionarEmpleadoImport(
      empleado({ fechaNacimiento: "1990-03-15" }),
      candidato({ fechaNacimiento: null }),
      SIN_DEFAULTS,
    );
    expect(resultado.fechaNacimiento).toBe("1990-03-15");
  });
});

describe("fusionarEmpleadoImport — ausencia de columna != valor default (camposConDefault)", () => {
  it("BD tipoHorario=Variable, Excel SIN columna tipo_horario => conserva Variable", () => {
    const resultado = fusionarEmpleadoImport(
      empleado({ tipoHorario: "Variable" }),
      candidato({ tipoHorario: "Fijo" }), // el parser puso "Fijo" solo porque no había columna
      conDefault("tipoHorario"),
    );
    expect(resultado.tipoHorario).toBe("Variable");
  });

  it("BD estado=Baja, Excel SIN columna estado_laboral => conserva Baja", () => {
    const resultado = fusionarEmpleadoImport(
      empleado({ estado: "Baja", fechaEgreso: "2023-01-01" }),
      candidato({ estado: "Activo" }), // el parser puso "Activo" solo porque no había columna
      conDefault("estado"),
    );
    expect(resultado.estado).toBe("Baja");
  });

  it("BD tipoContrato=temporal, Excel SIN columna tipo_contrato => conserva temporal", () => {
    const resultado = fusionarEmpleadoImport(
      empleado({ tipoContrato: "temporal" }),
      candidato({ tipoContrato: "fijo" }),
      conDefault("tipoContrato"),
    );
    expect(resultado.tipoContrato).toBe("temporal");
  });

  it("BD formaPago=cheque, Excel SIN columna forma_pago => conserva cheque", () => {
    const resultado = fusionarEmpleadoImport(
      empleado({ formaPago: "cheque" }),
      candidato({ formaPago: "transferencia" }),
      conDefault("formaPago"),
    );
    expect(resultado.formaPago).toBe("cheque");
  });

  it("BD horaEntrada=08:00:00, Excel SIN columna hora_entrada => conserva 08:00:00", () => {
    const resultado = fusionarEmpleadoImport(
      empleado({ horaEntradaTeorica: "08:00:00" }),
      candidato({ horaEntradaTeorica: "07:00:00" }),
      conDefault("horaEntradaTeorica"),
    );
    expect(resultado.horaEntradaTeorica).toBe("08:00:00");
  });

  it("BD horaSalida=17:00:00, Excel SIN columna hora_salida => conserva 17:00:00", () => {
    const resultado = fusionarEmpleadoImport(
      empleado({ horaSalidaTeorica: "17:00:00" }),
      candidato({ horaSalidaTeorica: "16:00:00" }),
      conDefault("horaSalidaTeorica"),
    );
    expect(resultado.horaSalidaTeorica).toBe("17:00:00");
  });

  it("Excel SÍ trae tipo_horario=Fijo explícito, BD=Variable => sí actualiza a Fijo", () => {
    const resultado = fusionarEmpleadoImport(
      empleado({ tipoHorario: "Variable" }),
      candidato({ tipoHorario: "Fijo" }),
      SIN_DEFAULTS, // NO viene de un default: la columna sí traía "Fijo"
    );
    expect(resultado.tipoHorario).toBe("Fijo");
  });

  it("Excel SÍ trae estado=Baja explícito, BD=Activo => sí actualiza a Baja", () => {
    const resultado = fusionarEmpleadoImport(
      empleado({ estado: "Activo" }),
      candidato({ estado: "Baja" }),
      SIN_DEFAULTS,
    );
    expect(resultado.estado).toBe("Baja");
  });
});

describe("codigoSospechosoImport", () => {
  it("código vacío es sospechoso", () => {
    expect(codigoSospechosoImport("", "2374186060101")).toBe(true);
  });

  it('codigo="3", dpi="2374186060101" => true (un solo dígito)', () => {
    expect(codigoSospechosoImport("3", "2374186060101")).toBe(true);
  });

  it('codigo="2374186060102", dpi="2374186060101" => true (ambos parecen DPI, no coinciden)', () => {
    expect(codigoSospechosoImport("2374186060102", "2374186060101")).toBe(
      true,
    );
  });

  it('codigo="2374186060101", dpi="2374186060101" => false (coinciden)', () => {
    expect(codigoSospechosoImport("2374186060101", "2374186060101")).toBe(
      false,
    );
  });

  it('codigo="EMP-003", dpi="2374186060101" => false (código interno, no parece DPI)', () => {
    expect(codigoSospechosoImport("EMP-003", "2374186060101")).toBe(false);
  });

  it('codigo="325", dpi="2374186060101" => false (código interno corto, no parece DPI)', () => {
    expect(codigoSospechosoImport("325", "2374186060101")).toBe(false);
  });

  it('codigo="00325", dpi="2374186060101" => false (código interno con ceros a la izquierda, no tiene 13 dígitos)', () => {
    expect(codigoSospechosoImport("00325", "2374186060101")).toBe(false);
  });

  it('codigo="EMP-003", dpi="" => false (sin DPI que comparar)', () => {
    expect(codigoSospechosoImport("EMP-003", "")).toBe(false);
  });
});
