import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
vi.mock("@/lib/firmas/firmas-internas", () => ({ crearFirmaInterna: vi.fn() }));
vi.mock("@/lib/firmas/usuario-firmas", () => ({ leerBytesFirmaGuardada: vi.fn(async () => null) }));
vi.mock("@/lib/firmas/imagen-firma", () => ({ sha256Hex: vi.fn(() => "hash") }));
vi.mock("@/lib/uploads", () => ({ guardarUpload: vi.fn(), borrarUpload: vi.fn() }));
import { getPool, query } from "@/lib/db";
import { crearGasto } from "./gastos";
import { crearSolicitudFondo } from "./fondos";
import { ConflictoIdempotencia } from "./idempotencia-envio";

/**
 * IDEMPOTENCIA DE CREACIÓN — Fondos y Gastos contra una "base de datos" en memoria con la semántica que importa:
 * UNIQUE (empresa_id, clave_idempotencia) sobre el INSERT de cabecera y lectura por clave. No es la base real (ver el
 * script de verificación contra MariaDB desechable en la descripción del PR): aquí se prueba la lógica de aplicación.
 */

type Fila = { id: number; empresa: number; clave: string | null; huella: string | null; sql: string };

type Almacen = {
  filas: Fila[];
  /** Cantidad de INSERT de cabecera que se INTENTARON (incluye los rechazados por UNIQUE). */
  intentos: number;
  /** Cantidad de SELECT por clave. */
  busquedasPorClave: number;
};

const CLAVE = "3f2a9c1e-7b64-4d0a-9e51-2c8f6a1b0d33";
const OTRA_CLAVE = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";

const INDICE = { tms_gastos_operativos: "uq_gastos_empresa_clave", tms_solicitudes_fondo: "uq_fondo_empresa_clave" } as const;

function errorMySql(mensaje: string, code: string, errno: number) {
  return Object.assign(new Error(mensaje), { code, errno });
}

function montarBd(opts: {
  tabla: "tms_gastos_operativos" | "tms_solicitudes_fondo";
  /** Simula la migración pendiente: la columna `clave_idempotencia` no existe. */
  sinColumnas?: boolean;
  /** Simula la carrera: la PRIMERA búsqueda por clave no ve la fila ya confirmada por otra petición. */
  primeraBusquedaVacia?: boolean;
  /** Filas ya existentes (p. ej. la creación ganadora de otra petición). */
  filasIniciales?: Fila[];
  /** Fuerza que el INSERT falle con un duplicado de OTRO índice (código). */
  duplicadoDeCodigo?: boolean;
}): Almacen {
  const al: Almacen = { filas: [...(opts.filasIniciales ?? [])], intentos: 0, busquedasPorClave: 0 };
  let siguienteId = 100;
  let busquedaVaciaConsumida = false;
  const tabla = opts.tabla;

  const filaGasto = (id: number) => ({
    id, codigo: `GASTO-${String(id).padStart(6, "0")}`, empresa_id: 7, fecha_solicitud: "2026-10-01", categoria: "Combustible",
    descripcion: "Diesel", cantidad: "1.00", monto: "450.00", tiene_factura: 0, observaciones: "obs", activo: 1,
    creado_por: "admin", creado_en: "2026-10-01 10:00:00", actualizado_en: "2026-10-01 10:00:00", estado: "Pendiente",
  });
  const filaFondo = (id: number) => ({
    id, empresa_id: 7, codigo: `FONDO-${String(id).padStart(6, "0")}`, fecha_requerimiento: "2026-10-01", total: "100.00",
    estado: "Pendiente", observaciones: "obs", creado_por: "admin", creado_en: "2026-10-01 10:00:00",
    requirente_usuario_id: 9, requirente_nombre: "Mario Caal", solicitante_usuario_id: 5, solicitante_nombre: "Mario Caal",
  });

  /** Lecturas con el pool plano: búsqueda por clave y relectura final del registro. */
  vi.mocked(query).mockImplementation((async (sql: string, params: unknown[] = []) => {
    if (sql.includes("clave_idempotencia = ?")) {
      al.busquedasPorClave += 1;
      if (opts.sinColumnas) throw errorMySql("Unknown column 'clave_idempotencia' in 'where clause'", "ER_BAD_FIELD_ERROR", 1054);
      if (opts.primeraBusquedaVacia && !busquedaVaciaConsumida) { busquedaVaciaConsumida = true; return []; }
      const [empresa, clave] = params as [number, string];
      const f = al.filas.find((x) => x.empresa === empresa && x.clave === clave);
      return f ? [{ id: f.id, huella_idempotencia: f.huella }] : [];
    }
    if (sql.includes("FROM tms_gasto_operativo_lineas") || sql.includes("FROM tms_solicitud_fondo_lineas")) return [];
    if (sql.includes("FROM tms_gastos_operativos g")) return [filaGasto(Number((params as unknown[])[0]))];
    if (sql.includes("FROM tms_solicitudes_fondo s")) return [filaFondo(Number((params as unknown[])[0]))];
    return [];
  }) as never);

  const conn = {
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("clave_idempotencia = ?")) {
        al.busquedasPorClave += 1;
        const [empresa, clave] = params as [number, string];
        const f = al.filas.find((x) => x.empresa === empresa && x.clave === clave);
        return [f ? [{ id: f.id, huella_idempotencia: f.huella }] : []];
      }
      if (sql.includes("FROM cont_entidades")) return [[{ id: 4, nombre: "Kuiqtrans" }]];
      if (sql.includes("FROM usuarios u")) return [[{ nombre: "Mario Caal", rol_global: "Operaciones" }]];
      return [[]];
    }),
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes(`INSERT INTO ${tabla}`)) {
        al.intentos += 1;
        if (opts.duplicadoDeCodigo) {
          throw errorMySql("Duplicate entry '7-FONDO-000100' for key 'uq_codigo'", "ER_DUP_ENTRY", 1062);
        }
        const conClave = sql.includes("clave_idempotencia");
        const empresa = params[0] as number;
        const clave = conClave ? (params[params.length - 2] as string) : null;
        const huella = conClave ? (params[params.length - 1] as string) : null;
        if (clave && al.filas.some((f) => f.empresa === empresa && f.clave === clave)) {
          throw errorMySql(`Duplicate entry '${empresa}-${clave}' for key '${INDICE[tabla]}'`, "ER_DUP_ENTRY", 1062);
        }
        const id = siguienteId++;
        al.filas.push({ id, empresa, clave, huella, sql });
        return [{ insertId: id, affectedRows: 1 }];
      }
      return [{ insertId: 0, affectedRows: 1 }];
    }),
  };
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn(async () => conn) } as never);
  return al;
}

const gastoInput = (extra: Record<string, unknown> = {}) => ({
  fechaSolicitud: "2026-10-01", categoria: "Combustible", descripcion: "Diesel", monto: 450, observaciones: "obs", ...extra,
});
const fondoInput = (extra: Record<string, unknown> = {}) => ({
  fechaRequerimiento: "2026-10-01", requirenteUsuarioId: 9, solicitanteUsuarioId: 5, observaciones: "obs",
  lineas: [{ categoria: "Combustible", descripcion: "Diesel", cantidad: 1, monto: 100 }], ...extra,
});

const MODULOS = [
  {
    nombre: "Gastos",
    tabla: "tms_gastos_operativos" as const,
    crear: (empresa: number, extra: Record<string, unknown> = {}) => crearGasto(empresa, gastoInput(extra) as never, "admin"),
    distinto: { monto: 451 },
  },
  {
    nombre: "Fondos",
    tabla: "tms_solicitudes_fondo" as const,
    crear: (empresa: number, extra: Record<string, unknown> = {}) => crearSolicitudFondo(empresa, fondoInput(extra) as never, "admin"),
    distinto: { observaciones: "Otra observación" },
  },
];

beforeEach(() => {
  vi.resetAllMocks();
});

describe.each(MODULOS)("Idempotencia de creación — $nombre", ({ tabla, crear, distinto }) => {
  it("A. misma clave + mismo contenido → la MISMA creación; solo hay un INSERT", async () => {
    const bd = montarBd({ tabla });
    const primera = await crear(7, { claveIdempotencia: CLAVE });
    const segunda = await crear(7, { claveIdempotencia: CLAVE });
    expect(segunda.id).toBe(primera.id);
    expect(bd.filas).toHaveLength(1);
    expect(bd.intentos).toBe(1);
    expect(bd.filas[0].clave).toBe(CLAVE);
    expect(bd.filas[0].huella).toMatch(/^[0-9a-f]{64}$/);
  });

  it("A2. el reintento devuelve la creación original sin abrir transacción ni escribir de nuevo", async () => {
    montarBd({ tabla });
    await crear(7, { claveIdempotencia: CLAVE });
    const abrir = vi.mocked(getPool).mock.calls.length;
    await crear(7, { claveIdempotencia: CLAVE });
    // La consulta previa usa el pool plano: no pide una conexión de transacción nueva.
    expect(vi.mocked(getPool).mock.calls.length).toBe(abrir);
  });

  it("B. misma clave + contenido DISTINTO → 409 (ConflictoIdempotencia) y no se crea nada más", async () => {
    const bd = montarBd({ tabla });
    await crear(7, { claveIdempotencia: CLAVE });
    const error = await crear(7, { claveIdempotencia: CLAVE, ...distinto }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictoIdempotencia);
    expect((error as ConflictoIdempotencia).status).toBe(409);
    expect(bd.filas).toHaveLength(1);
    expect(bd.intentos).toBe(1);
  });

  it("C. clave DISTINTA + mismo contenido → dos registros legítimos", async () => {
    const bd = montarBd({ tabla });
    const a = await crear(7, { claveIdempotencia: CLAVE });
    const b = await crear(7, { claveIdempotencia: OTRA_CLAVE });
    expect(b.id).not.toBe(a.id);
    expect(bd.filas).toHaveLength(2);
  });

  it("D. concurrencia con la MISMA clave → una sola creación; la perdedora recupera la ganadora", async () => {
    const bd = montarBd({ tabla });
    const [a, b, c] = await Promise.all([
      crear(7, { claveIdempotencia: CLAVE }),
      crear(7, { claveIdempotencia: CLAVE }),
      crear(7, { claveIdempotencia: CLAVE }),
    ]);
    expect(new Set([a.id, b.id, c.id]).size).toBe(1);
    expect(bd.filas.filter((f) => f.clave === CLAVE)).toHaveLength(1);
    // Todas pasaron la búsqueda previa antes de que alguna insertara: el UNIQUE es lo que decide.
    expect(bd.intentos).toBeGreaterThan(1);
  });

  it("D2. carrera perdida contra una creación con OTRO contenido → 409, nunca se devuelve en silencio", async () => {
    const bd = montarBd({
      tabla, primeraBusquedaVacia: true,
      filasIniciales: [{ id: 50, empresa: 7, clave: CLAVE, huella: "f".repeat(64), sql: "" }],
    });
    const error = await crear(7, { claveIdempotencia: CLAVE }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ConflictoIdempotencia);
    expect(bd.filas).toHaveLength(1);
  });

  it("E. sin clave → comportamiento legado: cada envío crea un registro y no consulta ni escribe columnas de idempotencia", async () => {
    const bd = montarBd({ tabla });
    const a = await crear(7);
    const b = await crear(7);
    expect(b.id).not.toBe(a.id);
    expect(bd.filas).toHaveLength(2);
    expect(bd.busquedasPorClave).toBe(0);
    expect(bd.filas.every((f) => f.clave === null && !f.sql.includes("clave_idempotencia"))).toBe(true);
  });

  it("F. clave con formato inválido → 400 sin tocar la base", async () => {
    montarBd({ tabla });
    await expect(crear(7, { claveIdempotencia: "x'; DROP TABLE y;--" })).rejects.toThrow("clave de envío no es válida");
    expect(vi.mocked(getPool)).not.toHaveBeenCalled();
    expect(vi.mocked(query)).not.toHaveBeenCalled();
  });

  it("G. aislamiento por empresa: la misma clave en otra empresa NO reutiliza el registro", async () => {
    const bd = montarBd({ tabla });
    const a = await crear(7, { claveIdempotencia: CLAVE });
    const b = await crear(8, { claveIdempotencia: CLAVE });
    expect(b.id).not.toBe(a.id);
    expect(bd.filas.map((f) => f.empresa).sort()).toEqual([7, 8]);
  });

  it("H. migración pendiente (columna inexistente) → crea en modo legado sin fallar y sin escribir la clave", async () => {
    const bd = montarBd({ tabla, sinColumnas: true });
    const creada = await crear(7, { claveIdempotencia: CLAVE });
    expect(creada.id).toBeGreaterThan(0);
    expect(bd.filas).toHaveLength(1);
    expect(bd.filas[0].sql).not.toContain("clave_idempotencia");
  });

  it("I. un duplicado de OTRO índice (código) no se interpreta como reintento: se propaga", async () => {
    montarBd({ tabla, duplicadoDeCodigo: true });
    await expect(crear(7, { claveIdempotencia: CLAVE })).rejects.toThrow("Duplicate entry");
  });
});

describe("Gastos — el reintento tras fallar el comprobante recupera el MISMO gasto (nivel servidor)", () => {
  it("POST exitoso → (la subida del comprobante falla en el cliente) → mismo POST con la misma clave → mismo id, sin crear otro", async () => {
    const bd = montarBd({ tabla: "tms_gastos_operativos" });
    const original = await crearGasto(7, gastoInput({ claveIdempotencia: CLAVE }) as never, "admin");
    const reintento = await crearGasto(7, gastoInput({ claveIdempotencia: CLAVE }) as never, "admin");
    expect(reintento.id).toBe(original.id);
    expect(bd.filas).toHaveLength(1);
  });
});
