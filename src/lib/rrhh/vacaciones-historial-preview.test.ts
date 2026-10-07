import { beforeEach, describe, expect, it, vi } from "vitest";

/** La vista previa SOLO puede leer: `execute`, `getPool` y cualquier escritura revientan el test. */
const db = vi.hoisted(() => ({
  query: vi.fn(),
  execute: vi.fn(() => { throw new Error("La vista previa NO debe escribir (execute)"); }),
  getPool: vi.fn(() => { throw new Error("La vista previa NO debe abrir transacciones (getPool)"); }),
}));
vi.mock("@/lib/db", () => ({ query: db.query, execute: db.execute, getPool: db.getPool }));

import { previsualizarHistorial } from "./vacaciones-historial-preview";
import { detectarColumnas, normalizarFilas, parsearCsv } from "./vacaciones-historial-import";

const HOY = new Date(2026, 9, 6);
const EMPLEADOS = [
  { id: 1, codigo: "E-1", nombre: "Ana Pérez", estado: "Activo", fecha_alta: "2023-04-13", fecha_inicio_laboral: "2023-04-13", dpi: "2000111110101" },
  { id: 14, codigo: "E-14", nombre: "Amilcar Bernabé Torres Cho", estado: "Activo", fecha_alta: "2023-04-13", fecha_inicio_laboral: "2023-02-13", dpi: null },
  { id: 20, codigo: "E-20", nombre: "Carlos Mejía", estado: "Activo", fecha_alta: "2020-02-29", fecha_inicio_laboral: "2020-02-29", dpi: null },
  { id: 21, codigo: "E-21", nombre: "Pedro López", estado: "Activo", fecha_alta: "2022-01-10", fecha_inicio_laboral: "2022-01-10", dpi: null },
  { id: 22, codigo: "E-22", nombre: "PEDRO LOPEZ", estado: "Activo", fecha_alta: "2022-02-10", fecha_inicio_laboral: "2022-02-10", dpi: null },
  { id: 37, codigo: "E-37", nombre: "Elisa Jiménez López", estado: "Activo", fecha_alta: "1899-12-31", fecha_inicio_laboral: "1899-12-31", dpi: null },
];
let vacacionesActuales: Record<string, unknown>[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  vacacionesActuales = [
    { id: 1, id_empleado: 1, fecha_inicio: "2024-06-03", fecha_fin: "2024-06-14", dias_habiles: 11 }, // equivalente a la fila 2 del archivo
    { id: 2, id_empleado: 20, fecha_inicio: "2024-03-04", fecha_fin: "2024-03-08", dias_habiles: 5 },  // Carlos: NO viene en el archivo
  ];
  db.query.mockImplementation(async (sql: string) => {
    if (sql.includes("SELECT id, dpi FROM empleados")) return EMPLEADOS.filter((e) => e.dpi).map((e) => ({ id: e.id, dpi: e.dpi }));
    if (sql.includes("FROM empleados")) return EMPLEADOS.map(({ dpi, ...e }) => { void dpi; return e; });
    if (sql.includes("FROM vacaciones")) return vacacionesActuales;
    if (sql.includes("FROM feriados")) return [];
    return [];
  });
});

const archivo = (csv: string) => { const { encabezados, filas } = parsearCsv(csv); return { encabezados, filas }; };
const CSV = [
  "codigo,nombre,fecha_inicio,fecha_fin,dias_habiles,tipo,observacion",
  "E-1,,03/06/2024,14/06/2024,11,,Boleta 1",                 // 2 válida (equivalente a la actual)
  "E-1,,03/06/2024,14/06/2024,11,,repetida",                 // 3 duplicado exacto
  "E-1,,2024-12-02,2024-12-13,10,,",                          // 4 válida, días calculados (11) ≠ informados (10)
  "E-14,,2024-06-03,2024-06-08,6,,",                          // 5 Amilcar
  "E-37,,2025-06-02,2025-06-07,6,,",                          // 6 Elisa (bloqueante)
  "E-99,,2025-06-02,2025-06-07,6,,",                          // 7 empleado inexistente
  ",Pedro Lopez,2025-06-02,2025-06-07,6,,",                   // 8 nombre ambiguo
  "E-1,,31/02/2025,2025-06-07,6,,",                            // 9 fecha inválida
  "E-1,,2025-06-02,2025-06-07,6,Permiso con goce,",           // 10 tipo no reconstruible
  "E-1,,2023-01-02,2023-01-07,6,,",                           // 11 anterior a la fecha base
  "E-1,,2026-12-01,2026-12-05,5,,",                           // 12 futura
  "E-1,,2024-12-10,2024-12-17,6,,",                           // 13 superpuesta con la 4
].join("\n");

describe("vista previa de la reconstrucción (SOLO lectura)", () => {
  it("NO escribe: modo PREVIEW, escribio=false y nunca se llama a execute/getPool", async () => {
    const r = await previsualizarHistorial(7, archivo(CSV), HOY);
    expect(r.modo).toBe("PREVIEW");
    expect(r.escribio).toBe(false);
    expect(db.execute).not.toHaveBeenCalled();
    expect(db.getPool).not.toHaveBeenCalled();
    // todo lo que se consultó fue SELECT
    expect(db.query.mock.calls.every(([sql]) => /^\s*SELECT/i.test(String(sql)))).toBe(true);
  });

  it("reporta empleados encontrados / no encontrados, filas inválidas, duplicados y totales por empleado", async () => {
    const r = await previsualizarHistorial(7, archivo(CSV), HOY);
    expect(r.resumen).toMatchObject({ filasLeidas: 12, filasInvalidas: 2, duplicadosEnArchivo: 1, empleadosNoEncontrados: 1 });
    expect(r.noEncontrados).toEqual([{ identificador: "código E-99", filas: [7] }]);
    expect(r.problemas.find((p) => p.codigo === "FECHA_INICIO_INVALIDA")!.fila).toBe(9);
    expect(r.problemas.find((p) => p.codigo === "TIPO_NO_RECONSTRUIBLE")!.fila).toBe(10);
    expect(r.problemas.find((p) => p.codigo === "EMPLEADO_AMBIGUO")!.fila).toBe(8);
    expect(r.problemas.find((p) => p.codigo === "DUPLICADO_EN_ARCHIVO")!.fila).toBe(3);
    const ana = r.empleados.find((e) => e.empleadoId === 1)!;
    expect(ana.vacaciones).toBe(5);            // 2, 4, 11, 12 y 13 (la 3 es duplicado; la 11 se procesa como anterior a la base)
    expect(ana.diasTotales).toBe(11 + 10 + 6 + 5 + 6);
  });

  it("días calculados vs informados: advierte la diferencia y usa los informados", async () => {
    const r = await previsualizarHistorial(7, archivo(CSV), HOY);
    const dif = r.problemas.filter((p) => p.codigo === "DIAS_DISTINTOS");
    expect(dif.map((p) => p.fila)).toEqual(expect.arrayContaining([4]));
    expect(dif.find((p) => p.fila === 4)!.mensaje).toContain("calculados 11");
    expect(r.resumen.diasCalculadosDistintos).toBeGreaterThanOrEqual(1);
  });

  it("vacaciones anteriores a la fecha base, futuras y superpuestas se reportan", async () => {
    const r = await previsualizarHistorial(7, archivo(CSV), HOY);
    expect(r.resumen.anterioresAFechaBase).toBe(1);
    expect(r.resumen.futuras).toBe(1);
    expect(r.resumen.vacacionesSuperpuestas).toBeGreaterThanOrEqual(1);
  });

  it("ELISA (fecha_alta 1899-12-31): BLOQUEANTE; no se simula su saldo y la vista previa NO puede aplicarse", async () => {
    const r = await previsualizarHistorial(7, archivo(CSV), HOY);
    const elisa = r.empleados.find((e) => e.empleadoId === 37)!;
    expect(elisa.bloqueado).toBe("FECHA_SOSPECHOSA");
    expect(elisa.periodos).toBe(0);
    expect(r.problemas.some((p) => p.empleadoId === 37 && p.severidad === "BLOQUEANTE" && p.codigo === "FECHA_SOSPECHOSA")).toBe(true);
    expect(r.resumen.empleadosBloqueados).toBe(1);
    expect(r.puedeAplicarse).toBe(false);
  });

  it("AMÍLCAR: advierte la diferencia entre fecha de entrada laboral y base de vacaciones, y reconstruye con fecha_alta", async () => {
    const r = await previsualizarHistorial(7, archivo(CSV), HOY);
    const am = r.empleados.find((e) => e.empleadoId === 14)!;
    expect(am.bloqueado).toBeNull();
    expect(am.fechaAlta).toBe("2023-04-13");
    expect(am.fechaInicioLaboral).toBe("2023-02-13");
    expect(r.problemas.find((p) => p.empleadoId === 14 && p.codigo === "FECHA_INICIO_LABORAL_DISTINTA")!.mensaje).toContain("Diferencia entre fecha entrada laboral y base de vacaciones");
  });

  it("compara contra las vacaciones ACTUALES solo para informar (no se suman) y avisa de los empleados que el archivo no trae", async () => {
    const r = await previsualizarHistorial(7, archivo(CSV), HOY);
    expect(r.existentes).toEqual({ vacaciones: 2, equivalentesEnArchivo: 1, noEnArchivo: 1 });
    const carlos = r.problemas.find((p) => p.codigo === "VACACIONES_ACTUALES_SIN_HISTORIAL_EN_ARCHIVO")!;
    expect(carlos.empleadoId).toBe(20);
    expect(carlos.severidad).toBe("DECISION");
  });

  it("con filas inválidas o empleados no encontrados puedeAplicarse = false; con archivo limpio y sin bloqueantes = true", async () => {
    expect((await previsualizarHistorial(7, archivo(CSV), HOY)).puedeAplicarse).toBe(false);
    const limpio = "codigo,fecha_inicio,fecha_fin,dias_habiles\nE-1,2024-06-03,2024-06-14,11\nE-20,2024-03-04,2024-03-08,5";
    const r = await previsualizarHistorial(7, archivo(limpio), HOY);
    expect(r.resumen.filasInvalidas).toBe(0);
    expect(r.puedeAplicarse).toBe(true);
    expect(r.existentes.equivalentesEnArchivo).toBe(2);
  });

  it("idempotente: dos vistas previas del mismo archivo son idénticas", async () => {
    const a = await previsualizarHistorial(7, archivo(CSV), HOY);
    const b = await previsualizarHistorial(7, archivo(CSV), HOY);
    expect(b).toEqual(a);
  });

  it("columnas obligatorias faltantes: BLOQUEANTE y sin simulación", async () => {
    const r = await previsualizarHistorial(7, archivo("codigo,fecha_inicio\nE-1,2024-06-03"), HOY);
    expect(r.puedeAplicarse).toBe(false);
    expect(r.problemas[0]).toMatchObject({ severidad: "BLOQUEANTE", codigo: "COLUMNAS_FALTANTES" });
    expect(r.empleados).toEqual([]);
  });

  it("la normalización no genera nada que no sea vacación: solo los dos tipos reconstruibles pasan (ninguna otra incidencia se incluye)", () => {
    const { encabezados, filas } = parsearCsv("codigo,fecha_inicio,fecha_fin,dias_habiles,tipo\nE-1,2024-06-03,2024-06-04,1,Permiso sin goce\nE-1,2024-06-05,2024-06-06,2,IGSS\nE-1,2024-06-07,2024-06-08,1,A cuenta de Vacaciones");
    const { validas, invalidas } = normalizarFilas(filas, detectarColumnas(encabezados));
    expect(validas.map((v) => v.tipo)).toEqual(["A cuenta de Vacaciones"]);
    expect(invalidas.map((i) => i.codigo)).toEqual(["TIPO_NO_RECONSTRUIBLE", "TIPO_NO_RECONSTRUIBLE"]);
  });
});

describe("resolución de empleados y cruce de aniversario", () => {
  const cabecera = "codigo,dpi,nombre,fecha_inicio,fecha_fin,dias_habiles";

  it("código y DPI que apuntan a empleados distintos: ERROR de conflicto, no se elige ninguno", async () => {
    const r = await previsualizarHistorial(7, archivo([cabecera, "E-20,2000111110101,,2024-06-03,2024-06-08,6"].join("\n")), HOY);
    expect(r.problemas.find((p) => p.codigo === "EMPLEADO_CONFLICTO")!.fila).toBe(2);
    expect(r.empleados).toHaveLength(0);
    expect(r.puedeAplicarse).toBe(false);
  });

  it("el nombre NO se usa como respaldo cuando la fila trae un código inexistente", async () => {
    const r = await previsualizarHistorial(7, archivo([cabecera, "E-99,,Ana Pérez,2024-06-03,2024-06-08,6"].join("\n")), HOY);
    expect(r.noEncontrados).toEqual([{ identificador: "código E-99", filas: [2] }]);
    expect(r.empleados).toHaveLength(0);
  });

  it("DPI duplicado entre dos empleados: ambiguo, no se elige", async () => {
    EMPLEADOS.push({ id: 90, codigo: "E-90", nombre: "Otro Ana", estado: "Activo", fecha_alta: "2021-01-04", fecha_inicio_laboral: "2021-01-04", dpi: "2000111110101" });
    try {
      const r = await previsualizarHistorial(7, archivo([cabecera, ",2000111110101,,2024-06-03,2024-06-08,6"].join("\n")), HOY);
      expect(r.problemas.find((p) => p.codigo === "EMPLEADO_AMBIGUO")!.fila).toBe(2);
      expect(r.empleados).toHaveLength(0);
    } finally {
      EMPLEADOS.pop();
    }
  });

  it("nombre único sin código ni DPI: se acepta como respaldo", async () => {
    const r = await previsualizarHistorial(7, archivo([cabecera, ",,Carlos Mejia,2024-06-03,2024-06-08,6"].join("\n")), HOY);
    expect(r.empleados.map((e) => e.empleadoId)).toEqual([20]);
  });

  it("una vacación que cruza el aniversario se cuenta, exige decisión y expone el desglose otorgado/consumido/utilizable", async () => {
    const r = await previsualizarHistorial(7, archivo([cabecera, "E-1,,,2024-04-08,2024-04-20,12"].join("\n")), HOY);
    expect(r.resumen.cruzanAniversario).toBe(1);
    expect(r.problemas.find((p) => p.codigo === "VACACION_CRUZA_ANIVERSARIO")!.severidad).toBe("DECISION");
    const d = r.empleados[0].resumenDias;
    expect(d.consumido).toBe(12);
    expect(Math.round((d.consumido + d.recortadoPorTope + d.perdidoPorVencimiento + d.saldoUtilizable) * 100) / 100).toBe(d.otorgado);
    expect(db.execute).not.toHaveBeenCalled();
  });
});
