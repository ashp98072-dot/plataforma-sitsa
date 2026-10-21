import type { RowDataPacket } from "mysql2/promise";
import { execute, query } from "@/lib/db";
import { esRetencionIvaValida, type RetencionIvaPct } from "@/lib/facturacion/lineas-factura";

/**
 * FACT-4 — contexto de PARAMETRIZACIÓN por entidad/cliente que necesita preparar una factura. Todo lo que cambia entre
 * entidades emisoras (KT, Mónaco…) vive en datos y se lee desde aquí; el motor de facturación no tiene ramas por empresa.
 *
 * Tolerancia: si la migración FACT-4 aún no está aplicada, las LECTURAS devuelven vacío/por defecto (la pantalla de
 * facturas de siempre sigue funcionando) y las ESCRITURAS fallan con un error explícito. Nunca se ejecuta DDL aquí.
 */

/** Plantillas de representación PDF disponibles. El nombre NO es de una empresa: describe las columnas. */
export const PLANTILLAS_FACTURA = ["CODIGO_DESCRIPCION_TOTAL", "CANTIDAD_DESCRIPCION_UNITARIO_VALOR"] as const;
export type PlantillaFactura = (typeof PLANTILLAS_FACTURA)[number];
export const PLANTILLA_POR_DEFECTO: PlantillaFactura = "CODIGO_DESCRIPCION_TOTAL";

export type EntidadEmisora = { id: number; codigo: string; nombre: string };
export type CuentaBancariaDisponible = {
  id: number;
  entidadId: number;
  entidadNombre: string;
  banco: string;
  alias: string;
  referencia: string | null;
  moneda: string;
};

export function esEsquemaPendiente(e: unknown): boolean {
  const err = e as { code?: string; errno?: number };
  return err?.code === "ER_NO_SUCH_TABLE" || err?.code === "ER_BAD_FIELD_ERROR" || err?.errno === 1146 || err?.errno === 1054;
}

export const MENSAJE_FALTA_MIGRACION_FACT4 =
  "Falta aplicar la migración FACT-4 (líneas, condición de pago y retención). No se modificó nada.";

/**
 * ¿Está aplicada la migración FACT-4? Lectura sin filas (LIMIT 0): falla con tabla/columna inexistente. Permite que la
 * pantalla ofrezca la preparación de líneas solo cuando el esquema ya está, sin ejecutar nunca DDL.
 */
let fact4Confirmada = false; // el esquema solo se agrega (nunca se quita): una vez visto, no se vuelve a consultar
export async function fact4Disponible(): Promise<boolean> {
  if (fact4Confirmada) return true;
  try {
    await query<RowDataPacket[]>(
      "SELECT modelo_lineas, condicion_pago, cuenta_bancaria_id, retencion_iva_pct, retencion_iva_monto FROM fact_facturas LIMIT 0",
      [],
    );
    await query<RowDataPacket[]>("SELECT id, factura_id, cantidad FROM fact_factura_lineas LIMIT 0", []);
    await query<RowDataPacket[]>("SELECT linea_id, plan_id FROM fact_factura_linea_viajes LIMIT 0", []);
    await query<RowDataPacket[]>("SELECT retencion_iva_pct FROM fact_cliente_perfil LIMIT 0", []);
    fact4Confirmada = true;
    return true;
  } catch (e) {
    if (esEsquemaPendiente(e)) return false;
    throw e;
  }
}

/** Entidades contables ACTIVAS de la empresa (emisores posibles). Vacío si no hay o si falta el esquema. */
export async function listarEntidadesEmisoras(empresaId: number): Promise<EntidadEmisora[]> {
  try {
    const rows = await query<RowDataPacket[]>(
      "SELECT id, codigo, nombre FROM cont_entidades WHERE empresa_id = ? AND activa = 1 ORDER BY codigo",
      [empresaId],
    );
    return rows.map((r) => ({ id: Number(r.id), codigo: String(r.codigo), nombre: String(r.nombre) }));
  } catch (e) {
    if (esEsquemaPendiente(e)) return [];
    throw e;
  }
}

/** Cuentas bancarias ACTIVAS (de entidades y cuentas contables activas) de la empresa. No expone números de cuenta. */
export async function listarCuentasBancarias(empresaId: number): Promise<CuentaBancariaDisponible[]> {
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT b.id, b.entidad_id, e.nombre AS entidad_nombre, b.banco, b.alias, b.referencia, b.moneda
       FROM cont_cuentas_bancarias b
       INNER JOIN cont_entidades e ON e.empresa_id = b.empresa_id AND e.id = b.entidad_id
       INNER JOIN cont_cuentas c ON c.empresa_id = b.empresa_id AND c.entidad_id = b.entidad_id AND c.id = b.cuenta_id
       WHERE b.empresa_id = ? AND b.activa = 1 AND e.activa = 1 AND c.activa = 1
       ORDER BY e.nombre, b.banco, b.alias`,
      [empresaId],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      entidadId: Number(r.entidad_id),
      entidadNombre: String(r.entidad_nombre),
      banco: String(r.banco),
      alias: String(r.alias),
      referencia: r.referencia != null ? String(r.referencia) : null,
      moneda: String(r.moneda),
    }));
  } catch (e) {
    if (esEsquemaPendiente(e)) return [];
    throw e;
  }
}

/** Retención de IVA configurada para el cliente (0 = no aplica). Sin fila o sin esquema → 0. */
export async function leerRetencionIvaCliente(empresaId: number, clienteId: number): Promise<RetencionIvaPct> {
  try {
    const rows = await query<RowDataPacket[]>(
      "SELECT retencion_iva_pct FROM fact_cliente_perfil WHERE empresa_id = ? AND cliente_id = ? LIMIT 1",
      [empresaId, clienteId],
    );
    const v = rows[0] ? Number(rows[0].retencion_iva_pct) : 0;
    return esRetencionIvaValida(v) ? v : 0;
  } catch (e) {
    if (esEsquemaPendiente(e)) return 0;
    throw e;
  }
}

/**
 * Guarda la retención de IVA del cliente (0/15/30). El caller debe haber verificado el permiso de «Editar requisitos de
 * clientes» y que el cliente es de la empresa. No toca las respuestas del cuestionario.
 */
export async function guardarRetencionIvaCliente(
  empresaId: number,
  clienteId: number,
  pct: RetencionIvaPct,
  usuarioId: number | null,
): Promise<void> {
  if (!esRetencionIvaValida(pct)) throw new RangeError("La retención de IVA debe ser 0, 15 o 30.");
  await execute(
    `INSERT INTO fact_cliente_perfil (empresa_id, cliente_id, respuestas_json, completado_pct, actualizado_por, retencion_iva_pct)
     VALUES (?, ?, '{}', 0, ?, ?)
     ON DUPLICATE KEY UPDATE retencion_iva_pct = VALUES(retencion_iva_pct), actualizado_por = VALUES(actualizado_por)`,
    [empresaId, clienteId, usuarioId, pct],
  );
}

/** Plantilla de representación de la entidad (o la de por defecto si no hay configuración / entidad / esquema). */
export async function leerPlantillaEntidad(empresaId: number, entidadId: number | null): Promise<PlantillaFactura> {
  if (entidadId == null) return PLANTILLA_POR_DEFECTO;
  try {
    const rows = await query<RowDataPacket[]>(
      "SELECT plantilla_factura FROM fact_entidad_config WHERE empresa_id = ? AND entidad_id = ? LIMIT 1",
      [empresaId, entidadId],
    );
    const v = rows[0] ? String(rows[0].plantilla_factura) : "";
    return (PLANTILLAS_FACTURA as readonly string[]).includes(v) ? (v as PlantillaFactura) : PLANTILLA_POR_DEFECTO;
  } catch (e) {
    if (esEsquemaPendiente(e)) return PLANTILLA_POR_DEFECTO;
    throw e;
  }
}
