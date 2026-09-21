import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/operaciones/disponibilidad", () => ({ listarDisponibilidadVehiculos: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));

import { execute, getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { listarDisponibilidadVehiculos, type VehiculoDisponibilidad } from "@/lib/operaciones/disponibilidad";
import type { FilaProgramacionExcel } from "./programacion-import-excel";
import { emularConsultaConflictoPersonal, type ModeloPersonal } from "./personal-identidad.fixture";
import {
  claveDuplicadoFila,
  detectarFilasDuplicadas,
  detectarTraslapesEnLote,
  previsualizarImportacionProgramacion,
  confirmarImportacionProgramacion,
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

  it("fila sin regreso estimado (ninguna de las dos mitades): ya NO se excluye — es un viaje abierto y choca con la otra fila", () => {
    const filas = [
      filaFixture({ filaExcel: 4, pilotoCodigoExcel: "P-1", placaExcel: "AAA111", fechaRegresoExcel: null, horaRegresoExcel: null }),
      filaFixture({ filaExcel: 5, pilotoCodigoExcel: "P-1", placaExcel: "BBB222", horaSalidaExcel: "09:00" }),
    ];
    const resultado = detectarTraslapesEnLote(filas);
    expect(resultado).toHaveLength(2);
    expect(resultado[0]).toMatchObject({ filaExcel: 4, filaExcelConflicto: 5, categoria: "persona" });
    expect(resultado[1]).toMatchObject({ filaExcel: 5, filaExcelConflicto: 4, categoria: "persona", intervaloConflicto: { fin: null } });
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

// ---------------------------------------------------------------------
// Helpers compartidos entre previsualizarImportacionProgramacion y
// confirmarImportacionProgramacion (esta última reutiliza la primera
// internamente — mismos fixtures de catálogo para ambos describe blocks).
// ---------------------------------------------------------------------

function rutaRow(overrides: Partial<{
  id: number; codigo: string; cliente_id: number; activo: number; tarifa_referencia: number | null;
  cliente_nombre: string; cliente_nit: string | null;
  lugar_carga_texto: string | null; destino_descripcion: string | null;
  contacto_nombre: string | null; contacto_cargo: string | null; contacto_telefono: string | null;
}> = {}) {
  return {
    id: 10, codigo: "1001", cliente_id: 5, activo: 1, tarifa_referencia: 1500,
    cliente_nombre: "Acme S.A.", cliente_nit: "123456-7",
    lugar_carga_texto: "Bodega Zona 12", destino_descripcion: "Sucursal Zona 4",
    contacto_nombre: "Ana Gómez", contacto_cargo: "Logística", contacto_telefono: "5555-1234",
    ...overrides,
  };
}

function empleadoRow(overrides: Partial<{ id: number; codigo: string; nombre: string; estado: string }> = {}) {
  return { id: 20, codigo: "P-1", nombre: "Juan Pérez", estado: "Activo", ...overrides };
}

function tarifaRow(overrides: Partial<{
  ruta_id: number; id: number; nombre: string; monto: number; moneda: string; predeterminada: number;
}> = {}) {
  return { ruta_id: 10, id: 100, nombre: "Estándar", monto: 1500, moneda: "GTQ", predeterminada: 1, ...overrides };
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

type EmpleadoMock = { id: number; codigo: string; nombre: string; estado: string };
type PersonalMock = { id: number; codigo: string; tipo: string; id_empleado?: number | null };
type LugarMock = { id: number; nombre: string };

/**
 * Estado compartido de "base de datos" en memoria — mismo objeto lo leen
 * y escriben TANTO el mock de @/lib/db.query/execute (pool global, usado
 * por previsualizarImportacionProgramacion, siempre de solo lectura) COMO
 * el mock de `conn.query`/`conn.execute` (usado por
 * confirmarImportacionProgramacion desde el ajuste post-revisión PR #272:
 * personalDesdeEmpleado/upsertLugar/el upsert de tms_unidades ahora
 * reciben `conn`). Que sea el MISMO objeto es lo que hace posible probar
 * correctamente "personal/lugar recién creado dentro de la transacción":
 * lo que preview lee (antes de la transacción) es el estado inicial: lo
 * que confirmar._crea_ vía `conn` se refleja en este mismo estado.
 */
type EstadoMock = {
  rutas: unknown[];
  empleados: EmpleadoMock[];
  personal: PersonalMock[];
  unidades: unknown[];
  conflictoPersonal: unknown[];
  conflictoUnidad: unknown[];
  tarifas: unknown[];
  lugares: LugarMock[];
};

function crearEstadoMock(opts: Partial<{
  rutas: unknown[]; empleados: EmpleadoMock[]; personal: PersonalMock[]; unidades: unknown[];
  conflictoPersonal: unknown[]; conflictoUnidad: unknown[]; tarifas: unknown[];
}> = {}): EstadoMock {
  return {
    rutas: opts.rutas ?? [rutaRow()],
    empleados: opts.empleados ?? [empleadoRow()],
    personal: opts.personal ? [...opts.personal] : [],
    unidades: opts.unidades ?? [],
    conflictoPersonal: opts.conflictoPersonal ?? [],
    conflictoUnidad: opts.conflictoUnidad ?? [],
    tarifas: opts.tarifas ?? [tarifaRow()],
    lugares: [],
  };
}

/** Despacha una lectura (SELECT) contra el estado compartido — usado tanto por el mock de `query` (pool global) como por el de `conn.query`. */
function dispatchQuery(estado: EstadoMock, sql: string, params: unknown[]): unknown[] {
  const p = params;
  // personalDesdeEmpleado: 1) empleado por id exacto.
  if (sql.includes("WHERE id = ? AND empresa_id = ? AND estado = 'Activo'")) {
    const emp = estado.empleados.find((e) => e.id === Number(p[0]));
    return emp ? [emp] : [];
  }
  // personalDesdeEmpleado: 2) tms_personal existente por codigo+tipo exacto.
  if (sql.includes("FROM tms_personal") && sql.includes("codigo = ? AND tipo = ?")) {
    const [, codigo, tipo] = p as [number, string, string];
    const match = estado.personal.find((r) => r.codigo === codigo && r.tipo === tipo);
    return match ? [{ id: match.id }] : [];
  }
  // upsertLugar: lugar existente por nombre exacto.
  if (sql.includes("FROM tms_lugares")) {
    const [, nombre] = p as [number, string];
    const match = estado.lugares.find((l) => l.nombre === nombre);
    return match ? [{ id: match.id }] : [];
  }
  if (sql.includes("FROM tms_cliente_rutas r")) return estado.rutas;
  if (sql.includes("FROM empleados WHERE empresa_id")) return estado.empleados;
  if (sql.includes("FROM tms_personal WHERE empresa_id = ? AND (codigo IS NOT NULL OR id_empleado IS NOT NULL)")) return estado.personal;
  if (sql.includes("SELECT id, placa FROM tms_unidades")) return estado.unidades;
  if (sql.includes("FROM tms_personal tp")) return estado.conflictoPersonal;
  if (sql.includes("FROM tms_unidades u")) return estado.conflictoUnidad;
  if (sql.includes("FROM tms_ruta_tarifas")) return estado.tarifas;
  // asegurarCodigoPlanUnico / generarCodigoPlan: sin códigos previos -> genera PLAN-<fecha>-001.
  if (sql.includes("FROM tms_planes_viaje")) return [];
  return [];
}

let secuenciaIdMock = 9000;

/** Despacha una escritura (INSERT/UPDATE) contra el estado compartido — usado tanto por el mock de `execute` (pool global, ya sin uso real desde el ajuste PR #272 salvo por defensividad) como por el de `conn.execute`. Los INSERT que crean personal/lugares MUTAN `estado` para que una lectura posterior (misma fila u otra del lote) ya los vea, igual que vería sus propias escrituras una transacción real. */
function dispatchExecute(estado: EstadoMock, sql: string, params: unknown[]): { insertId: number; affectedRows: number } {
  const p = params;
  if (sql.includes("INSERT INTO tms_personal")) {
    const [, codigo, , tipo] = p as [number, string, string, string];
    const id = ++secuenciaIdMock;
    estado.personal.push({ id, codigo, tipo });
    return { insertId: id, affectedRows: 1 };
  }
  if (sql.includes("UPDATE tms_personal")) {
    return { insertId: 0, affectedRows: 1 };
  }
  if (sql.includes("INSERT INTO tms_lugares")) {
    const [, nombre] = p as [number, string];
    const id = ++secuenciaIdMock;
    estado.lugares.push({ id, nombre });
    return { insertId: id, affectedRows: 1 };
  }
  return { insertId: ++secuenciaIdMock, affectedRows: 1 };
}

/**
 * Mock de @/lib/db.query/execute (pool global) — despacha contra un
 * estado en memoria (ver `EstadoMock`). Cubre las consultas bulk de
 * previsualizarImportacionProgramacion Y las de personalDesdeEmpleado/
 * upsertLugar cuando se llaman SIN `conn` (nunca ocurre ya dentro de
 * confirmarImportacionProgramacion tras el ajuste PR #272, pero sigue
 * aplicando para cualquier otro llamador futuro). Las consultas internas
 * de primerConflictoTraslape ("FROM tms_personal tp" / "FROM
 * tms_unidades u" con JOIN) devuelven [] (sin conflicto) salvo que se
 * pasen explícitamente. Devuelve el `estado` para que el caller pueda
 * compartirlo con `makeConnMock`/`mockGetPool` cuando haga falta.
 */
function mockDb(opts: Parameters<typeof crearEstadoMock>[0] = {}): EstadoMock {
  const estado = crearEstadoMock(opts);
  vi.mocked(query).mockImplementation(async (sql: string, params?: unknown) =>
    dispatchQuery(estado, sql, (params ?? []) as unknown[]) as never,
  );
  vi.mocked(execute).mockImplementation(async (sql: string, params?: unknown) =>
    dispatchExecute(estado, sql, (params ?? []) as unknown[]) as never,
  );
  return estado;
}

function mockVehiculos(lista: VehiculoDisponibilidad[] = [vehiculo()]) {
  vi.mocked(listarDisponibilidadVehiculos).mockResolvedValue({
    vehiculos: lista,
    resumen: { total: lista.length, disponibles: lista.length, enTaller: 0, enRuta: 0, inactivos: 0, propios: lista.length, compartidos: 0 },
    empresaId: 7,
  });
}

/**
 * Conexión de transacción mock — usada por `conn.execute()`/`conn.query()`
 * dentro de confirmarImportacionProgramacion (personalDesdeEmpleado/
 * upsertLugar/el upsert de tms_unidades, el INSERT de tms_planes_viaje, y
 * guardarAuxiliaresPlan/guardarParadasPlan/sincronizarViaticosPlan, TODAS
 * llamadas con `conn` desde el ajuste post-revisión PR #272). Opera sobre
 * el MISMO `estado` que ya usa `mockDb` (pásalo explícitamente cuando el
 * test necesite que preview y confirmar vean exactamente los mismos
 * datos — el caso normal), o uno nuevo por defecto si no hace falta esa
 * consistencia (tests de candado/rollback que nunca llegan a depender de
 * personal/lugares reales).
 */
function makeConnMock(opts: { estado?: EstadoMock; insertIdsPlan?: number[] } = {}) {
  const estado = opts.estado ?? crearEstadoMock();
  const insertIdsPlan = opts.insertIdsPlan ? [...opts.insertIdsPlan] : null;
  let siguienteIdPlan = 8000;
  const conn = {
    beginTransaction: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
    release: vi.fn(() => undefined),
    query: vi.fn<(sql: string, params?: unknown[]) => Promise<unknown>>(async (sql, params) => [
      dispatchQuery(estado, sql, params ?? []),
      [],
    ]),
    execute: vi.fn<(sql: string, params?: unknown[]) => Promise<unknown>>(async (sql, params) => {
      if (sql.includes("INSERT INTO tms_planes_viaje")) {
        const insertId = insertIdsPlan?.length ? insertIdsPlan.shift()! : siguienteIdPlan++;
        return [{ insertId, affectedRows: 1 }, []];
      }
      return [dispatchExecute(estado, sql, params ?? []), []];
    }),
  };
  return conn;
}

/** Mock de getPool().getConnection() — primera llamada = candado (lockConn, solo .query), segunda = transacción (conn, execute+query+tx). Mismo orden que confirmarImportacionProgramacion. Sin `opts.conn`, construye uno nuevo compartiendo `opts.estado` (o uno propio si tampoco se pasa). */
function mockGetPool(opts: { lockValor?: number; estado?: EstadoMock; conn?: ReturnType<typeof makeConnMock> } = {}) {
  const lockConn = {
    query: vi.fn(async () => [[{ l: opts.lockValor ?? 1 }], []] as unknown),
    release: vi.fn(() => undefined),
  };
  const conn = opts.conn ?? makeConnMock({ estado: opts.estado });
  const getConnection = vi.fn().mockResolvedValueOnce(lockConn).mockResolvedValueOnce(conn);
  vi.mocked(getPool).mockReturnValue({ getConnection } as never);
  return { lockConn, conn };
}

describe("previsualizarImportacionProgramacion", () => {
  beforeEach(() => vi.resetAllMocks());

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

  it("sin regreso estimado y sin conflicto: fila válida, regresoEstimado null (nada inventado)", async () => {
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

describe("confirmarImportacionProgramacion", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockDb();
    mockVehiculos();
  });

  it("lote exitoso: crea el/los plan(es) dentro de una transacción, sin trabas", async () => {
    const { lockConn, conn } = mockGetPool();
    const resultado = await confirmarImportacionProgramacion(7, "admin", "programacion.xlsx", "sha256:abc", [filaFixture()]);

    expect(resultado).toMatchObject({ resultado: "exitoso", filasTotales: 1, filasImportadas: 1 });
    expect(resultado.resultado === "exitoso" && resultado.planIds).toHaveLength(1);

    expect(conn.beginTransaction).toHaveBeenCalledOnce();
    expect(conn.commit).toHaveBeenCalledOnce();
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledOnce();

    // Ajuste post-revisión PR #272: TODA escritura (materialización de
    // personal/unidad/lugares incluida) pasa por `conn` -- el pool
    // global (`execute`) nunca debe recibir un INSERT/UPDATE de esta
    // confirmación.
    expect(execute).not.toHaveBeenCalled();

    const insertPlan = vi.mocked(conn.execute).mock.calls.find(([sql]) => String(sql).includes("INSERT INTO tms_planes_viaje"));
    expect(insertPlan).toBeDefined();
    const params = insertPlan![1] as unknown[];
    expect(params[0]).toBe(7); // empresa_id
    expect(params[2]).toBe(5); // cliente_id (de la ruta, nunca del Excel)
    expect(String(params[1])).toMatch(/^PLAN-/); // código generado por el sistema

    // Candado: adquirido y liberado.
    expect(lockConn.query).toHaveBeenCalledWith("SELECT GET_LOCK(?, ?) AS l", ["tms_traslape_7", 8]);
    expect(lockConn.query).toHaveBeenCalledWith("SELECT RELEASE_LOCK(?) AS l", ["tms_traslape_7"]);
    expect(lockConn.release).toHaveBeenCalledOnce();
  });

  it("error en una fila: no se importa ninguna (todo o nada) y nunca se abre transacción", async () => {
    const { conn } = mockGetPool();
    const filas = [
      filaFixture({ filaExcel: 4 }),
      // ruta inexistente en esta empresa -> falla la revalidación.
      filaFixture({ filaExcel: 5, codigoRutaExcel: "9999", pilotoCodigoExcel: "P-2", placaExcel: "ZZZ999" }),
    ];
    const resultado = await confirmarImportacionProgramacion(7, "admin", "programacion.xlsx", "sha256:abc", filas);

    expect(resultado.resultado).toBe("error");
    expect(resultado.resultado === "error" && resultado.erroresPorFila?.some((f) => f.filaExcel === 5)).toBe(true);
    expect(conn.beginTransaction).not.toHaveBeenCalled();
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
  });

  it("rollback ante fallo durante una escritura posterior (segunda fila): ningún plan queda creado", async () => {
    // El fallo se simula en una escritura POSTERIOR al INSERT del plan
    // (sincronizarViaticosPlan, llamada después de crear cada plan) — no
    // en el propio INSERT de tms_planes_viaje, porque ese sí tiene un
    // bucle de reintento ante colisión de código y "absorbería" un fallo
    // aislado reintentando con otro código en vez de propagarlo.
    const estado = mockDb({ empleados: [empleadoRow(), empleadoRow({ id: 21, codigo: "P-2" })] });
    mockVehiculos([vehiculo({ placa: "AAA111" }), vehiculo({ id: 31, placa: "BBB222" })]);
    const conn = makeConnMock({ estado });
    let intentosPlan = 0;
    let intentosViatico = 0;
    vi.mocked(conn.execute).mockImplementation(async (sql: string, params?: unknown[]) => {
      if (String(sql).includes("INSERT INTO tms_planes_viaje")) {
        intentosPlan += 1;
        return [{ insertId: 7000 + intentosPlan, affectedRows: 1 }, []] as unknown;
      }
      if (String(sql).includes("INSERT INTO tms_viaticos")) {
        intentosViatico += 1;
        if (intentosViatico === 2) throw new Error("fallo de BD simulado en la segunda fila");
        return [{ insertId: 1, affectedRows: 1 }, []] as unknown;
      }
      return [dispatchExecute(estado, sql, params ?? []), []] as unknown;
    });
    mockGetPool({ conn });

    const filas = [
      filaFixture({ filaExcel: 4, codigoRutaExcel: "1001", pilotoCodigoExcel: "P-1", placaExcel: "AAA111" }),
      filaFixture({ filaExcel: 5, codigoRutaExcel: "1001", pilotoCodigoExcel: "P-2", placaExcel: "BBB222" }),
    ];
    const resultado = await confirmarImportacionProgramacion(7, "admin", "programacion.xlsx", "sha256:abc", filas);

    expect(resultado.resultado).toBe("error");
    expect(conn.beginTransaction).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.release).toHaveBeenCalledOnce();
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();

    // La prueba central del ajuste post-revisión PR #272: la
    // materialización del piloto/unidad de la PRIMERA fila (que sí llegó
    // a insertarse antes del fallo en la segunda) pasó por `conn` — así
    // que el rollback de la transacción también la revierte. Si en
    // cambio hubiera usado el pool global (`execute`), esa escritura NO
    // se habría revertido pese al rollback, violando el todo-o-nada real.
    expect(execute).not.toHaveBeenCalled();
    const llamadasConn = vi.mocked(conn.execute).mock.calls.map(([sql]) => String(sql));
    expect(llamadasConn.some((sql) => sql.includes("INSERT INTO tms_personal"))).toBe(true);
    expect(llamadasConn.some((sql) => sql.includes("INSERT INTO tms_unidades"))).toBe(true);
  });

  it("fallo al adquirir el candado (GET_LOCK != 1): aborta sin escribir nada, nunca abre transacción", async () => {
    const { lockConn, conn } = mockGetPool({ lockValor: 0 });
    const resultado = await confirmarImportacionProgramacion(7, "admin", "programacion.xlsx", "sha256:abc", [filaFixture()]);

    expect(resultado).toMatchObject({ resultado: "error" });
    expect(resultado.resultado === "error" && resultado.mensaje).toContain("otra operación en curso");
    expect(conn.beginTransaction).not.toHaveBeenCalled();
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
    // Nunca se llamó RELEASE_LOCK -- el candado nunca se adquirió de verdad.
    expect(lockConn.query).toHaveBeenCalledTimes(1);
    expect(lockConn.release).toHaveBeenCalledOnce();
  });

  it("conflicto aparecido ENTRE un preview anterior y esta confirmación: la revalidación fresca lo detecta y aborta", async () => {
    // "Preview" que el usuario vio antes (todo limpio en ese momento).
    const previewAnterior = await previsualizarImportacionProgramacion(7, [filaFixture()]);
    expect(previewAnterior.resumen.filasConError).toBe(0);

    // Entre ese preview y la confirmación, alguien más ocupó al piloto en
    // un viaje que se solapa (conflicto real contra BD) -- confirmar debe
    // detectarlo de NUEVO por sí mismo, nunca confiar en `previewAnterior`.
    mockDb({
      personal: [{ id: 900, codigo: "P-1", tipo: "Piloto" }],
      conflictoPersonal: [{
        recurso_nombre: "Juan Pérez", plan_id: 55, codigo: "PLAN-20260920-001", estado: "Programado",
        inicio: "2026-09-20 09:00:00", regreso_estimado: "2026-09-20 15:00:00", llegada_tecnica: null,
      }],
    });
    const { conn } = mockGetPool();
    const resultado = await confirmarImportacionProgramacion(7, "admin", "programacion.xlsx", "sha256:abc", [filaFixture()]);

    expect(resultado.resultado).toBe("error");
    expect(conn.beginTransaction).not.toHaveBeenCalled();
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
  });

  it("piloto/unidad sin registro previo: se materializan (crean) tms_personal/tms_unidades DENTRO de la transacción (conn), nunca antes ni fuera de ella", async () => {
    const estado = mockDb(); // personal/unidades ya vacíos por defecto -- nadie existe todavía
    const { conn } = mockGetPool({ estado });
    const resultado = await confirmarImportacionProgramacion(7, "admin", "programacion.xlsx", "sha256:abc", [filaFixture()]);

    expect(resultado.resultado).toBe("exitoso");
    // Ajuste post-revisión PR #272: la materialización va por `conn`, NUNCA
    // por el pool global -- si algo se coló por ahí, sería la prueba de
    // que quedaría fuera de la transacción/rollback del lote.
    expect(execute).not.toHaveBeenCalled();
    const llamadas = vi.mocked(conn.execute).mock.calls.map(([sql]) => String(sql));
    expect(llamadas.some((sql) => sql.includes("INSERT INTO tms_personal"))).toBe(true);
    expect(llamadas.some((sql) => sql.includes("INSERT INTO tms_unidades"))).toBe(true);
  });

  it("piloto/unidad YA existentes: NO se vuelve a crear tms_personal (personalDesdeEmpleado solo actualiza), todo vía conn", async () => {
    const estado = mockDb({ personal: [{ id: 900, codigo: "P-1", tipo: "Piloto" }] });
    const { conn } = mockGetPool({ estado });
    const resultado = await confirmarImportacionProgramacion(7, "admin", "programacion.xlsx", "sha256:abc", [filaFixture()]);

    expect(resultado.resultado).toBe("exitoso");
    expect(execute).not.toHaveBeenCalled();
    const llamadas = vi.mocked(conn.execute).mock.calls.map(([sql]) => String(sql));
    expect(llamadas.some((sql) => sql.includes("INSERT INTO tms_personal"))).toBe(false);
    expect(llamadas.some((sql) => sql.includes("UPDATE tms_personal"))).toBe(true);
  });

  it("auditoría: UNA sola por lote (no una por fila), DENTRO de la misma transacción (conn), con empresa/usuario/archivo/hash/filas/resultado/planIds", async () => {
    const filas = [
      filaFixture({ filaExcel: 4, codigoRutaExcel: "1001", pilotoCodigoExcel: "P-1", placaExcel: "AAA111" }),
      filaFixture({ filaExcel: 5, codigoRutaExcel: "1001", pilotoCodigoExcel: "P-2", placaExcel: "BBB222" }),
      filaFixture({ filaExcel: 6, codigoRutaExcel: "1001", pilotoCodigoExcel: "P-3", placaExcel: "CCC333" }),
    ];
    const estado = mockDb({ empleados: [empleadoRow(), empleadoRow({ id: 21, codigo: "P-2" }), empleadoRow({ id: 22, codigo: "P-3" })] });
    mockVehiculos([
      vehiculo({ placa: "AAA111" }),
      vehiculo({ id: 31, placa: "BBB222" }),
      vehiculo({ id: 32, placa: "CCC333" }),
    ]);
    const { conn } = mockGetPool({ estado });
    const resultado = await confirmarImportacionProgramacion(7, "admin", "programacion-septiembre.xlsx", "sha256:deadbeef", filas);

    expect(resultado.resultado).toBe("exitoso");
    expect(registrarAuditoriaTx).toHaveBeenCalledOnce();
    // registrarAuditoriaTx(conn, input) -- se llama con la MISMA conexión
    // de la transacción, para que un fallo en la auditoría también haga
    // rollback de todo el lote.
    const [connUsado, llamada] = vi.mocked(registrarAuditoriaTx).mock.calls[0];
    expect(connUsado).toBe(conn);
    expect(llamada.empresaId).toBe(7);
    expect(llamada.usuario).toBe("admin");
    expect(llamada.accion).toBe("importar_programacion");
    const detalle = JSON.parse(llamada.detalle as string);
    expect(detalle).toMatchObject({
      archivo: "programacion-septiembre.xlsx",
      hashArchivo: "sha256:deadbeef",
      filasTotales: 3,
      filasImportadas: 3,
      resultado: "exitoso",
    });
    expect(detalle.planIds).toHaveLength(3);
    // La auditoría se llamó ANTES del commit (todavía dentro de la
    // transacción) -- si commit ya se hubiera llamado antes, el orden de
    // las dos invocaciones lo delataría.
    const ordenAuditoria = vi.mocked(registrarAuditoriaTx).mock.invocationCallOrder[0];
    const ordenCommit = vi.mocked(conn.commit).mock.invocationCallOrder[0];
    expect(ordenAuditoria).toBeLessThan(ordenCommit);
  });

  it("libera el candado (lockConn.release) incluso cuando la revalidación falla", async () => {
    const { lockConn } = mockGetPool();
    const filas = [filaFixture({ codigoRutaExcel: "9999" })]; // ruta inexistente
    await confirmarImportacionProgramacion(7, "admin", "programacion.xlsx", "sha256:abc", filas);
    expect(lockConn.release).toHaveBeenCalledOnce();
  });

  it("libera el candado (lockConn.release) incluso cuando la transacción falla y hace rollback", async () => {
    const conn = makeConnMock();
    vi.mocked(conn.execute).mockImplementation(async (sql: string) => {
      if (String(sql).includes("INSERT INTO tms_planes_viaje")) throw new Error("fallo inesperado de BD");
      return [{ insertId: 1, affectedRows: 1 }, []] as unknown;
    });
    const { lockConn } = mockGetPool({ conn });
    await confirmarImportacionProgramacion(7, "admin", "programacion.xlsx", "sha256:abc", [filaFixture()]);
    expect(lockConn.release).toHaveBeenCalledOnce();
    expect(conn.release).toHaveBeenCalledOnce();
  });

  it("archivo sin filas: rechaza de inmediato, sin tocar el candado ni BD", async () => {
    const resultado = await confirmarImportacionProgramacion(7, "admin", "programacion.xlsx", "sha256:abc", []);
    expect(resultado).toEqual({ resultado: "error", mensaje: "No hay filas para importar." });
    expect(getPool).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------
// REGRESO ESTIMADO OPCIONAL — el importador aplica LA MISMA regla de
// disponibilidad que POST/PATCH /tms/planes: una fila sin regreso estimado
// es un viaje ABIERTO ([salida, sin límite)) y se valida contra la BD y
// contra las otras filas del lote con primerConflictoTraslape / los mismos
// helpers de ocupación (no hay una segunda implementación).
// ---------------------------------------------------------------------
const SIN_REGRESO = { fechaRegresoExcel: null, horaRegresoExcel: null } as const;
const FLOTA = [vehiculo(), vehiculo({ id: 31, placa: "AAA111" }), vehiculo({ id: 32, placa: "BBB222" }), vehiculo({ id: 33, placa: "CCC333" })];

/** Fila existente en BD, con los campos que devuelve la consulta de conflictos de primerConflictoTraslape. */
const candidato = (over: Record<string, unknown> = {}) => ({
  recurso_nombre: "Juan Pérez", plan_id: 55, codigo: "PLAN-20260920-001", estado: "Programado",
  inicio: "2026-09-20 09:00:00", regreso_estimado: "2026-09-20 15:00:00", llegada_tecnica: 0, hora_llegada: null, cerrado_en: null,
  ...over,
});

/** Igual que mockDb, pero el conflicto depende del recurso consultado (id de tms_personal / de tms_unidades). */
function mockDbConflictosPorRecurso(estado: EstadoMock, porPersonalId: Record<number, unknown[]> = {}, porUnidadId: Record<number, unknown[]> = {}) {
  vi.mocked(query).mockImplementation((async (sql: string, params?: unknown) => {
    const p = (params ?? []) as unknown[];
    if (sql.includes("FROM tms_personal tp")) return porPersonalId[Number(p[0])] ?? [];
    if (sql.includes("FROM tms_unidades u")) return porUnidadId[Number(p[0])] ?? [];
    return dispatchQuery(estado, sql, p);
  }) as never);
}

const consultasConflicto = () =>
  vi.mocked(query).mock.calls.filter(([sql]) => String(sql).includes("FROM tms_personal tp") || String(sql).includes("FROM tms_unidades u"));

describe("detectarTraslapesEnLote — filas sin regreso estimado (viaje abierto)", () => {
  it("una fila abierta choca con una fila POSTERIOR del mismo piloto aunque sea de otro día (sin límite superior)", () => {
    const filas = [
      filaFixture({ filaExcel: 4, pilotoCodigoExcel: "P-1", placaExcel: "AAA111", ...SIN_REGRESO }),
      filaFixture({ filaExcel: 5, pilotoCodigoExcel: "P-1", placaExcel: "BBB222", fechaSalidaExcel: "2026-09-25", fechaRegresoExcel: "2026-09-25", horaRegresoExcel: "17:00" }),
    ];
    expect(detectarTraslapesEnLote(filas).map((c) => [c.filaExcel, c.filaExcelConflicto])).toEqual([[4, 5], [5, 4]]);
  });

  it("una fila con regreso que TERMINA antes de que salga la fila abierta no choca", () => {
    const filas = [
      filaFixture({ filaExcel: 4, pilotoCodigoExcel: "P-1", placaExcel: "AAA111", horaSalidaExcel: "06:00", horaRegresoExcel: "07:59" }),
      filaFixture({ filaExcel: 5, pilotoCodigoExcel: "P-1", placaExcel: "BBB222", horaSalidaExcel: "08:00", ...SIN_REGRESO }),
    ];
    expect(detectarTraslapesEnLote(filas)).toEqual([]);
  });

  it("dos filas abiertas del mismo piloto chocan siempre", () => {
    const filas = [
      filaFixture({ filaExcel: 4, pilotoCodigoExcel: "P-1", placaExcel: "AAA111", ...SIN_REGRESO }),
      filaFixture({ filaExcel: 5, pilotoCodigoExcel: "P-1", placaExcel: "BBB222", fechaSalidaExcel: "2026-10-30", ...SIN_REGRESO }),
    ];
    expect(detectarTraslapesEnLote(filas)).toHaveLength(2);
  });

  it("auxiliar y unidad: misma regla que el piloto", () => {
    const aux = detectarTraslapesEnLote([
      filaFixture({ filaExcel: 4, pilotoCodigoExcel: "P-1", auxiliar1CodigoExcel: "A-1", placaExcel: "AAA111", ...SIN_REGRESO }),
      filaFixture({ filaExcel: 5, pilotoCodigoExcel: "P-2", auxiliar2CodigoExcel: "A-1", placaExcel: "BBB222" }),
    ]);
    expect(aux.some((c) => c.filaExcel === 5 && c.rolEnFila === "auxiliar" && c.rolEnFilaConflicto === "auxiliar")).toBe(true);
    const unidad = detectarTraslapesEnLote([
      filaFixture({ filaExcel: 4, pilotoCodigoExcel: "P-1", placaExcel: "AAA111", ...SIN_REGRESO }),
      filaFixture({ filaExcel: 5, pilotoCodigoExcel: "P-2", placaExcel: "aaa111" }),
    ]);
    expect(unidad.some((c) => c.categoria === "unidad" && c.filaExcel === 5 && c.filaExcelConflicto === 4)).toBe(true);
  });

  it("piloto y unidad distintos: sin conflicto aunque una fila esté abierta", () => {
    const filas = [
      filaFixture({ filaExcel: 4, pilotoCodigoExcel: "P-1", placaExcel: "AAA111", ...SIN_REGRESO }),
      filaFixture({ filaExcel: 5, pilotoCodigoExcel: "P-2", placaExcel: "BBB222" }),
    ];
    expect(detectarTraslapesEnLote(filas)).toEqual([]);
  });

  it("regreso a medias (fecha sin hora): la fila no se compara (ya sale con su propio error de regreso incompleto)", () => {
    const filas = [
      filaFixture({ filaExcel: 4, pilotoCodigoExcel: "P-1", placaExcel: "AAA111", fechaRegresoExcel: "2026-09-20", horaRegresoExcel: null }),
      filaFixture({ filaExcel: 5, pilotoCodigoExcel: "P-1", placaExcel: "BBB222" }),
    ];
    expect(detectarTraslapesEnLote(filas)).toEqual([]);
  });
});

describe("previsualizarImportacionProgramacion — traslapes con y sin regreso estimado", () => {
  beforeEach(() => vi.resetAllMocks());
  const personalPiloto = { id: 900, codigo: "P-1", tipo: "Piloto" };

  it("CON regreso estimado y sin conflicto: ok; se valida el intervalo [salida, regreso]", async () => {
    mockDb({ personal: [personalPiloto] });
    mockVehiculos();
    const r = await previsualizarImportacionProgramacion(7, [filaFixture()]);
    expect(r.filas[0].estado).toBe("ok");
    const [sql, params] = consultasConflicto()[0] as [string, unknown[]];
    expect(params).toContain("2026-09-20 08:00:00");
    expect(params).toContain("2026-09-20 17:00:00");
    expect(String(sql)).toContain("TIMESTAMP(p.fecha_plan, COALESCE(p.hora_carga, '00:00:00')) < ?");
  });

  it("SIN regreso estimado y sin conflicto: ok, y SÍ se valida contra la BD con intervalo abierto (sin fin, nada inventado)", async () => {
    mockDb({ personal: [personalPiloto] });
    mockVehiculos();
    const r = await previsualizarImportacionProgramacion(7, [filaFixture(SIN_REGRESO)]);
    expect(r.filas[0].estado).toBe("ok");
    expect(r.filas[0].datos?.regresoEstimado).toBeNull();
    expect(consultasConflicto()).toHaveLength(1);
    const [sql, params] = consultasConflicto()[0] as [string, unknown[]];
    expect(String(sql)).toContain("1 = 1");
    expect(params).toContain("2026-09-20 08:00:00");
    expect(params).not.toContain("2026-09-20 17:00:00");
    expect(params.filter((x) => typeof x === "string" && /^2026-09-20 (1[0-9]|2[0-3])/.test(x))).toEqual([]);
  });

  it("SIN regreso que choca con un viaje existente del PILOTO: error claro (recurso, viaje y estado/intervalo)", async () => {
    mockDb({ personal: [personalPiloto], conflictoPersonal: [candidato({ regreso_estimado: null })] });
    mockVehiculos();
    const r = await previsualizarImportacionProgramacion(7, [filaFixture(SIN_REGRESO)]);
    expect(r.filas[0].estado).toBe("error");
    expect(r.filas[0].errores).toEqual(["El piloto Juan Pérez sigue asignado al viaje PLAN-20260920-001, que aún no registra llegada."]);
  });

  it("SIN regreso que choca con un viaje existente CON intervalo: el mensaje muestra el rango", async () => {
    mockDb({ personal: [personalPiloto], conflictoPersonal: [candidato()] });
    mockVehiculos();
    const r = await previsualizarImportacionProgramacion(7, [filaFixture(SIN_REGRESO)]);
    expect(r.filas[0].errores).toEqual(["El piloto Juan Pérez ya está asignado al viaje PLAN-20260920-001 de 09:00 a 15:00."]);
  });

  it("SIN regreso que choca con un viaje existente del AUXILIAR: solo ese recurso genera el conflicto", async () => {
    const estado = crearEstadoMock({
      empleados: [empleadoRow(), empleadoRow({ id: 21, codigo: "A-1", nombre: "Auxiliar Uno" })],
      personal: [personalPiloto, { id: 901, codigo: "A-1", tipo: "Auxiliar" }],
    });
    mockDbConflictosPorRecurso(estado, { 901: [candidato({ recurso_nombre: "Auxiliar Uno", codigo: "PLAN-AUX-7", regreso_estimado: null })] });
    mockVehiculos();
    const r = await previsualizarImportacionProgramacion(7, [filaFixture({ auxiliar1CodigoExcel: "A-1", ...SIN_REGRESO })]);
    expect(r.filas[0].estado).toBe("error");
    expect(r.filas[0].errores).toEqual(["El auxiliar Auxiliar Uno sigue asignado al viaje PLAN-AUX-7, que aún no registra llegada."]);
  });

  it("SIN regreso que choca con un viaje existente de la UNIDAD", async () => {
    const estado = crearEstadoMock({ personal: [personalPiloto], unidades: [{ id: 950, placa: "P-123ABC" }] });
    mockDbConflictosPorRecurso(estado, {}, { 950: [candidato({ recurso_nombre: "P-123ABC", codigo: "PLAN-UNI-3", estado: "En ruta", regreso_estimado: null })] });
    mockVehiculos();
    const r = await previsualizarImportacionProgramacion(7, [filaFixture(SIN_REGRESO)]);
    expect(r.filas[0].estado).toBe("error");
    expect(r.filas[0].errores).toEqual(["La unidad P-123ABC sigue asignado al viaje PLAN-UNI-3, que aún no registra llegada."]);
  });

  it("un viaje existente Cerrado sin regreso estimado ocupa solo hasta su llegada real: una fila posterior sin regreso pasa", async () => {
    mockDb({
      personal: [personalPiloto],
      conflictoPersonal: [candidato({ estado: "Cerrado", regreso_estimado: null, inicio: "2026-09-19 06:00:00", llegada_tecnica: 1, hora_llegada: "2026-09-19 18:00:00", cerrado_en: "2026-09-25 09:00:00" })],
    });
    mockVehiculos();
    const r = await previsualizarImportacionProgramacion(7, [filaFixture(SIN_REGRESO)]);
    expect(r.filas[0].estado).toBe("ok");
  });

  it("SIN regreso que choca con una fila ANTERIOR del mismo lote: error claro en ambas filas, con el estado de la otra fila", async () => {
    mockDb({ personal: [personalPiloto] });
    mockVehiculos(FLOTA);
    const filas = [
      filaFixture({ filaExcel: 4, placaExcel: "AAA111", ...SIN_REGRESO }),
      filaFixture({ filaExcel: 5, placaExcel: "BBB222", fechaSalidaExcel: "2026-09-22", fechaRegresoExcel: "2026-09-22", horaRegresoExcel: "17:00" }),
    ];
    const r = await previsualizarImportacionProgramacion(7, filas);
    expect(r.filas.map((f) => f.estado)).toEqual(["error", "error"]);
    expect(r.filas[1].errores.join("\n")).toContain('Traslape con la fila 4 del mismo archivo: comparten personal "P-1"');
    expect(r.filas[1].errores.join("\n")).toContain("no tiene regreso estimado: se considera un viaje abierto");
    expect(r.filas[0].errores.join("\n")).toContain("Traslape con la fila 5 del mismo archivo");
    expect(r.filas[0].errores.join("\n")).toContain("2026-09-22 08:00 a 2026-09-22 17:00");
  });

  it("filas del mismo lote sin traslape y sin regreso: ambas ok cuando no comparten recursos", async () => {
    mockDb({ empleados: [empleadoRow(), empleadoRow({ id: 22, codigo: "P-2", nombre: "Otro Piloto" })] });
    mockVehiculos(FLOTA);
    const filas = [
      filaFixture({ filaExcel: 4, pilotoCodigoExcel: "P-1", placaExcel: "AAA111", ...SIN_REGRESO }),
      filaFixture({ filaExcel: 5, pilotoCodigoExcel: "P-2", placaExcel: "BBB222", ...SIN_REGRESO }),
    ];
    const r = await previsualizarImportacionProgramacion(7, filas);
    expect(r.filas.map((f) => f.estado)).toEqual(["ok", "ok"]);
  });

  it("aislamiento por empresa: la búsqueda de conflictos usa la empresa de la importación en SQL y parámetros", async () => {
    mockDb({ personal: [personalPiloto], unidades: [{ id: 950, placa: "P-123ABC" }] });
    mockVehiculos();
    await previsualizarImportacionProgramacion(9, [filaFixture(SIN_REGRESO)]);
    const consultas = consultasConflicto() as [string, unknown[]][];
    expect(consultas).toHaveLength(2); // piloto + unidad
    for (const [sql, params] of consultas) {
      expect(sql).toMatch(/(tp|u)\.empresa_id = \?/);
      expect(sql).toContain("fv.empresa_id = p.empresa_id");
      expect(params[1]).toBe(9);
      expect(params).not.toContain(7);
    }
  });

  it("las filas resueltas nunca traen recursos de otra empresa: los catálogos se piden con la empresa de la importación", async () => {
    mockDb({ personal: [personalPiloto] });
    mockVehiculos();
    await previsualizarImportacionProgramacion(9, [filaFixture(SIN_REGRESO)]);
    const catalogos = vi.mocked(query).mock.calls.filter(([sql]) => /FROM (tms_cliente_rutas r|empleados|tms_personal|tms_unidades)\b/.test(String(sql)) && !String(sql).includes("tp") );
    for (const [, params] of catalogos) expect((params as unknown[])[0]).toBe(9);
  });
});

describe("confirmarImportacionProgramacion — regreso estimado opcional (todo o nada)", () => {
  beforeEach(() => vi.resetAllMocks());
  const personalPiloto = { id: 900, codigo: "P-1", tipo: "Piloto" };
  const insertsPlan = (conn: ReturnType<typeof makeConnMock>) => vi.mocked(conn.execute).mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO tms_planes_viaje"));

  it("sin regreso estimado y sin conflicto: se importa y regreso_estimado queda NULL", async () => {
    const estado = mockDb({ personal: [personalPiloto] });
    mockVehiculos();
    const { conn } = mockGetPool({ estado });
    const r = await confirmarImportacionProgramacion(7, "admin", "p.xlsx", "sha256:x", [filaFixture(SIN_REGRESO)]);
    expect(r).toMatchObject({ resultado: "exitoso", filasImportadas: 1 });
    expect(insertsPlan(conn)).toHaveLength(1);
    expect((insertsPlan(conn)[0][1] as unknown[])[11]).toBeNull();
  });

  it("con regreso estimado y sin conflicto: se importa con el regreso tal cual", async () => {
    const estado = mockDb({ personal: [personalPiloto] });
    mockVehiculos();
    const { conn } = mockGetPool({ estado });
    const r = await confirmarImportacionProgramacion(7, "admin", "p.xlsx", "sha256:x", [filaFixture()]);
    expect(r.resultado).toBe("exitoso");
    expect((insertsPlan(conn)[0][1] as unknown[])[11]).toBe("2026-09-20 17:00");
  });

  it("sin regreso que choca con un viaje existente: rechaza TODO el lote, no abre transacción ni inserta nada", async () => {
    const estado = mockDb({ personal: [personalPiloto], conflictoPersonal: [candidato({ regreso_estimado: null })] });
    mockVehiculos();
    const { conn, lockConn } = mockGetPool({ estado });
    const r = await confirmarImportacionProgramacion(7, "admin", "p.xlsx", "sha256:x", [filaFixture(SIN_REGRESO)]);
    expect(r.resultado).toBe("error");
    expect(r.resultado === "error" && r.erroresPorFila?.[0].errores[0]).toContain("PLAN-20260920-001");
    expect(conn.beginTransaction).not.toHaveBeenCalled();
    expect(insertsPlan(conn)).toHaveLength(0);
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
    expect(lockConn.release).toHaveBeenCalledOnce();
  });

  it("sin regreso que choca con una fila anterior del mismo lote: nada se inserta (ni la fila buena)", async () => {
    const estado = mockDb({
      empleados: [empleadoRow(), empleadoRow({ id: 22, codigo: "P-2", nombre: "Otro Piloto" })],
    });
    mockVehiculos(FLOTA);
    const { conn } = mockGetPool({ estado });
    const filas = [
      filaFixture({ filaExcel: 4, pilotoCodigoExcel: "P-1", placaExcel: "AAA111", ...SIN_REGRESO }),
      filaFixture({ filaExcel: 5, pilotoCodigoExcel: "P-1", placaExcel: "BBB222", fechaSalidaExcel: "2026-09-24", fechaRegresoExcel: "2026-09-24", horaRegresoExcel: "17:00" }),
      filaFixture({ filaExcel: 6, pilotoCodigoExcel: "P-2", placaExcel: "CCC333" }),
    ];
    const r = await confirmarImportacionProgramacion(7, "admin", "p.xlsx", "sha256:x", filas);
    expect(r.resultado).toBe("error");
    expect(r.resultado === "error" && r.erroresPorFila?.map((f) => f.filaExcel).sort()).toEqual([4, 5]);
    expect(conn.beginTransaction).not.toHaveBeenCalled();
    expect(insertsPlan(conn)).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------
// IDENTIDAD DE PERSONAL — el importador identifica a la PERSONA por su
// empleado (id_empleado), no por el rol con el que viene en el Excel: si el
// empleado ya existe en TMS con el otro rol (Auxiliar vs Piloto), sus viajes
// existentes también cuentan. Misma regla que POST/PATCH (primerConflictoTraslape).
// ---------------------------------------------------------------------
describe("importador — identidad de personal por empleado (id_empleado)", () => {
  beforeEach(() => vi.resetAllMocks());

  const EMP_JUAN = empleadoRow(); // id 20, código P-1
  const EMP_ANA = empleadoRow({ id: 21, codigo: "A-1", nombre: "Ana Auxiliar" });
  const planExistente = (over: Record<string, unknown> = {}) => ({
    id: 900, empresa_id: 7, codigo: "PLAN-EXISTENTE", estado: "Programado", inicio: "2026-09-20 09:00:00", regreso_estimado: "2026-09-20 15:00:00", ...over,
  });
  const persona = (over: Record<string, unknown>) => ({ empresa_id: 7, nombre: "Juan Pérez", tipo: "Piloto", id_empleado: 20, codigo: "P-1", ...over }) as ModeloPersonal["personal"][number];

  /** Catálogos desde el modelo; los conflictos de personal se calculan sobre el mismo modelo (emulador de la consulta). */
  function montar(modelo: ModeloPersonal, empleados = [EMP_JUAN, EMP_ANA]) {
    const estado = crearEstadoMock({
      empleados,
      personal: modelo.personal.filter((p) => p.empresa_id === 7 && p.codigo).map((p) => ({ id: p.id, codigo: p.codigo!, tipo: p.tipo, id_empleado: p.id_empleado })),
    });
    vi.mocked(query).mockImplementation((async (sql: string, params?: unknown) => {
      const pr = (params ?? []) as unknown[];
      if (sql.includes("FROM tms_personal tp")) return emularConsultaConflictoPersonal(modelo, sql, pr);
      return dispatchQuery(estado, sql, pr);
    }) as never);
    mockVehiculos();
    return estado;
  }
  const conflictoPersonal = () => vi.mocked(query).mock.calls.filter(([sql]) => String(sql).includes("FROM tms_personal tp"));

  it("piloto del Excel que en TMS solo existe como AUXILIAR con viaje existente solapado: CONFLICTO", async () => {
    montar({ personal: [persona({ id: 901, tipo: "Auxiliar" })], planes: [planExistente({ auxiliares: [901] })] });
    const r = await previsualizarImportacionProgramacion(7, [filaFixture()]);
    expect(r.filas[0].estado).toBe("error");
    expect(r.filas[0].errores).toEqual(["El piloto Juan Pérez ya está asignado al viaje PLAN-EXISTENTE de 09:00 a 15:00."]);
    // Se consultó con el personal_id del OTRO rol (901): la consulta expande a todos los del empleado.
    expect((conflictoPersonal()[0][1] as unknown[]).slice(0, 2)).toEqual([901, 7]);
  });

  it("piloto del Excel con fila de Piloto (22) y de Auxiliar (10) del mismo empleado; el viaje usa la de Auxiliar: CONFLICTO", async () => {
    montar({ personal: [persona({ id: 10, tipo: "Auxiliar" }), persona({ id: 22, tipo: "Piloto" })], planes: [planExistente({ auxiliares: [10] })] });
    const r = await previsualizarImportacionProgramacion(7, [filaFixture()]);
    expect(r.filas[0].estado).toBe("error");
    expect((conflictoPersonal()[0][1] as unknown[])[0]).toBe(22); // el rol pedido primero; la consulta cubre ambos
    expect(r.filas[0].errores[0]).toContain("PLAN-EXISTENTE");
  });

  it("auxiliar del Excel que en TMS solo existe como PILOTO con viaje existente solapado: CONFLICTO", async () => {
    montar({ personal: [persona({ id: 950, tipo: "Piloto", nombre: "Ana Auxiliar", id_empleado: 21, codigo: "A-1" })], planes: [planExistente({ piloto_id: 950 })] });
    const r = await previsualizarImportacionProgramacion(7, [filaFixture({ auxiliar1CodigoExcel: "A-1", pilotoCodigoExcel: "P-1" })]);
    expect(r.filas[0].estado).toBe("error");
    expect(r.filas[0].errores[0]).toBe("El auxiliar Ana Auxiliar ya está asignado al viaje PLAN-EXISTENTE de 09:00 a 15:00.");
  });

  it("sin regreso estimado en el Excel + mismo empleado con otro rol en un viaje abierto: CONFLICTO (misma regla que POST/PATCH)", async () => {
    montar({ personal: [persona({ id: 901, tipo: "Auxiliar" })], planes: [planExistente({ auxiliares: [901], regreso_estimado: null, estado: "En ruta", inicio: "2026-09-19 06:00:00" })] });
    const r = await previsualizarImportacionProgramacion(7, [filaFixture(SIN_REGRESO)]);
    expect(r.filas[0].errores).toEqual(["El piloto Juan Pérez sigue asignado al viaje PLAN-EXISTENTE, que aún no registra llegada."]);
  });

  it("personal SIN id_empleado: fallback por personal_id exacto (la fila de otro rol no se toma por la misma persona)", async () => {
    montar({
      personal: [persona({ id: 30, tipo: "Auxiliar", id_empleado: null }), persona({ id: 31, tipo: "Piloto", id_empleado: null })],
      planes: [planExistente({ auxiliares: [30] })],
    });
    const r = await previsualizarImportacionProgramacion(7, [filaFixture()]);
    expect(r.filas[0].estado).toBe("ok"); // el Piloto 31 no comparte id_empleado con el Auxiliar 30
    expect((conflictoPersonal()[0][1] as unknown[])[0]).toBe(31);
  });

  it("personal SIN id_empleado y del MISMO rol con viaje solapado: sigue habiendo conflicto por personal_id exacto", async () => {
    montar({ personal: [persona({ id: 31, tipo: "Piloto", id_empleado: null })], planes: [planExistente({ piloto_id: 31 })] });
    const r = await previsualizarImportacionProgramacion(7, [filaFixture()]);
    expect(r.filas[0].estado).toBe("error");
  });

  it("empleado DISTINTO con el mismo nombre: sin conflicto", async () => {
    montar({
      personal: [persona({ id: 22, tipo: "Piloto" }), persona({ id: 40, tipo: "Auxiliar", id_empleado: 77, codigo: "X-9" })],
      planes: [planExistente({ auxiliares: [40] })],
    });
    const r = await previsualizarImportacionProgramacion(7, [filaFixture()]);
    expect(r.filas[0].estado).toBe("ok");
  });

  it("empleado nunca visto en TMS (sin ninguna fila en tms_personal): no hay viajes que comprobar", async () => {
    montar({ personal: [], planes: [planExistente({ auxiliares: [901] })] });
    const r = await previsualizarImportacionProgramacion(7, [filaFixture()]);
    expect(r.filas[0].estado).toBe("ok");
    expect(conflictoPersonal()).toHaveLength(0);
  });

  it("aislamiento por empresa: los personal/viajes de otra empresa con el mismo id_empleado no cuentan y la consulta va con la empresa importada", async () => {
    const modelo: ModeloPersonal = {
      personal: [persona({ id: 22, tipo: "Piloto" }), persona({ id: 60, tipo: "Auxiliar", empresa_id: 8 })],
      planes: [planExistente({ id: 901, empresa_id: 8, codigo: "PLAN-OTRA-EMPRESA", auxiliares: [60] })],
    };
    montar(modelo);
    const r = await previsualizarImportacionProgramacion(7, [filaFixture()]);
    expect(r.filas[0].estado).toBe("ok");
    const [sql, params] = conflictoPersonal()[0] as [string, unknown[]];
    expect(sql).toContain("eq.empresa_id = tp.empresa_id");
    expect(params.slice(0, 2)).toEqual([22, 7]);
  });

  it("los catálogos de personal se piden por empresa e incluyen id_empleado", async () => {
    montar({ personal: [], planes: [] });
    await previsualizarImportacionProgramacion(9, [filaFixture()]);
    const catalogoPersonal = vi.mocked(query).mock.calls.find(([sql]) => String(sql).includes("id_empleado FROM tms_personal WHERE empresa_id = ?"));
    expect(catalogoPersonal?.[1]).toEqual([9]);
  });

  it("confirmar: el conflicto por identidad de empleado rechaza el lote (todo o nada) sin abrir transacción", async () => {
    const estado = montar({ personal: [persona({ id: 901, tipo: "Auxiliar" })], planes: [planExistente({ auxiliares: [901] })] });
    const { conn } = mockGetPool({ estado });
    const r = await confirmarImportacionProgramacion(7, "admin", "p.xlsx", "sha256:x", [filaFixture()]);
    expect(r.resultado).toBe("error");
    expect(conn.beginTransaction).not.toHaveBeenCalled();
    expect(vi.mocked(conn.execute).mock.calls.some(([sql]) => String(sql).includes("INSERT INTO tms_planes_viaje"))).toBe(false);
  });
});
