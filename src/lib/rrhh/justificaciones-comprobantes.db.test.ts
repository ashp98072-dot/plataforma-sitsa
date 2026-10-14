import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ pool: null as Pool | null, guardados: [] as string[], borrados: [] as string[] }));
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
// El almacenamiento en disco se simula: aquí se prueba el modelo/reglas, no el sistema de archivos.
vi.mock("@/lib/uploads", () => ({
  MAX_UPLOAD_BYTES: 50 * 1024 * 1024,
  UploadValidationError: class extends Error { status = 400; },
  guardarUpload: async (empresaId: number, _sub: string, prefix: string, file: { name: string; size: number }) => {
    const relative = `empresas/${empresaId}/documentos/${prefix}_${holder.guardados.length}${file.name.slice(file.name.lastIndexOf("."))}`;
    holder.guardados.push(relative);
    return { relative, original: file.name, size: file.size };
  },
  borrarUpload: (r: string) => { holder.borrados.push(r); },
}));
vi.mock("./vacaciones", () => ({ obtenerFeriadosEnRango: async () => new Set<string>() }));

import { obtenerReporteAsistencias } from "./reportes";
import { editarJustificacion, justificarFalta, obtenerContextoJustificacion, revertirJustificacion } from "./justificaciones-faltas";
import { listarCumpleaniosDelMes } from "./cumpleanios";
import {
  contarDocumentosPorTipo,
  eliminarDocumentoPorTipo,
  listarDocumentosPorTipo,
  obtenerDocumentoConPrefijo,
  subirDocumentoPorTipo,
  validarArchivoEvidencia,
} from "./documentos-por-tipo";
import { PREFIJO_COMPROBANTE_CUMPLEANIOS, tipoDocumentoComprobanteCumpleanios } from "./cumpleanios-shared";
import { tipoDocumentoEvidenciaJustificacion } from "./justificaciones-faltas-shared";

/**
 * Justificación de faltas + comprobantes de cumpleaños contra MariaDB 11.8.9 DESECHABLE. Se OMITE salvo que exista
 * LIQ_TEST_DB_PORT (3399 o 3407, solo local). Ejecuta el código REAL del reporte, la justificación y los documentos, y el SQL
 * REAL de la migración (dos veces). Datos 100 % sintéticos.
 *   LIQ_TEST_DB_PORT=3399 npx vitest run src/lib/rrhh/justificaciones-comprobantes.db.test.ts --no-file-parallelism
 */
const port = Number(process.env.LIQ_TEST_DB_PORT ?? 0);
const database = `rrhh_just_test_${randomUUID().replaceAll("-", "")}`;
const A = { empresaId: 7, usuario: "ana" };
const B = { empresaId: 7, usuario: "beto" };
const OTRA = { empresaId: 8, usuario: "carla" };
const FECHA = "2026-09-16"; // miércoles (laborable)
const FECHA2 = "2026-09-17";

const sql = async <T extends RowDataPacket = RowDataPacket>(t: string, p: unknown[] = []): Promise<T[]> => (await holder.pool!.query<T[]>(t, p))[0];
const conteo = async (tabla: string, where = "1=1", p: unknown[] = []) =>
  Number((await sql(`SELECT COUNT(*) AS n FROM ${tabla} WHERE ${where}`, p))[0].n);
const codigo = (p: Promise<unknown>) => p.then(() => "OK", (e: { codigoJustificacion?: string; status?: number }) => e.codigoJustificacion ?? `ERR${e.status ?? ""}`);

const JPG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0, 1]);
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const WEBP = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0x0a, 0, 0, 0]);
const archivo = (nombre: string, bytes: Uint8Array, size?: number) => {
  const f = new File([bytes.buffer as ArrayBuffer], nombre);
  if (size != null) Object.defineProperty(f, "size", { value: size });
  return f;
};

let sigEmp = 1;
async function empleado(o: { empresa?: number; codigo?: string; nombre: string; estado?: string; alta?: string; nac?: string | null }) {
  const id = sigEmp++;
  await holder.pool!.execute(
    `INSERT INTO empleados (id, empresa_id, codigo, nombre, estado, fecha_alta, hora_entrada_teorica, hora_salida_teorica, tipo_horario, puesto, categoria_ops, fecha_nacimiento)
     VALUES (?, ?, ?, ?, ?, ?, '08:00:00', '17:00:00', 'Fijo', 'Piloto', 'Operaciones', ?)`,
    [id, o.empresa ?? 7, o.codigo ?? `E-${String(id).padStart(3, "0")}`, o.nombre, o.estado ?? "Activo", o.alta ?? "2020-01-01", o.nac === undefined ? "1990-09-20" : o.nac],
  );
  return id;
}

describe.skipIf(!port)("RRHH · justificación de faltas y comprobantes / MariaDB 11.8.9 SOLO LOCAL", () => {
  beforeAll(async () => {
    if (![3399, 3407].includes(port)) throw new Error("Solo puertos locales desechables 3399/3407");
    const c = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "", multipleStatements: true });
    try {
      await c.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci`);
      await c.query(`USE ${database}`);
      await c.query(`
        CREATE TABLE empresas(id INT PRIMARY KEY) ENGINE=InnoDB;
        CREATE TABLE empleados(id INT PRIMARY KEY, empresa_id INT NOT NULL, codigo VARCHAR(40) NULL, nombre VARCHAR(200) NOT NULL,
          estado VARCHAR(20) NOT NULL DEFAULT 'Activo', fecha_alta DATE NOT NULL, hora_entrada_teorica VARCHAR(10) NULL,
          hora_salida_teorica VARCHAR(10) NULL, tipo_horario VARCHAR(30) NULL, puesto VARCHAR(120) NULL,
          categoria_ops VARCHAR(80) NULL, fecha_nacimiento DATE NULL, KEY idx_e (empresa_id),
          UNIQUE KEY uq_emp_empresa_id (empresa_id, id)) ENGINE=InnoDB;
        CREATE TABLE sesiones_trabajo(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, id_empleado INT NOT NULL,
          fecha_jornada DATE NOT NULL, entrada_at DATETIME NULL, salida_at DATETIME NULL, comentarios_rrhh TEXT NULL) ENGINE=InnoDB;
        CREATE TABLE marcaje_evidencias(id INT AUTO_INCREMENT PRIMARY KEY, sesion_id INT NOT NULL, tipo VARCHAR(20) NOT NULL) ENGINE=InnoDB;
        CREATE TABLE incidencias(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, id_empleado INT NOT NULL,
          tipo VARCHAR(80) NOT NULL, fecha_inicio DATE NOT NULL, fecha_fin DATE NOT NULL) ENGINE=InnoDB;
        CREATE TABLE marcajes_en_ruta(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, id_empleado INT NOT NULL,
          fecha_inicio DATE NOT NULL, fecha_fin DATE NOT NULL) ENGINE=InnoDB;
        CREATE TABLE configuracion(empresa_id INT NOT NULL, parametro VARCHAR(80) NOT NULL, valor VARCHAR(200) NULL) ENGINE=InnoDB;
        CREATE TABLE auditoria(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT, usuario VARCHAR(100), accion VARCHAR(100), modulo VARCHAR(100), detalle TEXT) ENGINE=InnoDB;
        CREATE TABLE rrhh_asistencia_ausencias(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, empleado_id INT NOT NULL,
          fecha DATE NOT NULL, estado VARCHAR(20) NOT NULL DEFAULT 'CONFIRMADA', planilla_periodo_id INT NULL) ENGINE=InnoDB;
        CREATE TABLE documentos_empleados(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, id_empleado INT NOT NULL,
          tipo_documento VARCHAR(100) NULL, ruta_archivo VARCHAR(500) NOT NULL, nombre_original VARCHAR(255) NULL,
          subido_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, subido_por VARCHAR(100) NULL) ENGINE=InnoDB;
        INSERT INTO empresas VALUES (7),(8);
      `);
      const ddl = readFileSync("sql/migrate-2026-10-rrhh-justificaciones-faltas.sql", "utf8");
      await c.query(ddl);
      await c.query(ddl); // segunda ejecución: NOOP
      const [n] = await c.query<RowDataPacket[]>("SELECT COUNT(*) AS n FROM rrhh_asistencia_justificaciones");
      expect(Number(n[0].n)).toBe(0); // sin seeds ni backfill
    } finally {
      await c.end();
    }
    holder.pool = mysql.createPool({ host: "127.0.0.1", port, user: "root", password: "", database, connectionLimit: 10 });
  });

  afterAll(async () => {
    await holder.pool?.end();
  });

  // ───────────────────────────── justificación de faltas ─────────────────────────────
  it("justificar: la fila sigue siendo una falta, ahora «Falta justificada», con tipo, quién y cuándo; sin marcaje falso", async () => {
    const e = await empleado({ nombre: "Falta Uno" });
    const antes = await obtenerReporteAsistencias(7, FECHA, FECHA);
    expect(antes.find((f) => f.idEmpleado === e)).toMatchObject({ estadoEntrada: "Falta", motivo: "Falta", justificacion: null });
    const sesiones0 = await conteo("sesiones_trabajo");
    const inc0 = await conteo("incidencias");

    const r = await justificarFalta(A, { empleadoId: e, fecha: FECHA, tipo: "Médico", observacion: "  Cita en el IGSS  " });
    expect(r).toMatchObject({ evento: "JUSTIFICADA", idempotente: false, justificacion: { tipo: "Médico", observacion: "Cita en el IGSS", estado: "ACTIVA", version: 1, creadoPor: "ana" } });

    const despues = (await obtenerReporteAsistencias(7, FECHA, FECHA)).find((f) => f.idEmpleado === e)!;
    expect(despues).toMatchObject({
      estadoEntrada: "Falta justificada", motivo: "Falta justificada: Médico", horaEntrada: null, horaSalida: null, idSesion: 0,
      justificacion: { tipo: "Médico", observacion: "Cita en el IGSS", creadoPor: "ana" },
    });
    // No crea marcajes ni incidencias; no «convierte» a A tiempo.
    expect(await conteo("sesiones_trabajo")).toBe(sesiones0);
    expect(await conteo("incidencias")).toBe(inc0);
    expect(despues.estadoEntrada).not.toBe("A tiempo");
    // Auditoría con el actor.
    expect(await conteo("auditoria", "accion = 'justificacion_falta_creada' AND usuario = 'ana'")).toBeGreaterThanOrEqual(1);
    // El filtro «Falta» sigue incluyendo la ausencia justificada; «Falta justificada» la aísla.
    const soloFalta = await obtenerReporteAsistencias(7, FECHA, FECHA, { tipo: "Falta" });
    expect(soloFalta.map((f) => f.idEmpleado)).toContain(e);
    const soloJust = await obtenerReporteAsistencias(7, FECHA, FECHA, { tipo: "Falta justificada" });
    expect(soloJust.map((f) => f.idEmpleado)).toContain(e);
    expect(soloJust.every((f) => f.estadoEntrada === "Falta justificada")).toBe(true);
  });

  it("solo se justifica una FALTA real: no A tiempo, ni vacaciones, ni en ruta, ni días no laborables ni futuros", async () => {
    const trabajo = await empleado({ nombre: "Trabajó" });
    await holder.pool!.execute("INSERT INTO sesiones_trabajo (empresa_id, id_empleado, fecha_jornada, entrada_at, salida_at) VALUES (7, ?, ?, ?, ?)", [trabajo, FECHA, `${FECHA} 08:00:00`, `${FECHA} 17:00:00`]);
    const vac = await empleado({ nombre: "De Vacaciones" });
    await holder.pool!.execute("INSERT INTO incidencias (empresa_id, id_empleado, tipo, fecha_inicio, fecha_fin) VALUES (7, ?, 'Vacaciones', ?, ?)", [vac, FECHA, FECHA]);
    const ruta = await empleado({ nombre: "En Ruta" });
    await holder.pool!.execute("INSERT INTO marcajes_en_ruta (empresa_id, id_empleado, fecha_inicio, fecha_fin) VALUES (7, ?, ?, ?)", [ruta, FECHA, FECHA]);
    const baja = await empleado({ nombre: "Dado de baja", estado: "Baja" });

    for (const id of [trabajo, vac, ruta]) {
      expect(await codigo(justificarFalta(A, { empleadoId: id, fecha: FECHA, tipo: "Médico" })), `empleado ${id}`).toBe("NO_ES_FALTA");
    }
    expect(await codigo(justificarFalta(A, { empleadoId: baja, fecha: FECHA, tipo: "Médico" }))).toBe("NO_ENCONTRADO");
    expect(await codigo(justificarFalta(A, { empleadoId: trabajo, fecha: "2026-09-20", tipo: "Médico" }))).toBe("NO_ENCONTRADO"); // domingo: no laborable
    expect(await codigo(justificarFalta(A, { empleadoId: trabajo, fecha: "2099-01-01", tipo: "Médico" }))).toBe("SOLICITUD_INVALIDA");
    expect(await conteo("rrhh_asistencia_justificaciones", "empleado_id IN (?,?,?,?)", [trabajo, vac, ruta, baja])).toBe(0);
    // Los tipos con efecto propio (vacaciones) o la propia «Falta» no son motivos de justificación.
    const e = await empleado({ nombre: "Tipos" });
    for (const t of ["Vacaciones", "A cuenta de Vacaciones", "Falta", "Inventado", ""]) {
      expect(await codigo(justificarFalta(A, { empleadoId: e, fecha: FECHA, tipo: t })), t).toBe("SOLICITUD_INVALIDA");
    }
  });

  it("doble clic / doble envío: una sola justificación; contenido distinto = conflicto", async () => {
    const e = await empleado({ nombre: "Doble Clic" });
    const resultados = await Promise.all(
      Array.from({ length: 5 }, () => justificarFalta(A, { empleadoId: e, fecha: FECHA, tipo: "Permiso con goce", observacion: "Trámite" })),
    );
    expect(resultados.filter((r) => !r.idempotente)).toHaveLength(1);
    expect(await conteo("rrhh_asistencia_justificaciones", "empleado_id = ?", [e])).toBe(1);
    expect(await conteo("auditoria", "accion = 'justificacion_falta_creada' AND detalle LIKE ?", [`%empleado #${e} %`])).toBe(1);
    expect(await codigo(justificarFalta(B, { empleadoId: e, fecha: FECHA, tipo: "Enfermedad" }))).toBe("YA_JUSTIFICADA");
  });

  it("editar (versión optimista), revertir con motivo (sin borrar), volver a justificar", async () => {
    const e = await empleado({ nombre: "Ciclo" });
    const { justificacion: j } = await justificarFalta(A, { empleadoId: e, fecha: FECHA2, tipo: "Enfermedad" });

    const ed = await editarJustificacion(B, { id: j.id, versionEsperada: 1, tipo: "Médico", observacion: "Constancia" });
    expect(ed).toMatchObject({ evento: "EDITADA", justificacion: { tipo: "Médico", observacion: "Constancia", version: 2, actualizadoPor: "beto" } });
    expect(await codigo(editarJustificacion(A, { id: j.id, versionEsperada: 1, tipo: "Otro" }))).toBe("CONFLICTO_VERSION");
    expect((await editarJustificacion(B, { id: j.id, versionEsperada: 1, tipo: "Médico", observacion: "Constancia" })).idempotente).toBe(true); // réplica

    expect(await codigo(revertirJustificacion(A, { id: j.id, versionEsperada: 2, motivo: "no" }))).toBe("SOLICITUD_INVALIDA");
    const rv = await revertirJustificacion(A, { id: j.id, versionEsperada: 2, motivo: "Se presentó constancia falsa" });
    expect(rv).toMatchObject({ evento: "REVERTIDA", justificacion: { estado: "REVERTIDA", version: 3, revertidoPor: "ana", motivoReversion: "Se presentó constancia falsa" } });
    // La fila NO se borró y la falta vuelve a verse como Falta.
    expect(await conteo("rrhh_asistencia_justificaciones", "id = ?", [j.id])).toBe(1);
    const fila = (await obtenerReporteAsistencias(7, FECHA2, FECHA2)).find((f) => f.idEmpleado === e)!;
    expect(fila).toMatchObject({ estadoEntrada: "Falta", justificacion: null });
    expect(await codigo(editarJustificacion(A, { id: j.id, versionEsperada: 3, tipo: "Otro" }))).toBe("NO_ACTIVA");
    expect((await revertirJustificacion(A, { id: j.id, versionEsperada: 2, motivo: "Se presentó constancia falsa" })).idempotente).toBe(true);

    // Auditoría de cada paso con su actor.
    for (const a of ["justificacion_falta_creada", "justificacion_falta_editada", "justificacion_falta_revertida"]) {
      expect(await conteo("auditoria", "accion = ? AND detalle LIKE ?", [a, `Justificación #${j.id} %`]), a).toBe(1);
    }
    // Volver a justificar reactiva la misma fila (versión + 1) y limpia las marcas de reversión.
    const re = await justificarFalta(B, { empleadoId: e, fecha: FECHA2, tipo: "Permiso sin goce" });
    expect(re).toMatchObject({ evento: "JUSTIFICADA", justificacion: { id: j.id, estado: "ACTIVA", version: 4, tipo: "Permiso sin goce", motivoReversion: null } });
  });

  it("aislamiento por empresa: otra empresa no ve, no justifica ni edita ni revierte", async () => {
    const e = await empleado({ nombre: "Solo Empresa 7" });
    const { justificacion: j } = await justificarFalta(A, { empleadoId: e, fecha: FECHA, tipo: "Médico" });
    expect(await codigo(justificarFalta(OTRA, { empleadoId: e, fecha: FECHA, tipo: "Médico" }))).toBe("NO_ENCONTRADO");
    expect(await codigo(editarJustificacion(OTRA, { id: j.id, versionEsperada: 1, tipo: "Otro" }))).toBe("NO_ENCONTRADO");
    expect(await codigo(revertirJustificacion(OTRA, { id: j.id, versionEsperada: 1, motivo: "Intento ajeno" }))).toBe("NO_ENCONTRADO");
    expect(await obtenerContextoJustificacion(8, e, FECHA)).toBeNull();
    const otraFila = (await obtenerReporteAsistencias(8, FECHA, FECHA)).find((f) => f.idEmpleado === e);
    expect(otraFila).toBeUndefined();
    // Un empleado de empresa 8 con la misma fecha NO hereda la justificación de la empresa 7.
    const e8 = await empleado({ empresa: 8, nombre: "Empresa 8" });
    expect((await obtenerReporteAsistencias(8, FECHA, FECHA)).find((f) => f.idEmpleado === e8)).toMatchObject({ estadoEntrada: "Falta", justificacion: null });
  });

  it("planilla: justificar NO elimina ni cambia la ausencia/descuento (CONFIRMADA sigue CONFIRMADA, también tras editar y revertir)", async () => {
    const e = await empleado({ nombre: "Con Ausencia" });
    await holder.pool!.execute("INSERT INTO rrhh_asistencia_ausencias (empresa_id, empleado_id, fecha, estado, planilla_periodo_id) VALUES (7, ?, ?, 'CONFIRMADA', NULL)", [e, FECHA]);
    const antes = await sql("SELECT * FROM rrhh_asistencia_ausencias ORDER BY id");
    const ctx = await obtenerContextoJustificacion(7, e, FECHA);
    expect(ctx).toMatchObject({ justificable: true, planilla: { ausenciaConfirmada: true, aplicadaEnPlanilla: false } });

    const { justificacion: j } = await justificarFalta(A, { empleadoId: e, fecha: FECHA, tipo: "Permiso con goce" });
    expect(await sql("SELECT * FROM rrhh_asistencia_ausencias ORDER BY id")).toEqual(antes);
    await editarJustificacion(A, { id: j.id, versionEsperada: 1, tipo: "Médico" });
    await revertirJustificacion(A, { id: j.id, versionEsperada: 2, motivo: "Se retira la justificación" });
    expect(await sql("SELECT * FROM rrhh_asistencia_ausencias ORDER BY id")).toEqual(antes);
    // Ninguna tabla de planilla/incidencias/marcajes fue creada ni escrita por la justificación.
    const tablas = (await sql<RowDataPacket>("SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = ?", [database])).map((t) => String(t.TABLE_NAME));
    expect(tablas.filter((t) => /descuento|planilla/i.test(t))).toEqual([]);
    expect(await conteo("incidencias", "id_empleado = ?", [e])).toBe(0);
    expect(await conteo("sesiones_trabajo", "id_empleado = ?", [e])).toBe(0);
  });

  // ───────────────────────────── FK TENANT-SAFE ─────────────────────────────
  it("la FK de empleado es COMPUESTA (empresa_id, empleado_id) → empleados(empresa_id, id) y no solo por id", async () => {
    const cols = await sql<RowDataPacket>(
      `SELECT ORDINAL_POSITION, COLUMN_NAME, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'rrhh_asistencia_justificaciones' AND CONSTRAINT_NAME = 'fk_asist_just_empleado'
        ORDER BY ORDINAL_POSITION`,
      [database],
    );
    expect(cols.map((c) => [Number(c.ORDINAL_POSITION), c.COLUMN_NAME, c.REFERENCED_TABLE_NAME, c.REFERENCED_COLUMN_NAME])).toEqual([
      [1, "empresa_id", "empleados", "empresa_id"],
      [2, "empleado_id", "empleados", "id"],
    ]);
    const reglas = await sql<RowDataPacket>(
      "SELECT CONSTRAINT_NAME, UPDATE_RULE, DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = ? AND TABLE_NAME = 'rrhh_asistencia_justificaciones' ORDER BY CONSTRAINT_NAME",
      [database],
    );
    expect(reglas.map((r) => [r.CONSTRAINT_NAME, r.UPDATE_RULE, r.DELETE_RULE])).toEqual([
      ["fk_asist_just_empleado", "RESTRICT", "CASCADE"],
      ["fk_asist_just_empresa", "RESTRICT", "CASCADE"],
    ]);
  });

  it("la BD IMPIDE una fila con empresa A y empleado de la empresa B, aunque la aplicación omitiera la validación", async () => {
    const e7 = await empleado({ nombre: "Pertenece a 7" });
    const insertar = (empresa: number, emp: number) =>
      holder.pool!.execute(
        "INSERT INTO rrhh_asistencia_justificaciones (empresa_id, empleado_id, fecha, tipo, creado_por) VALUES (?, ?, ?, 'Médico', 'x')",
        [empresa, emp, "2026-09-18"],
      );
    await expect(insertar(8, e7)).rejects.toMatchObject({ errno: 1452 }); // FK compuesta: (8, e7) no existe en empleados
    await expect(insertar(7, 999999)).rejects.toMatchObject({ errno: 1452 });
    await insertar(7, e7); // el par correcto sí entra
    expect(await conteo("rrhh_asistencia_justificaciones", "empleado_id = ?", [e7])).toBe(1);
    // Cambiar la empresa de un empleado con justificaciones está bloqueado (ON UPDATE RESTRICT en la FK compuesta).
    await expect(holder.pool!.execute("UPDATE empleados SET empresa_id = 8 WHERE id = ?", [e7])).rejects.toMatchObject({ errno: 1451 });
  });

  it("borrar un empleado elimina sus justificaciones (política CASCADE, igual que rrhh_asistencia_ausencias)", async () => {
    const e = await empleado({ nombre: "Se Elimina" });
    await justificarFalta(A, { empleadoId: e, fecha: FECHA, tipo: "Médico" });
    expect(await conteo("rrhh_asistencia_justificaciones", "empleado_id = ?", [e])).toBe(1);
    await holder.pool!.execute("DELETE FROM empleados WHERE id = ?", [e]);
    expect(await conteo("rrhh_asistencia_justificaciones", "empleado_id = ?", [e])).toBe(0);
  });

  it("sin el índice UNIQUE (empresa_id, id) en empleados la migración FALLA completa (no deja tabla parcial ni débil)", async () => {
    const base = `${database}_sinindice`;
    const c = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "", multipleStatements: true });
    try {
      await c.query(`CREATE DATABASE ${base} CHARACTER SET utf8mb4`);
      await c.query(`USE ${base}`);
      await c.query(`
        CREATE TABLE empresas(id INT PRIMARY KEY) ENGINE=InnoDB;
        CREATE TABLE empleados(id INT PRIMARY KEY, empresa_id INT NOT NULL) ENGINE=InnoDB;`);
      const ddl = readFileSync("sql/migrate-2026-10-rrhh-justificaciones-faltas.sql", "utf8");
      await expect(c.query(ddl)).rejects.toMatchObject({ errno: expect.any(Number) });
      const [t] = await c.query<RowDataPacket[]>("SHOW TABLES LIKE 'rrhh_asistencia_justificaciones'");
      expect(t).toHaveLength(0);
    } finally {
      await c.end(); // Sin DROP: base desechable recuperable (nombre único por corrida).
    }
  });

  // ───────────────────────────── comprobantes de cumpleaños ─────────────────────────────
  it("adjuntar JPG, JPEG, PNG, WebP y PDF; cada uno queda con su usuario y fecha de carga", async () => {
    const e = await empleado({ nombre: "Cumple Formatos" });
    const tipo = tipoDocumentoComprobanteCumpleanios(2026);
    for (const [nombre, bytes] of [["a.jpg", JPG], ["b.JPEG", JPG], ["c.png", PNG], ["d.webp", WEBP], ["e.pdf", PDF]] as const) {
      const d = await subirDocumentoPorTipo({
        empresaId: 7, empleadoId: e, tipoDocumento: tipo, prefijo: `cumple_${e}_2026`, usuario: "ana",
        file: archivo(nombre, bytes), accionAuditoria: "comprobante_cumpleanios_adjuntado", detalleAuditoria: `Comprobante de cumpleaños 2026 · empleado #${e}`,
      });
      expect(d).toMatchObject({ tipoDocumento: tipo, subidoPor: "ana", nombreOriginal: nombre, empresaId: 7, idEmpleado: e });
    }
    const lista = await listarDocumentosPorTipo(7, e, tipo);
    expect(lista).toHaveLength(5);
    expect(lista.every((d) => d.subidoEn && d.subidoPor === "ana")).toBe(true);
    expect(await conteo("auditoria", "accion = 'comprobante_cumpleanios_adjuntado' AND detalle LIKE ?", [`%empleado #${e}%`])).toBe(5);
  });

  it("rechaza formato inválido, contenido que no corresponde, archivo vacío y tamaño excedido sin guardar nada", async () => {
    const e = await empleado({ nombre: "Cumple Rechazos" });
    const antes = await conteo("documentos_empleados", "id_empleado = ?", [e]);
    const guardadosAntes = holder.guardados.length;
    const intentos: [string, File, RegExp][] = [
      ["exe", archivo("virus.exe", JPG), /Formato no permitido/],
      ["gif", archivo("a.gif", JPG), /Formato no permitido/],
      ["bmp (permitido en el repo, NO aquí)", archivo("a.bmp", JPG), /Formato no permitido/],
      ["sin extensión", archivo("archivo", JPG), /Formato no permitido/],
      ["jpg falso (es PDF)", archivo("falso.jpg", PDF), /no corresponde/],
      ["png falso (texto)", archivo("falso.png", new TextEncoder().encode("hola mundo....")), /no corresponde/],
      ["vacío", archivo("vacio.pdf", new Uint8Array(0)), /vacío/],
      ["muy grande", archivo("grande.pdf", PDF, 60 * 1024 * 1024), /máximo/],
    ];
    for (const [nombre, file, re] of intentos) {
      await expect(
        subirDocumentoPorTipo({
          empresaId: 7, empleadoId: e, tipoDocumento: tipoDocumentoComprobanteCumpleanios(2026), prefijo: "x", usuario: "ana",
          file, accionAuditoria: "a", detalleAuditoria: "d",
        }),
        nombre,
      ).rejects.toThrow(re);
    }
    expect(await conteo("documentos_empleados", "id_empleado = ?", [e])).toBe(antes);
    expect(holder.guardados.length).toBe(guardadosAntes); // nada llegó a disco
    await expect(validarArchivoEvidencia(archivo("ok.webp", WEBP))).resolves.toBe(".webp");
  });

  it("el año separa los comprobantes: 2026 y 2027 del mismo empleado son independientes", async () => {
    const e = await empleado({ nombre: "Cumple Años", nac: "1990-09-20" });
    const sube = (anio: number, nombre: string) =>
      subirDocumentoPorTipo({
        empresaId: 7, empleadoId: e, tipoDocumento: tipoDocumentoComprobanteCumpleanios(anio), prefijo: "c", usuario: "ana",
        file: archivo(nombre, JPG), accionAuditoria: "a", detalleAuditoria: "d",
      });
    await sube(2026, "v2026-1.jpg");
    await sube(2026, "v2026-2.jpg");
    await sube(2027, "v2027.jpg");
    expect((await listarDocumentosPorTipo(7, e, tipoDocumentoComprobanteCumpleanios(2026))).map((d) => d.nombreOriginal).sort()).toEqual(["v2026-1.jpg", "v2026-2.jpg"]);
    expect((await listarDocumentosPorTipo(7, e, tipoDocumentoComprobanteCumpleanios(2027))).map((d) => d.nombreOriginal)).toEqual(["v2027.jpg"]);
    expect((await contarDocumentosPorTipo(7, [e], tipoDocumentoComprobanteCumpleanios(2026))).get(e)).toBe(2);
    expect((await contarDocumentosPorTipo(7, [e], tipoDocumentoComprobanteCumpleanios(2028))).get(e)).toBeUndefined();

    // El listado de cumpleaños refleja la cantidad del AÑO consultado (septiembre).
    const l2026 = await listarCumpleaniosDelMes(7, 9, 2026);
    const l2027 = await listarCumpleaniosDelMes(7, 9, 2027);
    const l2028 = await listarCumpleaniosDelMes(7, 9, 2028);
    expect(l2026.empleados.find((x) => x.id === e)?.comprobantes).toBe(2);
    expect(l2027.empleados.find((x) => x.id === e)?.comprobantes).toBe(1);
    expect(l2028.empleados.find((x) => x.id === e)?.comprobantes).toBe(0);
  });

  it("aislamiento por empresa: los documentos de otra empresa no se listan, cuentan, sirven ni eliminan", async () => {
    const e7 = await empleado({ nombre: "Cumple Empresa 7", nac: "1990-09-21" });
    const e8 = await empleado({ empresa: 8, nombre: "Cumple Empresa 8", nac: "1990-09-21" });
    const tipo = tipoDocumentoComprobanteCumpleanios(2026);
    const d7 = await subirDocumentoPorTipo({ empresaId: 7, empleadoId: e7, tipoDocumento: tipo, prefijo: "c", usuario: "ana", file: archivo("a.jpg", JPG), accionAuditoria: "a", detalleAuditoria: "d" });
    await subirDocumentoPorTipo({ empresaId: 8, empleadoId: e8, tipoDocumento: tipo, prefijo: "c", usuario: "carla", file: archivo("b.jpg", JPG), accionAuditoria: "a", detalleAuditoria: "d" });

    expect(await listarDocumentosPorTipo(8, e7, tipo)).toEqual([]);
    expect((await contarDocumentosPorTipo(8, [e7, e8], tipo)).get(e7)).toBeUndefined();
    expect(await obtenerDocumentoConPrefijo(8, d7.id, PREFIJO_COMPROBANTE_CUMPLEANIOS)).toBeNull();
    expect(await eliminarDocumentoPorTipo({ empresaId: 8, docId: d7.id, tipoDocumento: PREFIJO_COMPROBANTE_CUMPLEANIOS, usuario: "carla", accionAuditoria: "x", detalleAuditoria: "y" })).toBe(false);
    expect(await conteo("documentos_empleados", "id = ?", [d7.id])).toBe(1);
    expect((await listarCumpleaniosDelMes(8, 9, 2026)).empleados.map((x) => x.id)).not.toContain(e7);
  });

  it("el endpoint de comprobantes solo sirve/elimina documentos de SU tipo (no otros del expediente)", async () => {
    const e = await empleado({ nombre: "Expediente" });
    await holder.pool!.execute(
      "INSERT INTO documentos_empleados (empresa_id, id_empleado, tipo_documento, ruta_archivo, nombre_original, subido_por) VALUES (7, ?, 'DPI', 'empresas/7/documentos/dpi.jpg', 'dpi.jpg', 'rrhh')",
      [e],
    );
    const [{ id }] = await sql<RowDataPacket>("SELECT id FROM documentos_empleados WHERE id_empleado = ? AND tipo_documento = 'DPI'", [e]);
    expect(await obtenerDocumentoConPrefijo(7, Number(id), PREFIJO_COMPROBANTE_CUMPLEANIOS)).toBeNull();
    expect(await obtenerDocumentoConPrefijo(7, Number(id), "Justificación de falta ")).toBeNull();
    expect(await eliminarDocumentoPorTipo({ empresaId: 7, docId: Number(id), tipoDocumento: PREFIJO_COMPROBANTE_CUMPLEANIOS, usuario: "ana", accionAuditoria: "x", detalleAuditoria: "y" })).toBe(false);
    expect(await conteo("documentos_empleados", "id = ?", [id])).toBe(1);
  });

  it("eliminar un comprobante: borra el registro y el archivo, y queda en la bitácora con el actor", async () => {
    const e = await empleado({ nombre: "Cumple Eliminar" });
    const tipo = tipoDocumentoComprobanteCumpleanios(2026);
    const d = await subirDocumentoPorTipo({ empresaId: 7, empleadoId: e, tipoDocumento: tipo, prefijo: "c", usuario: "ana", file: archivo("x.pdf", PDF), accionAuditoria: "a", detalleAuditoria: "d" });
    expect(await eliminarDocumentoPorTipo({ empresaId: 7, docId: d.id, tipoDocumento: PREFIJO_COMPROBANTE_CUMPLEANIOS, usuario: "beto", accionAuditoria: "comprobante_cumpleanios_eliminado", detalleAuditoria: "Comprobante de cumpleaños" })).toBe(true);
    expect(await listarDocumentosPorTipo(7, e, tipo)).toEqual([]);
    expect(holder.borrados).toContain(d.rutaArchivo);
    expect(await conteo("auditoria", "accion = 'comprobante_cumpleanios_eliminado' AND usuario = 'beto' AND detalle LIKE ?", [`%doc #${d.id}%`])).toBe(1);
  });

  it("evidencia de una justificación: tipo por fecha, independiente de los comprobantes de cumpleaños", async () => {
    const e = await empleado({ nombre: "Con Evidencia" });
    await subirDocumentoPorTipo({
      empresaId: 7, empleadoId: e, tipoDocumento: tipoDocumentoEvidenciaJustificacion(FECHA), prefijo: "j", usuario: "ana",
      file: archivo("constancia.pdf", PDF), accionAuditoria: "justificacion_falta_evidencia_adjuntada", detalleAuditoria: "d",
    });
    expect(await listarDocumentosPorTipo(7, e, tipoDocumentoEvidenciaJustificacion(FECHA))).toHaveLength(1);
    expect(await listarDocumentosPorTipo(7, e, tipoDocumentoEvidenciaJustificacion(FECHA2))).toHaveLength(0);
    expect(await listarDocumentosPorTipo(7, e, tipoDocumentoComprobanteCumpleanios(2026))).toHaveLength(0);
  });
});
