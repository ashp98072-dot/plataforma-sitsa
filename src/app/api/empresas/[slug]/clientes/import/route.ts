import { NextResponse } from "next/server";
import { requireClientesOFacturacion } from "@/lib/clientes/acceso";
import {
  generarPlantillaClientes,
  normalizarIdentificadorCliente,
  parsearContactosExcelClientes,
  parsearExcelClientes,
  type FilaClienteExcel,
  type FilaContactoClienteExcel,
} from "@/lib/clientes/import-excel";
import { actualizarCliente, crearCliente, listarClientes } from "@/lib/clientes/repository";
import {
  crearContactoCliente,
  listarContactosCliente,
} from "@/lib/tms/cliente-contactos";
import type { Cliente, ClienteInput } from "@/lib/clientes/tipos";

type Ctx = { params: Promise<{ slug: string }> };
type EstadoValidacion = "NUEVO" | "ACTUALIZAR" | "OMITIR" | "ERROR";
type PreviewCliente = FilaClienteExcel & {
  estadoValidacion: EstadoValidacion;
  detalle: string;
  clienteId: number | null;
};
type EstadoValidacionContacto = "OK" | "SIN_CLIENTE";
type PreviewContacto = FilaContactoClienteExcel & {
  estadoValidacion: EstadoValidacionContacto;
  detalle: string;
};

const MAX_FILAS = 1000;
const MAX_BYTES = 10 * 1024 * 1024;

function indice(clientes: Cliente[], campo: "codigo" | "nit" | "rtu" | "nombre"): Map<string, Cliente[]> {
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

function analizar(existentes: Cliente[], filas: FilaClienteExcel[]): PreviewCliente[] {
  const porCodigo = indice(existentes, "codigo");
  const porNit = indice(existentes, "nit");
  const porRtu = indice(existentes, "rtu");
  const porNombre = indice(existentes, "nombre");
  const vistosArchivo = new Set<string>();
  const destinosArchivo = new Set<number>();

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
      ...candidatos(porRtu, fila.rtu),
    ]) encontrados.set(c.id, c);
    // El nombre comercial no es identidad fiscal: distintas razones sociales
    // pueden compartirlo. Solo se usa como respaldo sin identificadores.
    if (!fila.codigo && !fila.nit && !fila.rtu) {
      for (const c of candidatos(porNombre, fila.nombre)) encontrados.set(c.id, c);
    }
    if (encontrados.size > 1) errores.push("identificación ambigua: indica el código y NIT correctos; coinciden con clientes diferentes");
    const existente = encontrados.size === 1 ? [...encontrados.values()][0] : undefined;
    if (existente) {
      for (const campo of ["nit", "rtu"] as const) {
        if (fila[campo] && existente[campo] && normalizarIdentificadorCliente(fila[campo]!) !== normalizarIdentificadorCliente(existente[campo]!)) {
          errores.push(`${campo.toUpperCase()} distinto al del cliente identificado; usa un registro separado para otra identidad fiscal`);
        }
      }
      if (destinosArchivo.has(existente.id)) errores.push("varias filas apuntan al mismo cliente existente");
    }

    const clavesArchivo = (["codigo", "nit", "rtu"] as const)
      .filter((campo) => fila[campo])
      .map((campo) => `${campo}:${normalizarIdentificadorCliente(fila[campo]!)}`);
    if (!clavesArchivo.length) clavesArchivo.push(`nombre:${normalizarIdentificadorCliente(fila.nombre)}`);
    if (clavesArchivo.some((clave) => vistosArchivo.has(clave))) errores.push("cliente repetido dentro del archivo");
    clavesArchivo.forEach((clave) => vistosArchivo.add(clave));

    if (errores.length) {
      return { ...fila, estadoValidacion: "ERROR", detalle: errores.join("; "), clienteId: null };
    }
    if (!existente) {
      return {
        ...fila,
        estadoValidacion: "NUEVO",
        detalle: fila.codigo
          ? "Se creará y se vinculará con TMS."
          : "Se creará con código automático y se vinculará con TMS.",
        clienteId: null,
      };
    }
    destinosArchivo.add(existente.id);
    if (!fila.actualizar) {
      return { ...fila, estadoValidacion: "OMITIR", detalle: `Ya existe: ${existente.nombre}. No se modificará.`, clienteId: existente.id };
    }
    return { ...fila, estadoValidacion: "ACTUALIZAR", detalle: `Actualizará: ${existente.nombre} · código ${existente.codigo ?? "—"} · NIT ${existente.nit ?? "—"}.`, clienteId: existente.id };
  });
}

/**
 * TMS-CLIENTES-CREDITO-CONTACTOS-1 — resuelve cada fila de la hoja
 * CONTACTOS contra un cliente de la hoja CLIENTES (mismo archivo, por
 * código o por nombre) o contra un cliente YA existente en la base
 * (`existentes`, la misma lista que ya usa `analizar()`) — nunca inventa
 * un cliente nuevo desde esta hoja. Una fila cuyo cliente identificado
 * está en estado ERROR también queda SIN_CLIENTE (no tiene sentido
 * agregarle un contacto a un cliente que no se va a crear/tocar).
 */
function resolverContactos(
  filasContactos: FilaContactoClienteExcel[],
  preview: PreviewCliente[],
  existentes: Cliente[],
): PreviewContacto[] {
  const previewPorCodigo = new Map(preview.filter((p) => p.codigo).map((p) => [normalizarIdentificadorCliente(p.codigo!), p]));
  const previewPorNombre = new Map(preview.filter((p) => p.nombre).map((p) => [normalizarIdentificadorCliente(p.nombre), p]));
  const existentesPorCodigo = indice(existentes, "codigo");
  const existentesPorNombre = indice(existentes, "nombre");

  return filasContactos.map((fila) => {
    const clavePorCodigo = fila.clienteCodigo ? normalizarIdentificadorCliente(fila.clienteCodigo) : null;
    const clavePorNombre = fila.clienteNombre ? normalizarIdentificadorCliente(fila.clienteNombre) : null;
    const enArchivo =
      (clavePorCodigo && previewPorCodigo.get(clavePorCodigo)) ||
      (clavePorNombre && previewPorNombre.get(clavePorNombre));
    if (enArchivo) {
      if (enArchivo.estadoValidacion === "ERROR") {
        return { ...fila, estadoValidacion: "SIN_CLIENTE", detalle: `El cliente "${enArchivo.nombre}" tiene errores y no se creará/actualizará.` };
      }
      return { ...fila, estadoValidacion: "OK", detalle: `Se vinculará a: ${enArchivo.nombre}${enArchivo.codigo ? ` (${enArchivo.codigo})` : ""}.` };
    }
    const existente =
      (clavePorCodigo && existentesPorCodigo.get(clavePorCodigo)?.[0]) ||
      (clavePorNombre && existentesPorNombre.get(clavePorNombre)?.[0]);
    if (existente) {
      return { ...fila, estadoValidacion: "OK", detalle: `Se vinculará al cliente existente: ${existente.nombre}${existente.codigo ? ` (${existente.codigo})` : ""}.` };
    }
    return {
      ...fila,
      estadoValidacion: "SIN_CLIENTE",
      detalle: `No se encontró un cliente con código "${fila.clienteCodigo ?? "—"}" ni nombre "${fila.clienteNombre ?? "—"}" en este archivo ni en el catálogo.`,
    };
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

  const buffer = Buffer.from(await archivo.arrayBuffer());
  let filas: FilaClienteExcel[];
  let filasContactos: FilaContactoClienteExcel[];
  try {
    filas = await parsearExcelClientes(buffer);
    // Hoja opcional: si no existe o no se puede leer con el formato
    // esperado, se ignora en vez de bloquear el import de clientes.
    filasContactos = await parsearContactosExcelClientes(buffer).catch(() => []);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "No se pudo leer el Excel." }, { status: 400 });
  }
  if (!filas.length) return NextResponse.json({ error: "El archivo no contiene clientes." }, { status: 400 });
  if (filas.length > MAX_FILAS) return NextResponse.json({ error: `Máximo ${MAX_FILAS} clientes por archivo.` }, { status: 400 });

  const existentes = await listarClientes(guard.empresa.id, { estado: "todos" });
  const preview = analizar(existentes, filas);
  const previewContactos = resolverContactos(filasContactos, preview, existentes);
  const resumen = {
    total: preview.length,
    nuevos: preview.filter((f) => f.estadoValidacion === "NUEVO").length,
    actualizar: preview.filter((f) => f.estadoValidacion === "ACTUALIZAR").length,
    omitidos: preview.filter((f) => f.estadoValidacion === "OMITIR").length,
    errores: preview.filter((f) => f.estadoValidacion === "ERROR").length,
  };
  const resumenContactos = previewContactos.length
    ? {
        total: previewContactos.length,
        ok: previewContactos.filter((f) => f.estadoValidacion === "OK").length,
        sinCliente: previewContactos.filter((f) => f.estadoValidacion === "SIN_CLIENTE").length,
      }
    : null;
  if (accion === "validar") {
    return NextResponse.json({ accion, resumen, filas: preview, resumenContactos, contactos: previewContactos });
  }

  let creados = 0;
  let actualizados = 0;
  const errores: { filaExcel: number; detalle: string }[] = [];
  // Clave normalizada (código o, en su defecto, nombre) -> identidad
  // resuelta de ESTE import, para poder enlazar los contactos de la hoja
  // CONTACTOS aunque el cliente se acabe de crear en este mismo request.
  const resueltosPorClave = new Map<string, { clienteId: number; tmsClienteId: number | null }>();
  const registrar = (fila: PreviewCliente, cliente: Cliente) => {
    const clave = fila.codigo ? normalizarIdentificadorCliente(fila.codigo) : normalizarIdentificadorCliente(fila.nombre);
    resueltosPorClave.set(clave, { clienteId: cliente.id, tmsClienteId: cliente.tmsClienteId });
  };
  for (const fila of preview) {
    try {
      const input: ClienteInput = {
        codigo: fila.codigo,
        nombre: fila.nombre,
        razonSocial: fila.razonSocial,
        nit: fila.nit,
        rtu: fila.rtu,
        telefono: fila.telefono,
        email: fila.email,
        direccion: fila.direccion,
        contactoNombre: fila.contactoNombre,
        contactoTelefono: fila.contactoTelefono,
        tipo: fila.tipo,
        estado: fila.estado,
        condicionCredito: fila.condicionCredito,
        notas: fila.notas,
      };
      if (fila.estadoValidacion === "NUEVO") {
        const creado = await crearCliente(guard.empresa.id, input);
        creados += 1;
        registrar(fila, creado);
      } else if (fila.estadoValidacion === "ACTUALIZAR" && fila.clienteId) {
        const actualizado = await actualizarCliente(guard.empresa.id, fila.clienteId, input);
        if (!actualizado) throw new Error("El cliente dejó de existir antes de confirmar.");
        actualizados += 1;
        registrar(fila, actualizado);
      } else if (fila.estadoValidacion === "OMITIR" && fila.clienteId) {
        // No se modifica el cliente, pero sigue siendo un destino válido
        // para contactos nuevos de la hoja CONTACTOS (agregar contactos no
        // es "modificar" el cliente en el sentido de actualizar_si_existe).
        const existente = existentes.find((c) => c.id === fila.clienteId);
        if (existente) registrar(fila, existente);
      }
    } catch (error) {
      errores.push({ filaExcel: fila.filaExcel, detalle: error instanceof Error ? error.message : "No se pudo guardar." });
    }
  }

  let contactosCreados = 0;
  let contactosOmitidos = 0;
  const erroresContactos: { filaExcel: number; detalle: string }[] = [];
  const contactosExistentesCache = new Map<number, Set<string>>();
  for (const filaContacto of previewContactos) {
    if (filaContacto.estadoValidacion !== "OK") continue;
    const clave = filaContacto.clienteCodigo
      ? normalizarIdentificadorCliente(filaContacto.clienteCodigo)
      : normalizarIdentificadorCliente(filaContacto.clienteNombre ?? "");
    const destino = resueltosPorClave.get(clave);
    if (!destino || !destino.tmsClienteId) {
      erroresContactos.push({ filaExcel: filaContacto.filaExcel, detalle: "El cliente no se sincronizó con TMS; no se pudo guardar el contacto." });
      continue;
    }
    try {
      // Evita duplicar contactos si el mismo archivo se valida/importa más
      // de una vez: nunca se hace UPDATE/DELETE aquí, solo se omite un
      // nombre ya presente (activo o no) para ESTE cliente.
      let nombresExistentes = contactosExistentesCache.get(destino.tmsClienteId);
      if (!nombresExistentes) {
        const actuales = await listarContactosCliente(guard.empresa.id, destino.tmsClienteId, { incluirInactivos: true });
        nombresExistentes = new Set(actuales.map((c) => normalizarIdentificadorCliente(c.nombre)));
        contactosExistentesCache.set(destino.tmsClienteId, nombresExistentes);
      }
      const claveNombre = normalizarIdentificadorCliente(filaContacto.nombre);
      if (nombresExistentes.has(claveNombre)) {
        contactosOmitidos += 1;
        continue;
      }
      await crearContactoCliente(guard.empresa.id, destino.tmsClienteId, {
        nombre: filaContacto.nombre,
        cargo: filaContacto.cargo,
        telefono: filaContacto.telefono,
        email: filaContacto.email,
        observaciones: filaContacto.observaciones,
      });
      nombresExistentes.add(claveNombre);
      contactosCreados += 1;
    } catch (error) {
      erroresContactos.push({ filaExcel: filaContacto.filaExcel, detalle: error instanceof Error ? error.message : "No se pudo guardar el contacto." });
    }
  }

  return NextResponse.json({
    accion,
    resumen,
    creados,
    actualizados,
    errores,
    resumenContactos,
    contactosCreados,
    contactosOmitidos,
    erroresContactos,
    mensaje: `Importación finalizada: ${creados} creado(s), ${actualizados} actualizado(s), ${resumen.omitidos} omitido(s)`
      + (previewContactos.length ? `. Contactos: ${contactosCreados} creado(s), ${contactosOmitidos} ya existían.` : "."),
  });
}
