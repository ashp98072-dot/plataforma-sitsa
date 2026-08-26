import { NextResponse } from "next/server";
import { requireClientesOFacturacion } from "@/lib/clientes/acceso";
import { generarPlantillaClientes, normalizarIdentificadorCliente, parsearExcelClientes, type FilaClienteExcel } from "@/lib/clientes/import-excel";
import { actualizarCliente, crearCliente, listarClientes } from "@/lib/clientes/repository";
import type { Cliente, ClienteInput } from "@/lib/clientes/tipos";

type Ctx = { params: Promise<{ slug: string }> };
type EstadoValidacion = "NUEVO" | "ACTUALIZAR" | "OMITIR" | "ERROR";
type PreviewCliente = FilaClienteExcel & {
  estadoValidacion: EstadoValidacion;
  detalle: string;
  clienteId: number | null;
};

const MAX_FILAS = 1000;
const MAX_BYTES = 10 * 1024 * 1024;

function indice(clientes: Cliente[], campo: "codigo" | "nit" | "nombre"): Map<string, Cliente[]> {
  const map = new Map<string, Cliente[]>();
  for (const cliente of clientes) {
    const raw = cliente[campo];
    if (!raw) continue;
    const key = normalizarIdentificadorCliente(String(raw));
    if (!key) continue;
    map.set(key, [...(map.get(key) ?? []), cliente]);
  }
  return map;
}

function candidatos(map: Map<string, Cliente[]>, value: string | null | undefined): Cliente[] {
  if (!value) return [];
  return map.get(normalizarIdentificadorCliente(value)) ?? [];
}

async function analizar(empresaId: number, filas: FilaClienteExcel[]): Promise<PreviewCliente[]> {
  const existentes = await listarClientes(empresaId, { estado: "todos" });
  const porCodigo = indice(existentes, "codigo");
  const porNit = indice(existentes, "nit");
  const porNombre = indice(existentes, "nombre");
  const vistosArchivo = new Set<string>();

  return filas.map((fila) => {
    const errores: string[] = [];
    if (!fila.nombre.trim()) errores.push("falta nombre");
    if (fila.nombre.length > 200) errores.push("nombre supera 200 caracteres");
    if (fila.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fila.email)) errores.push("email inválido");
    if (!fila.tipo) errores.push("tipo inválido");
    if (!fila.estado) errores.push("estado inválido");

    const encontrados = new Map<number, Cliente>();
    for (const c of [
      ...candidatos(porCodigo, fila.codigo),
      ...candidatos(porNit, fila.nit),
      ...candidatos(porNombre, fila.nombre),
    ]) encontrados.set(c.id, c);
    if (encontrados.size > 1) errores.push("código, NIT o nombre coinciden con clientes diferentes");

    const claveArchivo = fila.codigo
      ? `codigo:${normalizarIdentificadorCliente(fila.codigo)}`
      : fila.nit
        ? `nit:${normalizarIdentificadorCliente(fila.nit)}`
        : `nombre:${normalizarIdentificadorCliente(fila.nombre)}`;
    if (vistosArchivo.has(claveArchivo)) errores.push("cliente repetido dentro del archivo");
    vistosArchivo.add(claveArchivo);

    if (errores.length) {
      return { ...fila, estadoValidacion: "ERROR", detalle: errores.join("; "), clienteId: null };
    }
    const existente = [...encontrados.values()][0];
    if (!existente) {
      return { ...fila, estadoValidacion: "NUEVO", detalle: "Se creará y se vinculará con TMS.", clienteId: null };
    }
    if (!fila.actualizar) {
      return { ...fila, estadoValidacion: "OMITIR", detalle: `Ya existe: ${existente.nombre}. No se modificará.`, clienteId: existente.id };
    }
    return { ...fila, estadoValidacion: "ACTUALIZAR", detalle: `Actualizará: ${existente.nombre}.`, clienteId: existente.id };
  });
}

export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireClientesOFacturacion(slug, "clientes");
  if (guard.error) return guard.error;
  const body = new Uint8Array(await generarPlantillaClientes());
  return new NextResponse(body, {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="excel-modelo-clientes.xlsx"',
      "Cache-Control": "private, no-store",
    },
  });
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireClientesOFacturacion(slug, "clientes", true);
  if (guard.error) return guard.error;
  const form = await req.formData();
  const archivo = form.get("archivo");
  const accion = String(form.get("accion") ?? "validar");
  if (!(archivo instanceof File)) return NextResponse.json({ error: "Selecciona un archivo Excel." }, { status: 400 });
  if (accion !== "validar" && accion !== "importar") return NextResponse.json({ error: "Acción inválida." }, { status: 400 });
  if (!/\.(xlsx|xlsm)$/i.test(archivo.name)) return NextResponse.json({ error: "El archivo debe ser .xlsx o .xlsm." }, { status: 400 });
  if (archivo.size > MAX_BYTES) return NextResponse.json({ error: "El archivo supera el límite de 10 MB." }, { status: 400 });

  let filas: FilaClienteExcel[];
  try {
    filas = await parsearExcelClientes(Buffer.from(await archivo.arrayBuffer()));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo leer el Excel." }, { status: 400 });
  }
  if (!filas.length) return NextResponse.json({ error: "El archivo no contiene clientes." }, { status: 400 });
  if (filas.length > MAX_FILAS) return NextResponse.json({ error: `Máximo ${MAX_FILAS} clientes por archivo.` }, { status: 400 });

  const preview = await analizar(guard.empresa.id, filas);
  const resumen = {
    total: preview.length,
    nuevos: preview.filter((f) => f.estadoValidacion === "NUEVO").length,
    actualizar: preview.filter((f) => f.estadoValidacion === "ACTUALIZAR").length,
    omitidos: preview.filter((f) => f.estadoValidacion === "OMITIR").length,
    errores: preview.filter((f) => f.estadoValidacion === "ERROR").length,
  };
  if (accion === "validar") return NextResponse.json({ accion, resumen, filas: preview });

  let creados = 0;
  let actualizados = 0;
  const errores: { filaExcel: number; detalle: string }[] = [];
  for (const fila of preview) {
    try {
      const input: ClienteInput = {
        codigo: fila.codigo,
        nombre: fila.nombre,
        razonSocial: fila.razonSocial,
        nit: fila.nit,
        telefono: fila.telefono,
        email: fila.email,
        direccion: fila.direccion,
        contactoNombre: fila.contactoNombre,
        contactoTelefono: fila.contactoTelefono,
        tipo: fila.tipo,
        estado: fila.estado,
        notas: fila.notas,
      };
      if (fila.estadoValidacion === "NUEVO") {
        await crearCliente(guard.empresa.id, input);
        creados += 1;
      } else if (fila.estadoValidacion === "ACTUALIZAR" && fila.clienteId) {
        const actualizado = await actualizarCliente(guard.empresa.id, fila.clienteId, input);
        if (!actualizado) throw new Error("El cliente dejó de existir antes de confirmar.");
        actualizados += 1;
      }
    } catch (error) {
      errores.push({ filaExcel: fila.filaExcel, detalle: error instanceof Error ? error.message : "No se pudo guardar." });
    }
  }
  return NextResponse.json({
    accion,
    resumen,
    creados,
    actualizados,
    errores,
    mensaje: `Importación finalizada: ${creados} creado(s), ${actualizados} actualizado(s), ${resumen.omitidos} omitido(s).`,
  });
}
