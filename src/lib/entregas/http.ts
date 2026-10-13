import { NextResponse } from "next/server";
import { esPngValido, MAX_FIRMA_IMAGEN_BYTES } from "@/lib/firmas/imagen-firma";
import { leerBytesFirmaGuardada } from "@/lib/firmas/usuario-firmas";
import { respuestaFalloOperacion } from "@/lib/tms/validacion-fondos-gastos";
import { ErrorDominioFormulario } from "@/lib/validacion-formulario";
import type { ModuloEntrega } from "./catalogo";
import { MENSAJES_ENTREGA, obtenerEntrega, type Entrega, type FirmaEntregaInput } from "./entregas";

/**
 * Soporte HTTP común de los endpoints de entregas (PR 2). Aquí NO hay reglas de negocio: solo lectura segura del cuerpo y
 * respuestas. Las reglas viven en el servicio (`entregas.ts`); la identidad y la empresa vienen de `requireTenantEntregas`.
 */

export type FirmaLeida = { firma: FirmaEntregaInput };

/**
 * Lee la firma de un multipart: `usarFirmaGuardada=true` (copia de «Mi firma» del usuario de SESIÓN, nunca un usuario o ruta del
 * cliente) o `firmaImagen` (PNG dibujado). Con `soloDibujada` la guardada no se acepta (recepción presencial). El formato real
 * (magic bytes) y el tamaño se vuelven a validar en el servicio; aquí se corta pronto para no leer archivos enormes.
 */
export async function leerFirmaFormulario(form: FormData, usuarioIdSesion: number, soloDibujada = false): Promise<FirmaLeida> {
  if (form.get("usarFirmaGuardada") === "true") {
    if (soloDibujada) throw new ErrorDominioFormulario(MENSAJES_ENTREGA.firmaDibujadaRequerida, 400);
    const guardada = await leerBytesFirmaGuardada(usuarioIdSesion);
    if (!guardada) throw new ErrorDominioFormulario("Tu firma guardada ya no está disponible. Dibuja tu firma.", 400);
    return { firma: { origen: "GUARDADA", imagen: guardada } };
  }
  const archivo = form.get("firmaImagen");
  if (!(archivo instanceof File) || archivo.size <= 0) {
    throw new ErrorDominioFormulario(soloDibujada ? MENSAJES_ENTREGA.firmaDibujadaRequerida : "Dibuja tu firma antes de continuar.", 400);
  }
  if (archivo.size > MAX_FIRMA_IMAGEN_BYTES) throw new ErrorDominioFormulario(MENSAJES_ENTREGA.firmaInvalida, 400);
  const bytes = await archivo.arrayBuffer();
  if (!esPngValido(new Uint8Array(bytes))) throw new ErrorDominioFormulario(MENSAJES_ENTREGA.firmaInvalida, 400);
  return { firma: { origen: "DIBUJADA", imagen: { bytes, original: archivo.name || "firma.png" } } };
}

/**
 * Defensa ante un deadlock TRANSITORIO de InnoDB (`ER_LOCK_DEADLOCK`, 1213). NO es la solución del deadlock conocido: ese se
 * corrigió de raíz en el servicio común (`registrarEntrega` ya no toma bloqueos de rango sobre `documento_entregas`; ver
 * docs/FONDOS-CONTROL-ENTREGA.md). Esto solo cubre interbloqueos legítimos y ocasionales del motor: el motor revierte una de
 * las transacciones por completo (y el servicio compensa la imagen), así que repetir la llamada es seguro: emitir es
 * idempotente por clave y recibir/rechazar/anular reconocen su propia repetición. Máximo 3 intentos, con pausa aleatoria, y
 * SOLO para este error: cualquier otro (negocio, validación, infraestructura) se propaga sin reintentar.
 */
export async function conReintentoPorDeadlock<T>(operacion: () => Promise<T>, intentos = 3): Promise<T> {
  for (let intento = 1; ; intento++) {
    try {
      return await operacion();
    } catch (error) {
      const e = error as { code?: string; errno?: number } | null;
      const esDeadlock = e?.code === "ER_LOCK_DEADLOCK" || e?.errno === 1213;
      if (!esDeadlock || intento >= intentos) throw error;
      await new Promise((r) => setTimeout(r, 10 + Math.floor(Math.random() * 50)));
    }
  }
}

export function texto(form: FormData, campo: string): string | null {
  const v = form.get(campo);
  return typeof v === "string" ? v : null;
}

/** Id numérico de la ruta; inválido => null (el endpoint responde 404, igual que un id ajeno). */
export function idDeRuta(valor: string): number | null {
  const n = Number(valor);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * Carga la entrega por id acotada a la empresa de la sesión y al módulo del endpoint. Inexistente, de otra empresa o de otro módulo
 * => `null`: el llamador responde el MISMO 404 en los tres casos (no revela que exista en otra empresa).
 */
export async function cargarEntregaDeModulo(empresaId: number, entregaId: number, modulo: ModuloEntrega): Promise<Entrega | null> {
  const e = await obtenerEntrega(empresaId, entregaId);
  return e && e.modulo === modulo ? e : null;
}

export function respuestaNoEncontrada(mensaje: string = MENSAJES_ENTREGA.entregaNoEncontrada): NextResponse {
  return NextResponse.json({ error: mensaje }, { status: 404 });
}

export { respuestaFalloOperacion };
