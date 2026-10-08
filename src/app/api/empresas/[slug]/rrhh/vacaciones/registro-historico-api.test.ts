import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  requireTenantRrhh: vi.fn(),
  registrarVacaciones: vi.fn(),
  previsualizarRegistro: vi.fn(),
  contarDiasHabiles: vi.fn(),
  registrarIncidenciaSinSaldo: vi.fn(),
}));
vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: m.requireTenantRrhh }));
vi.mock("@/lib/rrhh/vacaciones-registro", () => ({ registrarVacaciones: m.registrarVacaciones, previsualizarRegistro: m.previsualizarRegistro }));
vi.mock("@/lib/rrhh/vacaciones", () => ({
  calcularSaldoTotalDisponible: vi.fn(), contarDiasHabiles: m.contarDiasHabiles, listarVacaciones: vi.fn(),
  obtenerHistorialPeriodos: vi.fn(), obtenerPeriodosDisponibles: vi.fn(), registrarIncidenciaSinSaldo: m.registrarIncidenciaSinSaldo,
}));

import { NextResponse } from "next/server";
import { POST } from "./route";
import { GET as PREVIEW } from "./preview-historico/route";

const ctx = { params: Promise.resolve({ slug: "kt-monaco" }) };
const post = (cuerpo: unknown) => new Request("http://local", { method: "POST", body: JSON.stringify(cuerpo) });
const base = { empleadoId: 1, fechaInicio: "2023-05-08", fechaFin: "2023-05-12", diasHabiles: 5, tipo: "Vacaciones" };
const HUELLA = "a".repeat(64);

beforeEach(() => {
  vi.resetAllMocks();
  m.requireTenantRrhh.mockResolvedValue({ empresa: { id: 7 }, session: { username: "rrhh.ana" } });
  m.registrarVacaciones.mockResolvedValue({ ok: true, mensaje: "Vacaciones históricas registradas (FIFO en la fecha de la vacación).", desglose: [], incidenciaId: 55, historico: true, plan: { huella: HUELLA } });
});

describe("POST /rrhh/vacaciones (se extiende el endpoint actual, sin crear uno paralelo)", () => {
  it("exige RRHH · Vacaciones · crear y usa la empresa y el usuario de la SESIÓN", async () => {
    m.requireTenantRrhh.mockResolvedValue({ error: NextResponse.json({ error: "Sin permiso" }, { status: 403 }) });
    expect((await POST(post(base), ctx)).status).toBe(403);
    expect(m.requireTenantRrhh).toHaveBeenCalledWith("kt-monaco", "vacaciones", "crear");
    expect(m.registrarVacaciones).not.toHaveBeenCalled();

    m.requireTenantRrhh.mockResolvedValue({ empresa: { id: 7 }, session: { username: "rrhh.ana" } });
    await POST(post({ ...base, empresa_id: 999, usuario: "otro" }), ctx);
    expect(m.registrarVacaciones).toHaveBeenCalledWith(expect.objectContaining({ empresaId: 7, idEmpleado: 1, diasATomar: 5, usuario: "rrhh.ana", tipo: "Vacaciones" }));
    expect(m.registrarVacaciones.mock.calls[0][0]).not.toHaveProperty("empresa_id");
  });

  it("registro histórico exitoso: 200 con la marca histórica y el plan", async () => {
    const r = await POST(post(base), ctx);
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ incidenciaId: 55, diasHabiles: 5, historico: true, plan: { huella: HUELLA } });
  });

  it("pasa la decisión explícita de RRHH (huella + motivo) al registro", async () => {
    await POST(post({ ...base, decision: { huella: HUELLA, motivo: "Aprobado por la gerencia." } }), ctx);
    expect(m.registrarVacaciones.mock.calls[0][0].decision).toEqual({ huella: HUELLA, motivo: "Aprobado por la gerencia." });
    expect((await POST(post({ ...base, decision: { huella: "corta", motivo: "x" } }), ctx)).status).toBe(400);
  });

  it("decisión requerida (déficit o cruce de aniversario) ⇒ 409 con el plan; otro bloqueo (superposición, anterior a fecha_alta…) ⇒ 400", async () => {
    m.registrarVacaciones.mockResolvedValue({ ok: false, mensaje: "Requiere decisión", desglose: [], incidenciaId: null, codigo: "DECISION_REQUERIDA", requiereDecision: true, plan: { huella: HUELLA, deficit: 0.37 } });
    const r = await POST(post(base), ctx);
    expect(r.status).toBe(409);
    expect(await r.json()).toMatchObject({ codigo: "DECISION_REQUERIDA", requiereDecision: true, plan: { deficit: 0.37 } });
    m.registrarVacaciones.mockResolvedValue({ ok: false, mensaje: "Ya existe una vacación que se superpone", desglose: [], incidenciaId: null, codigo: "SUPERPOSICION" });
    const s = await POST(post(base), ctx);
    expect(s.status).toBe(400);
    expect(await s.json()).toMatchObject({ error: "Ya existe una vacación que se superpone", codigo: "SUPERPOSICION" });
  });

  it("registro normal (no histórico): la respuesta conserva exactamente su forma anterior", async () => {
    m.registrarVacaciones.mockResolvedValue({ ok: true, mensaje: "Vacaciones registradas (FIFO).", desglose: [{ periodoInicio: "2024-10-14", periodoFin: "2025-10-13", diasTomados: 5, diasRestantes: 10 }], incidenciaId: 9 });
    const r = await POST(post({ ...base, fechaInicio: "2026-09-14", fechaFin: "2026-09-18" }), ctx);
    expect(await r.json()).toEqual({ mensaje: "Vacaciones registradas (FIFO).", desglose: [{ periodoInicio: "2024-10-14", periodoFin: "2025-10-13", diasTomados: 5, diasRestantes: 10 }], incidenciaId: 9, diasHabiles: 5 });
  });

  it("calcula los días con la regla existente (domingos y feriados) cuando no se envían", async () => {
    m.contarDiasHabiles.mockResolvedValue(4);
    const { diasHabiles, ...sinDias } = base; void diasHabiles;
    await POST(post(sinDias), ctx);
    expect(m.contarDiasHabiles).toHaveBeenCalledWith(7, "2023-05-08", "2023-05-12");
    expect(m.registrarVacaciones.mock.calls[0][0].diasATomar).toBe(4);
  });

  it("los tipos que NO descuentan saldo siguen su camino de siempre (sin motor histórico)", async () => {
    m.registrarIncidenciaSinSaldo.mockResolvedValue({ ok: true, mensaje: "Permiso registrado.", incidenciaId: 3 });
    const r = await POST(post({ ...base, tipo: "Permiso con goce" }), ctx);
    expect(r.status).toBe(200);
    expect(m.registrarVacaciones).not.toHaveBeenCalled();
    expect(m.registrarIncidenciaSinSaldo).toHaveBeenCalled();
  });
});

describe("GET /rrhh/vacaciones/preview-historico (SOLO lectura)", () => {
  const get = (qs: string) => new Request(`http://local/api/x?${qs}`);
  beforeEach(() => {
    m.previsualizarRegistro.mockResolvedValue({ aplica: true, esHistorico: true, plan: { huella: HUELLA }, superposiciones: [], puedeGuardar: true });
  });

  it("exige RRHH · Vacaciones · ver, usa la empresa de la sesión y responde sin caché", async () => {
    m.requireTenantRrhh.mockResolvedValue({ error: NextResponse.json({ error: "Sin permiso" }, { status: 403 }) });
    expect((await PREVIEW(get("empleadoId=1&fechaInicio=2023-05-08&fechaFin=2023-05-12&diasHabiles=5"), ctx)).status).toBe(403);
    expect(m.requireTenantRrhh).toHaveBeenCalledWith("kt-monaco", "vacaciones", "ver");
    m.requireTenantRrhh.mockResolvedValue({ empresa: { id: 7 }, session: { username: "rrhh.ana" } });
    const r = await PREVIEW(get("empleadoId=1&fechaInicio=2023-05-08&fechaFin=2023-05-12&diasHabiles=5&empresa_id=999"), ctx);
    expect(r.status).toBe(200);
    expect(m.previsualizarRegistro).toHaveBeenCalledWith(7, 1, "2023-05-08", "2023-05-12", 5);
    expect(r.headers.get("Cache-Control")).toContain("no-store");
    expect(await r.json()).toMatchObject({ esHistorico: true, diasHabiles: 5 });
  });

  it("parámetros inválidos o rango invertido ⇒ 400; sin días usa la regla existente", async () => {
    expect((await PREVIEW(get("empleadoId=x&fechaInicio=2023-05-08&fechaFin=2023-05-12"), ctx)).status).toBe(400);
    expect((await PREVIEW(get("empleadoId=1&fechaInicio=2023-05-12&fechaFin=2023-05-08"), ctx)).status).toBe(400);
    m.contarDiasHabiles.mockResolvedValue(4);
    await PREVIEW(get("empleadoId=1&fechaInicio=2023-05-08&fechaFin=2023-05-12"), ctx);
    expect(m.previsualizarRegistro).toHaveBeenCalledWith(7, 1, "2023-05-08", "2023-05-12", 4);
  });

  it("un fallo interno responde 500 sin filtrar detalles", async () => {
    m.previsualizarRegistro.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await PREVIEW(get("empleadoId=1&fechaInicio=2023-05-08&fechaFin=2023-05-12&diasHabiles=5"), ctx);
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("boom");
  });
});
