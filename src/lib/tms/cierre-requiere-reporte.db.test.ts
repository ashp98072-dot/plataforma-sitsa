import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock("@/lib/db", () => ({
  getPool: () => {
    if (!holder.pool) throw new Error("Sin conexión local fixture");
    return holder.pool;
  },
  query: async (texto: string, params: unknown[] = []) => {
    if (!holder.pool) throw new Error("Sin conexión local fixture");
    return (await holder.pool.query(texto, params))[0];
  },
  execute: async (texto: string, params: unknown[] = []) => {
    if (!holder.pool) throw new Error("Sin conexión local fixture");
    return (await holder.pool.execute(texto, params as never))[0];
  },
}));

import { cerrarViaje, cerrarViajeManual } from "./cierre-viaje";
import { cerrarViajesMasivo } from "./cierre-masivo";
import { confirmarReporteRecibido, leerLiquidacionPlan, listarEventosLiquidacion } from "./liquidacion-viaje";

/**
 * Cierre de viaje exige REPORTE_RECIBIDO — contra MariaDB 11.8.9 DESECHABLE. Se OMITE salvo que exista LIQ_TEST_DB_PORT
 * (3399 o 3407, solo local). Ejecuta el SQL REAL del cierre (individual, manual y masivo) y de la liquidación. Datos sintéticos.
 *   LIQ_TEST_DB_PORT=3399 npx vitest run src/lib/tms/cierre-requiere-reporte.db.test.ts --no-file-parallelism
 */
const port = Number(process.env.LIQ_TEST_DB_PORT ?? 0);
const database = `cierre_rep_test_${randomUUID().replaceAll("-", "")}`;
const MSG = "No se puede cerrar el viaje porque el reporte aún no ha sido recibido.";
const actor = (empresaId = 7) => ({ empresaId, usuarioId: 4, usuario: "ana" });
let sigPlan = 1000;

const sql = async <T extends RowDataPacket = RowDataPacket>(t: string, p: unknown[] = []): Promise<T[]> => (await holder.pool!.query<T[]>(t, p))[0];
const conteo = async (tabla: string, where = "1=1", p: unknown[] = []) =>
  Number((await sql(`SELECT COUNT(*) AS n FROM ${tabla} WHERE ${where}`, p))[0].n);
const estadoPlan = async (id: number) => String((await sql("SELECT estado FROM tms_planes_viaje WHERE id = ?", [id]))[0].estado);

async function plan(o: { empresa?: number; estado?: string; tarifa?: number | null; tipo?: string; llegada?: boolean } = {}) {
  const id = sigPlan++;
  await holder.pool!.execute(
    "INSERT INTO tms_planes_viaje (id, empresa_id, codigo, estado, fecha_plan, tarifa_comercial, tipo_viaje) VALUES (?, ?, ?, ?, '2026-10-14', ?, ?)",
    [id, o.empresa ?? 7, `PLAN-${id}`, o.estado ?? "Descargado", o.tarifa === undefined ? 500 : o.tarifa, o.tipo ?? "Propio"],
  );
  if (o.llegada) {
    await holder.pool!.execute("INSERT INTO flota_viajes (empresa_id, plan_id, estado) VALUES (?, ?, 'cerrado')", [o.empresa ?? 7, id]);
  }
  return id;
}
/** Fila de liquidación puesta DIRECTAMENTE (para estados que el flujo actual ya no produce sobre un viaje abierto). */
async function liquidacionDirecta(planId: number, estado: "EN_AJUSTE" | "LIQUIDADO") {
  await holder.pool!.execute(
    `INSERT INTO tms_viaje_liquidaciones (empresa_id, plan_id, estado, version, reporte_recibido_en, reporte_recibido_por, liquidado_en, liquidado_por, reabierto_en, reabierto_por)
     VALUES (7, ?, ?, 2, NOW(), 4, NOW(), 4, ${estado === "EN_AJUSTE" ? "NOW()" : "NULL"}, ${estado === "EN_AJUSTE" ? "4" : "NULL"})`,
    [planId, estado],
  );
}
/**
 * Historial HEREDADO real (Fase 3 original: se liquidaba con el viaje abierto): liquidación vigente EN_AJUSTE/LIQUIDADO con la
 * cadena append-only REPORTE_RECIBIDO v1 → LIQUIDADO v2 [→ REABIERTO v3], como la produce el flujo de la aplicación.
 */
async function historialHeredado(planId: number, final: "EN_AJUSTE" | "LIQUIDADO") {
  const enAjuste = final === "EN_AJUSTE";
  await holder.pool!.execute(
    `INSERT INTO tms_viaje_liquidaciones (empresa_id, plan_id, estado, version, reporte_recibido_en, reporte_recibido_por, liquidado_en, liquidado_por, reabierto_en, reabierto_por)
     VALUES (7, ?, ?, ?, NOW(), 4, NOW(), 5, ${enAjuste ? "NOW()" : "NULL"}, ${enAjuste ? "4" : "NULL"})`,
    [planId, final, enAjuste ? 3 : 2],
  );
  const eventos: [number, string, string | null, string, number, string | null][] = [
    [1, "REPORTE_RECIBIDO", null, "REPORTE_RECIBIDO", 4, null],
    [2, "LIQUIDADO", "REPORTE_RECIBIDO", "LIQUIDADO", 5, null],
    ...(enAjuste ? ([[3, "REABIERTO", "LIQUIDADO", "EN_AJUSTE", 4, "Prueba de liquidación antes de la regla"]] as [number, string, string | null, string, number, string | null][]) : []),
  ];
  for (const [version, tipo, antes, despues, actor, detalle] of eventos) {
    await holder.pool!.execute(
      `INSERT INTO tms_viaje_liquidacion_eventos (empresa_id, plan_id, version, tipo, estado_antes, estado_despues, actor_id, detalle, snapshot_json)
       VALUES (7, ?, ?, ?, ?, ?, ?, ?, '{"planEstado":"Programado"}')`,
      [planId, version, tipo, antes, despues, actor, detalle],
    );
  }
}
const huellaLiquidacion = async (planId: number) => ({
  liquidacion: await sql("SELECT * FROM tms_viaje_liquidaciones WHERE plan_id = ?", [planId]),
  eventos: await sql("SELECT * FROM tms_viaje_liquidacion_eventos WHERE plan_id = ? ORDER BY version", [planId]),
});
const totalFilas = async () => ({
  liquidaciones: await conteo("tms_viaje_liquidaciones"),
  eventos: await conteo("tms_viaje_liquidacion_eventos"),
  cargos: await conteo("tms_viaje_cargos_adicionales"),
});

describe.skipIf(!port)("Cierre de viaje exige REPORTE_RECIBIDO / MariaDB 11.8.9 SOLO LOCAL", () => {
  beforeAll(async () => {
    if (![3399, 3407].includes(port)) throw new Error("Solo puertos locales desechables 3399/3407");
    const c = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "", multipleStatements: true });
    try {
      await c.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci`);
      await c.query(`USE ${database}`);
      await c.query(`
        CREATE TABLE empresas(id INT PRIMARY KEY) ENGINE=InnoDB;
        CREATE TABLE usuarios(id INT PRIMARY KEY, username VARCHAR(100)) ENGINE=InnoDB;
        CREATE TABLE tms_planes_viaje(id INT PRIMARY KEY, empresa_id INT NOT NULL, codigo VARCHAR(80) NOT NULL,
          estado VARCHAR(40) NOT NULL, fecha_plan DATE NOT NULL, tarifa_comercial DECIMAL(12,2) NULL,
          tipo_viaje VARCHAR(20) NOT NULL DEFAULT 'Propio', referencia_cliente VARCHAR(160) NULL, cliente_id INT NULL,
          lugar_carga_id INT NULL, lugar_descarga_id INT NULL, ruta_codigo_historico VARCHAR(40) NULL, lugar_descarga_historico VARCHAR(300) NULL,
          tarifa_id INT NULL, tarifa_nombre_historico VARCHAR(120) NULL, tarifa_monto_historico DECIMAL(12,2) NULL, tarifa_moneda_historico VARCHAR(10) NULL,
          unidad_id INT NULL, tc_vehiculo_id INT NULL, tc_placa_historica VARCHAR(40) NULL, tc_externo_placa VARCHAR(40) NULL,
          piloto_id INT NULL, auxiliar_id INT NULL, piloto_externo_nombre VARCHAR(160) NULL, auxiliares_externos TEXT NULL,
          unidad_externa_placa VARCHAR(40) NULL, unidad_externa_descripcion VARCHAR(160) NULL, transportista_externo VARCHAR(160) NULL,
          cerrado_por VARCHAR(100) NULL, cerrado_en DATETIME NULL, cierre_manual TINYINT NOT NULL DEFAULT 0,
          cierre_manual_motivo VARCHAR(500) NULL, cierre_manual_comentario VARCHAR(1000) NULL,
          UNIQUE KEY uq_tmsplanes_empresa_id (empresa_id, id)) ENGINE=InnoDB;
        CREATE TABLE tms_clientes(id INT PRIMARY KEY, empresa_id INT NOT NULL, nombre VARCHAR(200) NOT NULL) ENGINE=InnoDB;
        CREATE TABLE tms_lugares(id INT PRIMARY KEY, empresa_id INT NOT NULL, nombre VARCHAR(200) NOT NULL) ENGINE=InnoDB;
        CREATE TABLE tms_unidades(id INT PRIMARY KEY, empresa_id INT NOT NULL, placa VARCHAR(40) NOT NULL) ENGINE=InnoDB;
        CREATE TABLE tms_personal(id INT PRIMARY KEY, empresa_id INT NOT NULL, nombre VARCHAR(200) NOT NULL) ENGINE=InnoDB;
        CREATE TABLE flota_vehiculos(id INT PRIMARY KEY, placa VARCHAR(40) NOT NULL) ENGINE=InnoDB;
        CREATE TABLE tms_plan_auxiliares(id INT AUTO_INCREMENT PRIMARY KEY, plan_id INT NOT NULL, personal_id INT NOT NULL, orden TINYINT NOT NULL DEFAULT 1) ENGINE=InnoDB;
        CREATE TABLE tms_plan_pilotos_adicionales(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, plan_id INT NOT NULL, personal_id INT NOT NULL, orden TINYINT NOT NULL DEFAULT 1) ENGINE=InnoDB;
        CREATE TABLE auditoria(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT, usuario VARCHAR(100), accion VARCHAR(100), modulo VARCHAR(100), detalle TEXT) ENGINE=InnoDB;
        CREATE TABLE flota_viajes(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, plan_id INT NULL,
          estado VARCHAR(20) NOT NULL DEFAULT 'abierto', km_salida INT NULL, km_llegada INT NULL,
          hora_salida DATETIME NULL, hora_llegada DATETIME NULL, observaciones TEXT NULL) ENGINE=InnoDB;
        CREATE TABLE tms_solicitud_fondo_lineas(id INT AUTO_INCREMENT PRIMARY KEY, plan_id INT) ENGINE=InnoDB;
        CREATE TABLE tms_gastos_operativos(id INT AUTO_INCREMENT PRIMARY KEY, plan_id INT) ENGINE=InnoDB;
        CREATE TABLE tms_plan_cuadrilla(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL DEFAULT 7, plan_id INT NOT NULL,
          orden SMALLINT NOT NULL DEFAULT 1, tipo VARCHAR(10) NOT NULL DEFAULT 'EXTERNO', id_empleado INT NULL,
          nombre VARCHAR(200) NOT NULL DEFAULT 'Cuadrilla', identificacion VARCHAR(100) NULL, telefono VARCHAR(50) NULL) ENGINE=InnoDB;
        CREATE TABLE fact_factura_viajes(id INT AUTO_INCREMENT PRIMARY KEY, plan_id INT) ENGINE=InnoDB;
        CREATE TABLE fel_documentos(id INT AUTO_INCREMENT PRIMARY KEY) ENGINE=InnoDB;
        CREATE TABLE cont_eventos(id INT AUTO_INCREMENT PRIMARY KEY) ENGINE=InnoDB;
        INSERT INTO empresas VALUES (7),(8);
        INSERT INTO usuarios VALUES (4,'ana'),(5,'beto'),(6,'carla');
      `);
      for (const f of ["sql/migrate-2026-10-tms-liquidacion-viajes-fase1.sql", "sql/migrate-2026-10-tms-liquidacion-cargos-fase4.sql"]) {
        await c.query(readFileSync(f, "utf8"));
      }
    } finally {
      await c.end();
    }
    holder.pool = mysql.createPool({ host: "127.0.0.1", port, user: "root", password: "", database, connectionLimit: 16 });
  });

  afterAll(async () => {
    await holder.pool?.end();
  });

  it("sin fila de liquidación: 409 REPORTE_NO_RECIBIDO; el viaje sigue abierto y NO se crea ninguna liquidación", async () => {
    const p = await plan();
    const antes = await totalFilas();
    const r = await cerrarViaje(7, p, "jefe");
    expect(r).toEqual({ ok: false, error: MSG, codigo: "REPORTE_NO_RECIBIDO" });
    expect(await estadoPlan(p)).toBe("Descargado");
    expect(await sql("SELECT cerrado_por, cerrado_en FROM tms_planes_viaje WHERE id = ?", [p])).toEqual([{ cerrado_por: null, cerrado_en: null }]);
    expect(await totalFilas()).toEqual(antes);
    expect(await conteo("auditoria", "accion = 'cerrar_viaje' AND detalle LIKE ?", [`Plan #${p} %`])).toBe(0);
  });

  it("REPORTE_RECIBIDO: cierra; la liquidación NO cambia (misma versión/estado, sin eventos nuevos) y los cargos no se tocan", async () => {
    const p = await plan();
    await confirmarReporteRecibido(actor(), { planId: p });
    await holder.pool!.execute(
      "INSERT INTO tms_viaje_cargos_adicionales (empresa_id, plan_id, concepto, monto, clave_envio, huella, creado_por) VALUES (7, ?, 'Espera', 50, ?, ?, 4)",
      [p, `clave-${p}-xxxxxxxxxxxxxxxx`, "a".repeat(64)],
    );
    const liqAntes = await leerLiquidacionPlan(7, p);
    const eventosAntes = await listarEventosLiquidacion(7, p);
    const cargosAntes = await sql("SELECT * FROM tms_viaje_cargos_adicionales WHERE plan_id = ?", [p]);

    const r = await cerrarViaje(7, p, "jefe");
    expect(r).toEqual({ ok: true });
    expect(await estadoPlan(p)).toBe("Cerrado");
    expect(await leerLiquidacionPlan(7, p)).toEqual(liqAntes);
    expect(await listarEventosLiquidacion(7, p)).toEqual(eventosAntes);
    expect(await sql("SELECT * FROM tms_viaje_cargos_adicionales WHERE plan_id = ?", [p])).toEqual(cargosAntes);
    expect(liqAntes).toMatchObject({ estado: "REPORTE_RECIBIDO", version: 1 });
  });

  it("EN_AJUSTE y LIQUIDADO sin evento REPORTE_RECIBIDO (fixture inválido) NO habilitan el cierre", async () => {
    for (const estado of ["EN_AJUSTE", "LIQUIDADO"] as const) {
      const p = await plan();
      await liquidacionDirecta(p, estado);
      expect(await cerrarViaje(7, p, "jefe"), estado).toEqual({ ok: false, error: MSG, codigo: "REPORTE_NO_RECIBIDO" });
      expect(await estadoPlan(p)).toBe("Descargado");
      expect((await leerLiquidacionPlan(7, p))?.estado).toBe(estado);
    }
  });

  it("Cancelado y Cerrado conservan su comportamiento actual (no piden reporte)", async () => {
    const c = await plan({ estado: "Cancelado" });
    expect(await cerrarViaje(7, c, "jefe")).toEqual({ ok: false, error: "Este viaje está cancelado; no admite cierre." });
    const cer = await plan({ estado: "Cerrado" });
    expect(await cerrarViaje(7, cer, "jefe")).toEqual({ ok: false, error: "Este viaje ya fue cerrado." });
    expect(await estadoPlan(c)).toBe("Cancelado");
    expect(await conteo("tms_viaje_liquidaciones", "plan_id IN (?, ?)", [c, cer])).toBe(0);
  });

  it("Cerrado + EN_AJUSTE / LIQUIDADO siguen Cerrados: el cierre ya no se reabre ni se vuelve a validar", async () => {
    for (const estado of ["EN_AJUSTE", "LIQUIDADO"] as const) {
      const p = await plan({ estado: "Cerrado" });
      await liquidacionDirecta(p, estado);
      expect(await cerrarViaje(7, p, "jefe")).toEqual({ ok: false, error: "Este viaje ya fue cerrado." });
      expect(await estadoPlan(p)).toBe("Cerrado");
    }
  });

  it("tercerizado: misma regla (sin reporte bloqueado; con REPORTE_RECIBIDO cierra y audita el tipo)", async () => {
    const p = await plan({ tipo: "Tercerizado" });
    expect(await cerrarViaje(7, p, "jefe")).toMatchObject({ ok: false, codigo: "REPORTE_NO_RECIBIDO" });
    await confirmarReporteRecibido(actor(), { planId: p });
    expect(await cerrarViaje(7, p, "jefe")).toEqual({ ok: true });
    expect(await conteo("auditoria", "accion = 'cerrar_viaje' AND detalle LIKE ?", [`Plan #${p} % Tercerizado`])).toBe(1);
  });

  it("En ruta / Cargado con llegada: exige reporte igual; sin llegada sigue pidiendo la llegada primero", async () => {
    const conLlegada = await plan({ estado: "En ruta", llegada: true });
    expect(await cerrarViaje(7, conLlegada, "jefe")).toMatchObject({ codigo: "REPORTE_NO_RECIBIDO" });
    await confirmarReporteRecibido(actor(), { planId: conLlegada });
    expect(await cerrarViaje(7, conLlegada, "jefe")).toEqual({ ok: true });
    const sinLlegada = await plan({ estado: "En ruta" });
    await confirmarReporteRecibido(actor(), { planId: sinLlegada });
    expect(await cerrarViaje(7, sinLlegada, "jefe")).toEqual({
      ok: false, error: "El piloto todavía no ha registrado la llegada de este viaje; no se puede cerrar todavía.",
    });
  });

  it("cierre MANUAL sin reporte: rechazado sin tocar flota_viajes ni el plan; con reporte: cierra y cierra el flota abierto", async () => {
    const p = await plan({ estado: "En ruta" });
    await holder.pool!.execute("INSERT INTO flota_viajes (empresa_id, plan_id, estado, observaciones) VALUES (7, ?, 'abierto', 'obs original')", [p]);
    const m = { empresaId: 7, planId: p, usuario: "jefe", motivo: "Cierre administrativo del día" };
    expect(await cerrarViajeManual(m)).toEqual({ ok: false, error: MSG, codigo: "REPORTE_NO_RECIBIDO" });
    expect(await estadoPlan(p)).toBe("En ruta");
    expect(await sql("SELECT estado, observaciones FROM flota_viajes WHERE plan_id = ?", [p])).toEqual([{ estado: "abierto", observaciones: "obs original" }]);

    await confirmarReporteRecibido(actor(), { planId: p });
    expect(await cerrarViajeManual(m)).toEqual({ ok: true, flotaViajeCerrado: true });
    expect(await estadoPlan(p)).toBe("Cerrado");
    expect((await leerLiquidacionPlan(7, p))?.estado).toBe("REPORTE_RECIBIDO");
  });

  it("cierre masivo: cierra los que tienen REPORTE_RECIBIDO y omite (con motivo) los demás — semántica parcial conservada", async () => {
    const ok1 = await plan();
    const sin = await plan();
    const ajuste = await plan();
    const ok2 = await plan();
    const otra = await plan({ empresa: 8 });
    for (const id of [ok1, ok2]) await confirmarReporteRecibido(actor(), { planId: id });
    await liquidacionDirecta(ajuste, "EN_AJUSTE");
    await confirmarReporteRecibido(actor(8), { planId: otra });

    const r = await cerrarViajesMasivo({ empresaId: 7, usuario: "jefe", tipo: "NORMAL", planIds: [ok1, sin, ajuste, ok2, otra] });
    expect(r.cerrados.map((c) => c.id)).toEqual([ok1, ok2]);
    expect(r.omitidos).toEqual([
      { id: sin, codigo: `PLAN-${sin}`, motivo: MSG },
      { id: ajuste, codigo: `PLAN-${ajuste}`, motivo: MSG },
      { id: otra, codigo: "—", motivo: "Viaje no encontrado." }, // otra empresa: nunca visible
    ]);
    expect(r.errores).toEqual([]);
    expect(await estadoPlan(sin)).toBe("Descargado");
    expect(await estadoPlan(ajuste)).toBe("Descargado");
    expect(await estadoPlan(otra)).toBe("Descargado"); // la empresa 8 no se cerró desde la empresa 7
  });

  it("aislamiento por empresa: el reporte de OTRA empresa no habilita ni el cierre ni el id ajeno", async () => {
    const p = await plan({ empresa: 8 });
    await confirmarReporteRecibido(actor(8), { planId: p });
    expect(await cerrarViaje(7, p, "jefe")).toEqual({ ok: false, error: "Viaje no encontrado." });
    expect(await cerrarViajeManual({ empresaId: 7, planId: p, usuario: "jefe", motivo: "Cierre administrativo del día" })).toEqual({ ok: false, error: "Viaje no encontrado." });
    expect(await estadoPlan(p)).toBe("Descargado");
    expect(await cerrarViaje(8, p, "jefe")).toEqual({ ok: true }); // su propia empresa sí
  });

  it("concurrencia: confirmar reporte y cerrar a la vez — NUNCA queda Cerrado sin REPORTE_RECIBIDO", async () => {
    for (let i = 0; i < 10; i++) {
      const p = await plan();
      const [cierre] = await Promise.all([
        cerrarViaje(7, p, "jefe"),
        confirmarReporteRecibido(actor(), { planId: p }).catch(() => null),
      ]);
      const cerrado = (await estadoPlan(p)) === "Cerrado";
      const liq = await leerLiquidacionPlan(7, p);
      if (cerrado) {
        expect(cierre, `iteración ${i}`).toEqual({ ok: true });
        expect(liq?.estado, `iteración ${i}`).toBe("REPORTE_RECIBIDO");
      } else {
        expect(cierre, `iteración ${i}`).toMatchObject({ ok: false, codigo: "REPORTE_NO_RECIBIDO" });
      }
    }
  });

  it("doble clic: dos cierres simultáneos con reporte — uno cierra y el otro ve «ya fue cerrado»", async () => {
    const p = await plan();
    await confirmarReporteRecibido(actor(), { planId: p });
    const [a, b] = await Promise.all([cerrarViaje(7, p, "jefe"), cerrarViaje(7, p, "jefe")]);
    expect([a.ok, b.ok].sort()).toEqual([false, true]);
    expect([a, b].find((x) => !x.ok)).toMatchObject({ error: "Este viaje ya fue cerrado." });
    expect(await conteo("auditoria", "accion = 'cerrar_viaje' AND detalle LIKE ?", [`Plan #${p} %`])).toBe(1);
  });

  it("no afecta facturación, FEL, contabilidad, fondos ni gastos", async () => {
    for (const t of ["fact_factura_viajes", "fel_documentos", "cont_eventos", "tms_solicitud_fondo_lineas", "tms_gastos_operativos"]) {
      expect(await conteo(t), t).toBe(0);
    }
  });

  // ───────────── COMPATIBILIDAD: planes heredados con evidencia histórica de reporte recibido ─────────────
  it("plan 587 equivalente (Programado + EN_AJUSTE con REPORTE_RECIBIDO v1 → LIQUIDADO → REABIERTO): se cierra sin reescribir el historial", async () => {
    const p = await plan({ estado: "Programado" });
    await historialHeredado(p, "EN_AJUSTE");
    const antes = await huellaLiquidacion(p);
    const totalAntes = await totalFilas();
    expect(antes.eventos.map((e) => [e.version, e.tipo])).toEqual([[1, "REPORTE_RECIBIDO"], [2, "LIQUIDADO"], [3, "REABIERTO"]]);

    // Programado solo admite cierre MANUAL (motivo obligatorio); exige tarifa y ahora el reporte «fue recibido».
    const r = await cerrarViajeManual({ empresaId: 7, planId: p, usuario: "jefe", motivo: "Regularización: viaje de prueba heredado" });
    expect(r).toEqual({ ok: true, flotaViajeCerrado: false });
    expect(await estadoPlan(p)).toBe("Cerrado");
    expect(await sql("SELECT cerrado_por, cierre_manual FROM tms_planes_viaje WHERE id = ?", [p])).toEqual([{ cerrado_por: "jefe", cierre_manual: 1 }]);

    // Historia intacta: ni una fila de liquidación/evento/cargo cambió ni se creó.
    expect(await huellaLiquidacion(p)).toEqual(antes);
    expect(await totalFilas()).toEqual(totalAntes);
    expect(await conteo("auditoria", "accion = 'cerrar_viaje_manual' AND detalle LIKE ?", [`Plan #${p} %`])).toBe(1);
  });

  it("Descargado + LIQUIDADO con evento REPORTE_RECIBIDO: cierre normal permitido; liquidación y eventos intactos", async () => {
    const p = await plan({ estado: "Descargado" });
    await historialHeredado(p, "LIQUIDADO");
    const antes = await huellaLiquidacion(p);
    expect(await cerrarViaje(7, p, "jefe")).toEqual({ ok: true });
    expect(await estadoPlan(p)).toBe("Cerrado");
    expect(await huellaLiquidacion(p)).toEqual(antes);
    expect((await leerLiquidacionPlan(7, p))?.estado).toBe("LIQUIDADO");
  });

  it("EN_AJUSTE/LIQUIDADO con la fila de liquidación pero SIN el evento REPORTE_RECIBIDO: bloqueado y sin cambios", async () => {
    for (const estado of ["EN_AJUSTE", "LIQUIDADO"] as const) {
      const p = await plan({ estado: "Descargado" });
      await liquidacionDirecta(p, estado); // fila sin ningún evento (historia inexistente)
      const antes = await huellaLiquidacion(p);
      expect(await cerrarViaje(7, p, "jefe"), estado).toEqual({ ok: false, error: MSG, codigo: "REPORTE_NO_RECIBIDO" });
      expect(await estadoPlan(p)).toBe("Descargado");
      expect(await huellaLiquidacion(p)).toEqual(antes);
    }
  });

  it("REPORTE_RECIBIDO actual sigue habilitando (flujo normal REPORTE_RECIBIDO → Cerrar → Liquidar)", async () => {
    const p = await plan();
    await confirmarReporteRecibido(actor(), { planId: p });
    expect(await cerrarViaje(7, p, "jefe")).toEqual({ ok: true });
  });

  it("masivo: heredados con evento se cierran; sin evento o sin fila se omiten; otra empresa no aparece", async () => {
    const heredado = await plan();
    await historialHeredado(heredado, "EN_AJUSTE");
    const invalido = await plan();
    await liquidacionDirecta(invalido, "LIQUIDADO");
    const sin = await plan();
    const nuevo = await plan();
    await confirmarReporteRecibido(actor(), { planId: nuevo });
    const r = await cerrarViajesMasivo({ empresaId: 7, usuario: "jefe", tipo: "NORMAL", planIds: [heredado, invalido, sin, nuevo] });
    expect(r.cerrados.map((c) => c.id)).toEqual([heredado, nuevo]);
    expect(r.omitidos.map((o) => [o.id, o.motivo])).toEqual([[invalido, MSG], [sin, MSG]]);
    expect(await estadoPlan(invalido)).toBe("Descargado");
  });

  it("la lista de Planes (liquidacionesDePlanes) informa reporteRecibido por evidencia histórica, no por el estado posterior", async () => {
    const { liquidacionesDePlanes } = await import("./liquidacion-viaje");
    const heredado = await plan();
    await historialHeredado(heredado, "EN_AJUSTE");
    const invalido = await plan();
    await liquidacionDirecta(invalido, "EN_AJUSTE");
    const m = await liquidacionesDePlanes(7, [heredado, invalido]);
    expect(m.get(heredado)).toMatchObject({ estado: "EN_AJUSTE", reporteRecibido: true });
    expect(m.get(invalido)).toMatchObject({ estado: "EN_AJUSTE", reporteRecibido: false });
  });
});
