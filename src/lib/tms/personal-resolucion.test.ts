import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ execute: vi.fn(), query: vi.fn() }));

import { execute, query } from "@/lib/db";
import { personalDesdeEmpleado, validarPersonalId } from "./personal-resolucion";

/**
 * TMS-IMPORTACION-PROGRAMACION-EXCEL (PR 1) — `personalDesdeEmpleado` y
 * `validarPersonalId` se movieron tal cual desde `.../tms/planes/route.ts`
 * a este módulo compartido (ver comentario en personal-resolucion.ts).
 * Estos tests cubren exactamente lo pedido antes de abrir el PR:
 *   - `empleados.codigo` sigue resolviendo correctamente al personal TMS
 *     correspondiente (existente y de alta nueva);
 *   - los casos inválidos siguen rechazándose igual (empleado inexistente,
 *     inactivo, de otra empresa);
 *   - `validarPersonalId` mantiene su contrato exacto (exists/empresa/
 *     tipo/activo, sin resolver por nombre ni auto-crear).
 * Mismo patrón de mocking que ya usa el resto del proyecto para módulos
 * que tocan `@/lib/db` (ver rutas-import.test.ts / viaticos.test.ts):
 * `vi.mock("@/lib/db", ...)` + `vi.mocked(query/execute).mockImplementation`
 * por texto de SQL, sin base de datos real.
 */
describe("personalDesdeEmpleado", () => {
  beforeEach(() => vi.resetAllMocks());

  it("empleado activo YA vinculado a un tms_personal existente: devuelve ese id y actualiza nombre/id_empleado", async () => {
    vi.mocked(query).mockImplementation(async (sql: string) => {
      if (sql.includes("FROM empleados")) {
        return [{ id: 55, codigo: "P-100", nombre: "Juan Pérez" }] as never;
      }
      if (sql.includes("FROM tms_personal")) {
        return [{ id: 900 }] as never;
      }
      return [] as never;
    });
    vi.mocked(execute).mockResolvedValue({ affectedRows: 1 } as never);

    const personalId = await personalDesdeEmpleado(7, 55, "Piloto");

    expect(personalId).toBe(900);
    // No inserta uno nuevo — solo actualiza el existente.
    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, params] = vi.mocked(execute).mock.calls[0];
    expect(sql).toContain("UPDATE tms_personal");
    expect(params).toEqual([55, "Juan Pérez", 900, 7, 55]);
  });

  it("empleado activo SIN tms_personal todavía: lo crea (bridging id_empleado) y devuelve el id nuevo", async () => {
    vi.mocked(query).mockImplementation(async (sql: string) => {
      if (sql.includes("FROM empleados")) {
        return [{ id: 61, codigo: "A-200", nombre: "María López" }] as never;
      }
      if (sql.includes("FROM tms_personal")) {
        return [] as never; // no existe todavía
      }
      return [] as never;
    });
    vi.mocked(execute).mockResolvedValue({ insertId: 1234 } as never);

    const personalId = await personalDesdeEmpleado(7, 61, "Auxiliar");

    expect(personalId).toBe(1234);
    const [sql, params] = vi.mocked(execute).mock.calls[0];
    expect(sql).toContain("INSERT INTO tms_personal");
    expect(params).toEqual([7, "A-200", "María López", "Auxiliar", 61]);
  });

  it("empleadoId undefined: devuelve null sin consultar la BD", async () => {
    const personalId = await personalDesdeEmpleado(7, undefined, "Piloto");
    expect(personalId).toBeNull();
    expect(query).not.toHaveBeenCalled();
    expect(execute).not.toHaveBeenCalled();
  });

  it("empleado inexistente en esta empresa: devuelve null sin tocar tms_personal", async () => {
    vi.mocked(query).mockImplementation(async (sql: string) => {
      if (sql.includes("FROM empleados")) return [] as never;
      return [] as never;
    });

    const personalId = await personalDesdeEmpleado(7, 999, "Piloto");

    expect(personalId).toBeNull();
    expect(execute).not.toHaveBeenCalled();
  });

  it("empleado inactivo: la query ya filtra estado='Activo', por lo que no aparece -> null", async () => {
    vi.mocked(query).mockImplementation(async (sql: string) => {
      if (sql.includes("FROM empleados")) {
        // Simula que la fila no vuelve porque el WHERE ya exige estado='Activo'.
        return [] as never;
      }
      return [] as never;
    });

    const personalId = await personalDesdeEmpleado(7, 42, "Auxiliar");

    expect(personalId).toBeNull();
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("estado = 'Activo'");
    expect(params).toEqual([42, 7]);
  });

  it("aísla por empresa: el SELECT de empleados siempre filtra por empresa_id", async () => {
    vi.mocked(query).mockImplementation(async (sql: string) => {
      if (sql.includes("FROM empleados")) return [] as never;
      return [] as never;
    });

    await personalDesdeEmpleado(11, 42, "Piloto");

    const [, params] = vi.mocked(query).mock.calls[0];
    expect(params).toEqual([42, 11]);
  });
});

describe("validarPersonalId", () => {
  beforeEach(() => vi.resetAllMocks());

  it("personal_id existente, de la empresa correcta, tipo y estado esperados: devuelve id + nombre", async () => {
    vi.mocked(query).mockResolvedValue([{ id: 900, nombre: "Juan Pérez" }] as never);

    const resultado = await validarPersonalId(7, 900, "Piloto");

    expect(resultado).toEqual({ id: 900, nombre: "Juan Pérez" });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(sql).toContain("FROM tms_personal");
    expect(params).toEqual([900, 7, "Piloto"]);
  });

  it("personal_id inexistente: devuelve null", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    const resultado = await validarPersonalId(7, 999, "Piloto");
    expect(resultado).toBeNull();
  });

  it("personal_id de OTRA empresa: no lo encuentra (aislamiento multiempresa) -> null", async () => {
    // La query real filtra empresa_id=? -> el mock simula que no matchea.
    vi.mocked(query).mockResolvedValue([] as never);
    const resultado = await validarPersonalId(11, 900, "Piloto");
    expect(resultado).toBeNull();
    const [, params] = vi.mocked(query).mock.calls[0];
    expect(params).toEqual([900, 11, "Piloto"]);
  });

  it("tipo distinto al esperado (p. ej. es Auxiliar, se pide Piloto): no matchea -> null", async () => {
    vi.mocked(query).mockResolvedValue([] as never);
    const resultado = await validarPersonalId(7, 900, "Piloto");
    expect(resultado).toBeNull();
    const [, params] = vi.mocked(query).mock.calls[0];
    expect(params).toEqual([900, 7, "Piloto"]);
  });

  it("nunca resuelve por nombre ni crea registros: solo hace un SELECT exacto por id", async () => {
    vi.mocked(query).mockResolvedValue([{ id: 5, nombre: "X" }] as never);
    await validarPersonalId(7, 5, "Auxiliar");
    expect(query).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
  });
});
