import { NextResponse } from "next/server";
import { getColaboradorSession } from "@/lib/rrhh/colaborador-session";
import { obtenerEmpleado } from "@/lib/rrhh/empleados";
import { obtenerCentroCosto } from "@/lib/rrhh/centros-costo";

/**
 * Ficha de "solo lectura" del propio colaborador. Deliberadamente NO acepta
 * ningún id por parámetro: siempre usa el empleadoId que viene en su sesión
 * (getColaboradorSession), para que sea imposible que un colaborador pida
 * la ficha de otra persona cambiando un id en la URL.
 */
export async function GET() {
  const session = await getColaboradorSession();
  if (!session) {
    return NextResponse.json({ error: "No autenticado." }, { status: 401 });
  }

  const empleado = await obtenerEmpleado(session.empresaId, session.empleadoId);
  if (!empleado) {
    return NextResponse.json(
      { error: "No se encontró tu ficha." },
      { status: 404 },
    );
  }

  const centroCosto = empleado.centroCostoId
    ? await obtenerCentroCosto(session.empresaId, empleado.centroCostoId)
    : null;

  // Solo se exponen los campos que le sirven al colaborador ver de sí mismo.
  // Deliberadamente se excluyen sueldoBase / bonoIncentivo / bonoHerramientas
  // aquí: esos van en "Boletas de pago" (fase aparte), no en la ficha general.
  return NextResponse.json({
    codigo: empleado.codigo,
    nombre: empleado.nombre,
    puesto: empleado.puesto,
    estado: empleado.estado,
    fechaAlta: empleado.fechaAlta,
    fechaInicioLaboral: empleado.fechaInicioLaboral,
    tipoContrato: empleado.tipoContrato ?? "",
    formaPago: empleado.formaPago ?? "",
    dpi: empleado.dpi ?? "",
    nit: empleado.nit ?? "",
    igss: empleado.igss ?? "",
    telefono: empleado.telefono ?? "",
    email: empleado.email ?? "",
    direccion: empleado.direccion ?? "",
    contactoEmergencia: empleado.contactoEmergencia ?? "",
    cuentaBancaria: empleado.cuentaBancaria ?? "",
    banco: empleado.banco ?? "",
    tipoCuenta: empleado.tipoCuenta ?? "",
    supervisorNombre: empleado.supervisorNombre ?? "",
    centroCostoNombre: centroCosto?.nombre ?? "",
  });
}
