import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ query: vi.fn(), execute: vi.fn(), getPool: vi.fn() }));
vi.mock("./geocerca", () => ({ validarGeocercaKiosko: vi.fn() }));
vi.mock("./config", () => ({ obtenerHoraEntradaDefault: vi.fn(), obtenerMinutosTolerancia: vi.fn(), obtenerToleranciaSemanal: vi.fn() }));
import { query, execute, getPool } from "@/lib/db";
import { validarGeocercaKiosko } from "./geocerca";
import { registrarMarcajePortal, registrarMarcajeKiosko } from "./marcajes";
import { hoyLocal } from "./dates";
const conn = { beginTransaction: vi.fn(), query: vi.fn(), execute: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
const foto = { relative: "empresas/3/evidencias/prueba.jpg", original: "foto.jpg", size: 10, mime: "image/jpeg" };
const emp = { id: 7, empresa_id: 3, nombre: "Prueba", estado: "Activo", hora_entrada_teorica: "07:00:00", tipo_horario: "Fijo" };
const marcar = () => registrarMarcajePortal(3, 7, { latitud: 14, longitud: -90 }, foto);
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getPool).mockReturnValue({ getConnection: async () => conn } as unknown as ReturnType<typeof getPool>);
  conn.query.mockResolvedValueOnce([[emp], []]).mockResolvedValue([[], []]);
  conn.execute.mockResolvedValue([{ affectedRows: 1, insertId: 12 }, []]);
  vi.mocked(query).mockResolvedValue([]);
  vi.mocked(validarGeocercaKiosko).mockResolvedValue({ ok: true, ubicacionId: 4 } as Awaited<ReturnType<typeof validarGeocercaKiosko>>);
});
describe("marcaje portal y fotografía atómicos", () => {
  it("identifica por sesión, bloquea empleado y confirma entrada y evidencia juntos", async () => {
    const r = await marcar();
    expect(r.ok).toBe(true);
    expect(conn.query.mock.calls[0][0]).toContain("id = ? AND empresa_id = ?");
    expect(conn.query.mock.calls[0][0]).toContain("FOR UPDATE");
    expect(conn.query.mock.calls[0][1]).toEqual([7, 3]);
    expect(validarGeocercaKiosko).toHaveBeenCalledWith(3, 7, { lat: 14, lng: -90 }, { requerirUbicacionRegistrada: true });
    expect(conn.execute.mock.calls[0][0]).toContain("INSERT INTO sesiones_trabajo");
    expect(conn.execute.mock.calls[1][0]).toContain("INSERT INTO marcaje_evidencias");
    expect(conn.execute.mock.calls[1][1].slice(0, 3)).toEqual([3, 12, "entrada"]);
    expect(conn.commit).toHaveBeenCalledOnce();
    expect(execute).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledOnce();
  });
  it("registra la foto de salida sobre la misma sesión", async () => {
    conn.query.mockReset().mockResolvedValueOnce([[emp], []]).mockResolvedValueOnce([[{ id: 12, fecha_jornada: hoyLocal() }], []]);
    const r = await marcar();
    expect(r.ok && r.tipo).toBe("Salida");
    expect(conn.execute.mock.calls[0][0]).toContain("UPDATE sesiones_trabajo");
    expect(conn.execute.mock.calls[1][1].slice(0, 3)).toEqual([3, 12, "salida"]);
  });
  it("revierte la entrada si no puede asociar la fotografía", async () => {
    conn.execute.mockImplementation(async (sql: string) => {
      if (sql.includes("marcaje_evidencias")) throw new Error("fallo simulado");
      return [{ affectedRows: 1, insertId: 12 }, []];
    });
    await expect(marcar()).rejects.toThrow("fallo simulado");
    expect(conn.rollback).toHaveBeenCalledOnce();
    expect(conn.commit).not.toHaveBeenCalled();
    expect(conn.release).toHaveBeenCalledOnce();
  });
  it("GPS fuera de área no produce escrituras", async () => {
    vi.mocked(validarGeocercaKiosko).mockResolvedValue({ ok: false, code: "FUERA_GEOCERCA", error: "Fuera" });
    expect((await marcar()).ok).toBe(false);
    expect(conn.execute).not.toHaveBeenCalled();
    expect(conn.rollback).toHaveBeenCalledOnce();
  });
  it("no admite empleado ajeno o inactivo", async () => {
    conn.query.mockReset().mockResolvedValueOnce([[], []]);
    expect((await marcar()).ok).toBe(false);
    conn.query.mockResolvedValueOnce([[{ ...emp, estado: "Baja" }], []]);
    expect((await marcar()).ok).toBe(false);
    expect(conn.execute).not.toHaveBeenCalled();
  });
  it("el kiosco conserva su validación de DPI", async () => {
    expect((await registrarMarcajeKiosko(3, { codigo: "" })).ok).toBe(false);
    expect(getPool).not.toHaveBeenCalled();
  });
});
