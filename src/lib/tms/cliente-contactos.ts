import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";

/**
 * VIAT-4 (punto 1) — contactos operativos de un cliente. Modelo
 * reutilizable de verdad (NO un campo suelto tipo "telefono_supervisor"):
 * un cliente puede tener varios contactos, cada uno con nombre/cargo/
 * teléfono/email/observaciones propios. `cargo` es texto libre a
 * propósito — Supervisor/Encargado de bodega/Recepción/Administración/
 * Otro son solo ejemplos, no un catálogo cerrado.
 *
 * Reutiliza tms_clientes como identidad de cliente (la misma tabla que ya
 * usa tms_planes_viaje.cliente_id y tms_cliente_ubicaciones) — no duplica
 * el maestro de clientes.
 *
 * Esquema: NO se crea/altera desde este módulo (mismo criterio que
 * cliente-ubicaciones.ts) — asume que
 * sql/migrate-2026-08-viat-4-contactos-rutas.sql ya se aplicó
 * manualmente.
 */

export type ContactoCliente = {
  id: number;
  clienteId: number;
  nombre: string;
  cargo: string | null;
  telefono: string | null;
  email: string | null;
  observaciones: string | null;
  activo: boolean;
};

function mapRow(r: RowDataPacket): ContactoCliente {
  return {
    id: Number(r.id),
    clienteId: Number(r.cliente_id),
    nombre: String(r.nombre),
    cargo: r.cargo != null ? String(r.cargo) : null,
    telefono: r.telefono != null ? String(r.telefono) : null,
    email: r.email != null ? String(r.email) : null,
    observaciones: r.observaciones != null ? String(r.observaciones) : null,
    activo: Number(r.activo ?? 1) === 1,
  };
}

const SELECT =
  "SELECT id, cliente_id, nombre, cargo, telefono, email, observaciones, activo FROM tms_cliente_contactos";

/**
 * Contactos de un cliente. Por defecto solo los activos (selector de
 * contacto en la ruta/Programación); `incluirInactivos` para la
 * administración, donde también deben poder verse/reactivarse — nunca se
 * borran filas, "dejar de usarse" es activo = 0.
 */
export async function listarContactosCliente(
  empresaId: number,
  clienteId: number,
  opts?: { incluirInactivos?: boolean },
): Promise<ContactoCliente[]> {
  const filtroActivo = opts?.incluirInactivos ? "" : " AND activo = 1";
  const rows = await query<RowDataPacket[]>(
    `${SELECT} WHERE empresa_id = ? AND cliente_id = ?${filtroActivo} ORDER BY nombre`,
    [empresaId, clienteId],
  );
  return rows.map(mapRow);
}

/** Un contacto puntual (para mostrarlo en Programación junto a la ruta seleccionada). */
export async function obtenerContacto(
  empresaId: number,
  id: number,
): Promise<ContactoCliente | null> {
  const rows = await query<RowDataPacket[]>(`${SELECT} WHERE id = ? AND empresa_id = ? LIMIT 1`, [
    id,
    empresaId,
  ]);
  return rows[0] ? mapRow(rows[0]) : null;
}

export type ContactoClienteInput = {
  nombre: string;
  cargo?: string | null;
  telefono?: string | null;
  email?: string | null;
  observaciones?: string | null;
};

/**
 * RUTAS-TARIFARIO-HISTORIAL-1 (§8 del ticket) — "antes de crear
 * contacto, validar razonablemente: mismo cliente, mismo email o mismo
 * teléfono. Si parece duplicado, ADVERTIR al usuario. No bloquear por
 * nombre únicamente." Función de SOLO LECTURA, separada de
 * crearContactoCliente a propósito: NUNCA bloquea la creación por sí
 * sola (eso lo decide el caller — la ruta interactiva pregunta al
 * usuario; los importadores masivos, clientes/import/route.ts y
 * rutas-import.ts, no la llaman en absoluto y siguen creando contactos
 * exactamente igual que antes de este ticket).
 *
 * Compara solo contactos ACTIVOS del MISMO cliente — nunca cruza
 * clientes ni empresas. Coincide por email (case-insensitive) o
 * teléfono (comparación exacta tal como se guardó, sin normalizar
 * formato) cuando el input trae ese dato; nunca por nombre solo.
 */
export async function buscarPosiblesDuplicadosContacto(
  empresaId: number,
  clienteId: number,
  input: Pick<ContactoClienteInput, "email" | "telefono">,
): Promise<ContactoCliente[]> {
  const email = input.email?.trim().toLowerCase() || null;
  const telefono = input.telefono?.trim() || null;
  if (!email && !telefono) return [];
  const condiciones: string[] = [];
  const params: (string | number)[] = [empresaId, clienteId];
  if (email) { condiciones.push("LOWER(email) = ?"); params.push(email); }
  if (telefono) { condiciones.push("telefono = ?"); params.push(telefono); }
  const rows = await query<RowDataPacket[]>(
    `${SELECT} WHERE empresa_id = ? AND cliente_id = ? AND activo = 1 AND (${condiciones.join(" OR ")})`,
    params,
  );
  return rows.map(mapRow);
}

export async function crearContactoCliente(
  empresaId: number,
  clienteId: number,
  input: ContactoClienteInput,
): Promise<ContactoCliente> {
  const nombre = input.nombre.trim();
  if (!nombre) throw new Error("Nombre del contacto requerido.");
  const r = await execute(
    `INSERT INTO tms_cliente_contactos
      (empresa_id, cliente_id, nombre, cargo, telefono, email, observaciones)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      empresaId,
      clienteId,
      nombre,
      input.cargo?.trim() || null,
      input.telefono?.trim() || null,
      input.email?.trim() || null,
      input.observaciones?.trim() || null,
    ],
  );
  const rows = await query<RowDataPacket[]>(`${SELECT} WHERE id = ? LIMIT 1`, [Number(r.insertId)]);
  return mapRow(rows[0]);
}

export type ContactoClienteUpdate = Partial<ContactoClienteInput> & {
  activo?: boolean;
};

/** Edita un contacto y/o cambia su estado activo. Nunca hace DELETE. */
export async function actualizarContactoCliente(
  empresaId: number,
  id: number,
  cambios: ContactoClienteUpdate,
): Promise<ContactoCliente | null> {
  const actualRows = await query<RowDataPacket[]>(`${SELECT} WHERE id = ? AND empresa_id = ? LIMIT 1`, [
    id,
    empresaId,
  ]);
  const actual = actualRows[0] ? mapRow(actualRows[0]) : null;
  if (!actual) return null;

  const nombre = cambios.nombre !== undefined ? cambios.nombre.trim() : actual.nombre;
  if (!nombre) throw new Error("Nombre del contacto requerido.");

  await execute(
    `UPDATE tms_cliente_contactos
     SET nombre = ?, cargo = ?, telefono = ?, email = ?, observaciones = ?, activo = ?
     WHERE id = ? AND empresa_id = ?`,
    [
      nombre,
      cambios.cargo !== undefined ? cambios.cargo?.trim() || null : actual.cargo,
      cambios.telefono !== undefined ? cambios.telefono?.trim() || null : actual.telefono,
      cambios.email !== undefined ? cambios.email?.trim() || null : actual.email,
      cambios.observaciones !== undefined ? cambios.observaciones?.trim() || null : actual.observaciones,
      cambios.activo !== undefined ? (cambios.activo ? 1 : 0) : actual.activo ? 1 : 0,
      id,
      empresaId,
    ],
  );
  const rows = await query<RowDataPacket[]>(`${SELECT} WHERE id = ? LIMIT 1`, [id]);
  return rows[0] ? mapRow(rows[0]) : null;
}
