import { NextResponse } from "next/server";
import { requireTenantRrhh } from "@/lib/tenant";
import {
  listarDocumentos,
  registrarDocumento,
  TIPOS_DOCUMENTO,
} from "@/lib/rrhh/documentos";
import { obtenerEmpleado } from "@/lib/rrhh/empleados";
import { borrarUpload, guardarUpload, UploadValidationError } from "@/lib/uploads";

type Ctx = { params: Promise<{ slug: string; id: string }> };

export async function GET(_req: Request, ctx: Ctx) {
  const { slug, id: idRaw } = await ctx.params;
  const guard = await requireTenantRrhh(slug, "empleados", "ver");
  if (guard.error) return guard.error;

  const id = Number(idRaw);
  if (!id) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  try {
    const emp = await obtenerEmpleado(guard.empresa.id, id);
    if (!emp) {
      return NextResponse.json({ error: "Empleado no encontrado." }, { status: 404 });
    }
    const documentos = await listarDocumentos(guard.empresa.id, id);
    return NextResponse.json({ documentos, empleado: emp });
  } catch (err) {
    console.error("GET documentos", err);
    return NextResponse.json(
      { error: "Error al listar. ¿Importaste migrate-2026-08-rrhh-archivos.sql?" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug, id: idRaw } = await ctx.params;
  // Subir anexo: basta con crear o editar empleados
  let guard = await requireTenantRrhh(slug, "empleados", "editar");
  if (guard.error) {
    guard = await requireTenantRrhh(slug, "empleados", "crear");
  }
  if (guard.error) return guard.error;

  const id = Number(idRaw);
  if (!id) {
    return NextResponse.json({ error: "ID inválido." }, { status: 400 });
  }

  const empresaId = guard.empresa.id;
  const inicio = Date.now();

  try {
    const emp = await obtenerEmpleado(empresaId, id);
    if (!emp) {
      return NextResponse.json({ error: "Empleado no encontrado." }, { status: 404 });
    }

    // RRHH-EXPEDIENTES-UPLOAD-STABILITY (sección 2 del ticket): req.formData()
    // se separa del resto del flujo. Si el cuerpo llega incompleto/truncado
    // (archivo grande, conexión interrumpida, proxy que cortó el request
    // antes de que Next.js viera el body completo), lanza un error técnico
    // de bajo nivel ("Failed to parse body as FormData.") que NUNCA debe
    // llegar tal cual a RRHH — se registra SOLO en el log del servidor y se
    // responde un mensaje funcional. No se afirma "archivo demasiado
    // grande": el servidor no puede saberlo con certeza si un proxy
    // intermedio (nginx/Passenger de Hostinger) ya truncó el request antes
    // de llegar aquí.
    let form: FormData;
    try {
      form = await req.formData();
    } catch (err) {
      console.error("POST documentos — fallo al parsear multipart", {
        empresaId,
        empleadoId: id,
        etapa: "parse_formdata",
        duracionMs: Date.now() - inicio,
        error: err instanceof Error ? err.message : String(err),
      });
      return NextResponse.json(
        {
          error:
            "No se pudo recibir el archivo completo. Puede ser demasiado grande o la conexión se interrumpió. Intenta nuevamente con un archivo más pequeño.",
        },
        { status: 400 },
      );
    }

    const file = form.get("file") as File | null;
    const tipoRaw = String(form.get("tipo") ?? "Otro");
    if (!file || typeof (file as File).arrayBuffer !== "function") {
      return NextResponse.json({ error: "Archivo requerido." }, { status: 400 });
    }

    const tipo = (TIPOS_DOCUMENTO as readonly string[]).includes(tipoRaw)
      ? tipoRaw
      : "Otro";

    // RRHH-EXPEDIENTES-UPLOAD-STABILITY (sección 9 del ticket) — cleanup
    // best-effort: si guardarUpload() ya escribió el archivo en disco pero
    // registrarDocumento() (INSERT) falla después, el archivo NO debe
    // quedar huérfano — se borra con borrarUpload() (ya existente) y se
    // relanza el error tal cual para que lo maneje el catch general de
    // abajo. Nunca se borra si el INSERT sí tuvo éxito. Mismo patrón ya
    // usado y probado en Multas (operaciones/multas/[id]/documentos/
    // route.ts, MULTAS-5) — no se inventa un mecanismo nuevo.
    let saved: Awaited<ReturnType<typeof guardarUpload>> | undefined;
    try {
      saved = await guardarUpload(empresaId, "documentos", `emp${id}`, file);
      const docId = await registrarDocumento({
        empresaId,
        idEmpleado: id,
        tipoDocumento: tipo,
        rutaArchivo: saved.relative,
        nombreOriginal: saved.original,
        subidoPor: guard.session.username,
      });

      // Observabilidad (sección 8 del ticket): sin datos sensibles — nunca
      // contenido del documento, DPI, nombres, bytes crudos ni rutas
      // absolutas. `saved.size` se registra SOLO aquí, ya con el archivo
      // parseado y guardado.
      console.log("POST documentos — subida completada", {
        empresaId,
        empleadoId: id,
        etapa: "completado",
        tamanoBytes: saved.size,
        duracionMs: Date.now() - inicio,
      });

      return NextResponse.json({
        mensaje: "Documento subido.",
        id: docId,
        documento: {
          id: docId,
          tipoDocumento: tipo,
          nombreOriginal: saved.original,
        },
      });
    } catch (err) {
      if (saved?.relative) borrarUpload(saved.relative);
      throw err;
    }
  } catch (err) {
    console.error("POST documentos", {
      empresaId,
      empleadoId: id,
      etapa: "guardado_o_registro",
      duracionMs: Date.now() - inicio,
      tipoError: err instanceof Error ? err.constructor.name : typeof err,
    });
    // AJUSTE PRE-MERGE PR #176 (puntos 1-2) — solo los errores FUNCIONALES
    // conocidos de validación de archivo (UploadValidationError: vacío,
    // formato no permitido, tamaño excedido — ver src/lib/uploads.ts)
    // conservan su mensaje y usan el status HTTP que les corresponde
    // (400/413). Cualquier otro error (INSERT/DB, filesystem, lo que
    // sea) NUNCA expone su mensaje interno al usuario de RRHH — el
    // detalle técnico ya quedó en el log de arriba; la respuesta es
    // siempre el mismo mensaje genérico.
    if (err instanceof UploadValidationError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json(
      { error: "No se pudo completar la carga del documento. Intenta nuevamente." },
      { status: 500 },
    );
  }
}
