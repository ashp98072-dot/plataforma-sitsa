import { readFileSync } from "node:fs";
import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn(), getPool: vi.fn() }));
vi.mock("@/lib/operaciones/disponibilidad", () => ({ listarDisponibilidadVehiculos: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
vi.mock("@/lib/flota/acceso", () => ({ obtenerVehiculoAccesible: vi.fn() }));
vi.mock("@/lib/tms/personal-resolucion", () => ({ personalDesdeEmpleado: vi.fn(async () => 500) }));
vi.mock("@/lib/tms/plan-comunes", () => ({ upsertLugar: vi.fn(async () => 1), guardarAuxiliaresPlan: vi.fn(async () => undefined) }));
vi.mock("@/lib/tms/paradas", () => ({ guardarParadasPlan: vi.fn(async () => ({ ok: true })) }));
vi.mock("@/lib/tms/viaticos", () => ({ sincronizarViaticosPlan: vi.fn(async () => undefined) }));
vi.mock("@/lib/tms/ruta-tarifas", () => ({ tarifasActivasDeVariasRutas: vi.fn(async () => new Map()) }));
vi.mock("@/lib/tms/codigo-plan", () => ({ asegurarCodigoPlanUnico: vi.fn(async () => "PLAN-NUEVO") }));

import { getPool, query } from "@/lib/db";
import { listarDisponibilidadVehiculos } from "@/lib/operaciones/disponibilidad";
import { obtenerVehiculoAccesible } from "@/lib/flota/acceso";
import {
  ENCABEZADO_TC,
  ENCABEZADOS_PLANTILLA_PROGRAMACION,
  ENCABEZADOS_PROGRAMACION,
  generarPlantillaProgramacion,
  parsearExcelProgramacion,
  type FilaProgramacionExcel,
} from "./programacion-import-excel";
import { confirmarImportacionProgramacion, previsualizarImportacionProgramacion } from "./programacion-import";

/**
 * TMS-TC-PLANES-REPORTES-1 — columna OPCIONAL "TC / Caja / Remolque" del importador de Programación.
 * Solo existe viaje PROPIO en la importación (no hay columna de tipo de viaje ni recursos externos), así que el
 * TC importado es siempre INTERNO: se resuelve contra Flota con la misma regla que Programación manual.
 */

// ---------------------------------------------------------------- Excel (parser + plantilla)
async function libro(opts: { conTc: boolean | "otro"; filas?: (string | number)[][] }): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Programacion");
  const enc: string[] = [...ENCABEZADOS_PROGRAMACION];
  if (opts.conTc === true) enc.push(ENCABEZADO_TC);
  if (opts.conTc === "otro") enc.push("Columna rara");
  ws.addRow(enc);
  ws.addRow(["2026-09-20", "08:00", "EJEMPLO-NO-IMPORTAR", "x", "1", "P-0", "", "", "", 0, "", "", "", ""]); // ejemplo (fila 2)
  ws.addRow(["2026-09-20", "08:00", "EJEMPLO-NO-IMPORTAR", "x", "1", "P-0", "", "", "", 0, "", "", "", ""]); // ejemplo (fila 3)
  for (const f of opts.filas ?? []) ws.addRow(f);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
// A..M (13) + N (TC)
const filaExcel = (tc?: string) => ["2026-09-21", "09:00", "1001", "123456-7", "P-1", "p-123abc", "", "", "Carga", 1500, "2026-09-21", "17:00", "obs", ...(tc === undefined ? [] : [tc])];

describe("parser: compatibilidad con Excel antiguo (13 columnas) y nuevo (14)", () => {
  it("archivo ANTIGUO de 13 columnas sigue funcionando: sin propiedad tcExcel (objeto idéntico al de siempre)", async () => {
    const filas = await parsearExcelProgramacion(await libro({ conTc: false, filas: [filaExcel()] }));
    expect(filas).toHaveLength(1);
    expect(filas[0].erroresSintacticos).toEqual([]);
    expect("tcExcel" in filas[0]).toBe(false);
    expect(filas[0].placaExcel).toBe("P-123ABC");
  });

  it("archivo NUEVO de 14 columnas: lee 'TC / Caja / Remolque' normalizado (mayúsculas, sin espacios repetidos)", async () => {
    const filas = await parsearExcelProgramacion(await libro({ conTc: true, filas: [filaExcel("  tc-456xyz "), filaExcel("")] }));
    expect(filas.map((f) => f.tcExcel)).toEqual(["TC-456XYZ", ""]);
    expect(filas.every((f) => f.erroresSintacticos.length === 0)).toBe(true); // el TC nunca es obligatorio
  });

  it("los encabezados oficiales (13) NO cambian; la plantilla nueva agrega el 14º al final", () => {
    expect(ENCABEZADOS_PROGRAMACION).toHaveLength(13);
    expect(ENCABEZADOS_PLANTILLA_PROGRAMACION).toHaveLength(14);
    expect(ENCABEZADOS_PLANTILLA_PROGRAMACION.slice(0, 13)).toEqual([...ENCABEZADOS_PROGRAMACION]);
    expect(ENCABEZADOS_PLANTILLA_PROGRAMACION[13]).toBe("TC / Caja / Remolque");
  });

  it("un encabezado desconocido en la columna 14 se rechaza (no se adivina)", async () => {
    await expect(parsearExcelProgramacion(await libro({ conTc: "otro", filas: [filaExcel("x")] }))).rejects.toThrow(/columna N/);
  });

  it("sin la columna, un valor suelto en N se ignora (comportamiento de hoy)", async () => {
    const filas = await parsearExcelProgramacion(await libro({ conTc: false, filas: [filaExcel("TC-1")] }));
    expect("tcExcel" in filas[0]).toBe(false);
  });

  it("una fila que solo trae TC (resto vacío) NO se ignora como vacía: falla por sus obligatorios", async () => {
    const filas = await parsearExcelProgramacion(await libro({ conTc: true, filas: [["", "", "", "", "", "", "", "", "", "", "", "", "", "TC-1"]] }));
    expect(filas).toHaveLength(1);
    expect(filas[0].erroresSintacticos.length).toBeGreaterThan(0);
  });
});

const vehiculo = (id: number, placa: string, tipoUnidad: "VEHICULO" | "CABEZAL" | "TC", extra: Record<string, unknown> = {}) => ({
  id, placa, marca: "M", modelo: "X", descripcion: null, tipoUnidad, activo: true, enTaller: false, estado: "activo", kmActual: 0, empresaId: 7,
  compartido: false, esPropio: true, puedeEnviar: true, motivoNoDisponible: null, estadoDisponibilidad: "disponible", ...extra,
});

function mockCatalogo(vehiculos: ReturnType<typeof vehiculo>[]) {
  vi.mocked(listarDisponibilidadVehiculos).mockResolvedValue({ vehiculos } as never);
}

describe("plantilla generada", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(query).mockResolvedValue([] as never);
    mockCatalogo([vehiculo(1, "P-123ABC", "VEHICULO"), vehiculo(2, "C-1CAB", "CABEZAL"), vehiculo(3, "TC-456XYZ", "TC"), vehiculo(4, "TC-INACT", "TC", { activo: false })]);
  });

  it("incluye la columna 'TC / Caja / Remolque' al final, hoja 'TC' separada de 'Vehiculos' y ayuda en Instrucciones", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await generarPlantillaProgramacion(7)) as unknown as ExcelJS.Buffer);
    const ws = wb.getWorksheet("Programacion")!;
    expect(ws.getCell(1, 14).value).toBe("TC / Caja / Remolque");
    expect(ws.getCell(1, 13).value).toBe("Observaciones"); // las 13 columnas no se movieron
    const col = (hoja: string) => (wb.getWorksheet(hoja)!.getColumn(1).values as unknown[]).slice(2);
    expect(col("TC")).toEqual(["TC-456XYZ"]); // solo TC activos
    expect(col("Vehiculos")).toEqual(["P-123ABC", "C-1CAB"]); // sin TC: no se mezclan
    const instrucciones = (wb.getWorksheet("Instrucciones")!.getColumn(1).values as unknown[]).map(String);
    expect(instrucciones).toContain("TC / Caja / Remolque");
  });

  it("la plantilla generada se lee con su propio parser (14 columnas, sin filas reales -> [])", async () => {
    expect(await parsearExcelProgramacion(await generarPlantillaProgramacion(7))).toEqual([]);
  });
});

// ---------------------------------------------------------------- preview / confirmación
type PlanTc = { empresa_id: number; tc_vehiculo_id: number; fecha: string; codigo: string; estado: string };
let planes: PlanTc[];
let flota: Record<number, { id: number; placa: string; activo: number; en_taller: number; tipo_unidad: string; empresa_id: number; acceso: number[] }>;
const conn = { query: vi.fn(), execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };

const fila = (over: Partial<FilaProgramacionExcel> = {}): FilaProgramacionExcel => ({
  filaExcel: 4, fechaSalidaExcel: "2026-09-21", horaSalidaExcel: "08:00", codigoRutaExcel: "1001", clienteExcel: "123456-7",
  pilotoCodigoExcel: "P-1", placaExcel: "P-123ABC", auxiliar1CodigoExcel: "", auxiliar2CodigoExcel: "", tipoTrasladoExcel: "Carga",
  tarifaExcel: 1500, fechaRegresoExcel: null, horaRegresoExcel: null, observacionesExcel: "", erroresSintacticos: [], ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  planes = [];
  flota = {
    1: { id: 1, placa: "P-123ABC", activo: 1, en_taller: 0, tipo_unidad: "VEHICULO", empresa_id: 7, acceso: [] },
    2: { id: 2, placa: "C-1CAB", activo: 1, en_taller: 0, tipo_unidad: "CABEZAL", empresa_id: 7, acceso: [] },
    3: { id: 3, placa: "TC-456XYZ", activo: 1, en_taller: 0, tipo_unidad: "TC", empresa_id: 7, acceso: [] },
    4: { id: 4, placa: "TC-INACT", activo: 0, en_taller: 0, tipo_unidad: "TC", empresa_id: 7, acceso: [] },
    5: { id: 5, placa: "TC-TALLER", activo: 1, en_taller: 1, tipo_unidad: "TC", empresa_id: 7, acceso: [] },
    6: { id: 6, placa: "TC-OTRA", activo: 1, en_taller: 0, tipo_unidad: "TC", empresa_id: 9, acceso: [] }, // otra empresa, sin acceso
    7: { id: 7, placa: "TC-COMP", activo: 1, en_taller: 0, tipo_unidad: "TC", empresa_id: 9, acceso: [7] }, // compartido con la empresa 7
  };
  // Catálogo que ve la empresa 7 (propios + compartidos; NO el de la otra empresa).
  mockCatalogo(Object.values(flota).filter((v) => v.empresa_id === 7 || v.acceso.includes(7))
    .map((v) => vehiculo(v.id, v.placa, v.tipo_unidad as "TC", { activo: v.activo === 1, esPropio: v.empresa_id === 7 })));
  // resolverTcInterno (REAL) usa obtenerVehiculoAccesible: propio o compartido, nunca ajeno.
  vi.mocked(obtenerVehiculoAccesible).mockImplementation((async (empresaId: number, id: number) => {
    const v = flota[id];
    return v && (v.empresa_id === empresaId || v.acceso.includes(empresaId)) ? v : null;
  }) as never);
  vi.mocked(query).mockImplementation((async (sql: string, params: unknown[]) => {
    const s = String(sql);
    if (s.includes("FROM tms_cliente_rutas")) {
      return [{ id: 10, codigo: "1001", cliente_id: 3, activo: 1, tarifa_referencia: 1500, lugar_carga_texto: "Bodega", destino_descripcion: "Xela",
        contacto_nombre: null, contacto_cargo: null, contacto_telefono: null, cliente_nombre: "Acme", cliente_nit: "123456-7" }];
    }
    if (s.includes("FROM empleados")) return [{ id: 100, codigo: "P-1", nombre: "Juan", estado: "Activo" }];
    if (s.includes("FROM tms_personal")) return [];
    if (s.includes("FROM tms_unidades")) return [];
    if (s.includes("p.tc_vehiculo_id = v.id")) { // consulta REAL por intervalos (A2.1): misma empresa y ventana; estos planes no tienen hora/regreso
      const empresa = Number(params[0]);
      const fechaFin = String(params[6]);
      const fechaInicio = String(params[7]);
      const ids = (params.slice(9) as unknown[]).filter((x): x is number => typeof x === "number");
      return planes.filter((p) => p.empresa_id === empresa && p.fecha <= fechaFin && p.fecha >= fechaInicio && ids.includes(p.tc_vehiculo_id))
        .map((p) => ({ recurso_id: p.tc_vehiculo_id, nombre: flota[p.tc_vehiculo_id].placa, plan_id: 1, codigo: p.codigo, fecha_plan: p.fecha, hora_carga: null, regreso_estimado: null }));
    }
    return [];
  }) as never);
});

const preview = (f: FilaProgramacionExcel[]) => previsualizarImportacionProgramacion(7, f);

describe("preview: TC de un viaje PROPIO", () => {
  it("fila SIN TC (columna ausente o vacía): resultado idéntico al de siempre, sin campos de TC", async () => {
    for (const tcExcel of [undefined, ""]) {
      const r = (await preview([fila(tcExcel === undefined ? {} : { tcExcel })])).filas[0];
      expect(r.estado).toBe("ok");
      expect("tcVehiculoId" in r.datos!).toBe(false);
      expect("tcPlaca" in r.datos!).toBe(false);
    }
  });

  it("TC válido: se muestra el dato RESUELTO por el backend (id y placa canónica de Flota)", async () => {
    const r = (await preview([fila({ tcExcel: "TC-456XYZ" })])).filas[0];
    expect(r.estado).toBe("ok");
    expect(r.datos).toMatchObject({ tcVehiculoId: 3, tcPlaca: "TC-456XYZ", unidadPlaca: "P-123ABC" });
  });

  it("coincidencia exacta e insensible a mayúsculas/espacios; nunca parcial", async () => {
    expect((await preview([fila({ tcExcel: "tc-456xyz" })])).filas[0].estado).toBe("ok");
    const parcial = (await preview([fila({ tcExcel: "TC-456" })])).filas[0];
    expect(parcial.estado).toBe("error");
    expect(parcial.errores).toEqual(['El TC con placa "TC-456" no existe o no es accesible para esta empresa.']);
  });

  it("TC inexistente -> error claro", async () => {
    const r = (await preview([fila({ tcExcel: "TC-NOEXISTE" })])).filas[0];
    expect(r.estado).toBe("error");
    expect(r.errores[0]).toContain('"TC-NOEXISTE" no existe');
    expect(r.datos).toBeNull();
  });

  it("recurso que NO es TC (VEHICULO / CABEZAL) -> error 'no está clasificado como TC'", async () => {
    const cabezal = (await preview([fila({ tcExcel: "C-1CAB" })])).filas[0];
    expect(cabezal.estado).toBe("error");
    expect(cabezal.errores).toEqual(["El vehículo C-1CAB no está clasificado como TC."]);
    flota[8] = { id: 8, placa: "V-777", activo: 1, en_taller: 0, tipo_unidad: "VEHICULO", empresa_id: 7, acceso: [] };
    mockCatalogo(Object.values(flota).filter((v) => v.empresa_id === 7).map((v) => vehiculo(v.id, v.placa, v.tipo_unidad as "TC")));
    const vehiculoComun = (await preview([fila({ tcExcel: "V-777" })])).filas[0];
    expect(vehiculoComun.errores).toEqual(["El vehículo V-777 no está clasificado como TC."]);
  });

  it("la misma placa como unidad y como TC -> error", async () => {
    flota[1].tipo_unidad = "TC";
    const r = (await preview([fila({ tcExcel: "P-123ABC" })])).filas[0];
    expect(r.errores[0]).toContain("no puede ser la misma placa que la unidad");
  });

  it("TC inactivo -> error; TC en taller -> error", async () => {
    // (el catálogo de la empresa sí lo lista; la regla de Programación manual lo rechaza)
    expect((await preview([fila({ tcExcel: "TC-INACT" })])).filas[0].errores[0]).toBe("El TC TC-INACT está inactivo.");
    expect((await preview([fila({ tcExcel: "TC-TALLER" })])).filas[0].errores[0]).toBe("El TC TC-TALLER está actualmente en taller.");
  });

  it("TC de OTRA empresa sin acceso -> se rechaza sin revelar su existencia (mismo mensaje que inexistente)", async () => {
    const r = (await preview([fila({ tcExcel: "TC-OTRA" })])).filas[0];
    expect(r.estado).toBe("error");
    expect(r.errores).toEqual(['El TC con placa "TC-OTRA" no existe o no es accesible para esta empresa.']);
  });

  it("TC compartido con la empresa (flota_vehiculo_acceso): se acepta, igual que en Programación manual", async () => {
    const r = (await preview([fila({ tcExcel: "TC-COMP" })])).filas[0];
    expect(r.estado).toBe("ok");
    expect(r.datos?.tcVehiculoId).toBe(7);
  });

  it("TC ocupado el mismo día por otro viaje YA existente -> error con el código del plan (misma política temporal que la unidad)", async () => {
    planes = [{ empresa_id: 7, tc_vehiculo_id: 3, fecha: "2026-09-21", codigo: "PLAN-20260921-001", estado: "Programado" }];
    const r = (await preview([fila({ tcExcel: "TC-456XYZ" })])).filas[0];
    expect(r.estado).toBe("error");
    expect(r.errores).toEqual(["El TC TC-456XYZ ya está asignado al PLAN-20260921-001 para el 21/09/2026."]);
  });

  it("otro día o plan de otra empresa NO bloquean el TC", async () => {
    planes = [
      { empresa_id: 7, tc_vehiculo_id: 3, fecha: "2026-09-22", codigo: "OTRO-DIA", estado: "Programado" },
      { empresa_id: 8, tc_vehiculo_id: 3, fecha: "2026-09-21", codigo: "OTRA-EMPRESA", estado: "Programado" },
    ];
    expect((await preview([fila({ tcExcel: "TC-456XYZ" })])).filas[0].estado).toBe("ok");
  });

  it("dos filas del MISMO archivo con el mismo TC el mismo día -> error en ambas (traslape en lote)", async () => {
    const r = await preview([
      fila({ filaExcel: 4, tcExcel: "TC-456XYZ", pilotoCodigoExcel: "P-1", placaExcel: "P-123ABC" }),
      fila({ filaExcel: 5, tcExcel: "tc-456xyz", pilotoCodigoExcel: "P-2", placaExcel: "C-1CAB", codigoRutaExcel: "1002" }),
    ]);
    expect(r.filas.map((f) => f.estado)).toEqual(["error", "error"]);
    expect(r.filas[0].errores.join(" ")).toContain('comparten el TC "TC-456XYZ"');
  });

  it("el mismo TC en días distintos del archivo es válido (sin error de TC en ninguna fila)", async () => {
    const r = await preview([
      fila({ filaExcel: 4, tcExcel: "TC-456XYZ" }),
      fila({ filaExcel: 5, tcExcel: "TC-456XYZ", fechaSalidaExcel: "2026-09-22", pilotoCodigoExcel: "P-1" }),
    ]);
    expect(r.filas.every((f) => f.errores.every((e) => !e.includes("TC")))).toBe(true);
  });
});

describe("confirmación: guarda el TC interno y REVALIDA la disponibilidad", () => {
  beforeEach(() => {
    conn.query.mockImplementation(async (sql: string) => (String(sql).includes("GET_LOCK") ? [[{ l: 1 }]] : [[]]));
    conn.execute.mockImplementation(async (sql: string) => {
      if (String(sql).includes("INSERT INTO tms_unidades")) return [{ insertId: 30 }];
      if (String(sql).includes("INSERT INTO tms_planes_viaje")) return [{ insertId: 900 }];
      return [{ affectedRows: 1 }];
    });
    vi.mocked(getPool).mockReturnValue({ getConnection: vi.fn().mockResolvedValue(conn) } as never);
  });
  const confirmar = (f: FilaProgramacionExcel[]) => confirmarImportacionProgramacion(7, "jefe", "prog.xlsx", "hash", f);
  const updatesTc = () => conn.execute.mock.calls.filter(([sql]) => String(sql).includes("SET tc_vehiculo_id"));

  it("Propio con TC válido: tc_vehiculo_id + snapshot tc_placa_historica y tc_externo_placa = NULL, misma transacción", async () => {
    const r = await confirmar([fila({ tcExcel: "tc-456xyz" })]);
    expect(r).toMatchObject({ resultado: "exitoso", filasImportadas: 1 });
    expect(updatesTc()).toHaveLength(1);
    const [sql, params] = updatesTc()[0];
    expect(String(sql)).toContain("tc_externo_placa = NULL");
    expect(String(sql)).toContain("empresa_id = ?");
    expect(params).toEqual([3, "TC-456XYZ", 900, 7]); // id, snapshot (placa de Flota), plan, empresa de la sesión
    expect(conn.commit).toHaveBeenCalledTimes(1);
    // El INSERT del plan es el de siempre (sin columnas TC): no se toca la sentencia existente.
    const insert = conn.execute.mock.calls.find(([q]) => String(q).includes("INSERT INTO tms_planes_viaje"))!;
    expect(String(insert[0])).not.toContain("tc_vehiculo_id");
  });

  it("sin TC no se escribe ninguna columna de TC (archivo de 13 columnas: comportamiento de hoy)", async () => {
    expect((await confirmar([fila()])).resultado).toBe("exitoso");
    expect(updatesTc()).toHaveLength(0);
  });

  it("no crea ni toca flota_vehiculos (TC interno solo se referencia)", async () => {
    await confirmar([fila({ tcExcel: "TC-456XYZ" })]);
    expect(conn.execute.mock.calls.some(([sql]) => /INSERT INTO flota_vehiculos|UPDATE flota_vehiculos/.test(String(sql)))).toBe(false);
  });

  it("al confirmar se REVALIDA: si otro viaje tomó el TC entre el preview y la confirmación, no se importa nada", async () => {
    expect((await preview([fila({ tcExcel: "TC-456XYZ" })])).filas[0].estado).toBe("ok"); // el preview pasó
    planes = [{ empresa_id: 7, tc_vehiculo_id: 3, fecha: "2026-09-21", codigo: "PLAN-GANADOR", estado: "Programado" }];
    const r = await confirmar([fila({ tcExcel: "TC-456XYZ" })]);
    expect(r.resultado).toBe("error");
    expect(r.resultado === "error" && r.erroresPorFila?.[0].errores[0]).toContain("PLAN-GANADOR");
    expect(conn.beginTransaction).not.toHaveBeenCalled();
    expect(updatesTc()).toHaveLength(0);
  });

  it("todo o nada: si falla el guardado del TC hay rollback de todo el lote", async () => {
    conn.execute.mockImplementation(async (sql: string) => {
      if (String(sql).includes("INSERT INTO tms_unidades")) return [{ insertId: 30 }];
      if (String(sql).includes("INSERT INTO tms_planes_viaje")) return [{ insertId: 900 }];
      if (String(sql).includes("SET tc_vehiculo_id")) throw new Error("columna inexistente");
      return [{ affectedRows: 1 }];
    });
    const r = await confirmar([fila({ tcExcel: "TC-456XYZ" })]);
    expect(r.resultado).toBe("error");
    expect(conn.rollback).toHaveBeenCalledTimes(1);
    expect(conn.commit).not.toHaveBeenCalled();
  });
});

describe("garantías estructurales", () => {
  it("el importador no acepta ni crea TC externos/tercerizados (no existe tipo de viaje en la importación) y no escribe tc_externo_placa con texto", () => {
    const src = readFileSync("src/lib/tms/programacion-import.ts", "utf8");
    expect(src).not.toMatch(/tc_externo_placa\s*=\s*\?/);
    expect(src).not.toMatch(/Tercerizado/);
    expect(src).toContain("resolverTcInterno"); // misma resolución que Programación manual
    expect(src).toContain('tipo: "tc" as const'); // misma política de disponibilidad diaria
  });

  it("la vista Validar Excel muestra el TC resuelto (o el recibido si hay error)", () => {
    const page = readFileSync("src/app/e/[slug]/programacion/importar/page.tsx", "utf8");
    expect(page).toContain("TC / Caja / Remolque");
    expect(page).toContain("r?.tcPlaca");
    expect(page).toContain("fila.tcExcel");
    const route = readFileSync("src/app/api/empresas/[slug]/tms/programacion/importar/route.ts", "utf8");
    expect(route).toContain('tcExcel: fila.tcExcel ?? ""');
  });
});
