import type { SnapshotBorrador } from "@/lib/borradores/controlador";
import { destinoPagoEmpleado } from "./destino-pago-empleado";

/**
 * BORR-1e — ADAPTADOR JSON explícito del borrador local de «Nueva solicitud de fondo» (TMS → Solicitudes de fondo).
 *
 * Lista blanca de los campos que el usuario realmente edita. Los importes y cantidades se guardan COMO TEXTO, exactamente como el
 * formulario los tiene (sin Number()/parseFloat: sin errores de precisión). NO se guarda: archivos, catálogos, errores, permisos,
 * sesión, tokens ni datos de otra empresa. La «cuenta» de pago que el formulario autocompleta desde RRHH NO se guarda: solo se
 * guarda si el usuario la sobrescribió (`cuentaOverride`); si no, se vuelve a sugerir desde el catálogo vigente al recuperar.
 */
export const ESQUEMA_FONDO_BORRADOR = 1;
/**
 * Máximo de líneas que ACEPTA el backend al crear (y al editar) una solicitud: `lineas: z.array(lineaSchema).min(1).max(40)` en
 * `POST /tms/fondos` y en `PATCH /tms/fondos/[id]`. Es un límite de ENVÍO, no de borrador: el adaptador NO trunca nunca. Un borrador
 * heredado con más líneas se conserva íntegro (el único límite de almacenamiento es el técnico del núcleo: si se excede, el indicador
 * muestra «Error al guardar», jamás «Guardado») y solo se bloquea su envío hasta reducirlo.
 */
export const MAX_LINEAS_FONDO = 40;

/** ¿Se excede el máximo de líneas que acepta el servidor? (bloquea el envío; nunca elimina nada). */
export const excedeMaxLineasFondo = (cantidad: number) => cantidad > MAX_LINEAS_FONDO;
export const mensajeExcesoLineasFondo = (cantidad: number) =>
  `Esta solicitud tiene ${cantidad} líneas y el máximo permitido es ${MAX_LINEAS_FONDO}. No se ha eliminado ninguna: quita ${cantidad - MAX_LINEAS_FONDO} para poder enviarla.`;

export type LineaFondoForm = {
  categoria: string; descripcion: string; cantidad: string; monto: string;
  fechaViaje: string; empleadoId: string; vehiculoId: string; clienteId: string; planId: string;
  empleadoNombre: string; cuenta: string; cargo: string; metodoPago: string;
};
export type EstadoFondoForm = {
  entidadRequirenteId: string; requirenteUsuarioId: string; solicitanteUsuarioId: string; fechaRequerimiento: string; observaciones: string;
  lineas: LineaFondoForm[];
};
type EmpleadoPago = { id: number; cuentaBancaria?: string | null; telefono?: string | null };

export type PayloadFondoBorrador = {
  cabecera: { entidadRequirenteId: string; requirenteUsuarioId: string; solicitanteUsuarioId: string; fechaRequerimiento: string; observaciones: string };
  lineas: {
    categoria: string; descripcion: string; cantidad: string; monto: string; fechaViaje: string; empleadoId: string; vehiculoId: string; clienteId: string; planId: string;
    empleadoNombre: string; cargo: string; metodoPago: string; cuentaOverride: string | null;
  }[];
};

const derivada = (l: { metodoPago: string; empleadoId: string }, empleados: EmpleadoPago[]) =>
  destinoPagoEmpleado(l.metodoPago, empleados.find((e) => String(e.id) === l.empleadoId)).trim();

export function construirPayloadFondo(e: EstadoFondoForm, empleados: EmpleadoPago[]): PayloadFondoBorrador {
  return {
    cabecera: { entidadRequirenteId: e.entidadRequirenteId, requirenteUsuarioId: e.requirenteUsuarioId, solicitanteUsuarioId: e.solicitanteUsuarioId, fechaRequerimiento: e.fechaRequerimiento, observaciones: e.observaciones },
    lineas: e.lineas.map((l) => ({
      categoria: l.categoria, descripcion: l.descripcion, cantidad: l.cantidad, monto: l.monto, fechaViaje: l.fechaViaje, empleadoId: l.empleadoId, vehiculoId: l.vehiculoId,
      clienteId: l.clienteId, planId: l.planId, empleadoNombre: l.empleadoNombre, cargo: l.cargo, metodoPago: l.metodoPago,
      cuentaOverride: l.cuenta.trim() === derivada(l, empleados) ? null : l.cuenta,
    })),
  };
}

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const esTexto = (v: unknown): v is string => typeof v === "string";
const esIdTexto = (v: unknown): v is string => typeof v === "string" && /^\d{0,10}$/.test(v);

export type LineaRestaurada = Omit<LineaFondoForm, "cuenta"> & { cuentaOverride: string | null };
export type EstadoRestaurado = Omit<EstadoFondoForm, "lineas"> & { lineas: LineaRestaurada[] };
export type ResultadoRestauracionFondo = { ok: true; estado: EstadoRestaurado } | { ok: false; motivo: string };

/** Valida estructura y tipos del payload guardado; no aplica nada a medias. No valida reglas de negocio (lo hace el servidor al enviar). */
export function restaurarPayloadFondo(bruto: unknown): ResultadoRestauracionFondo {
  if (!esObjeto(bruto) || !esObjeto(bruto.cabecera) || !Array.isArray(bruto.lineas)) return { ok: false, motivo: "estructura" };
  const c = bruto.cabecera;
  if (!esIdTexto(c.entidadRequirenteId) || !esIdTexto(c.requirenteUsuarioId) || !esIdTexto(c.solicitanteUsuarioId) || !esTexto(c.fechaRequerimiento) || !esTexto(c.observaciones)) return { ok: false, motivo: "cabecera" };
  if (bruto.lineas.length < 1) return { ok: false, motivo: "lineas" }; // sin tope: un borrador con más de 40 líneas se recupera íntegro
  const lineas: LineaRestaurada[] = [];
  for (const l of bruto.lineas) {
    if (!esObjeto(l)) return { ok: false, motivo: "linea" };
    const textos = [l.categoria, l.descripcion, l.cantidad, l.monto, l.fechaViaje, l.empleadoNombre, l.cargo, l.metodoPago];
    const ids = [l.empleadoId, l.vehiculoId, l.clienteId, l.planId];
    if (!textos.every(esTexto) || !ids.every(esIdTexto) || !(l.cuentaOverride === null || esTexto(l.cuentaOverride))) return { ok: false, motivo: "linea" };
    lineas.push({
      categoria: l.categoria as string, descripcion: l.descripcion as string, cantidad: l.cantidad as string, monto: l.monto as string, fechaViaje: l.fechaViaje as string,
      empleadoId: l.empleadoId as string, vehiculoId: l.vehiculoId as string, clienteId: l.clienteId as string, planId: l.planId as string,
      empleadoNombre: l.empleadoNombre as string, cargo: l.cargo as string, metodoPago: l.metodoPago as string, cuentaOverride: l.cuentaOverride as string | null,
    });
  }
  return { ok: true, estado: { entidadRequirenteId: c.entidadRequirenteId, requirenteUsuarioId: c.requirenteUsuarioId, solicitanteUsuarioId: c.solicitanteUsuarioId, fechaRequerimiento: c.fechaRequerimiento, observaciones: c.observaciones, lineas } };
}

/** Estado recuperado → valores del formulario; la cuenta se sugiere desde el catálogo vigente salvo que el usuario la hubiera sobrescrito. */
export function aFormularioFondo(r: EstadoRestaurado, empleados: EmpleadoPago[]): EstadoFondoForm {
  return {
    ...r,
    lineas: r.lineas.map(({ cuentaOverride, ...l }) => ({ ...l, cuenta: cuentaOverride ?? derivada(l, empleados) })),
  };
}

type Ids = { id: number }[];
export type CatalogosFondoMin = {
  entidadesRequirentes: Ids; usuariosOperaciones: Ids; solicitantes: Ids; empleados: Ids; vehiculos: Ids; clientes: Ids; planes: Ids; metodosPago: string[]; categorias: string[];
};
const falta = (lista: Ids, id: string) => id !== "" && !lista.some((x) => String(x.id) === id);

/** Revalida lo recuperado contra los catálogos vigentes: avisa lo que ya no existe (no se crea nada y el envío espera a que se vuelva a elegir). */
export function avisosDeRecuperacionFondo(
  e: { entidadRequirenteId: string; requirenteUsuarioId: string; solicitanteUsuarioId: string; lineas: Pick<LineaFondoForm, "categoria" | "metodoPago" | "empleadoId" | "vehiculoId" | "clienteId" | "planId">[] },
  cat: CatalogosFondoMin | null,
): string[] {
  if (!cat) return [];
  const a: string[] = [];
  if (falta(cat.entidadesRequirentes, e.entidadRequirenteId)) a.push("La empresa requirente guardada ya no está disponible: vuelve a elegirla.");
  if (falta(cat.usuariosOperaciones, e.requirenteUsuarioId)) a.push("El requirente guardado ya no está disponible: vuelve a elegirlo.");
  if (falta(cat.solicitantes, e.solicitanteUsuarioId)) a.push("El solicitante guardado ya no está disponible: vuelve a elegirlo.");
  e.lineas.forEach((l, i) => {
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

export function hayContenidoFondo(e: EstadoFondoForm, fechaPorDefecto: string): boolean {
  if (e.entidadRequirenteId || e.requirenteUsuarioId || e.solicitanteUsuarioId || e.observaciones || e.fechaRequerimiento !== fechaPorDefecto) return true;
  return e.lineas.length !== 1 || e.lineas.some((l) => Object.entries(l).some(([k, v]) => v !== (k === "cantidad" ? "1" : "")));
}

/** ¿Debe esperar el envío por el estado del borrador? `null` = puede enviar (sin autoguardado o activo). */
export function motivoBloqueoFondo(s: SnapshotBorrador | null): string | null {
  if (!s) return null;
  switch (s.fase) {
    case "sin_contexto": case "desactivado": case "cerrado": case "activo": return null;
    case "consultando": return "Buscando un borrador guardado… espera un momento antes de enviar.";
    case "decision_pendiente": case "en_espera":
      return s.recuperacion?.situacion === "envio_incierto"
        ? "Reconciliación pendiente: un envío anterior no tiene resultado confirmado. No se enviará otra solicitud hasta verificarlo."
        : "Hay un borrador guardado sin resolver. Recupéralo o descártalo antes de enviar.";
    case "conflicto": return "Otra pestaña modificó el borrador. Resuelve el conflicto antes de enviar.";
    case "suspendido": return "Se está cerrando la sesión. No se puede enviar.";
    case "bloqueado":
      if (s.bloqueo === "envio_en_curso") return null; // lo gestiona el flujo de envío (reintento con la misma clave)
      if (s.bloqueo === "enviado") return "Esta solicitud ya se envió oficialmente.";
      if (s.bloqueo === "sesion_anterior") return "La sesión anterior finalizó. Recarga la página para continuar.";
      return "El borrador guardado en este equipo no se puede usar. Descártalo para continuar.";
  }
}
