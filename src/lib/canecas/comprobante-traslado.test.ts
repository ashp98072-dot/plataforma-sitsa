import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { generarComprobanteTraslado, type ComprobanteTraslado } from "./comprobante-traslado";

const datos: ComprobanteTraslado = { empresa: "MONACO", numero: "TR-123", origen: "Bodega A", destino: "Bodega B", fecha: "2026-11-19 10:00", entrega: "Ana", transporte: "Luis", observaciones: "", detalles: [{ partidaId: 1, producto: "Aceite", presentacion: "Caneca", cantidad: 10 }], recepciones: [{ fecha: "2026-11-19 11:00", recibe: "Berta", condicion: "Bien", observaciones: "", partidas: [{ partidaId: 1, recibido: 9, faltante: 1, motivo: "Daño" }] }] };

describe("comprobante de traslado", () => {
  it("genera un PDF legible con el logo histórico proporcionado", async () => {
    const logo = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+nmE0AAAAASUVORK5CYII=", "base64");
    const bytes = await generarComprobanteTraslado(datos, logo);
    expect((await PDFDocument.load(bytes)).getPageCount()).toBeGreaterThan(0);
  });
  it("separa en páginas documentos extensos y rechaza un logo inválido", async () => {
    const largo = { ...datos, detalles: Array.from({ length: 200 }, (_, i) => ({ partidaId: i, producto: `Aceite ${i}`, presentacion: "Caneca", cantidad: 1 })) };
    expect((await PDFDocument.load(await generarComprobanteTraslado(largo, null))).getPageCount()).toBeGreaterThan(1);
    await expect(generarComprobanteTraslado(datos, Buffer.from("invalido"))).rejects.toThrow("LOGO_FORMATO_INVALIDO");
  });
});

