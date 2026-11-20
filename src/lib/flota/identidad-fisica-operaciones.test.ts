import { describe, expect, it } from "vitest";
import type { PoolConnection } from "mysql2/promise";
import { operacionesAbiertasEnRepresentante, operacionesFueraDelRepresentante, representanteParaEmpresa, sinOperacionesAbiertas } from "./identidad-fisica-operaciones";

const MONACO = 1, FRESCO = 4;
const miembros = [{ id: 602, empresa_id: FRESCO }, { id: 1296, empresa_id: MONACO }];

describe("representanteParaEmpresa (misma regla que los catálogos: propia de menor ID; si no, la de menor ID)", () => {
  it("Mónaco → #1296; Fresco Fresh → #602; una empresa sin ficha propia → la de menor ID", () => {
    expect(representanteParaEmpresa(miembros, MONACO)).toBe(1296);
    expect(representanteParaEmpresa(miembros, FRESCO)).toBe(602);
    expect(representanteParaEmpresa(miembros, 5)).toBe(602);
  });
  it("con varias propias elige la de menor ID; sin miembros devuelve null", () => {
    expect(representanteParaEmpresa([{ id: 9, empresa_id: 1 }, { id: 3, empresa_id: 1 }, { id: 1, empresa_id: 4 }], 1)).toBe(3);
    expect(representanteParaEmpresa([], 1)).toBeNull();
  });
});

describe("operacionesFueraDelRepresentante", () => {
  it("una operación de Mónaco en #1296 (su representante) NO es conflicto; en #602 (compartida) SÍ", () => {
    expect(operacionesFueraDelRepresentante([{ empresa_id: MONACO, miembro: 1296 }], miembros)).toEqual([]);
    expect(operacionesFueraDelRepresentante([{ empresa_id: MONACO, miembro: 602 }], miembros)).toHaveLength(1);
  });
  it("una operación de Fresco Fresh en #602 (su representante) no es conflicto; en #1296 sí", () => {
    expect(operacionesFueraDelRepresentante([{ empresa_id: FRESCO, miembro: 602 }], miembros)).toEqual([]);
    expect(operacionesFueraDelRepresentante([{ empresa_id: FRESCO, miembro: 1296 }], miembros)).toHaveLength(1);
  });
  it("operaciones abiertas en AMBAS fichas por la misma empresa bloquean (una de las dos no es la representante)", () => {
    expect(operacionesFueraDelRepresentante([{ empresa_id: MONACO, miembro: 1296 }, { empresa_id: MONACO, miembro: 602 }], miembros)).toHaveLength(1);
  });
});

/** Conexión simulada: esquema completo + las operaciones abiertas que se indiquen. */
function conexion(abiertas: { viajes?: Record<string, unknown>[]; planesTc?: Record<string, unknown>[]; planesUnidad?: Record<string, unknown>[] }) {
  const esquema = ["flota_viajes.id", "flota_viajes.empresa_id", "flota_viajes.vehiculo_id", "flota_viajes.estado", "flota_viajes.hora_llegada", "tms_planes_viaje.id", "tms_planes_viaje.empresa_id", "tms_planes_viaje.tc_vehiculo_id",
    "tms_planes_viaje.unidad_id", "tms_planes_viaje.estado", "tms_unidades.id", "tms_unidades.flota_vehiculo_id"].map(x => { const [TABLE_NAME, COLUMN_NAME] = x.split("."); return { TABLE_NAME, COLUMN_NAME, ENGINE: "InnoDB" }; });
  return { query: async (sql: string) => {
    if (sql.includes("information_schema.COLUMNS")) return [esquema];
    if (sql.includes("FROM flota_viajes")) return [abiertas.viajes ?? []];
    if (sql.includes("p.tc_vehiculo_id AS miembro")) return [abiertas.planesTc ?? []];
    if (sql.includes("u.flota_vehiculo_id AS miembro")) return [abiertas.planesUnidad ?? []];
    throw new Error(`consulta inesperada: ${sql}`);
  } } as unknown as PoolConnection;
}
const conInterruptor = async <T>(valor: string, fn: () => Promise<T>) => { const antes = process.env.FLOTA_IDENTIDAD_OPERACIONES_EN_REPRESENTANTE; process.env.FLOTA_IDENTIDAD_OPERACIONES_EN_REPRESENTANTE = valor; try { return await fn(); } finally { if (antes === undefined) delete process.env.FLOTA_IDENTIDAD_OPERACIONES_EN_REPRESENTANTE; else process.env.FLOTA_IDENTIDAD_OPERACIONES_EN_REPRESENTANTE = antes; } };

describe("sinOperacionesAbiertas con el interruptor FLOTA_IDENTIDAD_OPERACIONES_EN_REPRESENTANTE", () => {
  const planesEnRepresentante = { planesUnidad: [{ id: 1, empresa_id: MONACO, miembro: 1296 }, { id: 2, empresa_id: MONACO, miembro: 1296 }] };
  it("apagado (por defecto): CUALQUIER operación abierta bloquea, también en la representante (comportamiento actual)", async () => {
    expect(operacionesAbiertasEnRepresentante({} as NodeJS.ProcessEnv)).toBe(false);
    await conInterruptor("", async () => { await expect(sinOperacionesAbiertas(conexion(planesEnRepresentante), [602, 1296], miembros)).rejects.toThrow(/pendientes/); });
  });
  it("encendido: operaciones abiertas solo en la representante de su empresa NO bloquean", async () => {
    await conInterruptor("1", async () => { await expect(sinOperacionesAbiertas(conexion(planesEnRepresentante), [602, 1296], miembros)).resolves.toBeUndefined(); });
  });
  it("encendido: una operación abierta en la ficha compartida (no representante), un viaje abierto o miembros ausentes SIGUEN bloqueando", async () => {
    await conInterruptor("1", async () => {
      await expect(sinOperacionesAbiertas(conexion({ planesTc: [{ id: 3, empresa_id: MONACO, miembro: 602 }] }), [602, 1296], miembros)).rejects.toThrow(/no es la representante/);
      await expect(sinOperacionesAbiertas(conexion({ viajes: [{ id: 9, empresa_id: MONACO, miembro: 602 }] }), [602, 1296], miembros)).rejects.toThrow(/no es la representante/);
      await expect(sinOperacionesAbiertas(conexion(planesEnRepresentante), [602, 1296])).rejects.toThrow(/pendientes/); // sin lista de miembros: estricto
    });
  });
  it("sin ninguna operación abierta pasa con o sin interruptor", async () => {
    await conInterruptor("1", async () => { await expect(sinOperacionesAbiertas(conexion({}), [602, 1296], miembros)).resolves.toBeUndefined(); });
    await conInterruptor("", async () => { await expect(sinOperacionesAbiertas(conexion({}), [602, 1296], miembros)).resolves.toBeUndefined(); });
  });
  it("lista de unidades vacía se rechaza (400) como antes", async () => {
    await expect(sinOperacionesAbiertas(conexion({}), [], miembros)).rejects.toMatchObject({ status: 400 });
  });
});
