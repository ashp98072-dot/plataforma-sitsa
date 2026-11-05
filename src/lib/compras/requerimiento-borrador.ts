import type { SnapshotBorrador } from "@/lib/borradores/controlador";
import { CLAVE_ENVIO_REGEX } from "@/lib/idempotencia/clave-envio";

/**
 * BORR-1d — ADAPTADOR JSON EXPLÍCITO del borrador local de «Nuevo requerimiento de compra».
 *
 * Solo datos editables que el usuario escribió/eligió (ids, textos, fechas, importes tal como los espera el formulario). NO se
 * guarda: archivos ni documentos pendientes, catálogos completos, datos derivados del proveedor (NIT, banco, cuenta…), estado
 * visual de validación, mensajes de error, credenciales ni datos de otros usuarios/empresas. El payload se construye campo por
 * campo (lista blanca): un campo nuevo del formulario NO entra al borrador salvo que se agregue aquí a propósito.
 */
export const ESQUEMA_REQUERIMIENTO_BORRADOR = 1;
export const MAX_LINEAS_BORRADOR = 500;

export type LineaBorrador = {
  /** Identificador ESTABLE de la línea en el formulario (key de React): conserva orden e identidad entre recargas. */
  clave: string;
  vehiculo_id: number | null;
  unidad_descripcion: string | null;
  fecha: string;
  serie_factura: string | null;
  numero_factura: string | null;
  proveedor_id: number;
  repuesto_descripcion: string;
  metodo_pago: string;
  condicion_pago: "Contado" | "Crédito";
  total: string;
  observaciones: string | null;
};

export type EstadoFormularioRequerimiento = {
  fecha: string;
  entidad: number;
  requirente: number;
  encargado: number;
  observaciones: string;
  lineas: LineaBorrador[];
};

export type PayloadRequerimientoBorrador = {
  cabecera: { fechaRequerimiento: string; entidadRequirenteId: number; requirenteUsuarioId: number; encargadoComprasUsuarioId: number; observaciones: string };
  lineas: {
    clave: string; vehiculoId: number | null; unidadDescripcion: string | null; fecha: string; serieFactura: string | null; numeroFactura: string | null;
    proveedorId: number; repuestoDescripcion: string; metodoPago: string; condicionPago: "Contado" | "Crédito"; total: string; observaciones: string | null;
  }[];
};

/** Línea del formulario (puede traer `key`, `documentosPendientes`, `id`…): se proyecta SOLO a los campos permitidos. */
export type LineaFormularioOrigen = {
  key: string; vehiculo_id: number | null; unidad_descripcion: string | null; fecha: string; serie_factura: string | null; numero_factura: string | null;
  proveedor_id: number; repuesto_descripcion: string; metodo_pago: string; condicion_pago: "Contado" | "Crédito"; total: string; observaciones: string | null;
};

export function aEstado(f: { fecha: string; entidad: number; requirente: number; encargado: number; observaciones: string; lineas: LineaFormularioOrigen[] }): EstadoFormularioRequerimiento {
  return {
    fecha: f.fecha, entidad: f.entidad, requirente: f.requirente, encargado: f.encargado, observaciones: f.observaciones,
    lineas: f.lineas.map((l) => ({
      clave: l.key, vehiculo_id: l.vehiculo_id, unidad_descripcion: l.unidad_descripcion, fecha: l.fecha, serie_factura: l.serie_factura, numero_factura: l.numero_factura,
      proveedor_id: l.proveedor_id, repuesto_descripcion: l.repuesto_descripcion, metodo_pago: l.metodo_pago, condicion_pago: l.condicion_pago, total: l.total, observaciones: l.observaciones,
    })),
  };
}

export function construirPayload(e: EstadoFormularioRequerimiento): PayloadRequerimientoBorrador {
  return {
    cabecera: { fechaRequerimiento: e.fecha, entidadRequirenteId: e.entidad, requirenteUsuarioId: e.requirente, encargadoComprasUsuarioId: e.encargado, observaciones: e.observaciones },
    lineas: e.lineas.slice(0, MAX_LINEAS_BORRADOR).map((l) => ({
      clave: l.clave, vehiculoId: l.vehiculo_id, unidadDescripcion: l.unidad_descripcion, fecha: l.fecha, serieFactura: l.serie_factura, numeroFactura: l.numero_factura,
      proveedorId: l.proveedor_id, repuestoDescripcion: l.repuesto_descripcion, metodoPago: l.metodo_pago, condicionPago: l.condicion_pago, total: l.total, observaciones: l.observaciones,
    })),
  };
}

const esObjeto = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const esId = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
const textoONulo = (v: unknown): string | null | undefined => (v === null ? null : typeof v === "string" ? v : undefined);

export type ResultadoRestauracion = { ok: true; estado: EstadoFormularioRequerimiento } | { ok: false; motivo: string };

/**
 * Restaura un payload guardado a los valores EDITABLES del formulario. Valida estructura y tipos (un borrador alterado o dañado
 * no se aplica a medias: o se restaura completo o no se restaura). NO valida reglas de negocio: eso lo hace el servidor al enviar.
 */
export function restaurarPayload(bruto: unknown): ResultadoRestauracion {
  if (!esObjeto(bruto) || !esObjeto(bruto.cabecera) || !Array.isArray(bruto.lineas)) return { ok: false, motivo: "estructura" };
  const c = bruto.cabecera;
  if (typeof c.fechaRequerimiento !== "string" || !esId(c.entidadRequirenteId) || !esId(c.requirenteUsuarioId) || !esId(c.encargadoComprasUsuarioId) || typeof c.observaciones !== "string") return { ok: false, motivo: "cabecera" };
  if (bruto.lineas.length < 1 || bruto.lineas.length > MAX_LINEAS_BORRADOR) return { ok: false, motivo: "lineas" };
  const vistas = new Set<string>();
  const lineas: LineaBorrador[] = [];
  for (const crudo of bruto.lineas) {
    if (!esObjeto(crudo)) return { ok: false, motivo: "linea" };
    const unidad = textoONulo(crudo.unidadDescripcion), serie = textoONulo(crudo.serieFactura), numero = textoONulo(crudo.numeroFactura), obs = textoONulo(crudo.observaciones);
    const total = typeof crudo.total === "number" && Number.isFinite(crudo.total) ? String(crudo.total) : crudo.total;
    if (typeof crudo.clave !== "string" || crudo.clave === "" || vistas.has(crudo.clave)) return { ok: false, motivo: "clave_linea" };
    if (unidad === undefined || serie === undefined || numero === undefined || obs === undefined) return { ok: false, motivo: "linea" };
    if (!(crudo.vehiculoId === null || esId(crudo.vehiculoId)) || !esId(crudo.proveedorId)) return { ok: false, motivo: "linea" };
    if (typeof crudo.fecha !== "string" || typeof crudo.repuestoDescripcion !== "string" || typeof crudo.metodoPago !== "string" || typeof total !== "string") return { ok: false, motivo: "linea" };
    if (crudo.condicionPago !== "Contado" && crudo.condicionPago !== "Crédito") return { ok: false, motivo: "linea" };
    vistas.add(crudo.clave);
    lineas.push({
      clave: crudo.clave, vehiculo_id: crudo.vehiculoId === 0 ? null : crudo.vehiculoId, unidad_descripcion: unidad, fecha: crudo.fecha, serie_factura: serie, numero_factura: numero,
      proveedor_id: crudo.proveedorId, repuesto_descripcion: crudo.repuestoDescripcion, metodo_pago: crudo.metodoPago, condicion_pago: crudo.condicionPago, total, observaciones: obs,
    });
  }
  return { ok: true, estado: { fecha: c.fechaRequerimiento, entidad: c.entidadRequirenteId, requirente: c.requirenteUsuarioId, encargado: c.encargadoComprasUsuarioId, observaciones: c.observaciones, lineas } };
}

type Opcion = { id: number };
type CatalogosMinimos = { entidades: Opcion[]; usuarios: Opcion[]; requirentesOperaciones: Opcion[]; proveedores: Opcion[]; vehiculos: Opcion[] };

/**
 * Revalida lo RECUPERADO contra los catálogos vigentes del usuario/empresa actual. Un id que ya no está (proveedor inactivo o de
 * otra empresa, vehículo dado de baja, usuario sin acceso…) se conserva en pantalla —no se pierde lo que escribió— pero se avisa
 * y el envío queda bloqueado hasta que lo vuelva a elegir; nunca se presenta como vigente ni se crea nada automáticamente.
 */
export function avisosDeRecuperacion(e: EstadoFormularioRequerimiento, cat: CatalogosMinimos | null): string[] {
  if (!cat) return [];
  const avisos: string[] = [];
  if (e.entidad && !cat.entidades.some((x) => x.id === e.entidad)) avisos.push("La empresa requirente guardada ya no está disponible: vuelve a elegirla.");
  if (e.requirente && !cat.requirentesOperaciones.some((x) => x.id === e.requirente)) avisos.push("La persona requirente guardada ya no está disponible: vuelve a elegirla.");
  if (e.encargado && !cat.usuarios.some((x) => x.id === e.encargado)) avisos.push("El encargado de compras guardado ya no está disponible: vuelve a elegirlo o déjalo sin asignar.");
  e.lineas.forEach((l, i) => {
    if (l.proveedor_id && !cat.proveedores.some((x) => x.id === l.proveedor_id)) avisos.push(`Línea ${i + 1}: el proveedor guardado ya no está disponible. Elige otro; no se crea ninguno automáticamente.`);
    if (l.vehiculo_id && !cat.vehiculos.some((x) => x.id === l.vehiculo_id)) avisos.push(`Línea ${i + 1}: la unidad guardada ya no está disponible. Elige otra o descríbela manualmente.`);
  });
  return avisos;
}

/** ¿El formulario difiere del estado inicial vacío? (decide si recuperar pide confirmar el reemplazo). */
export function hayContenidoEscrito(e: EstadoFormularioRequerimiento, fechaHoy: string): boolean {
  if (e.fecha !== fechaHoy || e.entidad !== 0 || e.requirente !== 0 || e.encargado !== 0 || e.observaciones !== "") return true;
  return e.lineas.length !== 1 || e.lineas.some((l) =>
    l.vehiculo_id !== null || l.unidad_descripcion !== null || l.fecha !== fechaHoy || l.serie_factura !== null || l.numero_factura !== null || l.proveedor_id !== 0 ||
    l.repuesto_descripcion !== "" || l.total !== "" || l.observaciones !== null || l.metodo_pago !== "Transferencia" || l.condicion_pago !== "Contado");
}

/**
 * ¿Debe el formulario bloquear el envío por el estado del borrador? `null` = puede enviar. Las fases sin autoguardado
 * (desactivado por el usuario, sin contexto) NO bloquean: no hay borrador que proteger y el formulario se comporta como antes.
 */
export function motivoBloqueoPorBorrador(s: SnapshotBorrador | null): string | null {
  if (!s) return null;
  switch (s.fase) {
    case "sin_contexto": case "desactivado": case "cerrado": case "activo": return null;
    case "consultando": return "Buscando un borrador guardado… espera un momento antes de enviar.";
    case "decision_pendiente": case "en_espera":
      return s.recuperacion?.situacion === "envio_incierto"
        ? "Reconciliación pendiente: un envío anterior no tiene resultado confirmado. No se enviará otro documento hasta verificarlo."
        : "Hay un borrador guardado sin resolver. Recupéralo o descártalo antes de enviar.";
    case "conflicto": return "Otra pestaña modificó el borrador. Resuelve el conflicto antes de enviar.";
    case "suspendido": return "Se está cerrando la sesión. No se puede enviar.";
    case "bloqueado":
      if (s.bloqueo === "envio_en_curso") return null; // lo gestiona el flujo de envío (reintento con la misma clave)
      if (s.bloqueo === "enviado") return "Este requerimiento ya se envió oficialmente.";
      if (s.bloqueo === "sesion_anterior") return "La sesión anterior finalizó. Recarga la página para continuar.";
      return "El borrador guardado en este equipo no se puede usar. Descártalo para continuar.";
  }
}

export function claveDeBorrador(s: SnapshotBorrador | null): string | null {
  return s && s.claveEnvio && CLAVE_ENVIO_REGEX.test(s.claveEnvio) ? s.claveEnvio : null;
}
