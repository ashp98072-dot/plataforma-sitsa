import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { requireTenantCalendario } from "@/lib/tenant";
import { ambitoDesdeRequest, errorAmbito } from "./ambito";
import { listarEntidades } from "./entidades";
import { crearEjercicioConPeriodos, ErrorCalendario, listarEjercicios, listarPeriodos } from "./calendario";
import { clasificarErrorCalendario } from "./calendario-errores";

const headers = { "Cache-Control": "private, no-store" };
const json = (data: unknown, status = 200) => NextResponse.json(data, { status, headers });
function error(e: unknown) {
  if (e instanceof ZodError) return json({ error: e.issues[0]?.message ?? "Calendario inválido." }, 400);
  if (e instanceof ErrorCalendario) return json({ error: e.message }, e.status);
  const acceso = errorAmbito(e);
  if (acceso) { acceso.headers.set("Cache-Control", "private, no-store"); return acceso; }
  const { tipo, code, errno } = clasificarErrorCalendario(e);
  if (tipo === "unique") return json({ error: "El código ya existe en este libro o ejercicio.", codigo: "CALENDARIO_UNIQUE" }, 409);
  if (tipo === "deadlock" || tipo === "timeout") return json({ error: "Hay otra operación en curso. Consulta el calendario antes de reintentar.", codigo: tipo === "deadlock" ? "CALENDARIO_DEADLOCK" : "CALENDARIO_TIMEOUT" }, 409);
  // ER_CHECKREAD y errores internos siguen siendo fallos, no conflictos funcionales.
  const referencia = randomUUID();
  const codes = new Set(["ER_CHECKREAD", "ER_INTERNAL_ERROR", "ER_GET_ERRNO", "HA_ERR_RECORD_CHANGED", "ER_NO_REFERENCED_ROW_2"]);
  console.error("calendario_error_interno", { referencia, tipo, code: code && codes.has(code) ? code : "NO_CLASIFICADO",
    errno: Number.isInteger(errno) && errno! >= 0 && errno! <= 65535 ? errno : undefined });
  const response = json({ error: "No se pudo completar la operación. Consulta el calendario antes de reintentar.", referencia }, 500);
  response.headers.set("X-Correlation-ID", referencia);
  return response;
}
export async function ejerciciosGet(req: Request, slug: string) {
  const g = await requireTenantCalendario(slug, "ver");
  if (g.error) return g.error;
  try { return json({ ejercicios: await listarEjercicios(g.empresa.id, ambitoDesdeRequest(req, g.session).entidadId) }); }
  catch (e) { return error(e); }
}
export async function ejerciciosPost(req: Request, slug: string) {
  const g = await requireTenantCalendario(slug, "crear");
  if (g.error) return g.error;
  try {
    const a = ambitoDesdeRequest(req, g.session);
    const body = await req.json().catch(() => null);
    return json(await crearEjercicioConPeriodos(g.empresa.id, g.session.username, a, body), 201);
  } catch (e) { return error(e); }
}
export async function periodosGet(req: Request, slug: string, ejercicioId: string) {
  const g = await requireTenantCalendario(slug, "ver");
  if (g.error) return g.error;
  try {
    if (!/^[1-9]\d{0,9}$/.test(ejercicioId) || Number(ejercicioId) > 2147483647) return json({ error: "Ejercicio inválido." }, 400);
    return json({ periodos: await listarPeriodos(g.empresa.id, ambitoDesdeRequest(req, g.session).entidadId, Number(ejercicioId)) });
  } catch (e) { return error(e); }
}
/** Reutiliza el catálogo de entidades; no exige permisos de captura de asientos. */
export async function calendarioOpcionesGet(slug: string) {
  const g = await requireTenantCalendario(slug, "ver");
  if (g.error) return g.error;
  try { return json({ entidades: await listarEntidades(g.empresa.id, true) }); }
  catch (e) { return error(e); }
}
