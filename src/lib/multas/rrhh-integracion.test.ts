import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantMultas: vi.fn(), requireTenantRrhh: vi.fn() }));
vi.mock("@/lib/rrhh/descuentos", () => ({
  crearDescuentoInterno: vi.fn(),
  autorizarDescuentoInterno: vi.fn(),
  cancelarDescuentoInterno: vi.fn(),
  obtenerDescuento: vi.fn(),
}));
import { getPool, query } from "@/lib/db";
import { requireTenantMultas, requireTenantRrhh } from "@/lib/tenant";
import {
  crearDescuentoInterno,
  autorizarDescuentoInterno,
  cancelarDescuentoInterno,
  obtenerDescuento,
} from "@/lib/rrhh/descuentos";
import { GET as getBandeja } from "@/app/api/empresas/[slug]/rrhh/multas-pendientes/route";
import { POST as postVincular } from "@/app/api/empresas/[slug]/rrhh/multas-pendientes/[multaId]/route";
import { POST as postAnularConDescuento } from "@/app/api/empresas/[slug]/operaciones/multas/[id]/anular-con-descuento/route";
import { GET as getMultaDetalle } from "@/app/api/empresas/[slug]/operaciones/multas/[id]/route";
import { GET as getMultas } from "@/app/api/empresas/[slug]/operaciones/multas/route";
import { PATCH } from "@/app/api/empresas/[slug]/operaciones/multas/[id]/route";
import { nuevaMulta, motivoDescuentoMulta, CONCEPTO_MULTA_RRHH, CLASIFICACION_MULTA_RRHH } from "./reglas";

const multaCtx = { params: Promise.resolve({ slug: "prueba", multaId: "9" }) };
const idCtx = { params: Promise.resolve({ slug: "prueba", id: "9" }) };
const ctx = { params: Promise.resolve({ slug: "prueba" }) };
const req = (data: unknown, method = "POST") => new Request("http://localhost/x", { method, body: JSON.stringify(data) });

const conn = { beginTransaction: vi.fn(), query: vi.fn(), execute: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn(), destroy: vi.fn() };
const getConnection = vi.fn();

const colaboradorInput = {
  revision_id: 2, vehiculo_id: 3, fecha_infraccion: "2026-08-01", tipo_multa: "Exceso de velocidad",
  descripcion: "Caso sintético", monto_total: "100.00", tipo_responsabilidad: "PILOTO", empleado_responsable_id: 5,
  resolucion_economica: "COLABORADOR", monto_empresa: "0.00", monto_colaborador: "100.00",
};
const compartidoInput = { ...colaboradorInput, resolucion_economica: "COMPARTIDO", monto_empresa: "40.00", monto_colaborador: "60.00" };
const empresaInput = { ...colaboradorInput, resolucion_economica: "EMPRESA", monto_empresa: "100.00", monto_colaborador: "0.00" };

function filaMulta(input: typeof colaboradorInput, overrides: Record<string, unknown> = {}) {
  return { ...nuevaMulta(input), id: 9, empresa_id: 7, placa_historica: "TEST-001", referencia_boleta: "B-1", ...overrides };
}

const config = { periodicidad: "CADA_QUINCENA", numeroCuotas: 4, fechaInicio: "2026-08-15" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.mocked(requireTenantMultas).mockResolvedValue(
    { empresa: { id: 7 }, session: { id: 8, username: "ops1" } } as Awaited<ReturnType<typeof requireTenantMultas>>,
  );
  vi.mocked(requireTenantRrhh).mockResolvedValue(
    { empresa: { id: 7 }, session: { id: 11, username: "rrhh1" } } as Awaited<ReturnType<typeof requireTenantRrhh>>,
  );
  vi.mocked(getPool).mockReturnValue({ getConnection } as unknown as ReturnType<typeof getPool>);
  getConnection.mockResolvedValue(conn);
  conn.query.mockImplementation(async (sql: string) => {
    if (sql.includes("rrhh_descuento_cuotas")) return [[{ aplicadas: 0 }], []];
    if (sql.includes("empleados")) return [[{ id: 5 }], []];
    if (sql.includes("ops_multas")) return [[filaMulta(colaboradorInput)], []];
    throw new Error("Consulta inesperada");
  });
  conn.execute.mockResolvedValue([{ affectedRows: 1, insertId: 55 }, []]);
  vi.mocked(query).mockResolvedValue([]);
  vi.mocked(crearDescuentoInterno).mockResolvedValue({ id: 55, codigo: "DES-2026-000001" });
  vi.mocked(autorizarDescuentoInterno).mockResolvedValue({ cuotasGeneradas: 4 });
  vi.mocked(cancelarDescuentoInterno).mockResolvedValue(undefined);
  vi.mocked(obtenerDescuento).mockResolvedValue(null);
});
afterEach(() => vi.restoreAllMocks());

describe("MULTAS-3.2 — integración RRHH", () => {
  it("1) EMPRESA no genera obligación de descuento (rrhh_descuento_id nace null, estado NO_APLICA)", () => {
    const m = nuevaMulta(empresaInput);
    expect(m.rrhh_descuento_id).toBeNull();
    expect(m.estado_descuento).toBe("NO_APLICA");
  });

  it("2) bandeja RRHH filtra COLABORADOR/COMPARTIDO sin vínculo, excluye ANULADA, y exige rrhh:descuentos:ver", async () => {
    const response = await getBandeja(new Request("http://localhost/x"), ctx);
    expect(response.status).toBe(200);
    expect(requireTenantRrhh).toHaveBeenCalledWith("prueba", "descuentos", "ver");
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("resolucion_economica IN ('COLABORADOR','COMPARTIDO')");
    expect(sql).toContain("monto_colaborador > 0");
    expect(sql).toContain("rrhh_descuento_id IS NULL");
    expect(sql).toContain("m.estado <> 'ANULADA'");
    expect(params).toEqual([7]);
  });

  it("3) y 8) COMPARTIDO: el descuento RRHH se crea SOLO por monto_colaborador, nunca por el total ni por monto_empresa", async () => {
    conn.query.mockImplementation(async (sql: string) => {
      if (sql.includes("ops_multas")) return [[filaMulta(compartidoInput)], []];
      throw new Error("Consulta inesperada");
    });
    const response = await postVincular(req(config), multaCtx);
    expect(response.status).toBe(201);
    const llamada = vi.mocked(crearDescuentoInterno).mock.calls[0][2];
    expect(llamada.montoOriginal).toBe(60); // monto_colaborador, no 100 (total) ni 40 (empresa)
    expect(llamada.concepto).toBe(CONCEPTO_MULTA_RRHH);
    expect(llamada.clasificacion).toBe(CLASIFICACION_MULTA_RRHH);
  });

  it("4) Operaciones sin permiso RRHH no puede generar el descuento (403 antes de tocar DB)", async () => {
    vi.mocked(requireTenantRrhh).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantRrhh>>);
    const response = await postVincular(req(config), multaCtx);
    expect(response.status).toBe(403);
    expect(getConnection).not.toHaveBeenCalled();
    expect(crearDescuentoInterno).not.toHaveBeenCalled();
  });

  // Corrección P0 — crearDescuentoDesdeMulta() ejecuta crear Y autorizar
  // (RRHH real: dos permisos distintos, ver crear vs "autorizar" en
  // /rrhh/descuentos). El endpoint de vínculo debe exigir AMBOS.
  function mockRrhhPor(crear: boolean, editar: boolean) {
    vi.mocked(requireTenantRrhh).mockImplementation(async (_slug, _submodulo, accion) => {
      const ok = accion === "editar" ? editar : crear;
      return ok
        ? ({ empresa: { id: 7 }, session: { id: 11, username: "rrhh1" } } as Awaited<ReturnType<typeof requireTenantRrhh>>)
        : ({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantRrhh>>);
    });
  }
  it("P0.1) rrhh:descuentos:crear=true / editar=false → 403, sin crear nada", async () => {
    mockRrhhPor(true, false);
    const response = await postVincular(req(config), multaCtx);
    expect(response.status).toBe(403);
    expect(crearDescuentoInterno).not.toHaveBeenCalled();
    expect(getConnection).not.toHaveBeenCalled();
  });
  it("P0.2) rrhh:descuentos:crear=false / editar=true → 403, sin crear nada", async () => {
    mockRrhhPor(false, true);
    const response = await postVincular(req(config), multaCtx);
    expect(response.status).toBe(403);
    expect(crearDescuentoInterno).not.toHaveBeenCalled();
    expect(getConnection).not.toHaveBeenCalled();
  });
  it("P0.4) Admin (permiso efectivo=true en ambas acciones vía el guard existente) sigue permitido — el bypass de Admin vive en requireTenantRrhh, sin cambios en este PR", async () => {
    mockRrhhPor(true, true);
    const response = await postVincular(req(config), multaCtx);
    expect(response.status).toBe(201);
  });

  it("5) y 7) y P0.3) RRHH autorizado (crear Y editar) crea+autoriza+vincula en una sola transacción y audita ambos módulos", async () => {
    const response = await postVincular(req(config), multaCtx);
    expect(response.status).toBe(201);
    expect(requireTenantRrhh).toHaveBeenCalledWith("prueba", "descuentos", "crear");
    expect(requireTenantRrhh).toHaveBeenCalledWith("prueba", "descuentos", "editar");
    expect(crearDescuentoInterno).toHaveBeenCalledTimes(1);
    expect(autorizarDescuentoInterno).toHaveBeenCalledTimes(1);
    const vinculo = conn.execute.mock.calls.find(([sql]) => sql.includes("SET rrhh_descuento_id"));
    expect(vinculo?.[0]).toContain("WHERE id = ? AND empresa_id = ? AND rrhh_descuento_id IS NULL");
    expect(vinculo?.[1]).toEqual([55, 11, 9, 7]);
    const auditRrhh = conn.execute.mock.calls.find(([, params]) => params?.[2] === "descuento_creado_desde_multa");
    const auditMultas = conn.execute.mock.calls.find(([, params]) => params?.[2] === "multa_descuento_vinculado");
    expect(auditRrhh).toBeTruthy(); expect(auditMultas).toBeTruthy();
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  it("6) doble solicitud concurrente: la segunda ve rrhh_descuento_id ya vinculado y falla con 409 sin crear nada", async () => {
    conn.query.mockImplementation(async (sql: string) => {
      if (sql.includes("ops_multas")) return [[filaMulta(colaboradorInput, { rrhh_descuento_id: 99 })], []];
      throw new Error("Consulta inesperada");
    });
    const response = await postVincular(req(config), multaCtx);
    expect(response.status).toBe(409);
    expect(crearDescuentoInterno).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledTimes(1);
  });

  it("9) cuota aplicada en RRHH: el GET enriquecido deriva estado_descuento=DESCONTADO y expone el saldo real", async () => {
    conn.query.mockImplementation(async (sql: string) => {
      if (sql.includes("ops_multas")) return [[filaMulta(colaboradorInput, { rrhh_descuento_id: 55 })], []];
      throw new Error("Consulta inesperada");
    });
    vi.mocked(query).mockResolvedValue([{ ...filaMulta(colaboradorInput, { rrhh_descuento_id: 55 }), placa_actual: "TEST-001" }] as unknown as Awaited<ReturnType<typeof query>>);
    vi.mocked(obtenerDescuento).mockResolvedValue({
      id: 55, codigo: "DES-2026-000001", estado: "ACTIVO", montoOriginal: 100, numeroCuotas: 4,
      cuotasAplicadas: 1, pagado: 25, saldo: 75, proximaCuota: { numero: 2, fecha: "2026-09-01", monto: 25 },
    } as unknown as Awaited<ReturnType<typeof obtenerDescuento>>);
    const response = await getMultaDetalle(new Request("http://localhost/x"), idCtx);
    const data = await response.json();
    expect(data.multa.estado_descuento).toBe("DESCONTADO");
    expect(data.multa.descuentoRrhh.saldo).toBe(75);
    expect(data.multa.descuentoRrhh.cuotasAplicadas).toBe(1);
  });

  it("10) boleta: concepto/motivo esperados, sin ids internos ni datos administrativos", () => {
    expect(CONCEPTO_MULTA_RRHH).toBe("Multa de tránsito");
    const motivo = motivoDescuentoMulta({ placa_historica: "C-123ABC", referencia_boleta: "45678", descripcion: "Exceso de velocidad en ruta CA-9" });
    expect(motivo).toBe("Unidad C-123ABC · Boleta 45678 · Exceso de velocidad en ruta CA-9");
    expect(motivo).not.toMatch(/usuario|autoriz|auditor/i);
  });

  it("11) cambiar responsable después del vínculo queda bloqueado", async () => {
    conn.query.mockImplementation(async (sql: string) => {
      if (sql.includes("ops_multas")) return [[filaMulta(colaboradorInput, { rrhh_descuento_id: 55 })], []];
      throw new Error("Consulta inesperada");
    });
    const response = await PATCH(req({ accion: "responsable", tipo_responsabilidad: "PILOTO", empleado_responsable_id: 6 }, "PATCH"), idCtx);
    expect(response.status).toBe(409);
    expect(conn.execute).not.toHaveBeenCalled();
  });

  it("12) cambiar resolución/monto después del vínculo queda bloqueado", async () => {
    conn.query.mockImplementation(async (sql: string) => {
      if (sql.includes("ops_multas")) return [[filaMulta(colaboradorInput, { rrhh_descuento_id: 55 })], []];
      throw new Error("Consulta inesperada");
    });
    const response = await PATCH(req({ accion: "resolucion", resolucion_economica: "EMPRESA", monto_empresa: "100.00", monto_colaborador: "0.00" }, "PATCH"), idCtx);
    expect(response.status).toBe(409);
    expect(conn.execute).not.toHaveBeenCalled();
  });

  it("13) anular una multa SIN descuento vinculado sigue permitido por el PATCH estándar", async () => {
    const response = await PATCH(req({ accion: "anular", motivo_anulacion: "Duplicada" }, "PATCH"), idCtx);
    expect(response.status).toBe(200);
  });

  // Corrección P1 — cancelarDescuentoInterno() es autoridad de RRHH:
  // anular-con-descuento exige multas:editar Y rrhh:descuentos:editar.
  it("P1.5) multas:editar=true / rrhh:descuentos:editar=false → 403, descuento no cancelado, multa no anulada", async () => {
    conn.query.mockImplementation(async (sql: string) => {
      if (sql.includes("rrhh_descuento_cuotas")) return [[{ aplicadas: 0 }], []];
      if (sql.includes("ops_multas")) return [[filaMulta(colaboradorInput, { rrhh_descuento_id: 55 })], []];
      throw new Error("Consulta inesperada");
    });
    vi.mocked(requireTenantRrhh).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantRrhh>>);
    const response = await postAnularConDescuento(req({ motivo_anulacion: "Boleta anulada" }), idCtx);
    expect(response.status).toBe(403);
    expect(requireTenantMultas).toHaveBeenCalledWith("prueba", "editar");
    expect(requireTenantRrhh).toHaveBeenCalledWith("prueba", "descuentos", "editar");
    expect(cancelarDescuentoInterno).not.toHaveBeenCalled();
    expect(getConnection).not.toHaveBeenCalled();
  });
  it("P1.6) multas:editar=false / rrhh:descuentos:editar=true → 403", async () => {
    vi.mocked(requireTenantMultas).mockResolvedValue({ error: new Response(null, { status: 403 }) } as Awaited<ReturnType<typeof requireTenantMultas>>);
    const response = await postAnularConDescuento(req({ motivo_anulacion: "Boleta anulada" }), idCtx);
    expect(response.status).toBe(403);
    expect(cancelarDescuentoInterno).not.toHaveBeenCalled();
    expect(getConnection).not.toHaveBeenCalled();
  });

  it("14) y P1.7) anular con descuento vinculado, AMBOS permisos, y SIN cuotas aplicadas: cancelación controlada en una transacción", async () => {
    conn.query.mockImplementation(async (sql: string) => {
      if (sql.includes("rrhh_descuento_cuotas")) return [[{ aplicadas: 0 }], []];
      if (sql.includes("ops_multas")) return [[filaMulta(colaboradorInput, { rrhh_descuento_id: 55 })], []];
      throw new Error("Consulta inesperada");
    });
    const response = await postAnularConDescuento(req({ motivo_anulacion: "Boleta anulada por la autoridad" }), idCtx);
    expect(response.status).toBe(200);
    expect(cancelarDescuentoInterno).toHaveBeenCalledWith(conn, 7, 55, expect.stringContaining("Multa #9 anulada"));
    const updateAnula = conn.execute.mock.calls.find(([sql]) => sql.includes("SET estado = 'ANULADA'"));
    expect(updateAnula).toBeTruthy();
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  it("15) y P1.8) anular con AMBOS permisos pero al menos una cuota YA aplicada: 409, sin cancelar ni anular nada", async () => {
    conn.query.mockImplementation(async (sql: string) => {
      if (sql.includes("rrhh_descuento_cuotas")) return [[{ aplicadas: 1 }], []];
      if (sql.includes("ops_multas")) return [[filaMulta(colaboradorInput, { rrhh_descuento_id: 55 })], []];
      throw new Error("Consulta inesperada");
    });
    const response = await postAnularConDescuento(req({ motivo_anulacion: "Intento de anular" }), idCtx);
    expect(response.status).toBe(409);
    const data = await response.json();
    expect(data.error).toMatch(/reversión\/ajuste/);
    expect(cancelarDescuentoInterno).not.toHaveBeenCalled();
    expect(conn.execute).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledTimes(1);
  });

  it("16) aislamiento de tenant: bandeja y vínculo siempre filtran/escriben por la empresa del guard", async () => {
    await getBandeja(new Request("http://localhost/x"), ctx);
    expect(vi.mocked(query).mock.calls[0][1]).toEqual([7]);
    await postVincular(req(config), multaCtx);
    expect(conn.query.mock.calls[0][1]).toEqual([7, 9]);
  });

  it("17) fallo de auditoría revierte la creación del descuento (rollback, sin commit)", async () => {
    conn.execute.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO auditoria")) throw new Error("Auditoría no disponible");
      if (sql.includes("SET rrhh_descuento_id")) return [{ affectedRows: 1 }, []];
      return [{ affectedRows: 1, insertId: 55 }, []];
    });
    const response = await postVincular(req(config), multaCtx);
    expect(response.status).toBe(500);
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("18) fallo al crear el descuento en RRHH: la multa queda sin vínculo (rollback, sin UPDATE de vínculo)", async () => {
    vi.mocked(crearDescuentoInterno).mockRejectedValue(new Error("Fallo del motor de descuentos"));
    const response = await postVincular(req(config), multaCtx);
    expect(response.status).toBe(500);
    expect(conn.execute).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("GET /multas lista enriquecida no rompe cuando ninguna fila tiene rrhh_descuento_id", async () => {
    vi.mocked(query).mockResolvedValue([{ ...filaMulta(empresaInput), placa_actual: "TEST-001" }] as unknown as Awaited<ReturnType<typeof query>>);
    const response = await getMultas(new Request("http://localhost/x?anio=2026&mes=8"), ctx);
    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data.multas[0].descuentoRrhh).toBeNull();
    expect(obtenerDescuento).not.toHaveBeenCalled();
  });
});
