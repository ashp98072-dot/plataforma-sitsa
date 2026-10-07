/**
 * BD EN MEMORIA, transaccional, para probar el registro de vacaciones (normal e HISTÓRICO), la sincronización de períodos, la eliminación y el
 * historial contra el CÓDIGO REAL (sin BD, sin SQL real). Solo pruebas: no se importa desde la app.
 *
 * Responde exactamente a las sentencias que emiten `sincronizarPeriodosVacacionesEnConexion`, `registrarVacacionesFifoEnConexion`,
 * `registrarVacaciones` / `previsualizarRegistro`, `eliminarRegistroVacaciones` y `obtenerHistorialPeriodos`. BEGIN toma una foto, ROLLBACK la
 * restaura y COMMIT la descarta. Cualquier sentencia no prevista lanza (así una consulta nueva no pasa desapercibida).
 */
export type Emp = { id: number; empresa_id: number; nombre: string; fecha_alta: string | null };
export type Saldo = { id: number; empresa_id: number; id_empleado: number; anio_laboral: number | null; periodo_inicio: string; periodo_fin: string; dias_otorgados: number; dias_disponibles: number; estado: string };
export type Inc = { id: number; empresa_id: number; id_empleado: number; tipo: string; fecha_inicio: string; fecha_fin: string; dias_habiles: number };
export type Vac = { id: number; empresa_id: number; id_empleado: number; fecha_inicio: string; fecha_fin: string; dias_habiles: number; estado: string };
export type Det = { id: number; incidencia_id: number; saldo_id: number; dias_tomados: number };
export type Aud = { empresa_id: number | null; usuario: string | null; accion: string; detalle: string | null };
export type Tablas = { empleados: Emp[]; saldos: Saldo[]; incidencias: Inc[]; vacaciones: Vac[]; detalle: Det[]; auditoria: Aud[] };

const norm = (s: string) => s.replace(/\s+/g, " ").trim();
const clon = <T,>(x: T): T => JSON.parse(JSON.stringify(x)) as T;
const r2 = (n: number) => Math.round(n * 100) / 100;
const TIPOS = ["Vacaciones", "A cuenta de Vacaciones"];

export class BdVac {
  t: Tablas = { empleados: [], saldos: [], incidencias: [], vacaciones: [], detalle: [], auditoria: [] };
  feriados: string[] = [];
  ejecutadas: string[] = [];
  eventos: string[] = [];
  fallarSi: ((sql: string) => boolean) | null = null;
  private foto: Tablas | null = null;
  private seq = { saldo: 0, inc: 0, vac: 0, det: 0 };

  reiniciar(t: Partial<Tablas> = {}): void {
    this.t = { empleados: [], saldos: [], incidencias: [], vacaciones: [], detalle: [], auditoria: [], ...clon(t) };
    this.feriados = []; this.ejecutadas = []; this.eventos = []; this.fallarSi = null; this.foto = null;
    const max = (xs: { id: number }[], base: number) => Math.max(base, ...xs.map((x) => x.id));
    this.seq = { saldo: max(this.t.saldos, 0), inc: max(this.t.incidencias, 0), vac: max(this.t.vacaciones, 0), det: max(this.t.detalle, 0) };
  }
  instantanea(): Tablas { return clon(this.t); }

  /** `query` del pool (lecturas). */
  consulta = async (sql: string, params: unknown[] = []): Promise<Record<string, unknown>[]> => (await this.query(sql, params))[0];

  conexion() {
    return {
      query: (sql: string, params?: unknown[]) => this.query(sql, params),
      execute: (sql: string, params?: unknown[]) => this.execute(sql, params),
      beginTransaction: async () => { this.eventos.push("BEGIN"); this.foto = clon(this.t); },
      commit: async () => { this.eventos.push("COMMIT"); this.foto = null; },
      rollback: async () => { this.eventos.push("ROLLBACK"); if (this.foto) this.t = this.foto; this.foto = null; },
      release: () => { this.eventos.push("RELEASE"); },
    };
  }

  private antes(sql: string) {
    this.ejecutadas.push(sql);
    if (this.fallarSi?.(sql)) throw new Error(`fallo inyectado en: ${sql.slice(0, 70)}`);
  }

  async query(sqlO: string, p: unknown[] = []): Promise<[Record<string, unknown>[], undefined]> {
    const sql = norm(sqlO);
    this.antes(sql);
    return [this.leer(sql, p), undefined];
  }

  private saldosDe(e: number, emp: number) { return this.t.saldos.filter((s) => s.empresa_id === e && s.id_empleado === emp); }
  private consumido(saldoId: number) { return r2(this.t.detalle.filter((d) => d.saldo_id === saldoId).reduce((s, d) => s + d.dias_tomados, 0)); }

  private leer(sql: string, p: unknown[]): Record<string, unknown>[] {
    const t = this.t;
    if (sql === "SELECT fecha_alta FROM empleados WHERE id = ? AND empresa_id = ? LIMIT 1") {
      const e = t.empleados.find((x) => x.id === p[0] && x.empresa_id === p[1]);
      return e ? [{ fecha_alta: e.fecha_alta }] : [];
    }
    if (sql === "SELECT nombre FROM empleados WHERE id = ? AND empresa_id = ? LIMIT 1") {
      const e = t.empleados.find((x) => x.id === p[0] && x.empresa_id === p[1]);
      return e ? [{ nombre: e.nombre }] : [];
    }
    if (sql.startsWith("SELECT id, anio_laboral, periodo_inicio, periodo_fin, dias_otorgados, dias_disponibles, estado FROM saldos_vacaciones WHERE empresa_id = ? AND id_empleado = ?")) {
      return this.saldosDe(Number(p[0]), Number(p[1])).map((s) => ({ ...s }));
    }
    if (sql.startsWith("SELECT DISTINCT d.saldo_id FROM detalle_consumo_vacaciones d")) {
      const ids = new Set(this.saldosDe(Number(p[0]), Number(p[1])).map((s) => s.id));
      return [...new Set(t.detalle.filter((d) => ids.has(d.saldo_id)).map((d) => d.saldo_id))].map((saldo_id) => ({ saldo_id }));
    }
    if (sql.startsWith("SELECT id, estado, anio_laboral, dias_otorgados, dias_disponibles FROM saldos_vacaciones WHERE empresa_id = ? AND id_empleado = ? ORDER BY anio_laboral DESC")) {
      return this.saldosDe(Number(p[0]), Number(p[1])).sort((a, b) => (b.anio_laboral ?? 0) - (a.anio_laboral ?? 0)).map((s) => ({ ...s }));
    }
    if (sql.startsWith("SELECT s.id, s.anio_laboral, s.periodo_inicio, s.periodo_fin, s.dias_otorgados, s.dias_disponibles, s.estado, COALESCE((SELECT SUM(d.dias_tomados)")) {
      return this.saldosDe(Number(p[0]), Number(p[1]))
        .sort((a, b) => (a.anio_laboral ?? 99999) - (b.anio_laboral ?? 99999) || a.periodo_inicio.localeCompare(b.periodo_inicio) || a.id - b.id)
        .map((s) => ({ ...s, dias_consumidos: this.consumido(s.id) }));
    }
    if (sql.startsWith("SELECT id, periodo_inicio, periodo_fin, dias_disponibles FROM saldos_vacaciones WHERE empresa_id = ? AND id_empleado = ? AND estado = 'Vigente' AND dias_disponibles > 0")) {
      return this.saldosDe(Number(p[0]), Number(p[1])).filter((s) => s.estado === "Vigente" && s.dias_disponibles > 0).sort((a, b) => (a.anio_laboral ?? 0) - (b.anio_laboral ?? 0)).map((s) => ({ ...s }));
    }
    if (sql.startsWith("SELECT id, anio_laboral, periodo_inicio, periodo_fin, dias_otorgados, dias_disponibles FROM saldos_vacaciones WHERE empresa_id = ? AND id_empleado = ? AND estado = 'Vigente'")) {
      return this.saldosDe(Number(p[0]), Number(p[1])).filter((s) => s.estado === "Vigente").sort((a, b) => (a.anio_laboral ?? 0) - (b.anio_laboral ?? 0)).map((s) => ({ ...s }));
    }
    if (sql.startsWith("SELECT id, tipo, fecha_inicio, fecha_fin FROM incidencias WHERE empresa_id = ? AND id_empleado = ? AND tipo IN")) {
      const [e, emp, fin, ini] = p as [number, number, string, string];
      return t.incidencias.filter((i) => i.empresa_id === e && i.id_empleado === emp && TIPOS.includes(i.tipo) && i.fecha_inicio <= fin && i.fecha_fin >= ini).map((i) => ({ ...i }));
    }
    if (sql.startsWith("SELECT d.saldo_id, d.dias_tomados, i.id AS incidencia_id, i.tipo, i.fecha_inicio, i.fecha_fin FROM detalle_consumo_vacaciones d")) {
      const ids = new Set(this.saldosDe(Number(p[0]), Number(p[1])).map((s) => s.id));
      return t.detalle.filter((d) => ids.has(d.saldo_id)).flatMap((d) => {
        const i = t.incidencias.find((x) => x.id === d.incidencia_id);
        return i ? [{ saldo_id: d.saldo_id, dias_tomados: d.dias_tomados, incidencia_id: i.id, tipo: i.tipo, fecha_inicio: i.fecha_inicio, fecha_fin: i.fecha_fin }] : [];
      }).sort((a, b) => String(a.fecha_inicio).localeCompare(String(b.fecha_inicio)));
    }
    if (sql.startsWith("SELECT d.saldo_id, d.incidencia_id, d.dias_tomados, i.fecha_inicio, i.fecha_fin FROM detalle_consumo_vacaciones d")) {
      const ids = new Set(this.saldosDe(Number(p[0]), Number(p[1])).map((s) => s.id));
      return t.detalle.filter((d) => ids.has(d.saldo_id)).flatMap((d) => {
        const i = t.incidencias.find((x) => x.id === d.incidencia_id);
        return i ? [{ saldo_id: d.saldo_id, incidencia_id: i.id, dias_tomados: d.dias_tomados, fecha_inicio: i.fecha_inicio, fecha_fin: i.fecha_fin }] : [];
      }).sort((a, b) => String(a.fecha_inicio).localeCompare(String(b.fecha_inicio)) || 0);
    }
    if (sql.startsWith("SELECT fecha FROM feriados")) return this.feriados.filter((f) => f >= String(p[1]) && f <= String(p[2])).map((fecha) => ({ fecha }));
    // eliminar
    if (sql.startsWith("SELECT id, id_empleado, tipo, fecha_inicio, fecha_fin, dias_habiles FROM incidencias WHERE id = ? AND empresa_id = ?")) {
      return t.incidencias.filter((i) => i.id === p[0] && i.empresa_id === p[1]).map((i) => ({ ...i }));
    }
    if (sql.startsWith("SELECT id FROM evidencias_incidencias")) return [];
    if (sql.startsWith("SELECT id, saldo_id, dias_tomados FROM detalle_consumo_vacaciones WHERE incidencia_id = ?")) return t.detalle.filter((d) => d.incidencia_id === p[0]).map((d) => ({ ...d }));
    if (sql.startsWith("SELECT id, id_empleado, anio_laboral, dias_otorgados, dias_disponibles, estado FROM saldos_vacaciones WHERE empresa_id = ? AND id IN")) {
      const [e, ...ids] = p as number[];
      return t.saldos.filter((s) => s.empresa_id === e && ids.includes(s.id)).map((s) => ({ ...s }));
    }
    if (sql.startsWith("SELECT id FROM vacaciones WHERE empresa_id = ? AND id_empleado = ? AND fecha_inicio = ?")) {
      const [e, emp, fi, ff, d] = p as [number, number, string, string, number];
      return t.vacaciones.filter((v) => v.empresa_id === e && v.id_empleado === emp && v.fecha_inicio === fi && v.fecha_fin === ff && v.dias_habiles === d && v.estado === "Aprobado").sort((a, b) => b.id - a.id).slice(0, 1).map((v) => ({ id: v.id }));
    }
    if (sql.startsWith("SELECT id FROM solicitudes_vacaciones")) return [];
    if (sql.startsWith("SELECT id, dias_disponibles FROM saldos_vacaciones WHERE empresa_id = ? AND id IN")) {
      const [e, ...ids] = p as number[];
      return t.saldos.filter((s) => s.empresa_id === e && ids.includes(s.id)).map((s) => ({ id: s.id, dias_disponibles: s.dias_disponibles }));
    }
    throw new Error(`BdVac: consulta no soportada: ${sql}`);
  }

  async execute(sqlO: string, p: unknown[] = []): Promise<[{ insertId: number; affectedRows: number }, undefined]> {
    const sql = norm(sqlO);
    this.antes(sql);
    return [this.escribir(sql, p), undefined];
  }

  private escribir(sql: string, p: unknown[]): { insertId: number; affectedRows: number } {
    const t = this.t;
    const ok = (insertId = 0, affectedRows = 1) => ({ insertId, affectedRows });
    if (sql.startsWith("INSERT IGNORE INTO saldos_vacaciones")) {
      const [empresa_id, id_empleado, anio_laboral, periodo_inicio, periodo_fin, dias_otorgados, dias_disponibles] = p as [number, number, number, string, string, number, number];
      if (t.saldos.some((s) => s.id_empleado === id_empleado && s.periodo_inicio === periodo_inicio && s.periodo_fin === periodo_fin)) return ok(0, 0);
      const id = ++this.seq.saldo; t.saldos.push({ id, empresa_id, id_empleado, anio_laboral, periodo_inicio, periodo_fin, dias_otorgados, dias_disponibles, estado: "Vigente" }); return ok(id);
    }
    if (sql.startsWith("UPDATE saldos_vacaciones SET periodo_inicio = ?")) {
      const [ini, fin, otorg, disp, id] = p as [string, string, number, number, number];
      Object.assign(t.saldos.find((s) => s.id === id)!, { periodo_inicio: ini, periodo_fin: fin, dias_otorgados: otorg, dias_disponibles: disp }); return ok();
    }
    if (sql.startsWith("UPDATE saldos_vacaciones SET estado = 'Vencido', dias_disponibles = 0 WHERE id = ?")) {
      Object.assign(t.saldos.find((s) => s.id === p[0])!, { estado: "Vencido", dias_disponibles: 0 }); return ok();
    }
    if (sql === "UPDATE saldos_vacaciones SET dias_disponibles = ? WHERE id = ?") {
      const s = t.saldos.find((x) => x.id === p[1]); if (s) s.dias_disponibles = p[0] as number; return ok(0, s ? 1 : 0);
    }
    if (sql === "UPDATE saldos_vacaciones SET dias_disponibles = ? WHERE id = ? AND empresa_id = ?") {
      const s = t.saldos.find((x) => x.id === p[1] && x.empresa_id === p[2]); if (s) s.dias_disponibles = p[0] as number; return ok(0, s ? 1 : 0);
    }
    if (sql.startsWith("INSERT INTO incidencias (empresa_id, id_empleado, tipo, subtipo,")) {
      const [empresa_id, id_empleado, tipo, , fecha_inicio, fecha_fin, dias_habiles] = p as [number, number, string, unknown, string, string, number];
      const id = ++this.seq.inc; t.incidencias.push({ id, empresa_id, id_empleado, tipo, fecha_inicio, fecha_fin, dias_habiles }); return ok(id);
    }
    if (sql.startsWith("INSERT INTO incidencias (empresa_id, id_empleado, tipo, fecha_inicio,")) {
      const [empresa_id, id_empleado, tipo, fecha_inicio, fecha_fin, dias_habiles] = p as [number, number, string, string, string, number];
      const id = ++this.seq.inc; t.incidencias.push({ id, empresa_id, id_empleado, tipo, fecha_inicio, fecha_fin, dias_habiles }); return ok(id);
    }
    if (sql.startsWith("INSERT INTO vacaciones (empresa_id, id_empleado, fecha_inicio, fecha_fin, dias_habiles, estado)")) {
      const [empresa_id, id_empleado, fecha_inicio, fecha_fin, dias_habiles] = p as [number, number, string, string, number];
      const id = ++this.seq.vac; t.vacaciones.push({ id, empresa_id, id_empleado, fecha_inicio, fecha_fin, dias_habiles, estado: "Aprobado" }); return ok(id);
    }
    if (sql.startsWith("INSERT INTO detalle_consumo_vacaciones (incidencia_id, saldo_id, dias_tomados)")) {
      const [incidencia_id, saldo_id, dias_tomados] = p as [number, number, number];
      if (!t.incidencias.some((i) => i.id === incidencia_id) || !t.saldos.some((s) => s.id === saldo_id)) throw new Error("FK detalle_consumo_vacaciones");
      const id = ++this.seq.det; t.detalle.push({ id, incidencia_id, saldo_id, dias_tomados }); return ok(id);
    }
    if (sql.startsWith("INSERT INTO auditoria")) {
      const [empresa_id, usuario, accion, , detalle] = p as [number | null, string | null, string, unknown, string | null];
      t.auditoria.push({ empresa_id, usuario, accion, detalle }); return ok(t.auditoria.length);
    }
    if (sql === "DELETE FROM detalle_consumo_vacaciones WHERE incidencia_id = ?") { const n = t.detalle.length; t.detalle = t.detalle.filter((d) => d.incidencia_id !== p[0]); return ok(0, n - t.detalle.length); }
    if (sql === "DELETE FROM vacaciones WHERE id = ? AND empresa_id = ?") { const n = t.vacaciones.length; t.vacaciones = t.vacaciones.filter((v) => !(v.id === p[0] && v.empresa_id === p[1])); return ok(0, n - t.vacaciones.length); }
    if (sql === "DELETE FROM incidencias WHERE id = ? AND empresa_id = ?") {
      const n = t.incidencias.length; t.incidencias = t.incidencias.filter((i) => !(i.id === p[0] && i.empresa_id === p[1]));
      t.detalle = t.detalle.filter((d) => t.incidencias.some((i) => i.id === d.incidencia_id)); // ON DELETE CASCADE
      return ok(0, n - t.incidencias.length);
    }
    throw new Error(`BdVac: sentencia no soportada: ${sql}`);
  }
}

export const bd = new BdVac();
export const EMPRESA = 7;

/** Empleado con la fecha de alta del ejemplo del ticket (2019-10-14), sin saldos: el primer registro/sync genera la serie desde la fecha de alta. */
export function escenario(opts: { fechaAlta?: string | null } = {}): Partial<Tablas> {
  return { empleados: [{ id: 1, empresa_id: EMPRESA, nombre: "Ana Pérez", fecha_alta: opts.fechaAlta === undefined ? "2019-10-14" : opts.fechaAlta }] };
}
