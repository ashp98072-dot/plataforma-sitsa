import { describe, expect, it } from "vitest";
import { esPngValido, MAX_FIRMA_IMAGEN_BYTES, sha256Hex } from "./imagen-firma";

/**
 * VIATICOS-FIRMA-VISUAL — validación de la imagen PNG de la firma
 * manuscrita: magic bytes reales (nunca extensión/nombre/Content-Type del
 * cliente) + límite de tamaño específico (mucho menor que el genérico de
 * uploads.ts) + hash SHA-256 determinístico.
 */

describe("esPngValido — magic bytes reales, nunca el nombre/extensión declarado", () => {
  it("acepta un PNG real (firma 89 50 4E 47 0D 0A 1A 0A)", () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3]);
    expect(esPngValido(bytes)).toBe(true);
  });

  it("rechaza un JPEG (magic bytes FF D8 FF) aunque el nombre diga .png", () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]);
    expect(esPngValido(bytes)).toBe(false);
  });

  it("rechaza texto plano/binario arbitrario", () => {
    const bytes = new TextEncoder().encode("no soy un png, solo texto");
    expect(esPngValido(bytes)).toBe(false);
  });

  it("rechaza un buffer demasiado corto para siquiera tener la firma completa", () => {
    const bytes = new Uint8Array([137, 80, 78]);
    expect(esPngValido(bytes)).toBe(false);
  });
});

describe("sha256Hex — determinístico, 64 hex, distinto ante contenido distinto", () => {
  it("produce siempre el mismo hash para el mismo contenido", () => {
    const bytes = new TextEncoder().encode("firma-de-prueba").buffer;
    expect(sha256Hex(bytes)).toBe(sha256Hex(bytes));
    expect(sha256Hex(bytes)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("produce un hash distinto ante bytes distintos", () => {
    const a = new TextEncoder().encode("firma-A").buffer;
    const b = new TextEncoder().encode("firma-B").buffer;
    expect(sha256Hex(a)).not.toBe(sha256Hex(b));
  });
});

describe("MAX_FIRMA_IMAGEN_BYTES — mucho menor que el límite genérico de uploads.ts (50 MB)", () => {
  it("es 1 MB, no 50 MB", () => {
    expect(MAX_FIRMA_IMAGEN_BYTES).toBe(1 * 1024 * 1024);
  });
});
