import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { PoolConnection } from "mysql2/promise";
import { afterEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ plantilla: vi.fn(), firma: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/firmas/usuario-firmas", () => ({ leerBytesFirmaGuardada: m.plantilla }));
vi.mock("@/lib/firmas/firmas-internas", () => ({ crearFirmaInterna: m.firma }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: m.audit }));
import { capturarFirmaRolCompraTx } from "./requerimiento-firmas-captura";
import { pngFirmaFixture } from "./requerimiento-exportaciones.fixture";
import { MAX_FIRMA_IMAGEN_BYTES } from "@/lib/firmas/imagen-firma";
afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });
const conn = {} as PoolConnection;
const datos = { empresaId: 1, requerimientoId: 12, codigo: "RC-2026-000012", total: "1250.75", usuarioId: 9, nombre: "Servidor", rol: "requirente" as const, registradoPor: "Registrador" };
it("dos copias físicas independientes permanecen inmutables después de cambiar Mi firma", async () => {
  const root = await mkdtemp(join(tmpdir(), "compras-firmas-"));
  vi.stubEnv("UPLOAD_DIR", root);
  const bytes = Uint8Array.from(pngFirmaFixture).buffer;
  m.plantilla.mockResolvedValue({ bytes, original: "personal.png" });
  m.firma.mockResolvedValue({ id: 51 });
  const rutas: string[] = [];
  try {
    await capturarFirmaRolCompraTx(conn, datos, rutas);
    await capturarFirmaRolCompraTx(conn, { ...datos, usuarioId: 20, rol: "encargado" }, rutas);
    expect(new Set(rutas).size).toBe(2);
    new Uint8Array(bytes).fill(0); // Cambio posterior de plantilla nunca altera copias.
    for (const ruta of rutas) {
      const abs = resolve(root, ruta);
      expect(abs.startsWith(resolve(root, "empresas/1/firmas"))).toBe(true);
      expect(await readFile(abs)).toEqual(pngFirmaFixture);
    }
    expect(m.firma.mock.calls.map(([, d]) => d.accion)).toEqual(["REQUERIR_COMPRA", "GESTIONAR_COMPRA"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});
it.each([null, { bytes: new ArrayBuffer(10), original: "invalido.png" }, { bytes: new ArrayBuffer(MAX_FIRMA_IMAGEN_BYTES + 1), original: "grande.png" }])("plantilla no disponible/válida no bloquea, registra asociación sin imagen", async plantilla => {
  m.plantilla.mockResolvedValue(plantilla);
  const rutas: string[] = [];
  await capturarFirmaRolCompraTx(conn, datos, rutas);
  expect(rutas).toEqual([]); expect(m.firma).not.toHaveBeenCalled();
  expect(JSON.parse(m.audit.mock.calls[0][1].detalle).firmaId).toBeNull();
});
