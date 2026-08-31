import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ execute: vi.fn(), query: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn(), registrarAuditoriaTx: vi.fn() }));
vi.mock("@/lib/auth", () => ({ verificarPasswordUsuarioActual: vi.fn() }));
vi.mock("@/lib/firmas/firmas-internas", () => ({ crearFirmaInterna: vi.fn(), TEXTO_FIRMA_INTERNA: "Firma electrónica interna" }));
vi.mock("@/lib/uploads", () => ({ guardarUpload: vi.fn(), borrarUpload: vi.fn() }));

import { getPool } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { registrarEntregaViaticosMasiva, type DatosEntregaMasiva } from "./viaticos";

/**
 * VIATICOS-PAGO-MASIVO-1 — pruebas de registrarEntregaViaticosMasiva:
 * atomicidad TODO O NADA (rollback completo ante cualquier item que no
 * califique), FOR UPDATE + revalidación (concurrencia), N auditorías en
 * la MISMA transacción, commit único al final.
 */

const conn = {
  beginTransaction: vi.fn(),
  query: vi.fn(),
  execute: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
};
const getConnection = vi.fn();

function fila(id: number, overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id,
    estado: "AUTORIZADO",
    monto_asignado: "150.00",
    personal_nombre: `Persona ${id}`,
    cuenta_bancaria: "1234567890",
    ...overrides,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getPool).mockReturnValue({ getConnection } as unknown as ReturnType<typeof getPool>);
  getConnection.mockResolvedValue(conn);
  conn.execute.mockResolvedValue([{ affectedRows: 1 }, []]);
  conn.query.mockResolvedValue([[fila(10), fila(11)], []]);
});
afterEach(() => vi.restoreAllMocks());

describe("registrarEntregaViaticosMasiva — casos válidos (1/2/3)", () => {
  it("1) transferencia masiva válida", async () => {
    const datos: DatosEntregaMasiva = {
      metodoPago: "TRANSFERENCIA",
      items: [{ id: 10, referenciaPago: "LOTE-001" }, { id: 11, referenciaPago: "LOTE-001" }],
    };
    const r = await registrarEntregaViaticosMasiva(7, datos, "fact1");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.procesados).toBe(2);
      expect(r.total).toBe(300);
      expect(r.metodoPago).toBe("TRANSFERENCIA");
    }
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  it("2) cheque masivo válido con referencias individuales distintas", async () => {
    const datos: DatosEntregaMasiva = {
      metodoPago: "CHEQUE",
      items: [{ id: 10, referenciaPago: "CHQ-1001" }, { id: 11, referenciaPago: "CHQ-1002" }],
    };
    const r = await registrarEntregaViaticosMasiva(7, datos, "fact1");
    expect(r.ok).toBe(true);
    // Cada UPDATE lleva su PROPIA referencia — nunca la misma para ambos.
    expect(conn.execute).toHaveBeenCalledWith(expect.stringContaining("UPDATE tms_viaticos"), ["fact1", "CHEQUE", "CHQ-1001", 10, 7]);
    expect(conn.execute).toHaveBeenCalledWith(expect.stringContaining("UPDATE tms_viaticos"), ["fact1", "CHEQUE", "CHQ-1002", 11, 7]);
  });

  it("3) efectivo masivo válido", async () => {
    const datos: DatosEntregaMasiva = {
      metodoPago: "EFECTIVO",
      items: [{ id: 10, referenciaPago: null }, { id: 11, referenciaPago: null }],
    };
    const r = await registrarEntregaViaticosMasiva(7, datos, "fact1");
    expect(r.ok).toBe(true);
  });

  it("12) efectivo no exige referencia (referenciaPago null en todos, sin rechazo)", async () => {
    conn.query.mockResolvedValue([[fila(10, { cuenta_bancaria: null })], []]);
    const r = await registrarEntregaViaticosMasiva(7, { metodoPago: "EFECTIVO", items: [{ id: 10, referenciaPago: null }] }, "fact1");
    expect(r.ok).toBe(true);
  });
});

describe("registrarEntregaViaticosMasiva — validaciones de forma (4/5/11)", () => {
  it("4) ids vacíos -> 400, sin abrir conexión", async () => {
    const r = await registrarEntregaViaticosMasiva(7, { metodoPago: "EFECTIVO", items: [] }, "fact1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
    expect(getPool).not.toHaveBeenCalled();
  });

  it("5) ids duplicados -> 400, sin abrir conexión", async () => {
    const r = await registrarEntregaViaticosMasiva(
      7,
      { metodoPago: "EFECTIVO", items: [{ id: 10, referenciaPago: null }, { id: 10, referenciaPago: null }] },
      "fact1",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.error).toContain("repetidos");
    }
    expect(getPool).not.toHaveBeenCalled();
  });

  it("11) cheque sin referencia en algún item -> 400 rollback total, sin abrir conexión", async () => {
    const r = await registrarEntregaViaticosMasiva(
      7,
      { metodoPago: "CHEQUE", items: [{ id: 10, referenciaPago: "CHQ-1" }, { id: 11, referenciaPago: "" }] },
      "fact1",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.error).toContain("#11");
    }
    expect(getPool).not.toHaveBeenCalled();
  });

  it("cheques con números repetidos dentro del lote -> 400, sin abrir conexión", async () => {
    const r = await registrarEntregaViaticosMasiva(
      7,
      { metodoPago: "CHEQUE", items: [{ id: 10, referenciaPago: "CHQ-1" }, { id: 11, referenciaPago: "CHQ-1" }] },
      "fact1",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(400);
      expect(r.error).toContain("repetidos");
    }
    expect(getPool).not.toHaveBeenCalled();
  });

  it("límite de lote: más de LIMITE_LOTE_ENTREGA_MASIVA ids -> 400", async () => {
    const items = Array.from({ length: 201 }, (_, i) => ({ id: i + 1, referenciaPago: null }));
    const r = await registrarEntregaViaticosMasiva(7, { metodoPago: "EFECTIVO", items }, "fact1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
  });
});

describe("registrarEntregaViaticosMasiva — TODO O NADA (6/7/8/9/10)", () => {
  it("6) uno de otra empresa (no aparece en el SELECT filtrado por empresa_id) -> rollback total", async () => {
    conn.query.mockResolvedValue([[fila(10)], []]); // 11 no vuelve -> es de otra empresa o no existe
    const r = await registrarEntregaViaticosMasiva(
      7,
      { metodoPago: "EFECTIVO", items: [{ id: 10, referenciaPago: null }, { id: 11, referenciaPago: null }] },
      "fact1",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(409);
      expect(r.detalles?.some((d) => d.includes("#11"))).toBe(true);
    }
    expect(conn.execute).not.toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalled();
  });

  it("7) uno no está AUTORIZADO -> rollback total, ninguno se procesa", async () => {
    conn.query.mockResolvedValue([[fila(10), fila(11, { estado: "LIQUIDADO" })], []]);
    const r = await registrarEntregaViaticosMasiva(
      7,
      { metodoPago: "EFECTIVO", items: [{ id: 10, referenciaPago: null }, { id: 11, referenciaPago: null }] },
      "fact1",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.status).toBe(409);
      expect(r.detalles?.some((d) => d.includes("#11") && d.includes("LIQUIDADO"))).toBe(true);
    }
    expect(conn.execute).not.toHaveBeenCalled();
  });

  it("8) uno inexistente -> rollback total", async () => {
    conn.query.mockResolvedValue([[fila(10)], []]);
    const r = await registrarEntregaViaticosMasiva(
      7,
      { metodoPago: "EFECTIVO", items: [{ id: 10, referenciaPago: null }, { id: 999, referenciaPago: null }] },
      "fact1",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detalles?.some((d) => d.includes("#999") && d.includes("no existe"))).toBe(true);
    expect(conn.execute).not.toHaveBeenCalled();
  });

  it("9) monto inválido (0) -> rollback total", async () => {
    conn.query.mockResolvedValue([[fila(10), fila(11, { monto_asignado: "0.00" })], []]);
    const r = await registrarEntregaViaticosMasiva(
      7,
      { metodoPago: "EFECTIVO", items: [{ id: 10, referenciaPago: null }, { id: 11, referenciaPago: null }] },
      "fact1",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detalles?.some((d) => d.includes("#11") && d.includes("monto"))).toBe(true);
    expect(conn.execute).not.toHaveBeenCalled();
  });

  it("10) transferencia sin cuenta bancaria en alguno -> rollback total", async () => {
    conn.query.mockResolvedValue([[fila(10), fila(11, { cuenta_bancaria: null })], []]);
    const r = await registrarEntregaViaticosMasiva(
      7,
      { metodoPago: "TRANSFERENCIA", items: [{ id: 10, referenciaPago: "REF-1" }, { id: 11, referenciaPago: "REF-1" }] },
      "fact1",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detalles?.some((d) => d.includes("cuenta bancaria"))).toBe(true);
    expect(conn.execute).not.toHaveBeenCalled();
  });

  it("un problema entre varios NO impide reportar los demás — se devuelven TODOS los problemas", async () => {
    conn.query.mockResolvedValue([
      [fila(10, { estado: "LIQUIDADO" }), fila(11, { monto_asignado: "0" })],
      [],
    ]);
    const r = await registrarEntregaViaticosMasiva(
      7,
      { metodoPago: "EFECTIVO", items: [{ id: 10, referenciaPago: null }, { id: 11, referenciaPago: null }] },
      "fact1",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detalles).toHaveLength(2);
  });
});

describe("registrarEntregaViaticosMasiva — concurrencia (13/19)", () => {
  it("13) el SELECT usa FOR UPDATE", async () => {
    await registrarEntregaViaticosMasiva(7, { metodoPago: "EFECTIVO", items: [{ id: 10, referenciaPago: null }] }, "fact1");
    const [sql] = conn.query.mock.calls[0];
    expect(String(sql)).toContain("FOR UPDATE");
  });

  it("19) UPDATE con affectedRows=0 (otra transacción lo cambió justo entre el lock y el UPDATE) -> rollback total, nunca doble entrega", async () => {
    conn.execute
      .mockResolvedValueOnce([{ affectedRows: 1 }, []])
      .mockResolvedValueOnce([{ affectedRows: 0 }, []]);
    const r = await registrarEntregaViaticosMasiva(
      7,
      { metodoPago: "EFECTIVO", items: [{ id: 10, referenciaPago: null }, { id: 11, referenciaPago: null }] },
      "fact1",
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalled();
  });
});

describe("registrarEntregaViaticosMasiva — escritura/auditoría/commit (14/15/16/17/18/20)", () => {
  const datos: DatosEntregaMasiva = {
    metodoPago: "EFECTIVO",
    items: [{ id: 10, referenciaPago: null }, { id: 11, referenciaPago: null }],
  };

  it("14) entregado_por = usuario actual (nunca del cliente)", async () => {
    await registrarEntregaViaticosMasiva(7, datos, "fact1");
    for (const call of conn.execute.mock.calls) {
      expect(call[1][0]).toBe("fact1");
    }
  });

  it("15) entregado_en se fija con NOW() del servidor (nunca un valor recibido del cliente)", async () => {
    await registrarEntregaViaticosMasiva(7, datos, "fact1");
    const [sql] = conn.execute.mock.calls[0];
    expect(String(sql)).toContain("entregado_en = NOW()");
  });

  it("16) se registra auditoría por CADA viático, en la misma conexión/transacción", async () => {
    await registrarEntregaViaticosMasiva(7, datos, "fact1");
    expect(registrarAuditoriaTx).toHaveBeenCalledTimes(2);
    expect(registrarAuditoriaTx).toHaveBeenCalledWith(conn, expect.objectContaining({ detalle: expect.stringContaining("#10") }));
    expect(registrarAuditoriaTx).toHaveBeenCalledWith(conn, expect.objectContaining({ detalle: expect.stringContaining("#11") }));
  });

  it("17) si la auditoría de un item falla, se hace rollback TOTAL (ni ese ni los ya procesados quedan a medias)", async () => {
    vi.mocked(registrarAuditoriaTx).mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("fallo de auditoría"));
    await expect(registrarEntregaViaticosMasiva(7, datos, "fact1")).rejects.toThrow("fallo de auditoría");
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalled();
  });

  it("18) commit se llama UNA sola vez, después de todos los UPDATE/auditoría (camino exitoso)", async () => {
    await registrarEntregaViaticosMasiva(7, datos, "fact1");
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
  });

  it("20) respuesta procesados/total correcta", async () => {
    const r = await registrarEntregaViaticosMasiva(7, datos, "fact1");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.procesados).toBe(2);
      expect(r.total).toBe(300); // 150 + 150
    }
  });

  it("getConnection() falla -> propaga el error, sin commit ni auditoría", async () => {
    getConnection.mockRejectedValueOnce(new Error("pool exhausted"));
    await expect(registrarEntregaViaticosMasiva(7, datos, "fact1")).rejects.toThrow("pool exhausted");
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
  });
});
