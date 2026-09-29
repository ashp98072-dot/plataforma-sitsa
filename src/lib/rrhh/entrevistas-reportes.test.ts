import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn() }));

import { query } from "@/lib/db";
import {
  obtenerDetalleEntrevistas,
  obtenerReportePorEntrevistador,
  obtenerReportePorPuesto,
  obtenerResumenEntrevistas,
} from "./entrevistas-reportes";

const EMPRESA = 7;

beforeEach(() => {
  vi.resetAllMocks();
});

describe("ATRACCION-TALENTO-1 — obtenerResumenEntrevistas", () => {
  it("20/21/22) mapea total/estados/resultados exactamente desde la agregación SQL", async () => {
    vi.mocked(query).mockResolvedValueOnce([
      { total: 10, programadas: 4, realizadas: 3, canceladas: 1, no_asistio: 2, aprobados: 2, rechazados: 1, pendientes: 7 },
    ] as never);
    const r = await obtenerResumenEntrevistas(EMPRESA, {});
    expect(r).toMatchObject({
      total: 10, programadas: 4, realizadas: 3, canceladas: 1, noAsistio: 2,
      aprobados: 2, rechazados: 1, pendientes: 7,
    });
  });

  it("23) tasa de aprobación = aprobados / (aprobados + rechazados); nunca cuenta Pendiente en el denominador", async () => {
    vi.mocked(query).mockResolvedValueOnce([
      { total: 6, programadas: 0, realizadas: 6, canceladas: 0, no_asistio: 0, aprobados: 2, rechazados: 1, pendientes: 3 },
    ] as never);
    const r = await obtenerResumenEntrevistas(EMPRESA, {});
    expect(r.tasaAprobacion).toBeCloseTo((2 / 3) * 100, 1); // 66.7, no 2/6
  });

  it("denominador 0 (sin aprobados ni rechazados) -> tasaAprobacion = null (la UI muestra '—')", async () => {
    vi.mocked(query).mockResolvedValueOnce([
      { total: 3, programadas: 0, realizadas: 0, canceladas: 0, no_asistio: 0, aprobados: 0, rechazados: 0, pendientes: 3 },
    ] as never);
    const r = await obtenerResumenEntrevistas(EMPRESA, {});
    expect(r.tasaAprobacion).toBeNull();
  });

  it("31) siempre filtra por empresa_id como PRIMER parámetro — tenant aislado", async () => {
    vi.mocked(query).mockResolvedValueOnce([] as never);
    await obtenerResumenEntrevistas(EMPRESA, {});
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("ent.empresa_id = ?");
    expect(params?.[0]).toBe(EMPRESA);
  });

  it("26) filtros de fecha son sargables: fecha_hora >= ? y fecha_hora < DATE_ADD(?, INTERVAL 1 DAY) — nunca DATE(fecha_hora)", async () => {
    vi.mocked(query).mockResolvedValueOnce([] as never);
    await obtenerResumenEntrevistas(EMPRESA, { fechaDesde: "2026-09-01", fechaHasta: "2026-09-30" });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).not.toContain("DATE(ent.fecha_hora)");
    expect(String(sql)).toContain("ent.fecha_hora >= ?");
    expect(String(sql)).toContain("ent.fecha_hora < DATE_ADD(?, INTERVAL 1 DAY)");
    expect(params).toEqual([EMPRESA, "2026-09-01 00:00:00", "2026-09-30"]);
  });

  it("27/28/29/30) filtros de puesto, estado, resultado y entrevistador se agregan al WHERE con sus parámetros", async () => {
    vi.mocked(query).mockResolvedValueOnce([] as never);
    await obtenerResumenEntrevistas(EMPRESA, {
      puesto: "Piloto", estado: "Realizada", resultado: "Aprobado", entrevistadorEmpleadoId: 55,
    });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("ent.puesto = ?");
    expect(String(sql)).toContain("ent.estado = ?");
    expect(String(sql)).toContain("ent.resultado = ?");
    expect(String(sql)).toContain("ent.entrevistador_empleado_id = ?");
    expect(params).toEqual([EMPRESA, "Piloto", "Realizada", "Aprobado", 55]);
  });
});

describe("ATRACCION-TALENTO-1 — obtenerReportePorPuesto (24)", () => {
  it("agrupa por puesto, ordena por cantidad de entrevistas descendente, y calcula tasa por fila", async () => {
    vi.mocked(query).mockResolvedValueOnce([
      { puesto: "Piloto", entrevistas: 5, realizadas: 4, aprobados: 3, rechazados: 1, pendientes: 0 },
      { puesto: "Auxiliar", entrevistas: 2, realizadas: 1, aprobados: 0, rechazados: 0, pendientes: 1 },
    ] as never);
    const r = await obtenerReportePorPuesto(EMPRESA, {});
    expect(r[0]).toMatchObject({ puesto: "Piloto", entrevistas: 5, tasaAprobacion: 75 });
    expect(r[1]).toMatchObject({ puesto: "Auxiliar", entrevistas: 2, tasaAprobacion: null }); // 0+0 -> null
    const [sql] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("GROUP BY ent.puesto");
    expect(String(sql)).toContain("ORDER BY entrevistas DESC");
  });
});

describe("ATRACCION-TALENTO-2 — obtenerReportePorEntrevistador (25, sección 10 clave conceptual)", () => {
  it("usuario tiene precedencia sobre empleado histórico; sin ninguno -> 'Sin entrevistador asignado'", async () => {
    vi.mocked(query).mockResolvedValueOnce([
      { clave: "u:15", entrevistador_usuario_id: 15, entrevistador_empleado_id: null, usuario_nombre: "María López", empleado_nombre: null, asignadas: 4, realizadas: 3, aprobados: 2, rechazados: 0, pendientes: 2 },
      { clave: "e:9", entrevistador_usuario_id: null, entrevistador_empleado_id: 9, usuario_nombre: null, empleado_nombre: "Ana López", asignadas: 3, realizadas: 2, aprobados: 1, rechazados: 0, pendientes: 2 },
      { clave: "sin", entrevistador_usuario_id: null, entrevistador_empleado_id: null, usuario_nombre: null, empleado_nombre: null, asignadas: 1, realizadas: 0, aprobados: 0, rechazados: 0, pendientes: 1 },
    ] as never);
    const r = await obtenerReportePorEntrevistador(EMPRESA, {});
    expect(r[0]).toMatchObject({ clave: "u:15", entrevistadorUsuarioId: 15, entrevistadorNombre: "María López", historico: false });
    expect(r[1]).toMatchObject({ clave: "e:9", entrevistadorEmpleadoId: 9, entrevistadorNombre: "Ana López", historico: true });
    expect(r[2]).toMatchObject({ clave: "sin", entrevistadorNombre: "Sin entrevistador asignado", historico: false });
    const [sql] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("LEFT JOIN empleados e");
    expect(String(sql)).toContain("LEFT JOIN usuarios ue");
  });

  it("agrupa por la clave conceptual (u:/e:/sin), nunca solo por el id numérico desnudo — evita fusionar un usuario.id con un empleado.id iguales", async () => {
    vi.mocked(query).mockResolvedValueOnce([] as never);
    await obtenerReportePorEntrevistador(EMPRESA, {});
    const [sql] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("GROUP BY clave, ent.entrevistador_usuario_id, ent.entrevistador_empleado_id");
    expect(String(sql)).toMatch(/CASE\s+WHEN ent\.entrevistador_usuario_id IS NOT NULL THEN CONCAT\('u:', ent\.entrevistador_usuario_id\)/);
  });

  it("filtro entrevistadorUsuarioId se agrega al WHERE (coexiste con el histórico entrevistadorEmpleadoId)", async () => {
    vi.mocked(query).mockResolvedValueOnce([] as never);
    await obtenerReportePorEntrevistador(EMPRESA, { entrevistadorUsuarioId: 15 });
    const [sql, params] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("ent.entrevistador_usuario_id = ?");
    expect(params).toEqual([EMPRESA, 15]);
  });
});

describe("ATRACCION-TALENTO-2 — obtenerDetalleEntrevistas (auxiliar + precedencia usuario/empleado)", () => {
  it("mapea el listado detallado (con auxiliar) y limita a 500 filas (evita payloads sin límite)", async () => {
    vi.mocked(query).mockResolvedValueOnce([
      {
        id: 1, fecha_hora_iso: "2026-09-29T09:00:00", candidato_nombre: "Juan Pérez", puesto: "Piloto",
        entrevistador_usuario_nombre: "María López", entrevistador_empleado_nombre: null, auxiliar_nombre: "Carlos Pérez",
        modalidad: "Presencial", estado: "Programada", resultado: "Pendiente",
      },
    ] as never);
    const r = await obtenerDetalleEntrevistas(EMPRESA, {});
    expect(r[0]).toMatchObject({
      id: 1, candidatoNombre: "Juan Pérez", entrevistadorNombre: "María López", entrevistadorHistorico: false, auxiliarNombre: "Carlos Pérez",
    });
    const [sql] = vi.mocked(query).mock.calls[0];
    expect(String(sql)).toContain("LIMIT 500");
    expect(String(sql)).toContain("ORDER BY ent.fecha_hora DESC");
  });

  it("11) sin auxiliar -> auxiliarNombre = null (no una cadena vacía ni un objeto)", async () => {
    vi.mocked(query).mockResolvedValueOnce([
      {
        id: 2, fecha_hora_iso: "2026-09-29T10:00:00", candidato_nombre: "Ana Ruiz", puesto: "Auxiliar",
        entrevistador_usuario_nombre: null, entrevistador_empleado_nombre: "Juan Gómez", auxiliar_nombre: null,
        modalidad: "Virtual", estado: "Realizada", resultado: "Aprobado",
      },
    ] as never);
    const r = await obtenerDetalleEntrevistas(EMPRESA, {});
    expect(r[0]).toMatchObject({ entrevistadorNombre: "Juan Gómez", entrevistadorHistorico: true, auxiliarNombre: null });
  });

  it("no ejecuta ninguna consulta por fila (siempre exactamente 1 query, sin importar cuántas filas devuelva)", async () => {
    vi.mocked(query).mockResolvedValueOnce(
      Array.from({ length: 50 }, (_, i) => ({
        id: i, fecha_hora_iso: "2026-09-29T09:00:00", candidato_nombre: `C${i}`, puesto: "Piloto",
        entrevistador_usuario_nombre: null, entrevistador_empleado_nombre: null, auxiliar_nombre: null,
        modalidad: "Presencial", estado: "Programada", resultado: "Pendiente",
      })) as never,
    );
    await obtenerDetalleEntrevistas(EMPRESA, {});
    expect(vi.mocked(query)).toHaveBeenCalledTimes(1);
  });
});
