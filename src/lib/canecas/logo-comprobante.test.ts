import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { beforeEach, describe, expect, it, vi } from "vitest";

// `empresas.logo_url` de kt-monaco apunta (en producción) al logo de KUIQTRANS: se simula con el archivo real de Kuiqtrans.
const KUIQTRANS = join(process.cwd(), "public/brands/kuiqtrans/logo-header.png");
const mocks = vi.hoisted(() => ({ ruta: "" }));
vi.mock("@/lib/uploads", () => ({ absPathFromRelative: () => mocks.ruta }));
import { LOGOS_DE_MARCA, logoDeEmpresa } from "./logo-comprobante";

const MONACO = join(process.cwd(), LOGOS_DE_MARCA["kt-monaco"]);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const bytesDe = (uri: string | null) => Buffer.from(uri!.split(",")[1], "base64");
/** Cuenta píxeles opacos rojos (logo de Mónaco) y azules (logo de Kuiqtrans). */
async function colores(archivo: Buffer) {
  const { data, info } = await sharp(archivo).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let rojo = 0, azul = 0;
  for (let i = 0; i < data.length; i += info.channels) {
    const [r, g, b, a] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
    if (a < 200) continue;
    if (r > 180 && g < 60 && b < 60) rojo++;
    if (b > r + 60 && b > g + 30) azul++;
  }
  return { rojo, azul };
}

describe("logo del comprobante de Canecas", () => {
  beforeEach(() => { mocks.ruta = KUIQTRANS; });

  it("kt-monaco muestra el logo de Logiservicios Mónaco aunque su logo_url sea el de Kuiqtrans (causa del error: el logo_url mandaba sobre la marca)", () => {
    const uri = logoDeEmpresa({ id: 1, slug: "kt-monaco", logoUrl: "empresas/1/logo-kuiqtrans.png" });
    expect(uri).toMatch(/^data:image\/png;base64,/);
    expect(bytesDe(uri).equals(readFileSync(MONACO))).toBe(true);
    expect(bytesDe(uri).equals(readFileSync(KUIQTRANS))).toBe(false);
  });
  it("el archivo usado es el logo oficial de Mónaco: huella fija, colores rojo y gris, y NINGÚN azul de Kuiqtrans", async () => {
    expect(sha(readFileSync(MONACO))).toBe("1e2064b0a202a3671c67dab0cc1f76ea8129c52ba21531fe15bcdd735f823944"); // cambiarlo exige revisar el logo a propósito
    const monaco = await colores(readFileSync(MONACO));
    expect(monaco.rojo).toBeGreaterThan(1000); expect(monaco.azul).toBe(0);
    const { width, height } = await sharp(MONACO).metadata();
    expect(width! / height!).toBeGreaterThan(3); // horizontal, como el original
    // El detector distingue: el logo de Kuiqtrans es azul y no tiene rojo.
    const k = await colores(readFileSync(KUIQTRANS)); expect(k.azul).toBeGreaterThan(1000); expect(k.rojo).toBe(0);
  });
  it("lo que se imprime para kt-monaco es Mónaco (rojo, sin azul); otra empresa con logo_url propio conserva el suyo", async () => {
    const monaco = await colores(bytesDe(logoDeEmpresa({ id: 1, slug: "kt-monaco", logoUrl: "empresas/1/x.png" })));
    expect(monaco.rojo).toBeGreaterThan(1000); expect(monaco.azul).toBe(0);
    const otra = logoDeEmpresa({ id: 7, slug: "kuiqtrans-solo", logoUrl: "empresas/7/logo.png" });
    expect(bytesDe(otra).equals(readFileSync(KUIQTRANS))).toBe(true); // su logo_url sigue funcionando
  });
  it("si falta el logo oficial de Mónaco nunca usa logo_url de Kuiqtrans como alternativa", () => {
    const previo = LOGOS_DE_MARCA["kt-monaco"];
    try {
      LOGOS_DE_MARCA["kt-monaco"] = "public/brands/monaco/archivo-inexistente-comprobante.png";
      const resultado = logoDeEmpresa({ id: 1, slug: "kt-monaco", logoUrl: "empresas/1/logo-kuiqtrans.png" });
      expect(resultado).toBeNull(); // la UI usa el nombre, no un logo ajeno
    } finally {
      LOGOS_DE_MARCA["kt-monaco"] = previo;
    }
  });
  it("una empresa sin logo propio ni de marca no toma el de otra ni el de Novalvion: devuelve null", () => {
    expect(logoDeEmpresa({ id: 7, slug: "otra-empresa", logoUrl: null })).toBeNull();
    expect(logoDeEmpresa({ id: 7, slug: "otra-empresa", logoUrl: "   " })).toBeNull();
  });
  it("un logo_url que apunta al directorio de OTRA empresa o con rutas peligrosas se ignora (no se lee fuera de uploads)", () => {
    expect(logoDeEmpresa({ id: 7, slug: "otra-empresa", logoUrl: "empresas/8/logo.png" })).toBeNull();
    expect(logoDeEmpresa({ id: 7, slug: "otra-empresa", logoUrl: "a\0b.png" })).toBeNull();
  });
});
