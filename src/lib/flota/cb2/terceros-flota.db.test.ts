import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * VERIFICACIÓN CONTRA UNA BASE REAL DESECHABLE — registrar unidades externas Shell sin duplicar Flota.
 *
 * Se OMITE por defecto. Solo corre con `SHELL_PLACAS_DB_PORT` apuntando a una MariaDB LOCAL y DESECHABLE (127.0.0.1, root sin contraseña). Crea y destruye
 * SU PROPIO esquema `shell_placas_test` (reducido) con datos sintéticos y ejecuta el código REAL de `registrarUnidad` (transacción, cerrojo empresarial,
 * auditoría, referencia estable) con la guarda contra Flota. Nada toca producción.
 */
const PUERTO = process.env.SHELL_PLACAS_DB_PORT;
const ESQUEMA = "shell_placas_test";

vi.mock("@/lib/db", async () => {
  const mysql = await import("mysql2/promise");
  let pool: ReturnType<typeof mysql.createPool> | null = null;
  const obtener = () => {
    if (!pool) pool = mysql.createPool({ host: "127.0.0.1", port: Number(process.env.SHELL_PLACAS_DB_PORT), user: "root", password: "", database: "shell_placas_test", connectionLimit: 8, timezone: "local" });
    return pool;
  };
  return { getPool: obtener, query: async (sql: string, params: unknown[] = []) => (await obtener().query(sql, params as never))[0] };
});

import mysql from "mysql2/promise";
import { getPool } from "@/lib/db";
import { registrarUnidad } from "./terceros";
import { referenciaUnidadShell } from "@/components/flota/cb2/placas-pendientes";
import { hash } from "./model";
import { nombreComparable } from "../combustible-coincidencias";

const E1 = 1, E2 = 2, OPERADOR = 5;
const q = async (sql: string, params: unknown[] = []) => (await getPool().query(sql, params as never))[0] as Record<string, unknown>[];
const ctx = (empresaId = E1) => ({ empresaId, actor: { id: OPERADOR, username: "operador" }, autorizar: async () => {}, escrituraDirecta: true });
const alta = (placa: string, extra: Record<string, unknown> = {}, empresaId = E1) =>
  registrarUnidad(ctx(empresaId), { referencia: referenciaUnidadShell(placa), placa, tipo: "VEHICULO", descripcion: "Unidad externa confirmada desde un vale Shell", ...extra });
const externas = async (empresa = E1) => q("SELECT id, placa FROM flota_cb2_externos_unidades WHERE empresa_id=? ORDER BY id", [empresa]);

describe.skipIf(!PUERTO)(`BD real desechable (${ESQUEMA})`, () => {
  beforeAll(async () => {
    vi.stubEnv("CB2_TERCEROS_DIRECTOS_APROBADA", "1");
    const admin = await mysql.createConnection({ host: "127.0.0.1", port: Number(PUERTO), user: "root", password: "" });
    await admin.query(`DROP DATABASE IF EXISTS ${ESQUEMA}`);
    await admin.query(`CREATE DATABASE ${ESQUEMA} CHARACTER SET utf8mb4`);
    await admin.end();
    await q("CREATE TABLE empresas (id INT PRIMARY KEY, activa TINYINT NOT NULL DEFAULT 1) ENGINE=InnoDB");
    await q("CREATE TABLE usuarios (id INT PRIMARY KEY, activo TINYINT NOT NULL DEFAULT 1, rol_global VARCHAR(30) NOT NULL) ENGINE=InnoDB");
    await q("CREATE TABLE auditoria (id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NULL, usuario VARCHAR(100) NULL, accion VARCHAR(100), modulo VARCHAR(60) NULL, detalle LONGTEXT NULL) ENGINE=InnoDB");
    await q("CREATE TABLE flota_vehiculos (id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, placa VARCHAR(40) NOT NULL, estado VARCHAR(40) NOT NULL DEFAULT 'Activo', activo TINYINT(1) NOT NULL DEFAULT 1, UNIQUE KEY uq (empresa_id, placa)) ENGINE=InnoDB");
    await q("CREATE TABLE flota_vehiculo_acceso (vehiculo_id INT NOT NULL, empresa_id INT NOT NULL, PRIMARY KEY (vehiculo_id, empresa_id)) ENGINE=InnoDB");
    await q("CREATE TABLE flota_vehiculos_fusiones (origen_id INT PRIMARY KEY, destino_id INT NOT NULL, empresa_id INT NOT NULL) ENGINE=InnoDB");
    await q("CREATE TABLE flota_cb2_externos_unidades (id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, referencia VARCHAR(160) NOT NULL, referencia_hash CHAR(64) NOT NULL, placa VARCHAR(160) NOT NULL, tipo VARCHAR(20) NOT NULL, descripcion VARCHAR(160) NOT NULL, UNIQUE KEY uq_ref (empresa_id, referencia_hash)) ENGINE=InnoDB");
    await q("INSERT INTO empresas (id) VALUES (1),(2)");
    await q("INSERT INTO usuarios (id, activo, rol_global) VALUES (5, 1, 'Operaciones')");
    // Flota de la empresa 1: 1 activa · 2 «558 BSJ» canónica · 3 «558BSJ» absorbida (inactiva) · 4 en taller · 5 compartida (de la empresa 2 con acceso a la 1)
    await q("INSERT INTO flota_vehiculos (id, empresa_id, placa, estado, activo) VALUES (1,1,'M-001MON','Activo',1),(2,1,'558 BSJ','Activo',1),(3,1,'558BSJ','Inactivo',0),(4,1,'C-777ENT','En taller',1),(5,2,'C-555CMP','Activo',1),(6,2,'P-666AJE','Activo',1)");
    await q("INSERT INTO flota_vehiculo_acceso (vehiculo_id, empresa_id) VALUES (5, 1)");
    await q("INSERT INTO flota_vehiculos_fusiones (origen_id, destino_id, empresa_id) VALUES (3, 2, 1)");
  }, 60000);
  afterAll(async () => { vi.unstubAllEnvs(); await (getPool() as unknown as { end(): Promise<void> }).end(); });

  it("placa de un vehículo ACTIVO de Flota (cualquier formato): se rechaza con 409 y no se crea ninguna unidad externa", async () => {
    for (const p of ["M-001MON", "m 001 mon", "M001MON"]) await expect(alta(p), p).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/ya existe en Flota: #1/) });
    expect(await externas()).toEqual([]);
  });

  it("placa de un vehículo ABSORBIDO por la fusión (558BSJ): se rechaza indicando el vehículo CANÓNICO", async () => {
    await expect(alta("558BSJ")).rejects.toThrow(/#3 \(558BSJ\) — no operable: inactiva o en taller; fusionada, vehículo canónico #2 \(558 BSJ\)/);
    await expect(alta("558 BSJ")).rejects.toMatchObject({ status: 409 });
    expect(await externas()).toEqual([]);
  });

  it("vehículo EN TALLER o compartido con la empresa: también se rechaza (el catálogo del navegador no los trae, el servidor sí los conoce)", async () => {
    await expect(alta("C-777ENT")).rejects.toThrow(/#4 \(C-777ENT\) — no operable/);
    await expect(alta("C-555CMP")).rejects.toThrow(/#5 \(C-555CMP\)/); // propiedad de la empresa 2, compartido con la 1
    expect(await externas()).toEqual([]);
  });

  it("aislamiento: la placa de un vehículo de OTRA empresa sin acceso compartido no bloquea; la propia empresa dueña sí la bloquea", async () => {
    const r = await alta("P-666AJE"); // la empresa 1 no tiene acceso al vehículo 6
    expect(r.existente).toBe(false);
    await expect(alta("P-666AJE", {}, E2)).rejects.toThrow(/ya existe en Flota: #6/);
  });

  it("placa realmente nueva: se registra una vez y reintentar con la misma referencia reutiliza la identidad (sin duplicar)", async () => {
    const a = await alta("M-424KHK", { tipo: "MOTOCICLETA" });
    expect(a.existente).toBe(false);
    const b = await alta("m 424-khk", { tipo: "MOTOCICLETA" }); // otro formato, misma placa comparable -> misma referencia estable
    expect(b).toEqual({ id: a.id, existente: true });
    expect((await externas()).filter((u) => String(u.placa).replace(/[\s-]/g, "").toUpperCase() === "M424KHK")).toHaveLength(1);
  });

  it("registros concurrentes de la misma placa nueva: queda una sola unidad", async () => {
    const resultados = await Promise.allSettled([1, 2, 3, 4].map(() => alta("P-777NEW")));
    expect(resultados.filter((r) => r.status === "fulfilled").length).toBeGreaterThan(0);
    expect((await q("SELECT COUNT(*) AS n FROM flota_cb2_externos_unidades WHERE empresa_id=1 AND placa='P-777NEW'"))[0].n).toBe(1);
  });

  it("placa casi igual a una de Flota (un carácter): exige confirmación expresa; con ella se registra", async () => {
    await expect(alta("M-001MOX")).rejects.toThrow(/casi igual a unidades de Flota/);
    const r = await alta("M-001MOX", { confirmarCoincidencias: true });
    expect(r.existente).toBe(false);
  });

  it("una referencia distinta para la misma placa externa sigue pidiendo confirmación (comportamiento previo conservado)", async () => {
    await expect(registrarUnidad(ctx(), { referencia: "otra-referencia", placa: "M-424KHK", tipo: "MOTOCICLETA", descripcion: "x" })).rejects.toThrow(/Placa coincidente con unidades/);
  });

  it("auditoría: solo las altas efectivas quedan registradas (los rechazos no dejan rastro de unidades)", async () => {
    const altas = await q("SELECT COUNT(*) AS n FROM auditoria WHERE accion='cb2_unidad_tercera_creada'");
    expect(altas[0].n).toBe((await externas()).length);
  });

  it("CASO INVERSO en base real: placa COMPLETA frente a Flota ABREVIADA («C-558BSJ» vs «558 BSJ»/«558BSJ»): bloquea con el canónico y confirmarCoincidencias no la salta", async () => {
    const antes = await externas();
    for (const confirmar of [false, true]) await expect(alta("C-558BSJ", confirmar ? { confirmarCoincidencias: true } : {})).rejects.toThrow(/ya existe en Flota: #2 \(558 BSJ\) \/ #3 \(558BSJ\).*vehículo canónico #2/);
    await expect(alta("M-558BSJ", { confirmarCoincidencias: true })).rejects.toMatchObject({ status: 409 });
    await expect(alta("001 MON", { confirmarCoincidencias: true })).rejects.toThrow(/ya existe en Flota: #1 \(M-001MON\)/); // sentido directo
    expect(await externas()).toEqual(antes);
  });

  it("REUTILIZACIÓN: una unidad externa registrada ANTES de que existiera el vehículo en Flota ya no se reutiliza (409), sin modificar el registro externo", async () => {
    const ref = referenciaUnidadShell("P-888LAT");
    await q("INSERT INTO flota_cb2_externos_unidades (empresa_id, referencia, referencia_hash, placa, tipo, descripcion) VALUES (1, ?, ?, 'P-888LAT', 'VEHICULO', 'Registrada antes del alta en Flota')", [ref, hash(nombreComparable(ref))]);
    expect(await alta("P-888LAT")).toMatchObject({ existente: true }); // todavía no hay vehículo en Flota con esa placa: idempotente como siempre
    const antes = await q("SELECT * FROM flota_cb2_externos_unidades WHERE placa='P-888LAT'");
    await q("INSERT INTO flota_vehiculos (empresa_id, placa) VALUES (1, 'P-888LAT')"); // ahora la unidad existe en Flota
    await expect(alta("P-888LAT")).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/La unidad externa #\d+ \(«P-888LAT»\) coincide con una unidad de Flota: #\d+ \(P-888LAT\)\. No se reutiliza/) });
    await expect(alta("p 888-lat", { confirmarCoincidencias: true })).rejects.toMatchObject({ status: 409 }); // otro formato, misma referencia estable; confirmar no salta la coincidencia
    expect(await q("SELECT * FROM flota_cb2_externos_unidades WHERE placa='P-888LAT'")).toEqual(antes); // la historia externa no se toca
  });

  it("REUTILIZACIÓN idempotente: una externa «casi igual» confirmada al crearla se sigue reutilizando al reintentar (sin pedir confirmar otra vez)", async () => {
    const primera = await alta("M-002MOX", { confirmarCoincidencias: true }); // casi igual a M-001MON
    expect(primera.existente).toBe(false);
    expect(await alta("M-002MOX")).toEqual({ id: primera.id, existente: true });
  });
});
