import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ acceso: vi.fn(), query: vi.fn(), crear: vi.fn(), enviar: vi.fn(), recibir: vi.fn(), logo: vi.fn() }));
vi.mock("@/lib/canecas/acceso", () => ({ accesoCanecas: m.acceso }));
vi.mock("@/lib/db", () => ({ getPool: () => ({ query: m.query }) }));
vi.mock("@/lib/canecas/traslados", () => ({ crearTraslado: m.crear, enviarTraslado: m.enviar, recibirTraslado: m.recibir }));
vi.mock("@/lib/facturacion/factura-demo-pdf", () => ({ cargarLogoEmpresa: m.logo }));
import { GET, POST } from "./route";
import { GET as comprobante } from "./[id]/comprobante/route";

const ctx = { params: Promise.resolve({ slug: "uno" }) };
const req = (data: unknown) => new Request("http://local", { method: "POST", body: JSON.stringify(data) });
const clave = "c27b9dea-b59e-4bb6-8bc4-1e147aa0ed08";

describe("permisos y aislamiento de traslados", () => {
  beforeEach(() => { vi.clearAllMocks(); m.acceso.mockResolvedValue({ empresa: { id: 5, nombre: "Empresa", slug: "uno", logoUrl: null }, session: { id: 7 } }); });
  it("no consulta si se deniega lectura", async () => {
    m.acceso.mockResolvedValue({ error: new Response(null, { status: 403 }) });
    expect((await GET(new Request("http://local"),ctx)).status).toBe(403);
    expect(m.query).not.toHaveBeenCalled();
  });
  it("filtra cada consulta por la empresa autorizada", async () => {
    m.query.mockResolvedValue([[]]);
    expect((await GET(new Request("http://local"),ctx)).status).toBe(200);
    expect(m.query.mock.calls.map(c => c[1])).toEqual([[5],[5]]);
  });
  it("exige confirmar antes de registrar una recepción con faltante", async () => {
    m.acceso.mockResolvedValue({ error: new Response(null, { status: 403 }) });
    const payload = { accion: "recibir", id: 2, clave, recibe: "Ana", condicion: "Daño", observaciones: "", partidas: [{ partidaId: 1, recibido: 0, faltante: 1, motivo: "Daño" }] };
    expect((await POST(req(payload),ctx)).status).toBe(403);
    expect(m.acceso).toHaveBeenCalledWith("uno","confirmar");
    expect(m.recibir).not.toHaveBeenCalled();
  });
  it("registra la autorización de confirmar con el actor de la sesión", async () => {
    const payload = { accion: "recibir", id: 2, clave, recibe: "Ana", condicion: "Daño", observaciones: "", partidas: [{ partidaId: 1, recibido: 0, faltante: 1, motivo: "Daño" }] };
    m.recibir.mockResolvedValue({ estado: "CON_DIFERENCIAS" });
    expect((await POST(req(payload),ctx)).status).toBe(200);
    expect(m.acceso).toHaveBeenCalledWith("uno","confirmar");
    expect(m.recibir).toHaveBeenCalledWith(expect.anything(),5,2,7,payload,true);
  });
  it("impide emitir si no existe logo configurado de la empresa", async () => {
    m.logo.mockResolvedValue(null);
    expect((await POST(req({ accion: "enviar", id: 1 }),ctx)).status).toBe(409);
    expect(m.enviar).not.toHaveBeenCalled();
  });
  it("protege el comprobante y filtra por empresa incluso para un ID ajeno", async () => {
    m.query.mockResolvedValue([[]]);
    const response = await comprobante(new Request("http://local"), { params: Promise.resolve({ slug: "uno", id: "9" }) });
    expect(response.status).toBe(404);
    expect(m.query.mock.calls[0][1]).toEqual([5,9,null,null]);
  });
});
