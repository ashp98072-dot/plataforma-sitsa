import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import {
  actualizarEmpleado,
  codigoDuplicado,
  eliminarEmpleado,
  obtenerEmpleado,
  type EmpleadoInput,
} from "@/lib/rrhh/empleados";
import { normalizarHora } from "@/lib/rrhh/dates";
import { empleadoBodySchema, validarAltaMonaco } from "@/lib/rrhh/empleado-api-schema";
import { listarCambiosEmpleado, registrarCambiosEmpleado } from "@/lib/rrhh/empleado-cambios";
import { obtenerParametros } from "@/lib/rrhh/config";
import { registrarAuditoria } from "@/lib/auditoria";

type Ctx = { params: Promise<{ slug: string; id: string }> };

function toInput(
  d: ReturnType<typeof empleadoBodySchema.parse>,
  he: string,
  hs: string,
): EmpleadoInput {
  return {
    codigo: d.codigo,
    nombre: d.nombre,
    puesto: d.puesto ?? "",
    categoriaOps: d.categoriaOps ?? "",
    tipoHorario: d.tipoHorario,
    fechaAlta: d.fechaAlta,
    fechaInicioLaboral: d.fechaInicioLaboral ?? null,
    horaEntradaTeorica: he,
    horaSalidaTeorica: hs,
    estado: d.estado,
    dpi: d.dpi ?? "",
    nit: d.nit ?? "",
    igss: d.igss ?? "",
    irtra: d.irtra ?? "",
    telefono: d.telefono ?? "",
    email: d.email ?? "",
    direccion: d.direccion ?? "",
    sexo: d.sexo ?? "",
    fechaNacimiento: d.fechaNacimiento || null,
    tipoContrato: d.tipoContrato ?? "fijo",
    formaPago: d.formaPago ?? "transferencia",
    sueldoBase: d.sueldoBase ?? null,
    bonoIncentivo: d.bonoIncentivo ?? null,
    bonoHerramientas: d.bonoHerramientas ?? null,
    profesion: d.profesion ?? "",
    primerNombre: d.primerNombre ?? "",
    segundoNombre: d.segundoNombre ?? "",
    tercerNombre: d.tercerNombre ?? "",
    cuartoNombre: d.cuartoNombre ?? "",
    primerApellido: d.primerApellido ?? "",
    segundoApellido: d.segundoApellido ?? "",
    apellidoCasada: d.apellidoCasada ?? "",
    paisOrigen: d.paisOrigen ?? "",
    municipio: d.municipio ?? "",
    etnia: d.etnia ?? "",
    religion: d.religion ?? "",
    idioma: d.idioma ?? "",
    licenciaNumero: d.licenciaNumero ?? "",
    licenciaTipo: d.licenciaTipo ?? "",
    licenciaVence: d.licenciaVence || null,
    fechaEgreso: d.fechaEgreso || null,
    observaciones: d.observaciones ?? "",
    cuentaBancaria: d.cuentaBancaria ?? "",
    tipoCuenta: d.tipoCuenta ?? "",
    banco: d.banco ?? "",
    contactoEmergencia: d.contactoEmergencia ?? "",
    horasExtraHabilitado: d.horasExtraHabilitado ?? false,
  };
}

export async function GET(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "empleados", "ver");
  if (guard.error) return guard.error;
  const empId = Number(id);
  const emp = await obtenerEmpleado(guard.empresa.id, empId);
  if (!emp) {
    return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  }
  const url = new URL(req.url);
  const conHistorial = url.searchParams.get("historial") === "1";
  const historial = conHistorial
    ? await listarCambiosEmpleado(guard.empresa.id, empId)
    : undefined;
  return NextResponse.json({ empleado: emp, historial });
}

export async function PUT(req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "empleados", "editar");
  if (guard.error) return guard.error;
  const empId = Number(id);
  const parsed = empleadoBodySchema.safeParse(await req.json());
  if (!parsed.success) {
    // Diagnóstico seguro (autorizado 2026-08-21): solo estructura del error
    // de Zod — path/code/message de la regla que falló. NUNCA el valor
    // rechazado ni el resto del body (podría contener DPI, email, etc.).
    const issues = parsed.error.issues.map((i) => ({
      path: i.path.join("."),
      code: i.code,
      message: i.message,
    }));
    console.error(
      `[empleados][editar] id=${empId} validacion fallida (${issues.length} campo(s)):`,
      JSON.stringify(issues),
    );
    // Mensaje público: solo path + message de cada issue (nunca el valor
    // recibido). Un solo campo → frase corta; varios → lista separada por ";".
    const mensaje =
      issues.length === 1
        ? `Campo "${issues[0].path}": ${issues[0].message}.`
        : `Datos inválidos: ${issues
            .map((i) => `${i.path}: ${i.message}`)
            .join("; ")}.`;
    if (process.env.NODE_ENV !== "production") {
      return NextResponse.json({ error: mensaje, issues }, { status: 400 });
    }
    return NextResponse.json({ error: mensaje }, { status: 400 });
  }
  const d = parsed.data;
  const falta = validarAltaMonaco(d);
  if (falta) {
    return NextResponse.json({ error: falta }, { status: 400 });
  }
  const tienePartes = Boolean(
    (d.primerNombre || "").trim() && (d.primerApellido || "").trim(),
  );
  if (!(d.nombre || "").trim() && !tienePartes) {
    return NextResponse.json(
      { error: "Indica nombre completo o primer nombre + primer apellido." },
      { status: 400 },
    );
  }
  if (await codigoDuplicado(guard.empresa.id, d.codigo, empId)) {
    return NextResponse.json(
      { error: "Código duplicado en esta empresa." },
      { status: 400 },
    );
  }
  const antes = await obtenerEmpleado(guard.empresa.id, empId);
  if (!antes) {
    return NextResponse.json({ error: "No encontrado." }, { status: 404 });
  }
  const cfg = await obtenerParametros(guard.empresa.id);
  const he =
    normalizarHora(d.horaEntradaTeorica ?? cfg.hora_entrada_default) ??
    "07:00:00";
  const hs =
    normalizarHora(d.horaSalidaTeorica ?? cfg.hora_salida_default) ??
    "16:00:00";
  const input = toInput(d, he, hs);
  try {
    const ok = await actualizarEmpleado(guard.empresa.id, empId, input);
    if (!ok) {
      return NextResponse.json({ error: "No encontrado." }, { status: 404 });
    }
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error al actualizar." },
      { status: 400 },
    );
  }

  await registrarCambiosEmpleado({
    empresaId: guard.empresa.id,
    empleadoId: empId,
    username: guard.session.username,
    antes: {
      puesto: antes.puesto,
      sueldoBase: antes.sueldoBase,
      bonoIncentivo: antes.bonoIncentivo,
      bonoHerramientas: antes.bonoHerramientas,
      estado: antes.estado,
      tipoContrato: antes.tipoContrato,
      formaPago: antes.formaPago,
      categoriaOps: antes.categoriaOps,
    },
    despues: {
      puesto: input.puesto,
      sueldoBase: input.sueldoBase,
      bonoIncentivo: input.bonoIncentivo,
      bonoHerramientas: input.bonoHerramientas,
      estado: input.estado,
      tipoContrato: input.tipoContrato,
      formaPago: input.formaPago,
      categoriaOps: input.categoriaOps,
    },
    campos: [
      "puesto",
      "sueldoBase",
      "bonoIncentivo",
      "bonoHerramientas",
      "estado",
      "tipoContrato",
      "formaPago",
      "categoriaOps",
    ],
  });

  // Fase H1: auditoría dedicada solo cuando la elegibilidad de horas extra
  // realmente cambió (no en cada guardado del formulario).
  const antesHabilitado = Boolean(antes.horasExtraHabilitado);
  const despuesHabilitado = Boolean(input.horasExtraHabilitado);
  if (antesHabilitado !== despuesHabilitado) {
    await registrarAuditoria({
      empresaId: guard.empresa.id,
      usuario: guard.session.username,
      accion: despuesHabilitado
        ? "habilitar_horas_extra_empleado"
        : "deshabilitar_horas_extra_empleado",
      modulo: "rrhh",
      detalle: `Empleado #${empId} ${antes.codigo} · horas_extra_habilitado ${antesHabilitado} → ${despuesHabilitado}`,
    });
  }

  return NextResponse.json({ mensaje: "Empleado actualizado." });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const { slug, id } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "empleados", "eliminar");
  if (guard.error) return guard.error;
  const result = await eliminarEmpleado(guard.empresa.id, Number(id));
  if (!result.ok) {
    return NextResponse.json({ error: result.mensaje }, { status: 404 });
  }
  return NextResponse.json({ mensaje: result.mensaje });
}
