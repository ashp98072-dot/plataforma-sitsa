import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { ahoraLocal } from "@/lib/rrhh/dates";
import { rangoMes } from "@/lib/rrhh/resumen-mensual";
import { contentTypeFor, guardarUpload } from "@/lib/uploads";

/**
 * FLOTA-COMBUSTIBLE-1 — control de combustible (Fase 1: captura del
 * piloto). El piloto registra, desde su Portal y siempre ligado a un
 * viaje abierto/propio (flota_viajes), cuánto cargó de diesel/gasolina,
 * el monto pagado, el kilometraje y la foto del vale — igual patrón de
 * archivo que guardarEvidenciaViaje() (mismo guardarUpload(), mismo
 * subdir "flota"). Queda en estado PENDIENTE; la revisión/aprobación de
 * Operaciones es una fase aparte, todavía no construida.
 */

export type TipoCombustible = "diesel" | "gasolina";

export type EstadoCargaCombustible = "PENDIENTE" | "APROBADO" | "RECHAZADO";

export type CargaCombustible = {
  id: number;
  viajeId: number;
  tipoCombustible: TipoCombustible;
  galones: number;
  monto: number;
  km: number | null;
  gasolinera: string | null;
  nombreArchivo: string;
  estado: EstadoCargaCombustible;
  motivoRechazo: string | null;
  creadoPor: string;
  creadoEn: string;
};

/** Fase 2 (revisión de Operaciones): incluye placa/piloto para la bandeja de staff. */
export type CargaCombustibleRevision = CargaCombustible & {
  placa: string;
  pilotoNombre: string;
  revisadoPor: string | null;
  revisadoEn: string | null;
};

type UploadLike = {
  name: string;
  size: number;
  type?: string;
  arrayBuffer: () => Promise<ArrayBuffer>;
};

function mapCarga(r: RowDataPacket): CargaCombustible {
  return {
    id: Number(r.id),
    viajeId: Number(r.viaje_id),
    tipoCombustible: String(r.tipo_combustible) === "gasolina" ? "gasolina" : "diesel",
    galones: Number(r.galones),
    monto: Number(r.monto),
    km: r.km != null ? Number(r.km) : null,
    gasolinera: r.gasolinera ? String(r.gasolinera) : null,
    nombreArchivo: String(r.nombre_original),
    estado: (["PENDIENTE", "APROBADO", "RECHAZADO"] as const).includes(r.estado)
      ? (r.estado as CargaCombustible["estado"])
      : "PENDIENTE",
    motivoRechazo: r.motivo_rechazo ? String(r.motivo_rechazo) : null,
    creadoPor: String(r.creado_por),
    creadoEn: String(r.creado_at),
  };
}

/**
 * `viajeId`/`vehiculoId`/`empleadoId` ya deben venir validados por el
 * caller (el route verifica con colaboradorParticipaEnViaje() que el
 * piloto participa en ESE viaje, igual que hace evidencias) — esta
 * función no vuelve a comprobar pertenencia, solo persiste.
 */
export async function registrarCargaCombustible(opts: {
  empresaId: number;
  vehiculoId: number;
  viajeId: number;
  empleadoId: number;
  pilotoNombre: string;
  tipoCombustible: TipoCombustible;
  galones: number;
  monto: number;
  km: number | null;
  gasolinera: string | null;
  file: UploadLike;
  username: string;
}): Promise<number> {
  const saved = await guardarUpload(
    opts.empresaId,
    "flota",
    `combustible_${opts.viajeId}`,
    opts.file,
  );
  const ahora = ahoraLocal();
  const r = await execute(
    `INSERT INTO flota_combustible_cargas
      (empresa_id, vehiculo_id, viaje_id, empleado_id, piloto_nombre, tipo_combustible,
       galones, monto, km, gasolinera, ruta_relativa, nombre_original, mime, tamano,
       estado, creado_por, creado_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDIENTE', ?, ?)`,
    [
      opts.empresaId,
      opts.vehiculoId,
      opts.viajeId,
      opts.empleadoId,
      opts.pilotoNombre,
      opts.tipoCombustible,
      opts.galones,
      opts.monto,
      opts.km,
      opts.gasolinera,
      saved.relative,
      saved.original,
      contentTypeFor(saved.original),
      saved.size,
      opts.username,
      ahora,
    ],
  );
  return Number(r.insertId);
}

export async function listarCargasCombustibleViaje(
  empresaId: number,
  viajeId: number,
): Promise<CargaCombustible[]> {
  const rows = await query<RowDataPacket[]>(
    `SELECT id, viaje_id, tipo_combustible, galones, monto, km, gasolinera,
            nombre_original, estado, motivo_rechazo, creado_por, creado_at
     FROM flota_combustible_cargas
     WHERE empresa_id = ? AND viaje_id = ?
     ORDER BY id DESC`,
    [empresaId, viajeId],
  );
  return rows.map(mapCarga);
}

/** Solo lo necesario para servir la foto del vale (ruta/mime), acotado a empresa + viaje. */
export async function obtenerArchivoCargaCombustible(
  empresaId: number,
  viajeId: number,
  cargaId: number,
): Promise<{ rutaRelativa: string; nombreOriginal: string; mime: string | null } | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT ruta_relativa, nombre_original, mime FROM flota_combustible_cargas
     WHERE id = ? AND viaje_id = ? AND empresa_id = ? LIMIT 1`,
    [cargaId, viajeId, empresaId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    rutaRelativa: String(row.ruta_relativa),
    nombreOriginal: String(row.nombre_original),
    mime: row.mime ? String(row.mime) : null,
  };
}

/**
 * FLOTA-COMBUSTIBLE-1 (Fase 2) — versión para Operaciones: acotada solo a
 * empresa + id (no a un viaje específico, a diferencia de la del piloto
 * arriba), porque quien revisa tiene autoridad sobre TODOS los viajes de
 * la empresa, no solo el suyo.
 */
export async function obtenerArchivoCargaCombustiblePorEmpresa(
  empresaId: number,
  cargaId: number,
): Promise<{ rutaRelativa: string; nombreOriginal: string; mime: string | null } | null> {
  const rows = await query<RowDataPacket[]>(
    `SELECT ruta_relativa, nombre_original, mime FROM flota_combustible_cargas
     WHERE id = ? AND empresa_id = ? LIMIT 1`,
    [cargaId, empresaId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    rutaRelativa: String(row.ruta_relativa),
    nombreOriginal: String(row.nombre_original),
    mime: row.mime ? String(row.mime) : null,
  };
}

function mapCargaRevision(r: RowDataPacket): CargaCombustibleRevision {
  return {
    ...mapCarga(r),
    placa: String(r.placa ?? "—"),
    pilotoNombre: String(r.piloto_nombre ?? "—"),
    revisadoPor: r.revisado_por ? String(r.revisado_por) : null,
    revisadoEn: r.revisado_en ? String(r.revisado_en) : null,
  };
}

/**
 * FLOTA-COMBUSTIBLE-1 (Fase 2, ajustado en FLOTA-COMBUSTIBLE-HARDENING-1)
 * — bandeja de revisión de Operaciones. `estado` filtra Pendiente/
 * Aprobado/Rechazado (sin filtro = todas); `desde`/`hasta` filtran por
 * fecha de creación (YYYY-MM-DD), para el corte mensual; `vehiculoId`
 * acota a una unidad. Reutiliza el mismo criterio de aislamiento por
 * empresa que el resto del módulo — nunca cruza cargas de otra empresa
 * aunque compartan vehiculo_id por coincidencia (flota_vehiculo_acceso
 * no aplica aquí: la carga es propiedad de la empresa que la registró,
 * no del vehículo compartido).
 *
 * `resumen` (conteo por estado, para las 3 pestañas de la bandeja) usa
 * los MISMOS filtros de fecha/vehículo que el listado — pero NUNCA el
 * filtro `estado` — para que Pendientes/Aprobados/Rechazados reflejen el
 * mismo universo filtrado (p.ej. "septiembre + vehículo X") en vez de
 * los totales históricos de toda la empresa sin importar qué filtro esté
 * activo en la pantalla.
 */
export async function listarCargasCombustibleRevision(
  empresaId: number,
  filtros: { estado?: EstadoCargaCombustible; desde?: string; hasta?: string; vehiculoId?: number } = {},
): Promise<{ items: CargaCombustibleRevision[]; resumen: Record<EstadoCargaCombustible, number> }> {
  // Condiciones base compartidas por el listado y el resumen — SIN
  // `estado`, a propósito (ver JSDoc).
  const condicionesBase = ["c.empresa_id = ?"];
  const paramsBase: (string | number)[] = [empresaId];
  if (filtros.desde) {
    condicionesBase.push("c.creado_at >= ?");
    paramsBase.push(`${filtros.desde} 00:00:00`);
  }
  if (filtros.hasta) {
    condicionesBase.push("c.creado_at <= ?");
    paramsBase.push(`${filtros.hasta} 23:59:59`);
  }
  if (filtros.vehiculoId) {
    condicionesBase.push("c.vehiculo_id = ?");
    paramsBase.push(filtros.vehiculoId);
  }

  const condiciones = [...condicionesBase];
  const params = [...paramsBase];
  if (filtros.estado) {
    condiciones.push("c.estado = ?");
    params.push(filtros.estado);
  }
  const where = condiciones.join(" AND ");
  const rows = await query<RowDataPacket[]>(
    `SELECT c.id, c.viaje_id, c.tipo_combustible, c.galones, c.monto, c.km, c.gasolinera,
            c.nombre_original, c.estado, c.motivo_rechazo, c.creado_por, c.creado_at,
            c.revisado_por, c.revisado_en, c.piloto_nombre, v.placa
     FROM flota_combustible_cargas c
     INNER JOIN flota_vehiculos v ON v.id = c.vehiculo_id
     WHERE ${where}
     ORDER BY c.id DESC
     LIMIT 500`,
    params,
  );
  const resumenRows = await query<RowDataPacket[]>(
    `SELECT c.estado, COUNT(*) AS n FROM flota_combustible_cargas c
     WHERE ${condicionesBase.join(" AND ")}
     GROUP BY c.estado`,
    paramsBase,
  );
  const resumen: Record<EstadoCargaCombustible, number> = { PENDIENTE: 0, APROBADO: 0, RECHAZADO: 0 };
  for (const r of resumenRows) {
    const e = String(r.estado);
    if (e === "PENDIENTE" || e === "APROBADO" || e === "RECHAZADO") resumen[e] = Number(r.n);
  }
  return { items: rows.map(mapCargaRevision), resumen };
}

/**
 * FLOTA-COMBUSTIBLE-1 (Fase 2) — aprobar o rechazar una carga PENDIENTE.
 * Solo transiciona desde PENDIENTE (el WHERE lo garantiza atómicamente) —
 * una carga ya decidida no se puede "re-aprobar"/"re-rechazar" desde
 * aquí, evita pisar una decisión anterior por una doble petición o dos
 * revisores actuando a la vez.
 */
export async function revisarCargaCombustible(
  empresaId: number,
  cargaId: number,
  accion: "aprobar" | "rechazar",
  revisorUsername: string,
  motivoRechazo?: string,
): Promise<{ ok: true } | { ok: false; error: string; status: number }> {
  if (accion === "rechazar" && !motivoRechazo?.trim()) {
    return { ok: false, error: "Indica el motivo del rechazo.", status: 400 };
  }
  const nuevoEstado: EstadoCargaCombustible = accion === "aprobar" ? "APROBADO" : "RECHAZADO";
  const ahora = ahoraLocal();
  const r = await execute(
    `UPDATE flota_combustible_cargas
     SET estado = ?, revisado_por = ?, revisado_en = ?, motivo_rechazo = ?
     WHERE id = ? AND empresa_id = ? AND estado = 'PENDIENTE'`,
    [nuevoEstado, revisorUsername, ahora, accion === "rechazar" ? motivoRechazo!.trim() : null, cargaId, empresaId],
  );
  if (!r.affectedRows) {
    return {
      ok: false,
      error: "Esta carga ya fue revisada o no existe. Actualiza la pantalla e inténtalo de nuevo.",
      status: 409,
    };
  }
  return { ok: true };
}

export type ResumenCombustibleVehiculo = {
  vehiculoId: number;
  placa: string;
  dieselGalones: number;
  dieselMonto: number;
  gasolinaGalones: number;
  gasolinaMonto: number;
  totalGalones: number;
  totalMonto: number;
  cargas: number;
};

export type ResumenCombustibleMensual = {
  porVehiculo: ResumenCombustibleVehiculo[];
  total: Omit<ResumenCombustibleVehiculo, "vehiculoId" | "placa">;
};

function totalVacio(): ResumenCombustibleMensual["total"] {
  return { dieselGalones: 0, dieselMonto: 0, gasolinaGalones: 0, gasolinaMonto: 0, totalGalones: 0, totalMonto: 0, cargas: 0 };
}

/**
 * FLOTA-COMBUSTIBLE-1 (Fase 3) — "un total de cuánto se echó de diesel o
 * gasolina al mes" (pedido original del usuario). Totales por vehículo y
 * consolidado, SOLO de cargas en estado APROBADO — una carga PENDIENTE o
 * RECHAZADA nunca debe sumarse como consumo real, igual criterio que
 * VIATICOS-RECHAZADO-1 con los montos rechazados en resumen-mensual.ts.
 * `mes` es "YYYY-MM"; reutiliza rangoMes() (ya probado, valida formato
 * contra inyección) en vez de reimplementar el cálculo de rango de mes.
 *
 * DEUDA FUNCIONAL (FLOTA-COMBUSTIBLE-HARDENING-1, sección 4 — documentada
 * a propósito, NO resuelta aquí): el rango de mes se aplica sobre
 * `creado_at`, que representa la fecha/hora en que el piloto registró la
 * carga en el sistema, que puede diferir de la fecha física de carga si
 * el registro se hace después. La fecha de aprobación de Operaciones NO
 * afecta el corte mensual actual (el filtro es solo por `creado_at`, sin
 * importar cuándo se aprobó). No existe hoy una columna de "fecha de
 * carga" separada de la de registro; agregarla requiere una decisión de
 * negocio (¿el piloto la captura manualmente? ¿se usa la fecha del
 * viaje?) y su propia migración — fuera de alcance de este ticket, que
 * pidió explícitamente no tocar el esquema.
 */
export async function resumenCombustibleMensual(
  empresaId: number,
  mes: string,
): Promise<ResumenCombustibleMensual> {
  const [desde, hasta] = rangoMes(mes);
  const rows = await query<RowDataPacket[]>(
    `SELECT c.vehiculo_id, v.placa, c.tipo_combustible,
            SUM(c.galones) AS galones, SUM(c.monto) AS monto, COUNT(*) AS n
     FROM flota_combustible_cargas c
     INNER JOIN flota_vehiculos v ON v.id = c.vehiculo_id
     WHERE c.empresa_id = ? AND c.estado = 'APROBADO'
       AND c.creado_at >= ? AND c.creado_at < ?
     GROUP BY c.vehiculo_id, v.placa, c.tipo_combustible
     ORDER BY v.placa`,
    [empresaId, desde, hasta],
  );

  const porVehiculoMap = new Map<number, ResumenCombustibleVehiculo>();
  for (const r of rows) {
    const vehiculoId = Number(r.vehiculo_id);
    const fila = porVehiculoMap.get(vehiculoId) ?? {
      vehiculoId,
      placa: String(r.placa),
      dieselGalones: 0,
      dieselMonto: 0,
      gasolinaGalones: 0,
      gasolinaMonto: 0,
      totalGalones: 0,
      totalMonto: 0,
      cargas: 0,
    };
    const galones = Number(r.galones);
    const monto = Number(r.monto);
    if (String(r.tipo_combustible) === "gasolina") {
      fila.gasolinaGalones += galones;
      fila.gasolinaMonto += monto;
    } else {
      fila.dieselGalones += galones;
      fila.dieselMonto += monto;
    }
    fila.totalGalones += galones;
    fila.totalMonto += monto;
    fila.cargas += Number(r.n);
    porVehiculoMap.set(vehiculoId, fila);
  }

  const porVehiculo = [...porVehiculoMap.values()];
  const total = porVehiculo.reduce((acc, v) => {
    acc.dieselGalones += v.dieselGalones;
    acc.dieselMonto += v.dieselMonto;
    acc.gasolinaGalones += v.gasolinaGalones;
    acc.gasolinaMonto += v.gasolinaMonto;
    acc.totalGalones += v.totalGalones;
    acc.totalMonto += v.totalMonto;
    acc.cargas += v.cargas;
    return acc;
  }, totalVacio());

  return { porVehiculo, total };
}
