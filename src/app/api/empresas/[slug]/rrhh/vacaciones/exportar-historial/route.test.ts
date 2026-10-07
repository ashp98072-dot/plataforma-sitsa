import { beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ requireTenantRrhh: vi.fn(), cargarHistorialActual: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ requireTenantRrhh: m.requireTenantRrhh }));
vi.mock("@/lib/rrhh/vacaciones-historial-actual", () => ({ cargarHistorialActual: m.cargarHistorialActual }));

import { NextResponse } from "next/server";
import { GET } from "./route";
import { armarHistorialExportable } from "@/lib/rrhh/vacaciones-historial-export";
import { detectarColumnas, normalizarFilas, parsearCsv } from "@/lib/rrhh/vacaciones-historial-import";
import { leerXlsx } from "@/lib/rrhh/vacaciones-historial-xlsx";

const ctx = { params: Promise.resolve({ slug: "kt-monaco" }) };
const pet = (q = "") => new Request(`http://local/api/x/exportar-historial${q}`);
const historial = armarHistorialExportable(
  [
    { id: 1, idEmpleado: 1, inicio: "2024-06-03", fin: "2024-06-14", dias: 11, observaciones: "Boleta 1", estado: "Aprobado" },
    { id: 2, idEmpleado: 1, inicio: "2024-12-02", fin: "2024-12-13", dias: 10, observaciones: null, estado: "Aprobado" },
    { id: 3, idEmpleado: 1, inicio: "2025-03-03", fin: "2025-03-07", dias: 5, observaciones: null, estado: "Aprobado" }, // sin incidencia
  ],
  [
    { id: 11, idEmpleado: 1, tipo: "Vacaciones", inicio: "2024-06-03", fin: "2024-06-14", dias: 11 },
    { id: 12, idEmpleado: 1, tipo: "A cuenta de Vacaciones", inicio: "2024-12-02", fin: "2024-12-13", dias: 10 },
  ],
  [{ id: 1, codigo: "E-1", dpi: "2000111110101", nombre: "Ana Pérez" }],
);

beforeEach(() => {
  vi.resetAllMocks();
  m.requireTenantRrhh.mockResolvedValue({ empresa: { id: 7 }, session: { id: 3 } });
  m.cargarHistorialActual.mockResolvedValue(historial);
});

describe("GET exportar-historial", () => {
  it("exige RRHH · Vacaciones · editar; sin permiso devuelve el 403 del guard y no consulta nada", async () => {
    m.requireTenantRrhh.mockResolvedValue({ error: NextResponse.json({ error: "Sin permiso" }, { status: 403 }) });
    const r = await GET(pet(), ctx);
    expect(r.status).toBe(403);
    expect(m.requireTenantRrhh).toHaveBeenCalledWith("kt-monaco", "vacaciones", "editar");
    expect(m.cargarHistorialActual).not.toHaveBeenCalled();
  });

  it("usa la empresa de la SESIÓN y nunca una del cliente", async () => {
    await GET(pet("?formato=csv&empresa_id=999&empresaId=999"), ctx);
    expect(m.cargarHistorialActual).toHaveBeenCalledWith(7);
  });

  it("formato desconocido → 400", async () => {
    const r = await GET(pet("?formato=pdf"), ctx);
    expect(r.status).toBe(400);
    expect(m.cargarHistorialActual).not.toHaveBeenCalled();
  });

  it("CSV: descarga UTF-8 con los encabezados del importador, sin cache y con el conteo de problemas; las filas sin pareja NO salen", async () => {
    const r = await GET(pet("?formato=csv"), ctx);
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toContain("text/csv");
    expect(r.headers.get("Content-Disposition")).toMatch(/attachment; filename="historial-vacaciones-actual-kt-monaco-\d{8}\.csv"/);
    expect(r.headers.get("Cache-Control")).toContain("no-store");
    expect(r.headers.get("X-Export-Filas")).toBe("2");
    expect(r.headers.get("X-Export-Problemas")).toBe("1");
    const texto = await r.text();
    expect(texto).toContain("codigo,dpi,nombre,fecha_inicio,fecha_fin,dias_habiles,tipo,observacion");
    expect(texto).not.toContain("2025-03-03");
  });

  it("el CSV descargado se vuelve a subir sin transformación (mismo lector y normalizador del importador)", async () => {
    const r = await GET(pet("?formato=csv"), ctx);
    const { encabezados, filas } = parsearCsv(await r.text());
    const { validas, invalidas } = normalizarFilas(filas, detectarColumnas(encabezados));
    expect(invalidas).toEqual([]);
    expect(validas.map((v) => [v.codigo, v.inicio, v.fin, v.dias, v.tipo])).toEqual([
      ["E-1", "2024-06-03", "2024-06-14", 11, "Vacaciones"],
      ["E-1", "2024-12-02", "2024-12-13", 10, "A cuenta de Vacaciones"],
    ]);
  });

  it("XLSX (por defecto): hoja de historial reimportable sin transformación y encabezados de descarga correctos", async () => {
    const r = await GET(pet(), ctx);
    expect(r.status).toBe(200);
    expect(r.headers.get("Content-Type")).toContain("spreadsheetml.sheet");
    expect(r.headers.get("Content-Disposition")).toMatch(/\.xlsx"/);
    const leido = await leerXlsx(Buffer.from(await r.arrayBuffer()));
    const { validas, invalidas } = normalizarFilas(leido.filas, detectarColumnas(leido.encabezados));
    expect(invalidas).toEqual([]);
    expect(validas.map((v) => [v.codigo, v.dpi, v.inicio, v.fin, v.dias, v.tipo, v.observacion])).toEqual([
      ["E-1", "2000111110101", "2024-06-03", "2024-06-14", 11, "Vacaciones", "Boleta 1"],
      ["E-1", "2000111110101", "2024-12-02", "2024-12-13", 10, "A cuenta de Vacaciones", null],
    ]);
  });

  it("un fallo interno responde 500 sin filtrar detalles", async () => {
    m.cargarHistorialActual.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const r = await GET(pet("?formato=csv"), ctx);
    expect(r.status).toBe(500);
    expect(JSON.stringify(await r.json())).not.toContain("boom");
  });
});
