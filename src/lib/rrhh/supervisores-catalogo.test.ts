import { beforeEach, expect, it, vi } from "vitest";
import type { RowDataPacket } from "mysql2";
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
vi.mock("@/lib/rrhh/empleados-schema", () => ({ asegurarSchemaEmpleados: async () => undefined }));
vi.mock("@/lib/rrhh/documentos", () => ({ contarDocumentosPorEmpleado: async () => new Map() }));
vi.mock("@/lib/rrhh/foto-empleado-existencia", () => ({ empleadosConFoto: async () => new Set() }));
import { query } from "@/lib/db";
import { listarCatalogoSupervisores } from "./supervisores-catalogo";
import { listarEmpleados } from "./empleados";
beforeEach(() => vi.resetAllMocks());
it("una consulta, solo Activos del tenant, mismo orden y cuatro campos", async () => {
  vi.mocked(query).mockResolvedValue([{ id: "7", nombre: "Ana", numero_empleado: null, codigo: "C7", sueldo_base: 1000, ruta_archivo: "no exponer" }] as unknown as RowDataPacket[]);
  expect(await listarCatalogoSupervisores(3)).toEqual([{ id: 7, nombre: "Ana", numeroEmpleado: "", codigo: "C7" }]);
  expect(query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("estado = 'Activo' ORDER BY nombre"), [3]);
  expect(vi.mocked(query).mock.calls[0][0]).not.toMatch(/documentos|foto|SELECT \*/);
});
it("equivale a proyectar el catálogo anterior y reduce payload, conservando orden y valores", async () => {
  const rows = Array.from({ length: 104 }, (_,i) => ({
    id: i + 1, nombre: "Empleado Sintético " + i, numero_empleado: i ? String(i).padStart(6,"0") : null,
    codigo: "EMP-" + i, estado: "Activo", tipo_horario: "Fijo",
  }));
  vi.mocked(query).mockResolvedValue(rows as unknown as RowDataPacket[]);
  const base = await listarEmpleados(3, "", { estado: "Activo" });
  const head = await listarCatalogoSupervisores(3);
  expect(head).toEqual(base.map(({ id, nombre, numeroEmpleado, codigo }) => ({ id, nombre, numeroEmpleado, codigo })));
  const baseBytes = Buffer.byteLength(JSON.stringify({ empleados: base, horarioDefault: { entrada: "07:00", salida: "16:00" } }));
  const headBytes = Buffer.byteLength(JSON.stringify({ empleados: head }));
  expect(headBytes).toBeLessThan(baseBytes / 5);
  console.info("MEDICION_SUPERVISORES", JSON.stringify({ empleados: 104, baseBytes, headBytes }));
});
