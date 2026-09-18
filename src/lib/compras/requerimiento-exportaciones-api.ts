import { NextResponse } from "next/server";
import { loadRuntimeEnv } from "@/lib/load-env";
import { requireComprasRequerimientos } from "./acceso";
import { obtenerRequerimiento } from "./requerimientos";
import { firmaHistoricaCompraReporte } from "./requerimiento-firma-reporte";
import { requerimientoCompraExcel, requerimientoCompraPdf } from "./requerimiento-exportaciones";

const respuesta = (error: string, status: number) => NextResponse.json({ error }, { status, headers: { "Cache-Control": "private, no-store" } });
export async function requerimientoExportar(slug: string, id: string, formato: "pdf" | "excel") {
  const guard = await requireComprasRequerimientos(slug, "ver");
  if (guard.error) { guard.error.headers.set("Cache-Control", "private, no-store"); return guard.error; }
  if (!/^[1-9]\d*$/.test(id) || Number(id) > 2147483647) return respuesta("Requerimiento no encontrado.", 404);
  try {
    loadRuntimeEnv();
    const d = await obtenerRequerimiento(guard.empresa.id, Number(id));
    if (!d) return respuesta("Requerimiento no encontrado.", 404);
    const firma = formato === "pdf" && d.estado === "Autorizada" ? await firmaHistoricaCompraReporte(guard.empresa.id, d.id) : null;
    // No emitir constancia autorizada sin firma histórica ni sustituirla por Mi firma.
    if (formato === "pdf" && d.estado === "Autorizada" && !firma?.imagen) return respuesta("No está disponible la firma histórica de autorización.", 409);
    const buffer = formato === "pdf" ? await requerimientoCompraPdf(d, guard.empresa.nombre, firma) : await requerimientoCompraExcel(d, guard.empresa.nombre);
    const nombre = `Requerimiento-Compra-${d.codigo}.${formato === "pdf" ? "pdf" : "xlsx"}`;
    const ascii = nombre.normalize("NFKD").replace(/[^a-zA-Z0-9._-]/g, "-");
    return new NextResponse(new Uint8Array(buffer), { headers: {
      "Content-Type": formato === "pdf" ? "application/pdf" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(nombre).replace(/['()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
      "Cache-Control": "private, no-store",
    } });
  } catch { return respuesta("No se pudo generar el documento del requerimiento.", 500); }
}
