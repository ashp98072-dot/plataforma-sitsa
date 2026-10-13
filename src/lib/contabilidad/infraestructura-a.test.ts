import { beforeEach, expect, it, vi } from "vitest";
import type { PoolConnection } from "mysql2/promise";
vi.mock("./ambito", () => ({ bloquearAmbito: vi.fn(), exigirEsquemaC2b: vi.fn() }));
vi.mock("@/lib/db", () => ({ getPool: vi.fn() }));
vi.mock("@/lib/auditoria", () => ({ registrarAuditoriaTx: vi.fn() }));
import { getPool } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { resolverCuentaPorRol } from "./cuentas-rol";
import { registrarAsientoTx } from "./asientos";
import { registrarEventoContableTx } from "./eventos";
import { crearSnapshotContable, huellaContable, serializarCanonico } from "./evento-snapshot";

const a = { entidadId: 9, usuarioId: 4, admin: false };
const c = { query: vi.fn(), execute: vi.fn(), beginTransaction: vi.fn(), commit: vi.fn(), rollback: vi.fn(), release: vi.fn() };
const conn = c as unknown as PoolConnection;
const snapshot = { version: 1, versionCalculo: "INFRA_A", origen: { tipo: "FACTURA", id: 5 }, cuentas: [], importes: [], impuestos: [] };
const asiento = { numero: "PRUEBA", fecha: "2026-10-13", lineas: [{ cuentaId: 1, debe: 10 }, { cuentaId: 2, haber: 10 }] };
const evento = () => ({ facturaId: 5, tipo: "FACTURA_EMITIDA" as const, snapshot, asiento });
const cuenta = { id: 1, empresa_id: 7, entidad_id: 9, codigo: "DATO", nombre: "Cuenta", tipo: "Activo", activa: 1, rol_activo: 1, entidad_activa: 1 };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(getPool).mockReturnValue(c as unknown as ReturnType<typeof getPool>);
  c.execute.mockResolvedValue([{ insertId: 10 }]);
  c.query.mockImplementation(async (sql: string) => {
    if (sql.includes("FROM cont_cuentas_rol")) return [[cuenta]];
    if (sql.includes("clave_evento")) return [[]];
    if (sql.includes("FROM fact_facturas")) return [[{ id: 5 }]];
    return [[{ id: 1, empresa_id: 7, entidad_id: 9, activa: 1 }, { id: 2, empresa_id: 7, entidad_id: 9, activa: 1 }]];
  });
});
it("resuelve cuenta tipada en ámbito exacto sin código hardcodeado", async () => {
  expect(await resolverCuentaPorRol({ empresaId: 7, entidadId: 9, rol: "CLIENTES" }, conn)).toMatchObject({ id: 1, codigo: "DATO" });
  expect(c.query).toHaveBeenCalledWith(expect.stringContaining("FOR UPDATE"), [7, 9, "CLIENTES"]);
});
it.each(["CLIENTES", "VENTAS_BIENES"] as const)("rol válido %s sin configuración falla sin fallback", async rol => {
  c.query.mockResolvedValue([[]]);
  await expect(resolverCuentaPorRol({ empresaId: 7, entidadId: 9, rol }, conn)).rejects.toThrow("Configuración");
});
it.each([{ activa: 0 }, { rol_activo: 0 }, { entidad_activa: 0 }, { empresa_id: 8 }, { entidad_id: 10 }])("rechaza cuenta/configuración inactiva o ajena %j", async cambio => {
  c.query.mockResolvedValue([[{ ...cuenta, ...cambio }]]);
  await expect(resolverCuentaPorRol({ empresaId: 7, entidadId: 9, rol: "CLIENTES" }, conn)).rejects.toThrow("Configuración");
});
it("resolvedor sin conexión usa pool y no adquiere transacción", async () => {
  await resolverCuentaPorRol({ empresaId: 7, entidadId: 9, rol: "CLIENTES" });
  expect(c.beginTransaction).not.toHaveBeenCalled();
  expect(c.query.mock.calls[0][0]).not.toContain("FOR UPDATE");
});
it("Tx inserta asiento/detalles/auditoría sin lifecycle propio", async () => {
  expect(await registrarAsientoTx(conn, 7, "actor", asiento, a)).toBe(10);
  expect(c.execute).toHaveBeenCalledTimes(3);
  expect(registrarAuditoriaTx).toHaveBeenCalledWith(conn, expect.objectContaining({ empresaId: 7 }));
  for (const f of [c.beginTransaction, c.commit, c.rollback, c.release]) expect(f).not.toHaveBeenCalled();
});
it("Tx rechaza descuadre antes de cualquier escritura", async () => {
  await expect(registrarAsientoTx(conn, 7, "actor", { ...asiento, lineas: [{ cuentaId: 1, debe: 11 }, { cuentaId: 2, haber: 10 }] }, a)).rejects.toThrow("no cuadra");
  expect(c.execute).not.toHaveBeenCalled();
});
it.each([{ rows: [] }, { rows: [{ id: 1, empresa_id: 8, entidad_id: 9, activa: 1 }] }, { rows: [{ id: 1, empresa_id: 7, entidad_id: 10, activa: 1 }] }])("Tx no acepta cuentas incompletas/ajenas %j", async ({ rows }) => {
  c.query.mockResolvedValue([rows]);
  await expect(registrarAsientoTx(conn, 7, "actor", asiento, a)).rejects.toThrow("Todas las cuentas");
  expect(c.execute).not.toHaveBeenCalled();
});
it("propaga fallo para rollback externo, sin commit/rollback propio", async () => {
  c.execute.mockRejectedValue(new Error("fallo de DB"));
  await expect(registrarAsientoTx(conn, 7, "actor", asiento, a)).rejects.toThrow("fallo de DB");
  expect(c.rollback).not.toHaveBeenCalled();
  expect(c.commit).not.toHaveBeenCalled();
});
it("huella es canónica/versionada y cambia con contenido funcional", () => {
  expect(huellaContable({ a: 1, b: 2 })).toBe(huellaContable({ b: 2, a: 1 }));
  expect(huellaContable({ a: 1 })).not.toBe(huellaContable({ a: 2 }));
  expect(() => serializarCanonico({ a: undefined })).toThrow();
  expect(() => serializarCanonico(NaN)).toThrow();
});
it.each(["password", "ruta", "numeroCuenta", "timestamp"])("snapshot rechaza campo libre %s", k => {
  expect(() => crearSnapshotContable({ ...snapshot, [k]: "secreto" })).toThrow();
});
it("snapshot rechaza versión no soportada y montos no canónicos", () => {
  expect(() => crearSnapshotContable({ ...snapshot, version: 2 })).toThrow();
  expect(() => crearSnapshotContable({ ...snapshot, importes: [{ concepto: "TOTAL", monto: "1.234" }] })).toThrow();
});
it("evento crea vínculo y usa la misma conexión sin activar un flujo", async () => {
  expect(await registrarEventoContableTx(conn, 7, "actor", a, evento())).toEqual({ eventoId: 10, asientoId: 10, reutilizado: false });
  expect(c.execute.mock.calls[3][0]).toContain("INSERT INTO cont_eventos");
  expect(c.execute.mock.calls[3][1].slice(0, 6)).toEqual([7, 9, 5, "FACTURA_EMITIDA", null, 10]);
  expect(c.commit).not.toHaveBeenCalled();
});
it("misma clave/huella devuelve asiento existente; ignores glosa/número de presentación", async () => {
  await registrarEventoContableTx(conn, 7, "actor", a, evento());
  const huella = c.execute.mock.calls[3][1][7];
  c.execute.mockClear();
  c.query.mockResolvedValue([[{ id: 20, asiento_id: 10, huella }]]);
  expect(await registrarEventoContableTx(conn, 7, "actor", a, { ...evento(), asiento: { ...asiento, numero: "OTRO", glosa: "texto" } })).toEqual({ eventoId: 20, asientoId: 10, reutilizado: true });
  expect(c.execute).not.toHaveBeenCalled();
});
it("misma clave/huella diferente produce conflicto sin escribir", async () => {
  c.query.mockResolvedValue([[{ id: 20, asiento_id: 10, huella: "diferente" }]]);
  await expect(registrarEventoContableTx(conn, 7, "actor", a, evento())).rejects.toMatchObject({ status: 409 });
  expect(c.execute).not.toHaveBeenCalled();
});
it("factura fuera de ámbito impide escribir", async () => {
  c.query.mockResolvedValue([[]]);
  await expect(registrarEventoContableTx(conn, 7, "actor", a, evento())).rejects.toThrow("Factura fuera");
  expect(c.execute).not.toHaveBeenCalled();
});
it("cobro reservado no acepta referencia sin confirmación/FK", async () => {
  await expect(registrarEventoContableTx(conn, 7, "actor", a, { ...evento(), tipo: "COBRO_CONFIRMADO" })).rejects.toThrow("no implementadas");
  expect(c.query).not.toHaveBeenCalled();
});
it("retención requiere origen real de venta de la misma factura", async () => {
  await expect(registrarEventoContableTx(conn, 7, "actor", a, { ...evento(), tipo: "RETENCION_NO_EMITIDA" })).rejects.toThrow("Origen");
  c.query.mockImplementation(async (sql: string) => sql.includes("FROM fact_facturas") ? [[{ id: 5 }]] : [[]]);
  await expect(registrarEventoContableTx(conn, 7, "actor", a, { ...evento(), tipo: "RETENCION_NO_EMITIDA", eventoOrigenId: 8 })).rejects.toThrow("origen no disponible");
});
