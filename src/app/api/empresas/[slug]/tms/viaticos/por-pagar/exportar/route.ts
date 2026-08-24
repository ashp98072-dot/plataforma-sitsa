import { NextResponse } from "next/server";
import { requireTenantViaticosPagar } from "@/lib/tenant";
import { listarViaticosPorPagar, type EstadoViatico } from "@/lib/tms/viaticos";
import { tablaAExcel } from "@/lib/rrhh/export-files";
import { generarArchivoBancoGenerico } from "@/lib/tms/viaticos-exportar-banco";

type Ctx = { params: Promise<{ slug: string }> };

const ESTADOS: EstadoViatico[] = ["PROGRAMADO", "AUTORIZADO", "ENTREGADO", "LIQUIDADO"];
const METODO_PAGO_LABEL: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  CHEQUE: "Cheque",
};

/**
 * VIAT-2 (puntos 3-5) — exportación de la bandeja "Viáticos por pagar".
 * `?formato=xlsx` (por defecto): Excel administrativo — reutiliza
 * tablaAExcel (src/lib/rrhh/export-files.ts), el mismo exportador genérico
 * que usan flota/reportes RRHH, sin crear uno nuevo.
 * `?formato=banco`: archivo genérico delimitado (.csv), NO el layout
 * oficial de Bi Banking — ver documentación en
 * src/lib/tms/viaticos-exportar-banco.ts.
 * `?ids=1,2,3` limita la exportación a filas seleccionadas en la UI; sin
 * `ids`, exporta según los mismos filtros que la bandeja (por defecto solo
 * AUTORIZADOS).
 * Mismo permiso que la bandeja: `viaticos_pagar:ver` — exportar es una
 * operación de lectura/reporte, no de escritura.
 */
export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantViaticosPagar(slug, "ver");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  const formato = url.searchParams.get("formato") === "banco" ? "banco" : "xlsx";
  const planIdRaw = url.searchParams.get("planId");
  const planId = planIdRaw && Number.isFinite(Number(planIdRaw)) ? Number(planIdRaw) : undefined;
  const fechaDesde = url.searchParams.get("fechaDesde") || undefined;
  const fechaHasta = url.searchParams.get("fechaHasta") || undefined;
  const empleadoNombre = url.searchParams.get("empleado") || undefined;
  const estadoRaw = url.searchParams.get("estado");
  const estado: EstadoViatico | undefined =
    estadoRaw === "TODOS"
      ? undefined
      : estadoRaw && (ESTADOS as string[]).includes(estadoRaw)
        ? (estadoRaw as EstadoViatico)
        : "AUTORIZADO";

  let items = await listarViaticosPorPagar(guard.empresa.id, {
    planId,
    fechaDesde,
    fechaHasta,
    empleadoNombre,
    estado,
  });

  const idsRaw = url.searchParams.get("ids");
  if (idsRaw) {
    const ids = new Set(
      idsRaw
        .split(",")
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n)),
    );
    if (ids.size) items = items.filter((r) => ids.has(r.id));
  }

  const fecha = new Date().toISOString().slice(0, 10);

  if (formato === "banco") {
    const contenido = generarArchivoBancoGenerico(items);
    return new NextResponse(contenido, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="viaticos-por-pagar-${fecha}.csv"`,
      },
    });
  }

  const headers = [
    "Código viaje",
    "Fecha",
    "Código empleado",
    "Nombre",
    "Rol",
    "Monto",
    "Método de pago",
    "Estado",
    "Banco",
    "Tipo cuenta",
    "Número cuenta",
  ];
  const rows = items.map((r) => [
    r.planCodigo,
    r.fechaPlan,
    r.personalCodigo ?? "",
    r.personalNombre,
    r.rol,
    r.montoAsignado.toFixed(2),
    r.metodoPago ? METODO_PAGO_LABEL[r.metodoPago] ?? r.metodoPago : "",
    r.estado,
    r.banco ?? "",
    r.tipoCuenta ?? "",
    r.cuentaBancaria ?? "",
  ]);
  const buf = await tablaAExcel({
    sheetName: "Viaticos por pagar",
    headers,
    rows,
  });
  return new NextResponse(new Uint8Array(buf), {
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="viaticos-por-pagar-${fecha}.xlsx"`,
    },
  });
}
