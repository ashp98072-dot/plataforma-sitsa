/**
 * Empaqueta plataforma/ para Hostinger (sin node_modules / .env / .next).
 * Uso: npm run pack:hostinger
 */
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { tmpdir } from "os";
import { execFileSync } from "child_process";
import { randomBytes } from "crypto";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const outDir = join(root, "dist-hostinger");
const zipPath = join(outDir, "plataforma-sitsa.zip");
const stage = join(tmpdir(), `sitsa-pack-${randomBytes(6).toString("hex")}`);

const SKIP_NAMES = new Set([
  "node_modules",
  ".next",
  "out",
  "dist-hostinger",
  ".git",
  "coverage",
  ".vercel",
  "uploads",
]);

function copyTree(srcDir, destDir) {
  mkdirSync(destDir, { recursive: true });
  for (const name of readdirSync(srcDir)) {
    if (SKIP_NAMES.has(name)) continue;
    if (name === ".env" || name === ".env.local") continue;
    if (name.startsWith(".env.") && name !== ".env.example") continue;

    const src = join(srcDir, name);
    const dest = join(destDir, name);
    const st = statSync(src);
    if (st.isDirectory()) copyTree(src, dest);
    else cpSync(src, dest);
  }
}

function main() {
  mkdirSync(outDir, { recursive: true });
  if (existsSync(zipPath)) rmSync(zipPath, { force: true });
  if (existsSync(stage)) rmSync(stage, { recursive: true, force: true });

  copyTree(root, stage);

  writeFileSync(
    join(stage, "HOSTINGER-ENV.txt"),
    [
      "Variables en hPanel o en .builds/config/.env:",
      "",
      "DB_HOST=127.0.0.1",
      "DB_PORT=3306",
      "DB_USER=tu_usuario_mysql",
      "DB_PASSWORD=tu_password_mysql",
      "DB_NAME=tu_base_plataforma",
      "AUTH_SECRET=secreto-largo-aleatorio",
      "",
      "Importa en phpMyAdmin: sql/schema.sql y luego sql/seed-usuarios.sql",
      "Guía: DEPLOY-HOSTINGER.md",
      "",
    ].join("\n"),
  );

  if (process.platform === "win32") {
    execFileSync(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Compress-Archive -Path '${join(stage, "*")}' -DestinationPath '${zipPath}' -Force`,
      ],
      { stdio: "inherit" },
    );
  } else {
    execFileSync("zip", ["-r", zipPath, "."], { cwd: stage, stdio: "inherit" });
  }

  rmSync(stage, { recursive: true, force: true });
  console.log(`Listo: ${zipPath}`);
}

main();
