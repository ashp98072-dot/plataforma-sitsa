import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { requireTenantContReporte } from "@/lib/tenant";
import { AccesoContable, ambitoDesdeRequest, errorAmbito } from "@/lib/contabilidad/ambito";
import { fechaValida } from "./calculo";
import { balanceComprobacion, libroDiario, libroMayor } from "./reportes";
import {filtroPeriodo} from './periodo';

const NO_STORE = { "Cache-Control": "private, no-store" };
export type TipoReporte = "diario" | "mayor" | "balance";
const FILA = { diario: "contabilidad_diario", mayor: "contabilidad_mayor", balance: "contabilidad_balance" } as const;
const MENSAJE = {
  diario: "Sin permiso para ver el Libro Diario.", mayor: "Sin permiso para ver el Libro Mayor.", balance: "Sin permiso para ver el Balance de comprobación.",
} as const;

function fechas(sp: URLSearchParams) {
  const crudo = { desde: sp.get("desde"), hasta: sp.get("hasta") };
  const desde = fechaValida(crudo.desde), hasta = fechaValida(crudo.hasta);
  if ((crudo.desde && !desde) || (crudo.hasta && !hasta)) throw new AccesoContable("Fecha inválida (usa AAAA-MM-DD).", 400);
  if (desde && hasta && desde > hasta) throw new AccesoContable("La fecha «desde» no puede ser posterior a «hasta».", 400);
  return { desde, hasta };
}
const entero = (v: string | null) => (v && /^[1-9]\d{0,9}$/.test(v) && Number(v) <= 2147483647 ? Number(v) : undefined);

/** GET de un reporte. La empresa sale de la sesión (guard); la entidad es obligatoria y se valida contra esa empresa dentro de la consulta. */
export async function reporteHttp(req: Request, slug: string, tipo: TipoReporte) {
  const g = await requireTenantContReporte(slug, FILA[tipo], MENSAJE[tipo]);
  if (g.error) return g.error;
  try {
    const entidadId = ambitoDesdeRequest(req, g.session).entidadId;
    const sp = new URL(req.url).searchParams;
    const f = {...fechas(sp),...filtroPeriodo(sp)};
    let datos;
    if (tipo === "diario") datos = await libroDiario(g.empresa.id, entidadId, { ...f, numero: sp.get("numero") ?? undefined, page: entero(sp.get("page")) });
    else if (tipo === "mayor") {
      const cuentaId = entero(sp.get("cuentaId"));
      if (!cuentaId) throw new AccesoContable("Selecciona una cuenta.", 400);
      datos = await libroMayor(g.empresa.id, entidadId, cuentaId, f);
    } else datos = await balanceComprobacion(g.empresa.id, entidadId, { ...f, incluirSinMovimiento: sp.get("sinMovimiento") === "1" });

    if (sp.get("formato") === "xlsx") {
      // ExcelJS se carga SOLO al exportar (no entra en la carga inicial de la pantalla ni de los reportes en pantalla).
      const { exportarXlsx } = await import("./exportar");
      const buffer = await exportarXlsx(tipo, datos);
      return new NextResponse(new Uint8Array(buffer), {
        headers: {
          "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "Content-Disposition": `attachment; filename="contabilidad-${tipo}.xlsx"`, ...NO_STORE,
        },
      });
    }
    return NextResponse.json(datos, { headers: NO_STORE });
  } catch (e) {
    const acceso = errorAmbito(e);
    if (acceso) return acceso;
    console.error("[contabilidad-reportes]", { tipo, code: (e as { code?: string })?.code ?? "desconocido" });
    return NextResponse.json({ error: "No se pudo generar el reporte." }, { status: 500 });
  }
}

/** Entidades de la empresa (y, con ?entidad=, sus cuentas) para los selectores de Reportes. Basta CUALQUIERA de los tres permisos de reporte. */
export async function opcionesHttp(req: Request, slug: string) {
  let g = await requireTenantContReporte(slug, "contabilidad_diario");
  if (g.error) g = await requireTenantContReporte(slug, "contabilidad_mayor");
  if (g.error) g = await requireTenantContReporte(slug, "contabilidad_balance", "Sin permiso para los reportes contables.");
  if (g.error) return g.error;
  try {
    const entidades = await query<RowDataPacket[]>("SELECT id, codigo, nombre, activa FROM cont_entidades WHERE empresa_id = ? ORDER BY codigo", [g.empresa.id]);
    const e = new URL(req.url).searchParams.has('entidad') ? ambitoDesdeRequest(req,g.session).entidadId : undefined;
    const cuentas = e ? await query<RowDataPacket[]>(
      "SELECT id, codigo, nombre FROM cont_cuentas WHERE empresa_id = ? AND entidad_id = ? ORDER BY codigo", [g.empresa.id, e]) : [];
    let periodos:RowDataPacket[]=[];let calendarioDisponible=true;
    if(e){
      if(!entidades.some(en=>Number(en.id)===e))throw new AccesoContable('Libro no disponible.',404);
      try{periodos=await query<RowDataPacket[]>(
        "SELECT p.id,p.codigo,p.estado,p.version,p.revision_cierre,DATE_FORMAT(p.fecha_inicio,'%Y-%m-%d') fechaInicio,DATE_FORMAT(p.fecha_fin,'%Y-%m-%d') fechaFin,e.codigo ejercicio FROM cont_periodos p JOIN cont_ejercicios e ON e.empresa_id=p.empresa_id AND e.entidad_id=p.entidad_id AND e.id=p.ejercicio_id WHERE p.empresa_id=? AND p.entidad_id=? ORDER BY p.fecha_inicio,p.id",[g.empresa.id,e]);
      }catch(err){if(!['ER_NO_SUCH_TABLE','ER_BAD_FIELD_ERROR'].includes(String((err as {code?:string}).code)))throw err;calendarioDisponible=false;}
    }
    return NextResponse.json({ entidades, cuentas,periodos,calendarioDisponible }, { headers: NO_STORE });
  } catch (err) {
    const acceso = errorAmbito(err);
    if (acceso) return acceso;
    return NextResponse.json({ error: "No se pudieron cargar las opciones." }, { status: 500 });
  }
}
