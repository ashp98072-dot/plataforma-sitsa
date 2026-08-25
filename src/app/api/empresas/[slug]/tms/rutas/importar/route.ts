import { NextResponse } from "next/server";
import { requireTenantModulo } from "@/lib/tenant";
import { parsearExcelRutas, type FilaRutaExcel } from "@/lib/tms/rutas-import-excel";
import {
  previsualizarImportacionRutas,
  confirmarImportacionRutas,
  type DecisionFilaRuta,
  type DecisionClienteGrupo,
} from "@/lib/tms/rutas-import";

type Ctx = { params: Promise<{ slug: string }> };

const MAX_FILAS = 2000; // muy por encima de las ~147 reales; mismo criterio que rrhh/marcajes/importar
const MAX_BYTES = 15 * 1024 * 1024; // 15 MB

/**
 * VIAT-5 (Operaciones > Rutas > Importar Excel) — un solo endpoint con
 * dos fases vía el campo `accion` del form-data, replicando exactamente
 * el patrón ya existente en rrhh/marcajes/importar:
 *   - accion=validar  -> SOLO LECTURA, no escribe nada, devuelve preview.
 *   - accion=importar -> escribe dentro de una transacción; espera además
 *     un campo `decisiones` (JSON) con las elecciones manuales por fila
 *     (cliente ambiguo/nuevo, actualizar código existente).
 * El mismo permiso que ya protege crear/editar rutas (tms, editar) — no
 * se agrega ningún permiso nuevo. empresaId SIEMPRE viene de
 * requireTenantModulo (sesión/tenant), nunca del Excel ni del cliente.
 */
export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "tms", true);
  if (guard.error) return guard.error;

  const form = await req.formData();
  const archivo = form.get("archivo");
  const accion = String(form.get("accion") ?? "validar");

  if (!(archivo instanceof File)) {
    return NextResponse.json({ error: "Selecciona un archivo Excel." }, { status: 400 });
  }
  if (accion !== "validar" && accion !== "importar") {
    return NextResponse.json({ error: "Acción de importación inválida." }, { status: 400 });
  }

  const nombreArchivo = archivo.name.toLowerCase();
  if (!nombreArchivo.endsWith(".xlsx")) {
    return NextResponse.json({ error: "El archivo debe ser Excel .xlsx." }, { status: 400 });
  }
  if (archivo.size > MAX_BYTES) {
    return NextResponse.json({ error: "El archivo supera el límite de 15 MB." }, { status: 400 });
  }

  let filasExcel: FilaRutaExcel[];
  try {
    const buffer = Buffer.from(await archivo.arrayBuffer());
    filasExcel = await parsearExcelRutas(buffer);
  } catch (err) {
    const detalle = err instanceof Error ? err.message : "No se pudo leer el Excel.";
    return NextResponse.json({ error: detalle }, { status: 400 });
  }

  if (filasExcel.length === 0) {
    return NextResponse.json({ error: 'La hoja "CODIGOS DATA" no contiene filas de datos.' }, { status: 400 });
  }
  if (filasExcel.length > MAX_FILAS) {
    return NextResponse.json(
      { error: `El archivo supera el límite de ${MAX_FILAS} filas por importación.` },
      { status: 400 },
    );
  }

  if (accion === "validar") {
    try {
      const { filas, resumen, clientesPorResolver, erroresDetalle } = await previsualizarImportacionRutas(
        guard.empresa.id,
        filasExcel,
      );
      // Las 3 colecciones SIEMPRE van en la respuesta, aunque estén vacías
      // (previsualizarImportacionRutas ya las devuelve como array, nunca
      // undefined) -- el frontend las trata como obligatorias.
      return NextResponse.json({ accion: "validar", filas, resumen, clientesPorResolver, erroresDetalle });
    } catch (e) {
      console.error("POST tms/rutas/importar validar", e);
      return NextResponse.json({ error: "No se pudo analizar el archivo." }, { status: 500 });
    }
  }

  // accion === "importar"
  let decisiones: DecisionFilaRuta[] = [];
  const decisionesRaw = form.get("decisiones");
  if (typeof decisionesRaw === "string" && decisionesRaw.trim()) {
    try {
      const parsed: unknown = JSON.parse(decisionesRaw);
      if (Array.isArray(parsed)) decisiones = parsed as DecisionFilaRuta[];
    } catch {
      return NextResponse.json({ error: "Decisiones de importación inválidas." }, { status: 400 });
    }
  }

  let decisionesCliente: DecisionClienteGrupo[] = [];
  const decisionesClienteRaw = form.get("decisionesCliente");
  if (typeof decisionesClienteRaw === "string" && decisionesClienteRaw.trim()) {
    try {
      const parsed: unknown = JSON.parse(decisionesClienteRaw);
      if (Array.isArray(parsed)) decisionesCliente = parsed as DecisionClienteGrupo[];
    } catch {
      return NextResponse.json({ error: "Decisiones de cliente inválidas." }, { status: 400 });
    }
  }

  try {
    const resultado = await confirmarImportacionRutas(
      guard.empresa.id,
      guard.session.username,
      filasExcel,
      decisiones,
      decisionesCliente,
    );
    return NextResponse.json({ accion: "importar", resultado });
  } catch (e) {
    console.error("POST tms/rutas/importar importar", e);
    return NextResponse.json({ error: "No se pudo completar la importación. No se guardó ningún cambio." }, { status: 500 });
  }
}
