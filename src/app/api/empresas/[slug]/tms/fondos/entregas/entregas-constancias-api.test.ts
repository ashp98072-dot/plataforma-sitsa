import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * CONSTANCIAS Y EVIDENCIA ESCANEADA — endpoints (PR de follow-up de #446), con servicios mockeados. Se prueba lo propio de los
 * endpoints: puerta de permisos, empresa/actor de la sesión, 404 sin filtrar otras empresas/módulos, cabeceras seguras de la
 * descarga de evidencia, validación de ruta por empresa y contrato de la recepción presencial con evidencia o firma.
 */
const m = vi.hoisted(() => ({
  requireTenantEntregas: vi.fn(),
  leerBytesFirmaGuardada: vi.fn(),
  obtenerEntrega: vi.fn(),
  registrarRecepcionPresencial: vi.fn(),
  generarPdf: vi.fn(),
  leerEvidenciaEntrega: vi.fn(),
  validarRutaArchivoEmpresa: vi.fn(),
}));
vi.mock("@/lib/tenant", () => ({ requireTenantEntregas: m.requireTenantEntregas }));
vi.mock("@/lib/firmas/usuario-firmas", () => ({ leerBytesFirmaGuardada: m.leerBytesFirmaGuardada }));
vi.mock("@/lib/uploads", () => ({ validarRutaArchivoEmpresa: m.validarRutaArchivoEmpresa }));
vi.mock("@/lib/tms/fondos-constancia-entrega-pdf", () => ({ generarPdfConstanciaEntrega: m.generarPdf }));
vi.mock("@/lib/entregas/entregas", async () => {
  const real = await vi.importActual<typeof import("@/lib/entregas/entregas")>("@/lib/entregas/entregas");
  return { MENSAJES_ENTREGA: real.MENSAJES_ENTREGA, obtenerEntrega: m.obtenerEntrega, registrarRecepcionPresencial: m.registrarRecepcionPresencial };
});
vi.mock("@/lib/entregas/evidencia", async () => {
  const real = await vi.importActual<typeof import("@/lib/entregas/evidencia")>("@/lib/entregas/evidencia");
  return { ...real, leerEvidenciaEntrega: m.leerEvidenciaEntrega };
});

import { ErrorDominioFormulario } from "@/lib/validacion-formulario";
import type { ActorEntrega } from "@/lib/entregas/reglas";
import { GET as constanciaGET } from "./[entregaId]/constancia/route";
import { GET as evidenciaGET } from "./[entregaId]/evidencia/route";
import { POST as presencialPOST } from "./[entregaId]/presencial/route";

const EMPRESA = 7;
const actor: ActorEntrega = {
  usuarioId: 9, username: "pres", nombre: "Pedro Presencial", rol: "JefeOperaciones", esAdmin: false,
  permisos: [
    { modulo: "permisos_acciones_v2", puedeVer: true, puedeCrear: false, puedeEditar: false, puedeEliminar: false },
    { modulo: "entregas_presencial", puedeVer: true, puedeCrear: false, puedeEditar: true, puedeEliminar: false },
  ],
};
const sesionOk = { empresa: { id: EMPRESA, nombre: "SITSA" }, session: { id: 9, username: "pres", nombre: "Pedro Presencial", rol: "JefeOperaciones" }, actor };
const ctx = (entregaId = "5") => ({ params: Promise.resolve({ slug: "prueba", entregaId }) });
const entregaBase = {
  id: 5, empresaId: EMPRESA, modulo: "FONDOS", entidadId: 10, documentoCodigo: "SF-1", etapaOrigen: "OPERACIONES", etapaDestino: "TESORERIA",
  modo: "PRESENCIAL", estado: "RECIBIDA", emitidoPorUsuarioId: 4, emitidoPorNombre: "Olga", emitidoPorRol: "JefeOperaciones",
  emitidoEn: new Date("2026-10-13T16:00:00Z"), firmaEmisionId: 100, observacionesEmision: null,
  recibidoPorUsuarioId: null, recibidoPorNombre: "Juan Pérez", recibidoPorRol: null, recibidoEn: new Date("2026-10-13T17:00:00Z"), firmaRecepcionId: 101,
  observacionesRecepcion: null, recepcionOperadaPorUsuarioId: 9, recepcionOperadaPorNombre: "Pedro Presencial",
  cerradoPorUsuarioId: null, cerradoPorNombre: null, cerradoEn: null, motivoCierre: null,
};

const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0x25, 0xe2, 0xe3]);
const PNG_BYTES = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
const multipart = (campos: Record<string, string | File>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return new Request("http://localhost/x", { method: "POST", body: fd });
};
const archivo = (bytes: Uint8Array, nombre: string) => new File([bytes as BlobPart], nombre);
const sinPermiso = () => ({ error: new Response(JSON.stringify({ error: "Sin permiso para el control de entrega de documentos." }), { status: 403 }) });

const carpeta = mkdtempSync(join(tmpdir(), "entregas-evidencia-"));
afterAll(() => rmSync(carpeta, { recursive: true, force: true }));

beforeEach(() => {
  for (const f of Object.values(m)) f.mockReset();
  m.requireTenantEntregas.mockResolvedValue(sesionOk);
  m.obtenerEntrega.mockResolvedValue(entregaBase);
  m.registrarRecepcionPresencial.mockResolvedValue({ ...entregaBase });
});

describe("constancia PDF", () => {
  it("sin permiso => 403 y no se genera nada", async () => {
    m.requireTenantEntregas.mockResolvedValue(sinPermiso());
    expect((await constanciaGET(new Request("http://localhost/x"), ctx())).status).toBe(403);
    expect(m.generarPdf).not.toHaveBeenCalled();
  });

  it("empresa de la sesión; el guard acepta «ver Solicitudes de fondo» (mismo nivel que el historial)", async () => {
    m.generarPdf.mockResolvedValue({ ok: true, buffer: Buffer.from("%PDF-1.4"), nombreArchivo: "constancia-x.pdf", variante: "FINAL" });
    const res = await constanciaGET(new Request("http://localhost/x"), ctx());
    expect(res.status).toBe(200);
    expect(m.requireTenantEntregas).toHaveBeenCalledWith("prueba", { aceptaGastosVer: true });
    expect(m.obtenerEntrega).toHaveBeenCalledWith(EMPRESA, 5);
    expect(m.generarPdf).toHaveBeenCalledWith(EMPRESA, 5, "SITSA");
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("content-disposition")).toContain('attachment; filename="constancia-x.pdf"');
    expect(res.headers.get("cache-control")).toBe("private, no-store");
  });

  it("entrega inexistente, de otra empresa o de otro módulo => el mismo 404", async () => {
    for (const hallada of [null, { ...entregaBase, modulo: "GASTOS" }]) {
      m.obtenerEntrega.mockResolvedValue(hallada);
      const res = await constanciaGET(new Request("http://localhost/x"), ctx());
      expect(res.status).toBe(404);
      expect((await res.json()).error).toBe("Entrega no encontrada.");
    }
    expect(m.generarPdf).not.toHaveBeenCalled();
  });

  it("SISTEMA pendiente / RECHAZADA / ANULADA: el generador responde 409 y el endpoint lo conserva", async () => {
    m.generarPdf.mockResolvedValue({ ok: false, status: 409, error: "La constancia estará disponible cuando el receptor confirme la recepción en el sistema." });
    const res = await constanciaGET(new Request("http://localhost/x"), ctx());
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/confirme la recepción/);
  });
});

describe("evidencia escaneada", () => {
  const evidenciaEnDisco = (nombre: string, bytes: Uint8Array, mime: string) => {
    const abs = join(carpeta, nombre);
    writeFileSync(abs, bytes);
    m.leerEvidenciaEntrega.mockResolvedValue({ ruta: `empresas/${EMPRESA}/evidencias/${nombre}`, nombre, mime, tamano: bytes.length });
    m.validarRutaArchivoEmpresa.mockReturnValue(abs);
  };

  it("sin permiso => 403", async () => {
    m.requireTenantEntregas.mockResolvedValue(sinPermiso());
    expect((await evidenciaGET(new Request("http://localhost/x"), ctx())).status).toBe(403);
    expect(m.leerEvidenciaEntrega).not.toHaveBeenCalled();
  });

  it("sirve el archivo con cabeceras seguras y valida la ruta contra la carpeta de LA EMPRESA de la sesión", async () => {
    evidenciaEnDisco("c1.pdf", PDF_BYTES, "application/pdf");
    const res = await evidenciaGET(new Request("http://localhost/x"), ctx());
    expect(res.status).toBe(200);
    expect(m.leerEvidenciaEntrega).toHaveBeenCalledWith(EMPRESA, 5);
    expect(m.validarRutaArchivoEmpresa).toHaveBeenCalledWith(EMPRESA, `empresas/${EMPRESA}/evidencias/c1.pdf`);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    expect(res.headers.get("content-disposition")).toContain("inline");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(PDF_BYTES);
  });

  it("MIME fuera de la lista blanca => se sirve como binario descargable, nunca inline", async () => {
    evidenciaEnDisco("raro.bin", PNG_BYTES, "text/html");
    const res = await evidenciaGET(new Request("http://localhost/x"), ctx());
    expect(res.headers.get("content-type")).toBe("application/octet-stream");
    expect(res.headers.get("content-disposition")).toContain("attachment");
  });

  it("sin evidencia (histórico o firma dibujada) => 404 «Sin evidencia adjunta»", async () => {
    m.leerEvidenciaEntrega.mockResolvedValue(null);
    const res = await evidenciaGET(new Request("http://localhost/x"), ctx());
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe("Sin evidencia adjunta.");
  });

  it("ruta fuera de la carpeta de la empresa (traversal / otra empresa) => 404 y no se lee nada", async () => {
    m.leerEvidenciaEntrega.mockResolvedValue({ ruta: "empresas/8/evidencias/ajena.pdf", nombre: "ajena.pdf", mime: "application/pdf", tamano: 1 });
    m.validarRutaArchivoEmpresa.mockReturnValue(null);
    const res = await evidenciaGET(new Request("http://localhost/x"), ctx());
    expect(res.status).toBe(404);
    expect(m.validarRutaArchivoEmpresa).toHaveBeenCalledWith(EMPRESA, "empresas/8/evidencias/ajena.pdf");
  });

  it("entrega de otra empresa o de otro módulo => 404 sin consultar la evidencia", async () => {
    for (const hallada of [null, { ...entregaBase, modulo: "COMPRAS" }]) {
      m.obtenerEntrega.mockResolvedValue(hallada);
      expect((await evidenciaGET(new Request("http://localhost/x"), ctx())).status).toBe(404);
    }
    expect(m.leerEvidenciaEntrega).not.toHaveBeenCalled();
  });
});

describe("recepción presencial con evidencia o firma dibujada", () => {
  it("con constancia escaneada: se pasa al servicio como evidencia, sin firma; el DTO marca tieneEvidencia", async () => {
    const res = await presencialPOST(multipart({ nombreReceptor: "Juan Pérez", observaciones: "Ventanilla", evidencia: archivo(PDF_BYTES, "escaneo.pdf") }), ctx());
    expect(res.status).toBe(200);
    const llamada = m.registrarRecepcionPresencial.mock.calls[0][0];
    expect(llamada).toMatchObject({ empresaId: EMPRESA, nombreReceptor: "Juan Pérez", observaciones: "Ventanilla", firma: null });
    expect(llamada.actor).toBe(actor);
    expect(new Uint8Array(llamada.evidencia.bytes)).toEqual(PDF_BYTES);
    expect((await res.json()).entrega.tieneEvidencia).toBe(true);
  });

  it("alternativa: firma dibujada (sin evidencia)", async () => {
    const res = await presencialPOST(multipart({ nombreReceptor: "Juan", firmaImagen: archivo(PNG_BYTES, "firma.png") }), ctx());
    expect(res.status).toBe(200);
    const llamada = m.registrarRecepcionPresencial.mock.calls[0][0];
    expect(llamada.evidencia).toBeNull();
    expect(llamada.firma.origen).toBe("DIBUJADA");
    expect((await res.json()).entrega.tieneEvidencia).toBe(false);
  });

  it("ni evidencia ni firma => 400 y no se llama al servicio", async () => {
    const res = await presencialPOST(multipart({ nombreReceptor: "Juan" }), ctx());
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/Adjunta la constancia firmada/);
    expect(m.registrarRecepcionPresencial).not.toHaveBeenCalled();
  });

  it("evidencia + firma a la vez: se entregan AMBAS al servicio, que rechaza (exactamente una)", async () => {
    m.registrarRecepcionPresencial.mockRejectedValue(new ErrorDominioFormulario("Envía la constancia firmada o la firma dibujada, no ambas.", 400));
    const res = await presencialPOST(multipart({ nombreReceptor: "Juan", evidencia: archivo(PDF_BYTES, "e.pdf"), firmaImagen: archivo(PNG_BYTES, "f.png") }), ctx());
    expect(res.status).toBe(400);
    const llamada = m.registrarRecepcionPresencial.mock.calls[0][0];
    expect(llamada.evidencia).not.toBeNull();
    expect(llamada.firma).not.toBeNull();
  });

  it("archivo > 10 MB => 400 sin leerlo ni llamar al servicio", async () => {
    const enorme = new File([new Uint8Array(10 * 1024 * 1024 + 1)], "grande.pdf");
    const res = await presencialPOST(multipart({ nombreReceptor: "Juan", evidencia: enorme }), ctx());
    expect(res.status).toBe(400);
    expect(m.registrarRecepcionPresencial).not.toHaveBeenCalled();
  });

  it("la firma GUARDADA nunca se acepta en presencial", async () => {
    const res = await presencialPOST(multipart({ nombreReceptor: "Juan", usarFirmaGuardada: "true" }), ctx());
    expect(res.status).toBe(400);
    expect(m.leerBytesFirmaGuardada).not.toHaveBeenCalled();
    expect(m.registrarRecepcionPresencial).not.toHaveBeenCalled();
  });

  it("sin permiso => 403; entrega de otra empresa/módulo => 404; sin llamar al servicio", async () => {
    m.requireTenantEntregas.mockResolvedValue(sinPermiso());
    expect((await presencialPOST(multipart({ nombreReceptor: "Juan", evidencia: archivo(PDF_BYTES, "e.pdf") }), ctx())).status).toBe(403);
    m.requireTenantEntregas.mockResolvedValue(sesionOk);
    m.obtenerEntrega.mockResolvedValue(null);
    expect((await presencialPOST(multipart({ nombreReceptor: "Juan", evidencia: archivo(PDF_BYTES, "e.pdf") }), ctx())).status).toBe(404);
    expect(m.registrarRecepcionPresencial).not.toHaveBeenCalled();
  });

  it("el cliente no puede fijar empresa ni usuario", async () => {
    await presencialPOST(multipart({ nombreReceptor: "Juan", evidencia: archivo(PDF_BYTES, "e.pdf"), empresaId: "999", usuarioId: "1" }), ctx());
    const llamada = m.registrarRecepcionPresencial.mock.calls[0][0];
    expect(llamada.empresaId).toBe(EMPRESA);
    expect(llamada.actor.usuarioId).toBe(9);
  });
});
