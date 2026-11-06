import { NextResponse } from "next/server";
import { requireTenantContReporte } from "@/lib/tenant";
import { AccesoContable, ambitoDesdeRequest, errorAmbito } from "./ambito";
import { fechaValida } from "./reportes/calculo";
import { filtroPeriodo } from "./reportes/periodo";
import { movimientosMayorBancario } from "./bancos-mayor";

const headers = { "Cache-Control": "private, no-store" };
export async function bancosMayorHttp(req: Request, slug: string, banco: string) {
  const g = await requireTenantContReporte(slug, "contabilidad_mayor", "Sin permiso para ver el Libro Mayor.");
  if (g.error) { g.error.headers.set("Cache-Control", headers["Cache-Control"]); return g.error; }
  try {
    if (!/^[1-9]\d{0,9}$/.test(banco) || Number(banco) > 2147483647) throw new AccesoContable("Selecciona una cuenta bancaria contable.", 400);
    const sp = new URL(req.url).searchParams;
    for (const k of sp.keys()) {
      if (!["entidad", "desde", "hasta", "periodo"].includes(k) || sp.getAll(k).length !== 1) throw new AccesoContable("Parámetros inválidos.", 400);
    }
    const ambito = ambitoDesdeRequest(req, g.session);
    const periodo = filtroPeriodo(sp);
    const desde = fechaValida(sp.get("desde")), hasta = fechaValida(sp.get("hasta"));
    if ((sp.has("desde") && !desde) || (sp.has("hasta") && !hasta) || (desde && hasta && desde > hasta)) throw new AccesoContable("Rango de fechas inválido.", 400);
    const datos = await movimientosMayorBancario(g.empresa.id, ambito, Number(banco), { desde, hasta, ...periodo });
    return NextResponse.json(datos, { headers });
  } catch (e) {
    const res = errorAmbito(e);
    if (res) { res.headers.set("Cache-Control", headers["Cache-Control"]); return res; }
    return NextResponse.json({ error: "No se pudieron consultar los movimientos del Mayor." }, { status: 500, headers });
  }
}
