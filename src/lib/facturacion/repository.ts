import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { asegurarSchemaClientes } from "@/lib/clientes/schema";
import {
  CUESTIONARIO_CLIENTE,
  CUESTIONARIO_EMPRESA,
  pctCompletado,
  type RespuestasFacturacion,
} from "@/lib/facturacion/cuestionario";
import { asegurarSchemaFacturacion } from "@/lib/facturacion/schema";

function parseRespuestas(raw: unknown): RespuestasFacturacion {
  if (!raw) return {};
  try {
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return v as RespuestasFacturacion;
    }
  } catch {
    /* ignore */
  }
  return {};
}

export async function obtenerPerfilEmpresa(empresaId: number): Promise<{
  respuestas: RespuestasFacturacion;
  completadoPct: number;
  actualizadoAt: string | null;
  actualizadoPor: number | null;
}> {
  await asegurarSchemaClientes();
  await asegurarSchemaFacturacion();
  const rows = await query<RowDataPacket[]>(
    `SELECT respuestas_json, completado_pct, actualizado_at, actualizado_por
     FROM fact_empresa_perfil WHERE empresa_id = ? LIMIT 1`,
    [empresaId],
  );
  if (!rows[0]) {
    return {
      respuestas: {},
      completadoPct: 0,
      actualizadoAt: null,
      actualizadoPor: null,
    };
  }
  return {
    respuestas: parseRespuestas(rows[0].respuestas_json),
    completadoPct: Number(rows[0].completado_pct ?? 0),
    actualizadoAt:
      rows[0].actualizado_at != null ? String(rows[0].actualizado_at) : null,
    actualizadoPor:
      rows[0].actualizado_por != null
        ? Number(rows[0].actualizado_por)
        : null,
  };
}

export async function guardarPerfilEmpresa(
  empresaId: number,
  respuestas: RespuestasFacturacion,
  usuarioId: number | null,
): Promise<{ completadoPct: number }> {
  await asegurarSchemaClientes();
  await asegurarSchemaFacturacion();
  const completadoPct = pctCompletado(CUESTIONARIO_EMPRESA, respuestas);
  await execute(
    `INSERT INTO fact_empresa_perfil
       (empresa_id, respuestas_json, completado_pct, actualizado_por)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       respuestas_json = VALUES(respuestas_json),
       completado_pct = VALUES(completado_pct),
       actualizado_por = VALUES(actualizado_por)`,
    [
      empresaId,
      JSON.stringify(respuestas ?? {}),
      completadoPct,
      usuarioId,
    ],
  );
  return { completadoPct };
}

export async function obtenerPerfilCliente(
  empresaId: number,
  clienteId: number,
): Promise<{
  respuestas: RespuestasFacturacion;
  completadoPct: number;
  actualizadoAt: string | null;
}> {
  await asegurarSchemaClientes();
  await asegurarSchemaFacturacion();
  const rows = await query<RowDataPacket[]>(
    `SELECT respuestas_json, completado_pct, actualizado_at
     FROM fact_cliente_perfil
     WHERE empresa_id = ? AND cliente_id = ? LIMIT 1`,
    [empresaId, clienteId],
  );
  if (!rows[0]) {
    return { respuestas: {}, completadoPct: 0, actualizadoAt: null };
  }
  return {
    respuestas: parseRespuestas(rows[0].respuestas_json),
    completadoPct: Number(rows[0].completado_pct ?? 0),
    actualizadoAt:
      rows[0].actualizado_at != null ? String(rows[0].actualizado_at) : null,
  };
}

export async function guardarPerfilCliente(
  empresaId: number,
  clienteId: number,
  respuestas: RespuestasFacturacion,
  usuarioId: number | null,
): Promise<{ completadoPct: number }> {
  await asegurarSchemaClientes();
  await asegurarSchemaFacturacion();
  const completadoPct = pctCompletado(CUESTIONARIO_CLIENTE, respuestas);
  await execute(
    `INSERT INTO fact_cliente_perfil
       (empresa_id, cliente_id, respuestas_json, completado_pct, actualizado_por)
     VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       respuestas_json = VALUES(respuestas_json),
       completado_pct = VALUES(completado_pct),
       actualizado_por = VALUES(actualizado_por)`,
    [
      empresaId,
      clienteId,
      JSON.stringify(respuestas ?? {}),
      completadoPct,
      usuarioId,
    ],
  );
  return { completadoPct };
}

export async function resumenPerfilesClientes(empresaId: number): Promise<
  {
    clienteId: number;
    nombre: string;
    nit: string | null;
    completadoPct: number;
    actualizadoAt: string | null;
  }[]
> {
  await asegurarSchemaClientes();
  await asegurarSchemaFacturacion();
  const rows = await query<RowDataPacket[]>(
    `SELECT c.id AS cliente_id, c.nombre, c.nit,
            COALESCE(f.completado_pct, 0) AS completado_pct,
            f.actualizado_at
     FROM clientes c
     LEFT JOIN fact_cliente_perfil f
       ON f.cliente_id = c.id AND f.empresa_id = c.empresa_id
     WHERE c.empresa_id = ? AND c.estado = 'Activo'
     ORDER BY c.nombre`,
    [empresaId],
  );
  return rows.map((r) => ({
    clienteId: Number(r.cliente_id),
    nombre: String(r.nombre),
    nit: r.nit != null ? String(r.nit) : null,
    completadoPct: Number(r.completado_pct ?? 0),
    actualizadoAt:
      r.actualizado_at != null ? String(r.actualizado_at) : null,
  }));
}
