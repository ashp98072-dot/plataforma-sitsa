import { execFileSync } from "child_process";
import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";
import { cifrarSecretoFel, descifrarSecretoFel, ErrorConfigFel } from "./credenciales";
import { estadoTrasResultado, type ResultadoProveedorEstado } from "./estados";
import { huellaDe, serializarCanonico } from "./huella";
import { construirDtoCorrectivo, construirDtoFactura, type FacturaParaFel } from "./mapper";
import { MockFelProvider } from "./providers/mock";
import { MARCA_REDACTADO, redactar } from "./redaccion";
import type { ContextoProveedor } from "./provider";
import type { EstadoDocumentoFel } from "./tipos";

const ctx: ContextoProveedor = { ambiente: "TEST", proveedor: "MOCK", baseUrl: null, nitEmisor: null, secreto: null };
const dto = { version: 1 } as never;

function listar(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? listar(p) : [p];
  });
}
const fuentesFel = () => listar("src/lib/fel").filter((p) => p.endsWith(".ts") && !p.endsWith(".test.ts"));
const sinComentarios = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
const leerFuente = (p: string) => sinComentarios(readFileSync(p, "utf8"));

describe("FEL-2A · máquina de estados", () => {
  const todos: ResultadoProveedorEstado[] = ["CERTIFICADO", "RECHAZADO", "PENDIENTE", "NO_ENCONTRADO", "INCIERTO", "ERROR_CONFIG"];

  it("los estados finales nunca se mueven", () => {
    for (const final of ["CERTIFICADO", "RECHAZADO", "ANULADO"] as EstadoDocumentoFel[]) {
      for (const r of todos) for (const o of ["CERTIFICAR", "CONSULTAR"] as const) expect(estadoTrasResultado(final, o, r)).toBeNull();
    }
  });

  it("NO_ENCONTRADO solo nace de una consulta; al certificar es incertidumbre", () => {
    expect(estadoTrasResultado("INCIERTO", "CONSULTAR", "NO_ENCONTRADO")).toBe("NO_ENCONTRADO");
    expect(estadoTrasResultado("PENDIENTE", "CONSULTAR", "NO_ENCONTRADO")).toBe("NO_ENCONTRADO");
    expect(estadoTrasResultado("PENDIENTE", "CERTIFICAR", "NO_ENCONTRADO")).toBe("INCIERTO");
  });

  it("timeout/ERROR_CONFIG nunca equivalen a RECHAZADO ni a NO_ENCONTRADO", () => {
    for (const o of ["CERTIFICAR", "CONSULTAR"] as const) {
      expect(estadoTrasResultado("PENDIENTE", o, "INCIERTO")).toBe("INCIERTO");
      expect(estadoTrasResultado("PENDIENTE", o, "ERROR_CONFIG")).toBe("INCIERTO");
    }
  });

  it("PENDIENTE del proveedor conserva INCIERTO; CERTIFICADO/RECHAZADO resuelven", () => {
    expect(estadoTrasResultado("INCIERTO", "CONSULTAR", "PENDIENTE")).toBe("INCIERTO");
    expect(estadoTrasResultado("PENDIENTE", "CONSULTAR", "PENDIENTE")).toBe("PENDIENTE");
    expect(estadoTrasResultado("INCIERTO", "CONSULTAR", "CERTIFICADO")).toBe("CERTIFICADO");
    expect(estadoTrasResultado("PENDIENTE", "CERTIFICAR", "RECHAZADO")).toBe("RECHAZADO");
    expect(estadoTrasResultado("NO_ENCONTRADO", "CERTIFICAR", "CERTIFICADO")).toBe("CERTIFICADO");
  });
});

describe("FEL-2A · proveedor MOCK determinista y sin red", () => {
  it("certifica de forma determinista y marca la identidad como MOCK", async () => {
    const a = new MockFelProvider();
    const r1 = await a.certificar({ contexto: ctx, referenciaEmisor: "ref-1", tipo: "FACTURA", dto });
    const r2 = await new MockFelProvider().certificar({ contexto: ctx, referenciaEmisor: "ref-1", tipo: "FACTURA", dto });
    expect(r1.tipo).toBe("CERTIFICADO");
    expect(r1).toEqual(r2);
    if (r1.tipo === "CERTIFICADO") expect(r1.autorizacion.startsWith("MOCK-")).toBe(true);
  });

  it("reproduce rechazo, timeout, respuesta perdida, pendiente, error de config y excepción", async () => {
    const quien = async (escenario: ConstructorParameters<typeof MockFelProvider>[0]) =>
      new MockFelProvider(escenario).certificar({ contexto: ctx, referenciaEmisor: "r", tipo: "FACTURA", dto });
    expect((await quien({ certificar: "RECHAZA" })).tipo).toBe("RECHAZADO");
    expect((await quien({ certificar: "TIMEOUT_ANTES_DE_PROCESAR" })).tipo).toBe("INCIERTO");
    expect((await quien({ certificar: "PROCESA_Y_PIERDE_RESPUESTA" })).tipo).toBe("INCIERTO");
    expect((await quien({ certificar: "PENDIENTE" })).tipo).toBe("PENDIENTE");
    expect((await quien({ certificar: "ERROR_CONFIG" })).tipo).toBe("ERROR_CONFIG");
    await expect(quien({ certificar: "LANZA_EXCEPCION" })).rejects.toThrow();
  });

  it("la consulta refleja el remoto: certificado, pendiente y no encontrado; el timeout previo no cambia el remoto", async () => {
    const m = new MockFelProvider({ certificar: "TIMEOUT_ANTES_DE_PROCESAR" });
    await m.certificar({ contexto: ctx, referenciaEmisor: "a", tipo: "FACTURA", dto });
    expect((await m.consultar({ contexto: ctx, referenciaEmisor: "a" })).tipo).toBe("NO_ENCONTRADO");
    m.programar({ certificar: "PROCESA_Y_PIERDE_RESPUESTA" });
    await m.certificar({ contexto: ctx, referenciaEmisor: "b", tipo: "FACTURA", dto });
    expect((await m.consultar({ contexto: ctx, referenciaEmisor: "b" })).tipo).toBe("CERTIFICADO");
    m.programar({ certificar: "PENDIENTE" });
    await m.certificar({ contexto: ctx, referenciaEmisor: "c", tipo: "FACTURA", dto });
    expect((await m.consultar({ contexto: ctx, referenciaEmisor: "c" })).tipo).toBe("PENDIENTE");
    m.resolverPendientes();
    expect((await m.consultar({ contexto: ctx, referenciaEmisor: "c" })).tipo).toBe("CERTIFICADO");
  });

  it("anulación: el MOCK reproduce «procesó y perdió la respuesta» (el remoto queda ANULADO, la respuesta es INCIERTO)", async () => {
    const m = new MockFelProvider({ anular: "PROCESA_Y_PIERDE_RESPUESTA" });
    await m.certificar({ contexto: ctx, referenciaEmisor: "z", tipo: "FACTURA", dto });
    const r = await m.anular({ contexto: ctx, referenciaEmisor: "z", autorizacion: "A", motivo: "motivo de prueba" });
    expect(r.tipo).toBe("INCIERTO");
    expect(m.remoto.get("z")?.estado).toBe("ANULADO");
    // La consulta de certificación NO expone ANULADO: el contrato neutral no puede reconciliar una anulación.
    const c = await m.consultar({ contexto: ctx, referenciaEmisor: "z" });
    expect(["CERTIFICADO", "PENDIENTE", "NO_ENCONTRADO", "RECHAZADO", "INCIERTO", "ERROR_CONFIG"]).toContain(c.tipo);
  });

  it("el remoto idempotente no duplica certificaciones; el no idempotente las cuenta (peor caso)", async () => {
    const ok = new MockFelProvider();
    await ok.certificar({ contexto: ctx, referenciaEmisor: "x", tipo: "FACTURA", dto });
    await ok.certificar({ contexto: ctx, referenciaEmisor: "x", tipo: "FACTURA", dto });
    expect(ok.certificacionesEfectivas).toBe(1);
    const peor = new MockFelProvider({ remotoIdempotente: false });
    await peor.certificar({ contexto: ctx, referenciaEmisor: "x", tipo: "FACTURA", dto });
    await peor.certificar({ contexto: ctx, referenciaEmisor: "x", tipo: "FACTURA", dto });
    expect(peor.certificacionesEfectivas).toBe(2);
  });

  it("el MOCK y el resto de src/lib/fel no usan red (fetch/http/https/axios/net/undici/XMLHttpRequest)", () => {
    const prohibidos = /\bfetch\s*\(|from\s+["'](node:)?(https?|net|tls|dgram|dns)["']|require\(\s*["'](node:)?(https?|net)["']\)|axios|undici|XMLHttpRequest|WebSocket|got\(/;
    for (const f of fuentesFel()) expect(leerFuente(f), f).not.toMatch(prohibidos);
  });
});

describe("FEL-2A · mapper neutral con bloqueos estructurados", () => {
  const base: FacturaParaFel = {
    facturaId: 1, empresaId: 7, entidadId: 9, estadoAdmin: "Borrador", moneda: "GTQ", fechaEmision: "2026-10-13", montoTotal: "112.00",
    retencionIvaPct: 0,
    cliente: { razonSocial: "Cliente de prueba", nit: "NIT-PRUEBA", email: null, direccion: null },
    lineas: [{ orden: 1, descripcion: "Servicio", cantidad: "1", precioUnitario: "100", clasificacion: "SERVICIO", precioIncluyeIva: false, porcentajeIva: "12", base: "100.00", iva: "12.00", total: "112.00" }],
    emisor: { nit: "NIT-EMISOR", nombreFiscal: "Emisor de prueba" },
  };
  const codigos = (f: FacturaParaFel) => {
    const r = construirDtoFactura(f);
    return r.ok ? [] : r.bloqueos.map((b) => b.codigo);
  };

  it("construye el DTO con importes de 2 decimales y sin campos fiscales inventados", () => {
    const r = construirDtoFactura(base);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dto.totales).toEqual({ base: "100.00", iva: "12.00", total: "112.00" });
    expect(r.dto.tipo).toBe("FACTURA");
    const claves = JSON.stringify(Object.keys(r.dto)) + JSON.stringify(Object.keys(r.dto.emisor)) + JSON.stringify(Object.keys(r.dto.receptor));
    expect(claves).not.toMatch(/regimen|frase|establecimiento|afiliacion|adenda|unidadMedida|FCAM|FACT"/i);
  });

  it("bloquea (sin DTO) cuando falta un dato o la regla no está decidida", () => {
    expect(codigos({ ...base, estadoAdmin: "Emitida" })).toContain("FACTURA_NO_BORRADOR");
    expect(codigos({ ...base, estadoAdmin: "Anulada" })).toContain("FACTURA_NO_BORRADOR");
    expect(codigos({ ...base, entidadId: null })).toContain("ENTIDAD_NO_ASIGNADA");
    expect(codigos({ ...base, moneda: "USD" })).toContain("MONEDA_NO_SOPORTADA");
    expect(codigos({ ...base, retencionIvaPct: 15 })).toContain("RETENCION_NO_SOPORTADA");
    expect(codigos({ ...base, fechaEmision: null })).toContain("FECHA_FALTANTE");
    expect(codigos({ ...base, lineas: [] })).toContain("SIN_LINEAS");
    expect(codigos({ ...base, emisor: { nit: null, nombreFiscal: null } })).toContain("EMISOR_SIN_DATOS_FISCALES");
    expect(codigos({ ...base, cliente: { ...base.cliente, nit: " " } })).toContain("RECEPTOR_SIN_NIT");
    expect(codigos({ ...base, cliente: { ...base.cliente, razonSocial: null } })).toContain("RECEPTOR_SIN_NOMBRE_FISCAL");
  });

  it("clasificación nula e importes que no cuadran bloquean", () => {
    expect(codigos({ ...base, lineas: [{ ...base.lineas[0], clasificacion: null }] })).toContain("CLASIFICACION_NO_INEQUIVOCA");
    expect(codigos({ ...base, lineas: [{ ...base.lineas[0], total: "113.00" }] })).toContain("IMPORTES_INCONSISTENTES");
    expect(codigos({ ...base, montoTotal: "200.00" })).toContain("IMPORTES_INCONSISTENTES");
    expect(codigos({ ...base, lineas: [{ ...base.lineas[0], base: null }] })).toContain("IMPORTES_INCONSISTENTES");
  });

  it("no usa el nombre comercial como respaldo del nombre fiscal del receptor", () => {
    expect(codigos({ ...base, cliente: { razonSocial: "   ", nit: "N", email: null, direccion: null } })).toContain("RECEPTOR_SIN_NOMBRE_FISCAL");
  });

  it("documento correctivo: copia emisor/receptor, referencia el origen y exige importes coherentes", () => {
    const o = construirDtoFactura(base);
    if (!o.ok) throw new Error("fixture");
    const identidad = { autorizacion: "MOCK-1", serie: "MOCK", numero: "1", fechaCertificacion: "2026-10-13T12:00:00.000Z" };
    const ok = construirDtoCorrectivo({ dto: o.dto, documentoId: 5, identidad }, "NOTA_CREDITO", " Ajuste ", { base: "10.00", iva: "1.20", total: "11.20" }, "2026-10-14");
    expect(ok.ok && ok.dto.referenciaOrigen).toMatchObject({ documentoId: 5, autorizacion: "MOCK-1" });
    expect(ok.ok && ok.dto.motivo).toBe("Ajuste");
    const mal = construirDtoCorrectivo({ dto: o.dto, documentoId: 5, identidad }, "NOTA_DEBITO", "x", { base: "10.00", iva: "1.00", total: "20.00" }, "2026-10-14");
    expect(mal.ok).toBe(false);
  });
});

describe("FEL-2A · secretos, redacción y huellas", () => {
  const ambito = { empresaId: 7, entidadId: 9, ambiente: "TEST" as const };
  afterEach(() => {
    delete process.env.FEL_CREDENTIALS_KEY;
  });

  it("sin FEL_CREDENTIALS_KEY el error es claro y NO usa AUTH_SECRET como respaldo", () => {
    delete process.env.FEL_CREDENTIALS_KEY;
    process.env.AUTH_SECRET = "a".repeat(64);
    expect(() => cifrarSecretoFel("valor", ambito)).toThrow(ErrorConfigFel);
    expect(() => cifrarSecretoFel("valor", ambito)).toThrow(/FEL_CREDENTIALS_KEY/);
    process.env.FEL_CREDENTIALS_KEY = "corta";
    expect(() => cifrarSecretoFel("valor", ambito)).toThrow(ErrorConfigFel);
  });

  it("el error no filtra la clave ni el secreto", () => {
    process.env.FEL_CREDENTIALS_KEY = "CLAVE-SECRETA-DE-PRUEBA-0123456789-0123456789";
    const c = cifrarSecretoFel("SECRETO-123", ambito);
    expect(c).not.toContain("SECRETO-123");
    process.env.FEL_CREDENTIALS_KEY = "OTRA-CLAVE-SECRETA-DE-PRUEBA-0123456789-0123456789";
    try {
      descifrarSecretoFel(c, ambito);
      throw new Error("no debía descifrar");
    } catch (e) {
      expect(e).toBeInstanceOf(ErrorConfigFel);
      expect(String((e as Error).message)).not.toMatch(/SECRETO-123|CLAVE-SECRETA|OTRA-CLAVE/);
    }
  });

  it("round-trip y AAD: un secreto TEST no descifra como PROD, ni como otra empresa o entidad", () => {
    process.env.FEL_CREDENTIALS_KEY = "k".repeat(40);
    const c = cifrarSecretoFel("valor-secreto", ambito);
    expect(descifrarSecretoFel(c, ambito)).toBe("valor-secreto");
    expect(() => descifrarSecretoFel(c, { ...ambito, ambiente: "PROD" })).toThrow(ErrorConfigFel);
    expect(() => descifrarSecretoFel(c, { ...ambito, empresaId: 8 })).toThrow(ErrorConfigFel);
    expect(() => descifrarSecretoFel(c, { ...ambito, entidadId: 10 })).toThrow(ErrorConfigFel);
    expect(() => descifrarSecretoFel("formato.invalido", ambito)).toThrow(ErrorConfigFel);
  });

  it("redacción: claves sensibles a cualquier profundidad, tokens en texto y truncado", () => {
    const s = redactar({ a: 1, password: "p", anidado: { Authorization: "Bearer abc.def", lista: [{ api_key: "k", ok: "x" }] }, texto: "Bearer xyz123 y token=abc" });
    expect(s).not.toMatch(/"p"|abc\.def|api_key":"k|xyz123|token=abc/);
    expect(s).toContain(MARCA_REDACTADO);
    expect(s).toContain('"ok":"x"');
    expect(redactar("z".repeat(5000), 100).length).toBeLessThanOrEqual(101);
  });

  it("huella canónica: independiente del orden de claves y sensible al contenido", () => {
    expect(huellaDe({ a: 1, b: [1, 2] })).toBe(huellaDe({ b: [1, 2], a: 1 }));
    expect(huellaDe({ a: 1 })).not.toBe(huellaDe({ a: 2 }));
    expect(() => serializarCanonico({ f: () => 1 })).toThrow();
  });
});

describe("FEL-2A · arquitectura: sin contabilidad, sin UI productiva, sin tocar fact_facturas", () => {
  it("src/lib/fel no importa ni toca contabilidad, eventos ni asientos", () => {
    for (const f of fuentesFel()) {
      const t = leerFuente(f);
      expect(t, f).not.toMatch(/@\/lib\/contabilidad|factura-emitida|registrarEventoContable|cont_eventos|cont_asientos|FACTURA_EMITIDA/);
    }
  });

  it("src/lib/fel no importa facturación productiva ni emite/anula facturas internas", () => {
    for (const f of fuentesFel()) {
      const t = leerFuente(f);
      expect(t, f).not.toMatch(/@\/lib\/facturacion|emitirFactura|anularFactura/);
      expect(t, f).not.toMatch(/UPDATE\s+fact_facturas|INSERT\s+INTO\s+fact_facturas|DELETE\s+FROM\s+(fact_|fel_)/i);
    }
  });

  it("anulación: una sola llamada a proveedor.anular() y nunca se reintenta dentro del servicio", () => {
    const t = leerFuente("src/lib/fel/servicio.ts");
    expect(t.match(/\.anular\(/g)).toHaveLength(1);
    // La política conservadora no depende de un estado ANULADO del contrato de consulta (no existe).
    const prov = leerFuente("src/lib/fel/provider.ts");
    const bloque = prov.slice(prov.indexOf("export type ResultadoConsulta"), prov.indexOf("export type ResultadoAnulacion"));
    expect(bloque).toContain("NO_ENCONTRADO");
    expect(bloque).not.toContain("ANULADO");
  });

  it("documento_origen_id es inmutable: ningún UPDATE lo asigna y nada borra documentos FEL", () => {
    for (const f of fuentesFel()) {
      const t = leerFuente(f);
      const updates = t.match(/UPDATE\s+fel_documentos[\s\S]*?(?:WHERE|`|")/gi) ?? [];
      for (const u of updates) expect(u).not.toMatch(/documento_origen_id/);
    }
  });

  it("nadie fuera de src/lib/fel (flujo productivo, rutas, UI, contabilidad) importa el servicio FEL", () => {
    // `git grep` evita recorrer y leer todo src en cada corrida (la suite completa corre muchos archivos en paralelo).
    let salida = "";
    try {
      salida = execFileSync("git", ["grep", "--untracked", "-lE", "@/lib/fel(/|[\"'])", "--", "src"], { encoding: "utf8" });
    } catch (e) {
      if ((e as { status?: number }).status !== 1) throw e; // 1 = sin coincidencias
    }
    const importadores = salida.split("\n").filter(Boolean).filter((p) => !p.startsWith("src/lib/fel/"));
    expect(importadores).toEqual([]);
  });

  it("emitirFactura sigue sin llamar a FEL ni a contabilidad", () => {
    const facturas = readFileSync("src/lib/facturacion/facturas.ts", "utf8");
    expect(facturas).not.toMatch(/lib\/fel|fel_documentos|certificarFactura/);
  });

  it("migración: solo DDL aditivo (un único ALTER de índice), sin DROP/TRUNCATE/INSERT/UPDATE/DELETE ni seeds", () => {
    const m = readFileSync("sql/migrate-2026-10-fel-2a-modelo.sql", "utf8").replace(/--[^\n]*/g, "");
    // Solo sentencias DML/DDL destructivas: «ON UPDATE/ON DELETE» de las FKs no cuentan.
    expect(m).not.toMatch(/(^|;)\s*(TRUNCATE|INSERT|UPDATE|DELETE|REPLACE|GRANT)\b|\bDROP\b/im);
    expect(m.match(/\bALTER\s+TABLE\b/gi)).toHaveLength(1);
    expect(m).toMatch(/ALTER TABLE fact_facturas\s+ADD UNIQUE INDEX IF NOT EXISTS uq_factura_ambito \(empresa_id, entidad_id, id\)/);
    for (const fk of m.match(/CONSTRAINT fk_\w+ FOREIGN KEY[\s\S]*?\)\s+REFERENCES[\s\S]*?(?=,\n|\n\))/g) ?? []) {
      expect(fk).toMatch(/ON DELETE RESTRICT ON UPDATE RESTRICT/);
    }
    expect(m).toMatch(/ck_fel_amb_mock_no_prod/);
  });

  it("schema.sql contiene las cuatro tablas FEL idénticas a la migración y el índice aditivo", () => {
    const m = readFileSync("sql/migrate-2026-10-fel-2a-modelo.sql", "utf8").replaceAll("\r\n", "\n");
    const schema = readFileSync("sql/schema.sql", "utf8").replaceAll("\r\n", "\n");
    const ddl = m.slice(m.indexOf("CREATE TABLE IF NOT EXISTS fel_emisores"));
    expect(schema).toContain(ddl.trim());
    expect(schema).toContain("ADD UNIQUE INDEX IF NOT EXISTS uq_factura_ambito (empresa_id, entidad_id, id)");
  });

  it("preflight y verify son de solo lectura", () => {
    for (const f of ["sql/preflight-2026-10-fel-2a-modelo.sql", "sql/verify-2026-10-fel-2a-modelo.sql"]) {
      const t = readFileSync(f, "utf8").replace(/--[^\n]*/g, "").replace(/SHOW\s+CREATE\s+TABLE/gi, "SHOW TABLE_DDL");
      expect(t, f).not.toMatch(/\b(ALTER|CREATE|DROP|INSERT|UPDATE|DELETE|TRUNCATE|GRANT)\b/i);
    }
  });
});
