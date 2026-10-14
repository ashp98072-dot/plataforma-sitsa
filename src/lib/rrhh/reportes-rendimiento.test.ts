import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ query: vi.fn(), execute: vi.fn() }));
vi.mock("@/lib/db", () => db);
vi.mock("./config", () => ({ obtenerMinutosTolerancia: async () => 5 }));
vi.mock("./vacaciones", () => ({
  obtenerFeriadosEnRango: async () => new Set(["2026-09-25"]),
}));
import { obtenerReporteAsistencias } from "./reportes";

const empleados = ["Fijo", "Variable", "Fijo / Variable", "variable", null].map((horario, i) => ({
  id: i + 1, codigo: `E${i}`, nombre: ["Zeta", "Ana", "Álvaro", "Luis", "Bea"][i],
  fecha_alta: i === 4 ? "2026-09-24" : "2020-01-01",
  hora_entrada_teorica: "08:00:00", hora_salida_teorica: "17:00:00", tipo_horario: horario,
}));

beforeEach(() => {
  db.query.mockReset().mockImplementation(async (sql: string) => {
    if (sql.includes("FROM empleados WHERE")) return empleados;
    if (sql.includes("FROM sesiones_trabajo")) return [
      { id: 10, id_empleado: 1, fecha_jornada: "2026-09-23", entrada_at: "2026-09-23 08:00:00", salida_at: "2026-09-24 17:00:00", foto_entrada_id: 2, comentarios_rrhh: "Viaje" },
      { id: 11, id_empleado: 2, fecha_jornada: "2026-09-24", entrada_at: "2026-09-24 08:30:00", salida_at: "2026-09-24 16:00:00" },
    ];
    if (sql.includes("FROM incidencias")) return [{ id: 20, id_empleado: 3, tipo: "Vacaciones", fecha_inicio: "2026-09-23", fecha_fin: "2026-09-26" }];
    if (sql.includes("FROM marcajes_en_ruta")) return [{ id_empleado: 4, fecha_inicio: "2026-09-24", fecha_fin: "2026-09-24" }];
    throw new Error(`Query no prevista: ${sql}`);
  });
});

describe("filtro temprano de horario equivalente al filtro histórico", () => {
  for (const horario of [undefined, "", "Todos", "Variable", "Fijo", "Otro"]) {
    for (const tipo of ["Todos", "Falta", "Vacaciones", "En", "Retraso"]) {
      it(`horario=${String(horario)} tipo=${tipo}: contenido, orden y totales iguales`, async () => {
        const sinHorario = await obtenerReporteAsistencias(7, "2026-09-23", "2026-09-27", { tipo });
        const esperado = horario && horario !== "Todos"
          ? sinHorario.filter(r => horario === "Variable" ? r.tipoHorario.includes("Variable") : !r.tipoHorario.includes("Variable"))
          : sinHorario;
        const actual = await obtenerReporteAsistencias(7, "2026-09-23", "2026-09-27", { horario, tipo });
        expect(actual).toEqual(esperado);
        expect(JSON.stringify(actual)).toBe(JSON.stringify(esperado));
        expect(actual.length).toBe(esperado.length);
        expect(db.query).toHaveBeenCalledTimes(8);
        for (const [, params] of db.query.mock.calls) expect(params[0]).toBe(7);
      });
    }
  }
  it("mantiene feriados, domingo, fecha de alta, fotos y ramas históricas", async () => {
    const filas = await obtenerReporteAsistencias(7, "2026-09-23", "2026-09-27");
    expect(filas).toHaveLength(14);
    expect(filas.some(r => r.fecha === "2026-09-25" || r.fecha === "2026-09-27")).toBe(false);
    expect(filas.find(r => r.idSesion === 10)?.fotoEntradaId).toBe(2);
    expect(filas.find(r => r.codigo === "E0" && r.fecha === "2026-09-24")?.estadoEntrada).toBe("En viaje");
    expect(filas.find(r => r.codigo === "E3" && r.fecha === "2026-09-24")?.estadoEntrada).toBe("En Ruta");
    expect(filas.filter(r => r.codigo === "E4").every(r => r.fecha >= "2026-09-24" && r.tipoHorario === "Fijo")).toBe(true);
    expect(filas.map(r => r.fecha)).toEqual([...filas.map(r => r.fecha)].sort().reverse());
  });
});
