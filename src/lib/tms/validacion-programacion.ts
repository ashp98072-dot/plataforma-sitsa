import { NextResponse } from "next/server";
import type { ZodError } from "zod";
import { cuerpoErrores, erroresDeZod, type ConfigErrores } from "@/lib/validacion-formulario";

/**
 * ERRORES DE VALIDACIÓN — Programación (crear/editar viaje). Nombres tal como los ve el usuario en plan-form.tsx. Solo traduce los
 * errores de SCHEMA; los mensajes de negocio que ya son claros («El regreso estimado debe ser posterior a la salida
 * programada.», «La tarifa seleccionada no pertenece a esa ruta…», «Un viaje tercerizado requiere…») no pasan por aquí y se
 * conservan tal cual.
 */
export const CONFIG_PROGRAMACION: ConfigErrores = {
  etiquetas: {
    fechaPlan: "Fecha",
    horaCarga: "Hora de salida",
    tipoTraslado: "Tipo de traslado",
    regresoEstimado: "Regreso estimado",
    tarifaComercial: "Monto del viaje",
    tarifaId: "Tarifa de la ruta",
    costoOperativoReferencia: "Costo operativo",
    referenciaCliente: "Referencia del cliente",
    notas: "Notas",
    codigo: "Código del viaje",
    clienteId: "Cliente",
    clienteNombre: "Cliente",
    placa: "Unidad",
    flotaVehiculoId: "Unidad",
    pilotoNombre: "Piloto",
    pilotoEmpleadoId: "Piloto",
    pilotoPersonalId: "Piloto",
    pilotoExtraEmpleadoId: "Piloto extra",
    pilotoExtraPersonalId: "Piloto extra",
    auxiliarNombre: "Auxiliar",
    auxiliarEmpleadoId: "Auxiliar",
    auxiliarNombres: "Auxiliares",
    auxiliarEmpleadoIds: "Auxiliares",
    auxiliarPersonalIds: "Auxiliares",
    tipoViaje: "Tipo de viaje",
    pilotoExternoNombre: "Piloto externo",
    auxiliaresExternos: "Auxiliares externos",
    unidadExternaPlaca: "Placa de la unidad externa",
    unidadExternaDescripcion: "Descripción de la unidad externa",
    transportistaExterno: "Transportista externo",
    costoTercerizado: "Costo del viaje tercerizado",
    tcVehiculoId: "TC",
    tcExternoPlaca: "TC",
    vehiculoSolicitadoPerfilId: "Vehículo solicitado",
    lugarCarga: "Lugar de carga",
    lugarDescarga: "Lugar de descarga",
    rutaId: "Ruta",
    rutaCodigo: "Código / Ruta",
    lugarDescargaHistorico: "Descripción distinta en el reporte",
    contactoNombreHistorico: "Contacto",
    contactoCargoHistorico: "Cargo del contacto",
    contactoTelefonoHistorico: "Teléfono del contacto",
    id: "Viaje",
    motivoCambio: "Motivo del cambio",
    estado: "Estado",
    paradas: "Paradas",
    "paradas.lugarNombre": "Lugar",
    "paradas.tipo": "Tipo de parada",
    "paradas.requiereEvidencia": "Evidencia",
    "paradas.clienteUbicacionId": "Ubicación guardada",
    "paradas.id": "Parada",
    viaticosAsignados: "Viáticos",
    "viaticosAsignados.empleadoId": "Empleado",
    "viaticosAsignados.montoAsignado": "Monto",
    cuadrilla: "Cuadrilla",
    "cuadrilla.tipo": "Tipo de integrante",
    "cuadrilla.empleadoId": "Integrante",
    "cuadrilla.nombre": "Nombre",
    "cuadrilla.identificacion": "Identificación",
    "cuadrilla.telefono": "Teléfono",
  },
  colecciones: {
    paradas: "Parada",
    auxiliarEmpleadoIds: "Auxiliar",
    auxiliarNombres: "Auxiliar",
    auxiliarPersonalIds: "Auxiliar",
    auxiliaresExternos: "Auxiliar externo",
    viaticosAsignados: "Viáticos",
    cuadrilla: "Cuadrilla",
  },
  mensajes: {
    fechaPlan: { requerido: "la fecha es obligatoria.", formato: "usa una fecha válida." },
    horaCarga: { formato: "usa una hora válida (HH:MM)." },
    regresoEstimado: { formato: "usa una fecha y hora válidas." },
    tipoViaje: { opcion: "selecciona Propio o Tercerizado." },
    "paradas.lugarNombre": { requerido: "es obligatorio." },
    "paradas.tipo": { requerido: "selecciona Carga, Descarga o Entrega.", opcion: "selecciona Carga, Descarga o Entrega." },
    auxiliarEmpleadoIds: { positivo: "empleado inválido.", invalido: "empleado inválido." },
    auxiliarPersonalIds: { positivo: "integrante inválido.", invalido: "integrante inválido." },
    auxiliarNombres: { requerido: "el nombre es obligatorio.", positivo: "el nombre es muy corto." },
    pilotoEmpleadoId: { positivo: "selecciona un piloto válido.", invalido: "selecciona un piloto válido." },
    pilotoExtraEmpleadoId: { positivo: "selecciona un piloto válido.", invalido: "selecciona un piloto válido." },
    clienteId: { positivo: "selecciona un cliente válido.", invalido: "selecciona un cliente válido." },
    rutaId: { positivo: "selecciona una ruta válida.", invalido: "selecciona una ruta válida." },
    vehiculoSolicitadoPerfilId: { positivo: "selecciona un vehículo válido.", invalido: "selecciona un vehículo válido." },
    "cuadrilla.empleadoId": { positivo: "integrante inválido.", invalido: "integrante inválido." },
    "cuadrilla.tipo": { opcion: "selecciona Interno o Externo.", requerido: "selecciona Interno o Externo.", formato: "selecciona Interno o Externo." },
    "viaticosAsignados.empleadoId": { positivo: "empleado inválido.", invalido: "empleado inválido." },
  },
  moneda: ["tarifaComercial", "costoTercerizado", "montoAsignado", "costoOperativoReferencia"],
  // Mensajes del schema que mencionan nombres técnicos o formatos internos.
  traducciones: {
    "Fecha inválida (YYYY-MM-DD).": "usa una fecha válida.",
    "No se permiten empleadoId duplicados en viaticosAsignados.": "Hay un empleado repetido en los viáticos. Deja una sola fila por persona.",
  },
};

/** 400 con `error` (compatibilidad) + `errores` por campo/fila. */
export function respuestaErroresPrograma(error: ZodError, payload: unknown): NextResponse {
  return NextResponse.json(cuerpoErrores(erroresDeZod(error, CONFIG_PROGRAMACION, payload)), { status: 400 });
}
