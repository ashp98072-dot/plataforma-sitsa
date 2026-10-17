import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, readdir, rename, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import sharp from "sharp";
import type { RowDataPacket } from "mysql2";
vi.mock("@/lib/db", () => ({ query: vi.fn() }));
const entorno = vi.hoisted(() => ({ root: "" }));
vi.mock("@/lib/uploads", () => ({ getUploadsRoot: () => entorno.root }));
import { query } from "@/lib/db";
import { respuestaMiniaturaEmpleado } from "./foto-empleado-miniatura";
import { respuestaFotoEmpleado } from "./foto-empleado";

let dir: string;
let original: Buffer;
const relativa = "empresas/3/documentos/foto.png";
const req = (tag?: string) => new Request("http://local/foto/miniatura", { headers: tag ? { "If-None-Match": tag } : {} });
const responder = (r = req()) => respuestaMiniaturaEmpleado(r, 3, 7);
const documento = (id = 10, ruta = relativa) => vi.mocked(query).mockResolvedValue([{ id, ruta_archivo: ruta }] as RowDataPacket[]);

beforeEach(async () => {
  vi.resetAllMocks();
  entorno.root = await mkdtemp(join(tmpdir(), "sitsa-thumb-test-"));
  dir = join(entorno.root, "empresas", "3", "documentos");
  await mkdir(dir, { recursive: true });
  original = await sharp({ create: { width: 800, height: 400, channels: 3, background: "#336699" } }).png().toBuffer();
  await writeFile(join(entorno.root, relativa), original);
  documento();
});
afterEach(async () => {
  if (!basename(entorno.root).startsWith("sitsa-thumb-test-")) throw new Error("Directorio de test inválido.");
  await rm(entorno.root, { recursive: true, force: true });
});

describe("miniatura privada con archivos reales", () => {
  it.each(["jpeg", "png", "webp"] as const)("deriva %s sin tocar original ni deformar", async (format) => {
    const bytes = await sharp(original).toFormat(format).toBuffer();
    await writeFile(join(entorno.root, relativa), bytes);
    const res = await responder();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/webp");
    const info = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
    expect(info.width).toBe(160);
    expect(info.height).toBe(80);
    expect(await readFile(join(entorno.root, relativa))).toEqual(bytes);
    expect(query).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("empresa_id = ? AND id_empleado = ?"), [3, 7]);
  });
  it("no amplía una foto pequeña", async () => {
    await writeFile(join(entorno.root, relativa), await sharp(original).resize(40, 20).png().toBuffer());
    const res = await responder();
    expect((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).width).toBe(40);
  });
  it("respeta orientación EXIF y conserva transparencia", async () => {
    await writeFile(join(entorno.root, relativa), await sharp(original).jpeg().withMetadata({ orientation: 6 }).toBuffer());
    const rotated = await sharp(Buffer.from(await (await responder()).arrayBuffer())).metadata();
    expect([rotated.width, rotated.height]).toEqual([80, 160]);
    documento(11);
    await writeFile(join(entorno.root, relativa), await sharp({ create: { width: 80, height: 40, channels: 4, background: { r: 10, g: 20, b: 30, alpha: 0.5 } } }).png().toBuffer());
    expect((await sharp(Buffer.from(await (await responder()).arrayBuffer())).metadata()).hasAlpha).toBe(true);
  });
  it("reutiliza el archivo generado sin regenerar en cada request", async () => {
    const a = await responder();
    const cache = join(dir, ".miniaturas");
    const [name] = await readdir(cache);
    const file = join(cache, name);
    const fecha = new Date("2020-01-01T00:00:00Z");
    await utimes(file, fecha, fecha);
    const b = await responder();
    expect(b.headers.get("ETag")).toBe(a.headers.get("ETag"));
    expect((await stat(file)).mtimeMs).toBe(fecha.getTime());
    expect(await readdir(cache)).toEqual([name]);
  });
  it("genera una sola salida ante concurrencia y no deja temporales", async () => {
    const respuestas = await Promise.all([responder(), responder(), responder()]);
    expect(respuestas.every((r) => r.status === 200)).toBe(true);
    expect(await readdir(join(dir, ".miniaturas"))).toHaveLength(1);
  });
  it("ETag/304 privado sin cuerpo, también acepta lista y validación débil", async () => {
    const first = await responder();
    const tag = first.headers.get("ETag")!;
    const res = await responder(req('"otro", ' + tag.replace(/^W\//, "")));
    expect(res.status).toBe(304);
    expect(await res.text()).toBe("");
    expect(res.headers.get("Cache-Control")).toBe("private, no-cache");
    expect(res.headers.get("Vary")).toBe("Cookie");
    expect(res.headers.get("ETag")).toBe(tag);
  });
  it("cambiar documento/foto invalida el ETag y conserva archivos originales", async () => {
    const a = await responder();
    const nueva = "empresas/3/documentos/nueva.webp";
    await writeFile(join(entorno.root, nueva), await sharp(original).negate().webp().toBuffer());
    documento(11, nueva);
    const b = await responder(req(a.headers.get("ETag")!));
    expect(b.status).toBe(200);
    expect(b.headers.get("ETag")).not.toBe(a.headers.get("ETag"));
    expect(await readFile(join(entorno.root, relativa))).toEqual(original);
  });
  it("archivo cambiado dentro del mismo documento invalida derivado", async () => {
    const a = await responder();
    await writeFile(join(entorno.root, relativa), await sharp(original).resize(600, 300).png().toBuffer());
    const b = await responder(req(a.headers.get("ETag")!));
    expect(b.status).toBe(200);
    expect(b.headers.get("ETag")).not.toBe(a.headers.get("ETag"));
  });
  it("sin foto responde 404 no cacheable, aunque se envíe If-None-Match", async () => {
    vi.mocked(query).mockResolvedValue([]);
    const res = await responder(req("*"));
    expect(res.status).toBe(404);
    expect(res.headers.get("Cache-Control")).toContain("no-store");
  });
  it("foto borrada no se sirve desde un derivado previo", async () => {
    const a = await responder();
    await rm(join(entorno.root, relativa));
    expect((await responder(req(a.headers.get("ETag")!))).status).toBe(404);
  });
  it("rechaza ruta de otra empresa antes de leerla", async () => {
    documento(10, "empresas/4/documentos/foto.png");
    await expect(responder()).rejects.toThrow("Ruta de miniatura inválida");
  });
  it("rechaza un directorio derivado enlazado fuera del tenant", async () => {
    const fuera = join(entorno.root, "otra-empresa");
    await mkdir(fuera);
    await symlink(fuera, join(dir, ".miniaturas"), process.platform === "win32" ? "junction" : "dir");
    await expect(responder()).rejects.toThrow("Ruta de miniatura inválida");
  });
  it("rechaza también el directorio documentos si apunta fuera del tenant", async () => {
    await rename(dir, join(entorno.root, "documentos-respaldo"));
    const fuera = join(entorno.root, "documentos-otra-empresa");
    await mkdir(fuera);
    await writeFile(join(fuera, "foto.png"), original);
    await symlink(fuera, dir, process.platform === "win32" ? "junction" : "dir");
    await expect(responder()).rejects.toThrow("Ruta de miniatura inválida");
  });
  it("fallo de decode no publica archivos parciales; permite reintentar", async () => {
    await writeFile(join(entorno.root, relativa), Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    await expect(responder()).rejects.toThrow();
    expect(await readdir(join(dir, ".miniaturas"))).toEqual([]);
    await writeFile(join(entorno.root, relativa), original);
    expect((await responder()).status).toBe(200);
  });
  it("medición reproducible: original vs derivado frío/caliente y 304", async () => {
    const pixels = Buffer.alloc(1024 * 768 * 3);
    let seed = 12345;
    for (let i = 0; i < pixels.length; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      pixels[i] = seed >>> 24;
    }
    const bytes = await sharp(pixels, { raw: { width: 1024, height: 768, channels: 3 } }).jpeg({ quality: 90 }).toBuffer();
    await writeFile(join(entorno.root, relativa), bytes);
    const start = performance.now();
    const base = await respuestaFotoEmpleado(3, 7);
    const originalBytes = (await base.arrayBuffer()).byteLength;
    const baseMs = performance.now() - start;
    const cold = performance.now();
    const first = await responder();
    const thumbBytes = (await first.arrayBuffer()).byteLength;
    const coldMs = performance.now() - cold;
    const warm = performance.now();
    const second = await responder();
    const warmMs = performance.now() - warm;
    const validation = await responder(req(first.headers.get("ETag")!));
    expect(originalBytes).toBe(bytes.length);
    expect(thumbBytes).toBeLessThan(originalBytes / 10);
    expect((await second.arrayBuffer()).byteLength).toBe(thumbBytes);
    expect(validation.status).toBe(304);
    expect((await validation.arrayBuffer()).byteLength).toBe(0);
    expect(query).toHaveBeenCalledTimes(4); // Una consulta de documento por helper en BASE/HEAD; guards aparte.
    console.info("MEDICION_THUMB", JSON.stringify({ originalBytes, thumbBytes, body304: 0, baseMs, coldMs, warmMs }));
  });
});
