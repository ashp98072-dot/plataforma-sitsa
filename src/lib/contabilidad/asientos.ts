import { z } from "zod";
import type { ResultSetHeader, RowDataPacket } from "mysql2/promise";
import { getPool } from "@/lib/db";
import { registrarAuditoriaTx } from "@/lib/auditoria";
import { bloquearAmbito, exigirEsquemaC2b, type AmbitoContable } from "./ambito";

export class AsientoInvalido extends Error {}

// DECIMAL(14,2): no redondear silenciosamente dinero ni sumar con punto flotante.
const importe = z.number().finite().nonnegative().refine((n) => /^\d{1,12}(\.\d{1,2})?$/.test(String(n)), "Importe fuera de rango o con más de dos decimales.");
function centavos(n: number): bigint {
  const [entero, decimal = ""] = String(n).split(".");
  return BigInt(entero) * BigInt(100) + BigInt(decimal.padEnd(2, "0"));
}
function decimalSql(n: number) {
  const valor = centavos(n);
  return `${valor / BigInt(100)}.${String(valor % BigInt(100)).padStart(2, "0")}`;
}

export const asientoSchema = z.object({
  numero: z.string().trim().min(1).max(40),
  fecha: z.string().regex(/^[1-9]\d{3}-\d{2}-\d{2}$/).refine((s) => {
    const d = new Date(`${s}T00:00:00.000Z`);
    return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
  }, "Fecha inválida."),
  glosa: z.string().max(500).optional(),
  lineas: z.array(z.object({
    cuentaId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    debe: importe.default(0),
    haber: importe.default(0),
  }).refine((l) => (l.debe > 0 && l.haber === 0) || (l.haber > 0 && l.debe === 0), "Cada línea debe tener un solo lado positivo.")).min(2).max(500),
});

export async function registrarAsiento(empresaId: number, usuario: string, input: unknown, ambito: AmbitoContable) {
  const parsed = asientoSchema.safeParse(input);
  if (!parsed.success) throw new AsientoInvalido("Datos inválidos: revisa fecha, importes, cuentas y límites de las líneas.");
  const d = parsed.data;
  const debe = d.lineas.reduce((s, l) => s + centavos(l.debe), BigInt(0));
  const haber = d.lineas.reduce((s, l) => s + centavos(l.haber), BigInt(0));
  if (debe !== haber) throw new AsientoInvalido("El asiento no cuadra (debe ≠ haber).");
  const ids = [...new Set(d.lineas.map((l) => l.cuentaId))].sort((a, b) => a - b);
  const conn = await getPool().getConnection();
  try {
    await conn.beginTransaction();
    await bloquearAmbito(conn, empresaId, ambito, true);
    await exigirEsquemaC2b(conn);
    // Orden estable y current read: no aceptar cuentas desactivadas/borradas mientras se registra.
    const [cuentas] = await conn.query<RowDataPacket[]>(
      `SELECT id, empresa_id, entidad_id, activa FROM cont_cuentas
       WHERE empresa_id = ? AND entidad_id = ? AND id IN (${ids.map(() => "?").join(",")}) ORDER BY id FOR UPDATE`,
      [empresaId, ambito.entidadId, ...ids],
    );
    if (cuentas.length !== ids.length || cuentas.some((c) => Number(c.empresa_id) !== empresaId || Number(c.entidad_id) !== ambito.entidadId || Number(c.activa) !== 1)) {
      throw new AsientoInvalido("Todas las cuentas deben existir, estar activas y pertenecer a esta empresa y entidad.");
    }
    const [asiento] = await conn.execute<ResultSetHeader>(
      `INSERT INTO cont_asientos (empresa_id, entidad_id, fecha, numero, glosa, estado, creado_por)
       VALUES (?, ?, ?, ?, ?, 'Registrado', ?)`,
      [empresaId, ambito.entidadId, d.fecha, d.numero, d.glosa ?? null, usuario],
    );
    const id = Number(asiento.insertId);
    for (const l of d.lineas) {
      await conn.execute(
        "INSERT INTO cont_asiento_detalle (empresa_id, entidad_id, asiento_id, cuenta_id, debe, haber) VALUES (?, ?, ?, ?, ?, ?)",
        [empresaId, ambito.entidadId, id, l.cuentaId, decimalSql(l.debe), decimalSql(l.haber)],
      );
    }
    await registrarAuditoriaTx(conn, {
      empresaId, usuario, modulo: "contabilidad", accion: "registrar_asiento",
      detalle: `Entidad #${ambito.entidadId}; asiento #${id}; ${d.lineas.length} líneas; total por lado en centavos: ${debe}.`,
    });
    await conn.commit();
    return id;
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally { conn.release(); }
}
