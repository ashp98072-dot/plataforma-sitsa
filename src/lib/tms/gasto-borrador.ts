import type { SnapshotBorrador } from "@/lib/borradores/controlador";
import { destinoPagoEmpleado } from "./destino-pago-empleado";

/**
 * BORR-1f — ADAPTADOR JSON explícito del borrador local de «Nuevo gasto» (TMS → Gastos operativos).
 *
 * Lista blanca de lo que el usuario realmente edita en la CREACIÓN: cabecera (= «Línea 1»), líneas adicionales (orden y valores) y los
 * datos administrativos. Importes y cantidades se guardan COMO TEXTO, tal cual están en el formulario (sin pérdida de precisión).
 * NUNCA se guarda el comprobante (File), ni catálogos, permisos, sesión o tokens. El «destino de pago» (`numeroCuentaPago`) que el
 * formulario autocompleta desde RRHH según empleado y método NO se guarda: solo se guarda si el usuario lo sobrescribió
 * (`numeroCuentaOverride`); si no, se vuelve a sugerir desde el catálogo vigente al recuperar. Nombre y cargo del encabezado son de
 * solo lectura (derivados del catálogo) y tampoco se guardan.
 */
export const ESQUEMA_GASTO_BORRADOR = 1;
// SIN tope de líneas propio: el backend de Gastos no limita `lineas` (route.ts: `z.array(lineaSchema).min(1).optional()`) y el formulario permite
// agregar las que se quiera. Un tope aquí truncaría en silencio. El único límite es el técnico del almacén (tamaño del payload):
// si se excede, el núcleo responde `payload_demasiado_grande` y el indicador muestra «Error al guardar» (nunca «Guardado»).

export type FormGasto = {
  fechaSolicitud: string; fechaViaje: string; empleadoId: number; vehiculoId: number; clienteId: number; planId: number;
  categoria: string; descripcion: string; cantidad: string; monto: string; metodoPago: string; numeroCuentaPago: string;
  tieneFactura: boolean; observaciones: string; entidadRequirenteId: number; requirenteUsuarioId: number; requirenteNombre: string; solicitanteUsuarioId: number;
};
export type LineaGastoFormulario = {
  categoria: string; descripcion: string; cantidad: string; monto: string; metodoPago: string; numeroCuentaPago: string; fechaViaje: string;
  empleadoId: number; vehiculoId: number; clienteId: number; planId: number;
};
export type EstadoGastoForm = { form: FormGasto; lineasAdicionales: LineaGastoFormulario[] };
type EmpleadoPago = { id: number; cuentaBancaria?: string | null; telefono?: string | null };

type LineaPayload = {
  categoria: string; descripcion: string; cantidad: string; monto: string; metodoPago: string; numeroCuentaOverride: string | null; fechaViaje: string;
  empleadoId: number; vehiculoId: number; clienteId: number; planId: number;
};
export type PayloadGastoBorrador = {
  cabecera: LineaPayload & { fechaSolicitud: string; tieneFactura: boolean; observaciones: string; entidadRequirenteId: number; requirenteUsuarioId: number; solicitanteUsuarioId: number };
  lineasAdicionales: LineaPayload[];
};

const derivada = (l: { metodoPago: string; empleadoId: number }, empleados: EmpleadoPago[]) =>
  destinoPagoEmpleado(l.metodoPago, empleados.find((e) => e.id === l.empleadoId)).trim();
const override = (l: { metodoPago: string; empleadoId: number; numeroCuentaPago: string }, empleados: EmpleadoPago[]) =>
  l.numeroCuentaPago.trim() === derivada(l, empleados) ? null : l.numeroCuentaPago;

const lineaPayload = (l: LineaGastoFormulario, empleados: EmpleadoPago[]): LineaPayload => ({
  categoria: l.categoria, descripcion: l.descripcion, cantidad: l.cantidad, monto: l.monto, metodoPago: l.metodoPago, numeroCuentaOverride: override(l, empleados),
  fechaViaje: l.fechaViaje, empleadoId: l.empleadoId, vehiculoId: l.vehiculoId, clienteId: l.clienteId, planId: l.planId,
});

export function construirPayloadGasto(e: EstadoGastoForm, empleados: EmpleadoPago[]): PayloadGastoBorrador {
  const f = e.form;
  return {
    cabecera: {
      ...lineaPayload(f, empleados), fechaSolicitud: f.fechaSolicitud, tieneFactura: f.tieneFactura, observaciones: f.observaciones,
      entidadRequirenteId: f.entidadRequirenteId, requirenteUsuarioId: f.requirenteUsuarioId, solicitanteUsuarioId: f.solicitanteUsuarioId,
    },
    lineasAdicionales: e.lineasAdicionales.map((l) => lineaPayload(l, empleados)),
  };
}

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const esTexto = (v: unknown): v is string => typeof v === "string";
const esId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

export type LineaRestaurada = Omit<LineaGastoFormulario, "numeroCuentaPago"> & { numeroCuentaOverride: string | null };
export type EstadoGastoRestaurado = {
  cabecera: LineaRestaurada & { fechaSolicitud: string; tieneFactura: boolean; observaciones: string; entidadRequirenteId: number; requirenteUsuarioId: number; solicitanteUsuarioId: number };
  lineasAdicionales: LineaRestaurada[];
};
export type ResultadoRestauracionGasto = { ok: true; estado: EstadoGastoRestaurado } | { ok: false; motivo: string };

function lineaValida(l: unknown): LineaRestaurada | null {
  if (!esObjeto(l)) return null;
  const textos = [l.categoria, l.descripcion, l.cantidad, l.monto, l.metodoPago, l.fechaViaje];
  const ids = [l.empleadoId, l.vehiculoId, l.clienteId, l.planId];
  if (!textos.every(esTexto) || !ids.every(esId) || !(l.numeroCuentaOverride === null || esTexto(l.numeroCuentaOverride))) return null;
  return {
    categoria: l.categoria as string, descripcion: l.descripcion as string, cantidad: l.cantidad as string, monto: l.monto as string, metodoPago: l.metodoPago as string,
    fechaViaje: l.fechaViaje as string, empleadoId: l.empleadoId as number, vehiculoId: l.vehiculoId as number, clienteId: l.clienteId as number, planId: l.planId as number,
    numeroCuentaOverride: l.numeroCuentaOverride as string | null,
  };
}

/** Valida estructura y tipos del payload guardado; no aplica nada a medias. No valida reglas de negocio (lo hace el servidor al enviar). */
export function restaurarPayloadGasto(bruto: unknown): ResultadoRestauracionGasto {
  if (!esObjeto(bruto) || !esObjeto(bruto.cabecera) || !Array.isArray(bruto.lineasAdicionales)) return { ok: false, motivo: "estructura" };
  const c = bruto.cabecera;
  const base = lineaValida(c);
  if (!base || !esTexto(c.fechaSolicitud) || typeof c.tieneFactura !== "boolean" || !esTexto(c.observaciones) || !esId(c.entidadRequirenteId) || !esId(c.requirenteUsuarioId) || !esId(c.solicitanteUsuarioId)) return { ok: false, motivo: "cabecera" };
  const lineas: LineaRestaurada[] = [];
  for (const l of bruto.lineasAdicionales) {
    const v = lineaValida(l);
    if (!v) return { ok: false, motivo: "linea" };
    lineas.push(v);
  }
  return {
    ok: true,
    estado: {
      cabecera: { ...base, fechaSolicitud: c.fechaSolicitud, tieneFactura: c.tieneFactura, observaciones: c.observaciones, entidadRequirenteId: c.entidadRequirenteId, requirenteUsuarioId: c.requirenteUsuarioId, solicitanteUsuarioId: c.solicitanteUsuarioId },
      lineasAdicionales: lineas,
    },
  };
}

const aLinea = ({ numeroCuentaOverride, ...l }: LineaRestaurada, empleados: EmpleadoPago[]): LineaGastoFormulario =>
  ({ ...l, numeroCuentaPago: numeroCuentaOverride ?? derivada(l, empleados) });

/** Estado recuperado → valores del formulario; el destino de pago se sugiere desde el catálogo vigente salvo que el usuario lo hubiera sobrescrito. */
export function aFormularioGasto(r: EstadoGastoRestaurado, empleados: EmpleadoPago[]): EstadoGastoForm {
  const { fechaSolicitud, tieneFactura, observaciones, entidadRequirenteId, requirenteUsuarioId, solicitanteUsuarioId, ...linea1 } = r.cabecera;
  return {
    form: { ...aLinea(linea1, empleados), fechaSolicitud, tieneFactura, observaciones, entidadRequirenteId, requirenteUsuarioId, requirenteNombre: "", solicitanteUsuarioId },
    lineasAdicionales: r.lineasAdicionales.map((l) => aLinea(l, empleados)),
  };
}

type Ids = { id: number }[];
export type CatalogosGastoMin = {
  entidadesRequirentes: Ids; usuariosOperaciones: Ids; solicitantes: Ids; empleados: Ids; vehiculos: Ids; clientes: Ids; planes: Ids; metodosPago: string[]; categorias: string[];
};
const falta = (lista: Ids, id: number) => id !== 0 && !lista.some((x) => x.id === id);

/** Revalida lo recuperado contra los catálogos vigentes: avisa lo que ya no existe (no se crea nada y el envío espera). */
export function avisosDeRecuperacionGasto(e: EstadoGastoForm, cat: CatalogosGastoMin | null): string[] {
  if (!cat) return [];
  const a: string[] = [];
  const f = e.form;
  if (falta(cat.entidadesRequirentes, f.entidadRequirenteId)) a.push("La empresa requirente guardada ya no está disponible: vuelve a elegirla.");
  if (falta(cat.usuariosOperaciones, f.requirenteUsuarioId)) a.push("El requirente guardado ya no está disponible: vuelve a elegirlo.");
  if (falta(cat.solicitantes, f.solicitanteUsuarioId)) a.push("El solicitante guardado ya no está disponible: vuelve a elegirlo.");
  [f, ...e.lineasAdicionales].forEach((l, i) => {
    const n = `Línea ${i + 1}`;
    if (l.categoria && !cat.categorias.includes(l.categoria)) a.push(`${n}: la categoría guardada ya no está disponible.`);
    if (l.metodoPago && !cat.metodosPago.includes(l.metodoPago)) a.push(`${n}: el método de pago guardado ya no está disponible.`);
    if (falta(cat.empleados, l.empleadoId)) a.push(`${n}: el empleado guardado ya no está disponible. Elige otro.`);
    if (falta(cat.vehiculos, l.vehiculoId)) a.push(`${n}: la unidad guardada ya no está disponible. Elige otra.`);
    if (falta(cat.clientes, l.clienteId)) a.push(`${n}: el cliente guardado ya no está disponible. Elige otro.`);
    if (falta(cat.planes, l.planId)) a.push(`${n}: el viaje/plan guardado ya no está disponible. Elige otro.`);
  });
  return a;
}

/** ¿El formulario difiere del estado inicial? (decide si recuperar pide confirmar el reemplazo). */
export function hayContenidoGasto(e: EstadoGastoForm, vacio: FormGasto, hayComprobante: boolean): boolean {
  if (hayComprobante || e.lineasAdicionales.length > 0) return true;
  return (Object.keys(vacio) as (keyof FormGasto)[]).some((k) => e.form[k] !== vacio[k]);
}

/** ¿Debe esperar el envío por el estado del borrador? `null` = puede enviar (sin autoguardado o activo). */
export function motivoBloqueoGasto(s: SnapshotBorrador | null): string | null {
  if (!s) return null;
  switch (s.fase) {
    case "sin_contexto": case "desactivado": case "cerrado": case "activo": return null;
    case "consultando": return "Buscando un borrador guardado… espera un momento antes de enviar.";
    case "decision_pendiente": case "en_espera":
      return s.recuperacion?.situacion === "envio_incierto"
        ? "Reconciliación pendiente: un envío anterior no tiene resultado confirmado. No se registrará otro gasto hasta verificarlo."
        : "Hay un borrador guardado sin resolver. Recupéralo o descártalo antes de enviar.";
    case "conflicto": return "Otra pestaña modificó el borrador. Resuelve el conflicto antes de enviar.";
    case "suspendido": return "Se está cerrando la sesión. No se puede enviar.";
    case "bloqueado":
      if (s.bloqueo === "envio_en_curso") return null; // lo gestiona el flujo de envío (reintento con la misma clave)
      if (s.bloqueo === "enviado") return null; // creado: lo gestiona la página (subida pendiente del comprobante)
      if (s.bloqueo === "sesion_anterior") return "La sesión anterior finalizó. Recarga la página para continuar.";
      return "El borrador guardado en este equipo no se puede usar. Descártalo para continuar.";
  }
}
