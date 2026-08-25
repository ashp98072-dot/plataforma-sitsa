import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2/promise";
import { query } from "@/lib/db";
import { requireTenantRrhh } from "@/lib/tenant";
import { autorizarDescuento, crearDescuento } from "@/lib/rrhh/descuentos";
import {
  generarPlantillaDescuentos,
  parsearExcelDescuentos,
  type FilaDescuentoExcel,
} from "@/lib/rrhh/descuentos-import-excel";

type Ctx = { params: Promise<{ slug: string }> };
type Empleado = RowDataPacket & { id: number; codigo: string; dpi: string | null; nombre: string; estado: string };
type Preview = FilaDescuentoExcel & {
  empleadoId?: number;
  empleadoNombre?: string;
  estadoValidacion: "VALIDA" | "ERROR" | "DUPLICADO";
  detalle: string;
};

function esFechaReal(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

async function analizar(empresaId: number, filas: FilaDescuentoExcel[]): Promise<Preview[]> {
  const empleados = await query<Empleado[]>(
    `SELECT id, codigo, dpi, nombre, estado FROM empleados WHERE empresa_id = ?`,
    [empresaId],
  );
  const porCodigo = new Map(empleados.map((e) => [String(e.codigo).trim(), e]));
  const porDpi = new Map(empleados.filter((e) => e.dpi).map((e) => [String(e.dpi).trim(), e]));
  const existentes = await query<RowDataPacket[]>(
    `SELECT empleado_id, concepto, monto_original, DATE_FORMAT(fecha_inicio, '%Y-%m-%d') fecha_inicio
     FROM rrhh_descuentos_maestro WHERE empresa_id = ? AND estado <> 'CANCELADO'`,
    [empresaId],
  );
  const duplicados = new Set(existentes.map((d) =>
    `${Number(d.empleado_id)}|${String(d.concepto).trim().toLowerCase()}|${Number(d.monto_original).toFixed(2)}|${String(d.fecha_inicio)}`,
  ));
  const vistos = new Set<string>();

  return filas.map((fila) => {
    const empleadoCodigo = fila.codigoEmpleado ? porCodigo.get(fila.codigoEmpleado) : undefined;
    const empleadoDpi = fila.dpi ? porDpi.get(fila.dpi) : undefined;
    if (empleadoCodigo && empleadoDpi && Number(empleadoCodigo.id) !== Number(empleadoDpi.id)) {
      return { ...fila, estadoValidacion: "ERROR", detalle: "El código y el DPI pertenecen a colaboradores diferentes." };
    }
    const empleado = empleadoCodigo ?? empleadoDpi;
    if (!empleado) return { ...fila, estadoValidacion: "ERROR", detalle: "No se encontró un colaborador con ese código o DPI en esta empresa." };
    if (String(empleado.estado) !== "Activo") return { ...fila, empleadoId: Number(empleado.id), empleadoNombre: String(empleado.nombre), estadoValidacion: "ERROR", detalle: "El colaborador no está activo." };
    const errores: string[] = [];
    if (!fila.concepto) errores.push("falta concepto");
    if (!fila.motivo) errores.push("falta motivo");
    if (!fila.clasificacion) errores.push("clasificación inválida");
    if (!(fila.montoOriginal > 0)) errores.push("monto inválido");
    if (!fila.periodicidad) errores.push("periodicidad inválida");
    if (!esFechaReal(fila.fechaInicio)) errores.push("fecha inválida");
    const cuotas = fila.periodicidad === "UNA_VEZ" || fila.periodicidad === "MANUAL" ? 1 : fila.numeroCuotas;
    if (!(cuotas >= 1 && cuotas <= 60)) errores.push("cuotas fuera del rango 1–60");
    if (fila.periodicidad === "CADA_N_QUINCENAS" && !(Number(fila.cadaNQuincenas) > 0)) errores.push("falta cada_n_quincenas");
    if (fila.autorizar && fila.clasificacion === "JUDICIAL" && !fila.documentoId) errores.push("JUDICIAL requiere documento_id para autorizar");
    if (errores.length) return { ...fila, empleadoId: Number(empleado.id), empleadoNombre: String(empleado.nombre), estadoValidacion: "ERROR", detalle: errores.join("; ") };
    const key = `${Number(empleado.id)}|${fila.concepto.trim().toLowerCase()}|${fila.montoOriginal.toFixed(2)}|${fila.fechaInicio}`;
    if (duplicados.has(key) || vistos.has(key)) {
      return { ...fila, empleadoId: Number(empleado.id), empleadoNombre: String(empleado.nombre), estadoValidacion: "DUPLICADO", detalle: "Ya existe un descuento igual o está repetido en el archivo." };
    }
    vistos.add(key);
    return {
      ...fila,
      numeroCuotas: cuotas,
      empleadoId: Number(empleado.id),
      empleadoNombre: String(empleado.nombre),
      estadoValidacion: "VALIDA",
      detalle: fila.autorizar ? "Se creará activo y se generarán sus cuotas." : "Se creará como borrador.",
    };
  });
}

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "descuentos", "ver");
  if (guard.error) return guard.error;
  const body = new Uint8Array(await generarPlantillaDescuentos());
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="plantilla-importar-descuentos.xlsx"',
      "Cache-Control": "private, no-store",
    },
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "descuentos", "editar");
  if (guard.error) return guard.error;
  const form = await req.formData();
  const archivo = form.get("archivo");
  const accion = String(form.get("accion") ?? "validar");
  if (!(archivo instanceof File)) return NextResponse.json({ error: "Selecciona un archivo Excel." }, { status: 400 });
  if (!["validar", "importar"].includes(accion)) return NextResponse.json({ error: "Acción inválida." }, { status: 400 });
  if (!/\.(xlsx|xlsm)$/i.test(archivo.name)) return NextResponse.json({ error: "El archivo debe ser .xlsx o .xlsm." }, { status: 400 });

  let filas: FilaDescuentoExcel[];
  try {
    filas = await parsearExcelDescuentos(Buffer.from(await archivo.arrayBuffer()));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo leer el Excel." }, { status: 400 });
  }
  if (!filas.length) return NextResponse.json({ error: "El archivo no contiene descuentos." }, { status: 400 });
  if (filas.length > 500) return NextResponse.json({ error: "Máximo 500 descuentos por archivo." }, { status: 400 });
  const preview = await analizar(guard.empresa.id, filas);
  const resumen = {
    total: preview.length,
    validas: preview.filter((f) => f.estadoValidacion === "VALIDA").length,
    errores: preview.filter((f) => f.estadoValidacion === "ERROR").length,
    duplicados: preview.filter((f) => f.estadoValidacion === "DUPLICADO").length,
  };
  if (accion === "validar") return NextResponse.json({ accion, resumen, filas: preview });

  let creados = 0;
  let activados = 0;
  const resultados: { filaExcel: number; estado: string; detalle: string }[] = [];
  for (const fila of preview) {
    if (fila.estadoValidacion !== "VALIDA" || !fila.empleadoId || !fila.clasificacion || !fila.periodicidad) continue;
    const creado = await crearDescuento(guard.empresa.id, {
      empleadoId: fila.empleadoId,
      concepto: fila.concepto,
      clasificacion: fila.clasificacion,
      motivo: fila.motivo,
      montoOriginal: fila.montoOriginal,
      periodicidad: fila.periodicidad,
      numeroCuotas: fila.numeroCuotas,
      cadaNQuincenas: fila.cadaNQuincenas,
      fechaInicio: fila.fechaInicio,
      documentoId: fila.documentoId,
      creadoPor: guard.session.username,
    });
    if (!creado.ok) {
      resultados.push({ filaExcel: fila.filaExcel, estado: "ERROR", detalle: creado.mensaje });
      continue;
    }
    creados += 1;
    if (fila.autorizar) {
      const autorizado = await autorizarDescuento(guard.empresa.id, creado.id, guard.session.username);
      if (autorizado.ok) activados += 1;
      else resultados.push({ filaExcel: fila.filaExcel, estado: "BORRADOR", detalle: `Creado, pero no se pudo autorizar: ${autorizado.mensaje}` });
    }
  }
  return NextResponse.json({
    accion, resumen, creados, activados, resultados,
    mensaje: `Importación finalizada: ${creados} creados y ${activados} activados con cuotas.`,
  });
}
