import { randomUUID } from "crypto";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock("@/lib/db", () => ({
  getPool: () => holder.pool,
  query: async (texto: string, params: unknown[] = []) => {
    if (!holder.pool) throw new Error("Sin conexión local fixture");
    return (await holder.pool.query(texto, params))[0];
  },
}));

import { listarCumpleaniosDelMes, resumenCumpleaniosDelMes } from "./cumpleanios";

/**
 * Cumpleaños por mes contra MariaDB 11.8.9 DESECHABLE. Se OMITE salvo que exista LIQ_TEST_DB_PORT (3399 o 3407, solo local).
 * Datos 100 % sintéticos. Es SOLO LECTURA: la tabla `empleados` de la fixture imita las columnas reales usadas.
 *   LIQ_TEST_DB_PORT=3399 npx vitest run src/lib/rrhh/cumpleanios.db.test.ts --no-file-parallelism
 */
const port = Number(process.env.LIQ_TEST_DB_PORT ?? 0);
const database = `cumple_test_${randomUUID().replaceAll("-", "")}`;
let sig = 1;

async function emp(o: { empresa?: number; nombre: string; nac: string | null; estado?: string; puesto?: string; area?: string; codigo?: string }) {
  const id = sig++;
  await holder.pool!.execute(
    `INSERT INTO empleados (id, empresa_id, codigo, nombre, puesto, categoria_ops, estado, fecha_nacimiento, dpi, nit, igss, direccion, telefono)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, '2999 99999 0101', '1234567-8', 'IGSS-SECRETO', 'Zona 1 secreta', '5555-0000')`,
    [id, o.empresa ?? 7, o.codigo ?? `E-${String(id).padStart(3, "0")}`, o.nombre, o.puesto ?? "Piloto", o.area ?? "Operaciones", o.estado ?? "Activo", o.nac],
  );
  return id;
}

describe.skipIf(!port)("RRHH · Cumpleaños por mes / MariaDB 11.8.9 SOLO LOCAL", () => {
  beforeAll(async () => {
    if (![3399, 3407].includes(port)) throw new Error("Solo puertos locales desechables 3399/3407");
    const c = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "", multipleStatements: true });
    try {
      await c.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci`);
      await c.query(`USE ${database}`);
      await c.query(`
        CREATE TABLE empleados(id INT PRIMARY KEY, empresa_id INT NOT NULL, codigo VARCHAR(40) NULL, nombre VARCHAR(200) NOT NULL,
          puesto VARCHAR(120) NULL, categoria_ops VARCHAR(80) NULL, estado VARCHAR(20) NOT NULL DEFAULT 'Activo',
          fecha_nacimiento DATE NULL, dpi VARCHAR(20) NULL, nit VARCHAR(20) NULL, igss VARCHAR(30) NULL,
          direccion VARCHAR(255) NULL, telefono VARCHAR(40) NULL, KEY idx_emp_empresa (empresa_id)) ENGINE=InnoDB;
        CREATE TABLE documentos_empleados(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, id_empleado INT NOT NULL,
          tipo_documento VARCHAR(100) NULL, ruta_archivo VARCHAR(500) NOT NULL, nombre_original VARCHAR(255) NULL,
          subido_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, subido_por VARCHAR(100) NULL) ENGINE=InnoDB;
      `);
    } finally {
      await c.end();
    }
    holder.pool = mysql.createPool({ host: "127.0.0.1", port, user: "root", password: "", database, connectionLimit: 4 });

    // Empresa 7 — octubre
    await emp({ nombre: "Zoe Zamora", nac: "1990-10-20" });
    await emp({ nombre: "Ana Pérez", nac: "1985-10-05", puesto: "Contadora", area: "Administración" });
    await emp({ nombre: "Beto Ruiz", nac: "1990-10-05" }); // mismo día que Ana: desempate por nombre
    await emp({ nombre: "Carla Díaz", nac: "2001-10-31" });
    await emp({ nombre: "Baja Octubre", nac: "1980-10-10", estado: "Baja" });
    // Empresa 7 — otros meses (no deben aparecer en octubre)
    await emp({ nombre: "Nov Persona", nac: "1990-11-01" });
    await emp({ nombre: "Sep Persona", nac: "1990-09-30" });
    await emp({ nombre: "Sin Fecha", nac: null });
    // Año de nacimiento no importa: octubre de cualquier año
    await emp({ nombre: "Anciano Octubre", nac: "1950-10-01" });
    // Bisiestos / febrero
    await emp({ nombre: "Bisiesto Feb", nac: "2000-02-29" });
    await emp({ nombre: "Veintiocho Feb", nac: "1995-02-28" });
    await emp({ nombre: "Primero Feb", nac: "1992-02-01" });
    // Empresa 8
    await emp({ empresa: 8, nombre: "Otra Empresa Oct", nac: "1990-10-15", codigo: "X-001" });
  });

  afterAll(async () => {
    await holder.pool?.end();
  });

  it("mes pedido (octubre): solo activos de la empresa, por MES de nacimiento y no por año", async () => {
    const l = await listarCumpleaniosDelMes(7, 10, 2026);
    expect(l).toMatchObject({ mes: 10, anio: 2026, nombreMes: "Octubre", incluirInactivos: false, truncado: false });
    expect(l.empleados.map((e) => e.nombre)).toEqual(["Anciano Octubre", "Ana Pérez", "Beto Ruiz", "Zoe Zamora", "Carla Díaz"]);
    expect(l.total).toBe(5);
  });

  it("orden: día del mes ASC y luego nombre", async () => {
    const l = await listarCumpleaniosDelMes(7, 10, 2026);
    expect(l.empleados.map((e) => [e.dia, e.nombre])).toEqual([
      [1, "Anciano Octubre"], [5, "Ana Pérez"], [5, "Beto Ruiz"], [20, "Zoe Zamora"], [31, "Carla Díaz"],
    ]);
  });

  it("edad que cumple = año consultado − año de nacimiento, en el año consultado", async () => {
    const l2026 = await listarCumpleaniosDelMes(7, 10, 2026);
    expect(l2026.empleados.find((e) => e.nombre === "Ana Pérez")).toMatchObject({ edad: 41, fecha: "2026-10-05" });
    expect(l2026.empleados.find((e) => e.nombre === "Carla Díaz")).toMatchObject({ edad: 25, fecha: "2026-10-31" });
    const l2027 = await listarCumpleaniosDelMes(7, 10, 2027);
    expect(l2027.empleados.find((e) => e.nombre === "Ana Pérez")).toMatchObject({ edad: 42, fecha: "2027-10-05" });
  });

  it("otro mes distinto del actual", async () => {
    expect((await listarCumpleaniosDelMes(7, 11, 2026)).empleados.map((e) => e.nombre)).toEqual(["Nov Persona"]);
    expect((await listarCumpleaniosDelMes(7, 9, 2026)).empleados.map((e) => e.nombre)).toEqual(["Sep Persona"]);
    expect((await listarCumpleaniosDelMes(7, 12, 2026)).empleados).toEqual([]);
  });

  it("solo activos por defecto; con incluirInactivos también las bajas (y se informa el estado)", async () => {
    const act = await listarCumpleaniosDelMes(7, 10, 2026);
    expect(act.empleados.map((e) => e.nombre)).not.toContain("Baja Octubre");
    const todos = await listarCumpleaniosDelMes(7, 10, 2026, { incluirInactivos: true });
    expect(todos.empleados.map((e) => e.nombre)).toContain("Baja Octubre");
    expect(todos.empleados.find((e) => e.nombre === "Baja Octubre")).toMatchObject({ estado: "Baja", dia: 10 });
    expect(todos.incluirInactivos).toBe(true);
  });

  it("aislamiento por empresa: nunca mezcla empleados entre empresas", async () => {
    const o8 = await listarCumpleaniosDelMes(8, 10, 2026);
    expect(o8.empleados.map((e) => e.nombre)).toEqual(["Otra Empresa Oct"]);
    expect((await listarCumpleaniosDelMes(7, 10, 2026)).empleados.map((e) => e.nombre)).not.toContain("Otra Empresa Oct");
    expect((await listarCumpleaniosDelMes(999, 10, 2026)).empleados).toEqual([]);
    const r8 = await resumenCumpleaniosDelMes(8, 10, 2026, "2026-10-01");
    expect(r8.total).toBe(1);
    expect(r8.proximos.map((p) => p.nombre)).toEqual(["Otra Empresa Oct"]);
  });

  it("29 de febrero: pertenece a febrero y conserva su día REAL (29) tanto en año bisiesto como no; orden por día real", async () => {
    const esperado = [[1, "Primero Feb"], [28, "Veintiocho Feb"], [29, "Bisiesto Feb"]];
    const b = await listarCumpleaniosDelMes(7, 2, 2024);
    expect(b.empleados.map((e) => [e.dia, e.nombre])).toEqual(esperado);
    const n = await listarCumpleaniosDelMes(7, 2, 2026); // 2026 no es bisiesto: NO se convierte a 28/02 ni a 01/03
    expect(n.empleados.map((e) => [e.dia, e.nombre])).toEqual(esperado);
    expect(n.empleados.find((e) => e.nombre === "Bisiesto Feb")).toMatchObject({ dia: 29, fecha: "2026-02-29", edad: 26 });
    expect(b.empleados.find((e) => e.nombre === "Bisiesto Feb")).toMatchObject({ dia: 29, fecha: "2024-02-29", edad: 24 });
    // No aparece en marzo.
    expect((await listarCumpleaniosDelMes(7, 3, 2026)).empleados.map((e) => e.nombre)).not.toContain("Bisiesto Feb");
    // La ficha no se modificó.
    const [f] = await holder.pool!.query<RowDataPacket[]>("SELECT DATE_FORMAT(fecha_nacimiento,'%Y-%m-%d') AS f FROM empleados WHERE nombre = 'Bisiesto Feb'");
    expect(f[0].f).toBe("2000-02-29");
  });

  it("no expone datos sensibles en ninguna fila", async () => {
    const l = await listarCumpleaniosDelMes(7, 10, 2026, { incluirInactivos: true });
    const texto = JSON.stringify(l);
    expect(texto).not.toMatch(/2999 99999|1234567-8|IGSS-SECRETO|Zona 1 secreta|5555-0000/);
    for (const e of l.empleados) {
      expect(Object.keys(e).sort()).toEqual(["area", "codigo", "comprobantes", "dia", "edad", "estado", "fecha", "id", "nombre", "puesto"].sort());
    }
  });

  it("resumen del dashboard: conteo del mes y próximos desde hoy, acotado y solo activos", async () => {
    const r = await resumenCumpleaniosDelMes(7, 10, 2026, "2026-10-14", 5);
    expect(r).toMatchObject({ mes: 10, anio: 2026, nombreMes: "Octubre", total: 5 });
    expect(r.proximos.map((p) => [p.dia, p.nombre])).toEqual([[20, "Zoe Zamora"], [31, "Carla Díaz"]]);
    // Mes distinto del actual: arranca desde el primer día.
    const otro = await resumenCumpleaniosDelMes(7, 10, 2026, "2026-09-15", 3);
    expect(otro.proximos.map((p) => p.nombre)).toEqual(["Anciano Octubre", "Ana Pérez", "Beto Ruiz"]);
    // Límite respetado.
    expect((await resumenCumpleaniosDelMes(7, 10, 2026, "2026-09-15", 1)).proximos).toHaveLength(1);
    // Sin cumpleaños: total 0 y sin próximos.
    expect(await resumenCumpleaniosDelMes(7, 12, 2026, "2026-12-01")).toMatchObject({ total: 0, proximos: [] });
    // Febrero no bisiesto: se ordena por día real y el 29/feb se muestra como 29 (sin inventar un 28/02 para esa persona).
    const feb = await resumenCumpleaniosDelMes(7, 2, 2026, "2026-02-10", 5);
    expect(feb.proximos.map((p) => [p.dia, p.nombre])).toEqual([[28, "Veintiocho Feb"], [29, "Bisiesto Feb"]]);
  });
});
