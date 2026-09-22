import { beforeEach, describe, expect, it, vi } from "vitest";
import { exportarProgramacionComoImagen } from "./programacion-exportar-imagen";
import type { EncabezadoProgramacionImagen, FilaProgramacionImagen } from "@/lib/tms/programacion-imagen";

/**
 * PROGRAMACION-EXPORT-IMAGEN-1 — este módulo dibuja en un <canvas> real del
 * navegador; toda la lógica de negocio (columnas, paginación, formato de
 * cada celda) ya está probada por separado en programacion-imagen.test.ts
 * (módulo puro, sin DOM). Aquí solo se verifica la ORQUESTACIÓN: que se
 * genera un blob por página, con el tipo/nombre correctos, y que cada
 * descarga dispara un clic de verdad — con un `document`/`canvas` de
 * mentira (mismo criterio ya usado en cliente-search.test.ts para stubear
 * `document` sin una librería de DOM).
 */

function ctxFalso() {
  return {
    fillStyle: "", font: "", textBaseline: "",
    fillRect: vi.fn(), fillText: vi.fn(), strokeRect: vi.fn(), beginPath: vi.fn(), moveTo: vi.fn(), lineTo: vi.fn(), stroke: vi.fn(),
    measureText: vi.fn((s: string) => ({ width: s.length * 7 })),
  };
}

function canvasFalso() {
  const ctx = ctxFalso();
  return {
    width: 0, height: 0,
    getContext: vi.fn(() => ctx),
    toBlob: vi.fn((cb: (b: Blob | null) => void, tipo: string) => cb(new Blob(["x"], { type: tipo }))),
    _ctx: ctx,
  };
}

function montarDom() {
  const anchors: { href: string; download: string; click: ReturnType<typeof vi.fn> }[] = [];
  const body = { appendChild: vi.fn(), removeChild: vi.fn() };
  const documentoMock = {
    createElement: vi.fn((tag: string) => {
      if (tag === "canvas") return canvasFalso();
      const a = { href: "", download: "", click: vi.fn() };
      anchors.push(a);
      return a;
    }),
    body,
  };
  vi.stubGlobal("document", documentoMock);
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:x"), revokeObjectURL: vi.fn() });
  return { anchors, body };
}

const ENCABEZADO: EncabezadoProgramacionImagen = { empresa: "KuiqTrans", rango: "2026-09-22", filtros: "", generado: "22/9/2026" };
const filaDe = (placa: string): FilaProgramacionImagen => ({
  mes: "SEP", dia: "22", placa, piloto: "Juan", auxiliar1: "", auxiliar2: "",
  cliente: "Cliente", lugarCarga: "Bodega A", hora: "08:00", lugarDescarga: "Cliente B",
});

beforeEach(() => vi.unstubAllGlobals());

describe("exportarProgramacionComoImagen", () => {
  it("PNG por defecto: una descarga con extensión .png y sin sufijo de página (caso normal, una sola imagen)", async () => {
    const { anchors } = montarDom();
    const r = await exportarProgramacionComoImagen(ENCABEZADO, [filaDe("PLAN-000001")], { nombreBase: "programacion-2026-09-22" });
    expect(r.paginas).toBe(1);
    expect(anchors).toHaveLength(1);
    expect(anchors[0].download).toBe("programacion-2026-09-22.png");
    expect(anchors[0].click).toHaveBeenCalledOnce();
  });

  it("JPG: extensión .jpg", async () => {
    const { anchors } = montarDom();
    await exportarProgramacionComoImagen(ENCABEZADO, [filaDe("PLAN-000001")], { formato: "jpeg", nombreBase: "programacion" });
    expect(anchors[0].download).toBe("programacion.jpg");
  });

  it("sin viajes: igual genera una imagen (con el encabezado, tabla vacía) — nunca revienta", async () => {
    const { anchors } = montarDom();
    const r = await exportarProgramacionComoImagen(ENCABEZADO, [], { nombreBase: "programacion" });
    expect(r.paginas).toBe(1);
    expect(anchors).toHaveLength(1);
  });

  it("contenido muy largo: varias descargas, una por página, con sufijo -pagina-N-de-M", async () => {
    const { anchors } = montarDom();
    const filas = Array.from({ length: 200 }, (_, i) => filaDe(`PLAN-${String(i).padStart(6, "0")}`));
    const r = await exportarProgramacionComoImagen(ENCABEZADO, filas, { nombreBase: "programacion" });
    expect(r.paginas).toBeGreaterThan(1);
    expect(anchors).toHaveLength(r.paginas);
    expect(anchors[0].download).toBe(`programacion-pagina-1-de-${r.paginas}.png`);
    expect(anchors[anchors.length - 1].download).toBe(`programacion-pagina-${r.paginas}-de-${r.paginas}.png`);
  });

  it("cada descarga limpia el object URL después de usarlo (sin fugas de memoria)", async () => {
    montarDom();
    await exportarProgramacionComoImagen(ENCABEZADO, [filaDe("PLAN-000001")], { nombreBase: "programacion" });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:x");
  });
});
