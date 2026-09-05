import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolConnection } from "mysql2/promise";
vi.mock("@/lib/db", () => ({ getPool: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
import { getPool } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { limpiarModuloEmpresa } from "./limpiar-modulo";
import {
  anularMultas,
  desactivarCatalogo,
  eliminarRutas,
  leerFirmasElectronicasViaticos,
  limpiarViajesConjuntos,
  limpiarViaticos,
  recolectarRutasArchivo,
  validarViaticos,
} from "./limpiar-operaciones";

const conn = { query: vi.fn(), execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
const db = conn as unknown as PoolConnection;
let filas: Record<string, Record<string, unknown>[]>;
let referenciaExterna: boolean;
beforeEach(() => {
  vi.resetAllMocks();
  referenciaExterna = false;
  filas = {
    tms_planes_viaje: [{ id: 10, empresa_id: 7, estado: "Cerrado" }],
    flota_viajes: [{ id: 20, empresa_id: 7, plan_id: 10, estado: "cerrado" }],
    tms_plan_paradas: [{ id: 30, plan_id: 10 }],
    tms_plan_auxiliares: [{ id: 40, plan_id: 10 }],
    tms_viaticos: [{ id: 50, empresa_id: 7, plan_id: 10, estado: "PROGRAMADO" }],
    tms_evidencias: [{ id: 60, empresa_id: 7, plan_id: 10 }],
    flota_viaje_evidencias: [{ id: 70, empresa_id: 7, viaje_id: 20 }],
  };
  conn.query.mockImplementation(async (sql: string) => {
    if (sql.includes("information_schema.TABLES")) return [[{ ENGINE: "InnoDB" }]];
    if (sql.includes("information_schema.tables")) return [[{ ok: 1 }]];
    if (sql.includes("KEY_COLUMN_USAGE")) return [referenciaExterna ? [{ tabla: "facturas", columna: "plan_id", destino: "id" }] : []];
    if (sql.includes("information_schema.COLUMNS")) return [[]];
    if (sql.includes("FROM `facturas`")) return [[{ plan_id: 10 }]];
    if (sql.startsWith("SELECT *")) return [filas[sql.match(/FROM `([^`]+)`/)![1]] ?? []];
    if (sql.startsWith("SELECT COUNT")) return [[{ n: 0 }]];
    if (sql.startsWith("DELETE")) return [{ affectedRows: 1 }];
    throw new Error(`Consulta inesperada: ${sql}`);
  });
  conn.execute.mockResolvedValue([{ affectedRows: 1 }]);
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(db) } as unknown as ReturnType<typeof getPool>);
});

describe("limpieza por empresa y módulo", () => {
  it("elimina los dos expedientes juntos, hijos primero, sin borrar catálogos", async () => {
    const { conteos: out } = await limpiarViajesConjuntos(db, 7);
    expect(Object.keys(out)).toEqual(["flota_viaje_evidencias", "tms_evidencias", "flota_lecturas", "firmas_electronicas", "tms_viaticos", "tms_plan_auxiliares", "tms_plan_paradas", "flota_viajes", "tms_planes_viaje"]);
    const lecturas = conn.query.mock.calls.filter(([s]) => String(s).startsWith("SELECT *") && !String(s).includes("firmas_electronicas"));
    expect(lecturas.every(([s, p]) => String(s).includes("FOR UPDATE") && JSON.stringify(p) === "[7]")).toBe(true);
    const deletes = conn.query.mock.calls.filter(([s]) => String(s).startsWith("DELETE"));
    expect(deletes.map(([, p]) => p)).toEqual([[[70]], [[60]], [[50]], [[40]], [[30]], [[20]], [[10]]]);
  });
  it.each(["En ruta", "Descargado"])("bloquea plan en estado %s", async (estado) => {
    filas.tms_planes_viaje[0].estado = estado;
    await expect(limpiarViajesConjuntos(db, 7)).rejects.toThrow("en proceso");
    expect(conn.query.mock.calls.some(([s]) => String(s).startsWith("DELETE"))).toBe(false);
  });
  it("bloquea viaje abierto y vínculo entre empresas", async () => {
    filas.flota_viajes[0].estado = "abierto";
    await expect(limpiarViajesConjuntos(db, 7)).rejects.toThrow("abiertos");
    filas.flota_viajes[0].empresa_id = 8;
    await expect(limpiarViajesConjuntos(db, 7)).rejects.toThrow("entre empresas");
  });
  it.each(["AUTORIZADO", "ENTREGADO", "LIQUIDADO"])("no borra viáticos %s", async (estado) => {
    filas.tms_viaticos[0].estado = estado;
    await expect(limpiarViaticos(db, 7)).rejects.toThrow("movimientos");
    expect(conn.query.mock.calls.some(([s]) => String(s).startsWith("DELETE"))).toBe(false);
  });
  it("detecta movimientos aun cuando el estado dice PROGRAMADO", () => {
    expect(() => validarViaticos([{ estado: "PROGRAMADO", entregado_en: "2026-08-28" }])).toThrow();
  });
  it("bloquea referencias ajenas antes de cualquier DELETE", async () => {
    referenciaExterna = true;
    await expect(limpiarViajesConjuntos(db, 7)).rejects.toThrow("facturas");
    expect(conn.query.mock.calls.some(([s]) => String(s).startsWith("DELETE"))).toBe(false);
  });
  it.each(["clientes", "operaciones_accesos"])("%s solo desactiva en la empresa elegida", async (modulo) => {
    await desactivarCatalogo(db, 7, modulo);
    expect(conn.execute.mock.calls.length).toBeGreaterThan(0);
    for (const [sql, params] of conn.execute.mock.calls) {
      expect(sql).toContain("WHERE empresa_id = ?");
      expect(sql).toMatch(/^UPDATE/);
      expect(params[1]).toBe(7);
    }
  });
  it("elimina rutas activas e inactivas y sus paradas, sin tocar viajes ni clientes", async () => {
    filas.tms_cliente_rutas = [{ id: 90, empresa_id: 7, activo: 1 }, { id: 91, empresa_id: 7, activo: 0 }];
    filas.tms_cliente_ruta_paradas = [{ id: 92, empresa_id: 7, ruta_id: 90 }];
    await limpiarModuloEmpresa({ empresaId: 7, empresaCodigo: "TEST", modulo: "operaciones_eliminar_rutas", usuario: "admin", usuarioId: 2 });
    const deletes = conn.query.mock.calls.filter(([s]) => String(s).startsWith("DELETE"));
    expect(deletes.map(([s]) => s)).toEqual(["DELETE FROM `tms_cliente_ruta_paradas` WHERE id IN (?)", "DELETE FROM `tms_cliente_rutas` WHERE id IN (?)"]);
    expect(deletes.map(([, p]) => p)).toEqual([[[92]], [[90, 91]]]);
    expect(conn.commit).toHaveBeenCalledOnce();
    expect(registrarAuditoriaTx).toHaveBeenCalledWith(db, expect.objectContaining({ modulo: "operaciones_eliminar_rutas", empresaId: 7 }));
  });
  it("rutas con vínculos externos bloquean todos los borrados", async () => {
    filas.tms_cliente_rutas = [{ id: 90, empresa_id: 7 }];
    referenciaExterna = true;
    await expect(eliminarRutas(db, 7)).rejects.toThrow("vinculados");
    expect(conn.query.mock.calls.some(([s]) => String(s).startsWith("DELETE"))).toBe(false);
  });
  it.each([
    { id: 92, empresa_id: 8, ruta_id: 90 }, { id: 92, empresa_id: 7, ruta_id: 99 },
  ])("bloquea paradas cruzadas o huérfanas %#", async (parada) => {
    filas.tms_cliente_rutas = [{ id: 90, empresa_id: 7 }];
    filas.tms_cliente_ruta_paradas = [parada];
    await expect(eliminarRutas(db, 7)).rejects.toThrow();
    expect(conn.query.mock.calls.some(([s]) => String(s).startsWith("DELETE"))).toBe(false);
  });
  it("revierte paradas borradas si falla el borrado de rutas", async () => {
    filas.tms_cliente_rutas = [{ id: 90, empresa_id: 7 }];
    filas.tms_cliente_ruta_paradas = [{ id: 92, empresa_id: 7, ruta_id: 90 }];
    const normal = conn.query.getMockImplementation()!;
    conn.query.mockImplementation(async (...args) => {
      if (String(args[0]).startsWith("DELETE FROM `tms_cliente_rutas`")) throw new Error("fallo ruta");
      return normal(...args);
    });
    await expect(limpiarModuloEmpresa({ empresaId: 7, empresaCodigo: "TEST", modulo: "operaciones_eliminar_rutas", usuario: "admin", usuarioId: 2 })).rejects.toThrow("fallo ruta");
    expect(conn.rollback).toHaveBeenCalledOnce(); expect(conn.commit).not.toHaveBeenCalled();
  });
  it("no anula multas pagadas ni escribe parcialmente", async () => {
    filas.ops_multas = [{ id: 1, empresa_id: 7, estado: "PENDIENTE", estado_pago: "PAGADA" }];
    await expect(anularMultas(db, 7, 2, "admin")).rejects.toThrow("No se modificó ninguna");
    expect(conn.execute).not.toHaveBeenCalled();
  });
  it("hace rollback completo si falla un DELETE intermedio", async () => {
    const normal = conn.query.getMockImplementation()!;
    conn.query.mockImplementation(async (...args) => {
      if (String(args[0]).startsWith("DELETE FROM `tms_plan_paradas`")) throw new Error("fallo intermedio");
      return normal(...args);
    });
    await expect(limpiarModuloEmpresa({ empresaId: 7, empresaCodigo: "TEST", modulo: "operaciones", usuario: "admin", usuarioId: 2 })).rejects.toThrow("fallo intermedio");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledOnce();
  });
  it("auditoría obligatoria en la misma conexión, sin commit si falla", async () => {
    vi.mocked(registrarAuditoriaTx).mockRejectedValueOnce(new Error("audit"));
    await expect(limpiarModuloEmpresa({ empresaId: 7, empresaCodigo: "TEST", modulo: "operaciones", usuario: "admin", usuarioId: 2 })).rejects.toThrow("audit");
    expect(registrarAuditoriaTx).toHaveBeenCalledWith(db, expect.objectContaining({ empresaId: 7 }));
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
  });
  it("confirma una sola transacción y consulta restantes antes del commit", async () => {
    await limpiarModuloEmpresa({ empresaId: 7, empresaCodigo: "TEST", modulo: "operaciones", usuario: "admin", usuarioId: 2 });
    expect(conn.beginTransaction).toHaveBeenCalledOnce();
    expect(conn.commit).toHaveBeenCalledOnce();
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledOnce();
    expect(Math.max(...conn.query.mock.invocationCallOrder)).toBeLessThan(conn.commit.mock.invocationCallOrder[0]);
  });
  it("falla cerrado si falta una tabla o no admite rollback", async () => {
    conn.query.mockResolvedValueOnce([[{ ENGINE: "MyISAM" }]]);
    await expect(limpiarViajesConjuntos(db, 7)).rejects.toThrow("transaccional");
    expect(conn.execute).not.toHaveBeenCalled();
  });
  it("PRUEBAS permite viajes abiertos y viáticos entregados sin tocar vehículos", async () => {
    filas.tms_planes_viaje[0].estado = "En ruta";
    filas.flota_viajes[0].estado = "abierto";
    filas.tms_viaticos[0].estado = "ENTREGADO";
    await limpiarModuloEmpresa({ empresaId: 7, empresaCodigo: "TEST", modulo: "pruebas_operaciones", usuario: "admin", usuarioId: 2 });
    expect(conn.commit).toHaveBeenCalledOnce();
    expect(conn.query.mock.calls.some(([s]) => String(s).includes("DELETE FROM `flota_vehiculos`"))).toBe(false);
    expect(registrarAuditoriaTx).toHaveBeenCalledWith(db, expect.objectContaining({ modulo: "pruebas_operaciones" }));
  });
  it.each(["AUTORIZADO", "ENTREGADO", "LIQUIDADO"])("PRUEBAS admite viático %s, pero conserva el guard externo", async (estado) => {
    filas.tms_viaticos[0].estado = estado;
    expect((await limpiarViaticos(db, 7, true)).conteos.tms_viaticos).toBe(1);
    referenciaExterna = true;
    await expect(limpiarViaticos(db, 7, true)).rejects.toThrow("facturas");
  });
  it("comprueba FK compuesta como tupla, sin confundir toda la empresa con un vínculo", async () => {
    const normal = conn.query.getMockImplementation()!;
    conn.query.mockImplementation(async (...args) => {
      const sql = String(args[0]);
      if (sql.includes("KEY_COLUMN_USAGE")) return [[
        { tabla: "relacion", restriccion: "fk_compuesta", columna: "empresa_id", destino: "empresa_id", local: 1 },
        { tabla: "relacion", restriccion: "fk_compuesta", columna: "viatico_id", destino: "id", local: 1 },
      ]];
      if (sql.includes("FROM `relacion`")) return [[]];
      return normal(...args);
    });
    await limpiarViaticos(db, 7);
    const consulta = conn.query.mock.calls.find(([s]) => String(s).includes("FROM `relacion`"))!;
    expect(consulta[0]).toContain("`empresa_id` = ? AND `viatico_id` = ?");
    expect(consulta[1]).toEqual([7, 50]);
  });
});

/**
 * ADMIN-LIMPIAR-ARCHIVOS-FISICOS — firmas electrónicas de viáticos
 * (firmas_electronicas, entidad_tipo='VIATICO') y recolección de rutas de
 * archivo, ver docs/LIMPIEZA-TMS-OPERACIONES-REINICIO-2-STORAGE-DISCOVERY.md.
 */
describe("leerFirmasElectronicasViaticos — aislamiento por empresa y por entidad", () => {
  it("no consulta la BD si no hay viáticos (evita un IN () inválido) — nunca borra firmas fuera de la lista", async () => {
    const grupo = await leerFirmasElectronicasViaticos(db, 7, []);
    expect(grupo).toEqual({ tabla: "firmas_electronicas", filas: [] });
    expect(conn.query).not.toHaveBeenCalled();
  });

  it("filtra EXPLÍCITAMENTE por entidad_tipo='VIATICO' y por los IDs de viáticos ya acotados a esta empresa", async () => {
    filas.firmas_electronicas = [{ id: 900, empresa_id: 7, entidad_tipo: "VIATICO", entidad_id: 50, imagen_ruta: "empresas/7/firmas/x.png" }];
    await leerFirmasElectronicasViaticos(db, 7, [50, 51]);
    const [sql, params] = conn.query.mock.calls.find(([s]) => String(s).includes("firmas_electronicas"))!;
    expect(String(sql)).toContain("entidad_tipo = 'VIATICO' AND entidad_id IN (?)");
    expect(String(sql)).toContain("empresa_id = ?");
    expect(params).toEqual([7, [50, 51]]);
  });

  it("firma de un viático de esta empresa SÍ se borra al limpiar viáticos", async () => {
    filas.firmas_electronicas = [{ id: 900, empresa_id: 7, entidad_tipo: "VIATICO", entidad_id: 50, imagen_ruta: "empresas/7/firmas/x.png" }];
    const { conteos } = await limpiarViaticos(db, 7, true);
    expect(conteos.firmas_electronicas).toBe(1);
    const deletes = conn.query.mock.calls.filter(([s]) => String(s).startsWith("DELETE"));
    expect(deletes[0]).toEqual(["DELETE FROM `firmas_electronicas` WHERE id IN (?)", [[900]]]);
  });

  it("una firma de otra entidad_tipo (no VIATICO) queda fuera del WHERE — nunca se solicita su borrado", async () => {
    await limpiarViaticos(db, 7, true);
    const [sql] = conn.query.mock.calls.find(([s]) => String(s).includes("firmas_electronicas"))!;
    // La condición 'VIATICO' está fija en el propio SQL: cualquier fila con
    // otro entidad_tipo (p. ej. una futura firma de MULTA) nunca puede
    // calzar en este WHERE ni ser recolectada por error.
    expect(String(sql)).toMatch(/entidad_tipo = 'VIATICO'/);
  });
});

describe("recolectarRutasArchivo — recolección deduplicada, sin borrar nada", () => {
  it("recolecta ruta_relativa, ruta_archivo e imagen_ruta de distintas tablas", () => {
    const rutas = recolectarRutasArchivo([
      { tabla: "flota_viaje_evidencias", filas: [{ id: 1, ruta_relativa: "empresas/7/flota/a.jpg" }] as never },
      { tabla: "tms_evidencias", filas: [{ id: 2, ruta_archivo: "empresas/7/flota/b.jpg" }] as never },
      { tabla: "firmas_electronicas", filas: [{ id: 3, imagen_ruta: "empresas/7/firmas/c.png" }] as never },
    ]);
    expect([...rutas].sort()).toEqual(["empresas/7/firmas/c.png", "empresas/7/flota/a.jpg", "empresas/7/flota/b.jpg"]);
  });

  it("deduplica la MISMA ruta aunque aparezca en dos tablas distintas (evidencia compartida)", () => {
    const compartida = "empresas/7/flota/viaje_20_llegada_x.jpg";
    const rutas = recolectarRutasArchivo([
      { tabla: "flota_viaje_evidencias", filas: [{ id: 70, ruta_relativa: compartida }] as never },
      { tabla: "tms_evidencias", filas: [{ id: 60, ruta_archivo: compartida }] as never },
    ]);
    expect(rutas.size).toBe(1);
    expect(rutas.has(compartida)).toBe(true);
  });

  it("ignora filas sin ruta (NULL, vacía o de otro tipo) sin lanzar", () => {
    const rutas = recolectarRutasArchivo([
      { tabla: "firmas_electronicas", filas: [{ id: 1, imagen_ruta: null }, { id: 2, imagen_ruta: "" }, { id: 3 }] as never },
    ]);
    expect(rutas.size).toBe(0);
  });
});

describe("limpiarViajesConjuntos/limpiarViaticos — archivos recolectados ANTES de cualquier DELETE", () => {
  it("recolecta rutas de flota_viaje_evidencias, tms_evidencias y firmas de viáticos en un único Set", async () => {
    filas.flota_viaje_evidencias = [{ id: 70, empresa_id: 7, viaje_id: 20, ruta_relativa: "empresas/7/flota/viaje_20_llegada.jpg" }];
    filas.tms_evidencias = [{ id: 60, empresa_id: 7, plan_id: 10, ruta_archivo: "empresas/7/flota/viaje_20_llegada.jpg" }];
    filas.firmas_electronicas = [{ id: 900, empresa_id: 7, entidad_tipo: "VIATICO", entidad_id: 50, imagen_ruta: "empresas/7/firmas/x.png" }];
    const { archivos } = await limpiarViajesConjuntos(db, 7);
    // La evidencia de flota y de TMS comparten el MISMO archivo físico —
    // debe contarse/borrarse una sola vez, no dos.
    expect(archivos.size).toBe(2);
    expect(archivos.has("empresas/7/flota/viaje_20_llegada.jpg")).toBe(true);
    expect(archivos.has("empresas/7/firmas/x.png")).toBe(true);
  });

  it("limpiarViaticos también expone las rutas de firma recolectadas", async () => {
    filas.firmas_electronicas = [{ id: 900, empresa_id: 7, entidad_tipo: "VIATICO", entidad_id: 50, imagen_ruta: "empresas/7/firmas/y.png" }];
    const { archivos } = await limpiarViaticos(db, 7, true);
    expect([...archivos]).toEqual(["empresas/7/firmas/y.png"]);
  });

  it("sin viáticos en la empresa, no hay rutas de firma que recolectar ni consulta a firmas_electronicas", async () => {
    filas.tms_viaticos = [];
    const { archivos } = await limpiarViaticos(db, 7, true);
    expect(archivos.size).toBe(0);
    expect(conn.query.mock.calls.some(([s]) => String(s).includes("firmas_electronicas"))).toBe(false);
  });
});
