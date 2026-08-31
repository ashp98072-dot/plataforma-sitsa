import { NextResponse } from "next/server";
import { requireClientesOFacturacion } from "@/lib/clientes/acceso";
import { exportarClientesExcel, exportarClientesPdf } from "@/lib/clientes/export";
import { listarClientes } from "@/lib/clientes/repository";

type Ctx = { params: Promise<{ slug: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireClientesOFacturacion(slug, "clientes");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const formato = url.searchParams.get("formato") === "pdf" ? "pdf" : "xlsx";
  const estado = url.searchParams.get("estado") ?? "Activo";
  const q = url.searchParams.get("q") ?? undefined;
  const clientes = await listarClientes(guard.empresa.id, { q, estado });
  const buffer = formato === "pdf"
    ? await exportarClientesPdf(clientes, guard.empresa.nombre)
    : await exportarClientesExcel(clientes, guard.empresa.nombre);
  const fecha = new Date().toISOString().slice(0, 10);
  const filename = `clientes-${slug}-${fecha}.${formato}`;

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": formato === "pdf"
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
