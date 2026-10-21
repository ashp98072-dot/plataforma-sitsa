import { NextResponse } from "next/server";
import { requireTenantFlotaCombustible } from "@/lib/tenant";
import { ErrorDominioFormulario } from "@/lib/validacion-formulario";
import { ESTADOS_C2C, type EstadoC2c } from "./combustible-c2c-shared";
import { accionManual, candidatosParaFila, listarConciliacion, recalcularImportacion, valesSinReporte, type AccionManual } from "./combustible-c2c";

const NO_STORE = { "Cache-Control": "private, no-store" };
const idValido = (v: unknown) => Number.isSafeInteger(Number(v)) && Number(v) > 0;
const fecha = (v: string | null) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);
const entero = (v: string | null) => (v && idValido(v) ? Number(v) : undefined);

async function protegido<T>(fn: () => Promise<T>) {
  try { return await fn(); }
  catch (e) {
    if (e instanceof ErrorDominioFormulario) return NextResponse.json({ error: e.message }, { status: e.status });
    console.error("[combustible-c2c]", e);
    return NextResponse.json({ error: "No se pudo procesar la conciliación." }, { status: 500 });
  }
}

/** Lectura: permiso `flota_combustible:ver`. */
export async function listarC2cHttp(req: Request, slug: string, importacionId: string) {
  const g = await requireTenantFlotaCombustible(slug, "ver"); if (g.error) return g.error;
  if (!idValido(importacionId)) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  const sp = new URL(req.url).searchParams, estado = sp.get("estado");
  if (estado && !(ESTADOS_C2C as readonly string[]).includes(estado)) return NextResponse.json({ error: "Estado inválido." }, { status: 400 });
  return protegido(async () => {
    const data = await listarConciliacion(g.empresa.id, Number(importacionId), { estado: (estado as EstadoC2c) || undefined, q: sp.get("q") ?? undefined, hoja: sp.get("hoja") ?? undefined, page: entero(sp.get("page")), pageSize: entero(sp.get("pageSize")) });
    return NextResponse.json(data ?? { error: "Importación no encontrada." }, { status: data ? 200 : 404, headers: NO_STORE });
  });
}

/** Escritura: permiso `flota_combustible_conciliar` (vía `conciliar`). */
export async function recalcularC2cHttp(slug: string, importacionId: string) {
  const g = await requireTenantFlotaCombustible(slug, "conciliar"); if (g.error) return g.error;
  if (!idValido(importacionId)) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  return protegido(async () => NextResponse.json(await recalcularImportacion(g.empresa.id, Number(importacionId), { id: g.session.id, username: g.session.username }), { headers: NO_STORE }));
}

export async function candidatosC2cHttp(req: Request, slug: string, filaId: string) {
  const g = await requireTenantFlotaCombustible(slug, "ver"); if (g.error) return g.error;
  if (!idValido(filaId)) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  return protegido(async () => {
    const data = await candidatosParaFila(g.empresa.id, Number(filaId), new URL(req.url).searchParams.get("q") ?? "");
    return NextResponse.json(data ? { candidatos: data } : { error: "Fila no encontrada." }, { status: data ? 200 : 404, headers: NO_STORE });
  });
}

export async function accionC2cHttp(req: Request, slug: string, filaId: string) {
  const g = await requireTenantFlotaCombustible(slug, "conciliar"); if (g.error) return g.error;
  if (!idValido(filaId)) return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  return protegido(async () => {
    const b = (await req.json().catch(() => null)) as { accion?: string; cargaId?: unknown; motivo?: unknown; esperado?: { estado?: EstadoC2c | null; cargaVinculadaId?: number | null } } | null;
    let accion: AccionManual;
    if (b?.accion === "confirmar") accion = { accion: "confirmar", cargaId: Number(b.cargaId) };
    else if (b?.accion === "quitar") accion = { accion: "quitar" };
    else if (b?.accion === "descartar") accion = { accion: "descartar", motivo: String(b.motivo ?? "") };
    else if (b?.accion === "restablecer") accion = { accion: "restablecer" };
    else throw new ErrorDominioFormulario("Acción inválida.");
    const esperado = b?.esperado && "estado" in b.esperado ? { estado: b.esperado.estado ?? null, cargaVinculadaId: b.esperado.cargaVinculadaId ?? null } : undefined;
    return NextResponse.json(await accionManual(g.empresa.id, Number(filaId), { id: g.session.id, username: g.session.username }, accion, esperado), { headers: NO_STORE });
  });
}

export async function valesSinReporteHttp(req: Request, slug: string) {
  const g = await requireTenantFlotaCombustible(slug, "ver"); if (g.error) return g.error;
  const sp = new URL(req.url).searchParams, estado = sp.get("estado");
  if (estado && !["PENDIENTE", "APROBADO", "RECHAZADO"].includes(estado)) return NextResponse.json({ error: "Estado inválido." }, { status: 400 });
  return protegido(async () => NextResponse.json(await valesSinReporte(g.empresa.id, {
    proveedorId: entero(sp.get("proveedorId")), desde: fecha(sp.get("desde")), hasta: fecha(sp.get("hasta")), estado: (estado as "PENDIENTE" | "APROBADO" | "RECHAZADO") || undefined,
    placa: sp.get("placa") ?? undefined, page: entero(sp.get("page")), pageSize: entero(sp.get("pageSize")),
  }), { headers: NO_STORE }));
}
