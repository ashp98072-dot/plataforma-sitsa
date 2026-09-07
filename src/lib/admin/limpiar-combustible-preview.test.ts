import { readFileSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PoolConnection } from "mysql2/promise";

vi.mock("@/lib/db", () => ({ getPool: vi.fn() }));

import { getPool } from "@/lib/db";
import {
  contarCargasCombustibleBloqueantes,
  listarCargasCombustibleBloqueantes,
} from "./limpiar-combustible-preview";

/**
 * BLOQUEO-COMBUSTIBLE-PREVIEW — SOLO LECTURA. Ver
 * docs/LIMPIEZA-TMS-OPERACIONES-REINICIO-3-BLOQUEO-COMBUSTIBLE-DISCOVERY.md.
 * Este módulo NUNCA ejecuta DELETE/UPDATE ni toca el filesystem — se
 * verifica tanto en runtime (conn.execute nunca llamado) como de forma
 * estática (el archivo fuente no importa `fs`/uploads/limpiar-archivos).
 */

const conn = { query: vi.fn(), execute: vi.fn(), release: vi.fn() };
const db = conn as unknown as PoolConnection;

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getPool).mockReturnValue({
    getConnection: vi.fn().mockResolvedValue(db),
  } as unknown as ReturnType<typeof getPool>);
});

describe("contarCargasCombustibleBloqueantes — conteos SOLO SELECT", () => {
  it("si la tabla no existe en este entorno, devuelve todo en 0 sin más consultas", async () => {
    conn.query.mockResolvedValueOnce([[]]); // tablaExiste("flota_combustible_cargas") -> false
    const out = await contarCargasCombustibleBloqueantes(db, 7);
    expect(out).toEqual({
      cargas_combustible_vinculadas: 0,
      cargas_combustible_pendientes: 0,
      cargas_combustible_aprobadas: 0,
      cargas_combustible_rechazadas: 0,
      conciliaciones_combustible_vinculadas: 0,
    });
    expect(conn.query).toHaveBeenCalledTimes(1);
  });

  it("1) separa correctamente PENDIENTE/APROBADO/RECHAZADO y suma el total vinculado", async () => {
    conn.query.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes("information_schema.tables")) return [[{ ok: 1 }]];
      if (s.includes("GROUP BY estado")) {
        return [[
          { estado: "PENDIENTE", n: 2 },
          { estado: "APROBADO", n: 1 },
          { estado: "RECHAZADO", n: 3 },
        ]];
      }
      if (s.includes("flota_combustible_conciliacion_filas")) return [[{ n: 4 }]];
      throw new Error(`Consulta inesperada: ${s}`);
    });
    const out = await contarCargasCombustibleBloqueantes(db, 7);
    expect(out).toEqual({
      cargas_combustible_vinculadas: 6,
      cargas_combustible_pendientes: 2,
      cargas_combustible_aprobadas: 1,
      cargas_combustible_rechazadas: 3,
      conciliaciones_combustible_vinculadas: 4,
    });
  });

  it("2) los parámetros usan EXCLUSIVAMENTE el empresaId indicado — nunca el de otra empresa", async () => {
    const paramsVistos: unknown[][] = [];
    conn.query.mockImplementation(async (sql: string, params: unknown[]) => {
      const s = String(sql);
      if (s.includes("information_schema.tables")) return [[{ ok: 1 }]];
      paramsVistos.push(params);
      if (s.includes("GROUP BY estado")) return [[]];
      return [[{ n: 0 }]];
    });
    await contarCargasCombustibleBloqueantes(db, 42);
    expect(paramsVistos.length).toBeGreaterThan(0);
    expect(paramsVistos.every((p) => JSON.stringify(p) === "[42]")).toBe(true);
  });

  it("un estado que no está en el mapa conocido no se descarta: se reporta bajo una clave derivada", async () => {
    conn.query.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes("information_schema.tables")) return [[{ ok: 1 }]];
      if (s.includes("GROUP BY estado")) return [[{ estado: "DEVUELTO", n: 5 }]];
      return [[{ n: 0 }]];
    });
    const out = await contarCargasCombustibleBloqueantes(db, 7);
    expect(out.cargas_combustible_vinculadas).toBe(5);
    expect(out.cargas_combustible_estado_devuelto).toBe(5);
    expect(out.cargas_combustible_pendientes).toBe(0);
  });

  it("4) cuenta las filas de conciliación relacionadas con las cargas bloqueantes", async () => {
    conn.query.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes("information_schema.tables")) return [[{ ok: 1 }]];
      if (s.includes("GROUP BY estado")) return [[{ estado: "APROBADO", n: 2 }]];
      if (s.includes("flota_combustible_conciliacion_filas")) return [[{ n: 7 }]];
      throw new Error(`Consulta inesperada: ${s}`);
    });
    const out = await contarCargasCombustibleBloqueantes(db, 7);
    expect(out.conciliaciones_combustible_vinculadas).toBe(7);
  });

  it("5/7) nunca ejecuta DELETE/UPDATE ni ninguna escritura — todas las consultas son SELECT", async () => {
    conn.query.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes("information_schema.tables")) return [[{ ok: 1 }]];
      if (s.includes("GROUP BY estado")) return [[{ estado: "PENDIENTE", n: 1 }]];
      return [[{ n: 0 }]];
    });
    await contarCargasCombustibleBloqueantes(db, 7);
    expect(conn.execute).not.toHaveBeenCalled();
    expect(conn.query.mock.calls.every(([sql]) => /^\s*SELECT/i.test(String(sql)))).toBe(true);
  });

  it("8) preview vacío (sin cargas bloqueantes) funciona sin errores", async () => {
    conn.query.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes("information_schema.tables")) return [[{ ok: 1 }]];
      if (s.includes("GROUP BY estado")) return [[]];
      return [[{ n: 0 }]];
    });
    const out = await contarCargasCombustibleBloqueantes(db, 7);
    expect(out.cargas_combustible_vinculadas).toBe(0);
    expect(out.conciliaciones_combustible_vinculadas).toBe(0);
  });
});

describe("listarCargasCombustibleBloqueantes — detalle SOLO LECTURA para revisión manual", () => {
  it("1/2) la consulta principal se acota EXCLUSIVAMENTE a la empresa indicada", async () => {
    conn.query.mockImplementation(async (sql: string, params: unknown[]) => {
      const s = String(sql);
      if (s.includes("information_schema.tables")) return [[{ ok: 1 }]];
      if (s.includes("FROM flota_combustible_cargas c")) {
        expect(params).toEqual([9]);
        return [[{
          id: 1, viaje_id: 20, fecha_consumo: "2026-08-01", creado_at: "2026-08-01 10:00:00",
          estado: "PENDIENTE", monto: "150.00", vehiculo_id: 3, vehiculo_placa: "P-123ABC",
          empleado_id: 5, piloto_nombre: "Juan Pérez", ruta_relativa: "empresas/9/flota/vale.jpg",
          conciliacion_id: null,
        }]];
      }
      return [[]];
    });
    const r = await listarCargasCombustibleBloqueantes(9);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({
      id: 1, viajeId: 20, estado: "PENDIENTE", tieneComprobante: true, conciliada: false,
    });
    expect(conn.release).toHaveBeenCalledOnce();
  });

  it("nunca expone la ruta física del comprobante — solo un booleano tieneComprobante", async () => {
    conn.query.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes("information_schema.tables")) return [[{ ok: 1 }]];
      if (s.includes("FROM flota_combustible_cargas c")) {
        return [[{
          id: 1, viaje_id: 20, fecha_consumo: null, creado_at: "2026-08-01",
          estado: "PENDIENTE", monto: "10.00", vehiculo_id: 3, vehiculo_placa: null,
          empleado_id: 5, piloto_nombre: "Juan", ruta_relativa: "empresas/9/flota/vale.jpg",
          conciliacion_id: null,
        }]];
      }
      return [[]];
    });
    const r = await listarCargasCombustibleBloqueantes(9);
    expect(Object.keys(r[0])).not.toContain("rutaRelativa");
    expect(Object.values(r[0]).some((v) => typeof v === "string" && v.includes("vale.jpg"))).toBe(false);
  });

  it("resuelve la referencia de conciliación cuando la carga ya fue conciliada", async () => {
    conn.query.mockImplementation(async (sql: string) => {
      const s = String(sql);
      if (s.includes("information_schema.tables")) return [[{ ok: 1 }]];
      if (s.includes("FROM flota_combustible_cargas c")) {
        return [[{
          id: 1, viaje_id: 20, fecha_consumo: null, creado_at: "2026-08-01",
          estado: "APROBADO", monto: "100.00", vehiculo_id: 3, vehiculo_placa: null,
          empleado_id: 5, piloto_nombre: "Ana", ruta_relativa: "x.jpg", conciliacion_id: 55,
        }]];
      }
      if (s.startsWith("SELECT id, nombre_original, creado_at FROM flota_combustible_conciliaciones")) {
        return [[{ id: 55, nombre_original: "reporte-agosto.xlsx", creado_at: "2026-08-15" }]];
      }
      return [[]];
    });
    const r = await listarCargasCombustibleBloqueantes(9);
    expect(r[0].conciliada).toBe(true);
    expect(r[0].conciliacionId).toBe(55);
    expect(r[0].conciliacionArchivo).toBe("reporte-agosto.xlsx");
  });

  it("5/7) nunca ejecuta DELETE/UPDATE ni modifica el estado de ninguna carga", async () => {
    conn.query.mockResolvedValue([[]]);
    await listarCargasCombustibleBloqueantes(9);
    expect(conn.execute).not.toHaveBeenCalled();
  });

  it("8) preview vacío (sin cargas bloqueantes) devuelve un array vacío sin errores", async () => {
    conn.query.mockImplementation(async (sql: string) => {
      if (String(sql).includes("information_schema.tables")) return [[{ ok: 1 }]];
      return [[]];
    });
    const r = await listarCargasCombustibleBloqueantes(9);
    expect(r).toEqual([]);
  });

  it("si la tabla no existe, devuelve un array vacío sin más consultas", async () => {
    conn.query.mockResolvedValueOnce([[]]);
    const r = await listarCargasCombustibleBloqueantes(9);
    expect(r).toEqual([]);
    expect(conn.query).toHaveBeenCalledTimes(1);
  });
});

describe("6) contrato estático: este módulo nunca toca el filesystem", () => {
  it("el archivo fuente no IMPORTA fs, @/lib/uploads ni @/lib/admin/limpiar-archivos", () => {
    // Busca líneas `import ... from "..."` reales — nunca menciones sueltas
    // en comentarios (este mismo archivo documenta a propósito que NO
    // importa esos módulos, lo que rompería un simple `includes()`).
    const fuente = readFileSync(
      join(process.cwd(), "src/lib/admin/limpiar-combustible-preview.ts"),
      "utf8",
    );
    const lineasImport = fuente
      .split("\n")
      .filter((linea) => /^\s*import\b/.test(linea));
    expect(lineasImport.some((l) => /from ["']fs["']/.test(l))).toBe(false);
    expect(lineasImport.some((l) => /from ["']fs\/promises["']/.test(l))).toBe(false);
    expect(lineasImport.some((l) => /@\/lib\/uploads["']/.test(l))).toBe(false);
    expect(lineasImport.some((l) => /@\/lib\/admin\/limpiar-archivos["']/.test(l))).toBe(false);
  });
});
