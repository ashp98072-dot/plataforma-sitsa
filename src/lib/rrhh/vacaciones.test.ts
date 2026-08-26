import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const execute = vi.fn(async () => [{ insertId: 1 }]);
  const connection = {
    beginTransaction: vi.fn(async () => undefined),
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
    release: vi.fn(),
    execute,
    query: vi.fn(async (sql: string) => {
      if (sql.includes("SELECT fecha_alta")) {
        return [[{ fecha_alta: "2025-01-01" }]];
      }
      return [[]];
    }),
  };
  return {
    query: vi.fn(async () => [{ id: 11 }, { id: 12 }]),
    getConnection: vi.fn(async () => connection),
    connection,
  };
});

vi.mock("@/lib/db", () => ({
  query: db.query,
  getPool: () => ({ getConnection: db.getConnection }),
}));

import {
  calcularDiasAcumuladosProporcional,
  sincronizarVacacionesEmpleadosActivos,
} from "./vacaciones";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("acumulación crítica de vacaciones", () => {
  it("otorga cero antes de la fecha de contratación", () => {
    expect(
      calcularDiasAcumuladosProporcional(
        new Date(2026, 5, 1),
        new Date(2027, 4, 31),
        new Date(2026, 4, 31),
        15,
      ),
    ).toBe(0);
  });

  it("otorga exactamente 15 días al completar el período laboral", () => {
    expect(
      calcularDiasAcumuladosProporcional(
        new Date(2025, 5, 1),
        new Date(2026, 4, 31),
        new Date(2026, 4, 31),
        15,
      ),
    ).toBe(15);
  });

  it("acumula proporcionalmente durante el período sin superar 15", () => {
    const dias = calcularDiasAcumuladosProporcional(
      new Date(2026, 0, 1),
      new Date(2026, 11, 31),
      new Date(2026, 5, 30),
      15,
    );
    expect(dias).toBeGreaterThan(7);
    expect(dias).toBeLessThan(8);
  });

  it("sincroniza automáticamente todos los empleados activos una vez al día", async () => {
    const primero = await sincronizarVacacionesEmpleadosActivos(901);
    const segundo = await sincronizarVacacionesEmpleadosActivos(901);

    expect(primero).toEqual({ empleados: 2, errores: 0 });
    expect(segundo).toEqual(primero);
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(db.getConnection).toHaveBeenCalledTimes(2);
    expect(db.connection.commit).toHaveBeenCalledTimes(2);
  });
});
