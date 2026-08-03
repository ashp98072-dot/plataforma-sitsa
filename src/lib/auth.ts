import type { RowDataPacket } from "mysql2";
import { execute, query } from "./db";
import { hashPassword, verifyPassword } from "./password";
import type { RolGlobal } from "./roles";

export type UsuarioRow = {
  id: number;
  username: string;
  nombre: string | null;
  email: string | null;
  rol: RolGlobal;
  activo: boolean;
  accesoTodas: boolean;
};

export async function verificarCredenciales(
  username: string,
  password: string,
): Promise<UsuarioRow | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, username, password_hash, salt, nombre, email, rol_global, activo, acceso_todas_empresas
     FROM usuarios WHERE username = ? LIMIT 1`,
    [username.trim()],
  );
  const r = rows[0];
  if (!r || !r.activo) return null;
  if (!verifyPassword(password, String(r.salt), String(r.password_hash))) {
    return null;
  }
  return {
    id: Number(r.id),
    username: String(r.username),
    nombre: r.nombre ? String(r.nombre) : null,
    email: r.email ? String(r.email) : null,
    rol: String(r.rol_global) as RolGlobal,
    activo: Boolean(r.activo),
    accesoTodas: Boolean(r.acceso_todas_empresas),
  };
}

export async function listarUsuarios(): Promise<
  (UsuarioRow & { empresas: number[] })[]
> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, username, nombre, email, rol_global, activo, acceso_todas_empresas
     FROM usuarios ORDER BY username`,
  );
  const result: (UsuarioRow & { empresas: number[] })[] = [];
  for (const r of rows) {
    const links = await query<RowDataPacket[]>(
      "SELECT empresa_id FROM usuario_empresa WHERE usuario_id = ?",
      [r.id],
    );
    result.push({
      id: Number(r.id),
      username: String(r.username),
      nombre: r.nombre ? String(r.nombre) : null,
      email: r.email ? String(r.email) : null,
      rol: String(r.rol_global) as RolGlobal,
      activo: Boolean(r.activo),
      accesoTodas: Boolean(r.acceso_todas_empresas),
      empresas: links.map((l) => Number(l.empresa_id)),
    });
  }
  return result;
}

export async function crearUsuario(input: {
  username: string;
  password: string;
  nombre?: string;
  email?: string;
  rol: RolGlobal;
  accesoTodas: boolean;
  empresaIds: number[];
}): Promise<number> {
  const { salt, passwordHash } = hashPassword(input.password);
  const result = await execute(
    `INSERT INTO usuarios (username, password_hash, salt, nombre, email, rol_global, acceso_todas_empresas, activo)
     VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
    [
      input.username.trim(),
      passwordHash,
      salt,
      input.nombre ?? null,
      input.email ?? null,
      input.rol,
      input.accesoTodas ? 1 : 0,
    ],
  );
  const id = Number(result.insertId);
  for (const eid of input.empresaIds) {
    await execute(
      "INSERT IGNORE INTO usuario_empresa (usuario_id, empresa_id) VALUES (?, ?)",
      [id, eid],
    );
  }
  return id;
}

export async function actualizarUsuario(
  id: number,
  input: {
    nombre?: string;
    email?: string;
    rol: RolGlobal;
    accesoTodas: boolean;
    activo: boolean;
    empresaIds: number[];
    password?: string;
  },
): Promise<void> {
  if (input.password?.trim()) {
    const { salt, passwordHash } = hashPassword(input.password.trim());
    await execute(
      `UPDATE usuarios SET nombre=?, email=?, rol_global=?, acceso_todas_empresas=?, activo=?,
       password_hash=?, salt=? WHERE id=?`,
      [
        input.nombre ?? null,
        input.email ?? null,
        input.rol,
        input.accesoTodas ? 1 : 0,
        input.activo ? 1 : 0,
        passwordHash,
        salt,
        id,
      ],
    );
  } else {
    await execute(
      `UPDATE usuarios SET nombre=?, email=?, rol_global=?, acceso_todas_empresas=?, activo=? WHERE id=?`,
      [
        input.nombre ?? null,
        input.email ?? null,
        input.rol,
        input.accesoTodas ? 1 : 0,
        input.activo ? 1 : 0,
        id,
      ],
    );
  }
  await execute("DELETE FROM usuario_empresa WHERE usuario_id = ?", [id]);
  for (const eid of input.empresaIds) {
    await execute(
      "INSERT INTO usuario_empresa (usuario_id, empresa_id) VALUES (?, ?)",
      [id, eid],
    );
  }
}
