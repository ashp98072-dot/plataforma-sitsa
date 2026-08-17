// Uso:
//   node scripts/crear-colaborador-prueba.mjs --id=123
//   node scripts/crear-colaborador-prueba.mjs --codigo=EMP001
//   node scripts/crear-colaborador-prueba.mjs --codigo=EMP001 --username=juan.perez --password=colab123
//
// Sin --id ni --codigo: lista los primeros empleados activos para que elijas uno.
//
// No inventa un empleado nuevo (no conozco todas las columnas obligatorias
// de `empleados`) — usa uno que ya exista y solo le crea el acceso al portal
// en `colaborador_credenciales`.

import { createHash, randomBytes } from "crypto";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";
import { config } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
config({ path: join(root, ".env.local") });
config({ path: join(root, ".env") });

// Mismo algoritmo que @/lib/password (así lo usan admin/rrhh en init-db.mjs).
function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const passwordHash = createHash("sha256")
    .update(salt + password, "utf8")
    .digest("hex");
  return { salt, passwordHash };
}

function parseArgs() {
  const out = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)=(.*)$/);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

async function main() {
  const args = parseArgs();
  const {
    DB_HOST = "localhost",
    DB_PORT = "3306",
    DB_USER,
    DB_PASSWORD = "",
    DB_NAME,
  } = process.env;

  if (!DB_USER || !DB_NAME) {
    console.error("Define DB_USER y DB_NAME en .env.local");
    process.exit(1);
  }

  let host = String(DB_HOST).trim();
  if (host === "localhost") host = "127.0.0.1";

  const conn = await mysql.createConnection({
    host,
    port: Number(DB_PORT),
    user: DB_USER,
    password: DB_PASSWORD,
    database: DB_NAME,
  });

  if (!args.id && !args.codigo) {
    const [rows] = await conn.query(
      `SELECT id, codigo, nombre, empresa_id, estado FROM empleados
       WHERE estado = 'Activo' ORDER BY id LIMIT 15`,
    );
    console.log("No pasaste --id ni --codigo. Empleados activos disponibles:\n");
    for (const r of rows) {
      console.log(
        `  id=${r.id}  codigo=${r.codigo}  nombre=${r.nombre}  empresa_id=${r.empresa_id}`,
      );
    }
    console.log(
      "\nVuelve a correr, por ejemplo:\n  node scripts/crear-colaborador-prueba.mjs --id=" +
        (rows[0]?.id ?? "1"),
    );
    await conn.end();
    return;
  }

  const [empRows] = await conn.query(
    `SELECT id, codigo, nombre, empresa_id, estado FROM empleados
     WHERE ${args.id ? "id = ?" : "codigo = ?"} LIMIT 1`,
    [args.id ?? args.codigo],
  );
  const empleado = empRows[0];
  if (!empleado) {
    console.error("No encontré ese empleado (revisa --id o --codigo).");
    await conn.end();
    process.exit(1);
  }
  if (empleado.estado !== "Activo") {
    console.warn(
      `Aviso: el empleado ${empleado.nombre} tiene estado '${empleado.estado}', no 'Activo'. ` +
        "El login del portal lo va a rechazar igual aunque tenga credencial creada.",
    );
  }

  const [yaTiene] = await conn.query(
    `SELECT username FROM colaborador_credenciales WHERE empleado_id = ? LIMIT 1`,
    [empleado.id],
  );
  if (yaTiene[0]) {
    console.log(
      `Este empleado ya tiene acceso al portal con el usuario: ${yaTiene[0].username}`,
    );
    console.log(
      "Si quieres resetear su contraseña, hazlo por la app (o dime y agrego un flag --reset a este script).",
    );
    await conn.end();
    return;
  }

  const username =
    args.username?.trim() || String(empleado.codigo).toLowerCase();
  const passwordInicial = args.password || "colab123";

  const usernameEnUso = await conn.query(
    `SELECT id FROM colaborador_credenciales WHERE username = ? LIMIT 1`,
    [username],
  );
  if (usernameEnUso[0][0]) {
    console.error(
      `El usuario '${username}' ya está en uso por otro colaborador. Pasa --username=otro`,
    );
    await conn.end();
    process.exit(1);
  }

  const { salt, passwordHash } = hashPassword(passwordInicial);
  await conn.execute(
    `INSERT INTO colaborador_credenciales
       (empleado_id, username, password_hash, salt, activo, debe_cambiar_password)
     VALUES (?, ?, ?, ?, 1, 1)`,
    [empleado.id, username, passwordHash, salt],
  );

  console.log("OK: acceso al portal creado.");
  console.log(`  Empleado:  ${empleado.nombre} (id=${empleado.id})`);
  console.log(`  Usuario:   ${username}`);
  console.log(`  Password:  ${passwordInicial}`);
  console.log("  (debe_cambiar_password = 1: se lo va a pedir cambiar en el primer login)");

  await conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
