import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ execute: vi.fn(), query: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoria: vi.fn(), registrarAuditoriaTx: vi.fn() }));
vi.mock("@/lib/auth", () => ({ verificarPasswordUsuarioActual: vi.fn() }));
vi.mock("@/lib/firmas/firmas-internas", () => ({ crearFirmaInterna: vi.fn(), TEXTO_FIRMA_INTERNA: "Firma electrónica interna" }));
vi.mock("@/lib/uploads", () => ({ guardarUpload: vi.fn(), borrarUpload: vi.fn() }));

import { execute, getPool, query } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { verificarPasswordUsuarioActual } from "@/lib/auth";
import { crearFirmaInterna } from "@/lib/firmas/firmas-internas";
import { sha256Hex } from "@/lib/firmas/imagen-firma";
import { borrarUpload, guardarUpload } from "@/lib/uploads";
import {
  autorizarViatico,
  liquidarViatico,
  listarViaticosControl,
  listarViaticosDePlan,
  listarViaticosPorPagar,
  rechazarViatico,
  registrarEntregaViatico,
  sincronizarViaticosPlan,
  type DatosFirmaViatico,
} from "./viaticos";

/**
 * VIATICOS-FIRMA — pruebas de autorizarViatico/liquidarViatico
 * (transición + firma electrónica interna + auditoría, todo en la misma
 * transacción). registrarEntregaViatico (pago) queda deliberadamente SIN
 * firma — ver ticket, sección PAGO — y NO se modificó en este ticket; se
 * incluye una prueba de regresión mínima (23) para dejar constancia de
 * que sigue sin exigir contraseña.
 *
 * VIATICOS-FIRMA-VISUAL — se agregan pruebas de la imagen PNG manuscrita:
 * se guarda a disco ANTES de abrir la transacción (guardarUpload no es
 * transaccional); si algo falla después (estado inválido, diferencia !=
 * 0, error inesperado), se compensa con borrarUpload (best-effort) para
 * no dejar el archivo huérfano; el SHA-256 de la imagen viaja al payload
 * firmado vía crearFirmaInterna(..., { imagen: {..., sha256} }).
 *
 * CORRECCIÓN URGENTE (autorizar sin contraseña) — autorizarViatico YA NO
 * llama a verificarPasswordUsuarioActual: sesión autenticada + permiso
 * (verificado por el endpoint) + firma manuscrita bastan. La firma pasa
 * a `crearFirmaInterna` con `metodo: 'FIRMA_MANUSCRITA'`. liquidarViatico
 * SIGUE exigiendo contraseña sin cambios (`metodo: 'PASSWORD'`).
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

// PNG mínimo (solo para pruebas de la lib — la validación real de magic
// bytes vive en src/lib/firmas/imagen-firma.ts y se ejerce en las pruebas
// del endpoint, no aquí: a esta capa el archivo ya llega validado).
const IMAGEN_BYTES = new TextEncoder().encode("firma-de-prueba").buffer;

// CORRECCIÓN URGENTE — sin `password`: autorizarViatico ya no lo exige.
const firma: DatosFirmaViatico = {
  usuarioId: 3,
  nombreFirmante: "Ana López",
  rolFirmante: "JefeOperaciones",
  imagen: { bytes: IMAGEN_BYTES, original: "firma.png" },
};

const VIATICO_PROGRAMADO = { id: 10, plan_id: 1, personal_id: 5, monto_asignado: "500.00", estado: "PROGRAMADO" };
const VIATICO_ENTREGADO = { id: 10, monto_asignado: "1000.00", estado: "ENTREGADO" };
const CTX_AUTORIZAR = { plan_codigo: "PLAN-1", personal_nombre: "Carlos Ruiz" };

type Overrides = {
  viatico?: Record<string, unknown> | null;
  ctx?: Record<string, unknown> | null;
};

function mockConnQuery(o: Overrides = {}) {
  conn.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM tms_viaticos WHERE id = ? AND empresa_id = ?")) {
      const v = "viatico" in o ? o.viatico : VIATICO_PROGRAMADO;
      return [v ? [v] : []];
    }
    if (sql.includes("FROM tms_planes_viaje pl, tms_personal tp")) {
      const c = "ctx" in o ? o.ctx : CTX_AUTORIZAR;
      return [c ? [c] : []];
    }
    throw new Error(`Consulta inesperada: ${sql}`);
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getPool).mockReturnValue({ getConnection } as unknown as ReturnType<typeof getPool>);
  getConnection.mockResolvedValue(conn);
  conn.execute.mockResolvedValue([{ affectedRows: 1 }, []]);
  vi.mocked(verificarPasswordUsuarioActual).mockResolvedValue(true);
  vi.mocked(guardarUpload).mockResolvedValue({ relative: "empresas/7/firmas/firma_x.png", original: "firma.png", size: 15 });
  vi.mocked(crearFirmaInterna).mockResolvedValue({
    id: 1, codigoFirma: "SIG-20260828-ABCD1234", fechaHoraServidor: new Date("2026-08-28T15:00:00Z"),
    hashPayload: "a".repeat(64), nombreFirmante: "Ana López", rolFirmante: "JefeOperaciones", tieneImagen: true,
  });
  mockConnQuery();
});
afterEach(() => vi.restoreAllMocks());

describe("autorizarViatico — PROGRAMADO -> AUTORIZADO con firma", () => {
  it("1/2) CORRECCIÓN URGENTE: autoriza SIN password (firma no lo trae) y NUNCA llama verificarPasswordUsuarioActual — la identidad ya la garantizó el permiso verificado por el endpoint", async () => {
    const r = await autorizarViatico(7, 10, "jefe1", firma);
    expect(r.ok).toBe(true);
    expect(verificarPasswordUsuarioActual).not.toHaveBeenCalled();
  });

  it("6) autorización EXITOSA crea la firma con accion=AUTORIZAR_VIATICO/modulo=VIATICOS/entidad_tipo=VIATICO", async () => {
    const r = await autorizarViatico(7, 10, "jefe1", firma);
    expect(r.ok).toBe(true);
    expect(crearFirmaInterna).toHaveBeenCalledWith(conn, expect.objectContaining({
      empresaId: 7, usuarioId: 3, accion: "AUTORIZAR_VIATICO", modulo: "VIATICOS",
      entidadTipo: "VIATICO", entidadId: 10,
      valoresRelevantes: expect.objectContaining({ viaticoId: 10, planId: 1, beneficiario: "Carlos Ruiz", montoAsignado: 500 }),
    }));
  });

  it("13) CORRECCIÓN URGENTE: crearFirmaInterna recibe metodo: 'FIRMA_MANUSCRITA' (nunca 'PASSWORD') al autorizar", async () => {
    await autorizarViatico(7, 10, "jefe1", firma);
    expect(crearFirmaInterna).toHaveBeenCalledWith(conn, expect.objectContaining({ metodo: "FIRMA_MANUSCRITA" }));
  });

  it("VIATICOS-FIRMA-VISUAL: guarda la imagen ANTES de abrir la transacción y la asocia a la firma con su SHA-256", async () => {
    const r = await autorizarViatico(7, 10, "jefe1", firma);
    expect(r.ok).toBe(true);
    expect(guardarUpload).toHaveBeenCalledWith(
      7, "firmas", "firma_viatico_autorizar_10",
      expect.objectContaining({ name: "firma.png", size: IMAGEN_BYTES.byteLength }),
    );
    // Orden: guardarUpload (fuera de transacción) antes de getConnection (abre la transacción).
    expect(vi.mocked(guardarUpload).mock.invocationCallOrder[0]).toBeLessThan(getConnection.mock.invocationCallOrder[0]);
    expect(crearFirmaInterna).toHaveBeenCalledWith(conn, expect.objectContaining({
      imagen: {
        relative: "empresas/7/firmas/firma_x.png",
        original: "firma.png",
        mime: "image/png",
        size: 15,
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    }));
  });

  it("hotfix PR #124: firmaLote no viene (flujo individual) -> el payload NO incluye la clave firmaLote", async () => {
    await autorizarViatico(7, 10, "jefe1", firma); // firma no trae firmaLote
    expect(crearFirmaInterna).toHaveBeenCalledWith(conn, expect.objectContaining({
      valoresRelevantes: expect.not.objectContaining({ firmaLote: expect.anything() }),
    }));
  });

  it("hotfix PR #124: firmaLote: true (bandeja masiva) -> el payload firmado incluye firmaLote: true", async () => {
    await autorizarViatico(7, 10, "jefe1", { ...firma, firmaLote: true });
    expect(crearFirmaInterna).toHaveBeenCalledWith(conn, expect.objectContaining({
      valoresRelevantes: expect.objectContaining({ viaticoId: 10, firmaLote: true }),
    }));
  });

  it("hotfix PR #124: autorizarViatico — getConnection() falla -> compensa la imagen ya guardada, no crea firma ni auditoría, no cambia estado, propaga el error", async () => {
    getConnection.mockRejectedValueOnce(new Error("pool exhausted"));
    await expect(autorizarViatico(7, 10, "jefe1", firma)).rejects.toThrow("pool exhausted");
    // La imagen SÍ se había guardado (password ya verificado ANTES de intentar la conexión).
    expect(guardarUpload).toHaveBeenCalledTimes(1);
    expect(borrarUpload).toHaveBeenCalledWith("empresas/7/firmas/firma_x.png");
    expect(crearFirmaInterna).not.toHaveBeenCalled();
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
    expect(conn.execute).not.toHaveBeenCalled(); // ningún UPDATE de estado
    // `conn` nunca llegó a obtenerse: no hay conexión sobre la que hacer rollback/release.
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).not.toHaveBeenCalled();
  });

  it("hotfix PR #124: beginTransaction() falla (conn SÍ se obtuvo) -> también compensa, intenta rollback y libera la conexión", async () => {
    conn.beginTransaction.mockRejectedValueOnce(new Error("connection reset"));
    await expect(autorizarViatico(7, 10, "jefe1", firma)).rejects.toThrow("connection reset");
    expect(borrarUpload).toHaveBeenCalledWith("empresas/7/firmas/firma_x.png");
    expect(crearFirmaInterna).not.toHaveBeenCalled();
    // conn SÍ se obtuvo (a diferencia del caso getConnection() falla) -> se intenta rollback y SIEMPRE se libera.
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalled();
  });

  it("estado != PROGRAMADO rechaza (409) sin firmar y COMPENSA borrando la imagen ya guardada", async () => {
    mockConnQuery({ viatico: { ...VIATICO_PROGRAMADO, estado: "AUTORIZADO" } });
    const r = await autorizarViatico(7, 10, "jefe1", firma);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
    expect(crearFirmaInterna).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalled();
    // VIATICOS-FIRMA-VISUAL: compensación — el archivo ya se había escrito, no debe quedar huérfano.
    expect(borrarUpload).toHaveBeenCalledWith("empresas/7/firmas/firma_x.png");
  });

  it("18) firma + transición + auditoría son atómicas: se hace commit UNA sola vez y solo tras firmar (sin compensación en el camino exitoso)", async () => {
    await autorizarViatico(7, 10, "jefe1", firma);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(borrarUpload).not.toHaveBeenCalled();
    // La auditoría se registra DENTRO de la misma conexión/transacción (registrarAuditoriaTx con conn), nunca aparte.
    expect(registrarAuditoriaTx).toHaveBeenCalledWith(conn, expect.objectContaining({
      empresaId: 7, accion: "autorizar_viatico", modulo: "tms",
    }));
  });

  it("20) el detalle de auditoría incluye el código de firma (trazabilidad cruzada)", async () => {
    await autorizarViatico(7, 10, "jefe1", firma);
    const detalle = vi.mocked(registrarAuditoriaTx).mock.calls[0][1].detalle;
    expect(detalle).toContain("SIG-20260828-ABCD1234");
  });

  it("viático inexistente -> 404, sin firmar, compensa la imagen", async () => {
    mockConnQuery({ viatico: null });
    const r = await autorizarViatico(7, 999, "jefe1", firma);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
    expect(crearFirmaInterna).not.toHaveBeenCalled();
    expect(borrarUpload).toHaveBeenCalledWith("empresas/7/firmas/firma_x.png");
  });

  it("MI-FIRMA-1 — 12/13) origenFirma:'GUARDADA' se propaga a crearFirmaInterna y guardarImagenFirma sigue calculando el SHA-256 real de los bytes recibidos (copia independiente, mismo hash del origen)", async () => {
    await autorizarViatico(7, 10, "jefe1", { ...firma, origenFirma: "GUARDADA" });
    expect(crearFirmaInterna).toHaveBeenCalledWith(conn, expect.objectContaining({
      origenFirma: "GUARDADA",
      imagen: expect.objectContaining({ sha256: sha256Hex(IMAGEN_BYTES) }),
    }));
  });

  it("MI-FIRMA-1 — 17) origenFirma:'DIBUJADA' (o ausente) se propaga igual, sin afectar el resto del flujo", async () => {
    await autorizarViatico(7, 10, "jefe1", { ...firma, origenFirma: "DIBUJADA" });
    expect(crearFirmaInterna).toHaveBeenCalledWith(conn, expect.objectContaining({ origenFirma: "DIBUJADA" }));
  });
});

describe("liquidarViatico — ENTREGADO -> LIQUIDADO, regla crítica de diferencia === 0 exacto", () => {
  const firmaFacturador: DatosFirmaViatico = {
    usuarioId: 8, nombreFirmante: "Marta Ruiz", rolFirmante: "Facturador", password: "clave456",
    imagen: { bytes: IMAGEN_BYTES, original: "firma.png" },
  };

  it("11) gastos 900 + reintegro 100 sobre entregado 1000 -> diferencia 0, SÍ liquida", async () => {
    mockConnQuery({ viatico: VIATICO_ENTREGADO });
    const r = await liquidarViatico(7, 10, { gastosComprobados: "900.00", reintegro: "100.00", observaciones: null }, "fact1", firmaFacturador);
    expect(r.ok).toBe(true);
  });

  it("12) gastos 1000 + reintegro 0 sobre entregado 1000 -> diferencia 0, SÍ liquida", async () => {
    mockConnQuery({ viatico: VIATICO_ENTREGADO });
    const r = await liquidarViatico(7, 10, { gastosComprobados: "1000.00", reintegro: "0", observaciones: null }, "fact1", firmaFacturador);
    expect(r.ok).toBe(true);
  });

  it("hotfix PR #124: liquidarViatico — getConnection() falla -> compensa la imagen ya guardada, no crea firma ni auditoría, no cambia estado, propaga el error", async () => {
    getConnection.mockRejectedValueOnce(new Error("pool exhausted"));
    await expect(
      liquidarViatico(7, 10, { gastosComprobados: "900.00", reintegro: "100.00", observaciones: null }, "fact1", firmaFacturador),
    ).rejects.toThrow("pool exhausted");
    expect(guardarUpload).toHaveBeenCalledTimes(1);
    expect(borrarUpload).toHaveBeenCalledWith("empresas/7/firmas/firma_x.png");
    expect(crearFirmaInterna).not.toHaveBeenCalled();
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
    expect(conn.execute).not.toHaveBeenCalled();
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).not.toHaveBeenCalled();
  });

  it("13) gastos 950 + reintegro 0 sobre entregado 1000 -> diferencia 50 (pendiente), NO liquida, estado sigue ENTREGADO, COMPENSA la imagen", async () => {
    mockConnQuery({ viatico: VIATICO_ENTREGADO });
    const r = await liquidarViatico(7, 10, { gastosComprobados: "950.00", reintegro: "0", observaciones: null }, "fact1", firmaFacturador);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.status).toBe(409); expect(r.error).toContain("Pendiente por comprobar o reintegrar: Q50.00"); }
    expect(conn.execute).not.toHaveBeenCalled(); // ningún UPDATE se ejecutó
    expect(crearFirmaInterna).not.toHaveBeenCalled();
    expect(borrarUpload).toHaveBeenCalledWith("empresas/7/firmas/firma_x.png");
  });

  it("14) gastos 1000 + reintegro 100 sobre entregado 1000 -> diferencia -100, NO liquida (superan lo entregado), COMPENSA la imagen", async () => {
    mockConnQuery({ viatico: VIATICO_ENTREGADO });
    const r = await liquidarViatico(7, 10, { gastosComprobados: "1000.00", reintegro: "100.00", observaciones: null }, "fact1", firmaFacturador);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.status).toBe(409); expect(r.error).toContain("superan el monto entregado"); }
    expect(borrarUpload).toHaveBeenCalledWith("empresas/7/firmas/firma_x.png");
  });

  it("15) decisión monetaria EXACTA, no float: 300.30 - 100.10 - 200.20 = 0.00 exacto (un float directo puede dar un residuo distinto de 0)", async () => {
    mockConnQuery({ viatico: { ...VIATICO_ENTREGADO, monto_asignado: "300.30" } });
    // Prueba de control: la resta directa en float NO da exactamente 0 —
    // confirma que el caso realmente ejercita el camino "exacto".
    expect(300.30 - 100.10 - 200.20).not.toBe(0);
    const r = await liquidarViatico(7, 10, { gastosComprobados: "100.10", reintegro: "200.20", observaciones: null }, "fact1", firmaFacturador);
    expect(r.ok).toBe(true);
  });

  it("16/17) liquidación EXITOSA crea la firma con accion=LIQUIDAR_VIATICO, metodo='PASSWORD' (CORRECCIÓN URGENTE: liquidar SIGUE exigiendo contraseña, sin cambios), el payload con montoEntregado/gastos/reintegro/diferencia, la imagen con su SHA-256, y NO compensa (commit exitoso)", async () => {
    mockConnQuery({ viatico: VIATICO_ENTREGADO });
    await liquidarViatico(7, 10, { gastosComprobados: "900.00", reintegro: "100.00", observaciones: "ok" }, "fact1", firmaFacturador);
    expect(guardarUpload).toHaveBeenCalledWith(7, "firmas", "firma_viatico_liquidar_10", expect.anything());
    expect(crearFirmaInterna).toHaveBeenCalledWith(conn, expect.objectContaining({
      accion: "LIQUIDAR_VIATICO", modulo: "VIATICOS", entidadTipo: "VIATICO", entidadId: 10, metodo: "PASSWORD",
      valoresRelevantes: expect.objectContaining({
        viaticoId: 10, montoEntregado: "1000.00", gastosComprobados: "900.00", reintegro: "100.00", diferencia: "0.00",
      }),
      imagen: expect.objectContaining({ mime: "image/png", sha256: expect.stringMatching(/^[0-9a-f]{64}$/) }),
    }));
    expect(conn.commit).toHaveBeenCalledTimes(1);
    // hotfix PR #124: commit exitoso -> NUNCA se compensa/borra la imagen ya asociada.
    expect(borrarUpload).not.toHaveBeenCalled();
  });

  it("17) doble liquidación bloqueada: el segundo intento ya no encuentra ENTREGADO -> 409, sin nueva firma, compensa", async () => {
    mockConnQuery({ viatico: { ...VIATICO_ENTREGADO, estado: "LIQUIDADO" } });
    const r = await liquidarViatico(7, 10, { gastosComprobados: "1000.00", reintegro: "0", observaciones: null }, "fact1", firmaFacturador);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
    expect(crearFirmaInterna).not.toHaveBeenCalled();
    expect(borrarUpload).toHaveBeenCalledWith("empresas/7/firmas/firma_x.png");
  });

  it("VIATICOS-RECHAZADO-1 (27) — un viático RECHAZADO nunca es liquidable (misma regla que cualquier estado != ENTREGADO)", async () => {
    mockConnQuery({ viatico: { ...VIATICO_ENTREGADO, estado: "RECHAZADO" } });
    const r = await liquidarViatico(7, 10, { gastosComprobados: "1000.00", reintegro: "0", observaciones: null }, "fact1", firmaFacturador);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
    expect(crearFirmaInterna).not.toHaveBeenCalled();
  });

  it("18) atomicidad: commit único tras firmar, rollback si la diferencia no es 0", async () => {
    mockConnQuery({ viatico: VIATICO_ENTREGADO });
    await liquidarViatico(7, 10, { gastosComprobados: "950.00", reintegro: "0", observaciones: null }, "fact1", firmaFacturador);
    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
  });

  it("MI-FIRMA-1 — 22/23) origenFirma:'GUARDADA' se propaga a crearFirmaInterna SIN afectar que password/metodo:'PASSWORD' sigan obligatorios", async () => {
    mockConnQuery({ viatico: VIATICO_ENTREGADO });
    await liquidarViatico(7, 10, { gastosComprobados: "900.00", reintegro: "100.00", observaciones: null }, "fact1", { ...firmaFacturador, origenFirma: "GUARDADA" });
    expect(crearFirmaInterna).toHaveBeenCalledWith(conn, expect.objectContaining({
      origenFirma: "GUARDADA",
      metodo: "PASSWORD",
      imagen: expect.objectContaining({ sha256: sha256Hex(IMAGEN_BYTES) }),
    }));
  });

  it("MI-FIRMA-1 — 24) usar firma guardada no exime la regla de diferencia exacta: si no cuadra, sigue rechazando (409) aun con origenFirma:'GUARDADA'", async () => {
    mockConnQuery({ viatico: VIATICO_ENTREGADO });
    const r = await liquidarViatico(7, 10, { gastosComprobados: "950.00", reintegro: "0", observaciones: null }, "fact1", { ...firmaFacturador, origenFirma: "GUARDADA" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
    expect(crearFirmaInterna).not.toHaveBeenCalled();
  });

  it("monto/formato inválido se rechaza ANTES de verificar contraseña, abrir conexión o guardar la imagen", async () => {
    const r = await liquidarViatico(7, 10, { gastosComprobados: "no-es-numero", reintegro: "0", observaciones: null }, "fact1", firmaFacturador);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
    expect(verificarPasswordUsuarioActual).not.toHaveBeenCalled();
    expect(getConnection).not.toHaveBeenCalled();
    expect(guardarUpload).not.toHaveBeenCalled();
  });

  it("5) contraseña incorrecta: 401, NO crea firma, NO cambia estado, NO registra auditoría transaccional, NO guarda la imagen — nunca abre la transacción", async () => {
    vi.mocked(verificarPasswordUsuarioActual).mockResolvedValue(false);
    const r = await liquidarViatico(7, 10, { gastosComprobados: "900.00", reintegro: "100.00", observaciones: null }, "fact1", firmaFacturador);
    expect(r.ok).toBe(false);
    if (!r.ok) { expect(r.status).toBe(401); expect(r.error).toContain("Contraseña incorrecta"); }
    expect(getConnection).not.toHaveBeenCalled();
    expect(crearFirmaInterna).not.toHaveBeenCalled();
    expect(conn.execute).not.toHaveBeenCalled();
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(guardarUpload).not.toHaveBeenCalled();
  });

  it("VIATICOS-FIRMA-VISUAL: autorizar y liquidar generan prefijos de archivo independientes (nunca reutilizan la misma imagen entre acciones)", async () => {
    mockConnQuery({ viatico: VIATICO_PROGRAMADO });
    await autorizarViatico(7, 10, "jefe1", firma);
    const prefijoAutorizar = vi.mocked(guardarUpload).mock.calls[0][2];

    vi.mocked(guardarUpload).mockClear();
    mockConnQuery({ viatico: VIATICO_ENTREGADO });
    await liquidarViatico(7, 10, { gastosComprobados: "1000.00", reintegro: "0", observaciones: null }, "fact1", firmaFacturador);
    const prefijoLiquidar = vi.mocked(guardarUpload).mock.calls[0][2];

    expect(prefijoAutorizar).not.toBe(prefijoLiquidar);
    expect(prefijoAutorizar).toContain("autorizar");
    expect(prefijoLiquidar).toContain("liquidar");
  });
});

describe("23) registrarEntregaViatico (pago) — regresión: NUNCA exige firma/contraseña/imagen", () => {
  beforeEach(() => {
    vi.mocked(execute).mockResolvedValue({ affectedRows: 1 } as never);
  });

  it("registra la entrega solo con método/referencia/observaciones — sin password ni firma en su firma de función", async () => {
    const r = await registrarEntregaViatico(7, 10, { metodoPago: "EFECTIVO", referenciaPago: null, observaciones: null }, "fact1");
    expect(r.ok).toBe(true);
    expect(crearFirmaInterna).not.toHaveBeenCalled();
    expect(verificarPasswordUsuarioActual).not.toHaveBeenCalled();
    expect(guardarUpload).not.toHaveBeenCalled();
    // No usa transacción propia (execute() directo) — mismo patrón preexistente, sin cambios de este ticket.
    expect(getConnection).not.toHaveBeenCalled();
  });

  it('exige referencia para TRANSFERENCIA/CHEQUE (regla preexistente, sin cambios)', async () => {
    const r = await registrarEntregaViatico(7, 10, { metodoPago: "CHEQUE", referenciaPago: null, observaciones: null }, "fact1");
    expect(r.ok).toBe(false);
  });
});

/**
 * VIATICOS-RECHAZADO-1 — PROGRAMADO -> RECHAZADO, terminal, sin firma
 * (mismo esqueleto transaccional que autorizarViatico/liquidarViatico,
 * sin manejo de imágenes — reutiliza mockConnQuery() tal cual, el SELECT
 * de rechazarViatico usa el mismo patrón "FROM tms_viaticos WHERE id = ?
 * AND empresa_id = ?" que ya reconoce el helper).
 */
describe("rechazarViatico — PROGRAMADO -> RECHAZADO", () => {
  const MOTIVO_VALIDO = "No corresponde: el viaje fue cancelado por el cliente.";

  beforeEach(() => {
    mockConnQuery({ viatico: VIATICO_PROGRAMADO });
  });

  it("1) PROGRAMADO puede rechazarse", async () => {
    const r = await rechazarViatico(7, 10, MOTIVO_VALIDO, "jefe1");
    expect(r.ok).toBe(true);
    expect(conn.commit).toHaveBeenCalledTimes(1);
  });

  it("2) AUTORIZADO no puede rechazarse -> 409", async () => {
    mockConnQuery({ viatico: { ...VIATICO_PROGRAMADO, estado: "AUTORIZADO" } });
    const r = await rechazarViatico(7, 10, MOTIVO_VALIDO, "jefe1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
    expect(conn.execute).not.toHaveBeenCalled();
  });

  it("3) ENTREGADO no puede rechazarse -> 409", async () => {
    mockConnQuery({ viatico: VIATICO_ENTREGADO });
    const r = await rechazarViatico(7, 10, MOTIVO_VALIDO, "jefe1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
  });

  it("4) LIQUIDADO no puede rechazarse -> 409", async () => {
    mockConnQuery({ viatico: { ...VIATICO_ENTREGADO, estado: "LIQUIDADO" } });
    const r = await rechazarViatico(7, 10, MOTIVO_VALIDO, "jefe1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
  });

  it("5) RECHAZADO no puede rechazarse otra vez -> 409 (terminal, sin RECHAZADO -> PROGRAMADO)", async () => {
    mockConnQuery({ viatico: { ...VIATICO_PROGRAMADO, estado: "RECHAZADO" } });
    const r = await rechazarViatico(7, 10, MOTIVO_VALIDO, "jefe1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
  });

  it("33) RECHAZADO es terminal: ninguna llamada de autorizarViatico sobre una fila ya RECHAZADO la mueve a AUTORIZADO", async () => {
    mockConnQuery({ viatico: { ...VIATICO_PROGRAMADO, estado: "RECHAZADO" } });
    const r = await autorizarViatico(7, 10, "jefe1", firma);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
    expect(crearFirmaInterna).not.toHaveBeenCalled();
  });

  it("6) motivo con menos de 10 caracteres -> 400, sin abrir conexión", async () => {
    const r = await rechazarViatico(7, 10, "muy corto", "jefe1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
    expect(getPool).not.toHaveBeenCalled();
  });

  it("7) motivo con más de 300 caracteres -> 400, sin abrir conexión", async () => {
    const r = await rechazarViatico(7, 10, "x".repeat(301), "jefe1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(400);
    expect(getPool).not.toHaveBeenCalled();
  });

  it("motivo se recorta (trim) antes de validar longitud y de guardar", async () => {
    const r = await rechazarViatico(7, 10, `   ${MOTIVO_VALIDO}   `, "jefe1");
    expect(r.ok).toBe(true);
    expect(conn.execute).toHaveBeenCalledWith(expect.any(String), ["jefe1", MOTIVO_VALIDO, 10, 7]);
  });

  it("8) otro tenant: empresaId siempre filtra el SELECT — un viático de otra empresa da 404, nunca lo rechaza", async () => {
    mockConnQuery({ viatico: null });
    const r = await rechazarViatico(999, 10, MOTIVO_VALIDO, "jefe1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
    expect(conn.execute).not.toHaveBeenCalled();
  });

  it("12) el SELECT usa FOR UPDATE", async () => {
    await rechazarViatico(7, 10, MOTIVO_VALIDO, "jefe1");
    const [sql] = conn.query.mock.calls[0];
    expect(String(sql)).toContain("FOR UPDATE");
  });

  it("13) el UPDATE está condicionado a estado = 'PROGRAMADO'", async () => {
    await rechazarViatico(7, 10, MOTIVO_VALIDO, "jefe1");
    const [sql] = conn.execute.mock.calls[0];
    expect(String(sql)).toContain("estado = 'PROGRAMADO'");
    expect(String(sql)).toContain("estado = 'RECHAZADO'");
  });

  it("14) affectedRows != 1 en el UPDATE -> 409, sin auditoría ni commit", async () => {
    conn.execute.mockResolvedValue([{ affectedRows: 0 }, []]);
    const r = await rechazarViatico(7, 10, MOTIVO_VALIDO, "jefe1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(409);
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalled();
  });

  it("15) registra auditoría accion=rechazar_viatico modulo=tms con el motivo en el detalle, en la MISMA conexión", async () => {
    await rechazarViatico(7, 10, MOTIVO_VALIDO, "jefe1");
    expect(registrarAuditoriaTx).toHaveBeenCalledWith(conn, expect.objectContaining({
      empresaId: 7, usuario: "jefe1", accion: "rechazar_viatico", modulo: "tms",
      detalle: expect.stringContaining(MOTIVO_VALIDO),
    }));
    expect(String(vi.mocked(registrarAuditoriaTx).mock.calls[0][1].detalle)).toContain("PROGRAMADO → RECHAZADO");
  });

  it("16) si la auditoría falla, se hace rollback total (nunca queda el UPDATE sin su auditoría)", async () => {
    vi.mocked(registrarAuditoriaTx).mockRejectedValueOnce(new Error("fallo de auditoría"));
    await expect(rechazarViatico(7, 10, MOTIVO_VALIDO, "jefe1")).rejects.toThrow("fallo de auditoría");
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalled();
  });

  it("17) rechazar NUNCA crea firma — no llama crearFirmaInterna/guardarUpload en ningún punto", async () => {
    await rechazarViatico(7, 10, MOTIVO_VALIDO, "jefe1");
    expect(crearFirmaInterna).not.toHaveBeenCalled();
    expect(guardarUpload).not.toHaveBeenCalled();
    expect(verificarPasswordUsuarioActual).not.toHaveBeenCalled();
  });

  it("18) commit se llama UNA sola vez, después del UPDATE y la auditoría (camino exitoso)", async () => {
    await rechazarViatico(7, 10, MOTIVO_VALIDO, "jefe1");
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(conn.rollback).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledTimes(1);
  });

  it("viático inexistente -> 404, sin auditoría", async () => {
    mockConnQuery({ viatico: null });
    const r = await rechazarViatico(7, 999, MOTIVO_VALIDO, "jefe1");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.status).toBe(404);
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
  });

  it("32) concurrencia: si otro proceso ya autorizó el viático antes de que llegue el rechazo (el SELECT lo lee ya AUTORIZADO), rechazar recibe 409 — nunca ambas transiciones", async () => {
    mockConnQuery({ viatico: { ...VIATICO_PROGRAMADO, estado: "AUTORIZADO" } });
    const rRechazo = await rechazarViatico(7, 10, MOTIVO_VALIDO, "jefe1");
    expect(rRechazo.ok).toBe(false);
    if (!rRechazo.ok) expect(rRechazo.status).toBe(409);

    mockConnQuery({ viatico: { ...VIATICO_PROGRAMADO, estado: "RECHAZADO" } });
    const rAutorizar = await autorizarViatico(7, 10, "jefe1", firma);
    expect(rAutorizar.ok).toBe(false);
    if (!rAutorizar.ok) expect(rAutorizar.status).toBe(409);
  });

  it("getConnection() falla -> propaga el error, sin auditoría ni commit", async () => {
    getConnection.mockRejectedValueOnce(new Error("pool exhausted"));
    await expect(rechazarViatico(7, 10, MOTIVO_VALIDO, "jefe1")).rejects.toThrow("pool exhausted");
    expect(registrarAuditoriaTx).not.toHaveBeenCalled();
  });
});

/**
 * VIATICOS-RECHAZADO-1 — listarViaticosControl/mapDetalle deben conocer
 * RECHAZADO igual que los demás estados: contador propio, filtro, y los
 * 3 campos nuevos (rechazadoPor/rechazadoEn/motivoRechazo) en el detalle
 * — mismo SELECT/mapeo existente (DETALLE_SELECT), sin N+1.
 */
describe("listarViaticosControl / mapDetalle — RECHAZADO", () => {
  it("18) el resumen cuenta 'rechazados' igual que los demás estados", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([
        { estado: "PROGRAMADO", total: 2 },
        { estado: "RECHAZADO", total: 3 },
        { estado: "AUTORIZADO", total: 1 },
      ] as never)
      .mockResolvedValueOnce([] as never);
    const { resumen } = await listarViaticosControl(7);
    expect(resumen).toEqual({ pendientes: 2, autorizados: 1, rechazados: 3, entregados: 0, liquidados: 0 });
  });

  it("19) filtro estado=RECHAZADO solo devuelve filas rechazadas", async () => {
    vi.mocked(query)
      .mockResolvedValueOnce([] as never)
      .mockResolvedValueOnce([{
        id: 10, plan_id: 1, personal_id: 5, rol: "Piloto", monto_sugerido: "500", monto_asignado: "500",
        estado: "RECHAZADO", plan_codigo: "PLAN-1", fecha_plan: "2026-08-01", personal_nombre: "Carlos Ruiz",
        puesto: "Piloto", rechazado_por: "jefe1", rechazado_en: "2026-08-31 09:00:00",
        motivo_rechazo: "No corresponde: viaje cancelado.",
      }] as never);
    const { items } = await listarViaticosControl(7, { estado: "RECHAZADO" });
    expect(items).toHaveLength(1);
    expect(items[0].estado).toBe("RECHAZADO");
    const [, params] = vi.mocked(query).mock.calls[1];
    expect(params).toContain("RECHAZADO");
  });

  it("20/21/22) mapDetalle expone motivoRechazo/rechazadoPor/rechazadoEn desde el mismo SELECT (sin consulta adicional)", async () => {
    vi.mocked(query).mockResolvedValueOnce([{
      id: 10, plan_id: 1, personal_id: 5, rol: "Piloto", monto_sugerido: "500", monto_asignado: "500",
      estado: "RECHAZADO", plan_codigo: "PLAN-1", fecha_plan: "2026-08-01", personal_nombre: "Carlos Ruiz",
      puesto: "Piloto", rechazado_por: "jefe1", rechazado_en: "2026-08-31 09:00:00",
      motivo_rechazo: "No corresponde: viaje cancelado.",
    }] as never);
    const items = await listarViaticosDePlan(7, 1);
    expect(items[0]).toMatchObject({
      rechazadoPor: "jefe1", rechazadoEn: "2026-08-31 09:00:00", motivoRechazo: "No corresponde: viaje cancelado.",
    });
    // Un solo SELECT — sin N+1 para traer los datos de rechazo.
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("un viático NO rechazado tiene los 3 campos en null", async () => {
    vi.mocked(query).mockResolvedValueOnce([{
      id: 10, plan_id: 1, personal_id: 5, rol: "Piloto", monto_sugerido: "500", monto_asignado: "500",
      estado: "PROGRAMADO", plan_codigo: "PLAN-1", fecha_plan: "2026-08-01", personal_nombre: "Carlos Ruiz",
      puesto: "Piloto",
    }] as never);
    const items = await listarViaticosDePlan(7, 1);
    expect(items[0]).toMatchObject({ rechazadoPor: null, rechazadoEn: null, motivoRechazo: null });
  });
});

/**
 * VIATICOS-RECHAZADO-1 (sección 12) — RECHAZADO NUNCA debe aparecer en
 * la bandeja del Facturador, ni siquiera con filtro "Todos". La
 * exclusión vive en el backend (listarViaticosPorPagar), no solo en la
 * UI.
 */
describe("listarViaticosPorPagar — excluye RECHAZADO (24)", () => {
  it("sin filtro de estado (\"Todos\"): el WHERE excluye RECHAZADO de forma incondicional", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await listarViaticosPorPagar(7, {});
    const [sql] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("v.estado != 'RECHAZADO'");
  });

  it("aunque se pida explícitamente estado='RECHAZADO', la exclusión incondicional sigue en el WHERE (AND contradictorio -> nunca resultados)", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    await listarViaticosPorPagar(7, { estado: "RECHAZADO" });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("v.estado != 'RECHAZADO'");
    expect(params).toContain("RECHAZADO");
  });
});

/**
 * VIATICOS-RECHAZADO-1 (sección 14) — Programación debe preservar la
 * fila RECHAZADO igual que AUTORIZADO/ENTREGADO/LIQUIDADO: la protección
 * de sincronizarViaticosPlan ya es "solo PROGRAMADO se toca", sin listar
 * estados explícitamente — RECHAZADO queda protegido automáticamente,
 * sin cambios de código, y estas pruebas lo confirman.
 */
/**
 * VIATICOS-RECHAZADO-1 — RECHAZADO es terminal para ESE (plan_id,
 * personal_id): la tabla tiene `UNIQUE KEY uq_viatico_plan_personal
 * (plan_id, personal_id)` (sql/migrate-2026-08-viat-0-viaticos.sql) —
 * nunca puede existir una segunda fila para el mismo par. "Nueva
 * solicitud = nuevo registro PROGRAMADO" únicamente es cierto para un
 * plan_id DISTINTO (un viaje nuevo) — jamás reasignando a la misma
 * persona en el MISMO plan. Estas pruebas demuestran ambos casos
 * explícitamente: A) mismo plan -> sin segunda fila, histórico intacto;
 * B) plan distinto -> sí crea un PROGRAMADO nuevo, sin tocar el anterior.
 */
describe("sincronizarViaticosPlan — RECHAZADO es terminal por (plan_id, personal_id) (28/34)", () => {
  const execConn = { query: vi.fn(), execute: vi.fn() };

  beforeEach(() => {
    execConn.query.mockReset();
    execConn.execute.mockReset();
    execConn.execute.mockResolvedValue([{ affectedRows: 1 }, []]);
  });

  it("28) una fila RECHAZADO no se borra aunque la persona ya no esté asignada al plan", async () => {
    // El mismo personal_id (5) sigue en `existentesRows` con estado RECHAZADO
    // pero ya NO está en `objetivo` (piloto:9 reemplaza al personal_id 5) —
    // simula exactamente "la persona ya no está asignada al plan".
    execConn.query.mockResolvedValueOnce([[{ personal_id: 5, estado: "RECHAZADO", monto_asignado: "500" }], []]);
    execConn.query.mockResolvedValueOnce([[{ puesto: "Piloto" }], []]); // puestoDePersonal(9) — fila nueva, sin RECHAZADO previo
    execConn.query.mockResolvedValueOnce([[{ monto_defecto: "500" }], []]); // montoSugeridoParaPuesto
    await sincronizarViaticosPlan(7, 1, { piloto: 9, auxiliares: [] }, execConn as never);
    const deleteCall = execConn.execute.mock.calls.find((c) => String(c[0]).includes("DELETE FROM tms_viaticos"));
    expect(deleteCall![0]).toContain("estado = 'PROGRAMADO'");
    // El DELETE está condicionado a PROGRAMADO — una fila RECHAZADO nunca lo cumple, se preserva.
  });

  it("34-A) MISMO plan: reasignar a la MISMA persona con una fila RECHAZADO existente en ESE plan NO crea una segunda fila ni la modifica — el histórico queda intacto", async () => {
    // Plan 1 + Persona 9 ya tiene una fila RECHAZADO — sincronizar el
    // MISMO plan (1) otra vez con esa misma persona en `objetivo`.
    execConn.query.mockResolvedValueOnce([[{ personal_id: 9, estado: "RECHAZADO", monto_asignado: "500" }], []]);
    await sincronizarViaticosPlan(7, 1, { piloto: 9, auxiliares: [] }, execConn as never);
    const insertCall = execConn.execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO tms_viaticos"));
    // Ninguna fila RECHAZADO se toca: al no estar en PROGRAMADO, el bucle la salta (continue) — nunca se ejecuta el INSERT...ON DUPLICATE KEY UPDATE para esa persona, en ESE plan.
    expect(insertCall).toBeUndefined();
    // Ni siquiera se consulta el puesto/monto sugerido de esa persona — el `continue` ocurre antes.
    expect(execConn.query).toHaveBeenCalledTimes(1);
  });

  it("34-B) PLAN DISTINTO: la MISMA persona (con un RECHAZADO en el plan 1) SÍ puede recibir un PROGRAMADO nuevo en un plan diferente (101) — 'nueva solicitud = nuevo viaje'", async () => {
    // Plan 101 (distinto) + Persona 9: existentesRows se consulta con
    // `WHERE plan_id = ?` (101) — nunca encuentra la fila RECHAZADO del
    // plan 1, así que no hay `existente` para esta persona en este plan.
    execConn.query.mockResolvedValueOnce([[], []]); // existentesRows del plan 101: vacío
    execConn.query.mockResolvedValueOnce([[{ puesto: "Piloto" }], []]); // puestoDePersonal(9)
    execConn.query.mockResolvedValueOnce([[{ monto_defecto: "500" }], []]); // montoSugeridoParaPuesto
    await sincronizarViaticosPlan(7, 101, { piloto: 9, auxiliares: [] }, execConn as never);
    const insertCall = execConn.execute.mock.calls.find((c) => String(c[0]).includes("INSERT INTO tms_viaticos"));
    expect(insertCall).toBeDefined();
    expect(insertCall![1]).toEqual([7, 101, 9, "Piloto", 500, 500]);
    // El plan_id del INSERT es el NUEVO (101), nunca el plan 1 donde está el RECHAZADO.
  });
});
