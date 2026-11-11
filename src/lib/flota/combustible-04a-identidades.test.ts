import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ getPool: () => { throw Error("DB_REAL_PROHIBIDA"); }, query: () => { throw Error("DB_REAL_PROHIBIDA"); } }));
vi.mock("@/lib/load-env", () => ({ loadRuntimeEnv: () => { throw Error("ENV_REAL_PROHIBIDO"); } }));
import { normalizarIdentificador } from "./combustible-identificadores";
import { normalizarVale, clasificarFila } from "./combustible-c2c-shared";
import { combustibleStaffSchema } from "./combustible-staff-schema";
import { analizarExcelProveedor } from "./combustible-importacion-parser";
import { fixtureProveedor } from "./combustible-importacion.fixture";
import { analizar, hash, payload, recuperar } from "./cb2/model";
import { libro, row } from "./cb2/fixture";

const staff = { estacionId: 55, vehiculoId: 7, fechaConsumo: "2026-10-15", tipoCombustible: "diesel", galones: "10", monto: "200", km: null };
async function c2b(vale: string) {
  const b = await fixtureProveedor(w => { for (const s of w.worksheets) s.eachRow(r => { if (r.getCell(3).value === "00157301") r.getCell(3).value = vale; }); });
  return (await analizarExcelProveedor(b)).filas.find(f => f.textos.vale === vale)!;
}
async function cb2(vale: string) { return (await analizar(await libro([row(vale)]), "HALEL", "GTQ")).find(l => l.clave)!; }

describe("04A normalización: funciones/parsers reales, sin emular colaciones SQL", () => {
  it.each([
    ["  a  001  ", "A 001"], ["a\u00a0001", "A 001"], [" e\u0301-001 ", "É-001"],
    ["00123", "00123"], ["123", "123"], ["a-001", "A-001"], ["a–001", "A–001"],
  ])("vale %j conserva identidad normalizada %j en C2B/C2C/CB2", async (literal, esperado) => {
    expect(normalizarIdentificador(literal)).toBe(esperado); expect(normalizarVale(literal)).toBe(esperado);
    const f = await c2b(literal), l = await cb2(literal);
    expect(f.valeNormalizado).toBe(esperado); expect(l.fila.vale).toBe(esperado);
    expect(f.claveOperacion).toBe(l.clave);
    expect(combustibleStaffSchema.parse({ ...staff, numeroVale: literal }).numeroVale).toBe(literal.trim());
  });
  it.each([40, 41, 128, 129])("longitud %i: staff max40; CB2 bloquea solo al exceder128", async n => {
    const literal = "A".repeat(n), l = await cb2(literal);
    expect(combustibleStaffSchema.safeParse({ ...staff, numeroVale: literal }).success).toBe(n <= 40);
    expect(l.bloqueada).toBe(n > 128); if (n > 128) expect(l.errores).toContain("LONGITUD");
  });
  it("vacío: normalización vacía, staff inválido y CB2 sin candidato", async () => {
    expect(normalizarVale(null)).toBe("");
    expect(combustibleStaffSchema.safeParse({ ...staff, numeroVale: " " }).success).toBe(false);
    const ls = await analizar(await libro([row(" ")]), "HALEL", "GTQ");
    expect(ls.every(l => l.clave === null)).toBe(true);
  });
  it("identificador Excel numérico inseguro bloquea CB2 en vez de certificar el literal", async () => {
    const r = row(); r[1] = 12345678901234568;
    const ls = await analizar(await libro([r]), "HALEL", "GTQ");
    const l = ls.find(l => l.fila.estado !== "IGNORADA")!;
    expect(l.bloqueada).toBe(true); expect(l.errores).toContain("vale");
  });
});

describe("04A identidades y huellas vigentes", () => {
  it("SHA-256 conocido y payload operativo explícito; huellas de parser no son intercambiables", async () => {
    expect(hash("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    const l = await cb2("0001");
    expect(l.payload).toBe('[1,"0001","2026-10-01","C-001ABC","DEMO","DIESEL","10","20","200",null,null,"GTQ"]');
    expect(l.huella).toBe(hash(l.payload!));
    expect(l.huella).toBe("c0a434e8fd1054899cd8c33090a13822d756504963faa81ddc23567b8ce8e7cf");
    expect(l.clave).toBe(hash('["0001"]'));
    expect(l.clave).toBe("47ab543e06ca8d91c77f1992393622c7bbcff63b8f7d80ac22c3ed3620b496c1");
    expect(l.fila.huella).not.toBe(l.huella);
    const f = await c2b("0001");
    expect(f.claveOperacion).toBe(l.clave); expect(f.fingerprint).not.toBe(l.huella);
    expect(f.fingerprint).toBe("2933e4e2bbef85f45254971be9cc8dfb99c33dba81f6ab178efdcb5dfb682e2a");
  });
  it("documento y hoja cambian archivo/fingerprint parser, pero no payload operativo CB2", async () => {
    const a = await libro([row()]); const r = row(); r[6] = "SERIE-DEMO"; r[7] = "0009";
    const b = await libro([r], w => { w.worksheets[0].name = "OTRA"; });
    const x = (await analizar(a, "HALEL", "GTQ")).find(l => l.clave)!;
    const y = (await analizar(b, "HALEL", "GTQ")).find(l => l.clave)!;
    expect(hash(a)).not.toBe(hash(b)); expect(x.payload).toBe(y.payload); expect(x.clave).toBe(y.clave);
    expect(x.fila.huella).not.toBe(y.fila.huella); expect(y.documento).toMatchObject({ serie: "SERIE-DEMO", numero: "0009" });
  });
  it.each(["monto", "fechaConsumo", "placaNormalizada", "pilotoInformado", "producto", "kilometraje"] as const)("%s cambia payload sin cambiar candidato de vale", async campo => {
    const l = await cb2("0001"), f = structuredClone(l.fila);
    const nuevos = { monto: "201", fechaConsumo: "2026-10-02", placaNormalizada: "C-002ABC", pilotoInformado: "OTRA PERSONA", producto: "GASOLINA", kilometraje: "123" };
    f[campo] = nuevos[campo]; expect(payload(f, "GTQ")).not.toBe(l.payload); expect(f.identidadCandidata).toBe(l.clave);
  });
  it("moneda cambia huella; representación decimal equivalente no cambia payload", async () => {
    const l = await cb2("0001");
    expect(payload(l.fila, "USD")).not.toBe(l.payload);
    expect(payload({ ...l.fila, galones: "10.000", monto: "200.00" }, "GTQ")).toBe(l.payload);
  });
  it("C2C puede clasificar exacta con datos faltantes; no equivale a evidencia completa", () => {
    const r = clasificarFila({ placaNormalizada: "", galones: null, precio: null, total: null, fechaReporte: null }, [{ placa: "C-001ABC", galones: "10", monto: "200", precio: "20", fechaConsumo: "2026-10-01" }]);
    expect(r.estado).toBe("COINCIDENCIA_EXACTA"); expect(r.diferencias).toHaveLength(5);
    expect(r.diferencias.every(d => d.tipo === "FALTANTE")).toBe(true);
  });
});

describe("04A recibo de diario: recuperar real sobre filas sintéticas", () => {
  const recibo = () => [1, 2].map(n => ({ id: n, importacion_id: 10, revision: 1, resultado: "CREADA", consumo_id: n, operacion_ordinal: n, operacion_total: 2, solicitud_sha256: "digest-demo", usuario_id: 9 }));
  it("recupera resultado completo con mismo digest y actor; no crea otra operación", () => {
    expect(recuperar(recibo(), "digest-demo", 9)).toEqual([1, 2].map(n => ({ id: n, importacionId: 10, revision: 1, resultado: "CREADA", consumoId: n })));
    expect(recuperar([], "digest-demo", 9)).toBeNull();
  });
  it.each(["digest", "actor", "incompleto", "orden", "total"])("rechaza %s incompatible", caso => {
    const filas = recibo();
    if (caso === "incompleto") filas.pop();
    if (caso === "orden") filas.reverse();
    if (caso === "total") filas[0].operacion_total = 3;
    expect(() => recuperar(filas, caso === "digest" ? "otro" : "digest-demo", caso === "actor" ? 10 : 9)).toThrow("incompatible");
  });
});
