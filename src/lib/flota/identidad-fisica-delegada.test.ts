import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantFlota: vi.fn() }));
vi.mock("@/lib/empresas", () => ({ empresasParaUsuario: vi.fn() }));
vi.mock("./identidad-fisica", () => ({ inspeccionarIdentidadFisica: vi.fn(), proponerIdentidadFisica: vi.fn(), consultarIdentidadFisica: vi.fn(), aprobarIdentidadFisica: vi.fn() }));
vi.mock("./cb2/origin", () => ({ validarOrigenCB2: vi.fn() }));
vi.mock("./cb2/http", () => ({ bodyAcotado: vi.fn() }));

import { requireTenantFlota } from "@/lib/tenant";
import { empresasParaUsuario } from "@/lib/empresas";
import { aprobarIdentidadFisica, consultarIdentidadFisica } from "./identidad-fisica";
import { bodyAcotado } from "./cb2/http";
import { identidadFisicaHttp } from "./identidad-fisica-http";
import { aprobacionDelegadaHabilitada, evidenciaDelegada, validarDelegacion } from "./identidad-fisica-delegada";

const MONACO = 1, FRESCO = 4;

describe("validarDelegacion", () => {
  const base = { habilitada: true, rol: "Admin", empresaActivaId: MONACO, empresasPermitidasIds: [MONACO, FRESCO] };
  it("sin empresa destino o igual a la activa: no es delegada y no exige el interruptor", () => {
    expect(validarDelegacion({ ...base, habilitada: false })).toEqual({ ok: true, delegada: false, empresaAprobadoraId: MONACO });
    expect(validarDelegacion({ ...base, habilitada: false, empresaAprobadoraId: MONACO })).toMatchObject({ ok: true, delegada: false });
  });
  it("delegada permitida: interruptor + Admin + acceso a la empresa", () => {
    expect(validarDelegacion({ ...base, empresaAprobadoraId: FRESCO })).toEqual({ ok: true, delegada: true, empresaAprobadoraId: FRESCO });
  });
  it.each([
    ["interruptor apagado", { habilitada: false }],
    ["rol distinto de Admin", { rol: "CoordinadorPredios" }],
    ["sin acceso a la empresa destino", { empresasPermitidasIds: [MONACO] }],
  ])("rechazada (403): %s", (_n, cambio) => {
    expect(validarDelegacion({ ...base, empresaAprobadoraId: FRESCO, ...cambio })).toMatchObject({ ok: false, status: 403 });
  });
  it("el interruptor está apagado por defecto y solo con «1» se enciende", () => {
    expect(aprobacionDelegadaHabilitada({} as NodeJS.ProcessEnv)).toBe(false);
    expect(aprobacionDelegadaHabilitada({ FLOTA_IDENTIDAD_APROBACION_DELEGADA: "true" } as unknown as NodeJS.ProcessEnv)).toBe(false);
    expect(aprobacionDelegadaHabilitada({ FLOTA_IDENTIDAD_APROBACION_DELEGADA: "1" } as unknown as NodeJS.ProcessEnv)).toBe(true);
  });
  it("la evidencia delegada queda marcada y respeta el límite de la columna (1000)", () => {
    expect(evidenciaDelegada("Tarjeta verificada", 1)).toBe("[Aprobación delegada desde la empresa 1] Tarjeta verificada");
    expect(evidenciaDelegada("x".repeat(1000), 1)).toHaveLength(1000);
  });
});

/** Ruta real con el servicio de identidad simulado: comprueba QUIÉN puede aprobar en nombre de otra empresa y con qué contexto. */
const guard = (rol = "Admin") => ({ session: { id: 41, username: "admin", rol, accesoTodas: true }, empresa: { id: MONACO, nombre: "Mónaco", slug: "monaco" } }) as never;
const hex = "a".repeat(64);
const cuerpo = (extra: Record<string, unknown> = {}) => ({ id: 7, revision: hex, evidencia: "Tarjeta de circulación verificada por el administrador.", confirmado: true, ...extra });
const patch = (body: unknown) => { vi.mocked(bodyAcotado).mockResolvedValue(Buffer.from(JSON.stringify(body))); return identidadFisicaHttp(new Request("http://x/api", { method: "PATCH", body: "x" }), "monaco"); };
const get = (qs: string) => identidadFisicaHttp(new Request(`http://x/api?${qs}`), "monaco");
const empresas = (ids: number[]) => vi.mocked(empresasParaUsuario).mockResolvedValue(ids.map(id => ({ id })) as never);

describe("ruta de identidades físicas: aprobación delegada", () => {
  beforeEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); vi.mocked(requireTenantFlota).mockResolvedValue(guard()); vi.mocked(aprobarIdentidadFisica).mockResolvedValue({ id: 7, estado: "PROPUESTA", historicosReasignados: 0 } as never); empresas([MONACO, FRESCO]); });

  it("interruptor apagado: aprobar en nombre de otra empresa → 403 y no se llama al servicio", async () => {
    const r = await patch(cuerpo({ empresaAprobadoraId: FRESCO }));
    expect(r.status).toBe(403);
    expect(aprobarIdentidadFisica).not.toHaveBeenCalled();
  });
  it("interruptor encendido + Admin con acceso: se aprueba con el contexto de la empresa DESTINO y se marca como delegada desde la activa", async () => {
    vi.stubEnv("FLOTA_IDENTIDAD_APROBACION_DELEGADA", "1");
    const r = await patch(cuerpo({ empresaAprobadoraId: FRESCO }));
    expect(r.status).toBe(200);
    const [ctxLlamada, op] = vi.mocked(aprobarIdentidadFisica).mock.calls[0];
    expect(ctxLlamada.empresaId).toBe(FRESCO);
    expect(ctxLlamada.usuarioId).toBe(41);
    expect(op).toMatchObject({ id: 7, evidencia: expect.stringContaining("Tarjeta"), delegadaDesdeEmpresaId: MONACO });
    expect(op).not.toHaveProperty("empresaAprobadoraId");
  });
  it("encendido pero SIN acceso del usuario a la empresa destino → 403", async () => {
    vi.stubEnv("FLOTA_IDENTIDAD_APROBACION_DELEGADA", "1");
    empresas([MONACO]);
    expect((await patch(cuerpo({ empresaAprobadoraId: FRESCO }))).status).toBe(403);
    expect(aprobarIdentidadFisica).not.toHaveBeenCalled();
  });
  it("un usuario que no es Admin no llega a aprobar (403 de la ruta, como antes)", async () => {
    vi.stubEnv("FLOTA_IDENTIDAD_APROBACION_DELEGADA", "1");
    vi.mocked(requireTenantFlota).mockResolvedValue(guard("CoordinadorPredios"));
    expect((await patch(cuerpo({ empresaAprobadoraId: FRESCO }))).status).toBe(403);
    expect(aprobarIdentidadFisica).not.toHaveBeenCalled();
  });
  it("sin empresaAprobadoraId (o igual a la activa) la aprobación NO es delegada y funciona con el interruptor apagado", async () => {
    await patch(cuerpo());
    await patch(cuerpo({ empresaAprobadoraId: MONACO }));
    for (const [c, op] of vi.mocked(aprobarIdentidadFisica).mock.calls) { expect(c.empresaId).toBe(MONACO); expect(op).not.toHaveProperty("delegadaDesdeEmpresaId"); }
    expect(aprobarIdentidadFisica).toHaveBeenCalledTimes(2);
  });
  it("la evidencia sigue siendo obligatoria y la confirmación explícita también (400)", async () => {
    vi.stubEnv("FLOTA_IDENTIDAD_APROBACION_DELEGADA", "1");
    expect((await patch(cuerpo({ empresaAprobadoraId: FRESCO, evidencia: "corta" }))).status).toBe(400);
    expect((await patch(cuerpo({ empresaAprobadoraId: FRESCO, confirmado: false }))).status).toBe(400);
    expect(aprobarIdentidadFisica).not.toHaveBeenCalled();
  });
  it("si el usuario PIERDE el acceso durante la operación, `autorizar` revoca (403)", async () => {
    vi.stubEnv("FLOTA_IDENTIDAD_APROBACION_DELEGADA", "1");
    await patch(cuerpo({ empresaAprobadoraId: FRESCO }));
    const ctxLlamada = vi.mocked(aprobarIdentidadFisica).mock.calls[0][0];
    await expect(ctxLlamada.autorizar()).resolves.toBeUndefined();
    empresas([MONACO]); // acceso revocado
    await expect(ctxLlamada.autorizar()).rejects.toMatchObject({ status: 403 });
  });
  it("vista de la propuesta desde la empresa destino (para obtener su revisión): mismas reglas y expone el estado del interruptor", async () => {
    vi.mocked(consultarIdentidadFisica).mockResolvedValue({ cabecera: { id: 7 }, revision: hex, empresas: [] } as never);
    expect((await get("id=7&empresaAprobadora=4")).status).toBe(403); // apagado
    vi.stubEnv("FLOTA_IDENTIDAD_APROBACION_DELEGADA", "1");
    const r = await get("id=7&empresaAprobadora=4");
    expect(r.status).toBe(200);
    expect(vi.mocked(consultarIdentidadFisica).mock.calls.at(-1)![0].empresaId).toBe(FRESCO);
    expect(await r.json()).toMatchObject({ revision: hex, delegacionHabilitada: true, empresaActualId: MONACO });
    empresas([MONACO]);
    expect((await get("id=7&empresaAprobadora=4")).status).toBe(403); // sin acceso
  });
});
