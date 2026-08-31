import { NextResponse } from "next/server";
import { requireTenantViaticosPagar } from "@/lib/tenant";
import { listarViaticosPorPagar, type EstadoViatico } from "@/lib/tms/viaticos";
import { tablaAExcel } from "@/lib/rrhh/export-files";
import {
  codificarCp1252,
  generarArchivoBiBanking,
  TIPO_OPERACION_DEFAULT,
  validarParaBiBanking,
} from "@/lib/tms/viaticos-exportar-banco";

type Ctx = { params: Promise<{ slug: string }> };

const ESTADOS: EstadoViatico[] = ["PROGRAMADO", "AUTORIZADO", "ENTREGADO", "LIQUIDADO"];
const METODO_PAGO_LABEL: Record<string, string> = {
  EFECTIVO: "Efectivo",
  TRANSFERENCIA: "Transferencia",
  CHEQUE: "Cheque",
};

/**
 * VIAT-2 / VIAT-2b — exportación de la bandeja "Viáticos por pagar".
 *
 * `?formato=xlsx` (por defecto, SIN CAMBIOS desde VIAT-2): Excel
 * administrativo completo — reutiliza tablaAExcel (src/lib/rrhh/export-
 * files.ts). Incluye código empleado/banco/tipo cuenta/estado para control
 * interno; no valida nada, exporta lo que la bandeja esté mostrando.
 *
 * `?formato=banco`: archivo Bi Banking (layout real de la empresa, ver
 * src/lib/tms/viaticos-exportar-banco.ts) — 5 columnas sin encabezado,
 * codificado Windows-1252. Requiere `ids` explícito (no exporta "todo lo
 * visible" sin selección) y SOLO genera el archivo si todos los
 * seleccionados pasan validación (AUTORIZADO, con cuenta bancaria, monto >
 * 0) — si alguno falla, responde 400 con el detalle de cada problema en
 * vez de generar un archivo parcial. Descargar este archivo NO cambia
 * ningún estado: es de solo lectura, igual que el Excel — el paso
 * AUTORIZADO -> ENTREGADO solo ocurre cuando el facturador confirma la
 * entrega desde "Registrar entrega/pago" (POST .../viaticos/[id]/entrega).
 * `?tipo=` opcional (default "1") — columna 1, ver documentación en
 * viaticos-exportar-banco.ts sobre por qué es configurable y no un valor
 * bancario confirmado.
 *
 * Mismo permiso en ambos formatos: `viaticos_pagar:ver` — exportar es una
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

  const idsRaw = url.searchParams.get("ids");
  const idsSeleccionados = idsRaw
    ? new Set(
        idsRaw
          .split(",")
          .map((s) => Number(s.trim()))
          .filter((n) => Number.isFinite(n)),
      )
    : new Set<number>();

  const fecha = new Date().toISOString().slice(0, 10);

  if (formato === "banco") {
    if (!idsSeleccionados.size) {
      return NextResponse.json(
        { error: "Selecciona al menos un viático para generar el archivo bancario." },
        { status: 400 },
      );
    }
    // Sin filtro de estado aquí a propósito: si el usuario seleccionó un
    // id que ya no está AUTORIZADO, queremos que aparezca en `problemas`
    // (validarParaBiBanking), no que desaparezca silenciosamente del
    // resultado por el filtro de estado.
    const candidatos = await listarViaticosPorPagar(guard.empresa.id, {
      planId,
      fechaDesde,
      fechaHasta,
      empleadoNombre,
    });
    const items = candidatos.filter((r) => idsSeleccionados.has(r.id));

    const encontrados = new Set(items.map((r) => r.id));
    const faltantes = [...idsSeleccionados].filter((id) => !encontrados.has(id));

    const validacion = validarParaBiBanking(items);
    if (!validacion.ok || faltantes.length) {
      return NextResponse.json(
        {
          error: "Hay viáticos seleccionados que no se pueden incluir en el archivo bancario.",
          problemas: [
            ...(validacion.ok ? [] : validacion.problemas),
            ...faltantes.map((id) => ({
              id,
              planCodigo: "",
              personalNombre: "",
              motivo: "No encontrado con los filtros actuales.",
            })),
          ],
        },
        { status: 400 },
      );
    }

    const tipoOperacion = url.searchParams.get("tipo")?.trim() || TIPO_OPERACION_DEFAULT;
    const contenido = generarArchivoBiBanking(items, { tipoOperacion });
    return new NextResponse(new Uint8Array(codificarCp1252(contenido)), {
      headers: {
        "Content-Type": "text/csv; charset=windows-1252",
        "Content-Disposition": `attachment; filename="viaticos-bibanking-${fecha}.csv"`,
      },
    });
  }

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
  if (idsSeleccionados.size) items = items.filter((r) => idsSeleccionados.has(r.id));

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
    // VIATICOS-PAGO-SNAPSHOT-1 — columnas *Mostrar (derivarCuentaMostrable):
    // cuenta viva mientras AUTORIZADO (o CHEQUE/EFECTIVO en cualquier
    // estado), snapshot congelado para ENTREGADO/LIQUIDADO por
    // TRANSFERENCIA. Histórico anterior a esta funcionalidad -> celdas
    // vacías (nunca la cuenta viva como sustituto).
    r.bancoMostrar ?? "",
    r.tipoCuentaMostrar ?? "",
    r.cuentaBancariaMostrar ?? "",
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
