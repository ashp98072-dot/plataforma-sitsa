import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { hashPassword, necesitaRehash, verifyPassword } from "@/lib/password";

export type ColaboradorCredencial = {
  id: number;
  empleadoId: number;
  username: string;
  activo: boolean;
  debeCambiarPassword: boolean;
  ultimoAcceso: string | null;
  creadoEn: string;
};

/** Datos del colaborador que sí importan para armar la sesión del portal. */
export type ColaboradorSesionData = {
  empleadoId: number;
  empresaId: number;
  empresaSlug: string | null;
  nombre: string;
  debeCambiarPassword: boolean;
};

function mapCredencial(r: RowDataPacket): ColaboradorCredencial {
  return {
    id: Number(r.id),
    empleadoId: Number(r.empleado_id),
    username: String(r.username),
    activo: Boolean(r.activo),
    debeCambiarPassword: Boolean(r.debe_cambiar_password),
    ultimoAcceso: r.ultimo_acceso ? String(r.ultimo_acceso) : null,
    creadoEn: String(r.creado_en),
  };
}

export async function obtenerCredencialPorEmpleado(
  empleadoId: number,
): Promise<ColaboradorCredencial | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, empleado_id, username, activo, debe_cambiar_password, ultimo_acceso, creado_en
     FROM colaborador_credenciales WHERE empleado_id = ? LIMIT 1`,
    [empleadoId],
  );
  return rows[0] ? mapCredencial(rows[0]) : null;
}

/**
 * Crea el acceso al portal para un empleado. `empresaId` se exige y se
 * valida contra el propio empleado (no basta con pasar un empleadoId
 * suelto) para no crear credenciales cruzando empresas por error.
 */
export async function crearCredencialColaborador(input: {
  empresaId: number;
  empleadoId: number;
  username: string;
  passwordInicial: string;
}): Promise<{ ok: boolean; mensaje: string }> {
  const username = input.username.trim();
  if (!username || input.passwordInicial.length < 6) {
    return {
      ok: false,
      mensaje: "Usuario y contraseña (mínimo 6 caracteres) son obligatorios.",
    };
  }

  const empleado = await query<RowDataPacket[]>(
    `SELECT id FROM empleados WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [input.empleadoId, input.empresaId],
  );
  if (!empleado[0]) {
    return { ok: false, mensaje: "Empleado no encontrado en esta empresa." };
  }

  const yaTiene = await obtenerCredencialPorEmpleado(input.empleadoId);
  if (yaTiene) {
    return { ok: false, mensaje: "Este empleado ya tiene acceso al portal." };
  }

  const usernameEnUso = await query<RowDataPacket[]>(
    `SELECT id FROM colaborador_credenciales WHERE username = ? LIMIT 1`,
    [username],
  );
  if (usernameEnUso[0]) {
    return { ok: false, mensaje: "Ese usuario ya está en uso." };
  }

  const { salt, passwordHash } = hashPassword(input.passwordInicial);
  await execute(
    `INSERT INTO colaborador_credenciales
       (empleado_id, username, password_hash, salt, activo, debe_cambiar_password)
     VALUES (?, ?, ?, ?, 1, 1)`,
    [input.empleadoId, username, passwordHash, salt],
  );
  return { ok: true, mensaje: "Acceso al portal creado." };
}

/**
 * Verifica usuario/contraseña del colaborador y devuelve lo mínimo que
 * necesita la sesión del portal. También exige que el empleado siga
 * 'Activo' en RRHH, aunque su credencial esté activa (si lo dan de baja,
 * pierde acceso automáticamente sin tener que tocar la tabla de login).
 */
export async function verificarCredencialesColaborador(
  username: string,
  password: string,
): Promise<ColaboradorSesionData | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT cc.id, cc.empleado_id, cc.password_hash, cc.salt, cc.activo,
            cc.debe_cambiar_password,
            e.nombre AS empleado_nombre, e.estado AS empleado_estado, e.empresa_id,
            emp.slug AS empresa_slug
     FROM colaborador_credenciales cc
     JOIN empleados e ON e.id = cc.empleado_id
     LEFT JOIN empresas emp ON emp.id = e.empresa_id
     WHERE cc.username = ? LIMIT 1`,
    [username.trim()],
  );
  const r = rows[0];
  if (!r || !r.activo || r.empleado_estado !== "Activo") return null;
  const saltActual = String(r.salt);
  const hashActual = String(r.password_hash);
  if (!verifyPassword(password, saltActual, hashActual)) {
    return null;
  }

  // Migración transparente al esquema nuevo de hash (scrypt), igual que en
  // el login de staff (ver src/lib/auth.ts).
  if (necesitaRehash(hashActual)) {
    try {
      const { salt, passwordHash } = hashPassword(password);
      await execute(
        "UPDATE colaborador_credenciales SET password_hash = ?, salt = ? WHERE id = ?",
        [passwordHash, salt, Number(r.id)],
      );
    } catch (err) {
      console.error("No se pudo migrar el hash de contraseña del colaborador:", err);
    }
  }

  await execute(
    `UPDATE colaborador_credenciales SET ultimo_acceso = NOW() WHERE id = ?`,
    [r.id],
  );

  return {
    empleadoId: Number(r.empleado_id),
    empresaId: Number(r.empresa_id),
    empresaSlug: r.empresa_slug ? String(r.empresa_slug) : null,
    nombre: String(r.empleado_nombre),
    debeCambiarPassword: Boolean(r.debe_cambiar_password),
  };
}

export async function cambiarPasswordColaborador(
  empleadoId: number,
  passwordActual: string,
  passwordNueva: string,
): Promise<{ ok: boolean; mensaje: string }> {
  if (passwordNueva.length < 6) {
    return { ok: false, mensaje: "La nueva contraseña debe tener al menos 6 caracteres." };
  }
  const rows = await query<RowDataPacket[]>(
    `SELECT id, password_hash, salt FROM colaborador_credenciales WHERE empleado_id = ? LIMIT 1`,
    [empleadoId],
  );
  const r = rows[0];
  if (!r) return { ok: false, mensaje: "No tiene acceso al portal registrado." };
  if (!verifyPassword(passwordActual, String(r.salt), String(r.password_hash))) {
    return { ok: false, mensaje: "La contraseña actual no es correcta." };
  }
  const { salt, passwordHash } = hashPassword(passwordNueva);
  await execute(
    `UPDATE colaborador_credenciales
     SET password_hash = ?, salt = ?, debe_cambiar_password = 0 WHERE id = ?`,
    [passwordHash, salt, r.id],
  );
  return { ok: true, mensaje: "Contraseña actualizada." };
}

/** Uso de RRHH/admin: resetea la contraseña y obliga a cambiarla en el próximo login. */
export async function resetearPasswordColaborador(
  empresaId: number,
  empleadoId: number,
  passwordNueva: string,
): Promise<{ ok: boolean; mensaje: string }> {
  if (passwordNueva.length < 6) {
    return { ok: false, mensaje: "La nueva contraseña debe tener al menos 6 caracteres." };
  }
  const empleado = await query<RowDataPacket[]>(
    `SELECT id FROM empleados WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [empleadoId, empresaId],
  );
  if (!empleado[0]) {
    return { ok: false, mensaje: "Empleado no encontrado en esta empresa." };
  }
  const { salt, passwordHash } = hashPassword(passwordNueva);
  const result = await execute(
    `UPDATE colaborador_credenciales
     SET password_hash = ?, salt = ?, debe_cambiar_password = 1 WHERE empleado_id = ?`,
    [passwordHash, salt, empleadoId],
  );
  if (result.affectedRows === 0) {
    return { ok: false, mensaje: "Este empleado no tiene acceso al portal." };
  }
  return { ok: true, mensaje: "Contraseña reiniciada." };
}

export async function activarCredencialColaborador(
  empleadoId: number,
  activo: boolean,
): Promise<{ ok: boolean; mensaje: string }> {
  const result = await execute(
    `UPDATE colaborador_credenciales SET activo = ? WHERE empleado_id = ?`,
    [activo ? 1 : 0, empleadoId],
  );
  if (result.affectedRows === 0) {
    return { ok: false, mensaje: "Este empleado no tiene acceso al portal." };
  }
  return { ok: true, mensaje: activo ? "Acceso reactivado." : "Acceso desactivado." };
}