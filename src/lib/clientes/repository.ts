import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import {
  type Cliente,
  type ClienteEstado,
  type ClienteInput,
  type ClienteTipo,
} from "@/lib/clientes/tipos";
import { asegurarSchemaClientes } from "@/lib/clientes/schema";

function mapRow(r: RowDataPacket): Cliente {
  return {
    id: Number(r.id),
    empresaId: Number(r.empresa_id),
    codigo: r.codigo != null ? String(r.codigo) : null,
    nombre: String(r.nombre),
    razonSocial: r.razon_social != null ? String(r.razon_social) : null,
    nit: r.nit != null ? String(r.nit) : null,
    telefono: r.telefono != null ? String(r.telefono) : null,
    email: r.email != null ? String(r.email) : null,
    direccion: r.direccion != null ? String(r.direccion) : null,
    contactoNombre:
      r.contacto_nombre != null ? String(r.contacto_nombre) : null,
    contactoTelefono:
      r.contacto_telefono != null ? String(r.contacto_telefono) : null,
    tipo: (String(r.tipo || "comercial") as ClienteTipo) || "comercial",
    estado: (String(r.estado || "Activo") as ClienteEstado) || "Activo",
    notas: r.notas != null ? String(r.notas) : null,
    tmsClienteId:
      r.tms_cliente_id != null ? Number(r.tms_cliente_id) : null,
    creadoAt: r.creado_at != null ? String(r.creado_at) : null,
    actualizadoAt: r.actualizado_at != null ? String(r.actualizado_at) : null,
  };
}

const SELECT = `SELECT id, empresa_id, codigo, nombre, razon_social, nit, telefono,
  email, direccion, contacto_nombre, contacto_telefono, tipo, estado, notas,
  tms_cliente_id, creado_at, actualizado_at FROM clientes`;

export async function listarClientes(
  empresaId: number,
  opts?: { q?: string; estado?: string },
): Promise<Cliente[]> {
  await asegurarSchemaClientes();
  const params: (string | number)[] = [empresaId];
  let sql = `${SELECT} WHERE empresa_id = ?`;
  if (opts?.estado && opts.estado !== "todos") {
    sql += " AND estado = ?";
    params.push(opts.estado);
  }
  if (opts?.q?.trim()) {
    const q = `%${opts.q.trim()}%`;
    sql +=
      " AND (nombre LIKE ? OR nit LIKE ? OR codigo LIKE ? OR razon_social LIKE ?)";
    params.push(q, q, q, q);
  }
  sql += " ORDER BY nombre";
  const rows = await query<RowDataPacket[]>(sql, params);
  return rows.map(mapRow);
}

export async function obtenerCliente(
  empresaId: number,
  id: number,
): Promise<Cliente | null> {
  await asegurarSchemaClientes();
  const rows = await query<RowDataPacket[]>(
    `${SELECT} WHERE empresa_id = ? AND id = ? LIMIT 1`,
    [empresaId, id],
  );
  return rows[0] ? mapRow(rows[0]) : null;
}

/** Mantiene tms_clientes alineado para planes TMS (FK existente). */
async function syncTmsCliente(
  empresaId: number,
  input: ClienteInput,
  tmsClienteId: number | null,
): Promise<number | null> {
  try {
    if (tmsClienteId) {
      await execute(
        `UPDATE tms_clientes
         SET nombre = ?, nit = ?, telefono = ?, direccion = ?, estado = ?
         WHERE id = ? AND empresa_id = ?`,
        [
          input.nombre,
          input.nit ?? null,
          input.telefono ?? null,
          input.direccion ?? null,
          input.estado ?? "Activo",
          tmsClienteId,
          empresaId,
        ],
      );
      return tmsClienteId;
    }
    const r = await execute(
      `INSERT INTO tms_clientes (empresa_id, nombre, nit, telefono, direccion, estado)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        empresaId,
        input.nombre,
        input.nit ?? null,
        input.telefono ?? null,
        input.direccion ?? null,
        input.estado ?? "Activo",
      ],
    );
    return Number(r.insertId) || null;
  } catch {
    return tmsClienteId;
  }
}

export async function crearCliente(
  empresaId: number,
  input: ClienteInput,
): Promise<Cliente> {
  await asegurarSchemaClientes();
  const tmsId = await syncTmsCliente(empresaId, input, null);
  const r = await execute(
    `INSERT INTO clientes (
       empresa_id, codigo, nombre, razon_social, nit, telefono, email,
       direccion, contacto_nombre, contacto_telefono, tipo, estado, notas, tms_cliente_id
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      empresaId,
      input.codigo ?? null,
      input.nombre,
      input.razonSocial ?? null,
      input.nit ?? null,
      input.telefono ?? null,
      input.email ?? null,
      input.direccion ?? null,
      input.contactoNombre ?? null,
      input.contactoTelefono ?? null,
      input.tipo ?? "comercial",
      input.estado ?? "Activo",
      input.notas ?? null,
      tmsId,
    ],
  );
  const created = await obtenerCliente(empresaId, Number(r.insertId));
  if (!created) throw new Error("No se pudo crear el cliente.");
  return created;
}

export async function actualizarCliente(
  empresaId: number,
  id: number,
  input: ClienteInput,
): Promise<Cliente | null> {
  await asegurarSchemaClientes();
  const actual = await obtenerCliente(empresaId, id);
  if (!actual) return null;
  const tmsId = await syncTmsCliente(empresaId, input, actual.tmsClienteId);
  await execute(
    `UPDATE clientes SET
       codigo = ?, nombre = ?, razon_social = ?, nit = ?, telefono = ?, email = ?,
       direccion = ?, contacto_nombre = ?, contacto_telefono = ?, tipo = ?,
       estado = ?, notas = ?, tms_cliente_id = ?
     WHERE id = ? AND empresa_id = ?`,
    [
      input.codigo ?? null,
      input.nombre,
      input.razonSocial ?? null,
      input.nit ?? null,
      input.telefono ?? null,
      input.email ?? null,
      input.direccion ?? null,
      input.contactoNombre ?? null,
      input.contactoTelefono ?? null,
      input.tipo ?? actual.tipo,
      input.estado ?? actual.estado,
      input.notas ?? null,
      tmsId,
      id,
      empresaId,
    ],
  );
  return obtenerCliente(empresaId, id);
}

/** Trae clientes históricos de TMS al catálogo compartido (idempotente). */
export async function importarClientesDesdeTms(
  empresaId: number,
): Promise<{ importados: number; existentes: number }> {
  await asegurarSchemaClientes();
  let importados = 0;
  let existentes = 0;
  const rows = await query<RowDataPacket[]>(
    `SELECT id, nombre, nit, telefono, direccion, estado
     FROM tms_clientes WHERE empresa_id = ? ORDER BY id`,
    [empresaId],
  );
  for (const r of rows) {
    const tmsId = Number(r.id);
    const hit = await query<RowDataPacket[]>(
      `SELECT id FROM clientes WHERE empresa_id = ? AND tms_cliente_id = ? LIMIT 1`,
      [empresaId, tmsId],
    );
    if (hit[0]) {
      existentes += 1;
      continue;
    }
    const porNombre = await query<RowDataPacket[]>(
      `SELECT id, tms_cliente_id FROM clientes
       WHERE empresa_id = ? AND nombre = ? LIMIT 1`,
      [empresaId, String(r.nombre)],
    );
    if (porNombre[0]) {
      if (porNombre[0].tms_cliente_id == null) {
        await execute(
          `UPDATE clientes SET tms_cliente_id = ?, nit = COALESCE(nit, ?),
             telefono = COALESCE(telefono, ?), direccion = COALESCE(direccion, ?)
           WHERE id = ? AND empresa_id = ?`,
          [
            tmsId,
            r.nit != null ? String(r.nit) : null,
            r.telefono != null ? String(r.telefono) : null,
            r.direccion != null ? String(r.direccion) : null,
            Number(porNombre[0].id),
            empresaId,
          ],
        );
      }
      existentes += 1;
      continue;
    }
    await execute(
      `INSERT INTO clientes (
         empresa_id, nombre, nit, telefono, direccion, tipo, estado, tms_cliente_id
       ) VALUES (?, ?, ?, ?, ?, 'transporte', ?, ?)`,
      [
        empresaId,
        String(r.nombre),
        r.nit != null ? String(r.nit) : null,
        r.telefono != null ? String(r.telefono) : null,
        r.direccion != null ? String(r.direccion) : null,
        r.estado != null ? String(r.estado) : "Activo",
        tmsId,
      ],
    );
    importados += 1;
  }
  return { importados, existentes };
}

const vinculosReady = new Set<number>();

/** Asegura que clientes activos del catálogo tengan fila en tms_clientes (para planes). */
export async function asegurarVinculosTmsClientes(
  empresaId: number,
): Promise<void> {
  if (vinculosReady.has(empresaId)) return;
  await asegurarSchemaClientes();
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT id, nombre, nit, telefono, direccion, estado, tms_cliente_id
       FROM clientes
       WHERE empresa_id = ? AND estado = 'Activo' AND tms_cliente_id IS NULL
       LIMIT 200`,
      [empresaId],
    );
    for (const r of rows) {
      const tmsId = await syncTmsCliente(
        empresaId,
        {
          nombre: String(r.nombre),
          nit: r.nit != null ? String(r.nit) : null,
          telefono: r.telefono != null ? String(r.telefono) : null,
          direccion: r.direccion != null ? String(r.direccion) : null,
          estado: (r.estado as ClienteEstado) || "Activo",
        },
        null,
      );
      if (tmsId) {
        await execute(
          `UPDATE clientes SET tms_cliente_id = ? WHERE id = ? AND empresa_id = ?`,
          [tmsId, Number(r.id), empresaId],
        );
      }
    }
    vinculosReady.add(empresaId);
  } catch {
    /* no bloquear TMS */
  }
}

/** Alta rápida usada por TMS (mantiene ids de tms_clientes para planes). */
export async function crearClienteDesdeTms(
  empresaId: number,
  input: { nombre: string; nit?: string | null; telefono?: string | null },
): Promise<{ tmsClienteId: number; clienteId: number }> {
  await asegurarSchemaClientes();
  const r = await execute(
    `INSERT INTO tms_clientes (empresa_id, nombre, nit, telefono) VALUES (?, ?, ?, ?)`,
    [empresaId, input.nombre, input.nit ?? null, input.telefono ?? null],
  );
  const tmsClienteId = Number(r.insertId);
  const c = await execute(
    `INSERT INTO clientes (
       empresa_id, nombre, nit, telefono, tipo, estado, tms_cliente_id
     ) VALUES (?, ?, ?, ?, 'transporte', 'Activo', ?)`,
    [
      empresaId,
      input.nombre,
      input.nit ?? null,
      input.telefono ?? null,
      tmsClienteId,
    ],
  );
  return {
    tmsClienteId,
    clienteId: Number(c.insertId),
  };
}
