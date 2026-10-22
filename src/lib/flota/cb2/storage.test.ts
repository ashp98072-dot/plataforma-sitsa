import { beforeEach, afterAll, describe, it, expect } from "vitest";
import { mkdir, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { guardar, leer } from "./storage";
import { hash } from "./model";
const base = path.resolve(".lab-runtime", `storage-${randomUUID()}`);
beforeEach(async () => { process.env.UPLOAD_DIR = base; await mkdir(base, { recursive: true }); });
afterAll(async () => { if (!base.startsWith(path.resolve(".lab-runtime") + path.sep))
    throw new Error("Fuera del laboratorio"); await rm(base, { recursive: true, force: true }); delete process.env.UPLOAD_DIR; });
describe("CB2 evidencia privada", () => {
    it("guarda ruta privada aleatoria y valida hash", async () => { const b = Buffer.from("sintetico"), ruta = await guardar(1, b); expect(ruta).toMatch(/^empresas\/1\/flota\/cb2\/[a-z0-9-]+\.xlsx$/); expect(await leer(1, ruta, hash(b))).toEqual(b); expect(await readFile(path.join(base, ruta))).toEqual(b); });
    it("rechaza tenant, traversal y ruta absoluta", async () => { for (const ruta of ["../x", "empresas/2/flota/cb2/x.xlsx", path.resolve("/x")])
        await expect(leer(1, ruta, hash("x"))).rejects.toThrow(); });
    it("archivo cambiado y archivo ausente bloquean", async () => { const ruta = await guardar(1, Buffer.from("a")); await writeFile(path.join(base, ruta), "b"); await expect(leer(1, ruta, hash("a"))).rejects.toThrow("Hash"); await rm(path.join(base, ruta)); await expect(leer(1, ruta, hash("a"))).rejects.toThrow(); });
});
