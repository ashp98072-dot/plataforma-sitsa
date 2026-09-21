import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantCotizaciones: vi.fn() }));

import { query } from "@/lib/db";
import { requireTenantCotizaciones } from "@/lib/tenant";
import { GET } from "./route";

const ctx = { params: Promise.resolve({ slug: "kt-monaco" }) };
const pedir = (qs = "") => GET(new Request(`http://localhost/api/empresas/kt-monaco/tms/clientes${qs}`), ctx);
const ultimaConsulta = () => {
  const [sql, params] = vi.mocked(query).mock.calls.at(-1) as unknown as [string, unknown[]];
  return { sql, params };
};

const FILA = { id: 41, nombre: "Cliente Uno, S.A.", codigo: "CLI-001", nit: "1234567-8", telefono: "55551234", estado: "Activo" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantCotizaciones).mockResolvedValue({ error: null, empresa: { id: 7 }, session: { id: 1 } } as never);
  vi.mocked(query).mockResolvedValue([FILA] as never);
});

describe("GET /tms/clientes?q= (buscador de clientes de Cotizaciones)", () => {
  it("responde { clientes } con el id de tms_clientes y sin caché", async () => {
    const res = await pedir("?q=uno");
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(await res.json()).toEqual({
      clientes: [{ id: 41, nombre: "Cliente Uno, S.A.", codigo: "CLI-001", nit: "1234567-8", telefono: "55551234", estado: "Activo" }],
    });
  });

  it("exige cotizaciones:ver o tms:ver y no consulta la BD si el guard rechaza", async () => {
    const denegado = new Response(JSON.stringify({ error: "Sin permiso" }), { status: 403 });
    vi.mocked(requireTenantCotizaciones).mockResolvedValue({ error: denegado } as never);
    const res = await pedir("?q=uno");
    expect(res.status).toBe(403);
    expect(requireTenantCotizaciones).toHaveBeenCalledWith("kt-monaco", "ver");
    expect(query).not.toHaveBeenCalled();
  });

  it("aísla por empresa: usa la empresa de la sesión, nunca una enviada por el cliente", async () => {
    await pedir("?q=uno&empresaId=99&empresa_id=99");
    const { sql, params } = ultimaConsulta();
    expect(params[0]).toBe(7);
    expect(params).not.toContain(99);
    expect(sql).toContain("t.empresa_id = ?");
    // El vínculo con el maestro compartido también queda acotado a la empresa.
    expect(sql).toContain("c.empresa_id = t.empresa_id");
  });

  it("devuelve solo clientes activos y como máximo 20", async () => {
    await pedir();
    const { sql } = ultimaConsulta();
    expect(sql).toContain("COALESCE(c.estado, t.estado) = 'Activo'");
    expect(sql).toMatch(/LIMIT 20\s*$/);
  });

  it("el id sale de tms_clientes (t.id) y el código del vínculo clientes.tms_cliente_id, nunca de clientes.id ni por nombre/NIT", async () => {
    await pedir("?q=uno");
    const { sql } = ultimaConsulta();
    expect(sql).toContain("SELECT t.id AS id");
    expect(sql).toContain("FROM tms_clientes t");
    expect(sql).toContain("LEFT JOIN clientes c ON c.tms_cliente_id = t.id");
    expect(sql).not.toMatch(/\bc\.id\b/);
    expect(sql).not.toMatch(/ON [^\n]*(nombre|nit)/i);
  });

  it.each([
    ["nombre", "COALESCE(c.nombre, t.nombre) LIKE ?"],
    ["código", "c.codigo LIKE ?"],
    ["NIT", "COALESCE(c.nit, t.nit) LIKE ?"],
    ["teléfono", "COALESCE(c.telefono, t.telefono) LIKE ?"],
  ])("busca por %s", async (_campo, fragmento) => {
    await pedir("?q=CLI-001");
    const { sql, params } = ultimaConsulta();
    expect(sql).toContain(fragmento);
    expect(params).toEqual([7, "%CLI-001%", "%CLI-001%", "%CLI-001%", "%CLI-001%"]);
  });

  it("sin q lista los primeros clientes por nombre, sin filtro LIKE", async () => {
    await pedir();
    const { sql, params } = ultimaConsulta();
    expect(sql).not.toContain("LIKE");
    expect(sql).toContain("ORDER BY nombre ASC");
    expect(params).toEqual([7]);
  });

  it("q solo con espacios equivale a sin búsqueda", async () => {
    await pedir("?q=%20%20%20");
    expect(ultimaConsulta().params).toEqual([7]);
  });

  it("trata q como texto literal: escapa % _ y \\ y recorta el largo", async () => {
    await pedir(`?q=${encodeURIComponent("50%_\\")}`);
    expect(ultimaConsulta().params[1]).toBe("%50\\%\\_\\\\%");
    await pedir(`?q=${"a".repeat(300)}`);
    expect(ultimaConsulta().params[1]).toBe(`%${"a".repeat(100)}%`);
  });

  it("no usa parámetros sin enlazar: la búsqueda nunca se concatena en el SQL", async () => {
    await pedir(`?q=${encodeURIComponent("x' OR 1=1 --")}`);
    const { sql, params } = ultimaConsulta();
    expect(sql).not.toContain("OR 1=1");
    expect(params[1]).toBe("%x' OR 1=1 --%");
  });

  it("cliente sin vínculo en el maestro compartido: código null (no se adivina por nombre)", async () => {
    vi.mocked(query).mockResolvedValue([{ id: 5, nombre: "Solo TMS", codigo: null, nit: null, telefono: "", estado: "Activo" }] as never);
    const body = await (await pedir("?q=solo")).json();
    expect(body.clientes).toEqual([{ id: 5, nombre: "Solo TMS", codigo: null, nit: null, telefono: null, estado: "Activo" }]);
  });

  it("si la tabla clientes aún no existe, cae a tms_clientes (sin código) con el mismo aislamiento", async () => {
    vi.mocked(query)
      .mockRejectedValueOnce(new Error("Table 'clientes' doesn't exist"))
      .mockResolvedValueOnce([{ id: 5, nombre: "Solo TMS", codigo: null, nit: "9", telefono: null, estado: "Activo" }] as never);
    const res = await pedir("?q=solo");
    expect(res.status).toBe(200);
    expect(query).toHaveBeenCalledTimes(2);
    const { sql, params } = ultimaConsulta();
    expect(sql).not.toContain("JOIN clientes");
    expect(sql).toContain("t.empresa_id = ?");
    expect(params[0]).toBe(7);
    expect((await res.json()).clientes[0]).toMatchObject({ id: 5, codigo: null });
  });

  it("responde 500 con mensaje genérico si la BD falla del todo (sin filtrar detalles)", async () => {
    vi.mocked(query).mockRejectedValue(new Error("ER_ACCESS_DENIED secreto"));
    const res = await pedir("?q=uno");
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("secreto");
  });

  it("no usa el catálogo completo ni escribe: solo SELECT", () => {
    const fuente = readFileSync(join(__dirname, "route.ts"), "utf8") + readFileSync(join(process.cwd(), "src/lib/tms/clientes-busqueda.ts"), "utf8");
    expect(fuente).not.toMatch(/\b(INSERT|UPDATE|DELETE|ALTER|CREATE|DROP)\b\s+(INTO|TABLE|FROM)?/);
    expect(fuente).not.toContain("listarClientes");
    expect(fuente).not.toContain("asegurarSchemaClientes");
  });
});
