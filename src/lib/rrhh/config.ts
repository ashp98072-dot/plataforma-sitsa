import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { normalizarHora } from "./dates";

export const PARAMETROS_DEFAULT: Record<string, string> = {
  hora_entrada_default: "07:00:00",
  hora_salida_default: "16:00:00",
  /** Salida teórica los sábados (Monaco: 11:00) */
  hora_salida_sabado: "11:00:00",
  /** Gracia diaria (0 = tardanza desde el minuto 1) */
  minutos_tolerancia: "0",
  /** Banco semanal de minutos de retraso perdonados (Monaco: 20) */
  minutos_tolerancia_semanal: "20",
  /** Sin marcaje tras estos minutos → falta en el día */
  minutos_para_falta: "60",
  ciclo_quincenal: "15",
  /** 1 = el kiosko solo permite marcar cerca del predio */
  geocerca_activa: "0",
  geocerca_lat: "",
  geocerca_lng: "",
  geocerca_radio_m: "150",
};

export async function obtenerParametros(
  empresaId: number,
): Promise<Record<string, string>> {
  const hit = paramsCache.get(empresaId);
  if (hit && Date.now() - hit.at < 30_000) return { ...hit.data };
  try {
    const rows = await query<RowDataPacket[]>(
      "SELECT parametro, valor FROM configuracion WHERE empresa_id = ?",
      [empresaId],
    );
    const map = { ...PARAMETROS_DEFAULT };
    for (const r of rows) {
      const key = String(r.parametro);
      if (key in map) map[key] = String(r.valor);
    }
    paramsCache.set(empresaId, { at: Date.now(), data: map });
    return { ...map };
  } catch {
    return { ...PARAMETROS_DEFAULT };
  }
}

const paramsCache = new Map<
  number,
  { at: number; data: Record<string, string> }
>();

export function invalidarCacheParametros(empresaId?: number): void {
  if (empresaId == null) paramsCache.clear();
  else paramsCache.delete(empresaId);
}

export async function obtenerMinutosTolerancia(
  empresaId: number,
): Promise<number> {
  const p = await obtenerParametros(empresaId);
  const n = Number.parseInt(p.minutos_tolerancia, 10);
  return Number.isFinite(n) ? n : 10;
}

export async function obtenerHoraEntradaDefault(
  empresaId: number,
): Promise<string> {
  const p = await obtenerParametros(empresaId);
  return p.hora_entrada_default || "08:00:00";
}

export function validarParametros(
  parametros: Record<string, string>,
): { ok: true; datos: Record<string, string> } | { ok: false; error: string } {
  const horaEntrada = normalizarHora(parametros.hora_entrada_default ?? "");
  if (!horaEntrada) {
    return { ok: false, error: "Hora de entrada inválida (HH:MM)." };
  }
  const horaSalida = normalizarHora(parametros.hora_salida_default ?? "");
  if (!horaSalida) {
    return { ok: false, error: "Hora de salida inválida (HH:MM)." };
  }
  const tolerancia = Number.parseInt(parametros.minutos_tolerancia ?? "", 10);
  if (!Number.isFinite(tolerancia) || tolerancia < 0 || tolerancia > 120) {
    return { ok: false, error: "Tolerancia diaria debe ser entre 0 y 120 minutos." };
  }
  const horaSalidaSab = normalizarHora(
    parametros.hora_salida_sabado ?? "11:00:00",
  );
  if (!horaSalidaSab) {
    return { ok: false, error: "Hora de salida sábado inválida (HH:MM)." };
  }
  const tolSem = Number.parseInt(
    parametros.minutos_tolerancia_semanal ?? "20",
    10,
  );
  if (!Number.isFinite(tolSem) || tolSem < 0 || tolSem > 480) {
    return {
      ok: false,
      error: "Tolerancia semanal: entre 0 y 480 minutos.",
    };
  }
  const minFalta = Number.parseInt(parametros.minutos_para_falta ?? "60", 10);
  if (!Number.isFinite(minFalta) || minFalta < 15 || minFalta > 240) {
    return {
      ok: false,
      error: "Minutos para falta: entre 15 y 240.",
    };
  }
  const ciclo = Number.parseInt(parametros.ciclo_quincenal ?? "", 10);
  if (!Number.isFinite(ciclo) || ciclo < 1 || ciclo > 28) {
    return { ok: false, error: "Ciclo quincenal: día de corte entre 1 y 28." };
  }

  const geoActiva = String(parametros.geocerca_activa ?? "0") === "1" ? "1" : "0";
  const radio = Number.parseInt(parametros.geocerca_radio_m ?? "150", 10);
  if (!Number.isFinite(radio) || radio < 30 || radio > 5000) {
    return {
      ok: false,
      error: "Radio de geocerca: entre 30 y 5000 metros.",
    };
  }
  let latStr = String(parametros.geocerca_lat ?? "").trim();
  let lngStr = String(parametros.geocerca_lng ?? "").trim();
  if (geoActiva === "1") {
    const lat = Number.parseFloat(latStr);
    const lng = Number.parseFloat(lngStr);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      return {
        ok: false,
        error: "Geocerca activa: indica latitud válida del predio (−90 a 90).",
      };
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      return {
        ok: false,
        error: "Geocerca activa: indica longitud válida del predio (−180 a 180).",
      };
    }
    latStr = String(lat);
    lngStr = String(lng);
  }

  return {
    ok: true,
    datos: {
      hora_entrada_default: horaEntrada,
      hora_salida_default: horaSalida,
      hora_salida_sabado: horaSalidaSab,
      minutos_tolerancia: String(tolerancia),
      minutos_tolerancia_semanal: String(tolSem),
      minutos_para_falta: String(minFalta),
      ciclo_quincenal: String(ciclo),
      geocerca_activa: geoActiva,
      geocerca_lat: latStr,
      geocerca_lng: lngStr,
      geocerca_radio_m: String(radio),
    },
  };
}

export async function obtenerToleranciaSemanal(
  empresaId: number,
): Promise<number> {
  const p = await obtenerParametros(empresaId);
  const n = Number.parseInt(p.minutos_tolerancia_semanal, 10);
  return Number.isFinite(n) ? n : 20;
}

export async function obtenerMinutosParaFalta(
  empresaId: number,
): Promise<number> {
  const p = await obtenerParametros(empresaId);
  const n = Number.parseInt(p.minutos_para_falta, 10);
  return Number.isFinite(n) ? n : 60;
}

export async function guardarParametros(
  empresaId: number,
  parametros: Record<string, string>,
): Promise<{ ok: boolean; mensaje: string }> {
  const validacion = validarParametros(parametros);
  if (!validacion.ok) return { ok: false, mensaje: validacion.error };
  try {
    for (const [parametro, valor] of Object.entries(validacion.datos)) {
      await execute(
        `INSERT INTO configuracion (empresa_id, parametro, valor) VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE valor = VALUES(valor)`,
        [empresaId, parametro, valor],
      );
    }
    invalidarCacheParametros(empresaId);
    return { ok: true, mensaje: "Configuración guardada." };
  } catch {
    return {
      ok: false,
      mensaje: "Falta migrate-2026-08-rrhh-core.sql (tabla configuracion).",
    };
  }
}

export type Feriado = {
  id: number;
  descripcion: string;
  fecha: string;
  activo: boolean;
};

export async function listarFeriados(empresaId: number): Promise<Feriado[]> {
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT id, descripcion, fecha, activo FROM feriados
       WHERE empresa_id = ? ORDER BY fecha DESC`,
      [empresaId],
    );
    return rows.map((r) => ({
      id: Number(r.id),
      descripcion: String(r.descripcion),
      fecha: String(r.fecha).slice(0, 10),
      activo: Number(r.activo) === 1,
    }));
  } catch {
    return [];
  }
}

export async function crearFeriado(
  empresaId: number,
  descripcion: string,
  fecha: string,
): Promise<{ ok: boolean; mensaje: string; id?: number }> {
  try {
    const r = await execute(
      `INSERT INTO feriados (empresa_id, descripcion, fecha, activo)
       VALUES (?, ?, ?, 1)`,
      [empresaId, descripcion.trim(), fecha],
    );
    return { ok: true, mensaje: "Feriado creado.", id: r.insertId };
  } catch {
    return {
      ok: false,
      mensaje: "No se pudo crear (¿fecha duplicada o falta migrate?).",
    };
  }
}

export async function toggleFeriado(
  empresaId: number,
  id: number,
  activo: boolean,
): Promise<boolean> {
  const r = await execute(
    `UPDATE feriados SET activo = ? WHERE id = ? AND empresa_id = ?`,
    [activo ? 1 : 0, id, empresaId],
  );
  return r.affectedRows > 0;
}
