import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { crearFirmaInterna, payloadCanonicoJson, TEXTO_FIRMA_INTERNA } from "./firmas-internas";

/**
 * VIATICOS-FIRMA — pruebas de la base de firma electrónica interna
 * (activación del diseño de PORTAL-HARDENING-2, tabla firmas_electronicas
 * ya aplicada manualmente). No se prueba aquí la decisión de negocio de
 * autorizar/liquidar (eso vive en src/lib/tms/viaticos.test.ts) — solo el
 * mecanismo genérico de creación de firma.
 */

describe("payloadCanonicoJson — claves ordenadas alfabéticamente, sin espacios", () => {
  it("ordena claves de primer nivel sin importar el orden de inserción", () => {
    const json = payloadCanonicoJson({ zeta: 1, alfa: 2, beta: 3 });
    expect(json).toBe('{"alfa":2,"beta":3,"zeta":1}');
  });

  it("ordena recursivamente objetos anidados", () => {
    const json = payloadCanonicoJson({ b: { z: 1, a: 2 }, a: 1 });
    expect(json).toBe('{"a":1,"b":{"a":2,"z":1}}');
  });

  it("nunca produce espacios (JSON.stringify sin indent)", () => {
    const json = payloadCanonicoJson({ a: 1, b: 2 });
    expect(json).not.toMatch(/\s/);
  });
});

describe("TEXTO_FIRMA_INTERNA — nunca términos de firma legal/certificada", () => {
  it("es el texto simbólico aprobado, no 'Firma Electrónica Avanzada'/certificado/PSC/legal", () => {
    expect(TEXTO_FIRMA_INTERNA).toBe("Firma electrónica interna");
    expect(TEXTO_FIRMA_INTERNA.toLowerCase()).not.toContain("avanzada");
    expect(TEXTO_FIRMA_INTERNA.toLowerCase()).not.toContain("certificad");
    expect(TEXTO_FIRMA_INTERNA.toLowerCase()).not.toContain("legal");
    expect(TEXTO_FIRMA_INTERNA.toLowerCase()).not.toContain("psc");
  });
});

describe("crearFirmaInterna — inserta la firma con hash/fecha/código", () => {
  const conn = { execute: vi.fn() };

  beforeEach(() => {
    vi.resetAllMocks();
    conn.execute.mockResolvedValue([{ insertId: 55, affectedRows: 1 }, []]);
  });
  afterEach(() => vi.restoreAllMocks());

  it("19) fecha_hora_servidor viene del RELOJ DEL SERVIDOR (new Date()), nunca de un valor externo — DatosFirmaInterna ni siquiera acepta un campo de fecha", async () => {
    const antes = Date.now();
    const r = await crearFirmaInterna(conn as never, {
      empresaId: 7, usuarioId: 3, empleadoId: null,
      nombreFirmante: "Ana López", rolFirmante: "JefeOperaciones",
      accion: "AUTORIZAR_VIATICO", modulo: "VIATICOS", entidadTipo: "VIATICO", entidadId: 10,
      valoresRelevantes: { viaticoId: 10 },
    });
    const despues = Date.now();
    expect(r.fechaHoraServidor.getTime()).toBeGreaterThanOrEqual(antes);
    expect(r.fechaHoraServidor.getTime()).toBeLessThanOrEqual(despues);
  });

  it("6/16) por defecto (sin `metodo` explícito) inserta metodo=PASSWORD, resultado=EXITOSA, y devuelve codigoFirma/hashPayload", async () => {
    const r = await crearFirmaInterna(conn as never, {
      empresaId: 7, usuarioId: 3, empleadoId: null,
      nombreFirmante: "Ana López", rolFirmante: "JefeOperaciones",
      accion: "AUTORIZAR_VIATICO", modulo: "VIATICOS", entidadTipo: "VIATICO", entidadId: 10,
      valoresRelevantes: { viaticoId: 10, montoAsignado: 500 },
    });
    expect(r.codigoFirma).toMatch(/^SIG-\d{8}-[0-9A-F]{8}$/);
    expect(r.hashPayload).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
    expect(r.nombreFirmante).toBe("Ana López");
    expect(r.rolFirmante).toBe("JefeOperaciones");

    const [sql, params] = conn.execute.mock.calls[0];
    expect(String(sql)).toContain("INSERT INTO firmas_electronicas");
    expect(String(sql)).toContain("'EXITOSA'");
    expect(params).toEqual(expect.arrayContaining([7, 3, null, "AUTORIZAR_VIATICO", "VIATICOS", "VIATICO", 10, "PASSWORD"]));
  });

  it("CORRECCIÓN URGENTE — metodo: 'FIRMA_MANUSCRITA' explícito se inserta tal cual (autorizarViatico lo usa desde este hotfix)", async () => {
    await crearFirmaInterna(conn as never, {
      empresaId: 7, usuarioId: 3, empleadoId: null,
      nombreFirmante: "Ana López", rolFirmante: "JefeOperaciones",
      accion: "AUTORIZAR_VIATICO", modulo: "VIATICOS", entidadTipo: "VIATICO", entidadId: 10,
      valoresRelevantes: { viaticoId: 10 },
      metodo: "FIRMA_MANUSCRITA",
    });
    const [, params] = conn.execute.mock.calls[0];
    expect(params).toContain("FIRMA_MANUSCRITA");
    expect(params).not.toContain("PASSWORD");
  });

  it("8) registra empresa/usuario/acción/entidad tal cual se le pasan (payload_canonico incluye nombreFirmante/rolFirmante como snapshot histórico)", async () => {
    await crearFirmaInterna(conn as never, {
      empresaId: 9, usuarioId: 42, empleadoId: null,
      nombreFirmante: "Marta Ruiz", rolFirmante: "Facturador",
      accion: "LIQUIDAR_VIATICO", modulo: "VIATICOS", entidadTipo: "VIATICO", entidadId: 77,
      valoresRelevantes: { viaticoId: 77, diferencia: "0.00" },
    });
    const [, params] = conn.execute.mock.calls[0];
    const payloadCanonico = params[9] as string;
    const payload = JSON.parse(payloadCanonico);
    expect(payload.nombreFirmante).toBe("Marta Ruiz");
    expect(payload.rolFirmante).toBe("Facturador");
    expect(payload.entidadId).toBe(77);
    expect(payload.empresaId).toBe(9);
  });
});

/**
 * VIATICOS-FIRMA-VISUAL — la imagen manuscrita se inserta EN EL MISMO
 * INSERT que crea la firma (nunca un UPDATE posterior, ver JSDoc de
 * crearFirmaInterna) y su SHA-256 entra al payload_canonico como
 * `imagenSha256` — nunca se guarda base64/binario en MySQL.
 */
describe("crearFirmaInterna — imagen manuscrita (VIATICOS-FIRMA-VISUAL)", () => {
  const conn = { execute: vi.fn() };

  beforeEach(() => {
    vi.resetAllMocks();
    conn.execute.mockResolvedValue([{ insertId: 55, affectedRows: 1 }, []]);
  });
  afterEach(() => vi.restoreAllMocks());

  const imagen = {
    relative: "empresas/7/firmas/firma_viatico_autorizar_10_x.png",
    original: "firma.png",
    mime: "image/png",
    size: 4096,
    sha256: "b".repeat(64),
  };

  it("inserta imagen_ruta/imagen_nombre_original/imagen_mime/imagen_tamano en el MISMO INSERT (no hay UPDATE posterior) y devuelve tieneImagen: true", async () => {
    const r = await crearFirmaInterna(conn as never, {
      empresaId: 7, usuarioId: 3, empleadoId: null,
      nombreFirmante: "Ana López", rolFirmante: "JefeOperaciones",
      accion: "AUTORIZAR_VIATICO", modulo: "VIATICOS", entidadTipo: "VIATICO", entidadId: 10,
      valoresRelevantes: { viaticoId: 10 },
      imagen,
    });
    expect(r.tieneImagen).toBe(true);
    expect(conn.execute).toHaveBeenCalledTimes(1); // un solo INSERT, nunca un UPDATE aparte
    const [sql, params] = conn.execute.mock.calls[0];
    expect(String(sql)).toContain("imagen_ruta");
    expect(String(sql)).toContain("imagen_nombre_original");
    expect(String(sql)).toContain("imagen_mime");
    expect(String(sql)).toContain("imagen_tamano");
    expect(params).toEqual(expect.arrayContaining([imagen.relative, imagen.original, imagen.mime, imagen.size]));
  });

  it("el SHA-256 de la imagen queda dentro del payload_canonico como imagenSha256 (nunca base64/binario)", async () => {
    await crearFirmaInterna(conn as never, {
      empresaId: 7, usuarioId: 3, empleadoId: null,
      nombreFirmante: "Ana López", rolFirmante: "JefeOperaciones",
      accion: "AUTORIZAR_VIATICO", modulo: "VIATICOS", entidadTipo: "VIATICO", entidadId: 10,
      valoresRelevantes: { viaticoId: 10 },
      imagen,
    });
    const [, params] = conn.execute.mock.calls[0];
    const payloadCanonico = params[9] as string;
    const payload = JSON.parse(payloadCanonico);
    expect(payload.imagenSha256).toBe(imagen.sha256);
    expect(payloadCanonico).not.toContain("base64");
    expect(payloadCanonico.length).toBeLessThan(1000); // nunca lleva el binario/base64 de la imagen
  });

  it("sin imagen (imagen: null/undefined): imagen_* quedan NULL, imagenSha256 es null, tieneImagen: false", async () => {
    const r = await crearFirmaInterna(conn as never, {
      empresaId: 7, usuarioId: 3, empleadoId: null,
      nombreFirmante: "Ana López", rolFirmante: "JefeOperaciones",
      accion: "AUTORIZAR_VIATICO", modulo: "VIATICOS", entidadTipo: "VIATICO", entidadId: 10,
      valoresRelevantes: { viaticoId: 10 },
    });
    expect(r.tieneImagen).toBe(false);
    const [, params] = conn.execute.mock.calls[0];
    expect(params.slice(-4)).toEqual([null, null, null, null]);
    const payload = JSON.parse(params[9] as string);
    expect(payload.imagenSha256).toBeNull();
  });
});
