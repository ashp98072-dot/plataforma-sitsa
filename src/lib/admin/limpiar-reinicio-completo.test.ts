import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolConnection } from "mysql2/promise";

vi.mock("@/lib/db", () => ({ getPool: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
// ADMIN-LIMPIAR-ARCHIVOS-FISICOS — mockeado explícitamente: estos tests
// verifican CUÁNDO se llama (nunca antes del commit) y CÓMO se propaga su
// resultado, nunca deben tocar el filesystem real (ver limpiar-archivos.test.ts
// para el comportamiento real de borrado con un directorio temporal).
vi.mock("@/lib/admin/limpiar-archivos", () => ({ borrarArchivosFisicos: vi.fn() }));

import { getPool } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { borrarArchivosFisicos } from "./limpiar-archivos";
import { limpiarModuloEmpresa } from "./limpiar-modulo";
import {
  limpiarFacturacion,
  limpiarSolicitudesCliente,
  limpiarCatalogosTms,
} from "./limpiar-operaciones";

/**
 * LIMPIEZA-TMS-OPERACIONES-REINICIO-1 — tests del modo compuesto
 * "pruebas_reinicio_completo" (facturación + solicitudes/portal +
 * operaciones + rutas + clientes + catálogos TMS, en una sola
 * transacción). Mismo arnés de mocks ya usado en
 * limpiar-operaciones.test.ts/limpiar-pruebas.test.ts — `filas` por
 * tabla, `conn.query` genérico que resuelve `SELECT *` por el nombre de
 * tabla después de `FROM`.
 */

const conn = { query: vi.fn(), execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
const db = conn as unknown as PoolConnection;
let filas: Record<string, Record<string, unknown>[]>;

const borradas = () => conn.query.mock.calls.filter(([s]) => String(s).startsWith("DELETE"));
const tablaDe = (sql: string) => sql.match(/FROM `([^`]+)`/)?.[1] ?? sql.match(/DELETE FROM `([^`]+)`/)?.[1];
const ordenTablas = () => borradas().map(([s]) => tablaDe(String(s)));

/**
 * Datos completos: cada tabla del flujo tiene al menos una fila real
 * (vinculada por id de forma coherente), para que el test de orden
 * ejercite un DELETE real en cada paso — una tabla vacía no genera
 * ningún DELETE (borrarGrupos no itera un arreglo vacío), así que
 * dejarla vacía haría el test de orden inconcluyente para ese paso.
 */
function datosCompletos() {
  filas = {
    fact_pagos: [{ id: 1, empresa_id: 7, factura_id: 100 }],
    fact_factura_viajes: [{ id: 2, factura_id: 100, plan_id: 10 }],
    fact_facturas: [{ id: 100, empresa_id: 7, cliente_id: 600 }],
    fact_cliente_perfil: [{ id: 150, empresa_id: 7, cliente_id: 600 }],
    tms_solicitud_paradas: [{ id: 3, empresa_id: 7, solicitud_id: 300 }],
    tms_solicitudes_cliente: [{ id: 300, empresa_id: 7, plan_id: 10, creado_por_usuario_cliente_id: 400 }],
    tms_planes_viaje: [{ id: 10, empresa_id: 7, estado: "Programado" }],
    flota_viajes: [{ id: 20, empresa_id: 7, plan_id: 10, estado: "cerrado" }],
    tms_plan_paradas: [{ id: 30, empresa_id: 7, plan_id: 10 }],
    tms_plan_auxiliares: [{ id: 40, empresa_id: 7, plan_id: 10 }],
    tms_viaticos: [{ id: 50, empresa_id: 7, plan_id: 10, estado: "PROGRAMADO" }],
    // ADMIN-LIMPIAR-ARCHIVOS-FISICOS — firma de autorización del viático
    // #50, vínculo polimórfico sin FK real (entidad_tipo/entidad_id).
    firmas_electronicas: [{ id: 950, empresa_id: 7, entidad_tipo: "VIATICO", entidad_id: 50, imagen_ruta: "empresas/7/firmas/firma_viatico_autorizar_50.png" }],
    tms_evidencias: [{ id: 60, empresa_id: 7, plan_id: 10 }],
    flota_viaje_evidencias: [{ id: 70, empresa_id: 7, viaje_id: 20 }],
    flota_lecturas: [{ id: 80, empresa_id: 7, viaje_id: 20 }],
    tms_cliente_ruta_paradas: [{ id: 90, empresa_id: 7, ruta_id: 500 }],
    tms_cliente_rutas: [{ id: 500, empresa_id: 7 }],
    tms_cliente_contactos: [],
    tms_cliente_ubicaciones: [],
    tms_cliente_usuarios: [{ id: 400, empresa_id: 7, cliente_id: 200 }],
    tms_clientes: [{ id: 200, empresa_id: 7 }],
    clientes: [{ id: 600, empresa_id: 7, tms_cliente_id: 200 }],
    tms_personal: [{ id: 700, empresa_id: 7 }],
    tms_unidades: [{ id: 800, empresa_id: 7 }],
    tms_lugares: [{ id: 900, empresa_id: 7 }],
  };
}

const ejecutarReinicio = () =>
  limpiarModuloEmpresa({ empresaId: 7, empresaCodigo: "TEST", modulo: "pruebas_reinicio_completo", usuario: "admin", usuarioId: 2 });

beforeEach(() => {
  vi.resetAllMocks();
  datosCompletos();
  conn.query.mockImplementation(async (sql: string) => {
    if (sql.includes("information_schema.TABLES")) return [[{ ENGINE: "InnoDB" }]];
    if (sql.includes("information_schema.tables")) return [[{ ok: 1 }]];
    if (sql.includes("KEY_COLUMN_USAGE")) return [[]];
    if (sql.includes("information_schema.COLUMNS")) return [[]];
    if (sql.startsWith("SELECT id, empresa_id FROM tms_clientes")) return [[]];
    if (sql.startsWith("SELECT id FROM tms_cliente_")) return [[]];
    if (sql.startsWith("SELECT *")) return [filas[tablaDe(sql)!] ?? []];
    if (sql.startsWith("SELECT COUNT")) return [[{ n: 0 }]];
    if (sql.startsWith("DELETE")) return [{ affectedRows: 1 }];
    throw new Error(`Consulta inesperada: ${sql}`);
  });
  conn.execute.mockResolvedValue([{ affectedRows: 1 }]);
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(db) } as unknown as ReturnType<typeof getPool>);
  vi.mocked(borrarArchivosFisicos).mockResolvedValue({ detectados: 0, eliminados: 0, noEncontrados: 0, conError: 0, advertencias: [] });
});

describe("pruebas_reinicio_completo — orden y alcance", () => {
  it("1) borra en el orden correcto: facturación -> solicitudes -> operaciones -> rutas -> clientes -> catálogos TMS", async () => {
    await ejecutarReinicio();
    expect(ordenTablas()).toEqual([
      // Facturación
      "fact_pagos",
      "fact_factura_viajes",
      "fact_facturas",
      // Solicitudes del Portal del Cliente
      "tms_solicitud_paradas",
      "tms_solicitudes_cliente",
      // Operaciones/TMS (limpiarViajesConjuntos, modo pruebas)
      "flota_viaje_evidencias",
      "tms_evidencias",
      "flota_lecturas",
      "firmas_electronicas",
      "tms_viaticos",
      "tms_plan_auxiliares",
      "tms_plan_paradas",
      "flota_viajes",
      "tms_planes_viaje",
      // Rutas
      "tms_cliente_ruta_paradas",
      "tms_cliente_rutas",
      // Clientes (limpiarClientesPrueba extendido)
      "fact_cliente_perfil",
      "tms_cliente_usuarios",
      "clientes",
      "tms_clientes",
      // Catálogos TMS
      "tms_personal",
      "tms_unidades",
      "tms_lugares",
    ]);
    expect(conn.commit).toHaveBeenCalledOnce();
    expect(conn.rollback).not.toHaveBeenCalled();
  });

  it("2) facturación se borra ANTES que operaciones (plan) y que clientes", async () => {
    await ejecutarReinicio();
    const orden = ordenTablas();
    const idxFacturas = orden.indexOf("fact_facturas");
    const idxPlan = orden.indexOf("tms_planes_viaje");
    const idxClientes = orden.indexOf("clientes");
    expect(idxFacturas).toBeGreaterThanOrEqual(0);
    expect(idxFacturas).toBeLessThan(idxPlan);
    expect(idxFacturas).toBeLessThan(idxClientes);
  });

  it("3) el usuario del Portal del Cliente (tms_cliente_usuarios) se borra junto con el cliente, no antes de liberar sus solicitudes", async () => {
    await ejecutarReinicio();
    const orden = ordenTablas();
    const idxSolicitudes = orden.indexOf("tms_solicitudes_cliente");
    const idxUsuarioPortal = orden.indexOf("tms_cliente_usuarios");
    const idxClientes = orden.indexOf("clientes");
    // La solicitud (que RESTRICT hacia tms_cliente_usuarios) se libera antes.
    expect(idxSolicitudes).toBeLessThan(idxUsuarioPortal);
    // El usuario de portal se borra junto al bloque de clientes, antes de clientes/tms_clientes.
    expect(idxUsuarioPortal).toBeLessThan(idxClientes);

    const [, paramsUsuario] = borradas().find(([s]) => tablaDe(String(s)) === "tms_cliente_usuarios")!;
    expect(paramsUsuario).toEqual([[400]]);
  });

  it("4) tms_personal/tms_unidades/tms_lugares SOLO se borran en modo completo, nunca en pruebas_operaciones ni pruebas_clientes", async () => {
    await limpiarModuloEmpresa({ empresaId: 7, empresaCodigo: "TEST", modulo: "pruebas_operaciones", usuario: "admin", usuarioId: 2 });
    expect(borradas().some(([s]) => ["tms_personal", "tms_unidades", "tms_lugares"].includes(String(tablaDe(String(s)))))).toBe(false);

    conn.query.mockClear();
    await limpiarModuloEmpresa({ empresaId: 7, empresaCodigo: "TEST", modulo: "pruebas_clientes", usuario: "admin", usuarioId: 2 });
    expect(borradas().some(([s]) => ["tms_personal", "tms_unidades", "tms_lugares"].includes(String(tablaDe(String(s)))))).toBe(false);

    conn.query.mockClear();
    await ejecutarReinicio();
    const orden = ordenTablas();
    expect(orden).toContain("tms_personal");
    expect(orden).toContain("tms_unidades");
    expect(orden).toContain("tms_lugares");
  });

  it("5) empleados (RRHH) NUNCA se borran ni se consultan para DELETE", async () => {
    await ejecutarReinicio();
    expect(borradas().some(([s]) => String(s).includes("empleados"))).toBe(false);
  });

  it("6) flota_vehiculos NUNCA se borran ni se consultan para DELETE", async () => {
    await ejecutarReinicio();
    expect(borradas().some(([s]) => String(s).includes("flota_vehiculos"))).toBe(false);
  });

  it("7) usuarios globales del sistema (tabla `usuarios`) nunca se tocan — solo tms_cliente_usuarios (portal, distinto)", async () => {
    await ejecutarReinicio();
    expect(borradas().some(([s]) => String(s).match(/DELETE FROM `usuarios`/))).toBe(false);
    // Confirma que sí se tocó la tabla del portal (para no dar un falso positivo por escribir mal el nombre).
    expect(borradas().some(([s]) => tablaDe(String(s)) === "tms_cliente_usuarios")).toBe(true);
  });

  it("8) rollback completo si falla un DELETE intermedio (facturación ya aplicada)", async () => {
    const normal = conn.query.getMockImplementation()!;
    conn.query.mockImplementation(async (...args) => {
      if (String(args[0]).startsWith("DELETE FROM `tms_planes_viaje`")) throw new Error("fallo intermedio reinicio");
      return normal(...args);
    });
    await expect(ejecutarReinicio()).rejects.toThrow("fallo intermedio reinicio");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledOnce();
    // La auditoría tampoco debe registrarse si la transacción no llegó a comprometerse.
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
  });

  it("9) aislamiento por empresa: un registro de otra empresa hace fallar y revertir TODO el reinicio (transacción única)", async () => {
    filas.tms_planes_viaje[0].empresa_id = 8;
    await expect(ejecutarReinicio()).rejects.toThrow("entre empresas");
    // Facturación/solicitudes corren ANTES que operaciones en el orden
    // compuesto, así que sus DELETE ya se emitieron dentro de la MISMA
    // transacción cuando el paso de operaciones detecta el vínculo
    // cruzado — la garantía real no es "cero DELETE emitidos", es que
    // ninguno queda comprometido: rollback total, nunca commit.
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
  });

  it("10) una referencia externa real (no contemplada en ningún grupo) bloquea el paso correspondiente sin borrar nada", async () => {
    // Simula que una tabla ajena (no incluida en ningún grupo de la
    // limpieza) todavía referencia fact_facturas — debe bloquear ANTES
    // de llegar a cualquier paso posterior (solicitudes/operaciones/
    // rutas/clientes/catálogos).
    const normal = conn.query.getMockImplementation()!;
    conn.query.mockImplementation(async (...args) => {
      const sql = String(args[0]);
      const params = args[1] as string[] | undefined;
      if (sql.includes("KEY_COLUMN_USAGE") && params?.[0] === "fact_facturas") {
        return [[{ tabla: "cont_cxc", columna: "factura_id", destino: "id" }]];
      }
      if (sql.includes("FROM `cont_cxc`")) return [[{ factura_id: 100 }]];
      return normal(...args);
    });
    await expect(ejecutarReinicio()).rejects.toThrow("cont_cxc");
    expect(borradas()).toHaveLength(0);
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("auditoría registra el módulo compuesto con el resultado combinado de todos los pasos", async () => {
    await ejecutarReinicio();
    expect(registrarAuditoriaTx).toHaveBeenCalledWith(
      db,
      expect.objectContaining({ modulo: "pruebas_reinicio_completo", empresaId: 7 }),
    );
    const [, detalle] = vi.mocked(registrarAuditoriaTx).mock.calls[0];
    expect(detalle.detalle).toContain("fact_pagos");
    expect(detalle.detalle).toContain("tms_personal");
  });
});

/**
 * ADMIN-LIMPIAR-ARCHIVOS-FISICOS — el borrado físico post-commit
 * (borrarArchivosFisicos) está mockeado en este archivo (nunca toca el
 * filesystem real, ver arriba); estos tests verifican el CONTRATO de
 * cuándo/con qué se llama, no su comportamiento interno de E/S (eso vive
 * en limpiar-archivos.test.ts).
 */
describe("pruebas_reinicio_completo — borrado físico post-commit", () => {
  it("11) los archivos se eliminan SOLO después de conn.commit() — nunca antes", async () => {
    await ejecutarReinicio();
    expect(conn.commit).toHaveBeenCalledOnce();
    expect(borrarArchivosFisicos).toHaveBeenCalledOnce();
    expect(conn.commit.mock.invocationCallOrder[0]).toBeLessThan(
      vi.mocked(borrarArchivosFisicos).mock.invocationCallOrder[0],
    );
  });

  it("recolecta y pasa la ruta de la firma de viático detectada (deduplicada) a borrarArchivosFisicos", async () => {
    await ejecutarReinicio();
    const [empresaId, rutas] = vi.mocked(borrarArchivosFisicos).mock.calls[0];
    expect(empresaId).toBe(7);
    expect([...(rutas as Set<string>)]).toEqual(["empresas/7/firmas/firma_viatico_autorizar_50.png"]);
  });

  it("10) si el rollback ocurre (fallo intermedio en BD), NINGÚN archivo físico se intenta eliminar", async () => {
    const normal = conn.query.getMockImplementation()!;
    conn.query.mockImplementation(async (...args) => {
      if (String(args[0]).startsWith("DELETE FROM `tms_planes_viaje`")) throw new Error("fallo intermedio reinicio");
      return normal(...args);
    });
    await expect(ejecutarReinicio()).rejects.toThrow("fallo intermedio reinicio");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(borrarArchivosFisicos).not.toHaveBeenCalled();
  });

  it("12/13) un archivo inexistente o un error de E/S se reportan como advertencia — la BD ya quedó comprometida (commit) y NO se revierte", async () => {
    vi.mocked(borrarArchivosFisicos).mockResolvedValue({
      detectados: 2,
      eliminados: 1,
      noEncontrados: 0,
      conError: 1,
      advertencias: ["No se pudo eliminar empresas/7/firmas/firma_viatico_autorizar_50.png: EACCES"],
    });
    const resultado = await ejecutarReinicio();
    expect(conn.commit).toHaveBeenCalledOnce();
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(resultado.archivos).toEqual({
      detectados: 2,
      eliminados: 1,
      noEncontrados: 0,
      conError: 1,
      advertencias: ["No se pudo eliminar empresas/7/firmas/firma_viatico_autorizar_50.png: EACCES"],
    });
  });

  it("un archivo no encontrado no es un error ni bloquea el resultado", async () => {
    vi.mocked(borrarArchivosFisicos).mockResolvedValue({
      detectados: 1, eliminados: 0, noEncontrados: 1, conError: 0, advertencias: [],
    });
    const resultado = await ejecutarReinicio();
    expect(resultado.archivos?.conError).toBe(0);
    expect(resultado.archivos?.noEncontrados).toBe(1);
  });

  it("otros módulos (pruebas_operaciones) nunca disparan el borrado físico automático — solo pruebas_reinicio_completo", async () => {
    await limpiarModuloEmpresa({ empresaId: 7, empresaCodigo: "TEST", modulo: "pruebas_operaciones", usuario: "admin", usuarioId: 2 });
    expect(borrarArchivosFisicos).not.toHaveBeenCalled();
  });
});

describe("limpiarFacturacion — funciones nuevas en aislamiento", () => {
  it("borra pagos, líneas y facturas en ese orden", async () => {
    const out = await limpiarFacturacion(db, 7);
    expect(Object.keys(out)).toEqual(["fact_pagos", "fact_factura_viajes", "fact_facturas"]);
    expect(ordenTablas()).toEqual(["fact_pagos", "fact_factura_viajes", "fact_facturas"]);
  });

  it("aísla por empresa: la consulta de fact_factura_viajes se resuelve por subconsulta contra fact_facturas de esta empresa", async () => {
    await limpiarFacturacion(db, 7);
    const lectura = conn.query.mock.calls.find(([s]) => String(s).startsWith("SELECT * FROM `fact_factura_viajes`"))!;
    expect(lectura[0]).toContain("factura_id IN (SELECT id FROM fact_facturas WHERE empresa_id = ?)");
    expect(lectura[1]).toEqual([7]);
  });
});

describe("limpiarSolicitudesCliente — funciones nuevas en aislamiento", () => {
  it("borra paradas antes que la solicitud", async () => {
    const out = await limpiarSolicitudesCliente(db, 7);
    expect(Object.keys(out)).toEqual(["tms_solicitud_paradas", "tms_solicitudes_cliente"]);
  });
});

describe("limpiarCatalogosTms — funciones nuevas en aislamiento", () => {
  it("borra personal, unidades y lugares, aislado por empresa", async () => {
    const out = await limpiarCatalogosTms(db, 7);
    expect(Object.keys(out)).toEqual(["tms_personal", "tms_unidades", "tms_lugares"]);
    for (const [sql, params] of conn.query.mock.calls.filter(([s]) => String(s).startsWith("SELECT *"))) {
      expect(params).toEqual([7]);
      void sql;
    }
  });

  it("nunca genera ninguna consulta hacia empleados ni flota_vehiculos", async () => {
    await limpiarCatalogosTms(db, 7);
    expect(conn.query.mock.calls.some(([s]) => String(s).includes("empleados") || String(s).includes("flota_vehiculos"))).toBe(false);
  });
});
