import { randomUUID } from "crypto";
import { readFileSync } from "fs";
import mysql, { type Pool, type RowDataPacket } from "mysql2/promise";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const holder = vi.hoisted(() => ({ pool: null as Pool | null }));
vi.mock("@/lib/db", () => ({
  getPool: () => {
    if (!holder.pool) throw new Error("Sin conexión local fixture");
    return holder.pool;
  },
}));

import { cifrarSecretoFel } from "./credenciales";
import type { FelProvider, ResultadoCertificar } from "./provider";
import { MockFelProvider, type OpcionesMockFel } from "./providers/mock";
import { crearServicioFel, obtenerCertificacionFactura, obtenerDocumentoFel, type ActorFel, type ResultadoFel } from "./servicio";

/**
 * FEL-2A contra MariaDB 11.8.9 DESECHABLE. Se OMITE salvo que exista FEL_TEST_DB_PORT (3399 o 3407, solo local).
 * Ejecuta el código REAL de servicio.ts y el SQL REAL de la migración (dos veces). Datos 100 % sintéticos; no hay red.
 *   FEL_TEST_DB_PORT=3399 npx vitest run src/lib/fel/fel.db.test.ts --no-file-parallelism
 */
const port = Number(process.env.FEL_TEST_DB_PORT ?? 0);
const database = `fel2a_test_${randomUUID().replaceAll("-", "")}`;
const actor: ActorFel = { empresaId: 7, usuarioId: 4, usuario: "fixture" };
const otroActor: ActorFel = { empresaId: 8, usuarioId: 4, usuario: "fixture" };
const clave = () => randomUUID();

let sigId = 100;

async function sql<T extends RowDataPacket = RowDataPacket>(texto: string, params: unknown[] = []): Promise<T[]> {
  const [r] = await holder.pool!.query<T[]>(texto, params);
  return r;
}
const conteo = async (tabla: string, where = "1=1", params: unknown[] = []) =>
  Number((await sql<RowDataPacket>(`SELECT COUNT(*) AS n FROM ${tabla} WHERE ${where}`, params))[0].n);

async function factura(delta: { empresa?: number; entidad?: number | null; estado?: string; moneda?: string; retencion?: number; lineas?: boolean; cliente?: number } = {}) {
  const id = sigId++;
  const entidad = delta.entidad === undefined ? 9 : delta.entidad;
  await holder.pool!.execute(
    `INSERT INTO fact_facturas (id, empresa_id, cliente_id, entidad_id, estado_admin, moneda, fecha_emision, monto_total, retencion_iva_pct)
     VALUES (?, ?, ?, ?, ?, ?, '2026-10-13', 112.00, ?)`,
    [id, delta.empresa ?? 7, delta.cliente ?? 1, entidad, delta.estado ?? "Borrador", delta.moneda ?? "GTQ", delta.retencion ?? 0],
  );
  if (delta.lineas !== false) {
    await holder.pool!.execute(
      `INSERT INTO fact_factura_lineas (factura_id, orden, cantidad, descripcion, precio_unitario, valor, clasificacion, precio_incluye_iva, porcentaje_iva, base_monto, iva_monto, total_linea)
       VALUES (?, 1, 1, 'Servicio de prueba', 100, 100, 'SERVICIO', 0, 12, 100.00, 12.00, 112.00)`,
      [id],
    );
  }
  return id;
}

async function emisor(empresa: number, entidad: number, modo: string, ambientes: [string, string][] = [["TEST", "MOCK"]], conFiscales = true) {
  const [e] = await holder.pool!.execute<mysql.ResultSetHeader>(
    "INSERT INTO fel_emisores (empresa_id, entidad_id, modo) VALUES (?, ?, ?)", [empresa, entidad, modo],
  );
  for (const [ambiente, proveedor] of ambientes) {
    await holder.pool!.execute(
      "INSERT INTO fel_emisor_ambientes (empresa_id, emisor_id, ambiente, proveedor, nit_emisor, nombre_fiscal) VALUES (?, ?, ?, ?, ?, ?)",
      [empresa, e.insertId, ambiente, proveedor, conFiscales ? "NIT-PRUEBA-EMISOR" : null, conFiscales ? "Emisor de prueba" : null],
    );
  }
  return Number(e.insertId);
}

function servicio(mock: FelProvider, extra: Partial<Parameters<typeof crearServicioFel>[0]> = {}) {
  return crearServicioFel({ proveedores: (n) => (n === mock.nombre ? mock : null), ...extra });
}
const mockCon = (o: OpcionesMockFel = {}) => new MockFelProvider(o);
const doc = (r: ResultadoFel) => {
  if (r.resultado !== "DOCUMENTO") throw new Error(`Se esperaba DOCUMENTO y llegó ${r.resultado}`);
  return r.documento;
};
async function documentoRaw(id: number) {
  return (await sql("SELECT * FROM fel_documentos WHERE id = ?", [id]))[0];
}

async function insertarDocRaw(delta: Record<string, unknown>) {
  const base: Record<string, unknown> = {
    empresa_id: 7, factura_id: 0, emisor_id: 0, entidad_id: 9, ambiente: "TEST", proveedor: "MOCK", tipo_documento: "FACTURA",
    estado: "PENDIENTE", referencia_emisor: randomUUID(), huella_dto: "h", dto_json: "{}", creado_por: 4,
  };
  const fila = { ...base, ...delta };
  const cols = Object.keys(fila);
  return holder.pool!.execute(`INSERT INTO fel_documentos (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`, cols.map((c) => fila[c] as string | number | null));
}

describe.skipIf(!port)("FEL-2A / MariaDB 11.8.9 SOLO LOCAL", () => {
  let emisor7 = 0; // empresa 7, entidad 9, modo TEST con ambiente TEST/MOCK
  let emisorOtraEntidad = 0; // empresa 7, entidad 10
  let emisorEmpresa8 = 0; // empresa 8, entidad 11

  beforeAll(async () => {
    if (![3399, 3407].includes(port)) throw new Error("Solo puertos locales desechables 3399/3407");
    const c = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "", multipleStatements: true });
    try {
      const [v] = await c.query<RowDataPacket[]>("SELECT VERSION() AS v");
      expect(String(v[0].v)).toContain("11.8.9");
      await c.query(`CREATE DATABASE ${database} CHARACTER SET utf8mb4 COLLATE utf8mb4_uca1400_ai_ci`);
      await c.query(`USE ${database}`);
      await c.query(`
        CREATE TABLE empresas(id INT PRIMARY KEY) ENGINE=InnoDB;
        CREATE TABLE usuarios(id INT PRIMARY KEY, username VARCHAR(100)) ENGINE=InnoDB;
        CREATE TABLE cont_entidades(id INT PRIMARY KEY, empresa_id INT, UNIQUE(empresa_id,id)) ENGINE=InnoDB;
        CREATE TABLE clientes(id INT PRIMARY KEY, empresa_id INT, razon_social VARCHAR(250) NULL, nit VARCHAR(40) NULL, email VARCHAR(160) NULL, direccion VARCHAR(300) NULL) ENGINE=InnoDB;
        CREATE TABLE fact_facturas(id INT PRIMARY KEY, empresa_id INT NOT NULL, cliente_id INT NOT NULL, entidad_id INT NULL,
          estado_admin VARCHAR(20) NOT NULL, moneda CHAR(3) NOT NULL, fecha_emision DATE NULL, monto_total DECIMAL(14,2) NOT NULL,
          retencion_iva_pct TINYINT UNSIGNED NOT NULL DEFAULT 0) ENGINE=InnoDB;
        CREATE TABLE fact_factura_lineas(id INT AUTO_INCREMENT PRIMARY KEY, factura_id INT NOT NULL, orden SMALLINT NOT NULL, cantidad DECIMAL(12,2) NOT NULL,
          descripcion VARCHAR(500) NOT NULL, precio_unitario DECIMAL(14,2) NOT NULL, valor DECIMAL(14,2) NOT NULL, clasificacion VARCHAR(10) NOT NULL,
          precio_incluye_iva TINYINT(1) NOT NULL, porcentaje_iva DECIMAL(5,2) NOT NULL, base_monto DECIMAL(14,2) NOT NULL, iva_monto DECIMAL(14,2) NOT NULL,
          total_linea DECIMAL(14,2) NOT NULL) ENGINE=InnoDB;
        CREATE TABLE auditoria(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT, usuario VARCHAR(100), accion VARCHAR(100), modulo VARCHAR(100), detalle TEXT) ENGINE=InnoDB;
        CREATE TABLE cont_eventos(id INT PRIMARY KEY) ENGINE=InnoDB;
        CREATE TABLE cont_asientos(id INT PRIMARY KEY) ENGINE=InnoDB;
        INSERT INTO empresas VALUES (7),(8);
        INSERT INTO usuarios VALUES (4,'fixture');
        INSERT INTO cont_entidades VALUES (9,7),(10,7),(11,8);
        INSERT INTO clientes VALUES (1,7,'Cliente Prueba S.A.','NIT-PRUEBA-CLI','c@example.test','Dirección de prueba'),
                                    (2,7,NULL,NULL,NULL,NULL),(3,8,'Cliente Otra Empresa','NIT-PRUEBA-OTRO',NULL,NULL);
      `);
      const ddl = readFileSync("sql/migrate-2026-10-fel-2a-modelo.sql", "utf8");
      await c.query(ddl);
      // Instalación inicial: sin datos, sin seeds.
      for (const t of ["fel_emisores", "fel_emisor_ambientes", "fel_documentos", "fel_intentos"]) {
        const [n] = await c.query<RowDataPacket[]>(`SELECT COUNT(*) AS n FROM ${t}`);
        expect(Number(n[0].n)).toBe(0);
      }
      await c.query(ddl); // segunda ejecución: NOOP
    } finally {
      await c.end();
    }
    holder.pool = mysql.createPool({ host: "127.0.0.1", port, user: "root", password: "", database, connectionLimit: 12, multipleStatements: false });
    emisor7 = await emisor(7, 9, "TEST");
    emisorOtraEntidad = await emisor(7, 10, "TEST");
    emisorEmpresa8 = await emisor(8, 11, "TEST");
  });

  afterAll(async () => {
    await holder.pool?.end(); // Sin DROP: base desechable recuperable.
  });
  afterEach(() => {
    delete process.env.FEL_CREDENTIALS_KEY;
  });

  // ───────────────────────────── esquema, migración y aislamiento estructural ─────────────────────────────
  it("segunda migración es NOOP: conserva filas y no agrega datos", async () => {
    const f = await factura();
    const r = doc(await servicio(mockCon()).solicitarCertificacion(actor, { facturaId: f, claveSolicitud: clave() }));
    const antes = await sql("SELECT * FROM fel_documentos ORDER BY id");
    const c = await mysql.createConnection({ host: "127.0.0.1", port, user: "root", password: "", database, multipleStatements: true });
    try {
      await c.query(readFileSync("sql/migrate-2026-10-fel-2a-modelo.sql", "utf8"));
    } finally {
      await c.end();
    }
    expect(await sql("SELECT * FROM fel_documentos ORDER BY id")).toEqual(antes);
    expect(r.estado).toBe("CERTIFICADO");
  });

  it("FK compuesta: un documento no puede ligarse a la factura de otra empresa/entidad", async () => {
    const fAjena = await factura({ empresa: 8, entidad: 11, cliente: 3 });
    await expect(insertarDocRaw({ empresa_id: 7, factura_id: fAjena, emisor_id: emisor7, entidad_id: 9 })).rejects.toThrow();
    const fOtraEntidad = await factura({ entidad: 10 });
    await expect(insertarDocRaw({ factura_id: fOtraEntidad, emisor_id: emisor7, entidad_id: 9 })).rejects.toThrow();
    const fSinEntidad = await factura({ entidad: null });
    await expect(insertarDocRaw({ factura_id: fSinEntidad, emisor_id: emisor7, entidad_id: 9 })).rejects.toThrow();
  });

  it("FK compuesta: el emisor debe ser de la misma empresa y entidad", async () => {
    const f = await factura();
    await expect(insertarDocRaw({ factura_id: f, emisor_id: emisorOtraEntidad, entidad_id: 9 })).rejects.toThrow();
    await expect(insertarDocRaw({ factura_id: f, emisor_id: emisorEmpresa8, entidad_id: 9 })).rejects.toThrow();
  });

  it("TEST ≠ PROD en ambos sentidos: un documento exige su fila de ambiente", async () => {
    const ent = 12;
    await holder.pool!.execute("INSERT INTO cont_entidades VALUES (?, 7)", [ent]);
    const eSoloProd = await emisor(7, ent, "PROD", [["PROD", "INFILE"]]);
    const f = await factura({ entidad: ent });
    // Documento TEST sin fila TEST (solo existe PROD): bloqueado.
    await expect(insertarDocRaw({ factura_id: f, emisor_id: eSoloProd, entidad_id: ent, ambiente: "TEST", proveedor: "INFILE" })).rejects.toThrow();
    // Documento PROD con el proveedor de otro ambiente: bloqueado.
    await expect(insertarDocRaw({ factura_id: f, emisor_id: eSoloProd, entidad_id: ent, ambiente: "PROD", proveedor: "MOCK" })).rejects.toThrow();
    // El emisor con ambiente TEST/MOCK no admite un documento PROD.
    const f2 = await factura();
    await expect(insertarDocRaw({ factura_id: f2, emisor_id: emisor7, entidad_id: 9, ambiente: "PROD", proveedor: "MOCK" })).rejects.toThrow();
    // Y el caso legítimo sí entra.
    await insertarDocRaw({ factura_id: f, emisor_id: eSoloProd, entidad_id: ent, ambiente: "PROD", proveedor: "INFILE" });
  });

  it("un ambiente PROD con proveedor MOCK es imposible (CHECK)", async () => {
    await holder.pool!.execute("INSERT INTO cont_entidades VALUES (13, 7)");
    const e = await emisor(7, 13, "DESACTIVADO", []);
    await expect(
      holder.pool!.execute("INSERT INTO fel_emisor_ambientes (empresa_id, emisor_id, ambiente, proveedor) VALUES (7, ?, 'PROD', 'MOCK')", [e]),
    ).rejects.toThrow();
    await expect(
      holder.pool!.execute("INSERT INTO fel_emisor_ambientes (empresa_id, emisor_id, ambiente, proveedor) VALUES (7, ?, 'TEST', 'mock')", [e]),
    ).rejects.toThrow();
  });

  it("CHECK de certificación: CERTIFICADO exige identidad completa y los demás estados no la admiten", async () => {
    const f = await factura();
    await expect(insertarDocRaw({ factura_id: f, emisor_id: emisor7, estado: "CERTIFICADO" })).rejects.toThrow();
    await expect(insertarDocRaw({ factura_id: f, emisor_id: emisor7, estado: "PENDIENTE", autorizacion: "X", serie: "S", numero: "1", fecha_certificacion: "2026-10-13 10:00:00" })).rejects.toThrow();
    await expect(insertarDocRaw({ factura_id: f, emisor_id: emisor7, estado: "ANULADO", autorizacion: "X", serie: "S", numero: "1", fecha_certificacion: "2026-10-13 10:00:00" })).rejects.toThrow();
  });

  it("nota sin origen bloqueada; origen de otro emisor bloqueado; origen inexistente bloqueado", async () => {
    const f = await factura();
    await expect(insertarDocRaw({ factura_id: f, emisor_id: emisor7, tipo_documento: "NOTA_CREDITO" })).rejects.toThrow();
    const f2 = await factura();
    await expect(insertarDocRaw({ factura_id: f2, emisor_id: emisor7, tipo_documento: "NOTA_CREDITO", documento_origen_id: 99999 })).rejects.toThrow();
    // Origen real de otra entidad/emisor: la FK compuesta (empresa, emisor, id) lo rechaza.
    const fo = await factura({ entidad: 10 });
    const [o] = (await insertarDocRaw({ factura_id: fo, emisor_id: emisorOtraEntidad, entidad_id: 10 })) as unknown as [mysql.ResultSetHeader];
    await expect(
      insertarDocRaw({ factura_id: f2, emisor_id: emisor7, tipo_documento: "NOTA_CREDITO", documento_origen_id: o.insertId }),
    ).rejects.toThrow();
  });

  it("la autorreferencia no la impide la BD (limitación documentada) pero verify la detecta", async () => {
    const f = await factura();
    const id = 777000 + sigId;
    await insertarDocRaw({ id, factura_id: f, emisor_id: emisor7, documento_origen_id: id });
    const filas = await sql("SELECT id FROM fel_documentos WHERE documento_origen_id = id");
    expect(filas.map((x) => Number(x.id))).toContain(id);
    await holder.pool!.execute("UPDATE fel_documentos SET documento_origen_id = NULL WHERE id = ?", [id]);
  });

  // ───────────────────────────────────── flujo con proveedor MOCK ─────────────────────────────────────
  it("certifica con MOCK: CERTIFICADO + identidad MOCK; estado_admin de la factura no cambia", async () => {
    const f = await factura();
    const mock = mockCon();
    const r = doc(await servicio(mock).solicitarCertificacion(actor, { facturaId: f, claveSolicitud: clave() }));
    expect(r.estado).toBe("CERTIFICADO");
    expect(r.ambiente).toBe("TEST");
    expect(r.identidad?.autorizacion.startsWith("MOCK-")).toBe(true);
    expect(mock.llamadas.certificar).toBe(1);
    expect((await sql("SELECT estado_admin FROM fact_facturas WHERE id = ?", [f]))[0].estado_admin).toBe("Borrador");
    expect(await conteo("fel_intentos", "documento_id = ? AND estado = 'CERTIFICADO'", [r.documentoId])).toBe(1);
    expect((await obtenerCertificacionFactura(7, f))?.documentoId).toBe(r.documentoId);
  });

  it("estado_admin Emitida NO es CERTIFICADO: sin documento FEL no hay certificación y se bloquea", async () => {
    const f = await factura({ estado: "Emitida" });
    expect(await obtenerCertificacionFactura(7, f)).toBeNull();
    const mock = mockCon();
    const r = await servicio(mock).solicitarCertificacion(actor, { facturaId: f, claveSolicitud: clave() });
    expect(r.resultado).toBe("BLOQUEADO");
    expect(mock.llamadas.certificar).toBe(0);
    expect(await conteo("fel_documentos", "factura_id = ?", [f])).toBe(0);
  });

  it("rechazo definitivo: RECHAZADO terminal; misma clave devuelve lo mismo; clave nueva crea documento nuevo", async () => {
    const f = await factura();
    const mock = mockCon({ certificar: "RECHAZA" });
    const svc = servicio(mock);
    const k = clave();
    const a = doc(await svc.solicitarCertificacion(actor, { facturaId: f, claveSolicitud: k }));
    expect(a.estado).toBe("RECHAZADO");
    const rep = doc(await svc.solicitarCertificacion(actor, { facturaId: f, claveSolicitud: k }));
    expect(rep.documentoId).toBe(a.documentoId);
    expect(mock.llamadas.certificar).toBe(1);
    await expect(svc.reintentarDocumento(actor, { documentoId: a.documentoId, claveSolicitud: clave() })).rejects.toThrow(/rechazado/i);
    mock.programar({ certificar: "CERTIFICA" });
    const b = doc(await svc.solicitarCertificacion(actor, { facturaId: f, claveSolicitud: clave() }));
    expect(b.estado).toBe("CERTIFICADO");
    expect(b.documentoId).not.toBe(a.documentoId);
    expect(b.referenciaEmisor).not.toBe(a.referenciaEmisor);
  });

  it("certificó pero se perdió la respuesta: INCIERTO → el reintento CONSULTA y recupera el MISMO documento", async () => {
    const f = await factura();
    const mock = mockCon({ certificar: "PROCESA_Y_PIERDE_RESPUESTA" });
    const svc = servicio(mock);
    const a = doc(await svc.solicitarCertificacion(actor, { facturaId: f, claveSolicitud: clave() }));
    expect(a.estado).toBe("INCIERTO");
    expect(a.identidad).toBeNull();
    const b = doc(await svc.solicitarCertificacion(actor, { facturaId: f, claveSolicitud: clave() }));
    expect(b.estado).toBe("CERTIFICADO");
    expect(b.documentoId).toBe(a.documentoId);
    expect(b.referenciaEmisor).toBe(a.referenciaEmisor);
    expect(mock.llamadas.certificar).toBe(1); // jamás se reenvió a ciegas
    expect(mock.llamadas.consultar).toBe(1);
    expect(mock.certificacionesEfectivas).toBe(1);
    expect(await conteo("fel_documentos", "factura_id = ?", [f])).toBe(1);
  });

  it("timeout antes de procesar: INCIERTO → consulta NO_ENCONTRADO (≠ RECHAZADO) → reenvío con la MISMA referencia", async () => {
    const f = await factura();
    const mock = mockCon({ certificar: "TIMEOUT_ANTES_DE_PROCESAR" });
    const svc = servicio(mock);
    const a = doc(await svc.solicitarCertificacion(actor, { facturaId: f, claveSolicitud: clave() }));
    expect(a.estado).toBe("INCIERTO");
    const b = doc(await svc.reconciliarDocumento(actor, a.documentoId));
    expect(b.estado).toBe("NO_ENCONTRADO");
    expect(b.estado).not.toBe("RECHAZADO");
    expect(mock.llamadas.certificar).toBe(1);
    mock.programar({ certificar: "CERTIFICA" });
    const c = doc(await svc.reintentarDocumento(actor, { documentoId: a.documentoId, claveSolicitud: clave() }));
    expect(c.estado).toBe("CERTIFICADO");
    expect(c.referenciaEmisor).toBe(a.referenciaEmisor);
    expect(c.documentoId).toBe(a.documentoId);
    expect(mock.certificacionesEfectivas).toBe(1);
  });

  it("consulta PENDIENTE conserva la incertidumbre; luego el proveedor lo resuelve", async () => {
    const f = await factura();
    const mock = mockCon({ certificar: "PENDIENTE" });
    const svc = servicio(mock);
    const a = doc(await svc.solicitarCertificacion(actor, { facturaId: f, claveSolicitud: clave() }));
    expect(a.estado).toBe("PENDIENTE");
    expect(doc(await svc.reconciliarDocumento(actor, a.documentoId)).estado).toBe("PENDIENTE");
    mock.programar({ certificar: "TIMEOUT_ANTES_DE_PROCESAR" });
    mock.resolverPendientes();
    const c = doc(await svc.reconciliarDocumento(actor, a.documentoId));
    expect(c.estado).toBe("CERTIFICADO");
    expect(mock.certificacionesEfectivas).toBe(1);
  });

  it("INCIERTO + consulta PENDIENTE sigue INCIERTO (no avanza ni retrocede)", async () => {
    const f = await factura();
    const mock = mockCon({ certificar: "PROCESA_Y_PIERDE_RESPUESTA" });
    const svc = servicio(mock);
    const a = doc(await svc.solicitarCertificacion(actor, { facturaId: f, claveSolicitud: clave() }));
    mock.remoto.get(a.referenciaEmisor)!.estado = "PENDIENTE";
    expect(doc(await svc.reconciliarDocumento(actor, a.documentoId)).estado).toBe("INCIERTO");
    mock.resolverPendientes();
    expect(doc(await svc.reconciliarDocumento(actor, a.documentoId)).estado).toBe("CERTIFICADO");
  });

  it("excepción, timeout de consulta y error HTTP simulados NUNCA producen NO_ENCONTRADO ni RECHAZADO", async () => {
    const f = await factura();
    const mock = mockCon({ certificar: "LANZA_EXCEPCION", consultar: "LANZA_EXCEPCION" });
    const svc = servicio(mock);
    const a = doc(await svc.solicitarCertificacion(actor, { facturaId: f, claveSolicitud: clave() }));
    expect(a.estado).toBe("INCIERTO");
    expect(a.ultimoCodigo).toBe("EXCEPCION_PROVEEDOR");
    expect(doc(await svc.reconciliarDocumento(actor, a.documentoId)).estado).toBe("INCIERTO");
    mock.programar({ consultar: "INCIERTO" });
    expect(doc(await svc.reconciliarDocumento(actor, a.documentoId)).estado).toBe("INCIERTO");
    expect(await conteo("fel_intentos", "documento_id = ? AND estado IN ('NO_ENCONTRADO','RECHAZADO')", [a.documentoId])).toBe(0);
  });

  it("el timeout del servicio convierte una llamada colgada en INCIERTO", async () => {
    const f = await factura();
    const colgado: FelProvider = {
      nombre: "MOCK", requiereCredenciales: false,
      certificar: () => new Promise<ResultadoCertificar>(() => undefined),
      consultar: async () => ({ tipo: "INCIERTO" }),
      anular: async () => ({ tipo: "INCIERTO" }),
    };
    const r = doc(await servicio(colgado, { timeoutProveedorMs: 50 }).solicitarCertificacion(actor, { facturaId: f, claveSolicitud: clave() }));
    expect(r.estado).toBe("INCIERTO");
    expect(r.ultimoCodigo).toBe("TIMEOUT_SERVICIO");
  });

  it("un proveedor que devuelve NO_ENCONTRADO al certificar se trata como INCIERTO (solo la consulta lo afirma)", async () => {
    const f = await factura();
    const rogue = {
      nombre: "MOCK", requiereCredenciales: false,
      certificar: async () => ({ tipo: "NO_ENCONTRADO" }) as unknown as ResultadoCertificar,
      consultar: async () => ({ tipo: "INCIERTO" as const }),
      anular: async () => ({ tipo: "INCIERTO" as const }),
    } satisfies FelProvider;
    const r = doc(await servicio(rogue).solicitarCertificacion(actor, { facturaId: f, claveSolicitud: clave() }));
    expect(r.estado).toBe("INCIERTO");
  });

  it("un proveedor que 'certifica' sin identidad completa no produce un CERTIFICADO falso", async () => {
    const f = await factura();
    const malo = {
      nombre: "MOCK", requiereCredenciales: false,
      certificar: async () => ({ tipo: "CERTIFICADO", autorizacion: "", serie: "S", numero: "1", fechaCertificacion: "x" }) as ResultadoCertificar,
      consultar: async () => ({ tipo: "INCIERTO" as const }),
      anular: async () => ({ tipo: "INCIERTO" as const }),
    } satisfies FelProvider;
    const r = doc(await servicio(malo).solicitarCertificacion(actor, { facturaId: f, claveSolicitud: clave() }));
    expect(r.estado).toBe("INCIERTO");
    expect(r.identidad).toBeNull();
  });

  it("ERROR_CONFIG: emisor desactivado, sin ambiente, sin proveedor y sin FEL_CREDENTIALS_KEY (sin documento ni fuga)", async () => {
    // Desactivado
    await holder.pool!.execute("INSERT INTO cont_entidades VALUES (20, 7)");
    await emisor(7, 20, "DESACTIVADO", [["TEST", "MOCK"]]);
    const fDes = await factura({ entidad: 20 });
    const mock = mockCon();
    const svc = servicio(mock);
    const a = await svc.solicitarCertificacion(actor, { facturaId: fDes, claveSolicitud: clave() });
    expect(a).toMatchObject({ resultado: "ERROR_CONFIG", codigo: "EMISOR_DESACTIVADO" });
    // Sin emisor
    await holder.pool!.execute("INSERT INTO cont_entidades VALUES (21, 7)");
    const fSin = await factura({ entidad: 21 });
    expect(await svc.solicitarCertificacion(actor, { facturaId: fSin, claveSolicitud: clave() })).toMatchObject({ resultado: "ERROR_CONFIG", codigo: "EMISOR_NO_CONFIGURADO" });
    // Modo PROD sin fila de ambiente PROD
    await holder.pool!.execute("INSERT INTO cont_entidades VALUES (22, 7)");
    await emisor(7, 22, "PROD", [["TEST", "MOCK"]]);
    const fProd = await factura({ entidad: 22 });
    expect(await svc.solicitarCertificacion(actor, { facturaId: fProd, claveSolicitud: clave() })).toMatchObject({ resultado: "ERROR_CONFIG", codigo: "AMBIENTE_NO_CONFIGURADO" });
    // Proveedor no disponible
    const f = await factura();
    const sinProv = crearServicioFel({ proveedores: () => null });
    expect(await sinProv.solicitarCertificacion(actor, { facturaId: f, claveSolicitud: clave() })).toMatchObject({ resultado: "ERROR_CONFIG", codigo: "PROVEEDOR_NO_DISPONIBLE" });
    expect(await conteo("fel_documentos", "factura_id IN (?, ?, ?, ?)", [fDes, fSin, fProd, f])).toBe(0);
    expect(mock.llamadas.certificar).toBe(0);
  });

  it("FEL_CREDENTIALS_KEY ausente: ERROR_CONFIG claro y sin fuga de secreto", async () => {
    const f = await factura();
    const requiere: FelProvider = {
      nombre: "MOCK", requiereCredenciales: true,
      certificar: async () => ({ tipo: "INCIERTO" }), consultar: async () => ({ tipo: "INCIERTO" }), anular: async () => ({ tipo: "INCIERTO" }),
    };
    await holder.pool!.execute("INSERT INTO cont_entidades VALUES (23, 7)");
    const e = await emisor(7, 23, "TEST", [["TEST", "MOCK"]]);
    process.env.FEL_CREDENTIALS_KEY = "k".repeat(40);
    const cifrado = cifrarSecretoFel("SECRETO-DE-PRUEBA-123", { empresaId: 7, entidadId: 23, ambiente: "TEST" });
    await holder.pool!.execute("UPDATE fel_emisor_ambientes SET secreto_cifrado = ? WHERE emisor_id = ?", [cifrado, e]);
    delete process.env.FEL_CREDENTIALS_KEY;
    const f23 = await factura({ entidad: 23 });
    const r = await servicio(requiere).solicitarCertificacion(actor, { facturaId: f23, claveSolicitud: clave() });
    expect(r).toMatchObject({ resultado: "ERROR_CONFIG" });
    expect(JSON.stringify(r)).not.toContain("SECRETO-DE-PRUEBA-123");
    expect(JSON.stringify(r)).not.toContain(cifrado);
    expect(await conteo("fel_documentos", "factura_id = ?", [f23])).toBe(0);
    void f;
  });

  it("proveedor con credenciales: el secreto llega en memoria al proveedor y NO queda en BD ni auditoría", async () => {
    process.env.FEL_CREDENTIALS_KEY = "k".repeat(40);
    await holder.pool!.execute("INSERT INTO cont_entidades VALUES (24, 7)");
    const e = await emisor(7, 24, "TEST", [["TEST", "MOCK"]]);
    const cifrado = cifrarSecretoFel("SECRETO-DE-PRUEBA-456", { empresaId: 7, entidadId: 24, ambiente: "TEST" });
    await holder.pool!.execute("UPDATE fel_emisor_ambientes SET secreto_cifrado = ? WHERE emisor_id = ?", [cifrado, e]);
    let visto: string | null = null;
    const prov: FelProvider = {
      nombre: "MOCK", requiereCredenciales: true,
      certificar: async (s) => {
        visto = s.contexto.secreto;
        return { tipo: "CERTIFICADO", autorizacion: "AUT-1", serie: "S", numero: String(Date.now()), fechaCertificacion: "2026-10-13T10:00:00.000Z" };
      },
      consultar: async () => ({ tipo: "INCIERTO" }), anular: async () => ({ tipo: "INCIERTO" }),
    };
    const f = await factura({ entidad: 24 });
    const r = doc(await servicio(prov).solicitarCertificacion(actor, { facturaId: f, claveSolicitud: clave() }));
    expect(r.estado).toBe("CERTIFICADO");
    expect(visto).toBe("SECRETO-DE-PRUEBA-456");
    const volcado = JSON.stringify([
      await sql("SELECT * FROM fel_documentos WHERE factura_id = ?", [f]),
      await sql("SELECT * FROM fel_intentos WHERE documento_id = ?", [r.documentoId]),
      await sql("SELECT * FROM auditoria WHERE modulo = 'fel'"),
    ]);
    expect(volcado).not.toContain("SECRETO-DE-PRUEBA-456");
  });

  // ───────────────────────────────── idempotencia y concurrencia ─────────────────────────────────
  it("misma clave + misma solicitud es idempotente (una llamada al proveedor)", async () => {
    const f = await factura();
    const mock = mockCon();
    const svc = servicio(mock);
    const k = clave();
    const a = doc(await svc.solicitarCertificacion(actor, { facturaId: f, claveSolicitud: k }));
    const b = await svc.solicitarCertificacion(actor, { facturaId: f, claveSolicitud: k });
    expect(doc(b).documentoId).toBe(a.documentoId);
    expect(b).toMatchObject({ idempotente: true });
    expect(mock.llamadas.certificar).toBe(1);
  });

  it("misma clave + solicitud distinta (otra factura) es conflicto y no crea nada", async () => {
    const f1 = await factura();
    const f2 = await factura();
    const svc = servicio(mockCon());
    const k = clave();
    await svc.solicitarCertificacion(actor, { facturaId: f1, claveSolicitud: k });
    await expect(svc.solicitarCertificacion(actor, { facturaId: f2, claveSolicitud: k })).rejects.toMatchObject({ codigoFel: "CONFLICTO_IDEMPOTENCIA" });
    expect(await conteo("fel_documentos", "factura_id = ?", [f2])).toBe(0);
  });

  it("clave inválida se rechaza antes de tocar la BD", async () => {
    const f = await factura();
    await expect(servicio(mockCon()).solicitarCertificacion(actor, { facturaId: f, claveSolicitud: "corta" })).rejects.toMatchObject({ codigoFel: "SOLICITUD_INVALIDA" });
  });

  it("doble clic simultáneo (misma clave): una identidad fiscal y una sola llamada al proveedor", async () => {
    const f = await factura();
    const mock = mockCon();
    const svc = servicio(mock);
    const k = clave();
    const r = await Promise.all([
      svc.solicitarCertificacion(actor, { facturaId: f, claveSolicitud: k }),
      svc.solicitarCertificacion(actor, { facturaId: f, claveSolicitud: k }),
    ]);
    expect(new Set(r.map((x) => doc(x).documentoId)).size).toBe(1);
    expect(mock.llamadas.certificar).toBe(1);
    expect(mock.certificacionesEfectivas).toBe(1);
    expect(await conteo("fel_documentos", "factura_id = ?", [f])).toBe(1);
  });

  it("dos workers con claves distintas sobre la misma factura: un solo documento y una sola certificación", async () => {
    const f = await factura();
    const mock = mockCon();
    const a = servicio(mock);
    const b = servicio(mock);
    const r = await Promise.all([
      a.solicitarCertificacion(actor, { facturaId: f, claveSolicitud: clave() }),
      b.solicitarCertificacion(actor, { facturaId: f, claveSolicitud: clave() }),
    ]);
    expect(new Set(r.map((x) => doc(x).documentoId)).size).toBe(1);
    expect(mock.certificacionesEfectivas).toBe(1);
    expect(await conteo("fel_documentos", "factura_id = ? AND estado <> 'RECHAZADO'", [f])).toBe(1);
  });

  it("carrera de 10 solicitudes concurrentes: un documento vivo y una certificación", async () => {
    const f = await factura();
    const mock = mockCon();
    const svc = servicio(mock);
    const r = await Promise.all(Array.from({ length: 10 }, () => svc.solicitarCertificacion(actor, { facturaId: f, claveSolicitud: clave() })));
    expect(new Set(r.map((x) => doc(x).documentoId)).size).toBe(1);
    expect(mock.llamadas.certificar).toBe(1);
    expect(mock.certificacionesEfectivas).toBe(1);
  });

  it("misma clave sobre facturas distintas en paralelo: una gana y la otra recibe conflicto", async () => {
    const f1 = await factura();
    const f2 = await factura();
    const svc = servicio(mockCon());
    const k = clave();
    const r = await Promise.allSettled([
      svc.solicitarCertificacion(actor, { facturaId: f1, claveSolicitud: k }),
      svc.solicitarCertificacion(actor, { facturaId: f2, claveSolicitud: k }),
    ]);
    expect(r.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    const rechazada = r.find((x) => x.status === "rejected") as PromiseRejectedResult;
    expect(rechazada.reason).toMatchObject({ codigoFel: "CONFLICTO_IDEMPOTENCIA" });
    expect(await conteo("fel_documentos", "factura_id IN (?, ?)", [f1, f2])).toBe(1);
  });

  it("caída entre el envío y el registro: queda PENDIENTE, en proceso; vencida la ventana se consulta y recupera sin reenviar", async () => {
    const f = await factura();
    const mock = mockCon();
    const cae = servicio(mock, { simularCaidaDespuesDeEnviar: () => { throw new Error("proceso caído"); } });
    await expect(cae.solicitarCertificacion(actor, { facturaId: f, claveSolicitud: clave() })).rejects.toThrow("proceso caído");
    const [d] = await sql("SELECT id, estado FROM fel_documentos WHERE factura_id = ?", [f]);
    expect(d.estado).toBe("PENDIENTE");
    expect(await conteo("fel_intentos", "documento_id = ? AND estado = 'ENVIANDO'", [d.id])).toBe(1);
    // Ventana vigente: otro proceso NO envía ni consulta; informa «en proceso».
    const r1 = await servicio(mock).solicitarCertificacion(actor, { facturaId: f, claveSolicitud: clave() });
    expect(r1).toMatchObject({ resultado: "DOCUMENTO", enProceso: true });
    expect(mock.llamadas.certificar).toBe(1);
    // Ventana vencida: consulta (el proveedor sí certificó) y recupera.
    const r2 = doc(await servicio(mock, { ventanaPendienteMs: 0 }).solicitarCertificacion(actor, { facturaId: f, claveSolicitud: clave() }));
    expect(r2.estado).toBe("CERTIFICADO");
    expect(mock.llamadas.certificar).toBe(1);
    expect(mock.llamadas.consultar).toBe(1);
    expect(await conteo("fel_intentos", "documento_id = ? AND estado = 'ENVIANDO'", [d.id])).toBe(0);
  });

  // ───────────────────────────────── notas, anulación y refacturación ─────────────────────────────────
  it("nota de crédito referencia el original y NO lo modifica (ni la factura ni su documento)", async () => {
    const f = await factura();
    const mock = mockCon();
    const svc = servicio(mock);
    const original = doc(await svc.solicitarCertificacion(actor, { facturaId: f, claveSolicitud: clave() }));
    const antesDoc = await documentoRaw(original.documentoId);
    const antesFac = await sql("SELECT * FROM fact_facturas WHERE id = ?", [f]);
    const nc = doc(await svc.solicitarDocumentoCorrectivo(actor, {
      documentoOrigenId: original.documentoId, tipo: "NOTA_CREDITO", motivo: "Ajuste de prueba",
      importes: { base: "50.00", iva: "6.00", total: "56.00" }, fechaEmision: "2026-10-14", claveSolicitud: clave(),
    }));
    expect(nc.estado).toBe("CERTIFICADO");
    expect(nc.tipo).toBe("NOTA_CREDITO");
    expect(nc.documentoOrigenId).toBe(original.documentoId);
    expect(nc.facturaId).toBe(f);
    expect(await documentoRaw(original.documentoId)).toEqual(antesDoc);
    expect(await sql("SELECT * FROM fact_facturas WHERE id = ?", [f])).toEqual(antesFac);
    const dto = JSON.parse((await documentoRaw(nc.documentoId)).dto_json);
    expect(dto.referenciaOrigen).toMatchObject({ documentoId: original.documentoId, autorizacion: original.identidad!.autorizacion });
    // Notas parciales múltiples son legítimas (claves distintas); la misma clave es réplica.
    expect(await conteo("fel_documentos", "documento_origen_id = ?", [original.documentoId])).toBe(1);
  });

  it("nota: misma clave replica, claves distintas son notas distintas; origen no certificado/ajeno/inexistente se bloquea", async () => {
    const f = await factura();
    const mock = mockCon();
    const svc = servicio(mock);
    const original = doc(await svc.solicitarCertificacion(actor, { facturaId: f, claveSolicitud: clave() }));
    const entrada = { documentoOrigenId: original.documentoId, tipo: "NOTA_CREDITO" as const, motivo: "Ajuste uno", importes: { base: "10.00", iva: "1.20", total: "11.20" }, fechaEmision: "2026-10-14" };
    const k = clave();
    const a = doc(await svc.solicitarDocumentoCorrectivo(actor, { ...entrada, claveSolicitud: k }));
    const rep = doc(await svc.solicitarDocumentoCorrectivo(actor, { ...entrada, claveSolicitud: k }));
    expect(rep.documentoId).toBe(a.documentoId);
    const otra = doc(await svc.solicitarDocumentoCorrectivo(actor, { ...entrada, claveSolicitud: clave() }));
    expect(otra.documentoId).not.toBe(a.documentoId);
    await expect(svc.solicitarDocumentoCorrectivo(actor, { ...entrada, importes: { base: "99.00", iva: "1.00", total: "100.00" }, claveSolicitud: k }))
      .rejects.toMatchObject({ codigoFel: "CONFLICTO_IDEMPOTENCIA" });
    // Otra empresa: el origen «no existe» para ella.
    await expect(servicio(mock).solicitarDocumentoCorrectivo(otroActor, { ...entrada, claveSolicitud: clave() })).rejects.toMatchObject({ codigoFel: "ORIGEN_INVALIDO" });
    // No certificado.
    const fp = await factura();
    const incierto = mockCon({ certificar: "TIMEOUT_ANTES_DE_PROCESAR" });
    const pend = doc(await servicio(incierto).solicitarCertificacion(actor, { facturaId: fp, claveSolicitud: clave() }));
    await expect(svc.solicitarDocumentoCorrectivo(actor, { ...entrada, documentoOrigenId: pend.documentoId, claveSolicitud: clave() }))
      .rejects.toMatchObject({ codigoFel: "ORIGEN_INVALIDO" });
    // Importes que no cuadran: bloqueo estructurado, sin documento.
    const bad = await svc.solicitarDocumentoCorrectivo(actor, { ...entrada, importes: { base: "10.00", iva: "1.00", total: "99.00" }, claveSolicitud: clave() });
    expect(bad.resultado).toBe("BLOQUEADO");
  });

  it("anulación fiscal: solo ANULADO con respuesta válida; INCIERTO/RECHAZADO dejan CERTIFICADO; factura intacta", async () => {
    const f = await factura();
    const mock = mockCon();
    const svc = servicio(mock);
    const d = doc(await svc.solicitarCertificacion(actor, { facturaId: f, claveSolicitud: clave() }));
    const antesFac = await sql("SELECT * FROM fact_facturas WHERE id = ?", [f]);
    mock.programar({ anular: "INCIERTO" });
    expect(doc(await svc.anularDocumento(actor, { documentoId: d.documentoId, motivo: "Error de captura", claveSolicitud: clave() })).estado).toBe("CERTIFICADO");
    mock.programar({ anular: "RECHAZA" });
    expect(doc(await svc.anularDocumento(actor, { documentoId: d.documentoId, motivo: "Error de captura", claveSolicitud: clave() })).estado).toBe("CERTIFICADO");
    mock.programar({ anular: "LANZA_EXCEPCION" });
    expect(doc(await svc.anularDocumento(actor, { documentoId: d.documentoId, motivo: "Error de captura", claveSolicitud: clave() })).estado).toBe("CERTIFICADO");
    mock.programar({ anular: "ANULA" });
    const k = clave();
    const ok = doc(await svc.anularDocumento(actor, { documentoId: d.documentoId, motivo: "Error de captura", claveSolicitud: k }));
    expect(ok.estado).toBe("ANULADO");
    expect(ok.identidad?.autorizacion).toBe(d.identidad?.autorizacion);
    // Réplica idempotente: sin segunda llamada ni segunda auditoría.
    const llamadas = mock.llamadas.anular;
    expect(doc(await svc.anularDocumento(actor, { documentoId: d.documentoId, motivo: "Error de captura", claveSolicitud: k })).estado).toBe("ANULADO");
    expect(mock.llamadas.anular).toBe(llamadas);
    expect(await conteo("auditoria", "accion = 'fel_anulado' AND detalle LIKE ?", [`%"documentoId":${d.documentoId},%`])).toBe(1);
    expect(await sql("SELECT * FROM fact_facturas WHERE id = ?", [f])).toEqual(antesFac);
    // Un documento no certificado no se anula.
    const fp = await factura();
    const inc = doc(await servicio(mockCon({ certificar: "TIMEOUT_ANTES_DE_PROCESAR" })).solicitarCertificacion(actor, { facturaId: fp, claveSolicitud: clave() }));
    await expect(svc.anularDocumento(actor, { documentoId: inc.documentoId, motivo: "Error de captura", claveSolicitud: clave() })).rejects.toMatchObject({ codigoFel: "ESTADO_NO_PERMITE" });
  });

  it("anulación concurrente: una sola transición efectiva", async () => {
    const f = await factura();
    const mock = mockCon();
    const svc = servicio(mock);
    const d = doc(await svc.solicitarCertificacion(actor, { facturaId: f, claveSolicitud: clave() }));
    const r = await Promise.all([
      svc.anularDocumento(actor, { documentoId: d.documentoId, motivo: "Error de captura", claveSolicitud: clave() }),
      svc.anularDocumento(actor, { documentoId: d.documentoId, motivo: "Error de captura", claveSolicitud: clave() }),
    ]);
    expect(r.map((x) => doc(x).estado).every((e) => e === "ANULADO" || e === "CERTIFICADO")).toBe(true);
    expect((await documentoRaw(d.documentoId)).estado).toBe("ANULADO");
    expect(await conteo("auditoria", "accion = 'fel_anulado' AND detalle LIKE ?", [`%"documentoId":${d.documentoId},%`])).toBe(1);
    expect(mock.llamadas.anular).toBeLessThanOrEqual(2);
  });

  it("refacturación: original → anulación → FACTURA nueva con origen trazable; el original no se borra ni cambia", async () => {
    const f1 = await factura();
    const mock = mockCon();
    const svc = servicio(mock);
    const original = doc(await svc.solicitarCertificacion(actor, { facturaId: f1, claveSolicitud: clave() }));
    const f2 = await factura();
    // Sin corrección previa: bloqueada.
    await expect(svc.solicitarRefacturacion(actor, { documentoOrigenId: original.documentoId, nuevaFacturaId: f2, claveSolicitud: clave() }))
      .rejects.toMatchObject({ codigoFel: "ESTADO_NO_PERMITE" });
    await svc.anularDocumento(actor, { documentoId: original.documentoId, motivo: "Se refactura", claveSolicitud: clave() });
    const nueva = doc(await svc.solicitarRefacturacion(actor, { documentoOrigenId: original.documentoId, nuevaFacturaId: f2, claveSolicitud: clave() }));
    expect(nueva.estado).toBe("CERTIFICADO");
    expect(nueva.tipo).toBe("FACTURA");
    expect(nueva.documentoOrigenId).toBe(original.documentoId);
    expect(nueva.facturaId).toBe(f2);
    expect(nueva.identidad!.autorizacion).not.toBe(original.identidad!.autorizacion);
    const cadena = await sql(
      `WITH RECURSIVE c AS (SELECT id, documento_origen_id, estado FROM fel_documentos WHERE id = ?
         UNION ALL SELECT d.id, d.documento_origen_id, d.estado FROM fel_documentos d JOIN c ON d.id = c.documento_origen_id)
       SELECT id, estado FROM c ORDER BY id`, [nueva.documentoId],
    );
    expect(cadena.map((x) => x.estado)).toEqual(["ANULADO", "CERTIFICADO"]);
    expect(await conteo("fel_documentos", "id = ?", [original.documentoId])).toBe(1);
  });

  it("refacturación con nota de crédito certificada; misma factura, otra entidad y otra empresa bloqueadas", async () => {
    const f1 = await factura();
    const mock = mockCon();
    const svc = servicio(mock);
    const original = doc(await svc.solicitarCertificacion(actor, { facturaId: f1, claveSolicitud: clave() }));
    await svc.solicitarDocumentoCorrectivo(actor, {
      documentoOrigenId: original.documentoId, tipo: "NOTA_CREDITO", motivo: "Corrección total",
      importes: { base: "100.00", iva: "12.00", total: "112.00" }, fechaEmision: "2026-10-14", claveSolicitud: clave(),
    });
    // Misma factura: no hay autorreferencia fiscal.
    await expect(svc.solicitarRefacturacion(actor, { documentoOrigenId: original.documentoId, nuevaFacturaId: f1, claveSolicitud: clave() }))
      .rejects.toMatchObject({ codigoFel: "ORIGEN_INVALIDO" });
    // Otra entidad de la misma empresa.
    const fEnt = await factura({ entidad: 10 });
    await expect(svc.solicitarRefacturacion(actor, { documentoOrigenId: original.documentoId, nuevaFacturaId: fEnt, claveSolicitud: clave() }))
      .rejects.toMatchObject({ codigoFel: "ORIGEN_INVALIDO" });
    // Factura de otra empresa: no existe para el actor.
    const fAjena = await factura({ empresa: 8, entidad: 11, cliente: 3 });
    await expect(svc.solicitarRefacturacion(actor, { documentoOrigenId: original.documentoId, nuevaFacturaId: fAjena, claveSolicitud: clave() }))
      .rejects.toMatchObject({ codigoFel: "NO_ENCONTRADO" });
    // La permitida.
    const f2 = await factura();
    const nueva = doc(await svc.solicitarRefacturacion(actor, { documentoOrigenId: original.documentoId, nuevaFacturaId: f2, claveSolicitud: clave() }));
    expect(nueva.estado).toBe("CERTIFICADO");
    expect((await documentoRaw(original.documentoId)).estado).toBe("CERTIFICADO");
  });

  // ──────────────────────────────────── aislamiento, bloqueos y contabilidad ────────────────────────────────────
  it("aislamiento por empresa: la factura/documento de otra empresa no se ve ni se toca", async () => {
    const fAjena = await factura({ empresa: 8, entidad: 11, cliente: 3 });
    const mock = mockCon();
    const svc = servicio(mock);
    await expect(svc.solicitarCertificacion(actor, { facturaId: fAjena, claveSolicitud: clave() })).rejects.toMatchObject({ codigoFel: "NO_ENCONTRADO" });
    const propia = doc(await svc.solicitarCertificacion(otroActor, { facturaId: fAjena, claveSolicitud: clave() }));
    expect(await obtenerDocumentoFel(7, propia.documentoId)).toBeNull();
    expect(await obtenerCertificacionFactura(7, fAjena)).toBeNull();
    await expect(svc.reconciliarDocumento(actor, propia.documentoId)).rejects.toMatchObject({ codigoFel: "NO_ENCONTRADO" });
    await expect(svc.anularDocumento(actor, { documentoId: propia.documentoId, motivo: "Intento ajeno", claveSolicitud: clave() })).rejects.toMatchObject({ codigoFel: "NO_ENCONTRADO" });
  });

  it("bloqueos estructurados del mapper desde BD: sin líneas, sin NIT, GTQ, retención, sin entidad; sin documento ni llamada", async () => {
    const mock = mockCon();
    const svc = servicio(mock);
    const codigos = async (id: number) => {
      const r = await svc.solicitarCertificacion(actor, { facturaId: id, claveSolicitud: clave() });
      expect(r.resultado).toBe("BLOQUEADO");
      return r.resultado === "BLOQUEADO" ? r.bloqueos.map((b) => b.codigo) : [];
    };
    expect(await codigos(await factura({ lineas: false }))).toContain("SIN_LINEAS");
    expect(await codigos(await factura({ cliente: 2 }))).toEqual(expect.arrayContaining(["RECEPTOR_SIN_NIT", "RECEPTOR_SIN_NOMBRE_FISCAL"]));
    expect(await codigos(await factura({ moneda: "USD" }))).toContain("MONEDA_NO_SOPORTADA");
    expect(await codigos(await factura({ retencion: 15 }))).toContain("RETENCION_NO_SOPORTADA");
    expect(await codigos(await factura({ entidad: null }))).toContain("ENTIDAD_NO_ASIGNADA");
    expect(mock.llamadas.certificar).toBe(0);
  });

  it("emisor sin NIT/nombre fiscal configurados bloquea (no se inventan datos fiscales)", async () => {
    await holder.pool!.execute("INSERT INTO cont_entidades VALUES (25, 7)");
    await emisor(7, 25, "TEST", [["TEST", "MOCK"]], false);
    const f = await factura({ entidad: 25 });
    const r = await servicio(mockCon()).solicitarCertificacion(actor, { facturaId: f, claveSolicitud: clave() });
    expect(r).toMatchObject({ resultado: "BLOQUEADO" });
    expect(JSON.stringify(r)).toContain("EMISOR_SIN_DATOS_FISCALES");
  });

  it("FEL-2A no crea eventos ni asientos contables, ni modifica fact_facturas en todo el flujo", async () => {
    expect(await conteo("cont_eventos")).toBe(0);
    expect(await conteo("cont_asientos")).toBe(0);
    expect(await conteo("fact_facturas", "estado_admin <> 'Borrador' AND id >= 100 AND id NOT IN (SELECT id FROM fact_facturas WHERE estado_admin = 'Emitida')")).toBe(0);
    expect(await conteo("fact_facturas", "estado_admin = 'Anulada'")).toBe(0);
  });

  it("auditoría FEL en cada transición, sin secretos ni XML", async () => {
    const acciones = (await sql("SELECT DISTINCT accion FROM auditoria WHERE modulo = 'fel'")).map((x) => String(x.accion));
    expect(acciones).toEqual(expect.arrayContaining(["fel_documento_preparado", "fel_certificado", "fel_rechazado", "fel_anulado"]));
    const todo = JSON.stringify(await sql("SELECT detalle FROM auditoria WHERE modulo = 'fel'"));
    expect(todo).not.toMatch(/password|secret|token|<\?xml/i);
  });
});
