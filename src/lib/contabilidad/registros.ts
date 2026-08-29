import { z } from "zod";
import { NextResponse } from "next/server";
import type { ResultSetHeader } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { bloquearAmbito, exigirEsquemaC2b, errorAmbito, type AmbitoContable } from "./ambito";

export class RegistroInvalido extends Error {}
const texto = (max: number) => z.string().trim().min(1).max(max);
const fecha = z.string().regex(/^[1-9]\d{3}-\d{2}-\d{2}$/).refine((s) => {
  const d = new Date(s + "T00:00:00.000Z");
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
});
const obligacion = {
  documento: z.string().trim().max(80).optional(),
  fecha,
  vencimiento: z.preprocess((v) => v === "" ? undefined : v, fecha.optional()),
  // DECIMAL(14,2). Mantiene cero por compatibilidad; jamás redondea silenciosamente.
  monto: z.number().finite().nonnegative().refine((v) => /^\d{1,12}(\.\d{1,2})?$/.test(String(v))),
};
const schemas = {
  cuentas: z.object({ codigo: texto(40), nombre: texto(200), tipo: z.enum(["Activo", "Pasivo", "Capital", "Ingreso", "Gasto"]), nivel: z.number().int().min(1).max(2147483647).default(1) }),
  cxc: z.object({ cliente: texto(200), ...obligacion }).refine((v) => !v.vencimiento || v.vencimiento >= v.fecha),
  cxp: z.object({ proveedor: texto(200), ...obligacion }).refine((v) => !v.vencimiento || v.vencimiento >= v.fecha),
};
export type TipoRegistro = keyof typeof schemas;

export async function crearRegistro(tipo: TipoRegistro, empresaId: number, usuario: string, input: unknown, ambito: AmbitoContable) {
  let sql: string;
  let params: (string | number | null)[];
  if (tipo === "cuentas") {
    const parsed = schemas.cuentas.safeParse(input);
    if (!parsed.success) throw new RegistroInvalido("Revisa código, nombre, tipo y nivel de la cuenta.");
    const d = parsed.data;
    sql = "INSERT INTO cont_cuentas (empresa_id, entidad_id, codigo, nombre, tipo, nivel) VALUES (?, ?, ?, ?, ?, ?)";
    params = [empresaId, ambito.entidadId, d.codigo, d.nombre, d.tipo, d.nivel];
  } else {
    const parsed = schemas[tipo].safeParse(input);
    if (!parsed.success) throw new RegistroInvalido("Revisa nombre, fechas, vencimiento e importe (máximo dos decimales).");
    const d = parsed.data;
    const nombre = "cliente" in d ? d.cliente : d.proveedor;
    // Tabla/columna exclusivamente de la unión cerrada interna, nunca del request.
    sql = tipo === "cxc"
      ? "INSERT INTO cont_cxc (empresa_id, entidad_id, cliente, documento, fecha, vencimiento, monto, saldo, estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pendiente')"
      : "INSERT INTO cont_cxp (empresa_id, entidad_id, proveedor, documento, fecha, vencimiento, monto, saldo, estado) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pendiente')";
    const [entero, decimal = ""] = String(d.monto).split(".");
    const importe = entero + "." + decimal.padEnd(2, "0");
    params = [empresaId, ambito.entidadId, nombre, d.documento || null, d.fecha, d.vencimiento ?? null, importe, importe];
  }
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    await bloquearAmbito(conn, empresaId, ambito, true);
    await exigirEsquemaC2b(conn);
    const [r] = await conn.execute<ResultSetHeader>(sql, params);
    const id = Number(r.insertId);
    await registrarAuditoriaTx(conn, { empresaId, usuario, modulo: "contabilidad", accion: "crear_" + tipo, detalle: `Entidad #${ambito.entidadId}; registro #${id} creado en ${tipo}.` });
    await conn.commit();
    return id;
  } catch (e) { await conn.rollback(); throw e; }
  finally { conn.release(); }
}

export function errorRegistro(error: unknown) {
  const acceso = errorAmbito(error);
  if (acceso) return acceso;
  if (error instanceof RegistroInvalido) return NextResponse.json({ error: error.message }, { status: 400 });
  const code = (error as { code?: string })?.code;
  if (code === "ER_DUP_ENTRY") return NextResponse.json({ error: "Clave duplicada. Si pertenece a otra entidad, verifica la migración C2B de unicidad." }, { status: 409 });
  if (code === "ER_LOCK_DEADLOCK" || code === "ER_LOCK_WAIT_TIMEOUT") return NextResponse.json({ error: "Operación en conflicto. Intenta nuevamente." }, { status: 409 });
  console.error("Registro contable fallido", { code: code ?? "desconocido" });
  return NextResponse.json({ error: "No se pudo confirmar el registro. Consulta el listado antes de reintentar." }, { status: 500 });
}
