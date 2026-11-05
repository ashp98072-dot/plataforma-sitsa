import type { InfoRecuperacion, MotivoConflicto, SituacionRecuperacion, SnapshotBorrador } from "./controlador";
import type { TipoBorrador } from "./tipos";

/**
 * BORR-1c — textos (es-GT) del autoguardado: funciones PURAS y probadas. La interfaz solo habla de «este equipo»: nunca afirma que
 * algo esté en el servidor, y «Guardado» solo aparece cuando la transacción de IndexedDB se confirmó.
 */
export const NOMBRES_FORMULARIO: Record<TipoBorrador, string> = {
  solicitud_fondo: "Solicitud de fondo",
  gasto_operativo: "Gasto operativo",
  requerimiento_compra: "Requerimiento de compra",
};

export type Tono = "neutro" | "info" | "ok" | "aviso" | "error";

const MOTIVOS_ERROR: Record<string, string> = {
  cuota_excedida: "no hay espacio suficiente en este equipo",
  no_disponible: "el almacenamiento de este navegador no está disponible",
  escritura_fallida: "el navegador no pudo escribir los cambios",
  lectura_fallida: "el navegador no pudo leer el almacenamiento",
  payload_invalido: "el contenido contiene datos que no se pueden guardar",
  payload_demasiado_grande: "el borrador es demasiado grande",
};

export function formatearHora(epochMs: number): string {
  return new Intl.DateTimeFormat("es-GT", { hour: "2-digit", minute: "2-digit" }).format(new Date(epochMs));
}

export function formatearFechaHora(epochMs: number): string {
  return new Intl.DateTimeFormat("es-GT", { dateStyle: "long", timeStyle: "short" }).format(new Date(epochMs));
}

/** «hace 3 días», «hace 5 minutos»… Sin fecha futura: valores negativos se tratan como «hace instantes». */
export function describirAntiguedad(desdeMs: number, ahoraMs: number): string {
  const s = Math.max(0, Math.round((ahoraMs - desdeMs) / 1000));
  if (s < 60) return "hace instantes";
  const m = Math.floor(s / 60);
  if (m < 60) return m === 1 ? "hace 1 minuto" : `hace ${m} minutos`;
  const h = Math.floor(m / 60);
  if (h < 24) return h === 1 ? "hace 1 hora" : `hace ${h} horas`;
  const d = Math.floor(h / 24);
  return d === 1 ? "hace 1 día" : `hace ${d} días`;
}

export type EstadoVisible = { texto: string; detalle?: string; tono: Tono };

/** Texto del indicador de estado. */
export function describirEstadoAutoguardado(s: SnapshotBorrador): EstadoVisible {
  const otra = s.otraPestana ? " Otra pestaña actualizó este borrador." : "";
  switch (s.fase) {
    case "sin_contexto": return { texto: "Autoguardado no disponible", detalle: "No hay una sesión válida para guardar borradores en este equipo.", tono: "neutro" };
    case "desactivado": return { texto: "Sin autoguardado en este equipo", detalle: "Este equipo está configurado para no guardar borradores.", tono: "aviso" };
    case "consultando": return { texto: "Buscando un borrador guardado…", tono: "info" };
    case "decision_pendiente": return { texto: "Hay un borrador guardado sin recuperar", detalle: "El autoguardado está en pausa hasta que decidas qué hacer con él.", tono: "aviso" };
    case "en_espera": return { texto: "Autoguardado en pausa", detalle: "Hay un borrador guardado sin recuperar; no se sobrescribirá.", tono: "aviso" };
    case "conflicto": return { texto: "Conflicto con otra pestaña", detalle: "Elige qué versión conservar antes de seguir guardando.", tono: "error" };
    case "suspendido": return { texto: "Autoguardado detenido", detalle: s.suspension === "otra_pestana_salio" ? "Se está cerrando la sesión en otra pestaña." : "Se está cerrando la sesión.", tono: "aviso" };
    case "bloqueado":
      if (s.bloqueo === "envio_en_curso") return { texto: "Envío en curso", detalle: "La edición está bloqueada hasta conocer el resultado del envío.", tono: "info" };
      if (s.bloqueo === "enviado") return { texto: "Documento enviado", detalle: "Este borrador ya se envió oficialmente.", tono: "ok" };
      if (s.bloqueo === "sesion_anterior") return { texto: "Sesión anterior finalizada", detalle: "Los borradores de este equipo se eliminaron al cerrar sesión. Tus cambios siguen en pantalla, pero esta pestaña ya no los guarda: recarga la página para continuar.", tono: "error" };
      if (s.bloqueo === "incompatible") return { texto: "Borrador de una versión más nueva", detalle: "No se puede modificar desde esta versión de la aplicación.", tono: "error" };
      return { texto: "Borrador dañado", detalle: "El borrador guardado en este equipo no se puede usar.", tono: "error" };
    case "cerrado": return { texto: "Autoguardado cerrado", tono: "neutro" };
    case "activo": break;
  }
  switch (s.guardado.estado) {
    case "pendiente": return { texto: "Cambios pendientes", detalle: `Aún no se han guardado en este equipo.${otra}`, tono: "aviso" };
    case "guardando": return { texto: "Guardando…", detalle: `Todavía no confirmado por el navegador.${otra}`, tono: "info" };
    case "guardado": return { texto: s.guardadoEn ? `Guardado en este equipo a las ${formatearHora(s.guardadoEn)}` : "Guardado en este equipo", detalle: otra.trim() || undefined, tono: otra ? "aviso" : "ok" };
    case "error_almacenamiento": return { texto: "Error al guardar en este equipo", detalle: `${s.guardado.motivoError ? `Causa: ${MOTIVOS_ERROR[s.guardado.motivoError] ?? s.guardado.motivoError}. ` : ""}Tus cambios siguen en pantalla, pero no están a salvo.`, tono: "error" };
    case "incompatible": return { texto: "Borrador incompatible", tono: "error" };
    case "inicial": return { texto: "Autoguardado activo", detalle: otra.trim() || undefined, tono: otra ? "aviso" : "neutro" };
  }
}

export type TextoSituacion = { titulo: string; detalle: string; tono: Tono };

/** Advertencia que acompaña a un borrador pendiente de decisión. */
export function describirSituacion(s: SituacionRecuperacion): TextoSituacion {
  switch (s) {
    case "disponible": return { titulo: "Encontramos un borrador sin terminar", detalle: "Se guardó automáticamente en este equipo.", tono: "info" };
    case "expirado": return { titulo: "Este borrador superó el tiempo de conservación", detalle: "Se conserva por más de 14 días y pronto podría eliminarse. Puedes recuperarlo ahora o descartarlo.", tono: "aviso" };
    case "esquema_anterior": return { titulo: "Este borrador es de una versión anterior del formulario", detalle: "Se adaptará al recuperarlo. Revisa los datos antes de enviar.", tono: "aviso" };
    case "incompatible": return { titulo: "Este borrador no es compatible con esta versión", detalle: "Se creó con una versión más nueva de la aplicación y no se puede recuperar aquí. No se modificará; solo puedes dejarlo como está o descartarlo.", tono: "error" };
    case "corrupto": return { titulo: "Este borrador está dañado", detalle: "No se puede interpretar como un borrador válido y no se recuperará. Puedes descartarlo.", tono: "error" };
    case "enviado": return { titulo: "Este borrador ya se envió oficialmente", detalle: "No se restaura para no duplicar el documento. Puedes descartarlo.", tono: "info" };
    case "envio_incierto": return { titulo: "Hubo un intento de envío sin resultado confirmado", detalle: "Para evitar un documento duplicado no se puede recuperar ni descartar este borrador hasta verificar si el envío llegó a completarse.", tono: "error" };
  }
}

export function describirConflicto(motivo: MotivoConflicto): { titulo: string; detalle: string } {
  switch (motivo) {
    case "descartado_en_otra_pestana": return { titulo: "El borrador se descartó en otra pestaña", detalle: "Tus cambios en esta pestaña siguen en pantalla. Puedes guardarlos de nuevo como un borrador nuevo." };
    case "ya_no_existe": return { titulo: "El borrador ya no existe en este equipo", detalle: "Se eliminó mientras trabajabas aquí. Tus cambios siguen en pantalla; puedes guardarlos de nuevo." };
    case "otra_pestana":
    case "revision_obsoleta":
      return { titulo: "Otra pestaña modificó este borrador", detalle: "Para no perder el trabajo de ninguna de las dos, no se combinan los cambios automáticamente. Elige qué versión conservar." };
  }
}

export function describirRecuperacion(r: InfoRecuperacion, ahoraMs: number): string[] {
  const lineas = [`Formulario: ${NOMBRES_FORMULARIO[r.tipo]}`];
  if (r.actualizadoEn !== null) lineas.push(`Último guardado: ${formatearFechaHora(r.actualizadoEn)} (${describirAntiguedad(r.actualizadoEn, ahoraMs)})`);
  else lineas.push("Fecha del último guardado: no disponible");
  return lineas;
}
