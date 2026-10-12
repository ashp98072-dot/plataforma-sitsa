import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  eventos: [] as string[],
  rebase: vi.fn(),
  fechaAnterior: "2024-01-01",
  estadoAnterior: "Activo",
  escrituras: [] as { sql: string; p: unknown[] }[],
}));

vi.mock("@/lib/db", () => {
  const conn = {
    beginTransaction: async () => { h.eventos.push("BEGIN"); },
    commit: async () => { h.eventos.push("COMMIT"); },
    rollback: async () => { h.eventos.push("ROLLBACK"); },
    release: () => { h.eventos.push("RELEASE"); },
    query: async (sql: string) => { h.eventos.push(`QUERY ${sql.trim().slice(0, 30)}`); return [[{ supervisor_id: null, fecha_alta: h.fechaAnterior, estado: h.estadoAnterior }]]; },
    execute: async (sql: string, p: unknown[]) => { h.escrituras.push({ sql, p }); h.eventos.push(`EXECUTE ${sql.trim().slice(0, 20)}`); return [{ affectedRows: 1 }]; },
  };
  return { getPool: () => ({ getConnection: async () => conn }), query: async () => [] };
});
vi.mock("./empleados-schema", () => ({ asegurarSchemaEmpleados: async () => undefined }));
vi.mock("./vacaciones-rebase-db", () => ({ rebasearVacacionesEnConexion: h.rebase }));

import { actualizarEmpleado, type EmpleadoInput } from "./empleados";
import { RebaseBloqueadoError } from "./vacaciones-rebase";

const datos = (fechaAlta: string): EmpleadoInput => ({
  codigo: "E-1", nombre: "Ana Pérez", tipoHorario: "Fijo", fechaAlta, horaEntradaTeorica: "07:00:00", horaSalidaTeorica: "16:00:00", estado: "Activo",
});

beforeEach(() => {
  h.eventos.length = 0;
  h.escrituras = []; h.fechaAnterior = "2024-01-01"; h.estadoAnterior = "Activo";
  h.rebase.mockReset();
  h.rebase.mockResolvedValue({ aplicado: true });
});

describe("actualizarEmpleado + rebase de vacaciones (misma transacción, antes del UPDATE de la ficha)", () => {
  it("el rebase corre DENTRO de la transacción y ANTES del UPDATE; recibe la empresa, el empleado, la fecha nueva y el usuario", async () => {
    const ok = await actualizarEmpleado(7, 3, datos("2024-01-01"), { usuario: "rrhh.ana" });
    expect(ok).toBe(true);
    expect(h.rebase).toHaveBeenCalledWith(expect.anything(), 7, 3, "2024-01-01", { usuario: "rrhh.ana" });
    const iUpdate = h.eventos.findIndex((e) => e.startsWith("EXECUTE UPDATE"));
    expect(h.eventos.indexOf("BEGIN")).toBeLessThan(iUpdate);
    expect(h.eventos.at(-2)).toBe("COMMIT");
  });

  it("si el rebase se bloquea o falla: ROLLBACK COMPLETO, el UPDATE de la ficha NUNCA se ejecuta y el error llega a la ruta", async () => {
    h.rebase.mockRejectedValue(new RebaseBloqueadoError("La nueva fecha de contratación dejaría vacaciones registradas antes de la fecha de alta. Corrija/revise el historial antes de continuar.", {} as never));
    await expect(actualizarEmpleado(7, 3, datos("2025-06-01"), { usuario: "rrhh.ana" })).rejects.toThrow("antes de la fecha de alta");
    expect(h.eventos.some((e) => e.startsWith("EXECUTE UPDATE"))).toBe(false);
    expect(h.eventos).toContain("ROLLBACK");
    expect(h.eventos).not.toContain("COMMIT");
  });

  it("sin opciones (llamadas existentes) sigue funcionando: usuario nulo", async () => {
    await actualizarEmpleado(7, 3, datos("2024-01-01"));
    expect(h.rebase).toHaveBeenCalledWith(expect.anything(), 7, 3, "2024-01-01", { usuario: undefined });
  });
  it("cambio fecha_alta invalida solo al empleado en la transacción", async () => {
    await actualizarEmpleado(7, 3, datos("2023-01-01"));
    expect(h.escrituras.find((e) => e.sql.includes("rrhh_vacaciones_sync_estado"))?.p).toEqual([7, 3]);
    const dirty = h.eventos.findIndex((e) => e.startsWith("EXECUTE INSERT"));
    expect(dirty).toBeGreaterThan(h.eventos.indexOf("BEGIN"));
    expect(dirty).toBeLessThan(h.eventos.indexOf("COMMIT"));
  });
  it.each(["Baja", "Activo"] as const)("cambio de estado a %s invalida", async (estado) => {
    h.estadoAnterior = estado === "Activo" ? "Baja" : "Activo";
    await actualizarEmpleado(7, 3, { ...datos("2024-01-01"), estado });
    expect(h.escrituras.find((e) => e.sql.includes("rrhh_vacaciones_sync_estado"))?.p).toEqual([7, 3]);
  });
  it("editar ficha sin cambiar fecha/estado no invalida innecesariamente", async () => {
    await actualizarEmpleado(7, 3, datos("2024-01-01"));
    expect(h.escrituras.some((e) => e.sql.includes("rrhh_vacaciones_sync_estado"))).toBe(false);
  });
});
