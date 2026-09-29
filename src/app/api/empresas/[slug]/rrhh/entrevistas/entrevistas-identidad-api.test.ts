import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ requireTenantRrhh: vi.fn(), crearEntrevista: vi.fn(), actualizarEntrevista: vi.fn(), obtenerEntrevista: vi.fn(), eliminarEntrevista: vi.fn(), listarEntrevistasPorMes: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: m.requireTenantRrhh }));
vi.mock("@/lib/rrhh/entrevistas", () => ({
  crearEntrevista: m.crearEntrevista, actualizarEntrevista: m.actualizarEntrevista, obtenerEntrevista: m.obtenerEntrevista,
  eliminarEntrevista: m.eliminarEntrevista, listarEntrevistasPorMes: m.listarEntrevistasPorMes,
}));
import { POST } from "./route";
import { PATCH } from "./[id]/route";

const guardOk = { empresa: { id: 1 }, session: { nombre: "RRHH", username: "rrhh" } };
const req = (body: unknown) => new Request("http://x", { method: "POST", body: JSON.stringify(body) });
const ctx = { params: Promise.resolve({ slug: "sitsa" }) };
const ctxId = (id = "55") => ({ params: Promise.resolve({ slug: "sitsa", id }) });

beforeEach(() => {
  vi.resetAllMocks();
  m.requireTenantRrhh.mockResolvedValue(guardOk);
  m.crearEntrevista.mockResolvedValue({ ok: true, mensaje: "Entrevista programada.", id: 55 });
  m.actualizarEntrevista.mockResolvedValue({ ok: true, mensaje: "Entrevista actualizada." });
});

const base = { candidatoPrimerNombre: "Juan", candidatoPrimerApellido: "Pérez", puesto: "Piloto", fechaHora: "2026-09-28T09:00" };

describe("POST /rrhh/entrevistas — schema exige primer nombre + primer apellido, nunca un nombre libre", () => {
  it("acepta el payload estructurado mínimo", async () => {
    const res = await POST(req(base), ctx);
    expect(res.status).toBe(200);
    expect(m.crearEntrevista).toHaveBeenCalledWith(expect.objectContaining({ candidatoPrimerNombre: "Juan", candidatoPrimerApellido: "Pérez" }));
  });
  it("rechaza sin primerNombre", async () => {
    const res = await POST(req({ ...base, candidatoPrimerNombre: undefined }), ctx);
    expect(res.status).toBe(400);
    expect(m.crearEntrevista).not.toHaveBeenCalled();
  });
  it("rechaza sin primerApellido", async () => {
    const res = await POST(req({ ...base, candidatoPrimerApellido: "" }), ctx);
    expect(res.status).toBe(400);
  });
  it("un candidatoNombre libre en el body es ignorado por el schema (no es un campo reconocido)", async () => {
    await POST(req({ ...base, candidatoNombre: "Inventado" }), ctx);
    const enviado = m.crearEntrevista.mock.calls[0]?.[0];
    expect(enviado).toBeDefined();
    expect(enviado.candidatoNombre).toBeUndefined();
  });
});

describe("PATCH /rrhh/entrevistas/[id] — ahora sí permite editar identidad, teléfono, email y puesto", () => {
  it("13) puesto editable", async () => {
    const res = await PATCH(req({ puesto: "Auxiliar" }), ctxId());
    expect(res.status).toBe(200);
    expect(m.actualizarEntrevista).toHaveBeenCalledWith(1, 55, expect.objectContaining({ puesto: "Auxiliar" }));
  });
  it("11-12) teléfono y email editables", async () => {
    await PATCH(req({ candidatoTelefono: "5555-1234", candidatoEmail: "j@x.com" }), ctxId());
    expect(m.actualizarEntrevista).toHaveBeenCalledWith(1, 55, expect.objectContaining({ candidatoTelefono: "5555-1234", candidatoEmail: "j@x.com" }));
  });
  it("9-10) primer/segundo nombre y apellidos editables", async () => {
    await PATCH(req({ candidatoPrimerNombre: "Juan", candidatoSegundoApellido: "López" }), ctxId());
    expect(m.actualizarEntrevista).toHaveBeenCalledWith(1, 55, expect.objectContaining({ candidatoPrimerNombre: "Juan", candidatoSegundoApellido: "López" }));
  });
});

describe("39) tenant/41-42) permisos: ambas rutas exigen requireTenantRrhh('entrevistas', ...)", () => {
  it("POST exige permiso editar", async () => {
    await POST(req(base), ctx);
    expect(m.requireTenantRrhh).toHaveBeenCalledWith("sitsa", "entrevistas", "editar");
  });
  it("PATCH exige permiso editar y responde el error del guard sin llamar al modelo", async () => {
    m.requireTenantRrhh.mockResolvedValue({ error: new Response(JSON.stringify({ error: "Sin permiso" }), { status: 403 }) });
    const res = await PATCH(req({ puesto: "X" }), ctxId());
    expect(res.status).toBe(403);
    expect(m.actualizarEntrevista).not.toHaveBeenCalled();
  });
});

describe("regresiones: portal, expediente, documentos, seguimiento no cambiaron de contrato", () => {
  const leer = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");
  it("37) portal de entrevistas sigue mostrando candidatoNombre", () => {
    expect(leer("src/app/portal/entrevistas/entrevista-card.tsx")).toContain("candidatoNombre");
    expect(leer("src/lib/rrhh/entrevistas.ts")).toContain("candidatoNombre: String(r.candidato_nombre)");
  });
  it("38) expediente del candidato sigue usando candidatoNombre", () => {
    expect(leer("src/components/rrhh/expediente-candidato.tsx")).toContain("entrevista.candidatoNombre");
  });
  it("39) documentos y 40) seguimiento no se tocaron", () => {
    expect(leer("src/components/rrhh/entrevista-documentos.tsx")).toContain("EntrevistaDocumentos");
    expect(leer("src/app/api/empresas/[slug]/rrhh/entrevistas/[id]/seguimiento/route.ts")).toContain("obtenerEntrevista");
  });
});

describe("ATRACCION-TALENTO-2 (corrección pre-SQL) — POST/PATCH ya NO aceptan el modelo histórico de empleado", () => {
  it("1) POST con entrevistadorUsuarioId válido crea correctamente y lo reenvía a crearEntrevista", async () => {
    const res = await POST(req({ ...base, entrevistadorUsuarioId: 10 }), ctx);
    expect(res.status).toBe(200);
    expect(m.crearEntrevista).toHaveBeenCalledWith(expect.objectContaining({ entrevistadorUsuarioId: 10 }));
  });

  it("2) POST con auxiliarUsuarioId válido crea correctamente y lo reenvía a crearEntrevista", async () => {
    const res = await POST(req({ ...base, entrevistadorUsuarioId: 10, auxiliarUsuarioId: 11 }), ctx);
    expect(res.status).toBe(200);
    expect(m.crearEntrevista).toHaveBeenCalledWith(expect.objectContaining({ entrevistadorUsuarioId: 10, auxiliarUsuarioId: 11 }));
  });

  it("3) POST con entrevistadorEmpleadoId en el body: el campo queda ignorado (Zod lo descarta), NUNCA llega a crearEntrevista", async () => {
    const res = await POST(req({ ...base, entrevistadorEmpleadoId: 999 }), ctx);
    expect(res.status).toBe(200);
    const enviado = m.crearEntrevista.mock.calls[0]?.[0];
    expect(enviado).toBeDefined();
    expect(enviado.entrevistadorEmpleadoId).toBeUndefined();
    expect(Object.keys(enviado)).not.toContain("entrevistadorEmpleadoId");
  });

  it("PATCH con entrevistadorEmpleadoId en el body: el campo también queda ignorado (Zod lo descarta), NUNCA llega a actualizarEntrevista", async () => {
    const res = await PATCH(req({ entrevistadorEmpleadoId: 999, puesto: "Auxiliar" }), ctxId());
    expect(res.status).toBe(200);
    const enviado = m.actualizarEntrevista.mock.calls[0]?.[2];
    expect(enviado).toBeDefined();
    expect(enviado.entrevistadorEmpleadoId).toBeUndefined();
    expect(Object.keys(enviado)).not.toContain("entrevistadorEmpleadoId");
  });

  it("el schema Zod del POST ya no declara el campo entrevistadorEmpleadoId (fuente de verdad: código, no solo runtime)", () => {
    const src = readFileSync("src/app/api/empresas/[slug]/rrhh/entrevistas/route.ts", "utf8");
    expect(src).not.toMatch(/entrevistadorEmpleadoId:\s*z\./);
  });

  it("el schema Zod del PATCH ya no declara el campo entrevistadorEmpleadoId", () => {
    const src = readFileSync("src/app/api/empresas/[slug]/rrhh/entrevistas/[id]/route.ts", "utf8");
    expect(src).not.toMatch(/entrevistadorEmpleadoId:\s*z\./);
  });
});
