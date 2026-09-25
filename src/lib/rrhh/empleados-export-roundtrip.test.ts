import ExcelJS from "exceljs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: vi.fn() }));
vi.mock("@/lib/rrhh/empleados", () => ({
  actualizarEmpleado: vi.fn(), crearEmpleado: vi.fn(), obtenerEmpleadoPorCodigo: vi.fn(), obtenerEmpleadoPorDpi: vi.fn(),
}));
vi.mock("@/lib/rrhh/config", () => ({ obtenerParametros: vi.fn() }));

import { requireTenantRrhh } from "@/lib/tenant";
import { actualizarEmpleado, crearEmpleado, obtenerEmpleadoPorCodigo, obtenerEmpleadoPorDpi } from "@/lib/rrhh/empleados";
import { obtenerParametros } from "@/lib/rrhh/config";
import type { Empleado } from "@/lib/rrhh/empleados";
import { POST } from "@/app/api/empresas/[slug]/empleados/import/route";
import {
  exportarEmpleadosExcel, filaExcelDeEmpleado, FORMATO_COLUMNAS, generarPlantillaEmpleados, HEADERS_EMPLEADOS, HOJA_CATALOGOS, HOJA_EMPLEADOS,
  HOJA_INSTRUCCIONES, horaParaExcel, parsearPlantillaEmpleadosConAdvertencias, protegerTextoExcel, desprotegerTextoExcel,
} from "./empleados-export";

/**
 * EXPORTAR → EDITAR → REIMPORTAR: la exportación de empleados es directamente reimportable. Estas pruebas recorren el camino REAL
 * (exportarEmpleadosExcel → bytes .xlsx → ruta de importación con el parser y la fusión reales) y comparan lo que se enviaría a
 * actualizarEmpleado con el empleado original. Solo se simulan la sesión y la BD.
 */
const ctx = { params: Promise.resolve({ slug: "sitsa" }) };
const HEADERS_ESPERADOS = [
  "codigo", "dpi", "primer_nombre", "segundo_nombre", "primer_apellido", "segundo_apellido", "apellido_casada", "nombre", "nit", "igss", "irtra", "sexo",
  "fecha_nacimiento", "puesto", "area", "tipo_horario", "tipo_contrato", "forma_pago", "profesion", "fecha_contratacion", "fecha_ingreso",
  "hora_entrada_teorica", "hora_salida_teorica", "estado_laboral", "sueldo_base", "bono_incentivo", "bono_herramientas", "telefono", "email",
  "direccion", "pais_origen", "municipio", "etnia", "religion", "idioma", "licencia_numero", "licencia_tipo", "licencia_vence", "cuenta_bancaria",
  "tipo_cuenta", "banco", "contacto_emergencia", "observaciones",
];

const completo = (over: Partial<Empleado> = {}): Empleado => ({
  id: 11, numeroEmpleado: "N1", codigo: "2374186060101", nombre: "Juan Carlos Pérez López", puesto: "Piloto", categoriaOps: "Transporte", tipoHorario: "Fijo",
  fechaAlta: "2019-03-04", fechaInicioLaboral: "2019-03-11", horaEntradaTeorica: "07:00:00", horaSalidaTeorica: "16:00:00", estado: "Activo",
  dpi: "2374186060101", nit: "1234567-8", igss: "12345678901", irtra: "IR-77", telefono: "5555-1234", email: "juan@empresa.com", direccion: "Zona 1, Guatemala",
  sexo: "M", fechaNacimiento: "1990-03-15", tipoContrato: "fijo", formaPago: "transferencia", sueldoBase: 4002.28, bonoIncentivo: 250, bonoHerramientas: 100.5,
  profesion: "Piloto", primerNombre: "Juan", segundoNombre: "Carlos", primerApellido: "Pérez", segundoApellido: "López", apellidoCasada: "",
  paisOrigen: "Guatemala", municipio: "Guatemala", etnia: "Ladino", religion: "Católica", idioma: "Español", licenciaNumero: "L-9988", licenciaTipo: "C",
  licenciaVence: "2027-12-31", observaciones: "Sin novedades", cuentaBancaria: "0012345678", tipoCuenta: "monetaria", banco: "Industrial", contactoEmergencia: "María 5555-0000",
  supervisorId: 4, horasExtraHabilitado: true, fechaEgreso: null, ...over,
});

/** Campos que el Excel puede actualizar (el resto —supervisores, egreso, horas extra— NO pasa por Excel). */
const CAMPOS = ["codigo", "nombre", "dpi", "primerNombre", "segundoNombre", "primerApellido", "segundoApellido", "apellidoCasada", "nit", "igss", "irtra", "sexo", "fechaNacimiento",
  "puesto", "categoriaOps", "tipoHorario", "tipoContrato", "formaPago", "profesion", "fechaAlta", "fechaInicioLaboral", "horaEntradaTeorica", "horaSalidaTeorica", "estado",
  "sueldoBase", "bonoIncentivo", "bonoHerramientas", "telefono", "email", "direccion", "paisOrigen", "municipio", "etnia", "religion", "idioma", "licenciaNumero",
  "licenciaTipo", "licenciaVence", "cuentaBancaria", "tipoCuenta", "banco", "contactoEmergencia", "observaciones"] as const;

async function libroDe(e: Empleado): Promise<Buffer> {
  return exportarEmpleadosExcel([e], "ACME");
}
function peticion(buffer: Buffer): Request {
  const f = new FormData();
  f.append("file", new File([buffer as never], "empleados.xlsx"));
  return new Request("http://localhost/x", { method: "POST", body: f });
}
/** Reimporta el archivo y devuelve el payload que la ruta enviaría a actualizarEmpleado (o la respuesta). */
async function reimportar(existente: Empleado | null, buffer: Buffer) {
  vi.mocked(obtenerEmpleadoPorCodigo).mockResolvedValue(existente);
  const r = await POST(peticion(buffer), ctx);
  const json = await r.json();
  const llamada = vi.mocked(actualizarEmpleado).mock.calls[0];
  return { json, payload: llamada?.[2] as Record<string, unknown> | undefined, id: llamada?.[1] };
}
/** Edita celdas del archivo exportado (fila 2) por nombre de columna. */
async function editar(buffer: Buffer, cambios: Record<string, string | number | null>): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer as never);
  const ws = wb.getWorksheet(HOJA_EMPLEADOS)!;
  for (const [h, v] of Object.entries(cambios)) ws.getCell(2, HEADERS_EMPLEADOS.indexOf(h as never) + 1).value = v;
  return Buffer.from(await wb.xlsx.writeBuffer());
}
const igualesA = (payload: Record<string, unknown>) => Object.fromEntries(CAMPOS.map((c) => [c, payload[c] ?? null])) as Record<string, unknown> &
  Record<(typeof CAMPOS)[number], unknown>;
const esperado = (e: Empleado) => Object.fromEntries(CAMPOS.map((c) => [c, (e as unknown as Record<string, unknown>)[c] ?? null]));

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(requireTenantRrhh).mockResolvedValue({ empresa: { id: 3, nombre: "ACME" }, session: { username: "rrhh" } } as never);
  vi.mocked(obtenerParametros).mockResolvedValue({} as never);
  vi.mocked(actualizarEmpleado).mockResolvedValue(undefined as never);
  vi.mocked(obtenerEmpleadoPorDpi).mockResolvedValue(null);
});

describe("PLANTILLA vs EXPORTACIÓN — misma definición", () => {
  it("1/2/3) mismos encabezados, mismo orden y misma hoja principal 'Empleados' (43 columnas)", async () => {
    expect([...HEADERS_EMPLEADOS]).toEqual(HEADERS_ESPERADOS); // guardia: el esquema soportado no cambia sin querer
    const cargar = async (b: Buffer) => { const wb = new ExcelJS.Workbook(); await wb.xlsx.load(b as never); return wb; };
    const plantilla = await cargar(await generarPlantillaEmpleados());
    const exportacion = await cargar(await exportarEmpleadosExcel([completo()], "ACME"));
    for (const wb of [plantilla, exportacion]) {
      expect(wb.worksheets[0].name).toBe(HOJA_EMPLEADOS); // hoja principal primero
      expect(wb.getWorksheet(HOJA_EMPLEADOS)!.getRow(1).values).toEqual([undefined, ...HEADERS_ESPERADOS]);
    }
    expect(plantilla.getWorksheet(HOJA_EMPLEADOS)!.columnCount).toBe(43);
    expect(exportacion.getWorksheet(HOJA_EMPLEADOS)!.columnCount).toBe(43);
    expect(plantilla.getWorksheet("Personal")).toBeUndefined();
    expect(exportacion.getWorksheet("Personal")).toBeUndefined();
  });
  it("4) ambos incluyen Catalogos e Instrucciones con los textos de actualización", async () => {
    for (const buf of [await generarPlantillaEmpleados(), await exportarEmpleadosExcel([completo()], "ACME")]) {
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(buf as never);
      const cat = wb.getWorksheet(HOJA_CATALOGOS)!;
      expect(cat.getRow(1).values).toEqual([undefined, "area", "puesto", "sexo", "tipo_contrato", "forma_pago", "estado_laboral", "tipo_horario", "licencia_tipo"]);
      const col = (n: number) => Array.from({ length: cat.rowCount - 1 }, (_, i) => cat.getCell(i + 2, n).value).filter(Boolean);
      expect(col(3)).toEqual(["M", "F"]);
      expect(col(4)).toEqual(["fijo", "prueba", "temporal", "outsourcing"]);
      expect(col(5)).toEqual(["transferencia", "cheque", "efectivo"]);
      expect(col(6)).toEqual(["Activo", "Baja"]);
      expect(col(7)).toEqual(["Fijo", "Variable"]);
      expect(col(8)).toEqual(["A", "B", "C", "M"]);
      const texto = JSON.stringify(wb.getWorksheet(HOJA_INSTRUCCIONES)!.getSheetValues());
      expect(texto).toContain("Este archivo puede editarse y volver a importarse directamente desde RRHH > Empleados > Importar Excel.");
      expect(texto).toContain("El código identifica al empleado. No lo cambies si deseas actualizar la ficha existente.");
      expect(texto).toContain("vacío = conservar el dato actual");
      expect(texto).toContain("Supervisores, fecha de egreso, fotografía, documentos y configuración de horas extra se gestionan desde la ficha y no se modifican al reimportar este Excel.");
    }
  });
  it("formatos compatibles: identificadores/fechas/horas como texto, importes numéricos; desplegables solo como advertencia", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await exportarEmpleadosExcel([completo()], "ACME")) as never);
    const ws = wb.getWorksheet(HOJA_EMPLEADOS)!;
    const fila = filaExcelDeEmpleado(completo());
    HEADERS_EMPLEADOS.forEach((h, i) => {
      const fmt = FORMATO_COLUMNAS[h];
      expect(ws.getCell(2, i + 1).numFmt).toBe(fmt.tipo === "monto" ? "0.00" : "@");
      if (fmt.tipo === "monto") expect(typeof fila[i]).toBe("number");
    });
    const dv = ws.getCell(2, HEADERS_EMPLEADOS.indexOf("tipo_contrato") + 1).dataValidation;
    expect(dv).toMatchObject({ type: "list", errorStyle: "warning" });
  });
  it("una fila por empleado + encabezado; la exportación conserva los filtros de la ruta (cubierto por export/route.test.ts)", async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await exportarEmpleadosExcel([completo(), completo({ id: 12, codigo: "X2", dpi: "X2" })], "ACME")) as never);
    expect(wb.getWorksheet(HOJA_EMPLEADOS)!.actualRowCount).toBe(3); // (rowCount incluye filas vacías con desplegable)
  });
});

describe("COMPATIBILIDAD con archivos antiguos", () => {
  it("5/6) el parser acepta la exportación nueva y la hoja 'Personal' de exportaciones anteriores", async () => {
    const nuevo = await parsearPlantillaEmpleadosConAdvertencias(await libroDe(completo()));
    expect(nuevo.filas).toHaveLength(1);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Personal"); // formato de la exportación anterior
    ws.addRow([...HEADERS_EMPLEADOS]);
    ws.addRow(filaExcelDeEmpleado(completo()).map(String));
    const viejo = await parsearPlantillaEmpleadosConAdvertencias(Buffer.from(await wb.xlsx.writeBuffer()));
    expect(viejo.filas).toHaveLength(1);
    expect(viejo.filas[0].codigo).toBe("2374186060101");
    expect(viejo.filas[0].sueldoBase).toBe(4002.28);
  });
  it("hoja 'Empleados' de la plantilla anterior (sin Catalogos ni desplegables) sigue funcionando", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Empleados");
    ws.addRow([...HEADERS_EMPLEADOS]);
    ws.addRow(filaExcelDeEmpleado(completo()));
    expect((await parsearPlantillaEmpleadosConAdvertencias(Buffer.from(await wb.xlsx.writeBuffer()))).filas).toHaveLength(1);
  });
});

describe("ROUND-TRIP: exportar → reimportar SIN cambios no altera nada", () => {
  it("7/1) empleado con todos los campos: identidad, contrato, horario, estado, forma de pago, fechas e importes idénticos", async () => {
    const e = completo();
    const { payload, id } = await reimportar(e, await libroDe(e));
    expect(id).toBe(11);
    expect(igualesA(payload!)).toEqual(esperado(e));
    expect(crearEmpleado).not.toHaveBeenCalled();
  });
  it("importes con centavos exactos (Q4002.28 no pasa a 4002 ni a texto)", async () => {
    const e = completo({ sueldoBase: 4002.28, bonoIncentivo: 0.05, bonoHerramientas: 1234567.89 });
    expect(typeof filaExcelDeEmpleado(e)[HEADERS_EMPLEADOS.indexOf("sueldo_base")]).toBe("number");
    const { payload } = await reimportar(e, await libroDe(e));
    expect([payload!.sueldoBase, payload!.bonoIncentivo, payload!.bonoHerramientas]).toEqual([4002.28, 0.05, 1234567.89]);
  });
  it("fechas (nacimiento, contratación, ingreso, vencimiento de licencia) idénticas", async () => {
    const e = completo({ fechaNacimiento: "1985-12-01", fechaAlta: "2020-02-29", fechaInicioLaboral: "2020-03-02", licenciaVence: "2031-01-05" });
    const { payload } = await reimportar(e, await libroDe(e));
    expect([payload!.fechaNacimiento, payload!.fechaAlta, payload!.fechaInicioLaboral, payload!.licenciaVence]).toEqual(["1985-12-01", "2020-02-29", "2020-03-02", "2031-01-05"]);
    // el archivo muestra DD/MM/AAAA
    const filas = (await parsearPlantillaEmpleadosConAdvertencias(await libroDe(e))).filas;
    expect(filas[0].fechaAlta).toBe("29/02/2020");
  });
  it("horas: 07:00:00 exportado y reimportado sigue siendo 07:00:00 (y con segundos, exacto)", async () => {
    expect(horaParaExcel("07:00:00")).toBe("07:00");
    expect(horaParaExcel("07:00:30")).toBe("07:00:30");
    const e = completo({ horaEntradaTeorica: "07:00:00", horaSalidaTeorica: "16:30:15" });
    const { payload } = await reimportar(e, await libroDe(e));
    expect([payload!.horaEntradaTeorica, payload!.horaSalidaTeorica]).toEqual(["07:00:00", "16:30:15"]);
  });
  it("8) empleado con opcionales VACÍOS: no aparecen defaults destructivos (nada se rellena ni se borra)", async () => {
    const e = completo({ dpi: "", nit: "", igss: "", irtra: "", telefono: "", email: "", direccion: "", primerNombre: "", segundoNombre: "", licenciaNumero: "", licenciaTipo: "",
      licenciaVence: null, cuentaBancaria: "", tipoCuenta: "", banco: "", contactoEmergencia: "", observaciones: "", fechaNacimiento: null, sueldoBase: null, bonoIncentivo: null, bonoHerramientas: null });
    const { payload } = await reimportar(e, await libroDe(e));
    expect(payload!.dpi).toBe(""); // el código NO se copia como DPI de un empleado existente
    for (const c of ["nit", "igss", "irtra", "telefono", "email", "direccion", "licenciaNumero", "cuentaBancaria", "banco", "observaciones"]) expect(payload![c] ?? "").toBe("");
    expect([payload!.sueldoBase, payload!.bonoIncentivo, payload!.bonoHerramientas]).toEqual([null, null, null]);
    expect(payload!.fechaNacimiento ?? null).toBeNull();
    expect(payload!.licenciaVence ?? null).toBeNull();
  });
  it("9) placeholders históricos '48' (y N/A, -, —) se conservan tal cual: exportar → reimportar no los convierte ni los borra", async () => {
    const e = completo({ email: "48", licenciaNumero: "48", banco: "48", observaciones: "48", telefono: "N/A", direccion: "-", municipio: "—", etnia: "Pendiente" });
    const { payload } = await reimportar(e, await libroDe(e));
    for (const c of ["email", "licenciaNumero", "banco", "observaciones", "telefono", "direccion", "municipio", "etnia"] as const) expect(payload![c]).toBe(e[c]);
  });
  it("10) empleado Variable sigue Variable; 11) Outsourcing sigue Outsourcing; 12) Baja sigue Baja; 13) cheque/efectivo no pasan a transferencia", async () => {
    for (const over of [
      { tipoHorario: "Variable" }, { tipoContrato: "outsourcing" }, { estado: "Baja", fechaEgreso: "2026-08-31" }, { formaPago: "cheque" }, { formaPago: "efectivo" }, { tipoContrato: "prueba" }, { tipoContrato: "temporal" },
    ] as Partial<Empleado>[]) {
      vi.mocked(actualizarEmpleado).mockClear();
      const e = completo(over);
      const { payload } = await reimportar(e, await libroDe(e));
      expect(igualesA(payload!)).toEqual(esperado(e));
    }
  });
  it("campos sensibles fuera del Excel se preservan: supervisor, horas extra habilitadas y fecha de egreso", async () => {
    const e = completo({ estado: "Baja", fechaEgreso: "2026-08-31", horasExtraHabilitado: true, supervisorId: 4 });
    const { payload } = await reimportar(e, await libroDe(e));
    expect(payload!.horasExtraHabilitado).toBe(true);
    expect(payload!.fechaEgreso).toBe("2026-08-31");
    expect(payload!.supervisorIds).toBeUndefined(); // undefined = "no tocar"
  });
});

describe("ROUND-TRIP: editar el Excel exportado actualiza SOLO lo editado", () => {
  it("14/15) cambiar email, teléfono, dirección y salario: solo cambian esos valores", async () => {
    const e = completo();
    const editado = await editar(await libroDe(e), { email: "nuevo@correo.com", telefono: "4444-9999", direccion: "Zona 10", sueldo_base: 4500.75 });
    const { payload } = await reimportar(e, editado);
    const dif = Object.entries(igualesA(payload!)).filter(([c, v]) => v !== esperado(e)[c]).map(([c]) => c).sort();
    expect(dif).toEqual(["direccion", "email", "sueldoBase", "telefono"]);
    expect([payload!.email, payload!.telefono, payload!.direccion, payload!.sueldoBase]).toEqual(["nuevo@correo.com", "4444-9999", "Zona 10", 4500.75]);
  });
  it("16) una celda VACÍA no destruye el dato existente (vacío = conservar)", async () => {
    const e = completo();
    const { payload } = await reimportar(e, await editar(await libroDe(e), { email: null, telefono: "", sueldo_base: null, observaciones: null }));
    expect([payload!.email, payload!.telefono, payload!.sueldoBase, payload!.observaciones]).toEqual([e.email, e.telefono, e.sueldoBase, e.observaciones]);
  });
  it("17) un placeholder no destruye un dato real existente", async () => {
    const e = completo();
    const { payload } = await reimportar(e, await editar(await libroDe(e), { email: "48", telefono: "N/A", direccion: "Pendiente", banco: "-" }));
    expect([payload!.email, payload!.telefono, payload!.direccion, payload!.banco]).toEqual([e.email, e.telefono, e.direccion, e.banco]);
  });
  it("18) un dato real SUSTITUYE al placeholder ('48' → correo válido)", async () => {
    const e = completo({ email: "48" });
    const { payload } = await reimportar(e, await editar(await libroDe(e), { email: "persona@correo.com" }));
    expect(payload!.email).toBe("persona@correo.com");
  });
  it("cambiar tipo de contrato / horario / forma de pago / estado explícitamente SÍ se aplica", async () => {
    const e = completo();
    const { payload } = await reimportar(e, await editar(await libroDe(e), { tipo_contrato: "temporal", tipo_horario: "Variable", forma_pago: "efectivo", estado_laboral: "Baja" }));
    expect([payload!.tipoContrato, payload!.tipoHorario, payload!.formaPago, payload!.estado]).toEqual(["temporal", "Variable", "efectivo", "Baja"]);
  });
});

describe("IDENTIDAD — código modificado y DPI existente", () => {
  it("20) código cambiado + DPI que ya pertenece a otro empleado → BLOQUEA (no crea duplicado ni reasigna en silencio)", async () => {
    const e = completo();
    const dueno = completo({ id: 11, codigo: "2374186060101", nombre: "Juan Carlos Pérez López" });
    vi.mocked(obtenerEmpleadoPorDpi).mockResolvedValue(dueno);
    const { json, payload } = await reimportar(null, await editar(await libroDe(e), { codigo: "COD-MODIFICADO" }));
    expect(crearEmpleado).not.toHaveBeenCalled();
    expect(actualizarEmpleado).not.toHaveBeenCalled();
    expect(payload).toBeUndefined();
    expect(json.creados).toBe(0);
    expect(json.errores.join(" ")).toContain("El DPI ya pertenece al empleado 2374186060101 — Juan Carlos Pérez López. El código del archivo fue modificado. Corrige el código para actualizar el empleado existente.");
  });
  it("21) código correcto + DPI correcto → actualiza (no consulta duplicados)", async () => {
    const e = completo();
    const { payload, json } = await reimportar(e, await libroDe(e));
    expect(payload).toBeDefined();
    expect(json.actualizados).toBe(1);
    expect(obtenerEmpleadoPorDpi).not.toHaveBeenCalled();
  });
  it("empleado realmente NUEVO (código y DPI inexistentes) se crea normalmente", async () => {
    const nuevo = completo({ codigo: "9999999999999", dpi: "9999999999999" });
    vi.mocked(crearEmpleado).mockResolvedValue({} as never);
    const { json } = await reimportar(null, await libroDe(nuevo));
    expect(crearEmpleado).toHaveBeenCalledTimes(1);
    expect(json.creados).toBe(1);
  });
  it("un DPI placeholder ('48', N/A) no dispara la búsqueda de duplicados", async () => {
    vi.mocked(crearEmpleado).mockResolvedValue({} as never);
    await reimportar(null, await libroDe(completo({ codigo: "8888888888888", dpi: "48" })));
    expect(obtenerEmpleadoPorDpi).not.toHaveBeenCalled();
  });
});

describe("SEGURIDAD de texto Excel", () => {
  it("texto peligroso se protege al exportar y se restituye EXACTO al importar", async () => {
    for (const v of ["=HYPERLINK(\"http://x\")", "@SUM(A1)", "+cmd|calc", "-2+3", "\t=x", "'=ya-con-apostrofe"]) {
      expect(desprotegerTextoExcel(protegerTextoExcel(v))).toBe(v);
      expect(protegerTextoExcel(v).startsWith("'")).toBe(true);
    }
    for (const seguro of ["Ana", "+502 5555-1234", "-", "—", "-5", "48", ""]) expect(protegerTextoExcel(seguro)).toBe(seguro);
    const e = completo({ nombre: "=1+1", observaciones: "@x", telefono: "+502 5555-1234" });
    const { payload } = await reimportar(e, await libroDe(e));
    expect([payload!.nombre, payload!.observaciones, payload!.telefono]).toEqual(["=1+1", "@x", "+502 5555-1234"]);
  });
});
