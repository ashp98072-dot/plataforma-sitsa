import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ getPool: vi.fn(), query: vi.fn() }));
vi.mock("@/lib/uploads", () => ({ guardarUpload: vi.fn(), borrarUpload: vi.fn(), absPathFromRelative: vi.fn() }));
vi.mock("node:fs", () => ({ existsSync: vi.fn() }));
vi.mock("node:fs/promises", () => ({ readFile: vi.fn() }));

import { getPool, query } from "@/lib/db";
import { absPathFromRelative, borrarUpload, guardarUpload } from "@/lib/uploads";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  eliminarFirmaUsuario,
  guardarFirmaUsuario,
  leerBytesFirmaGuardada,
  obtenerFirmaUsuario,
} from "./usuario-firmas";

/**
 * MI-FIRMA-1 — firma manuscrita personal reutilizable, GLOBAL por
 * usuario (sin empresa_id, UNIQUE(usuario_id)). Guardar/reemplazar sigue
 * el mismo patrón atómico con compensación que autorizarViatico/
 * liquidarViatico (src/lib/tms/viaticos.ts): el archivo NUEVO se escribe
 * ANTES de abrir la transacción; si el commit no llega, se borra el
 * nuevo y se conserva el anterior; si el commit llega, se borra el
 * anterior DESPUÉS, best-effort. Nunca toca firmas_electronicas.
 */

const conn = {
  beginTransaction: vi.fn(),
  query: vi.fn(),
  execute: vi.fn(),
  commit: vi.fn(),
  rollback: vi.fn(),
  release: vi.fn(),
};
const getConnection = vi.fn();

const IMAGEN_BYTES = new TextEncoder().encode("firma-de-prueba").buffer;

const FILA_SIN_FIRMA_PREVIA: Record<string, unknown> | null = null;
const FILA_CON_FIRMA_PREVIA = { imagen_ruta: "empresas/7/firmas/perfil_usuario_3_viejo.png" };

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getPool).mockReturnValue({ getConnection } as unknown as ReturnType<typeof getPool>);
  getConnection.mockResolvedValue(conn);
  conn.execute.mockResolvedValue([{ affectedRows: 1 }, []]);
  conn.query.mockResolvedValue([FILA_SIN_FIRMA_PREVIA ? [FILA_SIN_FIRMA_PREVIA] : [], []]);
  vi.mocked(guardarUpload).mockResolvedValue({
    relative: "empresas/7/firmas/perfil_usuario_3_nuevo.png",
    original: "firma.png",
    size: 15,
  });
  vi.mocked(absPathFromRelative).mockImplementation((r: string) => `/abs/${r}`);
  vi.mocked(existsSync).mockReturnValue(true);
  vi.mocked(readFile).mockResolvedValue(Buffer.from("firma-de-prueba"));
});
afterEach(() => vi.restoreAllMocks());

describe("obtenerFirmaUsuario", () => {
  it("1) usuario sin firma -> null", async () => {
    vi.mocked(query).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof query>>);
    const r = await obtenerFirmaUsuario(3);
    expect(r).toBeNull();
  });

  it("devuelve la firma mapeada si existe", async () => {
    vi.mocked(query).mockResolvedValue([{
      id: 1, usuario_id: 3, imagen_ruta: "empresas/7/firmas/x.png", imagen_nombre_original: "firma.png",
      imagen_mime: "image/png", imagen_tamano: 15, imagen_sha256: "a".repeat(64),
      creado_en: "2026-08-29 10:00:00", actualizado_en: "2026-08-29 10:00:00",
    }] as unknown as Awaited<ReturnType<typeof query>>);
    const r = await obtenerFirmaUsuario(3);
    expect(r).toEqual(expect.objectContaining({ id: 1, usuarioId: 3, imagenRuta: "empresas/7/firmas/x.png" }));
  });
});

describe("guardarFirmaUsuario", () => {
  it("2) guarda una firma nueva (usuario sin firma previa)", async () => {
    conn.query.mockResolvedValue([[], []]); // SELECT ... FOR UPDATE -> sin fila previa
    vi.mocked(query).mockResolvedValue([{
      id: 1, usuario_id: 3, imagen_ruta: "empresas/7/firmas/perfil_usuario_3_nuevo.png",
      imagen_nombre_original: "firma.png", imagen_mime: "image/png", imagen_tamano: 15,
      imagen_sha256: "a".repeat(64), creado_en: "2026-08-29 10:00:00", actualizado_en: "2026-08-29 10:00:00",
    }] as unknown as Awaited<ReturnType<typeof query>>);

    const firma = await guardarFirmaUsuario(7, 3, { bytes: IMAGEN_BYTES, original: "firma.png" });

    expect(guardarUpload).toHaveBeenCalledWith(7, "firmas", "perfil_usuario_3", expect.objectContaining({ name: "firma.png" }));
    expect(conn.execute).toHaveBeenCalledWith(
      expect.stringContaining("ON DUPLICATE KEY UPDATE"),
      expect.arrayContaining([3, "empresas/7/firmas/perfil_usuario_3_nuevo.png", "firma.png", "image/png", 15]),
    );
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(firma.imagenRuta).toBe("empresas/7/firmas/perfil_usuario_3_nuevo.png");
    // Sin firma previa: no hay archivo anterior que borrar.
    expect(borrarUpload).not.toHaveBeenCalled();
  });

  it("5) reemplaza una firma existente y 7) borra la anterior SOLO después del commit exitoso", async () => {
    conn.query.mockResolvedValue([[FILA_CON_FIRMA_PREVIA], []]);
    vi.mocked(query).mockResolvedValue([{
      id: 1, usuario_id: 3, imagen_ruta: "empresas/7/firmas/perfil_usuario_3_nuevo.png",
      imagen_nombre_original: "firma.png", imagen_mime: "image/png", imagen_tamano: 15,
      imagen_sha256: "a".repeat(64), creado_en: "2026-08-29 10:00:00", actualizado_en: "2026-08-29 11:00:00",
    }] as unknown as Awaited<ReturnType<typeof query>>);

    await guardarFirmaUsuario(7, 3, { bytes: IMAGEN_BYTES, original: "firma.png" });

    expect(conn.commit).toHaveBeenCalledTimes(1);
    // El archivo ANTERIOR se borra (best-effort) — nunca el nuevo.
    expect(borrarUpload).toHaveBeenCalledTimes(1);
    expect(borrarUpload).toHaveBeenCalledWith("empresas/7/firmas/perfil_usuario_3_viejo.png");
  });

  it("6) si la DB falla, conserva la firma anterior y borra SOLO el archivo nuevo (compensación)", async () => {
    conn.query.mockResolvedValue([[FILA_CON_FIRMA_PREVIA], []]);
    conn.execute.mockRejectedValueOnce(new Error("DB caída"));

    await expect(guardarFirmaUsuario(7, 3, { bytes: IMAGEN_BYTES, original: "firma.png" })).rejects.toThrow("DB caída");

    expect(conn.rollback).toHaveBeenCalled();
    expect(conn.commit).not.toHaveBeenCalled();
    // Se borra el archivo NUEVO (compensación) — la ruta anterior (la
    // "vieja") NUNCA se toca, sigue siendo la firma vigente del usuario.
    expect(borrarUpload).toHaveBeenCalledTimes(1);
    expect(borrarUpload).toHaveBeenCalledWith("empresas/7/firmas/perfil_usuario_3_nuevo.png");
  });
});

describe("eliminarFirmaUsuario", () => {
  it("8) elimina la firma existente (fila + archivo)", async () => {
    conn.query.mockResolvedValue([[{ imagen_ruta: "empresas/7/firmas/perfil_usuario_3.png" }], []]);
    const r = await eliminarFirmaUsuario(3);
    expect(r.ok).toBe(true);
    expect(conn.execute).toHaveBeenCalledWith(expect.stringContaining("DELETE FROM usuario_firmas"), [3]);
    expect(conn.commit).toHaveBeenCalledTimes(1);
    expect(borrarUpload).toHaveBeenCalledWith("empresas/7/firmas/perfil_usuario_3.png");
  });

  it("ok:false si el usuario no tiene firma guardada — no intenta borrar nada", async () => {
    conn.query.mockResolvedValue([[], []]);
    const r = await eliminarFirmaUsuario(3);
    expect(r.ok).toBe(false);
    expect(conn.execute).not.toHaveBeenCalled();
    expect(borrarUpload).not.toHaveBeenCalled();
  });

  it("9) eliminar NUNCA toca firmas_electronicas — solo ejecuta DELETE sobre usuario_firmas", async () => {
    conn.query.mockResolvedValue([[{ imagen_ruta: "empresas/7/firmas/x.png" }], []]);
    await eliminarFirmaUsuario(3);
    for (const call of conn.execute.mock.calls) {
      expect(String(call[0])).not.toContain("firmas_electronicas");
    }
  });
});

describe("leerBytesFirmaGuardada", () => {
  it("devuelve los bytes actuales si el usuario tiene firma y el archivo existe", async () => {
    vi.mocked(query).mockResolvedValue([{
      id: 1, usuario_id: 3, imagen_ruta: "empresas/7/firmas/perfil_usuario_3.png", imagen_nombre_original: "firma.png",
      imagen_mime: "image/png", imagen_tamano: 15, imagen_sha256: "a".repeat(64),
      creado_en: "x", actualizado_en: "x",
    }] as unknown as Awaited<ReturnType<typeof query>>);
    const r = await leerBytesFirmaGuardada(3);
    expect(r).not.toBeNull();
    expect(r?.original).toBe("firma.png");
  });

  it("null si el usuario no tiene firma guardada", async () => {
    vi.mocked(query).mockResolvedValue([] as unknown as Awaited<ReturnType<typeof query>>);
    const r = await leerBytesFirmaGuardada(3);
    expect(r).toBeNull();
  });

  it("null si el registro existe pero el archivo ya no está en disco", async () => {
    vi.mocked(query).mockResolvedValue([{
      id: 1, usuario_id: 3, imagen_ruta: "empresas/7/firmas/perfil_usuario_3.png", imagen_nombre_original: "firma.png",
      imagen_mime: "image/png", imagen_tamano: 15, imagen_sha256: "a".repeat(64),
      creado_en: "x", actualizado_en: "x",
    }] as unknown as Awaited<ReturnType<typeof query>>);
    vi.mocked(existsSync).mockReturnValue(false);
    const r = await leerBytesFirmaGuardada(3);
    expect(r).toBeNull();
  });
});
