import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * RRHH-INVENTARIO-CAMBIOS-1 — registrarDevolucion / registrarCambio.
 * Fake in-memory de las 3 tablas involucradas (inventario_rrhh,
 * inventario_rrhh_entregas, inventario_rrhh_ajustes; inventario_rrhh_movimientos
 * como bitácora), con snapshot/restore en beginTransaction/rollback (mismo
 * patrón ya usado en programacion-lote.test.ts para probar TODO O NADA).
 */
vi.mock("@/lib/db", () => ({ execute: vi.fn(), getPool: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn() }));

import { getPool } from "@/lib/db";
import { registrarAuditoria } from "@/lib/auditoria";
import { registrarCambio, registrarDevolucion } from "./inventario";

type Articulo = { id: number; empresa_id: number; nombre: string; codigo: string; stock: number; costo_unitario: number };
type Entrega = {
  id: number; empresa_id: number; articulo_id: number; empleado_id: number; cantidad: number;
  costo_unitario_entrega: number; costo_total: number; monto_cobrado: number; descuento_id: number | null;
  movimiento_id: number | null; motivo: string | null; entregado_por: string | null; estado: string; creado_en: string;
};
type Ajuste = {
  id: number; empresa_id: number; entrega_id: number; tipo: "DEVOLUCION" | "CAMBIO"; cantidad: number;
  articulo_nuevo_id: number | null; entrega_nueva_id: number | null; movimiento_devolucion_id: number;
  movimiento_salida_id: number | null; motivo: string; registrado_por: string | null; creado_en: string;
};
type Movimiento = { id: number; empresa_id: number; articulo_id: number; tipo: string; cantidad: number; stock_resultante: number };

let articulos: Articulo[];
let entregas: Entrega[];
let ajustes: Ajuste[];
let movimientos: Movimiento[];
let seq: number;
let queriesEjecutadas: string[];

const EMPRESA = 7;

function snapshot() {
  return {
    articulos: structuredClone(articulos),
    entregas: structuredClone(entregas),
    ajustes: structuredClone(ajustes),
    movimientos: structuredClone(movimientos),
    seq,
  };
}
function restaurar(s: ReturnType<typeof snapshot>) {
  articulos = s.articulos;
  entregas = s.entregas;
  ajustes = s.ajustes;
  movimientos = s.movimientos;
  seq = s.seq;
}

function crearConexion() {
  let snap: ReturnType<typeof snapshot> | null = null;
  return {
    beginTransaction: vi.fn(async () => {
      snap = snapshot();
    }),
    commit: vi.fn(async () => {
      snap = null;
    }),
    rollback: vi.fn(async () => {
      if (snap) restaurar(snap);
    }),
    release: vi.fn(),
    query: vi.fn(async (sql: string, params: unknown[] = []) => {
      queriesEjecutadas.push(String(sql));
      const s = String(sql);
      if (s.includes("FROM inventario_rrhh_entregas ent") && s.includes("FOR UPDATE")) {
        const [id, empresaId] = params as [number, number];
        const ent = entregas.find((e) => e.id === id && e.empresa_id === empresaId);
        if (!ent) return [[]];
        const art = articulos.find((a) => a.id === ent.articulo_id)!;
        return [[{ ...ent, articulo_nombre: art.nombre, articulo_codigo: art.codigo }]];
      }
      if (s.includes("SELECT tipo, cantidad FROM inventario_rrhh_ajustes")) {
        const [empresaId, entregaId] = params as [number, number];
        return [ajustes.filter((a) => a.empresa_id === empresaId && a.entrega_id === entregaId)];
      }
      if (s.includes("SELECT id, nombre, codigo, costo_unitario FROM inventario_rrhh")) {
        const [id, empresaId] = params as [number, number];
        const art = articulos.find((a) => a.id === id && a.empresa_id === empresaId);
        return [art ? [art] : []];
      }
      if (s.includes("SELECT stock FROM inventario_rrhh")) {
        const [id, empresaId] = params as [number, number];
        const art = articulos.find((a) => a.id === id && a.empresa_id === empresaId);
        return [art ? [{ stock: art.stock }] : []];
      }
      return [[]];
    }),
    execute: vi.fn(async (sql: string, params: unknown[] = []) => {
      queriesEjecutadas.push(String(sql));
      const s = String(sql);
      if (s.includes("UPDATE inventario_rrhh") && s.includes("SET stock = stock + ?")) {
        const [delta, id, empresaId] = params as [number, number, number];
        const art = articulos.find((a) => a.id === id && a.empresa_id === empresaId);
        if (!art || art.stock + delta < 0) return [{ affectedRows: 0 }];
        art.stock += delta;
        return [{ affectedRows: 1 }];
      }
      if (s.includes("INSERT INTO inventario_rrhh_movimientos")) {
        const [empresa_id, articulo_id, tipo, cantidad, stock_resultante] = params as [number, number, string, number, number];
        const id = ++seq;
        movimientos.push({ id, empresa_id, articulo_id, tipo, cantidad, stock_resultante });
        return [{ insertId: id }];
      }
      if (s.includes("INSERT INTO inventario_rrhh_entregas")) {
        const [empresa_id, articulo_id, empleado_id, cantidad, costo_unitario_entrega, costo_total, movimiento_id, motivo, entregado_por] =
          params as [number, number, number, number, number, number, number, string, string];
        const id = ++seq;
        entregas.push({
          id, empresa_id, articulo_id, empleado_id, cantidad, costo_unitario_entrega, costo_total,
          monto_cobrado: 0, descuento_id: null, movimiento_id, motivo, entregado_por, estado: "ENTREGADO",
          creado_en: "2026-09-28 08:00:00",
        });
        return [{ insertId: id }];
      }
      if (s.includes("INSERT INTO inventario_rrhh_ajustes")) {
        if (s.includes("'DEVOLUCION'")) {
          const [empresa_id, entrega_id, cantidad, movimiento_devolucion_id, motivo, registrado_por] =
            params as [number, number, number, number, string, string];
          const id = ++seq;
          ajustes.push({
            id, empresa_id, entrega_id, tipo: "DEVOLUCION", cantidad, articulo_nuevo_id: null,
            entrega_nueva_id: null, movimiento_devolucion_id, movimiento_salida_id: null, motivo,
            registrado_por, creado_en: "2026-09-28 08:00:00",
          });
          return [{ insertId: id }];
        }
        const [empresa_id, entrega_id, cantidad, articulo_nuevo_id, entrega_nueva_id, movimiento_devolucion_id, movimiento_salida_id, motivo, registrado_por] =
          params as [number, number, number, number, number, number, number, string, string];
        const id = ++seq;
        ajustes.push({
          id, empresa_id, entrega_id, tipo: "CAMBIO", cantidad, articulo_nuevo_id, entrega_nueva_id,
          movimiento_devolucion_id, movimiento_salida_id, motivo, registrado_por, creado_en: "2026-09-28 08:00:00",
        });
        return [{ insertId: id }];
      }
      return [{ affectedRows: 0 }];
    }),
  };
}

let conexion: ReturnType<typeof crearConexion>;

beforeEach(() => {
  vi.resetAllMocks();
  seq = 0;
  queriesEjecutadas = [];
  articulos = [
    { id: 1, empresa_id: EMPRESA, nombre: "Playera Monaco S", codigo: "PLY-S", stock: 5, costo_unitario: 30 },
    { id: 2, empresa_id: EMPRESA, nombre: "Playera Monaco M", codigo: "PLY-M", stock: 0, costo_unitario: 30 },
    { id: 3, empresa_id: EMPRESA, nombre: "Playera Monaco L", codigo: "PLY-L", stock: 5, costo_unitario: 40 },
  ];
  entregas = [
    // #40: 3 × S, sin cobro
    { id: 40, empresa_id: EMPRESA, articulo_id: 1, empleado_id: 900, cantidad: 3, costo_unitario_entrega: 30, costo_total: 90, monto_cobrado: 0, descuento_id: null, movimiento_id: 1, motivo: null, entregado_por: "ops", estado: "ENTREGADO", creado_en: "2026-09-20 08:00:00" },
    // #41: 2 × S, CON cobro (mismo costo que S)
    { id: 41, empresa_id: EMPRESA, articulo_id: 1, empleado_id: 901, cantidad: 2, costo_unitario_entrega: 30, costo_total: 60, monto_cobrado: 60, descuento_id: 555, movimiento_id: 2, motivo: null, entregado_por: "ops", estado: "ENTREGADO", creado_en: "2026-09-20 08:00:00" },
  ];
  ajustes = [];
  movimientos = [];
  conexion = crearConexion();
  vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conexion) } as never);
  vi.mocked(registrarAuditoria).mockResolvedValue(undefined as never);
});

const dev = (id: number, cantidad: number, motivo = "Talla incorrecta") =>
  registrarDevolucion(EMPRESA, id, { cantidad, motivo, registradoPor: "ops" });
const cam = (id: number, cantidad: number, articuloNuevoId: number, motivo = "Talla incorrecta") =>
  registrarCambio(EMPRESA, id, { cantidad, articuloNuevoId, motivo, registradoPor: "ops" });

describe("DEVOLUCIÓN", () => {
  it("4) devolución total suma el stock completo de vuelta", async () => {
    const r = await dev(40, 3);
    expect(r.ok).toBe(true);
    expect(articulos.find((a) => a.id === 1)!.stock).toBe(8); // 5 + 3
  });

  it("5) devolución parcial suma solo la cantidad devuelta", async () => {
    const r = await dev(40, 1);
    expect(r.ok).toBe(true);
    expect(articulos.find((a) => a.id === 1)!.stock).toBe(6); // 5 + 1
  });

  it("6) no permite devolver más de lo disponible", async () => {
    const r = await dev(40, 4);
    expect(r).toMatchObject({ ok: false, motivo: "cantidad_excede_disponible" });
    expect(articulos.find((a) => a.id === 1)!.stock).toBe(5); // sin cambios
  });

  it("7) segunda devolución respeta la primera (no permite exceder el total original)", async () => {
    await dev(40, 2);
    const segunda = await dev(40, 2); // ya solo queda 1 disponible
    expect(segunda).toMatchObject({ ok: false, motivo: "cantidad_excede_disponible" });
    const tercera = await dev(40, 1); // exactamente lo que queda
    expect(tercera.ok).toBe(true);
  });

  it("8) tenant incorrecto no toca nada", async () => {
    const r = await registrarDevolucion(999, 40, { cantidad: 1, motivo: "x", registradoPor: "ops" });
    expect(r).toMatchObject({ ok: false, motivo: "no_encontrado" });
    expect(articulos.find((a) => a.id === 1)!.stock).toBe(5);
    expect(ajustes).toHaveLength(0);
  });

  it("9) rollback total si falla el movimiento/ajuste (nada queda a medias)", async () => {
    // Forzamos el fallo específicamente en el INSERT de ajuste, dejando pasar el resto.
    const original = conexion.execute.getMockImplementation()!;
    conexion.execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (String(sql).includes("INSERT INTO inventario_rrhh_ajustes")) throw new Error("fallo simulado");
      return original(sql, params);
    });
    await expect(dev(40, 1)).rejects.toThrow("fallo simulado");
    expect(articulos.find((a) => a.id === 1)!.stock).toBe(5); // revertido
    expect(conexion.rollback).toHaveBeenCalled();
  });
});

describe("CAMBIO", () => {
  it("10/11) S -> M devuelve stock de S y resta stock de M, en la MISMA transacción", async () => {
    articulos.find((a) => a.id === 2)!.stock = 5; // stock suficiente de M para este caso
    const r = await cam(40, 1, 2); // sin cobro
    expect(r.ok).toBe(true);
    expect(articulos.find((a) => a.id === 1)!.stock).toBe(6); // 5 + 1 devuelto (S)
    expect(articulos.find((a) => a.id === 2)!.stock).toBe(4); // 5 - 1 entregado (M)
  });

  it("12) ambos movimientos (devolución + salida) se registran y el commit ocurre una sola vez", async () => {
    articulos.find((a) => a.id === 2)!.stock = 5; // stock suficiente para este caso
    await cam(40, 1, 2);
    const tiposRegistrados = movimientos.map((m) => m.tipo);
    expect(tiposRegistrados).toEqual(["DEVOLUCION", "CAMBIO_SALIDA"]);
    expect(conexion.commit).toHaveBeenCalledTimes(1);
  });

  it("13) stock insuficiente del artículo nuevo -> rollback total (S no queda devuelta)", async () => {
    // M tiene stock 0 en el fixture base — cambiar 1 debe fallar el UPDATE condicionado.
    const r = await cam(40, 1, 2);
    expect(r).toMatchObject({ ok: false, motivo: "stock_insuficiente" });
    expect(articulos.find((a) => a.id === 1)!.stock).toBe(5); // S NO quedó devuelta
    expect(articulos.find((a) => a.id === 2)!.stock).toBe(0); // M sin cambios
    expect(entregas).toHaveLength(2); // ninguna entrega nueva
  });

  it("14) cantidad mayor a la disponible -> 409 (cantidad_excede_disponible), nada cambia", async () => {
    const r = await cam(40, 10, 2);
    expect(r).toMatchObject({ ok: false, motivo: "cantidad_excede_disponible" });
    expect(articulos.find((a) => a.id === 1)!.stock).toBe(5);
  });

  it("15) cambio parcial: deja el resto de la entrega original disponible", async () => {
    articulos.find((a) => a.id === 2)!.stock = 5;
    const r = await cam(40, 1, 2); // de 3, cambia 1
    expect(r.ok).toBe(true);
    const disponibleRestante = 3 - 1;
    const segundaDevolucion = await dev(40, disponibleRestante);
    expect(segundaDevolucion.ok).toBe(true); // exactamente lo que queda
  });

  it("16) dos cambios secuenciales sobre la misma entrega nunca exceden la cantidad original", async () => {
    articulos.find((a) => a.id === 2)!.stock = 5;
    const primero = await cam(40, 2, 2); // consume 2 de 3
    expect(primero.ok).toBe(true);
    const segundo = await cam(40, 2, 2); // solo queda 1 disponible
    expect(segundo).toMatchObject({ ok: false, motivo: "cantidad_excede_disponible" });
  });

  it("17) el histórico de la entrega original permanece intacto", async () => {
    articulos.find((a) => a.id === 2)!.stock = 5;
    const antes = { ...entregas.find((e) => e.id === 40)! };
    await cam(40, 1, 2);
    const despues = entregas.find((e) => e.id === 40)!;
    expect(despues).toEqual(antes); // ni cantidad, ni articulo_id, ni nada se tocó
  });

  it("18) la nueva entrega y la referencia quedan trazables", async () => {
    articulos.find((a) => a.id === 2)!.stock = 5;
    const r = await cam(40, 1, 2);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const nueva = entregas.find((e) => e.id === r.entregaNuevaId);
    expect(nueva).toMatchObject({ articulo_id: 2, empleado_id: 900, cantidad: 1 });
    const ajuste = ajustes.find((a) => a.id === r.ajusteId);
    expect(ajuste).toMatchObject({ entrega_id: 40, tipo: "CAMBIO", articulo_nuevo_id: 2, entrega_nueva_id: r.entregaNuevaId });
  });

  it("19) auditoría registra el cambio con el detalle esperado", async () => {
    articulos.find((a) => a.id === 2)!.stock = 5;
    await cam(40, 1, 2, "Talla incorrecta");
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({
        empresaId: EMPRESA,
        accion: "inventario_cambio",
        detalle: expect.stringContaining("Cambio entrega #40"),
      }),
    );
  });
});

describe("DESCUENTOS (sección 8 del ticket)", () => {
  it("20) sin cobro -> el cambio nunca crea ni toca ningún descuento", async () => {
    articulos.find((a) => a.id === 2)!.stock = 5;
    const r = await cam(40, 1, 2); // entrega #40 monto_cobrado = 0
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const nueva = entregas.find((e) => e.id === r.entregaNuevaId)!;
    expect(nueva.descuento_id).toBeNull();
    expect(queriesEjecutadas.some((q) => q.includes("rrhh_descuentos_maestro") || q.includes("rrhh_descuento_cuotas"))).toBe(false);
  });

  it("21) con cobro y MISMO precio -> permitido, no duplica descuento (el original sigue cubriendo la deuda)", async () => {
    articulos.find((a) => a.id === 3)!.stock = 5; // L cuesta 40, distinto — usamos un artículo del mismo precio que S (30) en su lugar
    articulos.push({ id: 4, empresa_id: EMPRESA, nombre: "Playera Monaco M2", codigo: "PLY-M2", stock: 5, costo_unitario: 30 });
    const r = await cam(41, 1, 4); // entrega #41 SÍ tiene cobro (60), costo original 30 == costo nuevo 30
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const nueva = entregas.find((e) => e.id === r.entregaNuevaId)!;
    expect(nueva.descuento_id).toBeNull(); // no se duplica: el descuento #555 original sigue igual
    expect(queriesEjecutadas.some((q) => q.includes("rrhh_descuentos_maestro"))).toBe(false);
  });

  it("22) con cobro y precio DISTINTO -> 409, comportamiento definido: rechaza sin tocar nada", async () => {
    const r = await cam(41, 1, 3); // L cuesta 40, la entrega #41 costó 30 por unidad
    expect(r).toMatchObject({ ok: false, motivo: "diferencia_precio_no_soportada" });
    expect(articulos.find((a) => a.id === 1)!.stock).toBe(5); // S sin tocar
    expect(articulos.find((a) => a.id === 3)!.stock).toBe(5); // L sin tocar
    expect(entregas).toHaveLength(2); // ninguna entrega nueva
    expect(ajustes).toHaveLength(0);
  });

  it("23) cuotas ya aplicadas nunca se tocan (este flujo jamás consulta rrhh_descuento_cuotas)", async () => {
    articulos.find((a) => a.id === 2)!.stock = 5;
    await cam(40, 1, 2);
    await dev(41, 1);
    expect(queriesEjecutadas.some((q) => q.includes("rrhh_descuento_cuotas"))).toBe(false);
  });

  it("24) si falla la escritura de la entrega nueva, rollback total (stock de ambos artículos queda como antes)", async () => {
    articulos.find((a) => a.id === 2)!.stock = 5;
    const original = conexion.execute.getMockImplementation()!;
    conexion.execute.mockImplementation(async (sql: string, params: unknown[] = []) => {
      if (String(sql).includes("INSERT INTO inventario_rrhh_entregas")) throw new Error("fallo simulado en entrega nueva");
      return original(sql, params);
    });
    await expect(cam(40, 1, 2)).rejects.toThrow("fallo simulado en entrega nueva");
    expect(articulos.find((a) => a.id === 1)!.stock).toBe(5);
    expect(articulos.find((a) => a.id === 2)!.stock).toBe(5);
    expect(entregas).toHaveLength(2);
  });
});
