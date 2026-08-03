import { createHash, randomBytes } from "crypto";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import mysql from "mysql2/promise";
import { config } from "dotenv";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
config({ path: join(root, ".env.local") });
config({ path: join(root, ".env") });

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  const passwordHash = createHash("sha256")
    .update(salt + password, "utf8")
    .digest("hex");
  return { salt, passwordHash };
}

const EMPRESAS = [
  {
    codigo: "KT",
    nombre: "Kuiqtrans / Logiservicios Mónaco",
    slug: "kt-monaco",
    modulos: ["rrhh", "tms", "flota", "contabilidad", "gerencia", "cms"],
  },
  {
    codigo: "FRANCISCO",
    nombre: "Francisco",
    slug: "francisco",
    modulos: ["rrhh", "contabilidad", "reciclaje", "gerencia", "cms"],
  },
  {
    codigo: "TARIMAS",
    nombre: "Tarimas Center",
    slug: "tarimas",
    modulos: ["rrhh", "contabilidad", "tarimas", "gerencia", "cms"],
  },
  {
    codigo: "FRESCOFRESH",
    nombre: "Frescofresh",
    slug: "frescofresh",
    modulos: ["rrhh", "contabilidad", "gerencia", "cms"],
  },
  {
    codigo: "ECOPLANET",
    nombre: "Ecoplanet",
    slug: "ecoplanet",
    modulos: ["rrhh", "contabilidad", "reciclaje", "gerencia", "cms"],
  },
];

async function main() {
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

  const conn = await mysql.createConnection({
    host: DB_HOST,
    port: Number(DB_PORT),
    user: DB_USER,
    password: DB_PASSWORD,
    multipleStatements: true,
  });

  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.changeUser({ database: DB_NAME });

  const schema = readFileSync(join(root, "sql", "schema.sql"), "utf8");
  await conn.query(schema);

  for (const e of EMPRESAS) {
    await conn.execute(
      `INSERT INTO empresas (codigo, nombre, slug, modulos_json, activa)
       SELECT ?, ?, ?, ?, 1 FROM DUAL
       WHERE NOT EXISTS (SELECT 1 FROM empresas WHERE codigo = ?)`,
      [e.codigo, e.nombre, e.slug, JSON.stringify(e.modulos), e.codigo],
    );
    await conn.execute(
      `UPDATE empresas SET nombre = ?, slug = ?, modulos_json = ? WHERE codigo = ?`,
      [e.nombre, e.slug, JSON.stringify(e.modulos), e.codigo],
    );
  }

  const [users] = await conn.query("SELECT COUNT(*) AS c FROM usuarios");
  if (Number(users[0].c) === 0) {
    const admin = hashPassword("admin123");
    const rrhh = hashPassword("rrhh123");
    const contab = hashPassword("conta123");
    const ops = hashPassword("ops123");
    const predios = hashPassword("predios123");

    await conn.execute(
      `INSERT INTO usuarios (username, password_hash, salt, nombre, rol_global, acceso_todas_empresas, activo)
       VALUES
       ('admin', ?, ?, 'Administrador General', 'Admin', 1, 1),
       ('rrhh', ?, ?, 'Recursos Humanos', 'RRHH', 1, 1),
       ('contabilidad', ?, ?, 'Contabilidad', 'Contabilidad', 1, 1),
       ('operaciones', ?, ?, 'Operaciones KT', 'Operaciones', 0, 1),
       ('predios', ?, ?, 'Coordinador Predios', 'CoordinadorPredios', 0, 1)`,
      [
        admin.passwordHash, admin.salt,
        rrhh.passwordHash, rrhh.salt,
        contab.passwordHash, contab.salt,
        ops.passwordHash, ops.salt,
        predios.passwordHash, predios.salt,
      ],
    );

    const [emps] = await conn.query("SELECT id, codigo FROM empresas");
    const [opsUser] = await conn.query("SELECT id FROM usuarios WHERE username='operaciones'");
    const [predUser] = await conn.query("SELECT id FROM usuarios WHERE username='predios'");
    const kt = emps.find((x) => x.codigo === "KT");
    if (kt && opsUser[0]) {
      await conn.execute(
        "INSERT IGNORE INTO usuario_empresa (usuario_id, empresa_id) VALUES (?, ?)",
        [opsUser[0].id, kt.id],
      );
    }
    if (kt && predUser[0]) {
      await conn.execute(
        "INSERT IGNORE INTO usuario_empresa (usuario_id, empresa_id) VALUES (?, ?)",
        [predUser[0].id, kt.id],
      );
    }
  }

  console.log("OK: schema + empresas + usuarios iniciales");
  console.log("Usuarios: admin/admin123 | rrhh/rrhh123 | contabilidad/conta123 | operaciones/ops123 | predios/predios123");
  await conn.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
