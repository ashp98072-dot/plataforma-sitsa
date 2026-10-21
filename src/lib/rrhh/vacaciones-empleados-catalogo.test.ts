import type { RowDataPacket } from "mysql2";
import { gzipSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: vi.fn() }));
vi.mock("./empleados-schema", () => ({ asegurarSchemaEmpleados: vi.fn(async () => undefined) }));
import { query, execute } from "@/lib/db";
import { requireTenantRrhh } from "@/lib/tenant";
import { asegurarSchemaEmpleados } from "./empleados-schema";
import { invalidarCacheParametros } from "./config";
import { filtrarPersonas } from "@/lib/busqueda-personas";
import { GET as pesado } from "@/app/api/empresas/[slug]/empleados/route";
import { GET as ligero } from "@/app/api/empresas/[slug]/rrhh/vacaciones/empleados/route";
import { listarCatalogoEmpleadosVacaciones, type EmpleadoVacacionesCatalogo } from "./vacaciones-empleados-catalogo";

type Fila = Record<string, unknown>;
let filas: Fila[];
const ctx = { params: Promise.resolve({ slug: "empresa" }) };
const req = () => new Request("http://local/catalogo?empresa=999");
const proyeccion = (e: EmpleadoVacacionesCatalogo) => ({ id: e.id, codigo: e.codigo, nombre: e.nombre, dpi: e.dpi });

beforeEach(() => {
  vi.resetAllMocks();
  invalidarCacheParametros();
  filas = [
    { empresa_id: 7, id: "9", nombre: "Ána histórica", codigo: "H-09", dpi: "1234567890101", estado: "Baja" },
    { empresa_id: 7, id: 2, nombre: "Beto", codigo: "E-02", dpi: null, estado: "Activo" },
    { empresa_id: 7, id: 4, nombre: "Beto", codigo: "I-04", dpi: "9876543210101", estado: "Inactivo" },
    { empresa_id: 99, id: 8, nombre: "Ajeno", codigo: "AJ", dpi: "NO EXPONER", estado: "Activo" },
  ];
  vi.mocked(asegurarSchemaEmpleados).mockResolvedValue(undefined);
  vi.mocked(requireTenantRrhh).mockResolvedValue({ empresa: { id: 7 } } as Awaited<ReturnType<typeof requireTenantRrhh>>);
  vi.mocked(query).mockImplementation(async (sql, params = []) => {
    if (/FROM empleados\b/.test(sql)) {
      expect(sql).toMatch(/WHERE empresa_id = \?/);
      expect(sql).toMatch(/ORDER BY nombre\s*$/);
      expect(sql).not.toMatch(/estado\s*=|LIMIT/);
      const columnas = sql.match(/SELECT\s+([\s\S]*?)\s+FROM empleados/)![1].split(",").map((c) => c.trim());
      return filas.filter((r) => r.empresa_id === params[0]).map((r) => Object.fromEntries(columnas.map((c) => [c, r[c]]))) as RowDataPacket[];
    }
    if (/FROM documentos_empleados/.test(sql)) {
      expect(params[0]).toBe(7);
      return /COUNT\(\*\)/.test(sql) ? [{ id_empleado: 9, total: 2 }] as RowDataPacket[] : [{ id_empleado: 9 }] as RowDataPacket[];
    }
    if (/FROM configuracion/.test(sql)) return [] as RowDataPacket[];
    throw new Error(`Consulta inesperada: ${sql}`);
  });
});

async function comparar() {
  const anterior = await pesado(req(), ctx);
  const nuevo = await ligero(req(), ctx);
  const base = await anterior.json();
  const head = await nuevo.json();
  expect(head.empleados).toEqual(base.empleados.map(proyeccion));
  return { anterior, nuevo, base, head };
}

describe("Vacaciones: catálogo equivalente al GET anterior real", () => {
  it("conserva orden, ids, nombre/código/DPI y activos/inactivos, sin reordenar empates", async () => {
    const { anterior, nuevo, head } = await comparar();
    expect(head.empleados.map((e: EmpleadoVacacionesCatalogo) => e.id)).toEqual([9, 2, 4]);
    expect(Object.keys(head)).toEqual(["empleados"]);
    expect(Object.keys(head.empleados[0])).toEqual(["id", "codigo", "nombre", "dpi"]);
    expect(head.empleados[1].dpi).toBe("");
    expect(anterior.headers.get("Cache-Control")).toBe("private, no-store");
    expect(nuevo.headers.get("Cache-Control")).toBe("private, no-store");
    expect(requireTenantRrhh).toHaveBeenNthCalledWith(1, "empresa", "empleados", "ver");
    expect(requireTenantRrhh).toHaveBeenNthCalledWith(2, "empresa", "empleados", "ver");
  });

  it("misma búsqueda por nombre sin tildes, código y DPI, incluyendo históricos", async () => {
    const { base, head } = await comparar();
    const opciones = { nombre: (e: EmpleadoVacacionesCatalogo) => e.nombre, buscable: (e: EmpleadoVacacionesCatalogo) => `${e.codigo} ${e.dpi ?? ""}` };
    for (const q of ["ana", "H-09", "1234567890101", "beto", "I-04", "inexistente", "ana H-09"]) {
      expect(filtrarPersonas(head.empleados, q, opciones, 120)).toEqual(filtrarPersonas(base.empleados, q, opciones, 120).map(proyeccion));
    }
  });

  it("normaliza null/números exactamente como mapEmpleado, sin trim nuevo", async () => {
    filas = [{ empresa_id: 7, id: "11", codigo: null, nombre: "  Histórico  ", dpi: 0 }];
    const { head } = await comparar();
    expect(head.empleados).toEqual([{ id: 11, codigo: "", nombre: "  Histórico  ", dpi: "0" }]);
  });

  it("vacío conserva el contrato; no introduce defaults de empleados", async () => {
    filas = [];
    expect((await comparar()).head).toEqual({ empleados: [] });
  });

  it("no limita el catálogo a las 120 opciones que muestra el picker sin búsqueda", async () => {
    filas = Array.from({ length: 201 }, (_, i) => ({ empresa_id: 7, id: i + 1, nombre: `Persona ${i}`, codigo: `C-${i}`, dpi: "" }));
    const { head } = await comparar();
    expect(head.empleados).toHaveLength(201);
    expect(head.empleados[200].codigo).toBe("C-200");
  });

  it("un fallo de lectura se propaga igual; no responde un catálogo vacío artificial", async () => {
    const error = new Error("lectura no disponible");
    vi.mocked(query).mockImplementation(async (sql) => {
      if (/FROM empleados\b/.test(sql)) throw error;
      return [];
    });
    await expect(pesado(req(), ctx)).rejects.toBe(error);
    await expect(ligero(req(), ctx)).rejects.toBe(error);
  });

  it("empresa resuelta por guard, nunca por query string ni por un id del cliente", async () => {
    expect((await comparar()).head.empleados.some((e: EmpleadoVacacionesCatalogo) => e.id === 8)).toBe(false);
    vi.mocked(query).mockClear();
    vi.mocked(requireTenantRrhh).mockResolvedValue({ empresa: { id: 99 } } as Awaited<ReturnType<typeof requireTenantRrhh>>);
    expect(await (await ligero(req(), ctx)).json()).toEqual({ empleados: [{ id: 8, nombre: "Ajeno", codigo: "AJ", dpi: "NO EXPONER" }] });
    expect(query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("WHERE empresa_id = ?"), [99]);
  });

  it.each([401, 403, 404])("propaga el mismo rechazo %i sin lecturas", async (status) => {
    const error = NextResponse.json({ error: "Sin acceso" }, { status });
    vi.mocked(requireTenantRrhh).mockResolvedValue({ error });
    expect(await pesado(req(), ctx)).toBe(error);
    expect(await ligero(req(), ctx)).toBe(error);
    expect(query).not.toHaveBeenCalled();
    expect(asegurarSchemaEmpleados).not.toHaveBeenCalled();
  });

  it("con vacaciones:ver pero sin empleados:ver no agrega un fallback de permisos", async () => {
    vi.mocked(requireTenantRrhh).mockImplementation(async (_slug, modulo) => modulo === "empleados"
      ? { error: NextResponse.json({ error: "Sin permiso para ver en empleados." }, { status: 403 }) }
      : { empresa: { id: 7 } } as Awaited<ReturnType<typeof requireTenantRrhh>>);
    expect((await pesado(req(), ctx)).status).toBe(403);
    expect((await ligero(req(), ctx)).status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });

  it("mantiene preparación heredada tolerante a error; una sola lectura, sin escrituras nuevas", async () => {
    vi.mocked(asegurarSchemaEmpleados).mockRejectedValue(new Error("bootstrap no disponible"));
    expect(await listarCatalogoEmpleadosVacaciones(7)).toHaveLength(3);
    expect(asegurarSchemaEmpleados).toHaveBeenCalledOnce();
    expect(query).toHaveBeenCalledExactlyOnceWith(expect.stringMatching(/SELECT id, codigo, nombre, dpi/), [7]);
    expect(execute).not.toHaveBeenCalled();
  });

  it("mide ambos handlers reales: 104 empleados, SQL simulado y mismos valores visibles", async () => {
    filas = Array.from({ length: 104 }, (_, i) => ({ empresa_id: 7, id: i + 1, codigo: `EMP-${String(i).padStart(3, "0")}`,
      nombre: `Empleado Sintético ${String(i).padStart(3, "0")}`, dpi: String(1234567890000 + i), estado: i % 8 ? "Activo" : "Baja",
      tipo_horario: "Fijo", puesto: "Operador", categoria_ops: "Operaciones", fecha_alta: "2020-01-01",
      fecha_inicio_laboral: "2020-01-01", hora_entrada_teorica: "08:00:00", hora_salida_teorica: "17:00:00",
      tipo_contrato: "fijo", forma_pago: "transferencia", supervisor_id: null,
    }));
    const { base, head } = await comparar();
    const baseJSON = JSON.stringify(base), headJSON = JSON.stringify(head);
    vi.mocked(query).mockClear();
    await pesado(req(), ctx); // configuración ya cacheada (30 s).
    const baseQueriesWarm = vi.mocked(query).mock.calls.length;
    const tiemposBase: number[] = [], tiemposHead: number[] = [];
    for (let i = 0; i < 20; i++) {
      invalidarCacheParametros();
      vi.mocked(query).mockClear();
      let inicio = performance.now();
      await (await pesado(req(), ctx)).json();
      tiemposBase.push(performance.now() - inicio);
      expect(query).toHaveBeenCalledTimes(4);
      vi.mocked(query).mockClear();
      inicio = performance.now();
      await (await ligero(req(), ctx)).json();
      tiemposHead.push(performance.now() - inicio);
      expect(query).toHaveBeenCalledTimes(1);
    }
    const mediana = (valores: number[]) => [...valores].sort((a, b) => a - b)[10];
    expect(baseQueriesWarm).toBe(3);
    expect(Buffer.byteLength(headJSON)).toBeLessThan(Buffer.byteLength(baseJSON) / 5);
    process.stdout.write("VACACIONES_CATALOGO_MEDICION " + JSON.stringify({ empleados: 104,
      baseBytes: Buffer.byteLength(baseJSON), headBytes: Buffer.byteLength(headJSON),
      baseGzip: gzipSync(baseJSON).length, headGzip: gzipSync(headJSON).length,
      baseCampos: Object.keys(base.empleados[0]).length, headCampos: Object.keys(head.empleados[0]).length,
      baseQueries: 4, baseQueriesConfigCacheada: baseQueriesWarm, headQueries: 1,
      baseLocalMedianaMs: mediana(tiemposBase), headLocalMedianaMs: mediana(tiemposHead),
    }) + "\n");
  });
});
