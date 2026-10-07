/**
 * BD EN MEMORIA para probar el aplicador de la reconstrucción de vacaciones contra el código REAL (solo pruebas; no se importa desde la app).
 *
 * Implementa exactamente las sentencias que emite el aplicador/plan, con la semántica que importa:
 *  - transacciones: BEGIN toma una foto; ROLLBACK la restaura; COMMIT la descarta;
 *  - DDL (CREATE TABLE … AS SELECT de los respaldos) NO se revierte, como en MariaDB;
 *  - FK ON DELETE CASCADE de fk_ev_inc (evidencias_incidencias.incidencia_id → incidencias.id) y de detalle_consumo_vacaciones → saldos;
 *  - FK al insertar evidencias (la incidencia debe existir) y PK única.
 * Permite inyectar fallos (`fallarSi`) y mutar estado a mitad del proceso (`despuesDe`).
 */
import type { SqlParams } from "@/lib/db";

export type Empleado = { id: number; empresa_id: number; codigo: string; nombre: string; fecha_alta: string | null; fecha_inicio_laboral: string | null; dpi?: string | null };
export type VacacionRow = { id: number; empresa_id: number; id_empleado: number; fecha_inicio: string; fecha_fin: string; dias_habiles: number; observaciones: string | null; estado: string };
export type IncidenciaRow = { id: number; empresa_id: number; id_empleado: number; tipo: string; fecha_inicio: string; fecha_fin: string; dias_habiles: number };
export type DetalleRow = { id: number; incidencia_id: number; saldo_id: number; dias_tomados: number };
export type SaldoRow = { id: number; empresa_id: number; id_empleado: number; anio_laboral: number | null; periodo_inicio: string; periodo_fin: string; dias_otorgados: number; dias_disponibles: number; estado: string };
export type SolicitudRow = { id: number; empresa_id: number; incidencia_id: number | null };
export type EvidenciaRow = { id: number; empresa_id: number; incidencia_id: number; ruta_archivo: string; nombre_original: string | null; subido_en: string; subido_por: string | null };
export type AuditoriaRow = { empresa_id: number | null; usuario: string | null; accion: string; modulo: string | null; detalle: string | null };

export type Tablas = {
  empleados: Empleado[];
  vacaciones: VacacionRow[];
  incidencias: IncidenciaRow[];
  detalle: DetalleRow[];
  saldos: SaldoRow[];
  solicitudes: SolicitudRow[];
  evidencias: EvidenciaRow[];
  auditoria: AuditoriaRow[];
};

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const clonar = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const TIPOS_VAC = ["Vacaciones", "A cuenta de Vacaciones"];

export class BdMemoria {
  t!: Tablas;
  backups: Record<string, Record<string, unknown>[]> = {};
  historico: number | null = 441;
  ejecutadas: string[] = [];
  eventos: string[] = [];
  /** Cantidad de evidencias de la tabla tras cada sentencia (para observar el efecto del CASCADE). */
  traza: { sql: string; evidencias: number }[] = [];
  fallarSi: ((sql: string, n: number) => boolean) | null = null;
  despuesDe: { patron: RegExp; fn: (t: Tablas) => void }[] = [];
  private foto: Tablas | null = null;
  private seq = { sal: 1000, inc: 2000, vac: 3000, det: 4000, aud: 1 };
  private llamadas = 0;

  constructor() { this.reiniciar(); }

  reiniciar(t?: Partial<Tablas>): void {
    this.t = { empleados: [], vacaciones: [], incidencias: [], detalle: [], saldos: [], solicitudes: [], evidencias: [], auditoria: [], ...(t ? clonar(t) : {}) };
    this.backups = {}; this.historico = 441; this.ejecutadas = []; this.eventos = []; this.traza = []; this.fallarSi = null; this.despuesDe = []; this.foto = null;
    this.seq = { sal: 1000, inc: 2000, vac: 3000, det: 4000, aud: 1 }; this.llamadas = 0;
  }

  /** Estado completo de las tablas de datos (sin respaldos), para comparar antes/después. */
  instantanea(): Tablas { return clonar(this.t); }

  consulta = async (sql: string, params: SqlParams = []): Promise<Record<string, unknown>[]> => (await this.query(sql, params))[0];

  conexion() {
    return {
      query: (sql: string, params?: SqlParams) => this.query(sql, params),
      execute: (sql: string, params?: SqlParams) => this.execute(sql, params),
      beginTransaction: async () => { this.eventos.push("BEGIN"); this.foto = clonar(this.t); },
      commit: async () => { this.eventos.push("COMMIT"); this.foto = null; },
      rollback: async () => { this.eventos.push("ROLLBACK"); if (this.foto) this.t = this.foto; this.foto = null; },
      release: () => { this.eventos.push("RELEASE"); },
    };
  }

  private antes(sql: string): void {
    this.llamadas += 1;
    this.ejecutadas.push(sql);
    if (this.fallarSi?.(sql, this.llamadas)) throw new Error(`fallo inyectado en: ${sql.slice(0, 80)}`);
  }
  private despues(sql: string): void {
    for (const h of this.despuesDe) if (h.patron.test(sql)) h.fn(this.t);
    this.traza.push({ sql: sql.slice(0, 60), evidencias: this.t.evidencias.length });
  }

  async query(sqlOriginal: string, params: SqlParams = []): Promise<[Record<string, unknown>[], undefined]> {
    const sql = norm(sqlOriginal);
    this.antes(sql);
    const r = this.responder(sql, params);
    this.despues(sql);
    return [r, undefined];
  }

  private nuevoId(k: keyof BdMemoria["seq"]): number { this.seq[k] += 1; return this.seq[k]; }

  private responder(sql: string, p: SqlParams): Record<string, unknown>[] {
    const e = Number(p[0]);
    const t = this.t;
    const incVac = () => t.incidencias.filter((i) => i.empresa_id === e && TIPOS_VAC.includes(i.tipo));
    if (sql.endsWith("FOR UPDATE")) return [];
    if (sql.includes("FROM information_schema.TABLES")) return [{ n: p.filter((x) => String(x) in this.backups).length }];
    if (sql === "SELECT COUNT(*) AS n FROM backup_saldos_vacaciones_20261006") {
      if (this.historico == null) throw Object.assign(new Error("no such table"), { errno: 1146 });
      return [{ n: this.historico }];
    }
    // respaldos
    const m = /^SELECT COUNT\(\*\) AS n FROM `(bk_reset_\d+_[a-z_]+)`( WHERE empresa_id = \?)?$/.exec(sql);
    if (m) { const f = this.backups[m[1]] ?? []; return [{ n: m[2] ? f.filter((x) => x.empresa_id === e).length : f.length }]; }
    // conteos de origen para respaldos
    if (sql === "SELECT COUNT(*) AS n FROM vacaciones") return [{ n: t.vacaciones.length }];
    if (sql === "SELECT COUNT(*) AS n FROM incidencias WHERE tipo IN ('Vacaciones', 'A cuenta de Vacaciones')") return [{ n: t.incidencias.filter((i) => TIPOS_VAC.includes(i.tipo)).length }];
    if (sql === "SELECT COUNT(*) AS n FROM detalle_consumo_vacaciones") return [{ n: t.detalle.length }];
    if (sql === "SELECT COUNT(*) AS n FROM saldos_vacaciones") return [{ n: t.saldos.length }];
    if (sql === "SELECT COUNT(*) AS n FROM solicitudes_vacaciones") return [{ n: t.solicitudes.length }];
    if (sql === "SELECT COUNT(*) AS n FROM evidencias_incidencias") return [{ n: t.evidencias.length }];
    // conteos por empresa
    if (sql === "SELECT COUNT(*) AS n FROM incidencias WHERE empresa_id = ? AND tipo NOT IN ('Vacaciones', 'A cuenta de Vacaciones')") return [{ n: t.incidencias.filter((i) => i.empresa_id === e && !TIPOS_VAC.includes(i.tipo)).length }];
    if (sql === "SELECT COUNT(*) AS n FROM incidencias WHERE empresa_id = ? AND tipo IN ('Vacaciones', 'A cuenta de Vacaciones')") return [{ n: incVac().length }];
    if (sql === "SELECT COUNT(*) AS n FROM empleados WHERE empresa_id = ?") return [{ n: t.empleados.filter((x) => x.empresa_id === e).length }];
    if (sql === "SELECT COUNT(*) AS n FROM solicitudes_vacaciones WHERE empresa_id = ?") return [{ n: t.solicitudes.filter((x) => x.empresa_id === e).length }];
    if (sql === "SELECT COUNT(*) AS n FROM vacaciones WHERE empresa_id = ?") return [{ n: t.vacaciones.filter((x) => x.empresa_id === e).length }];
    if (sql === "SELECT COUNT(*) AS n FROM evidencias_incidencias WHERE empresa_id = ?") return [{ n: t.evidencias.filter((x) => x.empresa_id === e).length }];
    if (sql === "SELECT COUNT(*) AS n FROM saldos_vacaciones WHERE empresa_id = ? AND id_empleado = ?") return [{ n: t.saldos.filter((s) => s.empresa_id === e && s.id_empleado === Number(p[1])).length }];
    if (sql === "SELECT COUNT(*) AS n FROM saldos_vacaciones WHERE empresa_id = ? AND dias_disponibles < 0") return [{ n: t.saldos.filter((s) => s.empresa_id === e && s.dias_disponibles < 0).length }];
    if (sql.startsWith("SELECT COUNT(*) AS n FROM detalle_consumo_vacaciones WHERE saldo_id IN (")) return [{ n: t.detalle.filter((d) => (p as number[]).includes(d.saldo_id)).length }];
    if (sql.startsWith("SELECT COUNT(*) AS n FROM evidencias_incidencias e LEFT JOIN incidencias i")) {
      return [{ n: t.evidencias.filter((x) => x.empresa_id === e && !t.incidencias.some((i) => i.id === x.incidencia_id)).length }];
    }
    // verificaciones del aplicador
    if (sql.startsWith("SELECT incidencia_id, COUNT(*) AS lineas, SUM(dias_tomados) AS dias FROM detalle_consumo_vacaciones")) {
      const por = new Map<number, { lineas: number; dias: number }>();
      for (const d of t.detalle.filter((x) => (p as number[]).includes(x.incidencia_id))) { const c = por.get(d.incidencia_id) ?? { lineas: 0, dias: 0 }; c.lineas += 1; c.dias += d.dias_tomados; por.set(d.incidencia_id, c); }
      return [...por].map(([incidencia_id, c]) => ({ incidencia_id, lineas: c.lineas, dias: c.dias }));
    }
    if (sql.startsWith("SELECT incidencia_id, COUNT(*) AS n FROM evidencias_incidencias WHERE empresa_id = ? AND incidencia_id IN (")) {
      const ids = (p as number[]).slice(1);
      const por = new Map<number, number>();
      for (const x of t.evidencias.filter((v) => v.empresa_id === e && ids.includes(v.incidencia_id))) por.set(x.incidencia_id, (por.get(x.incidencia_id) ?? 0) + 1);
      return [...por].map(([incidencia_id, n]) => ({ incidencia_id, n }));
    }
    if (sql.startsWith("SELECT id, empresa_id, incidencia_id, ruta_archivo, nombre_original, DATE_FORMAT(subido_en")) {
      return t.evidencias.filter((x) => x.empresa_id === e).map((x) => ({ ...x }));
    }
    // cargarHistorialActual
    if (sql.startsWith("SELECT id, id_empleado, fecha_inicio, fecha_fin, dias_habiles, observaciones, estado FROM vacaciones")) return t.vacaciones.filter((x) => x.empresa_id === e).map((x) => ({ ...x })).sort((a, b) => a.id - b.id);
    if (sql.startsWith("SELECT id, id_empleado, tipo, fecha_inicio, fecha_fin, dias_habiles FROM incidencias")) return incVac().map((x) => ({ ...x })).sort((a, b) => a.id - b.id);
    if (sql === "SELECT id, codigo, nombre FROM empleados WHERE empresa_id = ?") return t.empleados.filter((x) => x.empresa_id === e).map(({ id, codigo, nombre }) => ({ id, codigo, nombre }));
    if (sql === "SELECT id, dpi FROM empleados WHERE empresa_id = ?") return t.empleados.filter((x) => x.empresa_id === e && x.dpi).map((x) => ({ id: x.id, dpi: x.dpi }));
    // cargarFuente
    if (sql === "SELECT id, codigo, nombre, fecha_alta, fecha_inicio_laboral FROM empleados WHERE empresa_id = ?") return t.empleados.filter((x) => x.empresa_id === e).map((x) => ({ id: x.id, codigo: x.codigo, nombre: x.nombre, fecha_alta: x.fecha_alta, fecha_inicio_laboral: x.fecha_inicio_laboral }));
    if (sql === "SELECT id FROM vacaciones WHERE empresa_id = ? ORDER BY id") return t.vacaciones.filter((x) => x.empresa_id === e).map((x) => ({ id: x.id })).sort((a, b) => a.id - b.id);
    if (sql.startsWith("SELECT id FROM incidencias WHERE empresa_id = ? AND tipo IN")) return incVac().map((x) => ({ id: x.id })).sort((a, b) => a.id - b.id);
    if (sql === "SELECT id, id_empleado FROM saldos_vacaciones WHERE empresa_id = ? ORDER BY id") return t.saldos.filter((x) => x.empresa_id === e).map((x) => ({ id: x.id, id_empleado: x.id_empleado })).sort((a, b) => a.id - b.id);
    if (sql.startsWith("SELECT d.id, d.incidencia_id, d.saldo_id FROM detalle_consumo_vacaciones d")) {
      const incIds = new Set(incVac().map((i) => i.id));
      const salIds = new Set(t.saldos.filter((s) => s.empresa_id === e).map((s) => s.id));
      return t.detalle.filter((d) => incIds.has(d.incidencia_id) || salIds.has(d.saldo_id)).map((d) => ({ id: d.id, incidencia_id: d.incidencia_id, saldo_id: d.saldo_id })).sort((a, b) => a.id - b.id);
    }
    if (sql === "SELECT id, incidencia_id FROM solicitudes_vacaciones WHERE empresa_id = ? AND incidencia_id IS NOT NULL") return t.solicitudes.filter((x) => x.empresa_id === e && x.incidencia_id != null).map((x) => ({ id: x.id, incidencia_id: x.incidencia_id }));
    if (sql.startsWith("SELECT e.id, e.empresa_id, e.incidencia_id, i.id_empleado, i.tipo")) {
      return t.evidencias.filter((x) => x.empresa_id === e).flatMap((x) => {
        const i = t.incidencias.find((y) => y.id === x.incidencia_id && y.empresa_id === e && TIPOS_VAC.includes(y.tipo));
        return i ? [{ id: x.id, empresa_id: x.empresa_id, incidencia_id: x.incidencia_id, id_empleado: i.id_empleado, tipo: i.tipo, fecha_inicio: i.fecha_inicio, fecha_fin: i.fecha_fin, dias_habiles: i.dias_habiles, ruta_archivo: x.ruta_archivo, nombre_original: x.nombre_original, subido_en: x.subido_en, subido_por: x.subido_por }] : [];
      }).sort((a, b) => a.id - b.id);
    }
    if (sql.includes("FROM feriados")) return [];
    throw new Error(`BdMemoria: consulta no soportada: ${sql}`);
  }

  async execute(sqlOriginal: string, params: SqlParams = []): Promise<[{ insertId: number; affectedRows: number }, undefined]> {
    const sql = norm(sqlOriginal);
    this.antes(sql);
    const r = this.ejecutar(sql, params);
    this.despues(sql);
    return [r, undefined];
  }

  private ejecutar(sql: string, p: SqlParams): { insertId: number; affectedRows: number } {
    const t = this.t;
    const ok = (insertId = 0, affectedRows = 1) => ({ insertId, affectedRows });
    // DDL: respaldos (NO se revierten con ROLLBACK)
    let m = /^CREATE TABLE `(bk_reset_\d+_([a-z_]+))` AS (.*)$/.exec(sql);
    if (m) {
      const [, nombre, clave] = m;
      if (nombre in this.backups) throw new Error(`Table '${nombre}' already exists`);
      const tiposVac = (i: IncidenciaRow) => TIPOS_VAC.includes(i.tipo);
      const fuente: Record<string, () => Record<string, unknown>[]> = {
        vacaciones: () => clonar(t.vacaciones),
        incidencias_vacaciones: () => clonar(t.incidencias.filter(tiposVac)),
        detalle_consumo_vacaciones: () => clonar(t.detalle),
        saldos_vacaciones: () => clonar(t.saldos),
        solicitudes_vacaciones: () => clonar(t.solicitudes),
        evidencias_incidencias: () => t.evidencias.map((x) => {
          const i = t.incidencias.find((y) => y.id === x.incidencia_id);
          return { id: x.id, empresa_id: x.empresa_id, incidencia_id: x.incidencia_id, id_empleado: i?.id_empleado ?? null, tipo: i?.tipo ?? null, fecha_inicio: i?.fecha_inicio ?? null, fecha_fin: i?.fecha_fin ?? null, dias_habiles: i?.dias_habiles ?? null, ruta_archivo: x.ruta_archivo, nombre_original: x.nombre_original, subido_en: x.subido_en, subido_por: x.subido_por };
        }),
      };
      if (!fuente[clave]) throw new Error(`BdMemoria: respaldo no soportado: ${clave}`);
      this.backups[nombre] = fuente[clave]();
      return ok();
    }
    // DELETE
    m = /^DELETE FROM detalle_consumo_vacaciones WHERE incidencia_id IN \(([?,]+)\)$/.exec(sql);
    if (m) { const ids = p as number[]; const n = t.detalle.length; t.detalle = t.detalle.filter((d) => !ids.includes(d.incidencia_id)); return ok(0, n - t.detalle.length); }
    m = /^DELETE FROM incidencias WHERE empresa_id = \? AND tipo IN \('Vacaciones', 'A cuenta de Vacaciones'\) AND id IN \(([?,]+)\)$/.exec(sql);
    if (m) {
      const e = Number(p[0]); const ids = (p as number[]).slice(1);
      const borradas = t.incidencias.filter((i) => i.empresa_id === e && TIPOS_VAC.includes(i.tipo) && ids.includes(i.id)).map((i) => i.id);
      t.incidencias = t.incidencias.filter((i) => !borradas.includes(i.id));
      t.evidencias = t.evidencias.filter((x) => !borradas.includes(x.incidencia_id)); // ON DELETE CASCADE (fk_ev_inc)
      t.detalle = t.detalle.filter((d) => !borradas.includes(d.incidencia_id)); // ON DELETE CASCADE (fk_det_inc)
      t.solicitudes = t.solicitudes.map((s) => (s.incidencia_id != null && borradas.includes(s.incidencia_id) ? { ...s, incidencia_id: null } : s)); // ON DELETE SET NULL
      return ok(0, borradas.length);
    }
    m = /^DELETE FROM vacaciones WHERE empresa_id = \? AND id IN \(([?,]+)\)$/.exec(sql);
    if (m) { const e = Number(p[0]); const ids = (p as number[]).slice(1); const n = t.vacaciones.length; t.vacaciones = t.vacaciones.filter((v) => !(v.empresa_id === e && ids.includes(v.id))); return ok(0, n - t.vacaciones.length); }
    m = /^DELETE FROM saldos_vacaciones WHERE empresa_id = \? AND id IN \(([?,]+)\)$/.exec(sql);
    if (m) {
      const e = Number(p[0]); const ids = (p as number[]).slice(1);
      const borrados = t.saldos.filter((s) => s.empresa_id === e && ids.includes(s.id)).map((s) => s.id);
      t.saldos = t.saldos.filter((s) => !borrados.includes(s.id));
      t.detalle = t.detalle.filter((d) => !borrados.includes(d.saldo_id)); // ON DELETE CASCADE (fk_det_saldo)
      return ok(0, borrados.length);
    }
    // INSERT
    if (sql.startsWith("INSERT INTO saldos_vacaciones (")) {
      const [empresa_id, id_empleado, anio_laboral, periodo_inicio, periodo_fin, dias_otorgados, dias_disponibles, estado] = p as [number, number, number, string, string, number, number, string];
      if (t.saldos.some((s) => s.id_empleado === id_empleado && s.periodo_inicio === periodo_inicio && s.periodo_fin === periodo_fin)) throw new Error("Duplicate entry (uq_saldo_periodo)");
      const id = this.nuevoId("sal"); t.saldos.push({ id, empresa_id, id_empleado, anio_laboral, periodo_inicio, periodo_fin, dias_otorgados, dias_disponibles, estado }); return ok(id);
    }
    if (sql.startsWith("INSERT INTO incidencias (")) {
      const [empresa_id, id_empleado, tipo, fecha_inicio, fecha_fin, dias_habiles] = p as [number, number, string, string, string, number];
      const id = this.nuevoId("inc"); t.incidencias.push({ id, empresa_id, id_empleado, tipo, fecha_inicio, fecha_fin, dias_habiles }); return ok(id);
    }
    if (sql.startsWith("INSERT INTO vacaciones (")) {
      const [empresa_id, id_empleado, fecha_inicio, fecha_fin, dias_habiles, observaciones] = p as [number, number, string, string, number, string | null];
      const id = this.nuevoId("vac"); t.vacaciones.push({ id, empresa_id, id_empleado, fecha_inicio, fecha_fin, dias_habiles, observaciones, estado: "Aprobado" }); return ok(id);
    }
    if (sql.startsWith("INSERT INTO detalle_consumo_vacaciones (")) {
      const [incidencia_id, saldo_id, dias_tomados] = p as [number, number, number];
      if (!t.incidencias.some((i) => i.id === incidencia_id) || !t.saldos.some((s) => s.id === saldo_id)) throw new Error("FK detalle");
      const id = this.nuevoId("det"); t.detalle.push({ id, incidencia_id, saldo_id, dias_tomados }); return ok(id);
    }
    if (sql.startsWith("INSERT INTO evidencias_incidencias (id, empresa_id, incidencia_id")) {
      const [id, empresa_id, incidencia_id, ruta_archivo, nombre_original, subido_en, subido_por] = p as [number, number, number, string, string | null, string, string | null];
      if (!t.incidencias.some((i) => i.id === incidencia_id)) throw new Error("FK fk_ev_inc: la incidencia no existe");
      if (t.evidencias.some((x) => x.id === id)) throw new Error("Duplicate entry (PRIMARY)");
      t.evidencias.push({ id, empresa_id, incidencia_id, ruta_archivo, nombre_original, subido_en, subido_por }); return ok(id);
    }
    if (sql.startsWith("INSERT INTO auditoria")) {
      const [empresa_id, usuario, accion, modulo, detalle] = p as [number | null, string | null, string, string | null, string | null];
      t.auditoria.push({ empresa_id, usuario, accion, modulo, detalle }); return ok(this.nuevoId("aud"));
    }
    throw new Error(`BdMemoria: sentencia no soportada: ${sql}`);
  }
}

export const bd = new BdMemoria();

/* ------------------------------------------------------------------ escenarios */

let sec = 0;
export type EscenarioOpts = { conEvidencias?: boolean };

/** Lunes + n semanas → vacación de lunes a viernes (5 días hábiles). */
const semana = (base: string, n: number): [string, string] => {
  const d = new Date(`${base}T00:00:00`); d.setDate(d.getDate() + 7 * n);
  const f = new Date(d); f.setDate(f.getDate() + 4);
  const iso = (x: Date) => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  return [iso(d), iso(f)];
};

export const EMPRESA = 7;

/** Agrega una vacación completa y consistente al estado (incidencia + espejo + detalle FIFO viejo + evidencia opcional). */
export function agregarVacacion(t: Tablas, o: { empleadoId: number; inicio: string; fin: string; dias: number; tipo?: string; evidencia?: boolean; observaciones?: string | null; saldoId: number; empresa?: number }): number {
  const empresa = o.empresa ?? EMPRESA;
  const id = ++sec + 100;
  t.incidencias.push({ id, empresa_id: empresa, id_empleado: o.empleadoId, tipo: o.tipo ?? "Vacaciones", fecha_inicio: o.inicio, fecha_fin: o.fin, dias_habiles: o.dias });
  t.vacaciones.push({ id: id + 5000, empresa_id: empresa, id_empleado: o.empleadoId, fecha_inicio: o.inicio, fecha_fin: o.fin, dias_habiles: o.dias, observaciones: o.observaciones ?? null, estado: "Aprobado" });
  t.detalle.push({ id: id + 9000, incidencia_id: id, saldo_id: o.saldoId, dias_tomados: o.dias });
  if (o.evidencia) {
    t.evidencias.push({
      id: id + 7000, empresa_id: empresa, incidencia_id: id, ruta_archivo: `empresas/${empresa}/evidencias/inc${id}-20250101T000000-boleta.pdf`,
      nombre_original: `boleta ${id}.pdf`, subido_en: `2025-0${(id % 9) + 1}-1${id % 9} 08:3${id % 9}:15`, subido_por: `rrhh${id % 3}`,
    });
  }
  return id;
}

/**
 * Escenario realista: Ana (6 vacaciones), Beto (3) y Carla (4) con 1 evidencia cada una (13 evidencias / 13 incidencias), un empleado
 * sin vacaciones pero con saldos (Dora) y Elisa (fecha 1899, con saldos viejos que NO se tocan). Más una incidencia de OTRO tipo con evidencia.
 */
export function escenarioBase(opts: EscenarioOpts = {}): Tablas {
  const conEv = opts.conEvidencias ?? true;
  sec = 0;
  const t: Tablas = { empleados: [], vacaciones: [], incidencias: [], detalle: [], saldos: [], solicitudes: [], evidencias: [], auditoria: [] };
  const emp = (id: number, codigo: string, nombre: string, alta: string | null, inicioLab?: string | null) =>
    t.empleados.push({ id, empresa_id: EMPRESA, codigo, nombre, fecha_alta: alta, fecha_inicio_laboral: inicioLab ?? alta, dpi: null });
  emp(1, "E-1", "Ana Pérez", "2020-01-06");
  emp(2, "E-2", "Beto Ruiz", "2020-01-06");
  emp(3, "E-3", "Carla Díaz", "2020-01-06");
  emp(4, "E-4", "Dora Solís", "2022-03-01");
  emp(37, "E-37", "Elisa Jiménez López", "1899-12-31");
  // saldos viejos (valores arbitrarios que la reconstrucción reemplaza)
  let sid = 0;
  const saldo = (idEmpleado: number, anio: number, ini: string, fin: string, otorg: number, disp: number, estado = "Vigente") =>
    t.saldos.push({ id: ++sid, empresa_id: EMPRESA, id_empleado: idEmpleado, anio_laboral: anio, periodo_inicio: ini, periodo_fin: fin, dias_otorgados: otorg, dias_disponibles: disp, estado });
  for (const e of [1, 2, 3]) saldo(e, 1, "2020-01-06", "2021-01-05", 15, 1, "Vencido");
  saldo(4, 1, "2022-03-01", "2023-02-28", 15, 3, "Vencido");
  saldo(37, 1, "1899-12-31", "1900-12-30", 15, 15, "Vencido");
  const a = [1, 2, 3].map((e) => t.saldos.find((s) => s.id_empleado === e)!.id);
  [[1, 6], [2, 3], [3, 4]].forEach(([e, n], k) => {
    for (let i = 0; i < n; i++) {
      const [ini, fin] = semana("2024-02-05", i * 6 + k);
      agregarVacacion(t, { empleadoId: e, inicio: ini, fin, dias: 5, tipo: i % 3 === 2 ? "A cuenta de Vacaciones" : "Vacaciones", evidencia: conEv, observaciones: i === 0 ? `Boleta ${e}-${i}` : null, saldoId: a[k] });
    }
  });
  // incidencia de OTRO tipo con su propia evidencia: jamás debe tocarse
  t.incidencias.push({ id: 90001, empresa_id: EMPRESA, id_empleado: 1, tipo: "Permiso con goce", fecha_inicio: "2024-03-04", fecha_fin: "2024-03-05", dias_habiles: 2 });
  if (conEv) t.evidencias.push({ id: 90002, empresa_id: EMPRESA, incidencia_id: 90001, ruta_archivo: `empresas/${EMPRESA}/evidencias/inc90001-permiso.pdf`, nombre_original: "permiso.pdf", subido_en: "2024-03-06 09:00:00", subido_por: "rrhh1" });
  return t;
}

/** Escenario Álvaro: una vacación que CRUZA un aniversario (decisión de negocio pendiente). */
export function escenarioAlvaro(): Tablas {
  sec = 0;
  const t: Tablas = { empleados: [], vacaciones: [], incidencias: [], detalle: [], saldos: [], solicitudes: [], evidencias: [], auditoria: [], };
  t.empleados.push({ id: 10, empresa_id: EMPRESA, codigo: "E-10", nombre: "Álvaro Antonio León Pinto", fecha_alta: "2022-10-30", fecha_inicio_laboral: "2022-10-30", dpi: null });
  t.saldos.push({ id: 1, empresa_id: EMPRESA, id_empleado: 10, anio_laboral: 1, periodo_inicio: "2022-10-30", periodo_fin: "2023-10-29", dias_otorgados: 15, dias_disponibles: 0, estado: "Vencido" });
  agregarVacacion(t, { empleadoId: 10, inicio: "2025-10-20", fin: "2025-11-05", dias: 15, evidencia: true, saldoId: 1 });
  return t;
}
