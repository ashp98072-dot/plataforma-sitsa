import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/tenant", () => ({
  requireTenantProgramacionOTms: vi.fn(), requireTenantModulo: vi.fn(),
}));
vi.mock("@/lib/clientes/schema", () => ({
  asegurarSchemaClientes: vi.fn(), asegurarModulosClientesFacturacion: vi.fn(),
}));
vi.mock("@/lib/clientes/repository", async (original) => ({
  ...await original<typeof import("@/lib/clientes/repository")>(),
  asegurarVinculosTmsClientes: vi.fn(),
}));

import { query, execute } from "@/lib/db";
import { requireTenantProgramacionOTms } from "@/lib/tenant";
import { asegurarSchemaClientes, asegurarModulosClientesFacturacion } from "@/lib/clientes/schema";
import { asegurarVinculosTmsClientes } from "@/lib/clientes/repository";
import { GET as pesado } from "../../catalogos/route";
import { GET } from "./route";

type Row = Record<string, unknown>;
type Dataset = { shared: Row[]; clientes: Row[]; unidades: Row[]; personal: Row[]; lugares: Row[]; flota: Row[]; perfiles: Row[] };
const ctx = { params: Promise.resolve({ slug: "empresa-prueba" }) };
const req = new Request("http://local/api/catalogos");
const vacio = (): Dataset => ({ shared: [], clientes: [], unidades: [], personal: [], lugares: [], flota: [], perfiles: [] });
const pick = (row: Row, fields: string[]) => Object.fromEntries(fields.map((f) => [f, row[f]]));

/** Simula proyecciones de SQL sobre datos ordenados como las tablas; nunca conecta una BD. */
function instalarDatos(datos: Dataset, empresa = 7, sharedFalla = false) {
  vi.mocked(query).mockImplementation(async (sql, params) => {
    expect(params).toEqual(expect.arrayContaining([empresa]));
    const s = String(sql);
    if (/FROM clientes\b/.test(s)) {
      if (sharedFalla) throw new Error("clientes aún no migrado");
      return datos.shared as never;
    }
    if (/FROM tms_clientes\b/.test(s)) return datos.clientes as never;
    if (/FROM tms_unidades\b/.test(s)) {
      return datos.unidades.map((u) => pick(u, s.includes("placa FROM")
        ? ["id", "placa"] : ["id", "placa", "tipo", "marca", "modelo", "estado"])) as never;
    }
    if (/FROM tms_personal\b/.test(s)) {
      return datos.personal.map((p) => pick(p, s.includes("nombre, tipo FROM")
        ? ["id", "nombre", "tipo"] : ["id", "id_empleado", "codigo", "nombre", "tipo", "telefono", "estado"])) as never;
    }
    if (/FROM tms_lugares\b/.test(s)) return datos.lugares as never;
    if (/FROM flota_vehiculos\b/.test(s)) return datos.flota as never;
    if (/FROM tms_cotizacion_costeo_perfiles\b/.test(s)) return datos.perfiles as never;
    throw new Error(`Consulta inesperada: ${s}`);
  });
}

function proyectar(b: { clientes: Row[]; unidades: Row[]; personal: Row[] }) {
  return {
    clientes: b.clientes.map((c) => pick(c, ["id", "nombre"])),
    unidades: b.unidades.map((u) => pick(u, ["id", "placa"])),
    pilotos: b.personal.filter((p) => p.tipo === "Piloto").map((p) => pick(p, ["id", "nombre"])),
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(asegurarSchemaClientes).mockResolvedValue(undefined);
  vi.mocked(asegurarModulosClientesFacturacion).mockResolvedValue(undefined);
  vi.mocked(asegurarVinculosTmsClientes).mockResolvedValue(undefined);
  vi.mocked(requireTenantProgramacionOTms).mockResolvedValue({ empresa: { id: 7 } } as never);
});

describe("Planes — proyección equivalente al GET real de /tms/catalogos", () => {
  it("conserva nombres compartidos, fallback TMS, orden e inactivos y filtra Piloto con igualdad exacta", async () => {
    const datos = vacio();
    datos.shared = [
      { tms_cliente_id: 1, nombre: "Alias anterior" },
      { tms_cliente_id: null, nombre: "Sin vínculo" },
      { tms_cliente_id: 1, nombre: "Z compartido", estado: "Inactivo" },
      { tms_cliente_id: 3, nombre: "", estado: "Activo" },
    ];
    datos.clientes = [{ id: 1, nombre: "A TMS" }, { id: 2, nombre: "B directo" }, { id: 3, nombre: "C TMS" }];
    datos.unidades = [{ id: 50, placa: "P-001", estado: "Inactivo" }, { id: 90, placa: "P-002", estado: "Activo" }];
    datos.personal = [
      { id: 20, nombre: "A piloto inactivo", tipo: "Piloto", estado: "Inactivo" },
      { id: 21, nombre: "B auxiliar", tipo: "Auxiliar" },
      { id: 22, nombre: "C minúsculas", tipo: "piloto" },
      { id: 23, nombre: "D piloto", tipo: "Piloto", estado: "Activo" },
    ];
    instalarDatos(datos);
    const base = await (await pesado(req, ctx)).json();
    const respuesta = await GET(req, ctx);
    const head = await respuesta.json();
    expect(head).toEqual(proyectar(base));
    expect(head.clientes).toEqual([{ id: 1, nombre: "Z compartido" }, { id: 2, nombre: "B directo" }, { id: 3, nombre: "" }]);
    expect(head.pilotos.map((p: Row) => p.id)).toEqual([20, 23]);
    expect(head.unidades.map((u: Row) => u.id)).toEqual([50, 90]);
    expect(respuesta.headers.get("Cache-Control")).toBe("private, no-store");
    expect(asegurarVinculosTmsClientes).toHaveBeenCalledWith(7);
    expect(asegurarModulosClientesFacturacion).toHaveBeenCalledWith(7);
  });

  it("devuelve los mismos vacíos", async () => {
    instalarDatos(vacio());
    const base = await (await pesado(req, ctx)).json();
    expect(await (await GET(req, ctx)).json()).toEqual(proyectar(base));
  });

  it("conserva el fallback cuando el módulo compartido falla", async () => {
    const datos = { ...vacio(), clientes: [{ id: 5, nombre: "Solo TMS" }] };
    instalarDatos(datos, 7, true);
    vi.mocked(asegurarSchemaClientes).mockRejectedValue(new Error("sin módulo"));
    const base = await (await pesado(req, ctx)).json();
    expect(await (await GET(req, ctx)).json()).toEqual(proyectar(base));
  });

  it.each([401, 403, 404])("propaga guard %s sin consultar catálogos", async (status) => {
    const error = Response.json({ error: "Sin acceso" }, { status });
    vi.mocked(requireTenantProgramacionOTms).mockResolvedValue({ error } as never);
    expect(await GET(req, ctx)).toBe(error);
    expect(requireTenantProgramacionOTms).toHaveBeenCalledExactlyOnceWith("empresa-prueba");
    expect(query).not.toHaveBeenCalled();
    expect(asegurarSchemaClientes).not.toHaveBeenCalled();
  });

  it("usa exclusivamente la empresa del guard, incluso con empresaId ajeno en la URL", async () => {
    vi.mocked(requireTenantProgramacionOTms).mockResolvedValue({ empresa: { id: 99 } } as never);
    instalarDatos(vacio(), 99);
    await GET(new Request("http://local?empresaId=7"), ctx);
    expect(query).toHaveBeenCalledTimes(4);
    for (const [sql, params] of vi.mocked(query).mock.calls) {
      expect(sql).toContain("WHERE empresa_id = ? ORDER BY");
      expect(params).toEqual([99]);
      expect(sql).not.toMatch(/estado\s*=|activo\s*=|SELECT \*|COUNT|JOIN/i);
    }
    expect(execute).not.toHaveBeenCalled();
  });

  it("mantiene las cláusulas ORDER BY originales y solo lee columnas de filtros", async () => {
    instalarDatos(vacio());
    await GET(req, ctx);
    expect(vi.mocked(query).mock.calls.map(([s]) => s).sort()).toEqual([
      "SELECT tms_cliente_id, nombre FROM clientes WHERE empresa_id = ? ORDER BY nombre",
      "SELECT id, nombre FROM tms_clientes WHERE empresa_id = ? ORDER BY nombre",
      "SELECT id, placa FROM tms_unidades WHERE empresa_id = ? ORDER BY placa",
      "SELECT id, nombre, tipo FROM tms_personal WHERE empresa_id = ? ORDER BY nombre",
    ].sort());
  });

  it("mide JSON y queries con 104 elementos sintéticos por catálogo", async () => {
    const datos = vacio();
    for (let i = 1; i <= 104; i++) {
      datos.shared.push({ id: i, empresa_id: 7, tms_cliente_id: i, nombre: `Cliente ${i}`, codigo: `C-${i}`, nit: `123456-${i}`, telefono: "55551234", estado: "Activo" });
      datos.clientes.push({ id: i, nombre: `Cliente ${i}`, nit: `123456-${i}`, telefono: "55551234", estado: "Activo" });
      datos.unidades.push({ id: i, placa: `P-${i}`, tipo: "Camion", marca: "Hino", modelo: "500", estado: "Activo" });
      datos.personal.push({ id: i, id_empleado: i, codigo: `EMP-${i}`, nombre: `Piloto ${i}`, tipo: "Piloto", telefono: "55551234", estado: "Activo" });
      datos.lugares.push({ id: i, nombre: `Lugar ${i}`, tipo: "Descarga", direccion: `Dirección de prueba ${i}` });
      datos.flota.push({ id: i, placa: `P-${i}`, marca: "Hino", modelo: "500", activo: 1 });
      datos.perfiles.push({ id: i, codigo: `V-${i}`, nombre: `Perfil ${i}` });
    }
    instalarDatos(datos);
    const baseResponse = await pesado(req, ctx);
    const base = await baseResponse.text();
    const baseQueries = vi.mocked(query).mock.calls.length;
    vi.mocked(query).mockClear();
    const head = await (await GET(req, ctx)).text();
    const headQueries = vi.mocked(query).mock.calls.length;
    expect(JSON.parse(head)).toEqual(proyectar(JSON.parse(base)));
    expect([baseQueries, headQueries]).toEqual([7, 4]);
    expect(Buffer.byteLength(head)).toBeLessThan(Buffer.byteLength(base));
    expect(Object.keys(JSON.parse(head))).toEqual(["clientes", "unidades", "pilotos"]);
    for (const lista of Object.values(JSON.parse(head)) as Row[][]) {
      expect(lista).toHaveLength(104);
      expect(Object.keys(lista[0])).toHaveLength(2);
    }
    process.stdout.write(`PLANES_CATALOGOS_MEDICION ${JSON.stringify({
      elementosPorCatalogo: 104, baseBytes: Buffer.byteLength(base), headBytes: Buffer.byteLength(head), baseQueries, headQueries,
    })}\n`);
  });
});
