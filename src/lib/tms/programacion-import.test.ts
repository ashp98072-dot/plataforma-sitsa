import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/operaciones/disponibilidad", () => ({ listarDisponibilidadVehiculos: vi.fn() }));

import { query } from "@/lib/db";
import { listarDisponibilidadVehiculos, type VehiculoDisponibilidad } from "@/lib/operaciones/disponibilidad";
import type { FilaProgramacionExcel } from "./programacion-import-excel";
import {
  claveDuplicadoFila,
  detectarFilasDuplicadas,
  detectarTraslapesEnLote,
  previsualizarImportacionProgramacion,
} from "./programacion-import";

/**
 * TMS-IMPORTACION-PROGRAMACION-EXCEL (PR 3 de 6) — validaciones puras
 * entre filas del mismo Excel. Mismo criterio de prueba que el resto de
 * este módulo (ver personal-resolucion.test.ts / rutas-import.test.ts):
 * se construyen objetos `FilaProgramacionExcel` directamente (los
 * mismos que ya devuelve `parsearExcelProgramacion` del PR 2), sin pasar
 * por Excel — el parser ya se prueba aparte en su propio archivo.
 */
function filaFixture(overrides: Partial<FilaProgramacionExcel> = {}): FilaProgramacionExcel {
  return {
    filaExcel: 4,
    fechaSalidaExcel: "2026-09-20",
    horaSalidaExcel: "08:00",
    codigoRutaExcel: "1001",
    // Coincide con el cliente_nit por defecto de rutaRow() en los tests
    // de previsualizarImportacionProgramacion más abajo (el "camino feliz"
    // por defecto se valida contra NIT, no contra nombre).
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

describe("claveDuplicadoFila", () => {
  it("combina fecha+hora+ruta+piloto+unidad, normalizado (case-insensitive, sin espacios extremos)", () => {
    const a = claveDuplicadoFila(filaFixture({ pilotoCodigoExcel: "p-1 " }));
    const b = claveDuplicadoFila(filaFixture({ pilotoCodigoExcel: "P-1" }));
    expect(a).toBe(b);
  });

  it("cambia si cambia cualquiera de los 5 componentes", () => {
    const base = claveDuplicadoFila(filaFixture());
    expect(claveDuplicadoFila(filaFixture({ fechaSalidaExcel: "2026-09-21" }))).not.toBe(base);
    expect(claveDuplicadoFila(filaFixture({ horaSalidaExcel: "09:00" }))).not.toBe(base);
    expect(claveDuplicadoFila(filaFixture({ codigoRutaExcel: "1002" }))).not.toBe(base);
    expect(claveDuplicadoFila(filaFixture({ pilotoCodigoExcel: "P-2" }))).not.toBe(base);
    expect(claveDuplicadoFila(filaFixture({ placaExcel: "Q-999XYZ" }))).not.toBe(base);
  });
});

describe("detectarFilasDuplicadas", () => {
  it("sin duplicados: devuelve []", () => {
    const filas = [
      filaFixture({ filaExcel: 4, codigoRutaExcel: "1001" }),
      filaFixture({ filaExcel: 5, codigoRutaExcel: "1002" }),
    ];
    expect(detectarFilasDuplicadas(filas)).toEqual([]);
  });

  it("2 filas con clave idéntica: ambas se reportan, cada una apuntando a la otra", () => {
    const filas = [
      filaFixture({ filaExcel: 4 }),
      filaFixture({ filaExcel: 7 }),
    ];
    const resultado = detectarFilasDuplicadas(filas);
    expect(resultado).toEqual([
      { filaExcel: 4, duplicadaCon: [7] },
      { filaExcel: 7, duplicadaCon: [4] },
    ]);
  });

  it("3 filas con la misma clave: las 3 se reportan, cada una con las otras 2", () => {
    const filas = [4, 5, 6].map((filaExcel) => filaFixture({ filaExcel }));
    const resultado = detectarFilasDuplicadas(filas);
    expect(resultado).toEqual([
      { filaExcel: 4, duplicadaCon: [5, 6] },
      { filaExcel: 5, duplicadaCon: [4, 6] },
      { filaExcel: 6, duplicadaCon: [4, 5] },
    ]);
  });

  it("misma ruta repetida con piloto distinto: NO es duplicado (regla explícita del negocio)", () => {
    const filas = [
      filaFixture({ filaExcel: 4, codigoRutaExcel: "2", pilotoCodigoExcel: "P-1" }),
      filaFixture({ filaExcel: 5, codigoRutaExcel: "2", pilotoCodigoExcel: "P-2" }),
    ];
    expect(detectarFilasDuplicadas(filas)).toEqual([]);
  });

  it("misma ruta y piloto pero unidad distinta: NO es duplicado", () => {
    const filas = [
      filaFixture({ filaExcel: 4, codigoRutaExcel: "2", placaExcel: "AAA111" }),
      filaFixture({ filaExcel: 5, codigoRutaExcel: "2", placaExcel: "BBB222" }),
    ];
    expect(detectarFilasDuplicadas(filas)).toEqual([]);
  });

  it("misma clave salvo la hora de salida: NO es duplicado", () => {
    const filas = [
      filaFixture({ filaExcel: 4, horaSalidaExcel: "08:00" }),
      filaFixture({ filaExcel: 5, horaSalidaExcel: "09:00" }),
    ];
    expect(detectarFilasDuplicadas(filas)).toEqual([]);
  });

  it("filas con campos obligatorios vacíos (rotas): se excluyen de la comparación, sin falsos positivos entre sí", () => {
    const filas = [
      filaFixture({ filaExcel: 4, placaExcel: "" }),
      filaFixture({ filaExcel: 5, placaExcel: "" }),
    ];
    expect(detectarFilasDuplicadas(filas)).toEqual([]);
  });
});

describe("detectarTraslapesEnLote", () => {
  it("sin conflictos: devuelve []", () => {
    const filas = [
      filaFixture({ filaExcel: 4, pilotoCodigoExcel: "P-1", placaExcel: "AAA111" }),
      filaFixture({ filaExcel: 5, pilotoCodigoExcel: "P-2", placaExcel: "BBB222" }),
    ];
    expect(detectarTraslapesEnLote(filas)).toEqual([]);
  });

  it("mismo piloto (unidad distinta), intervalos que se solapan: conflicto reportado en ambos lados", () => {
    const filas = [
      filaFixture({ filaExcel: 4, pilotoCodigoExcel: "P-1", placaExcel: "AAA111", horaSalidaExcel: "08:00", horaRegresoExcel: "14:00" }),
      filaFixture({ filaExcel: 5, pilotoCodigoExcel: "P-1", placaExcel: "BBB222", horaSalidaExcel: "12:00", horaRegresoExcel: "18:00" }),
    ];
    const resultado = detectarTraslapesEnLote(filas);
    expect(resultado).toHaveLength(2);
    expect(resultado[0]).toMatchObject({ filaExcel: 4, filaExcelConflicto: 5, categoria: "persona", rolEnFila: "piloto", rolEnFilaConflicto: "piloto" });
    expect(resultado[1]).toMatchObject({ filaExcel: 5, filaExcelConflicto: 4, categoria: "persona" });
  });

  it("mismo piloto (unidad distinta), intervalos que solo se TOCAN en el límite (fin de A = inicio de B): NO es conflicto", () => {
    const filas = [
      filaFixture({ filaExcel: 4, pilotoCodigoExcel: "P-1", placaExcel: "AAA111", horaSalidaExcel: "08:00", horaRegresoExcel: "12:00" }),
      filaFixture({ filaExcel: 5, pilotoCodigoExcel: "P-1", placaExcel: "BBB222", horaSalidaExcel: "12:00", horaRegresoExcel: "18:00" }),
    ];
    expect(detectarTraslapesEnLote(filas)).toEqual([]);
  });

  it("mismo piloto (unidad distinta), mismo día, horarios que NO se solapan: sin conflicto (no se bloquea por 'misma fecha')", () => {
    const filas = [
      filaFixture({ filaExcel: 4, pilotoCodigoExcel: "P-1", placaExcel: "AAA111", horaSalidaExcel: "08:00", horaRegresoExcel: "12:00" }),
      filaFixture({ filaExcel: 5, pilotoCodigoExcel: "P-1", placaExcel: "BBB222", horaSalidaExcel: "13:00", horaRegresoExcel: "18:00" }),
    ];
    expect(detectarTraslapesEnLote(filas)).toEqual([]);
  });

  it("el piloto de una fila es el auxiliar de otra (misma persona, roles distintos): SÍ es conflicto — mismo criterio que disponibilidad-traslapes.ts", () => {
    const filas = [
      filaFixture({ filaExcel: 4, pilotoCodigoExcel: "P-1", auxiliar1CodigoExcel: "", placaExcel: "AAA111", horaSalidaExcel: "08:00", horaRegresoExcel: "14:00" }),
      filaFixture({ filaExcel: 5, pilotoCodigoExcel: "P-9", auxiliar1CodigoExcel: "P-1", placaExcel: "BBB222", horaSalidaExcel: "10:00", horaRegresoExcel: "16:00" }),
    ];
    const resultado = detectarTraslapesEnLote(filas);
    const deLaFila4 = resultado.find((r) => r.filaExcel === 4);
    expect(deLaFila4).toMatchObject({ categoria: "persona", rolEnFila: "piloto", rolEnFilaConflicto: "auxiliar" });
  });

  it("mismo auxiliar en dos filas (aux1 de una vs aux2 de otra), con solape: conflicto", () => {
    const filas = [
      filaFixture({ filaExcel: 4, auxiliar1CodigoExcel: "A-1", placaExcel: "AAA111", horaSalidaExcel: "08:00", horaRegresoExcel: "14:00" }),
      filaFixture({ filaExcel: 5, auxiliar2CodigoExcel: "A-1", pilotoCodigoExcel: "P-9", placaExcel: "BBB222", horaSalidaExcel: "10:00", horaRegresoExcel: "16:00" }),
    ];
    const resultado = detectarTraslapesEnLote(filas);
    expect(resultado.some((r) => r.filaExcel === 4 && r.rolEnFila === "auxiliar" && r.rolEnFilaConflicto === "auxiliar")).toBe(true);
  });

  it("misma unidad (placa) en dos filas, con solape: conflicto de categoría 'unidad'", () => {
    const filas = [
      filaFixture({ filaExcel: 4, pilotoCodigoExcel: "P-1", placaExcel: "AAA111", horaSalidaExcel: "08:00", horaRegresoExcel: "14:00" }),
      filaFixture({ filaExcel: 5, pilotoCodigoExcel: "P-2", placaExcel: "aaa111", horaSalidaExcel: "10:00", horaRegresoExcel: "16:00" }),
    ];
    const resultado = detectarTraslapesEnLote(filas);
    expect(resultado.some((r) => r.categoria === "unidad" && r.filaExcel === 4 && r.filaExcelConflicto === 5)).toBe(true);
  });

  it("piloto y unidad distintos, aunque los horarios se solapen: sin conflicto", () => {
    const filas = [
      filaFixture({ filaExcel: 4, pilotoCodigoExcel: "P-1", placaExcel: "AAA111", horaSalidaExcel: "08:00", horaRegresoExcel: "14:00" }),
      filaFixture({ filaExcel: 5, pilotoCodigoExcel: "P-2", placaExcel: "BBB222", horaSalidaExcel: "10:00", horaRegresoExcel: "16:00" }),
    ];
    expect(detectarTraslapesEnLote(filas)).toEqual([]);
  });

  it("fila sin regreso estimado (ninguna de las dos mitades): se excluye de la comparación, sin error", () => {
    const filas = [
      filaFixture({ filaExcel: 4, pilotoCodigoExcel: "P-1", fechaRegresoExcel: null, horaRegresoExcel: null }),
      filaFixture({ filaExcel: 5, pilotoCodigoExcel: "P-1", horaSalidaExcel: "09:00" }),
    ];
    expect(detectarTraslapesEnLote(filas)).toEqual([]);
  });

  it("fila sin fecha de salida válida: se excluye de la comparación, sin lanzar excepción", () => {
    const filas = [
      filaFixture({ filaExcel: 4, pilotoCodigoExcel: "P-1", fechaSalidaExcel: null }),
      filaFixture({ filaExcel: 5, pilotoCodigoExcel: "P-1" }),
    ];
    expect(() => detectarTraslapesEnLote(filas)).not.toThrow();
    expect(detectarTraslapesEnLote(filas)).toEqual([]);
  });

  it("3 filas: A-B conflictúan, B-C conflictúan, A-C no: se reportan exactamente los 2 pares (4 entradas)", () => {
    const filas = [
      filaFixture({ filaExcel: 4, pilotoCodigoExcel: "P-1", placaExcel: "AAA111", horaSalidaExcel: "08:00", horaRegresoExcel: "12:00" }), // A
      filaFixture({ filaExcel: 5, pilotoCodigoExcel: "P-1", placaExcel: "BBB222", horaSalidaExcel: "10:00", horaRegresoExcel: "15:00" }), // B (solapa con A)
      filaFixture({ filaExcel: 6, pilotoCodigoExcel: "P-1", placaExcel: "CCC333", horaSalidaExcel: "14:00", horaRegresoExcel: "18:00" }), // C (solapa con B, no con A)
    ];
    const resultado = detectarTraslapesEnLote(filas);
    const pares = resultado.map((r) => [r.filaExcel, r.filaExcelConflicto].sort((a, b) => a - b).join("-"));
    expect(new Set(pares)).toEqual(new Set(["4-5", "5-6"]));
    expect(resultado).toHaveLength(4);
  });
});

describe("previsualizarImportacionProgramacion", () => {
  beforeEach(() => vi.resetAllMocks());

  function rutaRow(overrides: Partial<{
    id: number; codigo: string; cliente_id: number; activo: number; tarifa_referencia: number | null;
    cliente_nombre: string; cliente_nit: string | null;
  }> = {}) {
    return {
      id: 10, codigo: "1001", cliente_id: 5, activo: 1, tarifa_referencia: 1500,
      cliente_nombre: "Acme S.A.", cliente_nit: "123456-7",
      ...overrides,
    };
  }

  function empleadoRow(overrides: Partial<{ id: number; codigo: string; nombre: string; estado: string }> = {}) {
    return { id: 20, codigo: "P-1", nombre: "Juan Pérez", estado: "Activo", ...overrides };
  }

  function vehiculo(overrides: Partial<VehiculoDisponibilidad> = {}): VehiculoDisponibilidad {
    return {
      id: 30, placa: "P-123ABC", marca: "Freightliner", modelo: "Cascadia", descripcion: null,
      activo: true, enTaller: false, compartido: false, esPropio: true,
      empresaDuenaNombre: null, empresaDuenaCodigo: null, kmActual: 0,
      estadoDisponibilidad: "disponible", puedeEnviar: true, viajeAbierto: null, motivoNoDisponible: null,
      ...overrides,
    };
  }

  /** Mock de @/lib/db.query — despacha por texto de SQL. Las consultas internas de primerConflictoTraslape ("FROM tms_personal tp" / "FROM tms_unidades u" con JOIN) devuelven [] (sin conflicto) salvo que se pasen explícitamente. */
  function mockDb(opts: {
    rutas?: unknown[]; empleados?: unknown[]; personal?: unknown[]; unidades?: unknown[];
    conflictoPersonal?: unknown[]; conflictoUnidad?: unknown[];
  } = {}) {
    vi.mocked(query).mockImplementation(async (sql: string) => {
      if (sql.includes("FROM tms_cliente_rutas r")) return (opts.rutas ?? [rutaRow()]) as never;
      if (sql.includes("FROM empleados WHERE empresa_id")) return (opts.empleados ?? [empleadoRow()]) as never;
      if (sql.includes("SELECT id, codigo, tipo FROM tms_personal")) return (opts.personal ?? []) as never;
      if (sql.includes("SELECT id, placa FROM tms_unidades")) return (opts.unidades ?? []) as never;
      if (sql.includes("FROM tms_personal tp")) return (opts.conflictoPersonal ?? []) as never;
      if (sql.includes("FROM tms_unidades u")) return (opts.conflictoUnidad ?? []) as never;
      return [] as never;
    });
  }

  function mockVehiculos(lista: VehiculoDisponibilidad[] = [vehiculo()]) {
    vi.mocked(listarDisponibilidadVehiculos).mockResolvedValue({
      vehiculos: lista,
      resumen: { total: lista.length, disponibles: lista.length, enTaller: 0, enRuta: 0, inactivos: 0, propios: lista.length, compartidos: 0 },
      empresaId: 7,
    });
  }

  it("fila totalmente válida (sin conflictos ni advertencias): estado ok, datos resueltos completos", async () => {
    mockDb();
    mockVehiculos();
    const resultado = await previsualizarImportacionProgramacion(7, [filaFixture()]);
    expect(resultado.resumen).toEqual({ totalFilas: 1, filasOk: 1, filasConError: 0 });
    expect(resultado.filas[0]).toMatchObject({
      filaExcel: 4,
      estado: "ok",
      errores: [],
      advertencias: [],
    });
    expect(resultado.filas[0].datos).toMatchObject({
      rutaId: 10,
      rutaCodigo: "1001",
      clienteId: 5,
      clienteNombre: "Acme S.A.",
      pilotoEmpleadoId: 20,
      pilotoNombre: "Juan Pérez",
      pilotoPersonalId: null, // nunca ha existido en tms_personal
      unidadPlaca: "P-123ABC",
      unidadId: null, // nunca ha existido en tms_unidades
      tarifaVigente: 1500,
      regresoEstimado: "2026-09-20T17:00",
    });
  });

  it("errores sintácticos del PR 2 (fila.erroresSintacticos): se integran tal cual, sin resolver catálogo", async () => {
    mockDb();
    mockVehiculos();
    const fila = filaFixture({ erroresSintacticos: ["Placa es obligatoria."] });
    const resultado = await previsualizarImportacionProgramacion(7, [fila]);
    expect(resultado.filas[0]).toEqual({
      filaExcel: 4, estado: "error", errores: ["Placa es obligatoria."], advertencias: [], datos: null,
    });
    // No debería haber consultado catálogo para esta fila -> solo las 4 consultas bulk iniciales.
    expect(query).toHaveBeenCalledTimes(4);
  });

  it("fila duplicada dentro del lote (PR 3): se integra como error, sin resolver catálogo", async () => {
    mockDb();
    mockVehiculos();
    const filas = [filaFixture({ filaExcel: 4 }), filaFixture({ filaExcel: 5 })];
    const resultado = await previsualizarImportacionProgramacion(7, filas);
    expect(resultado.filas[0].estado).toBe("error");
    expect(resultado.filas[0].errores[0]).toContain("duplicada");
    expect(resultado.filas[0].errores[0]).toContain("5");
  });

  it("traslape interno del lote (PR 3): se integra como error", async () => {
    mockDb();
    mockVehiculos();
    const filas = [
      filaFixture({ filaExcel: 4, placaExcel: "AAA111", horaSalidaExcel: "08:00", horaRegresoExcel: "14:00" }),
      filaFixture({ filaExcel: 5, placaExcel: "BBB222", horaSalidaExcel: "10:00", horaRegresoExcel: "16:00" }),
    ];
    const resultado = await previsualizarImportacionProgramacion(7, filas);
    expect(resultado.filas[0].estado).toBe("error");
    expect(resultado.filas[0].errores.some((e) => e.includes("Traslape con la fila 5"))).toBe(true);
  });

  it("ruta inexistente: error", async () => {
    mockDb({ rutas: [] });
    mockVehiculos();
    const resultado = await previsualizarImportacionProgramacion(7, [filaFixture({ codigoRutaExcel: "9999" })]);
    expect(resultado.filas[0].errores).toContain('La ruta "9999" no existe.');
  });

  it("ruta inactiva: error, y no se validan cliente/tarifa (dependen de una ruta activa)", async () => {
    mockDb({ rutas: [rutaRow({ activo: 0 })] });
    mockVehiculos();
    const resultado = await previsualizarImportacionProgramacion(7, [filaFixture()]);
    expect(resultado.filas[0].errores).toContain('La ruta "1001" está inactiva.');
  });

  it("cliente: NIT coincide -> sin error ni advertencia", async () => {
    mockDb({ rutas: [rutaRow({ cliente_nit: "123456-7" })] });
    mockVehiculos();
    const resultado = await previsualizarImportacionProgramacion(7, [filaFixture({ clienteExcel: "123456-7" })]);
    expect(resultado.filas[0].estado).toBe("ok");
    expect(resultado.filas[0].advertencias).toEqual([]);
  });

  it("cliente: NIT normalizado (espacios/guiones/mayúsculas) coincide -> sin error", async () => {
    mockDb({ rutas: [rutaRow({ cliente_nit: "123456-7" })] });
    mockVehiculos();
    const resultado = await previsualizarImportacionProgramacion(7, [filaFixture({ clienteExcel: " 1234567 " })]);
    expect(resultado.filas[0].estado).toBe("ok");
  });

  it("cliente: NIT NO coincide -> error bloqueante", async () => {
    mockDb({ rutas: [rutaRow({ cliente_nit: "123456-7" })] });
    mockVehiculos();
    const resultado = await previsualizarImportacionProgramacion(7, [filaFixture({ clienteExcel: "999999-9" })]);
    expect(resultado.filas[0].estado).toBe("error");
    expect(resultado.filas[0].errores.some((e) => e.includes("no coincide con el NIT"))).toBe(true);
  });

  it("cliente: ruta sin NIT registrado, nombre coincide -> ok CON advertencia informativa", async () => {
    mockDb({ rutas: [rutaRow({ cliente_nit: null, cliente_nombre: "Acme S.A." })] });
    mockVehiculos();
    const resultado = await previsualizarImportacionProgramacion(7, [filaFixture({ clienteExcel: "acme s.a." })]);
    expect(resultado.filas[0].estado).toBe("ok");
    expect(resultado.filas[0].advertencias).toContain(
      "Cliente validado por nombre porque el catálogo no tiene NIT registrado.",
    );
  });

  it("cliente: ruta sin NIT, nombre NO coincide -> error (no solo advertencia)", async () => {
    mockDb({ rutas: [rutaRow({ cliente_nit: null, cliente_nombre: "Acme S.A." })] });
    mockVehiculos();
    const resultado = await previsualizarImportacionProgramacion(7, [filaFixture({ clienteExcel: "Otra Empresa" })]);
    expect(resultado.filas[0].estado).toBe("error");
    expect(resultado.filas[0].errores.some((e) => e.includes("no coincide con el cliente de la ruta"))).toBe(true);
  });

  it("piloto inexistente: error", async () => {
    mockDb({ empleados: [] });
    mockVehiculos();
    const resultado = await previsualizarImportacionProgramacion(7, [filaFixture({ pilotoCodigoExcel: "P-9" })]);
    expect(resultado.filas[0].errores).toContain('El piloto con código "P-9" no existe.');
  });

  it("piloto inactivo: error", async () => {
    mockDb({ empleados: [empleadoRow({ estado: "Inactivo" })] });
    mockVehiculos();
    const resultado = await previsualizarImportacionProgramacion(7, [filaFixture()]);
    expect(resultado.filas[0].errores).toContain('El piloto con código "P-1" está inactivo.');
  });

  it("auxiliar inexistente: error", async () => {
    mockDb({ empleados: [empleadoRow()] });
    mockVehiculos();
    const resultado = await previsualizarImportacionProgramacion(7, [filaFixture({ auxiliar1CodigoExcel: "A-9" })]);
    expect(resultado.filas[0].errores).toContain('El auxiliar con código "A-9" no existe.');
  });

  it("auxiliar existente y activo: se resuelve correctamente en datos.auxiliares", async () => {
    mockDb({ empleados: [empleadoRow(), empleadoRow({ id: 21, codigo: "A-1", nombre: "María López" })] });
    mockVehiculos();
    const resultado = await previsualizarImportacionProgramacion(7, [filaFixture({ auxiliar1CodigoExcel: "A-1" })]);
    expect(resultado.filas[0].estado).toBe("ok");
    expect(resultado.filas[0].datos?.auxiliares).toEqual([{ empleadoId: 21, nombre: "María López", personalId: null }]);
  });

  it("piloto y auxiliar1 con el mismo código: error 'no pueden repetirse'", async () => {
    mockDb({ empleados: [empleadoRow()] });
    mockVehiculos();
    const resultado = await previsualizarImportacionProgramacion(7, [filaFixture({ auxiliar1CodigoExcel: "P-1" })]);
    expect(resultado.filas[0].errores).toContain("El piloto y los auxiliares no pueden repetirse entre sí en la misma fila.");
  });

  it("placa inexistente: error", async () => {
    mockDb();
    mockVehiculos([]);
    const resultado = await previsualizarImportacionProgramacion(7, [filaFixture()]);
    expect(resultado.filas[0].errores).toContain('La unidad con placa "P-123ABC" no existe en el sistema.');
  });

  it("placa existente pero no disponible: error con el motivo real", async () => {
    mockDb();
    mockVehiculos([vehiculo({ puedeEnviar: false, motivoNoDisponible: "En taller / servicio" })]);
    const resultado = await previsualizarImportacionProgramacion(7, [filaFixture()]);
    expect(resultado.filas[0].errores).toContain('La unidad con placa "P-123ABC" no está disponible: En taller / servicio.');
  });

  it("tarifa coincide exacto con la tarifa vigente de la ruta: sin error", async () => {
    mockDb({ rutas: [rutaRow({ tarifa_referencia: 1500 })] });
    mockVehiculos();
    const resultado = await previsualizarImportacionProgramacion(7, [filaFixture({ tarifaExcel: 1500 })]);
    expect(resultado.filas[0].estado).toBe("ok");
  });

  it("tarifa distinta a la vigente: error bloqueante con el formato exacto aprobado", async () => {
    mockDb({ rutas: [rutaRow({ tarifa_referencia: 1500 })] });
    mockVehiculos();
    const resultado = await previsualizarImportacionProgramacion(7, [filaFixture({ tarifaExcel: 1200 })]);
    expect(resultado.filas[0].errores).toContain("Tarifa Excel: Q1200 / Tarifa sistema: Q1500");
  });

  it("ruta sin tarifa vigente configurada: error", async () => {
    mockDb({ rutas: [rutaRow({ tarifa_referencia: null })] });
    mockVehiculos();
    const resultado = await previsualizarImportacionProgramacion(7, [filaFixture()]);
    expect(resultado.filas[0].errores).toContain('La ruta "1001" no tiene una tarifa vigente configurada en el sistema.');
  });

  it("piloto/unidad YA existentes en tms_personal/tms_unidades: se resuelven personalId/unidadId reales (sin crear nada)", async () => {
    mockDb({
      personal: [{ id: 900, codigo: "P-1", tipo: "Piloto" }],
      unidades: [{ id: 950, placa: "P-123ABC" }],
    });
    mockVehiculos();
    const resultado = await previsualizarImportacionProgramacion(7, [filaFixture()]);
    expect(resultado.filas[0].datos).toMatchObject({ pilotoPersonalId: 900, unidadId: 950 });
    // Solo lectura: ningún UPDATE/INSERT -> execute jamás importado/llamado por este módulo.
  });

  it("sin regreso estimado: no intenta validar traslape contra BD, fila válida igual", async () => {
    mockDb();
    mockVehiculos();
    const fila = filaFixture({ fechaRegresoExcel: null, horaRegresoExcel: null });
    const resultado = await previsualizarImportacionProgramacion(7, [fila]);
    expect(resultado.filas[0].estado).toBe("ok");
    expect(resultado.filas[0].datos?.regresoEstimado).toBeNull();
  });

  it("piloto/unidad sin registro existente en TMS: no se llama primerConflictoTraslape (no hay id real que comprobar)", async () => {
    mockDb({ personal: [], unidades: [] }); // nadie existe todavía
    mockVehiculos();
    const resultado = await previsualizarImportacionProgramacion(7, [filaFixture()]);
    expect(resultado.filas[0].estado).toBe("ok");
    // Ninguna llamada a query() coincide con las consultas internas de
    // primerConflictoTraslape (FROM tms_personal tp / FROM tms_unidades u con JOIN).
    const llamadasConflicto = vi.mocked(query).mock.calls.filter(
      ([sql]) => String(sql).includes("tms_planes_viaje"),
    );
    expect(llamadasConflicto).toHaveLength(0);
  });

  it("conflicto real de traslape contra BD (piloto ya asignado a otro viaje que se solapa): error con el mensaje de mensajeConflicto", async () => {
    mockDb({
      personal: [{ id: 900, codigo: "P-1", tipo: "Piloto" }],
      conflictoPersonal: [{
        recurso_nombre: "Juan Pérez", plan_id: 55, codigo: "PLAN-20260920-001", estado: "Programado",
        inicio: "2026-09-20 09:00:00", regreso_estimado: "2026-09-20 15:00:00", llegada_tecnica: null,
      }],
    });
    mockVehiculos();
    const resultado = await previsualizarImportacionProgramacion(7, [filaFixture()]);
    expect(resultado.filas[0].estado).toBe("error");
    expect(resultado.filas[0].errores.some((e) => e.includes("PLAN-20260920-001"))).toBe(true);
  });

  it("resumen: cuenta correctamente filas ok/con error en un lote mixto", async () => {
    mockDb();
    mockVehiculos();
    const filas = [
      filaFixture({ filaExcel: 4 }),
      // Piloto/placa distintos a la fila 4 a propósito: evita que ambas
      // filas también se marquen por traslape INTERNO del lote (PR 3,
      // mismo piloto+unidad+horario) — aquí solo se quiere aislar el
      // efecto de una ruta inexistente en el resumen.
      filaFixture({ filaExcel: 5, codigoRutaExcel: "9999", pilotoCodigoExcel: "P-2", placaExcel: "ZZZ999" }), // ruta inexistente -> error
    ];
    const resultado = await previsualizarImportacionProgramacion(7, filas);
    expect(resultado.resumen).toEqual({ totalFilas: 2, filasOk: 1, filasConError: 1 });
  });
});
