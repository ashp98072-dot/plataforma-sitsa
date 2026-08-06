import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import {
  codigoDuplicado,
  crearEmpleado,
  listarEmpleados,
  type EmpleadoInput,
} from "@/lib/rrhh/empleados";
import { normalizarHora } from "@/lib/rrhh/dates";
import { obtenerParametros } from "@/lib/rrhh/config";
import { empleadoBodySchema } from "@/lib/rrhh/empleado-api-schema";

type Ctx = { params: Promise<{ slug: string }> };

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
  };
}

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "empleados", "ver");
  if (guard.error) return guard.error;
  const q = new URL(req.url).searchParams.get("q") ?? "";
  const [empleados, cfg] = await Promise.all([
    listarEmpleados(guard.empresa.id, q),
    obtenerParametros(guard.empresa.id),
  ]);
  return NextResponse.json({
    empleados,
    horarioDefault: {
      entrada: (cfg.hora_entrada_default || "07:00:00").slice(0, 5),
      salida: (cfg.hora_salida_default || "16:00:00").slice(0, 5),
    },
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "empleados", "crear");
  if (guard.error) return guard.error;

  const parsed = empleadoBodySchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;
  const tienePartes = Boolean(
    (d.primerNombre || "").trim() && (d.primerApellido || "").trim(),
  );
  if (!(d.nombre || "").trim() && !tienePartes) {
    return NextResponse.json(
      { error: "Indica nombre completo o primer nombre + primer apellido." },
      { status: 400 },
    );
  }
  if (await codigoDuplicado(guard.empresa.id, d.codigo)) {
    return NextResponse.json(
      { error: "Ya existe un empleado con ese código." },
      { status: 400 },
    );
  }
  const cfg = await obtenerParametros(guard.empresa.id);
  const he =
    normalizarHora(d.horaEntradaTeorica ?? cfg.hora_entrada_default) ??
    cfg.hora_entrada_default ??
    "07:00:00";
  const hs =
    normalizarHora(d.horaSalidaTeorica ?? cfg.hora_salida_default) ??
    cfg.hora_salida_default ??
    "16:00:00";

  try {
    const id = await crearEmpleado(
      guard.empresa.id,
      toInput(d, he, hs),
    );
    return NextResponse.json({ id, mensaje: "Empleado creado." });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Error al crear." },
      { status: 400 },
    );
  }
}
