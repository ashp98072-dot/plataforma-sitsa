import { NextResponse } from "next/server";
import { requireRrhhRequerimientos } from "./requerimiento-acceso";
import { obtenerRequerimientoRrhh } from "./requerimientos";
import { requerimientoRrhhExcel, requerimientoRrhhPdf } from "./requerimiento-exportaciones";

const respuesta = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "private, no-store" } });

export async function requerimientoRrhhExportar(slug: string, id: string, formato: "pdf" | "excel") {
  const guard = await requireRrhhRequerimientos(slug, "ver");
  if (guard.error) { guard.error.headers.set("Cache-Control", "private, no-store"); return guard.error; }
  if (!/^[1-9]\d*$/.test(id) || Number(id) > 2147483647) return respuesta("Requerimiento no encontrado.", 404);
  try {
    const d = await obtenerRequerimientoRrhh(guard.empresa.id, Number(id));
    if (!d) return respuesta("Requerimiento no encontrado.", 404);
    const buffer = formato === "pdf" ? await requerimientoRrhhPdf(d) : await requerimientoRrhhExcel(d);
    const nombre = `requerimiento-${d.codigo}.${formato === "pdf" ? "pdf" : "xlsx"}`;
    const ascii = nombre.normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g, "-");
    return new NextResponse(new Uint8Array(buffer), { headers: {
      "Content-Type": formato === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nombre).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
      "Cache-Control": "private, no-store",
    } });
  } catch { return respuesta("No se pudo generar el documento del requerimiento.", 500); }
}
