import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/operaciones/disponibilidad", () => ({ listarDisponibilidadVehiculos: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));

import { execute, getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { listarDisponibilidadVehiculos, type VehiculoDisponibilidad } from "@/lib/operaciones/disponibilidad";
import type { FilaProgramacionExcel } from "./programacion-import-excel";
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
type PersonalMock = { id: number; codigo: string; tipo: string };
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
  if (sql.includes("SELECT id, codigo, tipo FROM tms_personal")) return estado.personal;
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
