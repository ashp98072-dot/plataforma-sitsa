import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ execute: vi.fn(), getPool: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn(), registrarAuditoriaTx: vi.fn() }));
vi.mock("@/lib/tms/paradas", () => ({ guardarParadasPlan: vi.fn() }));
vi.mock("@/lib/tms/codigo-plan", () => ({ asegurarCodigoPlanUnico: vi.fn() }));

import { execute, getPool, query } from "@/lib/db";
import { registrarAuditoria, registrarAuditoriaTx } from "@/lib/auditoria";
import { guardarParadasPlan } from "@/lib/tms/paradas";
import { asegurarCodigoPlanUnico } from "@/lib/tms/codigo-plan";
import {
  listarSolicitudesClienteInterno,
  obtenerSolicitudClienteInterno,
  programarSolicitud,
  rechazarSolicitud,
  tomarEnRevisionSolicitud,
} from "./solicitudes-cliente-operaciones";

const EMPRESA_ID = 7;
const SOLICITUD_ID = 500;

function filaSolicitud(overrides: Record<string, unknown> = {}) {
  return {
    id: SOLICITUD_ID,
    empresa_id: EMPRESA_ID,
    cliente_id: 30,
    estado: "EN_REVISION",
    plan_id: null,
    version: 3,
    fecha_solicitada: "2099-01-15",
    hora_solicitada: "08:00:00",
    referencia_cliente: "REF-1",
    observaciones: "Entregar en bodega trasera",
    ...overrides,
  };
}

function paradaFila(overrides: Record<string, unknown> = {}) {
  return {
    orden: 1,
    tipo: "Carga",
    lugar_nombre: "Bodega PriceSmart",
    cliente_ubicacion_id: null,
    referencia: null,
    ...overrides,
  };
}

describe("listarSolicitudesClienteInterno / obtenerSolicitudClienteInterno — aislamiento por tenant", () => {
  beforeEach(() => vi.resetAllMocks());

  it("listarSolicitudesClienteInterno filtra SOLO por empresa_id (staff ve todos los clientes de SU empresa)", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await listarSolicitudesClienteInterno(EMPRESA_ID, { estado: "EN_REVISION" });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("WHERE s.empresa_id = ?");
    expect(params).toEqual([EMPRESA_ID, "EN_REVISION"]);
  });

  it("obtenerSolicitudClienteInterno: solicitud de OTRA empresa (tenant B) → null, nunca visible para tenant A", async () => {
    // Simula lo que MySQL devolvería si la solicitud #500 es real pero
    // pertenece a otra empresa: el WHERE s.empresa_id=? no encuentra fila.
    vi.mocked(query).mockResolvedValueOnce([] as never);
    const r = await obtenerSolicitudClienteInterno(999, SOLICITUD_ID);
    expect(r).toBeNull();
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("WHERE s.id = ? AND s.empresa_id = ?");
    expect(params).toEqual([SOLICITUD_ID, 999]);
  });

  it("obtenerSolicitudClienteInterno propia empresa: devuelve detalle con paradas y cantidadEntregas derivada", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([
        {
          id: SOLICITUD_ID, cliente_id: 30, cliente_nombre: "PriceSmart", estado: "EN_REVISION",
          fecha_solicitada: "2099-01-15", hora_solicitada: "08:00:00", referencia_cliente: "REF-1",
          observaciones: null, motivo_rechazo: null, plan_id: null, version: 3,
          creado_por_usuario_cliente_id: 10, creado_en: "2026-09-02 08:00:00", actualizado_en: "2026-09-02 08:00:00",
          creado_por_nombre: "Contacto ACME", plan_codigo: null,
        },
      ] as never)
      .mockResolvedValueOnce([
        paradaFila({ orden: 1, tipo: "Carga" }),
        { ...paradaFila({ orden: 2, tipo: "Entrega" }), id: 2 },
        paradaFila({ orden: 3, tipo: "Descarga" }),
      ].map((p, i) => ({ id: i + 1, ...p })) as never);
    const r = await obtenerSolicitudClienteInterno(EMPRESA_ID, SOLICITUD_ID);
    expect(r?.clienteNombre).toBe("PriceSmart");
    expect(r?.cantidadEntregas).toBe(1);
    expect(r?.paradas).toHaveLength(3);
  });
});

describe("tomarEnRevisionSolicitud", () => {
  beforeEach(() => vi.resetAllMocks());

  it("SOLICITADA + version correcta → EN_REVISION, audita", async () => {
    vi.mocked(execute).mockResolvedValue({ affectedRows: 1 } as unknown as Awaited<ReturnType<typeof execute>>);
    const r = await tomarEnRevisionSolicitud(EMPRESA_ID, SOLICITUD_ID, 1, "operador1");
    expect(r).toEqual({ ok: true });
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("estado = 'SOLICITADA' AND version = ?"),
      [SOLICITUD_ID, EMPRESA_ID, 1],
    );
    expect(registrarAuditoria).toHaveBeenCalledWith(
      expect.objectContaining({ accion: "tomar_en_revision_solicitud_cliente" }),
    );
  });

  it("doble revisión (ya no está en SOLICITADA) → 409, sin auditar", async () => {
    vi.mocked(execute).mockResolvedValue({ affectedRows: 0 } as unknown as Awaited<ReturnType<typeof execute>>);
    vi.mocked(query).mockResolvedValue([{ id: SOLICITUD_ID }] as never); // existe para esta empresa
    const r = await tomarEnRevisionSolicitud(EMPRESA_ID, SOLICITUD_ID, 1, "operador1");
    expect(r).toEqual({
      ok: false,
      status: 409,
      mensaje: "La solicitud fue modificada por otra persona. Actualiza la página e inténtalo de nuevo.",
    });
    expect(registrarAuditoria).not.toHaveBeenCalled();
  });

  it("version obsoleta (concurrencia) → 409", async () => {
    vi.mocked(execute).mockResolvedValue({ affectedRows: 0 } as unknown as Awaited<ReturnType<typeof execute>>);
    vi.mocked(query).mockResolvedValue([{ id: SOLICITUD_ID }] as never);
    const r = await tomarEnRevisionSolicitud(EMPRESA_ID, SOLICITUD_ID, 99, "operador1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
  });

  it("solicitud de otra empresa (tenant ajeno) → 404, nunca 409", async () => {
    vi.mocked(execute).mockResolvedValue({ affectedRows: 0 } as unknown as Awaited<ReturnType<typeof execute>>);
    vi.mocked(query).mockResolvedValue([] as never); // no existe para ESTA empresa
    const r = await tomarEnRevisionSolicitud(EMPRESA_ID, SOLICITUD_ID, 1, "operador1");
    expect(r).toEqual({ ok: false, status: 404, mensaje: "Solicitud no encontrada." });
  });
});

describe("rechazarSolicitud", () => {
  beforeEach(() => vi.resetAllMocks());

  it("exige motivo (mínimo 5 caracteres) → 400, sin tocar la base de datos", async () => {
    const r = await rechazarSolicitud(EMPRESA_ID, SOLICITUD_ID, 1, "abc", "operador1");
    expect(r).toEqual({ ok: false, status: 400, mensaje: "Indica un motivo de rechazo (mínimo 5 caracteres)." });
    expect(execute).not.toHaveBeenCalled();
  });

  it("motivo supera 500 caracteres → 400", async () => {
    const r = await rechazarSolicitud(EMPRESA_ID, SOLICITUD_ID, 1, "x".repeat(501), "operador1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });

  it("desde SOLICITADA o EN_REVISION con motivo válido → RECHAZADA, audita", async () => {
    vi.mocked(execute).mockResolvedValue({ affectedRows: 1 } as unknown as Awaited<ReturnType<typeof execute>>);
    const r = await rechazarSolicitud(EMPRESA_ID, SOLICITUD_ID, 2, "No hay unidad disponible esa fecha", "operador1");
    expect(r).toEqual({ ok: true });
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("estado IN ('SOLICITADA', 'EN_REVISION') AND version = ?"),
      ["No hay unidad disponible esa fecha", SOLICITUD_ID, EMPRESA_ID, 2],
    );
  });

  it("solicitud de OTRO tenant (ajena) → 404, no 403 (nunca confirma que el id existe en otra empresa)", async () => {
    vi.mocked(execute).mockResolvedValue({ affectedRows: 0 } as unknown as Awaited<ReturnType<typeof execute>>);
    vi.mocked(query).mockResolvedValue([] as never);
    const r = await rechazarSolicitud(EMPRESA_ID, SOLICITUD_ID, 1, "motivo cualquiera", "operador1");
    expect(r).toEqual({ ok: false, status: 404, mensaje: "Solicitud no encontrada." });
  });
});

describe("programarSolicitud — conversión a plan (transaccional)", () => {
  const conn = {
    beginTransaction: vi.fn(),
    query: vi.fn(),
    execute: vi.fn(),
    commit: vi.fn(),
    rollback: vi.fn(),
    release: vi.fn(),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(getPool).mockReturnValue({ getConnection: async () => conn } as unknown as ReturnType<typeof getPool>);
    conn.query.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes("FOR UPDATE")) return [[filaSolicitud()]];
      if (s.includes("FROM tms_clientes")) return [[{ id: 30 }]];
      if (s.includes("FROM tms_solicitud_paradas")) {
        return [[
          { orden: 1, tipo: "Carga", lugar_nombre: "Bodega PriceSmart", cliente_ubicacion_id: null, referencia: null },
          { orden: 2, tipo: "Entrega", lugar_nombre: "Sucursal 1", cliente_ubicacion_id: 5, referencia: "Portón azul" },
          { orden: 3, tipo: "Entrega", lugar_nombre: "Sucursal 2", cliente_ubicacion_id: null, referencia: null },
          { orden: 4, tipo: "Descarga", lugar_nombre: "Bodega central", cliente_ubicacion_id: null, referencia: null },
        ]];
      }
      return [[]];
    });
    conn.execute.mockImplementation(async (sql: string) => {
      if (String(sql).includes("INSERT INTO tms_planes_viaje")) return [{ insertId: 900, affectedRows: 1 }];
      return [{ affectedRows: 1 }];
    });
    vi.mocked(asegurarCodigoPlanUnico).mockResolvedValue("PLAN-20990115-001");
    vi.mocked(guardarParadasPlan).mockResolvedValue({ ok: true });
  });

  it("éxito: FOR UPDATE + INSERT plan + copia N paradas EN EL MISMO ORDEN + UPDATE solicitud + auditoría + commit (nunca rollback)", async () => {
    const r = await programarSolicitud(EMPRESA_ID, SOLICITUD_ID, 3, "operador1");
    expect(r).toEqual({ ok: true, planId: 900, planCodigo: "PLAN-20990115-001" });

    // SELECT ... FOR UPDATE de la solicitud.
    expect(conn.query.mock.calls.some(([sql]) => String(sql).includes("FOR UPDATE"))).toBe(true);

    // Plan creado con empresa_id/cliente_id DE LA SOLICITUD (no de otra fuente).
    const insertPlan = conn.execute.mock.calls.find(([sql]) => String(sql).includes("INSERT INTO tms_planes_viaje"));
    expect(insertPlan![1][0]).toBe(EMPRESA_ID); // empresa_id
    expect(insertPlan![1][2]).toBe(30); // cliente_id = solicitud.cliente_id

    // Copia de paradas: mismo orden relativo (Carga, Entrega, Entrega, Descarga),
    // vía guardarParadasPlan (reutilizado, no reimplementado). AJUSTE
    // PRE-MERGE PR #173 (punto 2): lugar_nombre EXACTO, sin concatenar
    // `referencia` — ver test dedicado más abajo para el caso explícito.
    expect(guardarParadasPlan).toHaveBeenCalledWith(
      EMPRESA_ID,
      900,
      [
        expect.objectContaining({ tipo: "Carga", lugarNombre: "Bodega PriceSmart" }),
        expect.objectContaining({ tipo: "Entrega", lugarNombre: "Sucursal 1", clienteUbicacionId: 5 }),
        expect.objectContaining({ tipo: "Entrega", lugarNombre: "Sucursal 2" }),
        expect.objectContaining({ tipo: "Descarga", lugarNombre: "Bodega central" }),
      ],
      conn,
    );

    // Solicitud actualizada: PROGRAMADA + plan_id enlazado + version incrementada (implícito en el SQL).
    const updateSolicitud = conn.execute.mock.calls.find(([sql]) =>
      String(sql).includes("UPDATE tms_solicitudes_cliente"),
    );
    expect(String(updateSolicitud![0])).toContain("estado = 'PROGRAMADA'");
    expect(String(updateSolicitud![0])).toContain("version = version + 1");
    expect(updateSolicitud![1]).toEqual([900, SOLICITUD_ID, EMPRESA_ID]);

    expect(registrarAuditoriaTx).toHaveBeenCalledWith(
      conn,
      expect.objectContaining({ accion: "programar_solicitud_cliente", empresaId: EMPRESA_ID }),
    );
    expect(conn.commit).toHaveBeenCalledOnce();
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledOnce();
  });

  it("solicitud inexistente para esta empresa → 404, rollback, sin crear plan", async () => {
    conn.query.mockImplementation(async (sql: string) => {
      if (String(sql).includes("FOR UPDATE")) return [[]];
      return [[]];
    });
    const r = await programarSolicitud(EMPRESA_ID, SOLICITUD_ID, 3, "operador1");
    expect(r).toEqual({ ok: false, status: 404, mensaje: "Solicitud no encontrada." });
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.execute).not.toHaveBeenCalled();
  });

  it("estado != EN_REVISION (ej. todavía SOLICITADA) → 409, no programa directo sin revisión", async () => {
    conn.query.mockImplementation(async (sql: string) => {
      if (String(sql).includes("FOR UPDATE")) return [[filaSolicitud({ estado: "SOLICITADA" })]];
      return [[]];
    });
    const r = await programarSolicitud(EMPRESA_ID, SOLICITUD_ID, 3, "operador1");
    expect(r).toEqual({
      ok: false,
      status: 409,
      mensaje: "La solicitud debe estar en revisión antes de programarse.",
    });
    expect(conn.rollback).toHaveBeenCalledOnce();
  });

  it("IDEMPOTENCIA / doble clic: solicitud YA tiene plan_id → 409 'La solicitud ya fue programada.', NO crea un segundo plan", async () => {
    conn.query.mockImplementation(async (sql: string) => {
      if (String(sql).includes("FOR UPDATE")) return [[filaSolicitud({ plan_id: 777 })]];
      return [[]];
    });
    const r = await programarSolicitud(EMPRESA_ID, SOLICITUD_ID, 3, "operador1");
    expect(r).toEqual({ ok: false, status: 409, mensaje: "La solicitud ya fue programada." });
    expect(conn.execute).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledOnce();
  });

  it("version obsoleta (otro operador ya la modificó) → 409, rollback", async () => {
    const r = await programarSolicitud(EMPRESA_ID, SOLICITUD_ID, 999, "operador1");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(409);
      expect(r.mensaje).toMatch(/modificada por otra persona/i);
    }
    expect(conn.rollback).toHaveBeenCalledOnce();
  });

  // AJUSTE PRE-MERGE PR #173 (punto 2) — copia EXACTA de lugar_nombre,
  // sin concatenar `referencia`. Ejemplo literal del ajuste.
  it("copia lugar_nombre EXACTO — la referencia NO se concatena ni se pierde (sigue en tms_solicitud_paradas)", async () => {
    conn.query.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes("FOR UPDATE")) return [[filaSolicitud()]];
      if (s.includes("FROM tms_clientes")) return [[{ id: 30 }]];
      if (s.includes("FROM tms_solicitud_paradas")) {
        return [[
          { orden: 1, tipo: "Carga", lugar_nombre: "Origen", cliente_ubicacion_id: null, referencia: null },
          {
            orden: 2,
            tipo: "Entrega",
            lugar_nombre: "PriceSmart Zona 10",
            cliente_ubicacion_id: null,
            referencia: "Entrada por portón 3",
          },
          { orden: 3, tipo: "Descarga", lugar_nombre: "Destino", cliente_ubicacion_id: null, referencia: null },
        ]];
      }
      return [[]];
    });
    await programarSolicitud(EMPRESA_ID, SOLICITUD_ID, 3, "operador1");
    const paradasEnviadas = vi.mocked(guardarParadasPlan).mock.calls[0][2];
    const entrega = paradasEnviadas.find((p) => p.tipo === "Entrega")!;
    expect(entrega.lugarNombre).toBe("PriceSmart Zona 10");
    expect(entrega.lugarNombre).not.toContain("Entrada por portón 3");
    expect(entrega.lugarNombre).not.toContain(" — ");
    // La referencia NO viaja al plan de ninguna forma — ParadaInput no
    // tiene siquiera un campo para ella.
    expect(entrega).not.toHaveProperty("referencia");
  });

  // AJUSTE PRE-MERGE PR #173 (punto 1) — CASO A: ER_DUP_ENTRY/errno 1062
  // → SÍ se trata como choque de código: genera otro código y reintenta.
  it("CASO A — INSERT choca con ER_DUP_ENTRY (código repetido) → genera otro código y reintenta, termina en éxito", async () => {
    let intentos = 0;
    conn.execute.mockImplementation(async (sql: string) => {
      if (String(sql).includes("INSERT INTO tms_planes_viaje")) {
        intentos++;
        if (intentos < 3) {
          const err = new Error("Duplicate entry") as Error & { code: string; errno: number };
          err.code = "ER_DUP_ENTRY";
          err.errno = 1062;
          throw err;
        }
        return [{ insertId: 900, affectedRows: 1 }];
      }
      return [{ affectedRows: 1 }];
    });
    const r = await programarSolicitud(EMPRESA_ID, SOLICITUD_ID, 3, "operador1");
    expect(r).toEqual({ ok: true, planId: 900, planCodigo: "PLAN-20990115-001" });
    expect(intentos).toBe(3);
    expect(asegurarCodigoPlanUnico).toHaveBeenCalledTimes(3); // 1 inicial + 2 reintentos
    expect(conn.rollback).not.toHaveBeenCalled();
  });

  // CASO B: un error que NO es ER_DUP_ENTRY/1062 (ej. FK, dato inválido,
  // timeout) NUNCA se trata como código duplicado — se propaga tal cual,
  // sin reintentar, y dispara rollback real con el error verdadero (no
  // un mensaje falso de "código duplicado").
  it("CASO B — INSERT falla con un error genérico (no ER_DUP_ENTRY) → NO reintenta, propaga el error real, rollback", async () => {
    conn.execute.mockImplementation(async (sql: string) => {
      if (String(sql).includes("INSERT INTO tms_planes_viaje")) {
        throw new Error("ER_NO_REFERENCED_ROW_2: cliente_id no existe");
      }
      return [{ affectedRows: 1 }];
    });
    await expect(programarSolicitud(EMPRESA_ID, SOLICITUD_ID, 3, "operador1")).rejects.toThrow(
      "ER_NO_REFERENCED_ROW_2",
    );
    // Un solo intento — nunca reintentó generando otro código.
    expect(conn.execute.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO tms_planes_viaje"))).toHaveLength(1);
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  // CASO C: 5 colisiones REALES consecutivas (ER_DUP_ENTRY todas las
  // veces) → se agotan los reintentos, rollback, respuesta funcional de
  // conflicto (nunca una excepción sin manejar).
  it("CASO C — 5 colisiones ER_DUP_ENTRY consecutivas → rollback, respuesta funcional de conflicto", async () => {
    conn.execute.mockImplementation(async (sql: string) => {
      if (String(sql).includes("INSERT INTO tms_planes_viaje")) {
        const err = new Error("Duplicate entry") as Error & { code: string };
        err.code = "ER_DUP_ENTRY";
        throw err;
      }
      return [{ affectedRows: 1 }];
    });
    const r = await programarSolicitud(EMPRESA_ID, SOLICITUD_ID, 3, "operador1");
    expect(r).toEqual({
      ok: false,
      status: 409,
      mensaje: "No se pudo generar un código de plan único. Intenta de nuevo.",
    });
    expect(conn.execute.mock.calls.filter(([sql]) => String(sql).includes("INSERT INTO tms_planes_viaje"))).toHaveLength(5);
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(
      conn.execute.mock.calls.some(([sql]) => String(sql).includes("UPDATE tms_solicitudes_cliente")),
    ).toBe(false);
  });

  it("fallo copiando una parada (guardarParadasPlan rechaza) → rollback total, sin UPDATE de solicitud", async () => {
    vi.mocked(guardarParadasPlan).mockResolvedValue({ ok: false, error: "fallo simulado de parada" });
    const r = await programarSolicitud(EMPRESA_ID, SOLICITUD_ID, 3, "operador1");
    expect(r).toEqual({ ok: false, status: 409, mensaje: "fallo simulado de parada" });
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("fallo actualizando la solicitud al final → rollback total (el plan recién creado NO queda huérfano confirmado)", async () => {
    conn.execute.mockImplementation(async (sql: string) => {
      if (String(sql).includes("INSERT INTO tms_planes_viaje")) return [{ insertId: 900 }];
      if (String(sql).includes("UPDATE tms_solicitudes_cliente")) throw new Error("fallo simulado al actualizar");
      return [{ affectedRows: 1 }];
    });
    await expect(programarSolicitud(EMPRESA_ID, SOLICITUD_ID, 3, "operador1")).rejects.toThrow(
      "fallo simulado al actualizar",
    );
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("cliente TMS de la solicitud ya no existe en esta empresa → 409, rollback", async () => {
    conn.query.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes("FOR UPDATE")) return [[filaSolicitud()]];
      if (s.includes("FROM tms_clientes")) return [[]]; // cliente ya no existe/no pertenece a la empresa
      return [[]];
    });
    const r = await programarSolicitud(EMPRESA_ID, SOLICITUD_ID, 3, "operador1");
    expect(r).toEqual({ ok: false, status: 409, mensaje: "El cliente de esta solicitud ya no existe." });
    expect(conn.rollback).toHaveBeenCalledOnce();
  });
});
