import { NextResponse } from "next/server";
import type { RowDataPacket } from "mysql2";
import { query } from "@/lib/db";
import { requireTenantProgramacionOTms } from "@/lib/tenant";
import { asegurarVinculosTmsClientes } from "@/lib/clientes/repository";
import {
  asegurarModulosClientesFacturacion,
  asegurarSchemaClientes,
} from "@/lib/clientes/schema";

type Ctx = { params: Promise<{ slug: string }> };

/** Proyección privada para los filtros de Planes; el catálogo de Programación no cambia. */
export async function GET(_req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantProgramacionOTms(slug);
  if (guard.error) return guard.error;
  const eid = guard.empresa.id;

  // Conservar el mismo puente y tolerancia a instalaciones parciales de /tms/catalogos.
  try {
    await asegurarSchemaClientes();
    await asegurarModulosClientesFacturacion(eid);
    await asegurarVinculosTmsClientes(eid);
  } catch {
    /* TMS sigue aunque clientes aún no esté migrado */
  }

  const [shared, tmsClientes, unidades, personal] = await Promise.all([
    asegurarSchemaClientes()
      .then(() => query<RowDataPacket[]>(
        "SELECT tms_cliente_id, nombre FROM clientes WHERE empresa_id = ? ORDER BY nombre",
        [eid],
      ))
      .catch(() => []),
    query<RowDataPacket[]>(
      "SELECT id, nombre FROM tms_clientes WHERE empresa_id = ? ORDER BY nombre",
      [eid],
    ),
    query<RowDataPacket[]>(
      "SELECT id, placa FROM tms_unidades WHERE empresa_id = ? ORDER BY placa",
      [eid],
    ),
    query<RowDataPacket[]>(
      "SELECT id, nombre, tipo FROM tms_personal WHERE empresa_id = ? ORDER BY nombre",
      [eid],
    ),
  ]);

  // Igual que listarClientes + el puente actual: último vínculo gana, nombre compartido
  // preferido, pero orden de tms_clientes. No filtrar inactivos ni ordenar por el alias.
  const byTms = new Map(shared
    .filter((c) => c.tms_cliente_id != null)
    .map((c) => [Number(c.tms_cliente_id), String(c.nombre)]));

  return NextResponse.json({
    clientes: tmsClientes.map((t) => ({
      id: Number(t.id),
      nombre: byTms.get(Number(t.id)) ?? String(t.nombre),
    })),
    unidades,
    // Comparación JS exacta como el consumidor anterior (no depende de la collation SQL).
    pilotos: personal.filter((p) => p.tipo === "Piloto")
      .map((p) => ({ id: p.id, nombre: p.nombre })),
  }, { headers: { "Cache-Control": "private, no-store" } });
}
