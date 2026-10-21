import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RowDataPacket } from "mysql2";
vi.mock("@/lib/db", () => ({ query: vi.fn(), getPool: vi.fn() }));
vi.mock("./empleados-schema", () => ({ asegurarSchemaEmpleados: vi.fn() }));
import { query } from "@/lib/db";
import { asegurarSchemaEmpleados } from "./empleados-schema";
import { empleadosConFoto, FILTRO_FOTO_EMPLEADO } from "./foto-empleado-existencia";

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(asegurarSchemaEmpleados).mockResolvedValue(undefined as never);
});

describe("empleadosConFoto — detección de fotografía sin SQL nuevo ni columnas nuevas", () => {
  it("devuelve solo los IDs con registro de foto, en una sola consulta acotada por empresa", async () => {
    vi.mocked(query).mockResolvedValue([{ id_empleado: 7 }, { id_empleado: "9" }] as RowDataPacket[]);
    const r = await empleadosConFoto(3, [7, 8, 9]);
    expect([...r].sort()).toEqual([7, 9]);
    expect(r.has(8)).toBe(false);
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = vi.mocked(query).mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("empresa_id = ? AND id_empleado IN (?,?,?)");
    expect(sql).toContain(FILTRO_FOTO_EMPLEADO);
    expect(params).toEqual([3, 7, 8, 9]);
  });
  it("sin IDs no consulta", async () => {
    expect((await empleadosConFoto(3, [])).size).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
  it("usa el mismo criterio que el endpoint de la foto (tipo 'Foto' + extensión de imagen)", () => {
    expect(FILTRO_FOTO_EMPLEADO).toContain("tipo_documento = 'Foto'");
    expect(FILTRO_FOTO_EMPLEADO).toContain("REGEXP '[.](jpg|jpeg|png|webp)$'");
  });
  it("no expone rutas ni nombres de archivo: solo selecciona id_empleado", async () => {
    vi.mocked(query).mockResolvedValue([]);
    await empleadosConFoto(3, [1]);
    const sql = vi.mocked(query).mock.calls[0][0] as string;
    expect(sql).toContain("SELECT DISTINCT id_empleado");
    expect(sql.split("FROM")[0]).not.toContain("ruta_archivo");
  });
});

describe("listarEmpleados — DTO aditivo tieneFoto", () => {
  it("tieneFoto true/false por empleado; empleado de otra empresa no se mezcla (la consulta lleva empresaId)", async () => {
    const { listarEmpleados } = await import("./empleados");
    vi.mocked(query).mockImplementation(async (sql: string) => {
      if (sql.includes("FROM documentos_empleados") && sql.includes("COUNT(*)")) return [] as never;
      if (sql.includes("SELECT DISTINCT id_empleado")) return [{ id_empleado: 1 }] as never;
      return [
        { id: 1, empresa_id: 3, nombre: "Con Foto", estado: "Activo" },
        { id: 2, empresa_id: 3, nombre: "Sin Foto", estado: "Activo" },
      ] as never;
    });
    const lista = await listarEmpleados(3);
    expect(lista.map((e) => [e.id, e.tieneFoto])).toEqual([[1, true], [2, false]]);
    const fotoCall = vi.mocked(query).mock.calls.find((c) => String(c[0]).includes("SELECT DISTINCT id_empleado"))!;
    expect(fotoCall[1]).toEqual([3, 1, 2]);
  });
  it("si la consulta de fotos falla, tieneFoto queda sin definir (la miniatura conserva su comportamiento previo)", async () => {
    const { listarEmpleados } = await import("./empleados");
    vi.mocked(query).mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT DISTINCT id_empleado")) throw new Error("boom");
      if (sql.includes("COUNT(*)")) return [] as never;
      return [{ id: 1, empresa_id: 3, nombre: "A", estado: "Activo" }] as never;
    });
    const lista = await listarEmpleados(3);
    expect(lista[0].tieneFoto).toBeUndefined();
  });
});
