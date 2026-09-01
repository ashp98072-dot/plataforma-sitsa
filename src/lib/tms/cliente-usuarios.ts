import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { hashPassword, necesitaRehash, verifyPassword } from "@/lib/password";

/**
 * CLIENTE-PORTAL-1 — usuarios de acceso al Portal del Cliente
 * (tms_cliente_usuarios). Calcado del patrón de
 * src/lib/rrhh/colaborador-auth.ts, con las diferencias exigidas por el
 * ticket:
 *  - Relación 1 cliente TMS → N usuarios (NO 1:1 como
 *    colaborador_credenciales) — no se valida "ya tiene una cuenta" antes
 *    de crear, solo que el email no esté en uso.
 *  - Identificador de login: email, normalizado y único GLOBALMENTE (ver
 *    sql/migrate-2026-09-tms-portal-clientes-base.sql para la decisión
 *    completa) — no username.
 *  - El login exige además que el `tms_clientes` al que pertenece el
 *    usuario siga `estado = 'Activo'` (alcance F del ticket): un cliente
 *    inactivo bloquea a TODOS sus usuarios aunque cada fila individual
 *    siga con `activo = 1`.
 *  - Mensajes de error genéricos ("Credenciales inválidas.") en TODO caso
 *    de fallo de login (email inexistente, password incorrecta, usuario
 *    inactivo, cliente inactivo) — nunca se distingue cuál fue el motivo
 *    exacto en la respuesta al navegador (alcance G).
 *
 * Esquema: NO se crea/altera desde este módulo (mismo criterio que
 * cliente-contactos.ts/cliente-ubicaciones.ts) — asume que
 * sql/migrate-2026-09-tms-portal-clientes-base.sql ya se aplicó
 * manualmente. Esa migración NO se ha ejecutado todavía en ningún
 * entorno al momento de escribir este archivo.
 */

/** email normalizado: minúsculas + trim. Nunca se compara/guarda sin pasar por aquí. */
export function normalizarEmail(email: string): string {
  return email.trim().toLowerCase();
}

export type ClienteUsuario = {
  id: number;
  empresaId: number;
  clienteId: number;
  nombre: string;
  email: string;
  activo: boolean;
  debeCambiarPassword: boolean;
  ultimoAcceso: string | null;
  creadoPor: string | null;
  creadoEn: string;
};

/** Datos que necesita la sesión del portal tras un login exitoso. */
export type ClienteSesionData = {
  usuarioClienteId: number;
  empresaId: number;
  clienteId: number;
  nombre: string;
  debeCambiarPassword: boolean;
};

function mapUsuario(r: RowDataPacket): ClienteUsuario {
  return {
    id: Number(r.id),
    empresaId: Number(r.empresa_id),
    clienteId: Number(r.cliente_id),
    nombre: String(r.nombre),
    email: String(r.email),
    activo: Number(r.activo ?? 1) === 1,
    debeCambiarPassword: Number(r.debe_cambiar_password ?? 1) === 1,
    ultimoAcceso: r.ultimo_acceso ? String(r.ultimo_acceso) : null,
    creadoPor: r.creado_por != null ? String(r.creado_por) : null,
    creadoEn: String(r.creado_en),
  };
}

const SELECT =
  "SELECT id, empresa_id, cliente_id, nombre, email, activo, debe_cambiar_password, ultimo_acceso, creado_por, creado_en FROM tms_cliente_usuarios";

/** Usuarios de un cliente (para la pantalla de staff que los da de alta). */
export async function listarUsuariosDeCliente(
  empresaId: number,
  clienteId: number,
): Promise<ClienteUsuario[]> {
  const rows = await query<RowDataPacket[]>(
    `${SELECT} WHERE empresa_id = ? AND cliente_id = ? ORDER BY nombre`,
    [empresaId, clienteId],
  );
  return rows.map(mapUsuario);
}

/**
 * Alta de la PRIMERA cuenta de un cliente (y de cualquier cuenta
 * adicional, en esta fase siempre creada por staff — ver alcance D del
 * ticket: el cliente no puede auto-registrarse ni crear otras cuentas
 * todavía). `empresaId`/`clienteId` se validan contra el propio cliente
 * (nunca se confía en un clienteId suelto sin comprobar que pertenece a
 * esa empresa) — mismo criterio que crearCredencialColaborador().
 */
export async function crearUsuarioCliente(input: {
  empresaId: number;
  clienteId: number;
  nombre: string;
  email: string;
  passwordInicial: string;
  creadoPor: string;
}): Promise<{ ok: true; usuario: ClienteUsuario } | { ok: false; mensaje: string }> {
  const nombre = input.nombre.trim();
  const email = normalizarEmail(input.email);
  if (!nombre || nombre.length < 2) {
    return { ok: false, mensaje: "El nombre es obligatorio." };
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, mensaje: "El email no es válido." };
  }
  if (input.passwordInicial.length < 6) {
    return { ok: false, mensaje: "La contraseña temporal debe tener al menos 6 caracteres." };
  }

  const cliente = await query<RowDataPacket[]>(
    `SELECT id FROM tms_clientes WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [input.clienteId, input.empresaId],
  );
  if (!cliente[0]) {
    return { ok: false, mensaje: "Cliente no encontrado en esta empresa." };
  }

  const emailEnUso = await query<RowDataPacket[]>(
    `SELECT id FROM tms_cliente_usuarios WHERE email = ? LIMIT 1`,
    [email],
  );
  if (emailEnUso[0]) {
    return { ok: false, mensaje: "Ese email ya está en uso." };
  }

  const { salt, passwordHash } = hashPassword(input.passwordInicial);
  const r = await execute(
    `INSERT INTO tms_cliente_usuarios
       (empresa_id, cliente_id, nombre, email, password_hash, salt, activo,
        debe_cambiar_password, creado_por)
     VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?)`,
    [input.empresaId, input.clienteId, nombre, email, passwordHash, salt, input.creadoPor],
  );
  const rows = await query<RowDataPacket[]>(`${SELECT} WHERE id = ? LIMIT 1`, [Number(r.insertId)]);
  return { ok: true, usuario: mapUsuario(rows[0]) };
}

/**
 * Verifica email/contraseña y devuelve lo mínimo que necesita la sesión
 * del portal. Exige, además de `tms_cliente_usuarios.activo`, que el
 * `tms_clientes` correspondiente siga `estado = 'Activo'` — si Operaciones
 * suspende a un cliente, TODOS sus usuarios pierden acceso al instante sin
 * tener que desactivar cada cuenta una por una (alcance F).
 *
 * El JOIN contra tms_clientes también filtra `c.empresa_id = u.empresa_id`
 * de forma redundante con la FK compuesta de la migración — defensa en
 * profundidad, no depende solo de que la FK exista en el entorno actual.
 */
export async function verificarCredencialesCliente(
  email: string,
  password: string,
): Promise<ClienteSesionData | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT u.id, u.empresa_id, u.cliente_id, u.nombre, u.password_hash, u.salt,
            u.activo, u.debe_cambiar_password,
            c.estado AS cliente_estado
     FROM tms_cliente_usuarios u
     JOIN tms_clientes c ON c.id = u.cliente_id AND c.empresa_id = u.empresa_id
     WHERE u.email = ? LIMIT 1`,
    [normalizarEmail(email)],
  );
  const r = rows[0];
  if (!r || !r.activo || r.cliente_estado !== "Activo") return null;

  const saltActual = String(r.salt);
  const hashActual = String(r.password_hash);
  if (!verifyPassword(password, saltActual, hashActual)) {
    return null;
  }

  // Migración transparente al esquema nuevo de hash (scrypt), igual que en
  // el login de staff/colaborador (ver src/lib/auth.ts, colaborador-auth.ts).
  if (necesitaRehash(hashActual)) {
    try {
      const { salt, passwordHash } = hashPassword(password);
      await execute(
        "UPDATE tms_cliente_usuarios SET password_hash = ?, salt = ? WHERE id = ?",
        [passwordHash, salt, Number(r.id)],
      );
    } catch (err) {
      console.error("No se pudo migrar el hash de contraseña del usuario cliente:", err);
    }
  }

  // ultimo_acceso se actualiza SOLO después de verificar la contraseña
  // (alcance G) — un intento fallido nunca mueve esta marca.
  await execute(
    `UPDATE tms_cliente_usuarios SET ultimo_acceso = NOW() WHERE id = ?`,
    [r.id],
  );

  return {
    usuarioClienteId: Number(r.id),
    empresaId: Number(r.empresa_id),
    clienteId: Number(r.cliente_id),
    nombre: String(r.nombre),
    debeCambiarPassword: Boolean(r.debe_cambiar_password),
  };
}

export async function cambiarPasswordCliente(
  usuarioClienteId: number,
  passwordActual: string,
  passwordNueva: string,
): Promise<{ ok: boolean; mensaje: string }> {
  if (passwordNueva.length < 6) {
    return { ok: false, mensaje: "La nueva contraseña debe tener al menos 6 caracteres." };
  }
  const rows = await query<RowDataPacket[]>(
    `SELECT id, password_hash, salt FROM tms_cliente_usuarios WHERE id = ? LIMIT 1`,
    [usuarioClienteId],
  );
  const r = rows[0];
  if (!r) return { ok: false, mensaje: "Usuario no encontrado." };
  if (!verifyPassword(passwordActual, String(r.salt), String(r.password_hash))) {
    return { ok: false, mensaje: "La contraseña actual no es correcta." };
  }
  const { salt, passwordHash } = hashPassword(passwordNueva);
  await execute(
    `UPDATE tms_cliente_usuarios
     SET password_hash = ?, salt = ?, debe_cambiar_password = 0 WHERE id = ?`,
    [passwordHash, salt, r.id],
  );
  return { ok: true, mensaje: "Contraseña actualizada." };
}

/** Uso de staff: resetea la contraseña y obliga a cambiarla en el próximo login. */
export async function resetearPasswordUsuarioCliente(
  empresaId: number,
  usuarioClienteId: number,
  passwordNueva: string,
): Promise<{ ok: boolean; mensaje: string }> {
  if (passwordNueva.length < 6) {
    return { ok: false, mensaje: "La nueva contraseña debe tener al menos 6 caracteres." };
  }
  const { salt, passwordHash } = hashPassword(passwordNueva);
  const result = await execute(
    `UPDATE tms_cliente_usuarios
     SET password_hash = ?, salt = ?, debe_cambiar_password = 1
     WHERE id = ? AND empresa_id = ?`,
    [passwordHash, salt, usuarioClienteId, empresaId],
  );
  if (result.affectedRows === 0) {
    return { ok: false, mensaje: "Usuario no encontrado en esta empresa." };
  }
  return { ok: true, mensaje: "Contraseña reiniciada." };
}

/** Uso de staff: activa/desactiva una cuenta puntual sin borrarla. */
export async function activarUsuarioCliente(
  empresaId: number,
  usuarioClienteId: number,
  activo: boolean,
): Promise<{ ok: boolean; mensaje: string }> {
  const result = await execute(
    `UPDATE tms_cliente_usuarios SET activo = ? WHERE id = ? AND empresa_id = ?`,
    [activo ? 1 : 0, usuarioClienteId, empresaId],
  );
  if (result.affectedRows === 0) {
    return { ok: false, mensaje: "Usuario no encontrado en esta empresa." };
  }
  return { ok: true, mensaje: activo ? "Acceso reactivado." : "Acceso desactivado." };
}
