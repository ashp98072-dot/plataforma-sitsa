import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: vi.fn() }));
vi.mock("@/lib/db", () => ({ query: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/rrhh/fiscal-antecedentes", async (original) => ({ ...await original<typeof import("@/lib/rrhh/fiscal-antecedentes")>(), importarAcumuladosFiscales: vi.fn() }));

import { requireTenantRrhh } from "@/lib/tenant";
import { query } from "@/lib/db";
import { ErrorImportacionFiscal, importarAcumuladosFiscales } from "@/lib/rrhh/fiscal-antecedentes";
import { COLUMNAS_ACUMULADOS } from "@/lib/rrhh/fiscal-importacion-ui";
import { GET as plantilla } from "./plantilla/route";
import { POST as importar } from "./importar/route";

/** Endpoints de importación masiva: permisos, tenant, dry-run sin escrituras y mapeo de errores. */
const ctx = { params: Promise.resolve({ slug: "prueba" }) };
const sqls: string[] = [];
const HOY = new Date().getFullYear();

async function xlsx(filas: unknown[][], hoja = "Acumulados") {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(hoja);
  ws.addRow([...COLUMNAS_ACUMULADOS]);
  for (const f of filas) ws.addRow(f as ExcelJS.CellValue[]);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const fila = (over: Partial<Record<number, unknown>> = {}) => {
  const b: unknown[] = ["E1", "", "Ana López", HOY, `${HOY}-01-15`, 45000, 2000, 2173.5, 1250, "Sistema anterior", ""];
  for (const [i, v] of Object.entries(over)) b[Number(i)] = v;
  return b;
};
const peticion = (contenido: Buffer | string, nombre = "acumulados.xlsx", modo: string = "analizar") => {
  const f = new FormData();
  f.set("file", new File([contenido as never], nombre));
  f.set("modo", modo);
  return new Request("https://local.test", { method: "POST", body: f });
};

beforeEach(() => {
  vi.resetAllMocks();
  sqls.length = 0;
  vi.mocked(requireTenantRrhh).mockResolvedValue({ empresa: { id: 3 }, session: { username: "rrhh.ana" } } as never);
  vi.mocked(query).mockImplementation((async (sql: string, params: unknown[] = []) => {
    sqls.push(String(sql));
    if (String(sql).includes("FROM empleados")) {
      return params[0] === 3
        ? [{ id: 1, codigo: "E1", nombre: "Ana López", dpi: "1234567890101", estado: "Activo" }, { id: 2, codigo: "E2", nombre: "Beto", dpi: null, estado: "Activo" }]
        : [{ id: 50, codigo: "OTRA", nombre: "Ajeno", dpi: null, estado: "Activo" }]; // otra empresa: nunca debe llegar aquí
    }
    return [];
  }) as never);
});

describe("GET plantilla", () => {
  it("47) descarga el .xlsx con el nombre Acumulados_Fiscales_Migracion_<año>.xlsx y exige configuracion:ver", async () => {
    const r = await plantilla(new Request(`https://local.test?ejercicio=2026`), ctx);
    expect(requireTenantRrhh).toHaveBeenCalledWith("prueba", "configuracion", "ver");
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Disposition")).toBe('attachment; filename="Acumulados_Fiscales_Migracion_2026.xlsx"');
    expect(r.headers.get("Content-Type")).toContain("spreadsheetml.sheet");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(await r.arrayBuffer()) as never);
    expect(wb.getWorksheet("Acumulados")!.getRow(2).getCell(1).value).toBe("E1");
  });
  it("3/4/5) solo lecturas (SELECT) y acotadas por la empresa de la SESIÓN: no mezcla tenants ni modifica la BD", async () => {
    await plantilla(new Request("https://local.test?ejercicio=2026"), ctx);
    expect(sqls.length).toBeGreaterThan(0);
    expect(sqls.every((s) => /^\s*SELECT/i.test(s))).toBe(true);
    expect(vi.mocked(query).mock.calls.every(([, p]) => (p as unknown[])[0] === 3)).toBe(true);
  });
  it("sin permiso de lectura → 403 sin consultar", async () => {
    vi.mocked(requireTenantRrhh).mockResolvedValue({ error: NextResponse.json({ error: "Sin permiso" }, { status: 403 }) } as never);
    expect((await plantilla(new Request("https://local.test"), ctx)).status).toBe(403);
    expect(query).not.toHaveBeenCalled();
  });
});

describe("POST importar", () => {
  it("permiso: exige configuracion:crear (el mismo de la captura individual); sin él → 403 y no lee ni escribe", async () => {
    vi.mocked(requireTenantRrhh).mockResolvedValue({ error: NextResponse.json({ error: "Sin permiso" }, { status: 403 }) } as never);
    expect((await importar(peticion(await xlsx([fila()])), ctx)).status).toBe(403);
    expect(requireTenantRrhh).toHaveBeenCalledWith("prueba", "configuracion", "crear");
    expect(query).not.toHaveBeenCalled();
    expect(importarAcumuladosFiscales).not.toHaveBeenCalled();
  });
  it("50) modo=analizar es DRY-RUN: devuelve el resumen y NO escribe nada", async () => {
    const r = await importar(peticion(await xlsx([fila(), fila({ 0: "E2", 2: "Beto", 5: -1 })])), ctx);
    expect(r.status).toBe(200);
    const { analisis } = await r.json();
    expect(analisis).toMatchObject({ totalFilas: 2, validas: 1, errores: 1 });
    expect(analisis.filas[0]).toMatchObject({ numeroFila: 2, empleadoId: 1, estado: "VALIDA" });
    expect(importarAcumuladosFiscales).not.toHaveBeenCalled();
    expect(sqls.every((s) => /^\s*SELECT/i.test(s))).toBe(true);
    expect(JSON.stringify(analisis)).not.toContain("Ajeno"); // nada de otra empresa
  });
  it("52) modo=importar con errores → 422 con el análisis y no se importa nada", async () => {
    const r = await importar(peticion(await xlsx([fila(), fila({ 0: "E2", 2: "Beto", 5: -1 })]), "a.xlsx", "importar"), ctx);
    expect(r.status).toBe(422);
    expect((await r.json()).analisis.errores).toBe(1);
    expect(importarAcumuladosFiscales).not.toHaveBeenCalled();
  });
  it("modo=importar sin errores → 201; el servidor RE-ANALIZA el archivo y pasa a la transacción solo filas derivadas de él, con el usuario de la sesión", async () => {
    vi.mocked(importarAcumuladosFiscales).mockResolvedValue({ importados: 2, revisiones: [] });
    const r = await importar(peticion(await xlsx([fila(), fila({ 0: "E2", 2: "Beto" })]), "Acumulados_2026.xlsx", "importar"), ctx);
    expect(r.status).toBe(201);
    expect(await r.json()).toEqual({ importados: 2 });
    const [empresaId, items, usuario, archivo] = vi.mocked(importarAcumuladosFiscales).mock.calls[0];
    expect([empresaId, usuario, archivo]).toEqual([3, "rrhh.ana", "Acumulados_2026.xlsx"]);
    expect(items.map((i) => [i.numeroFila, i.empleadoId])).toEqual([[2, 1], [3, 2]]);
  });
  it("56) un error del servidor/transacción devuelve el mensaje sin guardar nada (409 con fila; 500 genérico sin detalles internos)", async () => {
    vi.mocked(importarAcumuladosFiscales).mockRejectedValueOnce(new ErrorImportacionFiscal(5, "La revisión cambió; vuelva a consultar."));
    const r = await importar(peticion(await xlsx([fila()]), "a.xlsx", "importar"), ctx);
    expect(r.status).toBe(409);
    expect((await r.json()).error).toContain("Fila 5: La revisión cambió");
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(importarAcumuladosFiscales).mockRejectedValueOnce(new Error("boom interno"));
    const r2 = await importar(peticion(await xlsx([fila()]), "a.xlsx", "importar"), ctx);
    expect(r2.status).toBe(500);
    expect(JSON.stringify(await r2.json())).not.toContain("boom");
  });
  it("28/29) archivo que no es .xlsx, texto renombrado o corrupto → 400; hoja incorrecta → 400; modo inválido → 400", async () => {
    expect((await importar(peticion("codigo,dpi", "datos.csv"), ctx)).status).toBe(400);
    expect((await importar(peticion("codigo,dpi", "datos.xlsx"), ctx)).status).toBe(400); // .xlsx falso
    expect((await importar(peticion(Buffer.concat([Buffer.from([0x50, 0x4b, 3, 4]), Buffer.from("basura".repeat(50))])), ctx)).status).toBe(400);
    expect((await importar(peticion(await xlsx([fila()], "Otra")), ctx)).status).toBe(400);
    expect((await importar(peticion(await xlsx([fila()]), "a.xlsx", "borrar"), ctx)).status).toBe(400);
    expect((await importar(new Request("https://local.test", { method: "POST", body: new FormData() }), ctx)).status).toBe(400);
    expect(importarAcumuladosFiscales).not.toHaveBeenCalled();
  });
});
