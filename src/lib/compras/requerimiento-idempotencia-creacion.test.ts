import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  query: vi.fn(), getConnection: vi.fn(), audit: vi.fn(), plantilla: vi.fn(), firma: vi.fn(), upload: vi.fn(), borrar: vi.fn(),
  adquirir: vi.fn(), liberar: vi.fn(), buscarFactura: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ query: m.query, getPool: () => ({ getConnection: m.getConnection }) }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: m.audit }));
vi.mock("@/lib/firmas/usuario-firmas", () => ({ leerBytesFirmaGuardada: m.plantilla }));
vi.mock("@/lib/firmas/firmas-internas", () => ({ crearFirmaInterna: m.firma }));
vi.mock("@/lib/uploads", () => ({ guardarUpload: m.upload, borrarUpload: m.borrar }));
vi.mock("./facturas-duplicadas", async importOriginal => {
  const real = await importOriginal<typeof import("./facturas-duplicadas")>();
  return { ...real, adquirirLocksFacturas: m.adquirir, liberarLocksFacturas: m.liberar, buscarFacturaExistente: m.buscarFactura };
});
import { ErrorCompra, guardarRequerimiento, MSG_FACTURA_UNICA_BD } from "./requerimientos";
import { crearRequerimientoSchema } from "./requerimiento-schema";
import { MENSAJE_CONFLICTO_IDEMPOTENCIA } from "@/lib/tms/idempotencia-envio";

/**
 * IDEMPOTENCIA DE CREACIÓN — Requerimientos de Compras (PR B) contra una "base de datos" en memoria con la semántica que
 * importa: UNIQUE (empresa_id, clave_idempotencia) en el INSERT de cabecera y lectura por clave. La verificación contra una
 * MariaDB real (peticiones concurrentes verdaderas) está en requerimiento-idempotencia-creacion.db.test.ts.
 */
type Fila = { id: number; empresa: number; clave: string | null; huella: string | null; codigo: string; version: number; sql: string };
type Linea = { empresa: number; requerimientoId: number; proveedor: number; serie: string | null; numero: string | null };

const CLAVE = "3f2a9c1e-7b64-4d0a-9e51-2c8f6a1b0d33";
const OTRA = "9a8b7c6d-5e4f-4a3b-8c2d-1e0f9a8b7c6d";
const INDICE = "uq_compras_req_empresa_clave";

const errorMySql = (mensaje: string, code: string, errno: number) => Object.assign(new Error(mensaje), { code, errno });

let filas: Fila[];
let lineas: Linea[];
let intentos: number;
let busquedasPorClave: number;
let siguienteId: number;
let sinColumnas: boolean;
/** Cantidad de búsquedas por clave que "no ven" la fila ya confirmada (simula la carrera: lectura anterior al commit del ganador). */
let busquedasOcultas: number;
let conn: ReturnType<typeof crearConn>;

function buscarPorClave(params: unknown[]) {
  busquedasPorClave += 1;
  if (busquedasOcultas > 0) { busquedasOcultas -= 1; return []; }
  const [empresa, clave] = params as [number, string];
  const f = filas.find(x => x.empresa === empresa && x.clave === clave);
  return f ? [{ id: f.id, codigo: f.codigo, version: f.version, huella_idempotencia: f.huella }] : [];
}

function crearConn() {
  return {
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("clave_idempotencia = ?")) {
        if (sinColumnas) throw errorMySql("Unknown column 'clave_idempotencia' in 'where clause'", "ER_BAD_FIELD_ERROR", 1054);
        return [buscarPorClave(params)];
      }
      if (sql.includes("FROM cont_entidades")) return [[{ id: 4, nombre: "Entidad real" }]];
      if (sql.includes("FROM usuarios")) return [[{ nombre: "Usuario real", rol_global: "Operaciones" }]];
      if (sql.includes("FROM compras_proveedores")) return [[{ id: 3, activo: 1, nombre_comercial: "Proveedor real", razon_social: "S.A.", nit: "123", banco: "B", numero_cuenta: "9", dias_credito: 0 }]];
      throw new Error(`SQL inesperado: ${sql}`);
    }),
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      if (sql.includes("INSERT INTO compras_requerimientos")) {
        intentos += 1;
        const conClave = sql.includes("clave_idempotencia");
        const empresa = params[0] as number;
        const clave = conClave ? (params[params.length - 2] as string) : null;
        const huella = conClave ? (params[params.length - 1] as string) : null;
        if (clave && filas.some(f => f.empresa === empresa && f.clave === clave)) {
          throw errorMySql(`Duplicate entry '${empresa}-${clave}' for key '${INDICE}'`, "ER_DUP_ENTRY", 1062);
        }
        const id = siguienteId++;
        filas.push({ id, empresa, clave, huella, codigo: String(params[1]), version: 1, sql });
        return [{ insertId: id, affectedRows: 1 }];
      }
      if (sql.includes("UPDATE compras_requerimientos SET codigo")) {
        const [codigo, empresa, id] = params as [string, number, number];
        const f = filas.find(x => x.empresa === empresa && x.id === id);
        if (f) f.codigo = codigo;
        return [{ insertId: 0, affectedRows: 1 }];
      }
      if (sql.includes("INSERT INTO compras_requerimiento_lineas")) {
        // [empresa, requerimiento, orden, vehiculo, unidad, fecha, serie, numero, proveedor, ...]
        lineas.push({ empresa: params[0] as number, requerimientoId: params[1] as number, serie: params[6] as string | null, numero: params[7] as string | null, proveedor: params[8] as number });
        return [{ insertId: lineas.length, affectedRows: 1 }];
      }
      return [{ insertId: 0, affectedRows: 1 }];
    }),
  };
}

const linea = { fecha: "2026-10-01", proveedor_id: 3, vehiculo_id: null, repuesto_descripcion: "Filtro de aire", metodo_pago: "Transferencia", condicion_pago: "Contado", total: "10.25" };
const payload = (extra: Record<string, unknown> = {}) => ({
  fecha_requerimiento: "2026-10-01", entidad_requirente_id: 4, requirente_usuario_id: 9, observaciones: "Urgente", lineas: [linea], ...extra,
});
const crear = (extra: Record<string, unknown> = {}, empresa = 1) =>
  guardarRequerimiento(empresa, 8, "registrador", crearRequerimientoSchema.parse(payload(extra)), false);

beforeEach(() => {
  vi.resetAllMocks();
  filas = []; lineas = []; intentos = 0; busquedasPorClave = 0; siguienteId = 100;
  sinColumnas = false; busquedasOcultas = 0;
  conn = crearConn();
  m.getConnection.mockImplementation(async () => conn);
  m.query.mockImplementation(async (sql: string, params: unknown[] = []) => {
    if (sql.includes("clave_idempotencia = ?")) {
      if (sinColumnas) throw errorMySql("Unknown column 'clave_idempotencia' in 'where clause'", "ER_BAD_FIELD_ERROR", 1054);
      return buscarPorClave(params);
    }
    return [];
  });
  m.plantilla.mockResolvedValue(null);
  m.firma.mockResolvedValue({ id: 50 });
  m.adquirir.mockResolvedValue({ ok: true, adquiridos: [] });
  m.liberar.mockResolvedValue(undefined);
  m.buscarFactura.mockImplementation(async (_lector: unknown, empresa: number, proveedor: number, serie: string | null, numero: string | null, opts: { excluirRequerimientoId?: number } = {}) => {
    const hit = lineas.find(l => l.empresa === empresa && l.proveedor === proveedor && (l.serie ?? "") === (serie ?? "") && (l.numero ?? "") === (numero ?? "") && l.requerimientoId !== opts.excluirRequerimientoId);
    return hit ? { requerimientoCodigo: "RC-2026-000100", proveedorNombre: "Proveedor real" } : null;
  });
});

describe("esquema: clave_idempotencia (solo al crear)", () => {
  it("crear acepta una clave válida y también el payload sin clave (compatibilidad)", () => {
    expect(crearRequerimientoSchema.parse(payload({ clave_idempotencia: CLAVE })).clave_idempotencia).toBe(CLAVE);
    expect(crearRequerimientoSchema.safeParse(payload()).success).toBe(true);
  });
  it.each(["", "corta", "con espacios y ñ 12345678", "x'; DROP TABLE y;--", "x".repeat(65)])("rechaza clave con formato inválido %j", valor => {
    expect(crearRequerimientoSchema.safeParse(payload({ clave_idempotencia: valor })).success).toBe(false);
  });
});

describe("Idempotencia de creación — Requerimientos de Compras", () => {
  it("A. misma clave + mismo contenido → la MISMA creación (id y código); solo hay un INSERT", async () => {
    const a = await crear({ clave_idempotencia: CLAVE });
    const b = await crear({ clave_idempotencia: CLAVE });
    expect(b).toEqual(a);
    expect(filas).toHaveLength(1);
    expect(intentos).toBe(1);
    expect(filas[0].clave).toBe(CLAVE);
    expect(filas[0].huella).toMatch(/^[0-9a-f]{64}$/);
    expect(lineas).toHaveLength(1); // las líneas del reintento no se escriben
  });

  it("A2. el reintento no abre transacción ni pide conexión (responde desde la búsqueda previa)", async () => {
    await crear({ clave_idempotencia: CLAVE });
    const conexiones = m.getConnection.mock.calls.length;
    await crear({ clave_idempotencia: CLAVE });
    expect(m.getConnection.mock.calls.length).toBe(conexiones);
  });

  it("B. misma clave + contenido DISTINTO → 409 y no se crea nada más", async () => {
    await crear({ clave_idempotencia: CLAVE });
    const variantes = [
      { observaciones: "Otra observación" },
      { fecha_requerimiento: "2026-10-02" },
      { lineas: [{ ...linea, total: "10.26" }] },
      { lineas: [linea, { ...linea, repuesto_descripcion: "Aceite" }] },
      { lineas: [{ ...linea, observaciones: "Con nota" }] },
    ];
    for (const v of variantes) {
      const error = await crear({ clave_idempotencia: CLAVE, ...v }).catch((e: unknown) => e);
      expect(error).toBeInstanceOf(ErrorCompra);
      expect((error as ErrorCompra).status).toBe(409);
      expect((error as ErrorCompra).message).toBe(MENSAJE_CONFLICTO_IDEMPOTENCIA);
    }
    expect(filas).toHaveLength(1);
    expect(intentos).toBe(1);
  });

  it("C. clave DISTINTA + mismo contenido → dos creaciones legítimas", async () => {
    const a = await crear({ clave_idempotencia: CLAVE });
    const b = await crear({ clave_idempotencia: OTRA });
    expect(b.id).not.toBe(a.id);
    expect(filas).toHaveLength(2);
  });

  it("D. concurrencia con la MISMA clave → una sola fila; las perdedoras recuperan la ganadora", async () => {
    const resultados = await Promise.all([crear({ clave_idempotencia: CLAVE }), crear({ clave_idempotencia: CLAVE }), crear({ clave_idempotencia: CLAVE })]);
    expect(new Set(resultados.map(r => r.id)).size).toBe(1);
    expect(filas.filter(f => f.clave === CLAVE)).toHaveLength(1);
    expect(intentos).toBeGreaterThan(1); // todas pasaron la búsqueda previa: el UNIQUE decidió la carrera
    expect(conn.rollback).toHaveBeenCalled();
  });

  it("D2. carrera perdida contra una creación con OTRO contenido → 409, nunca se devuelve en silencio", async () => {
    filas.push({ id: 50, empresa: 1, clave: CLAVE, huella: "f".repeat(64), codigo: "RC-2026-000050", version: 1, sql: "" });
    busquedasOcultas = 2; // ni la búsqueda previa ni la de la transacción la ven: decide el UNIQUE y la relectura posterior
    const error = await crear({ clave_idempotencia: CLAVE }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorCompra);
    expect((error as ErrorCompra).status).toBe(409);
    expect(filas).toHaveLength(1);
    expect(intentos).toBe(1); // se intentó insertar y el UNIQUE la rechazó
    expect(conn.rollback).toHaveBeenCalled();
  });

  it("E. sin clave → comportamiento legado: cada envío crea y no consulta ni escribe columnas de idempotencia", async () => {
    const a = await crear();
    const b = await crear();
    expect(b.id).not.toBe(a.id);
    expect(filas).toHaveLength(2);
    expect(busquedasPorClave).toBe(0);
    expect(filas.every(f => f.clave === null && !f.sql.includes("clave_idempotencia"))).toBe(true);
  });

  it("G. aislamiento por empresa: la misma clave en otra empresa NO reutiliza el requerimiento", async () => {
    const a = await crear({ clave_idempotencia: CLAVE }, 1);
    const b = await crear({ clave_idempotencia: CLAVE }, 2);
    expect(b.id).not.toBe(a.id);
    expect(filas.map(f => f.empresa).sort()).toEqual([1, 2]);
  });

  it("H. migración pendiente (columna inexistente) → crea en modo legado sin fallar y sin escribir la clave", async () => {
    sinColumnas = true;
    const creada = await crear({ clave_idempotencia: CLAVE });
    expect(creada.id).toBeGreaterThan(0);
    expect(filas).toHaveLength(1);
    expect(filas[0].sql).not.toContain("clave_idempotencia");
    expect(conn.commit).toHaveBeenCalledOnce();
  });

  it("I. un reintento de un requerimiento CON FACTURAS devuelve la creación original (no «factura duplicada»)", async () => {
    const conFactura = { lineas: [{ ...linea, serie_factura: "A", numero_factura: "1001" }] };
    const original = await crear({ clave_idempotencia: CLAVE, ...conFactura });
    // Sin clave idempotente este reintento fallaba por la factura ya registrada: se verifica que ESA regla sigue vigente…
    const sinClave = await crear({ ...conFactura }).catch((e: unknown) => e);
    expect(sinClave).toBeInstanceOf(ErrorCompra);
    expect((sinClave as ErrorCompra).status).toBe(409);
    // …y que con la misma clave el reintento es idempotente.
    const reintento = await crear({ clave_idempotencia: CLAVE, ...conFactura });
    expect(reintento).toEqual(original);
    expect(filas).toHaveLength(1);
  });

  it("J. la petición que esperó al ganador (ya con lock de facturas) re-lee dentro de la transacción y devuelve la creación, con rollback", async () => {
    const conFactura = { lineas: [{ ...linea, serie_factura: "B", numero_factura: "2002" }] };
    const original = await crear({ clave_idempotencia: CLAVE, ...conFactura });
    busquedasOcultas = 1; // la búsqueda previa (sin lock) no la vio…
    const abiertas = m.getConnection.mock.calls.length;
    const reintento = await crear({ clave_idempotencia: CLAVE, ...conFactura });
    expect(reintento).toEqual(original);
    expect(m.getConnection.mock.calls.length).toBe(abiertas + 1); // …se abrió conexión y se re-leyó con el lock
    expect(m.adquirir).toHaveBeenCalledTimes(2);
    expect(conn.rollback).toHaveBeenCalled(); // la transacción abierta NO se devuelve al pool sin cerrar
    expect(conn.release).toHaveBeenCalled();
    expect(m.liberar).toHaveBeenCalledTimes(2); // los locks de facturas se liberan también en la ruta de reintento
    expect(filas).toHaveLength(1);
    expect(intentos).toBe(1);
  });

  it("K. un duplicado de FACTURA (otro índice) sigue su camino normal y no se confunde con un reintento", async () => {
    const original = filas.length;
    conn.execute.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO compras_requerimientos")) return [{ insertId: 77, affectedRows: 1 }];
      if (sql.includes("INSERT INTO compras_requerimiento_lineas")) throw errorMySql("Duplicate entry '1-3-A-1' for key 'uq_compras_factura_proveedor'", "ER_DUP_ENTRY", 1062);
      return [{ insertId: 0, affectedRows: 1 }];
    });
    const error = await crear({ clave_idempotencia: CLAVE, lineas: [{ ...linea, serie_factura: "A", numero_factura: "1" }] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ErrorCompra);
    expect((error as ErrorCompra).message).toBe(MSG_FACTURA_UNICA_BD);
    expect(filas.length).toBe(original);
  });

  it("L. un fallo cualquiera durante la creación no deja la clave consumida (se puede reintentar)", async () => {
    conn.execute.mockRejectedValueOnce(new Error("conexión perdida"));
    await expect(crear({ clave_idempotencia: CLAVE })).rejects.toThrow("conexión perdida");
    expect(conn.rollback).toHaveBeenCalled();
    const ok = await crear({ clave_idempotencia: CLAVE });
    expect(ok.id).toBeGreaterThan(0);
    expect(filas).toHaveLength(1);
  });
});
