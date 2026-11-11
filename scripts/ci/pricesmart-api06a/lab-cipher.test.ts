// Prueba estática del cifrador de laboratorio: lo que cifra un proceso debe poder leerlo OTRO proceso del mismo run (hallazgo B7.2 de la ejecución 3). Sin base de datos.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { makeLabCipher } from "./lab-cipher";
import { buildChildEnv, createManifest } from "./safety.mjs";

const dir = path.dirname(fileURLToPath(import.meta.url));
const input = { schemaVersion: "api01-draft-1" as const, externalOrderId: "CRASH-COMMITTED", originClubReference: "QA-CLUB" };
const ctx = JSON.stringify(["sandbox", 1, 1, "qa-integration", "CRASH-COMMITTED"]);
const SECRET = "sandbox:api06a-test:" + "ab".repeat(32);

describe("cifrador de laboratorio: estable entre procesos del mismo run", () => {
  it("lo cifrado por una instancia lo lee otra instancia creada con el mismo secreto (simula otro proceso)", async () => {
    const sealed = await makeLabCipher(SECRET).seal(input, ctx);
    expect(sealed.keyReference).toBe("lab-key-1"); expect(Buffer.isBuffer(sealed.ciphertext)).toBe(true);
    expect(await makeLabCipher(SECRET).open(sealed.ciphertext, sealed.keyReference, ctx)).toEqual(input);
  });
  it("lo cifrado en un proceso hijo REAL de Node se lee en este proceso (el caso exacto de B7.2)", async () => {
    const script = `import { makeLabCipher } from ${JSON.stringify("file:///" + path.join(dir, "lab-cipher.ts").replace(/\\/g, "/"))};
      const s = await makeLabCipher(process.env.PS06A_TEST_SECRET).seal(${JSON.stringify(input)}, ${JSON.stringify(ctx)}); process.stdout.write(s.ciphertext.toString("hex"));`;
    // Proceso NUEVO de Node (Node 24 ejecuta .ts quitando los tipos): otra memoria, otro módulo, mismo secreto.
    const r = spawnSync(process.execPath, ["--input-type=module", "-e", script], { env: { ...process.env, PS06A_TEST_SECRET: SECRET }, encoding: "utf8", timeout: 30000 });
    expect(r.status, r.stderr).toBe(0);
    const hex = r.stdout.trim();
    expect(hex.length).toBeGreaterThan(40);
    expect(await makeLabCipher(SECRET).open(Buffer.from(hex, "hex"), "lab-key-1", ctx)).toEqual(input);
  }, 60000);
  it("un secreto distinto, un contexto distinto o una clave desconocida NO descifran", async () => {
    const sealed = await makeLabCipher(SECRET).seal(input, ctx);
    await expect(makeLabCipher(SECRET + "x").open(sealed.ciphertext, "lab-key-1", ctx)).rejects.toThrow();
    await expect(makeLabCipher(SECRET).open(sealed.ciphertext, "lab-key-1", ctx + "x")).rejects.toThrow();
    await expect(makeLabCipher(SECRET).open(sealed.ciphertext, "otra", ctx)).rejects.toThrow(/clave desconocida/);
  });
  it("cada cifrado usa un IV distinto (no determinista) y exige un secreto estable", async () => {
    const c = makeLabCipher(SECRET); const a = await c.seal(input, ctx); const b = await c.seal(input, ctx);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    for (const bad of [undefined, "", "corto"]) expect(() => makeLabCipher(bad)).toThrow(/secreto estable/);
  });
});

describe("el secreto es el mismo en TODAS las fases de un run", () => {
  it("buildChildEnv entrega el mismo AUTH_SECRET a main, crash-prepare y crash-verify; otro run recibe otro", () => {
    let i = 0; const mk = (seed: string) => createManifest({ randomBytes: (n: number) => Buffer.alloc(n, seed.charCodeAt(0) + i++), tempRoot: fs.realpathSync.native(process.env.TEMP ?? "C:\\Windows\\Temp") });
    const m = mk("a"); m.port = 50123; const base = { SystemRoot: "C:\\Windows", WINDIR: "C:\\Windows" };
    const secrets = ["main", "crash-prepare", "crash-verify"].map((phase) => buildChildEnv(m, base, { PS06A_PHASE: phase }).AUTH_SECRET);
    expect(new Set(secrets).size).toBe(1); expect(secrets[0]).toBe(m.secrets.AUTH_SECRET);
    const other = mk("z"); other.port = 50124; expect(buildChildEnv(other, base).AUTH_SECRET).not.toBe(secrets[0]);
  });
  it("mariadb-real.lab.ts usa el cifrador estable derivado de AUTH_SECRET y ya no genera una clave aleatoria por proceso", () => {
    const lab = fs.readFileSync(path.join(dir, "mariadb-real.lab.ts"), "utf8");
    expect(lab).toContain('import { makeLabCipher } from "./lab-cipher"'); expect(lab).toContain("makeLabCipher(process.env.AUTH_SECRET)");
    expect(lab).not.toMatch(/const KEY\s*=\s*randomBytes|createCipheriv|createDecipheriv/);
  });
});
