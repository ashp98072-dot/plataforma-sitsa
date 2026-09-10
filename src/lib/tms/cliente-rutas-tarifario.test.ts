import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn(), execute: vi.fn() }));
import { getPool, query } from "@/lib/db";
import { actualizarRuta, crearRuta, listarHistorialTarifas, type ActorRuta } from "./cliente-rutas";

/**
 * RUTAS-TARIFARIO-HISTORIAL-1 — tests targeted del historial de tarifas
 * (tms_cliente_ruta_tarifas) y de las validaciones de pertenencia
 * (§12 del ticket) que crearRuta/actualizarRuta ahora hacen. Mismo
 * patrón de mock que cliente-rutas-transaccion.test.ts (conn.query/
 * conn.execute branchean por substring de SQL).
 */

const ACTOR: ActorRuta = { usuarioId: 9, nombre: "Heber Sitan" };

function filaRutaActual(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 44, cliente_id: 5, cliente_nombre: "Acme", codigo: "1001", nombre: null,
    ubicacion_carga_id: null, lugar_carga_texto: "Bodega", destino_descripcion: "Destino",
    hora_habitual: "08:00", tarifa_referencia: null, contacto_cliente_id: null,
    contacto_nombre: null, contacto_cargo: null, contacto_telefono: null, observaciones: null,
    activo: 1, creado_en: "", actualizado_en: "",
    ...overrides,
  };
}

function conexion(opts: {
  fallaEn?: string;
  clienteEnEmpresa?: boolean;
  contactoValido?: boolean;
  ubicacionValida?: boolean;
  rutaActual?: Record<string, unknown>;
} = {}) {
  const clienteEnEmpresa = opts.clienteEnEmpresa ?? true;
  const contactoValido = opts.contactoValido ?? true;
  const ubicacionValida = opts.ubicacionValida ?? true;
  const conn = {
    beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(),
    query: vi.fn(async (sql: string) => {
      if (sql.includes("FROM tms_cliente_rutas r")) return [[filaRutaActual(opts.rutaActual)]];
      if (sql.includes("FROM tms_cliente_rutas WHERE empresa_id")) return [[]]; // código no duplicado
      if (sql.includes("FROM tms_clientes")) return [clienteEnEmpresa ? [{ id: 5 }] : []];
      if (sql.includes("FROM tms_cliente_contactos")) return [contactoValido ? [{ id: 1 }] : []];
      if (sql.includes("FROM tms_cliente_ubicaciones")) return [ubicacionValida ? [{ id: 1, nombre: "Bodega Central" }] : []];
      if (sql.includes("FROM empleados")) return [[]];
      return [[]];
    }),
    execute: vi.fn(async (...args: [string, ...unknown[]]) => {
      const sql = args[0];
      if (opts.fallaEn && sql.includes(opts.fallaEn)) throw new Error(`fallo:${opts.fallaEn}`);
      if (sql.includes("INSERT INTO tms_cliente_rutas")) return [{ insertId: 44, affectedRows: 1 }];
      return [{ insertId: 0, affectedRows: 1 }];
    }),
  };
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conn) } as never);
  return conn;
}

beforeEach(() => vi.resetAllMocks());

describe("crearRuta — tarifa inicial genera historial (§1/§2 del ticket)", () => {
  it("con tarifa: inserta una fila en tms_cliente_ruta_tarifas con el actor real", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([filaRutaActual({ tarifa_referencia: 1500 })] as never);
    await crearRuta(7, {
      clienteId: 5, codigo: "1001", tarifaReferencia: 1500, tarifaVigenteDesde: "2026-04-01", paradas: [],
    } as never, ACTOR);
    const insertHistorial = conn.execute.mock.calls.find((c) => (c[0] as string).includes("INSERT INTO tms_cliente_ruta_tarifas"));
    expect(insertHistorial).toBeDefined();
    expect(insertHistorial?.[1]).toEqual([7, 44, 1500, "2026-04-01", "Tarifa inicial", 9, "Heber Sitan"]);
  });

  it("sin tarifa: NO inserta historial (tarifa NOT NULL en la tabla, nada que registrar)", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([filaRutaActual()] as never);
    await crearRuta(7, { clienteId: 5, codigo: "1001", paradas: [] } as never, ACTOR);
    expect(conn.execute.mock.calls.some((c) => (c[0] as string).includes("INSERT INTO tms_cliente_ruta_tarifas"))).toBe(false);
  });

  it("motivo explícito del caller reemplaza el default 'Tarifa inicial'", async () => {
    const conn = conexion();
    vi.mocked(query).mockResolvedValue([filaRutaActual({ tarifa_referencia: 1500 })] as never);
    await crearRuta(7, {
      clienteId: 5, codigo: "1001", tarifaReferencia: 1500, tarifaMotivo: "Tarifa pactada con el cliente", paradas: [],
    } as never, ACTOR);
    const insertHistorial = conn.execute.mock.calls.find((c) => (c[0] as string).includes("INSERT INTO tms_cliente_ruta_tarifas"));
    expect((insertHistorial?.[1] as unknown[])?.[4]).toBe("Tarifa pactada con el cliente");
  });
});

describe("actualizarRuta — cambio de tarifa (§2/§3/§5 del ticket)", () => {
  it("cambia la tarifa: actualiza tarifa_referencia Y crea una nueva entrada de historial, en la MISMA transacción", async () => {
    const conn = conexion({ rutaActual: { tarifa_referencia: 1500 } });
    vi.mocked(query).mockResolvedValue([filaRutaActual({ tarifa_referencia: 1650 })] as never);
    await actualizarRuta(7, 44, { tarifaReferencia: 1650, tarifaMotivo: "Ajuste septiembre", tarifaVigenteDesde: "2026-09-09" }, ACTOR);
    const updateCabecera = conn.execute.mock.calls.find((c) => (c[0] as string).includes("UPDATE tms_cliente_rutas"));
    expect(updateCabecera).toBeDefined();
    const insertHistorial = conn.execute.mock.calls.find((c) => (c[0] as string).includes("INSERT INTO tms_cliente_ruta_tarifas"));
    expect(insertHistorial?.[1]).toEqual([7, 44, 1650, "2026-09-09", "Ajuste septiembre", 9, "Heber Sitan"]);
    expect(conn.commit).toHaveBeenCalledOnce();
  });

  it("guardar SIN cambiar la tarifa (mismo valor reenviado) — NO duplica entrada en el historial", async () => {
    const conn = conexion({ rutaActual: { tarifa_referencia: 1500 } });
    vi.mocked(query).mockResolvedValue([filaRutaActual({ tarifa_referencia: 1500 })] as never);
    await actualizarRuta(7, 44, { tarifaReferencia: 1500 }, ACTOR);
    expect(conn.execute.mock.calls.some((c) => (c[0] as string).includes("INSERT INTO tms_cliente_ruta_tarifas"))).toBe(false);
  });

  it("guardar sin tocar tarifaReferencia en absoluto — no exige motivo ni toca el historial", async () => {
    const conn = conexion({ rutaActual: { tarifa_referencia: 1500 } });
    vi.mocked(query).mockResolvedValue([filaRutaActual({ tarifa_referencia: 1500 })] as never);
    await actualizarRuta(7, 44, { observaciones: "Solo cambio esto" }, ACTOR);
    expect(conn.execute.mock.calls.some((c) => (c[0] as string).includes("INSERT INTO tms_cliente_ruta_tarifas"))).toBe(false);
    expect(conn.commit).toHaveBeenCalledOnce();
  });

  it("§5: motivo OBLIGATORIO cuando ya existía una tarifa anterior — rechaza sin tocar la base de datos", async () => {
    const conn = conexion({ rutaActual: { tarifa_referencia: 1500 } });
    await expect(actualizarRuta(7, 44, { tarifaReferencia: 1650 }, ACTOR))
      .rejects.toThrow("El motivo del cambio de tarifa es obligatorio cuando ya existe una tarifa anterior.");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.execute.mock.calls.some((c) => (c[0] as string).includes("UPDATE tms_cliente_rutas"))).toBe(false);
  });

  it("primera tarifa de una ruta que nunca tuvo una (actual null): NO exige motivo", async () => {
    const conn = conexion({ rutaActual: { tarifa_referencia: null } });
    vi.mocked(query).mockResolvedValue([filaRutaActual({ tarifa_referencia: 1500 })] as never);
    await actualizarRuta(7, 44, { tarifaReferencia: 1500 }, ACTOR);
    expect(conn.commit).toHaveBeenCalledOnce();
    const insertHistorial = conn.execute.mock.calls.find((c) => (c[0] as string).includes("INSERT INTO tms_cliente_ruta_tarifas"));
    expect(insertHistorial).toBeDefined();
  });

  it("ROLLBACK: si falla el INSERT del historial, la tarifa actual NO cambia (revierte encabezado incluido)", async () => {
    const conn = conexion({ rutaActual: { tarifa_referencia: null }, fallaEn: "INSERT INTO tms_cliente_ruta_tarifas" });
    await expect(actualizarRuta(7, 44, { tarifaReferencia: 1500 }, ACTOR)).rejects.toThrow("fallo:INSERT INTO tms_cliente_ruta_tarifas");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
  });
});

describe("RUTAS-TARIFARIO-MULTIPLE-UNIDAD-RECURRENTE-1 (§5) — unidad recurrente por empresa", () => {
  it("crearRuta rechaza una unidad recurrente que no es de la flota de esta empresa", async () => {
    // El mock de conexion() devuelve [] para "FROM flota_vehiculos" -> no pertenece.
    const conn = conexion();
    await expect(
      crearRuta(7, { clienteId: 5, codigo: "1001", unidadRecurrenteId: 999, paradas: [] } as never, ACTOR),
    ).rejects.toThrow(/flota de esta empresa/i);
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.execute.mock.calls.some((c) => (c[0] as string).includes("INSERT INTO tms_cliente_rutas"))).toBe(false);
  });

  it("actualizarRuta con unidadRecurrenteId = null la quita sin validar", async () => {
    const conn = conexion({ rutaActual: { tarifa_referencia: null } });
    vi.mocked(query).mockResolvedValue([filaRutaActual()] as never);
    await actualizarRuta(7, 44, { unidadRecurrenteId: null }, ACTOR);
    const update = conn.execute.mock.calls.find((c) => (c[0] as string).includes("UPDATE tms_cliente_rutas"));
    expect(update).toBeDefined();
    expect(conn.commit).toHaveBeenCalledOnce();
  });
});

describe("listarHistorialTarifas — orden descendente (§4 del ticket)", () => {
  it("pide el historial ordenado por vigente_desde DESC, id DESC", async () => {
    vi.mocked(query).mockResolvedValue([
      { id: 3, tarifa: "1650.00", moneda: "GTQ", vigente_desde: "2026-09-09", motivo: "Ajuste septiembre", usuario_id: 9, usuario_nombre: "Heber Sitan", creado_en: "2026-09-09 10:00:00" },
      { id: 2, tarifa: "1550.00", moneda: "GTQ", vigente_desde: "2026-07-15", motivo: "Tarifa anterior", usuario_id: 8, usuario_nombre: "Walter Villagran", creado_en: "2026-07-15 09:00:00" },
      { id: 1, tarifa: "1500.00", moneda: "GTQ", vigente_desde: "2026-04-01", motivo: "Tarifa inicial", usuario_id: 8, usuario_nombre: "Walter Villagran", creado_en: "2026-04-01 09:00:00" },
    ] as never);
    const historial = await listarHistorialTarifas(7, 44);
    const sql = vi.mocked(query).mock.calls[0][0] as string;
    expect(sql).toContain("ORDER BY vigente_desde DESC, id DESC");
    expect(historial.map((h) => h.tarifa)).toEqual([1650, 1550, 1500]);
    expect(historial[0].usuarioNombre).toBe("Heber Sitan");
  });
});

/** §12 del ticket — "Validar explícitamente": cliente/contacto/ubicación pertenecen a esta empresa (nunca a otra), antes de escribir nada. */
describe("crearRuta/actualizarRuta — aislamiento multiempresa (§12 del ticket)", () => {
  it("rechaza un clienteId que no pertenece a esta empresa, sin escribir nada", async () => {
    const conn = conexion({ clienteEnEmpresa: false });
    await expect(crearRuta(7, { clienteId: 999, codigo: "1001", paradas: [] } as never))
      .rejects.toThrow("El cliente indicado no pertenece a esta empresa.");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.execute.mock.calls.some((c) => (c[0] as string).includes("INSERT INTO tms_cliente_rutas"))).toBe(false);
  });

  it("rechaza un contactoClienteId que no pertenece a ese cliente, sin escribir nada", async () => {
    const conn = conexion({ contactoValido: false });
    await expect(crearRuta(7, { clienteId: 5, codigo: "1001", contactoClienteId: 999, paradas: [] } as never))
      .rejects.toThrow("El contacto indicado no pertenece a este cliente.");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("rechaza una ubicacionCargaId que no pertenece a esta empresa, sin escribir nada", async () => {
    const conn = conexion({ ubicacionValida: false });
    await expect(crearRuta(7, { clienteId: 5, codigo: "1001", ubicacionCargaId: 999, paradas: [] } as never))
      .rejects.toThrow("La ubicación de carga indicada no pertenece a esta empresa.");
    expect(conn.rollback).toHaveBeenCalledOnce();
  });

  it("actualizarRuta rechaza reasignar un contactoClienteId de otro cliente/empresa", async () => {
    const conn = conexion({ contactoValido: false, rutaActual: { tarifa_referencia: null } });
    await expect(actualizarRuta(7, 44, { contactoClienteId: 999 })).rejects.toThrow("El contacto indicado no pertenece a este cliente.");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("actualizarRuta rechaza reasignar una ubicacionCargaId de otra empresa", async () => {
    const conn = conexion({ ubicacionValida: false, rutaActual: { tarifa_referencia: null } });
    await expect(actualizarRuta(7, 44, { ubicacionCargaId: 999 })).rejects.toThrow("La ubicación de carga indicada no pertenece a esta empresa.");
    expect(conn.rollback).toHaveBeenCalledOnce();
  });

  it("paradas: rechaza una clienteUbicacionId de otra empresa dentro de una parada, sin escribir nada", async () => {
    const conn = conexion({ ubicacionValida: false, rutaActual: { tarifa_referencia: null } });
    await expect(actualizarRuta(7, 44, { paradas: [{ lugarNombre: "X", clienteUbicacionId: 999 }] }))
      .rejects.toThrow("La ubicación de carga indicada no pertenece a esta empresa.");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.execute.mock.calls.some((c) => (c[0] as string).includes("INSERT INTO tms_cliente_ruta_paradas"))).toBe(false);
  });
});

describe("crearRuta/actualizarRuta — personal habitual (§9/§12 del ticket)", () => {
  it("rechaza el MISMO empleado como piloto y auxiliar a la vez (piloto duplicado como auxiliar)", async () => {
    const conn = conexion();
    await expect(crearRuta(7, {
      clienteId: 5, codigo: "1001", paradas: [],
      personalPredeterminado: [
        { empleadoId: 10, rol: "Piloto" as const },
        { empleadoId: 10, rol: "Auxiliar" as const },
      ],
    } as never)).rejects.toThrow("No repitas al mismo empleado en la ruta.");
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("rechaza más de 8 auxiliares aunque no haya piloto (el tope de auxiliares es propio, no solo 'total <= 9')", async () => {
    const conn = conexion();
    const auxiliares = Array.from({ length: 9 }, (_, i) => ({ empleadoId: i + 1, rol: "Auxiliar" as const }));
    await expect(crearRuta(7, { clienteId: 5, codigo: "1001", paradas: [], personalPredeterminado: auxiliares } as never))
      .rejects.toThrow("Una ruta admite como máximo 8 auxiliares.");
    expect(conn.commit).not.toHaveBeenCalled();
  });
});

describe("RUTAS-TARIFARIO-HISTORIAL-1 — snapshots de viajes ya creados (§13 del ticket)", () => {
  it("crearRuta/actualizarRuta NUNCA tocan tms_planes_viaje ni ninguna tabla de viajes", async () => {
    const conn = conexion({ rutaActual: { tarifa_referencia: null } });
    vi.mocked(query).mockResolvedValue([filaRutaActual({ tarifa_referencia: 1500 })] as never);
    await crearRuta(7, { clienteId: 5, codigo: "1001", tarifaReferencia: 1500, paradas: [] } as never, ACTOR);
    await actualizarRuta(7, 44, { tarifaReferencia: 1600, tarifaMotivo: "Ajuste" }, ACTOR);
    for (const call of conn.execute.mock.calls) {
      expect(String(call[0])).not.toContain("tms_planes_viaje");
    }
  });
});
