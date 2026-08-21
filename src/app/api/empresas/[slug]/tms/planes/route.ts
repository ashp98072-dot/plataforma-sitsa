import { NextResponse } from "next/server";
import { z } from "zod";
import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { registrarAuditoria } from "@/lib/auditoria";
import { requireTenantModulo } from "@/lib/tenant";
import { asegurarSchemaFlota } from "@/lib/flota/schema";
import {
  listarDisponibilidadVehiculos,
  placasDisponiblesParaPlan,
} from "@/lib/operaciones/disponibilidad";
import {
  asegurarCodigoPlanUnico,
  generarCodigoPlan,
} from "@/lib/tms/codigo-plan";
import {
  guardarParadasPlan,
  listarParadasDePlanes,
  type ParadaInput,
} from "@/lib/tms/paradas";

type Ctx = { params: Promise<{ slug: string }> };

/** Auxiliar de un plan con su id real de tms_personal (Fase P4.3). */
type AuxiliarPlan = { personalId: number; nombre: string };

async function auxiliaresDePlanes(
  planIds: number[],
): Promise<Map<number, AuxiliarPlan[]>> {
  const map = new Map<number, AuxiliarPlan[]>();
  const ids = [...new Set(planIds.map(Number).filter((id) => id > 0))];
  if (!ids.length) return map;
  try {
    const placeholders = ids.map(() => "?").join(",");
    const rows = await query<RowDataPacket[]>(
      `SELECT a.plan_id, a.personal_id, per.nombre
       FROM tms_plan_auxiliares a
       INNER JOIN tms_personal per ON per.id = a.personal_id
       WHERE a.plan_id IN (${placeholders})
       ORDER BY a.plan_id, a.orden, a.id`,
      ids,
    );
    for (const r of rows) {
      const pid = Number(r.plan_id);
      const list = map.get(pid) ?? [];
      list.push({ personalId: Number(r.personal_id), nombre: String(r.nombre) });
      map.set(pid, list);
    }
  } catch {
    /* tabla aún no existe */
  }
  return map;
}

export async function GET(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "tms");
  if (guard.error) return guard.error;

  const url = new URL(req.url);
  if (url.searchParams.get("nextCodigo") === "1") {
    const fecha =
      url.searchParams.get("fecha") ||
      new Date().toISOString().slice(0, 10);
    const codigo = await generarCodigoPlan(guard.empresa.id, fecha);
    return NextResponse.json(
      { codigo },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  }

  try {
    await asegurarSchemaFlota();
  } catch {
    /* ok */
  }

  const [rows, disp] = await Promise.all([
    query<RowDataPacket[]>(
      `SELECT p.id, p.codigo, p.fecha_plan, p.hora_carga, p.estado, p.tipo_traslado, p.notas,
              c.nombre AS cliente, u.placa, pil.nombre AS piloto, aux.nombre AS auxiliar,
              p.piloto_id, p.auxiliar_id,
              COALESCE(ev.cnt, 0) AS evidencias
       FROM tms_planes_viaje p
       LEFT JOIN tms_clientes c ON c.id = p.cliente_id
       LEFT JOIN tms_unidades u ON u.id = p.unidad_id
       LEFT JOIN tms_personal pil ON pil.id = p.piloto_id
       LEFT JOIN tms_personal aux ON aux.id = p.auxiliar_id
       LEFT JOIN (
         SELECT plan_id, COUNT(*) AS cnt
         FROM tms_evidencias
         GROUP BY plan_id
       ) ev ON ev.plan_id = p.id
       WHERE p.empresa_id = ?
       ORDER BY p.fecha_plan DESC, p.id DESC
       LIMIT 200`,
      [guard.empresa.id],
    ),
    listarDisponibilidadVehiculos(guard.empresa.id).catch(() => null),
  ]);

  const planIds = rows.map((r) => Number(r.id));
  const [paradasMap, auxMap] = await Promise.all([
    listarParadasDePlanes(planIds),
    auxiliaresDePlanes(planIds),
  ]);

  const planes = rows.map((r) => {
    const id = Number(r.id);
    // piloto_id/auxiliar_id se separan del resto para no duplicarlos en el
    // payload junto a sus versiones camelCase (pilotoId/auxiliaresDetalle).
    const { piloto_id, auxiliar_id, ...resto } = r;
    const pilotoId = piloto_id != null ? Number(piloto_id) : null;

    const extras = auxMap.get(id) ?? [];
    // Fase P4.3: misma semántica de siempre — si tms_plan_auxiliares tiene
    // filas para este plan, se usan esas (ya con personal_id real); si no,
    // fallback al auxiliar_id legado de la columna singular de la propia
    // tms_planes_viaje (que SÍ es un personal_id real, vía su FK). No es
    // una unión de ambos — es "preferir lo nuevo, si no hay, usar lo
    // legado", igual que el comportamiento previo para `auxiliares`.
    const auxiliaresDetalle: AuxiliarPlan[] =
      extras.length > 0
        ? extras
        : auxiliar_id != null && r.auxiliar
          ? [{ personalId: Number(auxiliar_id), nombre: String(r.auxiliar) }]
          : [];
    const auxList = auxiliaresDetalle.map((a) => a.nombre);
    const paradas = paradasMap.get(id) ?? [];
    return {
      ...resto,
      // Aditivo (Fase P4.3): id real del piloto, cuando existe.
      pilotoId,
      auxiliares: auxList,
      auxiliar: auxList.join(", ") || null,
      // Aditivo (Fase P4.3): auxiliares con su personal_id real. No
      // reemplaza `auxiliares` (string[]) — TMS y otros consumidores
      // existentes siguen leyendo ese campo tal cual.
      auxiliaresDetalle,
      paradas,
      paradasPendientes: paradas.filter(
        (p) => p.requiere_evidencia && p.evidencias < 1,
      ).length,
    };
  });

  const vehiculos = disp?.vehiculos ?? [];
  const placasFlota = placasDisponiblesParaPlan(vehiculos);
  const vehiculosDisponibles = vehiculos
    .filter((v) => v.puedeEnviar)
    .map((v) => ({
      placa: v.placa,
      marca: v.marca,
      modelo: v.modelo,
      compartido: v.compartido,
      esPropio: v.esPropio,
    }));
  const resumenFlota = disp?.resumen ?? {
    total: 0,
    disponibles: placasFlota.length,
    enTaller: 0,
    enRuta: 0,
    inactivos: 0,
    propios: 0,
    compartidos: 0,
  };
  // Fase P3 (Programación): estado real por placa, sin queries nuevas — ya
  // estaba calculado en `vehiculos` (listarDisponibilidadVehiculos), solo
  // se exponía filtrado/recortado como vehiculosDisponibles. No cambia
  // listarDisponibilidadVehiculos ni la lógica de disponibilidad.
  const estadoVehiculos = vehiculos.map((v) => ({
    placa: v.placa,
    estadoDisponibilidad: v.estadoDisponibilidad,
    motivoNoDisponible: v.motivoNoDisponible,
  }));

  return NextResponse.json(
    {
      planes,
      placasFlota,
      vehiculosDisponibles,
      estadoVehiculos,
      resumenFlota,
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}

const schema = z.object({
  codigo: z.string().optional(),
  fechaPlan: z.string().min(1),
  horaCarga: z.string().optional(),
  tipoTraslado: z.string().optional(),
  notas: z.string().optional(),
  clienteId: z.number().int().positive().optional(),
  clienteNombre: z.string().optional(),
  placa: z.string().optional(),
  pilotoNombre: z.string().optional(),
  auxiliarNombre: z.string().optional(),
  auxiliarNombres: z.array(z.string().min(2)).max(8).optional(),
  pilotoEmpleadoId: z.number().int().positive().optional(),
  auxiliarEmpleadoId: z.number().int().positive().optional(),
  auxiliarEmpleadoIds: z.array(z.number().int().positive()).max(8).optional(),
  lugarCarga: z.string().optional(),
  lugarDescarga: z.string().optional(),
  paradas: z
    .array(
      z.object({
        lugarNombre: z.string().min(1),
        tipo: z.enum(["Carga", "Descarga", "Entrega"]).optional(),
        requiereEvidencia: z.boolean().optional(),
      }),
    )
    .max(20)
    .optional(),
});

async function personalDesdeEmpleado(
  empresaId: number,
  empleadoId: number | undefined,
  tipo: "Piloto" | "Auxiliar",
): Promise<number | null> {
  if (!empleadoId) return null;
  const emp = await query<RowDataPacket[]>(
    `SELECT id, codigo, nombre FROM empleados
     WHERE id = ? AND empresa_id = ? AND estado = 'Activo' LIMIT 1`,
    [empleadoId, empresaId],
  );
  if (!emp[0]) return null;
  const codigo = String(emp[0].codigo);
  const nombre = String(emp[0].nombre);
  const existing = await query<RowDataPacket[]>(
    `SELECT id FROM tms_personal
     WHERE empresa_id = ? AND codigo = ? AND tipo = ? LIMIT 1`,
    [empresaId, codigo, tipo],
  );
  if (existing[0]) return Number(existing[0].id);
  const r = await execute(
    `INSERT INTO tms_personal (empresa_id, codigo, nombre, tipo, estado)
     VALUES (?, ?, ?, ?, 'Activo')`,
    [empresaId, codigo, nombre, tipo],
  );
  return Number(r.insertId);
}

async function upsertLugar(
  empresaId: number,
  nombre: string | undefined,
  tipo: string,
): Promise<number | null> {
  if (!nombre?.trim()) return null;
  const existing = await query<RowDataPacket[]>(
    "SELECT id FROM tms_lugares WHERE empresa_id = ? AND nombre = ? LIMIT 1",
    [empresaId, nombre.trim()],
  );
  if (existing[0]) return Number(existing[0].id);
  const r = await execute(
    "INSERT INTO tms_lugares (empresa_id, nombre, tipo) VALUES (?, ?, ?)",
    [empresaId, nombre.trim(), tipo],
  );
  return Number(r.insertId);
}

async function guardarAuxiliaresPlan(
  planId: number,
  personalIds: number[],
): Promise<void> {
  try {
    await execute("DELETE FROM tms_plan_auxiliares WHERE plan_id = ?", [planId]);
    let orden = 1;
    for (const pid of personalIds.slice(0, 8)) {
      await execute(
        `INSERT INTO tms_plan_auxiliares (plan_id, personal_id, orden)
         VALUES (?, ?, ?)`,
        [planId, pid, orden++],
      );
    }
  } catch {
    /* tabla aún no existe */
  }
}

export async function POST(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "tms", true);
  if (guard.error) return guard.error;

  try {
    await asegurarSchemaFlota();
  } catch {
    /* ok */
  }

  const parsed = schema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;
  const empresaId = guard.empresa.id;
  let clienteId: number | null = null;
  let unidadId: number | null = null;
  let pilotoId: number | null = null;

  const codigo = await asegurarCodigoPlanUnico(
    empresaId,
    d.fechaPlan,
    d.codigo,
  );

  if (d.clienteId) {
    const found = await query<RowDataPacket[]>(
      "SELECT id FROM tms_clientes WHERE empresa_id = ? AND id = ? LIMIT 1",
      [empresaId, d.clienteId],
    );
    if (found[0]) clienteId = Number(found[0].id);
  }
  if (!clienteId && d.clienteNombre?.trim()) {
    const found = await query<RowDataPacket[]>(
      "SELECT id FROM tms_clientes WHERE empresa_id = ? AND nombre = ? LIMIT 1",
      [empresaId, d.clienteNombre.trim()],
    );
    if (found[0]) {
      clienteId = Number(found[0].id);
    } else {
      try {
        const { crearClienteDesdeTms } = await import(
          "@/lib/clientes/repository"
        );
        const created = await crearClienteDesdeTms(empresaId, {
          nombre: d.clienteNombre.trim(),
        });
        clienteId = created.tmsClienteId;
      } catch {
        const r = await execute(
          "INSERT INTO tms_clientes (empresa_id, nombre) VALUES (?, ?)",
          [empresaId, d.clienteNombre.trim()],
        );
        clienteId = Number(r.insertId);
      }
    }
  }
  if (d.placa?.trim()) {
    const placaNorm = d.placa.trim().toUpperCase();
    // Fase A4.2: si listarDisponibilidadVehiculos (server-side, ya valida
    // acceso propio/compartido contra Flota) encontró el vehículo real,
    // guardamos también su id en tms_unidades.flota_vehiculo_id. Nunca se
    // confía en un id enviado por el cliente — sale exclusivamente de esta
    // consulta ya validada.
    let flotaVehiculoId: number | null = null;
    try {
      const dispCheck = await listarDisponibilidadVehiculos(empresaId);
      const v = dispCheck.vehiculos.find(
        (x) => x.placa.toUpperCase() === placaNorm,
      );
      if (v && !v.puedeEnviar) {
        return NextResponse.json(
          {
            error: `La placa ${placaNorm} no está disponible: ${v.motivoNoDisponible ?? v.estadoDisponibilidad}.`,
          },
          { status: 400 },
        );
      }
      flotaVehiculoId = v?.id ?? null;
    } catch {
      /* si falla disponibilidad, no bloquear creación */
    }
    const r = await execute(
      `INSERT INTO tms_unidades (empresa_id, placa, tipo, flota_vehiculo_id)
       VALUES (?, ?, 'Camion', ?)
       ON DUPLICATE KEY UPDATE
         id = LAST_INSERT_ID(id),
         flota_vehiculo_id = COALESCE(flota_vehiculo_id, VALUES(flota_vehiculo_id))`,
      [empresaId, placaNorm, flotaVehiculoId],
    );
    unidadId = Number(r.insertId);
  }
  pilotoId = await personalDesdeEmpleado(
    empresaId,
    d.pilotoEmpleadoId,
    "Piloto",
  );
  if (!pilotoId && d.pilotoNombre?.trim()) {
    const r = await execute(
      "INSERT INTO tms_personal (empresa_id, nombre, tipo) VALUES (?, ?, 'Piloto')",
      [empresaId, d.pilotoNombre.trim()],
    );
    pilotoId = Number(r.insertId);
  }

  const auxIdsRaw =
    d.auxiliarEmpleadoIds?.length
      ? d.auxiliarEmpleadoIds
      : d.auxiliarEmpleadoId
        ? [d.auxiliarEmpleadoId]
        : [];
  const auxPersonalIds: number[] = [];
  for (const eid of auxIdsRaw.slice(0, 8)) {
    const pid = await personalDesdeEmpleado(empresaId, eid, "Auxiliar");
    if (pid) auxPersonalIds.push(pid);
  }
  const nombresAux = [
    ...(d.auxiliarNombres ?? []),
    ...(d.auxiliarNombre?.trim() ? [d.auxiliarNombre.trim()] : []),
  ];
  for (const nom of nombresAux) {
    if (auxPersonalIds.length >= 8) break;
    const nombre = nom.trim();
    if (nombre.length < 2) continue;
    const existing = await query<RowDataPacket[]>(
      `SELECT id FROM tms_personal
       WHERE empresa_id = ? AND tipo = 'Auxiliar' AND LOWER(TRIM(nombre)) = LOWER(?)
       LIMIT 1`,
      [empresaId, nombre],
    );
    if (existing[0]) {
      auxPersonalIds.push(Number(existing[0].id));
      continue;
    }
    const r = await execute(
      "INSERT INTO tms_personal (empresa_id, nombre, tipo) VALUES (?, ?, 'Auxiliar')",
      [empresaId, nombre],
    );
    auxPersonalIds.push(Number(r.insertId));
  }
  const auxiliarId = auxPersonalIds[0] ?? null;

  // Paradas: array nuevo o compatibilidad con 2 campos clásicos
  let paradasInput: ParadaInput[] = (d.paradas ?? []).filter((p) =>
    p.lugarNombre?.trim(),
  );
  if (!paradasInput.length) {
    if (d.lugarCarga?.trim()) {
      paradasInput.push({
        lugarNombre: d.lugarCarga.trim(),
        tipo: "Carga",
        requiereEvidencia: true,
      });
    }
    if (d.lugarDescarga?.trim()) {
      paradasInput.push({
        lugarNombre: d.lugarDescarga.trim(),
        tipo: "Descarga",
        requiereEvidencia: true,
      });
    }
  }

  const lugarCargaId = await upsertLugar(
    empresaId,
    paradasInput.find((p) => p.tipo === "Carga")?.lugarNombre || d.lugarCarga,
    "Carga",
  );
  const lugarDescargaId = await upsertLugar(
    empresaId,
    paradasInput.find((p) => p.tipo === "Descarga" || p.tipo === "Entrega")
      ?.lugarNombre || d.lugarDescarga,
    "Descarga",
  );

  let planId = 0;
  let codigoFinal = codigo;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const result = await execute(
        `INSERT INTO tms_planes_viaje
          (empresa_id, codigo, cliente_id, lugar_carga_id, lugar_descarga_id, unidad_id, piloto_id, auxiliar_id, fecha_plan, hora_carga, tipo_traslado, notas, estado)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Programado')`,
        [
          empresaId,
          codigoFinal,
          clienteId,
          lugarCargaId,
          lugarDescargaId,
          unidadId,
          pilotoId,
          auxiliarId,
          d.fechaPlan,
          d.horaCarga ?? null,
          d.tipoTraslado ?? null,
          d.notas ?? null,
        ],
      );
      planId = Number(result.insertId);
      break;
    } catch {
      codigoFinal = await asegurarCodigoPlanUnico(
        empresaId,
        d.fechaPlan,
        null,
      );
    }
  }
  if (!planId) {
    return NextResponse.json(
      { error: "No se pudo generar un código de plan único. Intenta de nuevo." },
      { status: 409 },
    );
  }
  await guardarAuxiliaresPlan(planId, auxPersonalIds);
  if (paradasInput.length) {
    await guardarParadasPlan(empresaId, planId, paradasInput);
  }

  const paradasTxt = paradasInput
    .map((p, i) => `${i + 1}.${p.lugarNombre}(${p.tipo ?? "?"})`)
    .join("; ");
  await registrarAuditoria({
    empresaId,
    usuario: guard.session.username,
    accion: "crear_ruta",
    modulo: "tms",
    detalle: `Plan #${planId} ${codigoFinal} · fecha ${d.fechaPlan} · piloto ${d.pilotoNombre?.trim() || "—"} · placa ${(d.placa || "").toUpperCase() || "—"} · ${paradasInput.length} parada(s)${paradasTxt ? `: ${paradasTxt}` : ""}`,
  });

  return NextResponse.json({
    id: planId,
    codigo: codigoFinal,
    mensaje: `Plan ${codigoFinal} creado${
      auxPersonalIds.length > 1
        ? ` con ${auxPersonalIds.length} auxiliares`
        : ""
    }${paradasInput.length ? ` · ${paradasInput.length} parada(s)` : ""}.`,
  });
}

const patchSchema = z.object({
  id: z.number().int().positive(),
  pilotoNombre: z.string().optional(),
  auxiliarNombre: z.string().optional(),
  auxiliarNombres: z.array(z.string().min(2)).max(8).optional(),
  auxiliarEmpleadoIds: z.array(z.number().int().positive()).max(8).optional(),
  placa: z.string().optional(),
  estado: z
    .enum([
      "Programado",
      "En ruta",
      "Cargado",
      "Descargado",
      "Cerrado",
      "Cancelado",
    ])
    .optional(),
  notas: z.string().optional(),
  horaCarga: z.string().optional(),
  paradas: z
    .array(
      z.object({
        lugarNombre: z.string().min(1),
        tipo: z.enum(["Carga", "Descarga", "Entrega"]).optional(),
        requiereEvidencia: z.boolean().optional(),
      }),
    )
    .max(20)
    .optional(),
});

export async function PATCH(req: Request, ctx: Ctx) {
  const { slug } = await ctx.params;
  const guard = await requireTenantModulo(slug, "tms", true);
  if (guard.error) return guard.error;

  try {
    await asegurarSchemaFlota();
  } catch {
    /* ok */
  }

  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: "Datos inválidos." }, { status: 400 });
  }
  const d = parsed.data;
  const empresaId = guard.empresa.id;

  const plan = await query<RowDataPacket[]>(
    `SELECT p.id, p.codigo, p.estado, p.hora_carga, p.notas,
            u.placa, pil.nombre AS piloto
     FROM tms_planes_viaje p
     LEFT JOIN tms_unidades u ON u.id = p.unidad_id
     LEFT JOIN tms_personal pil ON pil.id = p.piloto_id
     WHERE p.id = ? AND p.empresa_id = ? LIMIT 1`,
    [d.id, empresaId],
  );
  if (!plan[0]) {
    return NextResponse.json({ error: "Plan no encontrado." }, { status: 404 });
  }
  const antes = {
    codigo: String(plan[0].codigo ?? ""),
    estado: String(plan[0].estado ?? ""),
    placa: plan[0].placa ? String(plan[0].placa) : "",
    piloto: plan[0].piloto ? String(plan[0].piloto) : "",
    hora: plan[0].hora_carga ? String(plan[0].hora_carga) : "",
  };

  let pilotoId: number | undefined;
  let auxiliarId: number | null | undefined;
  let unidadId: number | undefined;

  if (d.pilotoNombre?.trim()) {
    const existingPil = await query<RowDataPacket[]>(
      `SELECT id FROM tms_personal
       WHERE empresa_id = ? AND tipo = 'Piloto' AND LOWER(TRIM(nombre)) = LOWER(?)
       LIMIT 1`,
      [empresaId, d.pilotoNombre.trim()],
    );
    if (existingPil[0]) {
      pilotoId = Number(existingPil[0].id);
    } else {
      const r = await execute(
        "INSERT INTO tms_personal (empresa_id, nombre, tipo) VALUES (?, ?, 'Piloto')",
        [empresaId, d.pilotoNombre.trim()],
      );
      pilotoId = Number(r.insertId);
    }
  }

  const actualizarAux =
    d.auxiliarEmpleadoIds != null ||
    d.auxiliarNombres != null ||
    d.auxiliarNombre != null;
  if (actualizarAux) {
    const auxPersonalIds: number[] = [];
    for (const eid of (d.auxiliarEmpleadoIds ?? []).slice(0, 8)) {
      const pid = await personalDesdeEmpleado(empresaId, eid, "Auxiliar");
      if (pid) auxPersonalIds.push(pid);
    }
    const nombresAux = [
      ...(d.auxiliarNombres ?? []),
      ...(d.auxiliarNombre?.trim() ? [d.auxiliarNombre.trim()] : []),
    ];
    for (const nom of nombresAux) {
      if (auxPersonalIds.length >= 8) break;
      const nombre = nom.trim();
      if (nombre.length < 2) continue;
      const existing = await query<RowDataPacket[]>(
        `SELECT id FROM tms_personal
         WHERE empresa_id = ? AND tipo = 'Auxiliar' AND LOWER(TRIM(nombre)) = LOWER(?)
         LIMIT 1`,
        [empresaId, nombre],
      );
      if (existing[0]) {
        const id = Number(existing[0].id);
        if (!auxPersonalIds.includes(id)) auxPersonalIds.push(id);
        continue;
      }
      const r = await execute(
        "INSERT INTO tms_personal (empresa_id, nombre, tipo) VALUES (?, ?, 'Auxiliar')",
        [empresaId, nombre],
      );
      auxPersonalIds.push(Number(r.insertId));
    }
    auxiliarId = auxPersonalIds[0] ?? null;
    await guardarAuxiliaresPlan(d.id, auxPersonalIds);
  }
  if (d.placa?.trim()) {
    const r = await execute(
      `INSERT INTO tms_unidades (empresa_id, placa, tipo)
       VALUES (?, ?, 'Camion')
       ON DUPLICATE KEY UPDATE id=LAST_INSERT_ID(id)`,
      [empresaId, d.placa.trim().toUpperCase()],
    );
    unidadId = Number(r.insertId);
  }

  await execute(
    `UPDATE tms_planes_viaje SET
      piloto_id = COALESCE(?, piloto_id),
      auxiliar_id = COALESCE(?, auxiliar_id),
      unidad_id = COALESCE(?, unidad_id),
      estado = COALESCE(?, estado),
      notas = COALESCE(?, notas),
      hora_carga = COALESCE(?, hora_carga)
     WHERE id = ? AND empresa_id = ?`,
    [
      pilotoId ?? null,
      auxiliarId ?? null,
      unidadId ?? null,
      d.estado ?? null,
      d.notas ?? null,
      d.horaCarga ?? null,
      d.id,
      empresaId,
    ],
  );

  if (d.paradas) {
    const paradasInput = d.paradas.filter((p) => p.lugarNombre?.trim());
    await guardarParadasPlan(empresaId, d.id, paradasInput);
  }

  const cambios: string[] = [];
  if (d.estado && d.estado !== antes.estado) {
    cambios.push(`estado ${antes.estado} → ${d.estado}`);
  }
  if (d.pilotoNombre?.trim()) {
    cambios.push(`piloto → ${d.pilotoNombre.trim()}`);
  }
  if (d.placa?.trim()) {
    cambios.push(`placa → ${d.placa.trim().toUpperCase()}`);
  }
  if (d.horaCarga != null) {
    cambios.push(`hora → ${d.horaCarga}`);
  }
  if (d.notas != null) {
    cambios.push("notas actualizadas");
  }
  if (
    d.auxiliarEmpleadoIds != null ||
    d.auxiliarNombres != null ||
    d.auxiliarNombre != null
  ) {
    cambios.push("auxiliares actualizados");
  }
  if (d.paradas) {
    const n = d.paradas.filter((p) => p.lugarNombre?.trim()).length;
    cambios.push(`paradas redefinidas (${n})`);
  }
  const accion =
    d.estado === "Cancelado" && d.estado !== antes.estado
      ? "cancelar_ruta"
      : "editar_ruta";
  await registrarAuditoria({
    empresaId,
    usuario: guard.session.username,
    accion,
    modulo: "tms",
    detalle: `Plan #${d.id} ${antes.codigo}${
      cambios.length ? ` · ${cambios.join("; ")}` : " · sin cambios detectados"
    }`,
  });

  return NextResponse.json({ mensaje: "Plan actualizado." });
}
