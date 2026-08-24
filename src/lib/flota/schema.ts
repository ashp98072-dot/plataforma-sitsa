/**
 * Migración alternativa compatible con MySQL que no soporta
 * ADD COLUMN IF NOT EXISTS (ejecutar columna por columna ignorando errores).
 */
import type { RowDataPacket } from "mysql2";
import { execute, getPool, query } from "@/lib/db";

/** Columnas ya vistas en este proceso (evita N consultas a information_schema). */
let knownCols = new Set<string>();

async function loadColumnSet(tables: string[]): Promise<Set<string>> {
  const set = new Set<string>();
  if (!tables.length) return set;
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT TABLE_NAME AS t, COLUMN_NAME AS c
       FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME IN (${tables.map(() => "?").join(",")})`,
      tables,
    );
    for (const r of rows) {
      set.add(`${String(r.t)}.${String(r.c)}`);
    }
  } catch {
    /* information_schema no disponible */
  }
  return set;
}

async function ensureColumn(
  tabla: string,
  columna: string,
  ddl: string,
): Promise<void> {
  const key = `${tabla}.${columna}`;
  if (knownCols.has(key)) return;
  try {
    await execute(`ALTER TABLE ${tabla} ADD COLUMN ${ddl}`);
  } catch (e: unknown) {
    const msg = String(
      e && typeof e === "object" && "message" in e
        ? (e as { message: unknown }).message
        : e,
    );
    // Carrera entre instancias: la columna ya existe
    if (!/duplicate column|ER_DUP_FIELDNAME|1060/i.test(msg)) {
      throw e;
    }
  }
  knownCols.add(key);
}

/** Asegura columnas/tablas de flota completa (idempotente). */
let flotaSchemaReady: Promise<void> | null = null;
let schemaResolved = false;
/** Migración TMS paradas: una vez por proceso (no en cada cold GET). */
let tmsParadasMigrated = false;

export function schemaFlotaYaListo(): boolean {
  return schemaResolved;
}

/**
 * Para lecturas GET: si el schema ya corrió en este proceso, no hace nada.
 * Si no, lo asegura (primera petición). Evita trabajo muerto en cada listado.
 */
export async function asegurarSchemaFlotaLectura(): Promise<void> {
  if (schemaResolved) return;
  try {
    await asegurarSchemaFlota();
  } catch {
    /* ok: las queries fallarán con mensaje propio si falta algo */
  }
}

export async function asegurarSchemaFlota(): Promise<void> {
  if (schemaResolved) return;
  if (!flotaSchemaReady) {
    flotaSchemaReady = (async () => {
      // GET_LOCK debe ir en la MISMA conexión que RELEASE_LOCK (pool)
      const conn = await getPool().getConnection();
      try {
        try {
          await conn.query("SELECT GET_LOCK(?, 15) AS l", [
            "plataforma_flota_schema",
          ]);
        } catch {
          /* sin GET_LOCK seguimos */
        }
        knownCols = await loadColumnSet([
          "flota_vehiculos",
          "flota_lecturas",
          "flota_viajes",
          "flota_servicios",
          "flota_viaje_evidencias",
          "flota_lectura_evidencias",
          "flota_servicio_adjuntos",
          "flota_vehiculo_documentos",
          "flota_vehiculo_filtros",
          "flota_vehiculo_acceso",
          "flota_permisos_externos",
          "tms_evidencias",
          "tms_plan_paradas",
          "tms_planes_viaje",
        ]);
        await asegurarSchemaFlotaInner();
        schemaResolved = true;
      } finally {
        try {
          await conn.query("SELECT RELEASE_LOCK(?) AS l", [
            "plataforma_flota_schema",
          ]);
        } catch {
          /* ok */
        }
        conn.release();
      }
    })().catch((e) => {
      flotaSchemaReady = null;
      throw e;
    });
  }
  await flotaSchemaReady;
}

async function asegurarSchemaFlotaInner(): Promise<void> {
  await ensureColumn(
    "flota_vehiculos",
    "descripcion",
    "descripcion VARCHAR(200) NULL AFTER modelo",
  );
  await ensureColumn(
    "flota_vehiculos",
    "color",
    "color VARCHAR(80) NULL",
  );
  await ensureColumn(
    "flota_vehiculos",
    "tipo_combustible",
    "tipo_combustible VARCHAR(40) NULL DEFAULT 'diesel'",
  );
  await ensureColumn(
    "flota_vehiculos",
    "chasis",
    "chasis VARCHAR(80) NULL",
  );
  await ensureColumn(
    "flota_vehiculos",
    "capacidad",
    "capacidad VARCHAR(80) NULL",
  );
  await ensureColumn(
    "flota_vehiculos",
    "credito",
    "credito VARCHAR(80) NULL",
  );
  await ensureColumn(
    "flota_vehiculos",
    "empresa_activo",
    "empresa_activo VARCHAR(120) NULL",
  );
  await ensureColumn(
    "flota_vehiculos",
    "nit",
    "nit VARCHAR(40) NULL",
  );
  await ensureColumn(
    "flota_vehiculos",
    "condicion_propiedad",
    "condicion_propiedad VARCHAR(120) NULL",
  );
  await ensureColumn(
    "flota_vehiculos",
    "seguros",
    "seguros VARCHAR(120) NULL",
  );
  await ensureColumn(
    "flota_vehiculos",
    "motivo_taller",
    "motivo_taller VARCHAR(300) NULL",
  );
  await ensureColumn(
    "flota_vehiculos",
    "activo",
    "activo TINYINT(1) NOT NULL DEFAULT 1",
  );
  await ensureColumn(
    "flota_vehiculos",
    "notas",
    "notas TEXT NULL",
  );
  await ensureColumn(
    "flota_vehiculos",
    "filtro_servicio_mayor",
    "filtro_servicio_mayor VARCHAR(120) NULL",
  );
  await ensureColumn(
    "flota_vehiculos",
    "filtro_servicio_menor",
    "filtro_servicio_menor VARCHAR(120) NULL",
  );
  await ensureColumn(
    "flota_vehiculos",
    "rin_llanta",
    "rin_llanta VARCHAR(80) NULL",
  );
  await ensureColumn(
    "flota_vehiculos",
    "medida_llanta",
    "medida_llanta VARCHAR(80) NULL",
  );
  await ensureColumn(
    "flota_vehiculos",
    "tipo_aceite",
    "tipo_aceite VARCHAR(80) NULL",
  );
  await ensureColumn(
    "flota_vehiculos",
    "odometro_funcional",
    "odometro_funcional TINYINT(1) NOT NULL DEFAULT 1",
  );
  await ensureColumn(
    "flota_vehiculos",
    "mantenimiento_intervalo_meses",
    "mantenimiento_intervalo_meses SMALLINT NULL",
  );

  // Tipos de filtro por unidad (aceite, aire, etc.) + código de tienda
  await execute(`
    CREATE TABLE IF NOT EXISTS flota_vehiculo_filtros (
      id INT AUTO_INCREMENT PRIMARY KEY,
      empresa_id INT NOT NULL,
      vehiculo_id INT NOT NULL,
      tipo VARCHAR(80) NOT NULL,
      codigo VARCHAR(120) NOT NULL,
      notas VARCHAR(300) NULL,
      INDEX idx_fvf_veh (vehiculo_id),
      INDEX idx_fvf_emp (empresa_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await ensureColumn(
    "flota_lecturas",
    "conductor",
    "conductor VARCHAR(120) NULL",
  );
  await ensureColumn(
    "flota_lecturas",
    "viaje_id",
    "viaje_id INT NULL",
  );
  await ensureColumn(
    "flota_lecturas",
    "latitud",
    "latitud DOUBLE NULL",
  );
  await ensureColumn(
    "flota_lecturas",
    "longitud",
    "longitud DOUBLE NULL",
  );
  await ensureColumn(
    "flota_lecturas",
    "capturado_en",
    "capturado_en DATETIME NULL",
  );
  await ensureColumn(
    "flota_servicios",
    "tipo_trabajo",
    "tipo_trabajo VARCHAR(120) NULL",
  );
  await ensureColumn(
    "flota_servicios",
    "dias_en_taller",
    "dias_en_taller INT NULL",
  );
  await ensureColumn(
    "flota_servicios",
    "motivo_taller",
    "motivo_taller VARCHAR(300) NULL",
  );
  await ensureColumn(
    "flota_servicios",
    "repuestos",
    "repuestos TEXT NULL",
  );
  await ensureColumn(
    "flota_servicios",
    "observaciones",
    "observaciones TEXT NULL",
  );
  await ensureColumn(
    "flota_servicios",
    "fecha_entrada_taller",
    "fecha_entrada_taller DATE NULL",
  );
  await ensureColumn(
    "flota_servicios",
    "fecha_salida_taller",
    "fecha_salida_taller DATE NULL",
  );
  await ensureColumn(
    "flota_servicios",
    "creado_at",
    "creado_at DATETIME NULL",
  );
  await ensureColumn(
    "flota_servicios",
    "idempotency_key",
    "idempotency_key VARCHAR(64) NULL",
  );

  await execute(`
    CREATE TABLE IF NOT EXISTS flota_viajes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      empresa_id INT NOT NULL,
      vehiculo_id INT NOT NULL,
      piloto_nombre VARCHAR(120) NOT NULL,
      piloto_usuario_id INT NULL,
      km_salida INT NOT NULL,
      km_llegada INT NULL,
      hora_salida DATETIME NOT NULL,
      hora_llegada DATETIME NULL,
      destino VARCHAR(200) NULL,
      observaciones TEXT NULL,
      estado VARCHAR(20) NOT NULL DEFAULT 'abierto',
      INDEX idx_fv_emp (empresa_id),
      INDEX idx_fv_veh (vehiculo_id),
      INDEX idx_fv_estado (empresa_id, estado)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await ensureColumn(
    "flota_viajes",
    "es_externo",
    "es_externo TINYINT(1) NOT NULL DEFAULT 0",
  );
  await ensureColumn(
    "flota_viajes",
    "empleado_id",
    "empleado_id INT NULL",
  );
  await ensureColumn(
    "flota_viajes",
    "permiso_externo_id",
    "permiso_externo_id INT NULL",
  );
  await ensureColumn(
    "flota_viajes",
    "piloto_nombre_norm",
    "piloto_nombre_norm VARCHAR(120) NULL",
  );

  await execute(`
    CREATE TABLE IF NOT EXISTS flota_permisos_externos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      empresa_id INT NOT NULL,
      piloto_nombre VARCHAR(120) NOT NULL,
      piloto_nombre_norm VARCHAR(120) NOT NULL,
      motivo TEXT NOT NULL,
      estado VARCHAR(20) NOT NULL DEFAULT 'pendiente',
      solicitado_por VARCHAR(100) NULL,
      aprobado_por VARCHAR(100) NULL,
      creado_at DATETIME NOT NULL,
      resuelto_at DATETIME NULL,
      INDEX idx_fpe_emp (empresa_id),
      INDEX idx_fpe_estado (empresa_id, estado)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS flota_servicio_adjuntos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      empresa_id INT NOT NULL,
      servicio_id INT NOT NULL,
      ruta_relativa VARCHAR(400) NOT NULL,
      nombre_original VARCHAR(255) NOT NULL,
      mime VARCHAR(80) NULL,
      tamano INT NOT NULL DEFAULT 0,
      subido_por VARCHAR(100) NULL,
      creado_at DATETIME NOT NULL,
      INDEX idx_fsa_svc (servicio_id),
      INDEX idx_fsa_emp (empresa_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Papelería del vehículo (tarjeta de circulación, póliza, título, etc.).
  // El archivo es opcional (ruta_relativa puede ser NULL) porque a veces
  // solo se quiere dejar una nota — p.ej. "se desactivó la póliza porque…"
  // — sin necesariamente adjuntar un PDF en ese momento.
  await execute(`
    CREATE TABLE IF NOT EXISTS flota_vehiculo_documentos (
      id INT AUTO_INCREMENT PRIMARY KEY,
      empresa_id INT NOT NULL,
      vehiculo_id INT NOT NULL,
      tipo VARCHAR(40) NOT NULL, -- TarjetaCirculacion | PolizaSeguro | TituloPropiedad | PermisoLinea | Otro
      titulo VARCHAR(150) NULL, -- solo cuando tipo = Otro, para que el usuario lo nombre
      estado VARCHAR(20) NOT NULL DEFAULT 'Vigente', -- Vigente | Inactivo
      fecha_vencimiento DATE NULL,
      notas TEXT NULL, -- p.ej. motivo de por qué está Inactivo
      ruta_relativa VARCHAR(400) NULL,
      nombre_original VARCHAR(255) NULL,
      mime VARCHAR(80) NULL,
      tamano INT NULL,
      subido_por VARCHAR(100) NULL,
      creado_at DATETIME NOT NULL,
      INDEX idx_fvd_veh (vehiculo_id),
      INDEX idx_fvd_emp (empresa_id),
      INDEX idx_fvd_vence (empresa_id, fecha_vencimiento)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Qué empresas pueden usar un vehículo (además de la dueña)
  await execute(`
    CREATE TABLE IF NOT EXISTS flota_vehiculo_acceso (
      vehiculo_id INT NOT NULL,
      empresa_id INT NOT NULL,
      PRIMARY KEY (vehiculo_id, empresa_id),
      INDEX idx_fva_emp (empresa_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await ensureColumn(
    "flota_viajes",
    "plan_id",
    "plan_id INT NULL",
  );

  // Evidencias de salida/llegada (tablero km, fotos con GPS)
  await execute(`
    CREATE TABLE IF NOT EXISTS flota_viaje_evidencias (
      id INT AUTO_INCREMENT PRIMARY KEY,
      empresa_id INT NOT NULL,
      viaje_id INT NOT NULL,
      tipo VARCHAR(40) NOT NULL,
      ruta_relativa VARCHAR(400) NOT NULL,
      nombre_original VARCHAR(255) NOT NULL,
      mime VARCHAR(80) NULL,
      tamano INT NOT NULL DEFAULT 0,
      latitud DOUBLE NULL,
      longitud DOUBLE NULL,
      capturado_en DATETIME NULL,
      subido_por VARCHAR(100) NULL,
      creado_at DATETIME NOT NULL,
      INDEX idx_fve_viaje (viaje_id),
      INDEX idx_fve_emp (empresa_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS flota_lectura_evidencias (
      id INT AUTO_INCREMENT PRIMARY KEY,
      empresa_id INT NOT NULL,
      lectura_id INT NOT NULL,
      tipo VARCHAR(40) NOT NULL DEFAULT 'tablero',
      ruta_relativa VARCHAR(400) NOT NULL,
      nombre_original VARCHAR(255) NOT NULL,
      mime VARCHAR(80) NULL,
      tamano INT NOT NULL DEFAULT 0,
      latitud DOUBLE NULL,
      longitud DOUBLE NULL,
      capturado_en DATETIME NULL,
      subido_por VARCHAR(100) NULL,
      creado_at DATETIME NOT NULL,
      INDEX idx_fle_lec (lectura_id),
      INDEX idx_fle_emp (empresa_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Inventario de equipo / herramientas (empresa vs propio del empleado)
  await execute(`
    CREATE TABLE IF NOT EXISTS flota_inv_categorias (
      id INT AUTO_INCREMENT PRIMARY KEY,
      empresa_id INT NOT NULL,
      nombre VARCHAR(80) NOT NULL,
      descripcion VARCHAR(255) NULL,
      activa TINYINT(1) NOT NULL DEFAULT 1,
      UNIQUE KEY uq_fic_nombre (empresa_id, nombre),
      INDEX idx_fic_emp (empresa_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS flota_inv_areas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      empresa_id INT NOT NULL,
      nombre VARCHAR(120) NOT NULL,
      descripcion VARCHAR(255) NULL,
      activa TINYINT(1) NOT NULL DEFAULT 1,
      UNIQUE KEY uq_fia_nombre (empresa_id, nombre),
      INDEX idx_fia_emp (empresa_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS flota_inv_equipo (
      id INT AUTO_INCREMENT PRIMARY KEY,
      empresa_id INT NOT NULL,
      codigo VARCHAR(80) NOT NULL,
      nombre VARCHAR(200) NOT NULL,
      categoria_id INT NULL,
      propiedad VARCHAR(20) NOT NULL DEFAULT 'empresa',
      area_id INT NULL,
      empleado_id INT NULL,
      empleado_nombre VARCHAR(200) NULL,
      cantidad INT NOT NULL DEFAULT 1,
      unidad VARCHAR(40) NOT NULL DEFAULT 'Unidad',
      marca VARCHAR(80) NULL,
      serie VARCHAR(120) NULL,
      estado VARCHAR(40) NOT NULL DEFAULT 'Activo',
      notas TEXT NULL,
      creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actualizado_en DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_fie_codigo (empresa_id, codigo),
      INDEX idx_fie_emp (empresa_id),
      INDEX idx_fie_prop (empresa_id, propiedad),
      INDEX idx_fie_cat (categoria_id),
      INDEX idx_fie_area (area_id),
      INDEX idx_fie_empleado (empleado_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Varios auxiliares por plan TMS
  await execute(`
    CREATE TABLE IF NOT EXISTS tms_plan_auxiliares (
      id INT AUTO_INCREMENT PRIMARY KEY,
      plan_id INT NOT NULL,
      personal_id INT NOT NULL,
      orden TINYINT NOT NULL DEFAULT 1,
      UNIQUE KEY uq_tpa (plan_id, personal_id),
      INDEX idx_tpa_plan (plan_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Paradas / lugares de un plan (N puntos con evidencia de producto)
  await execute(`
    CREATE TABLE IF NOT EXISTS tms_plan_paradas (
      id INT AUTO_INCREMENT PRIMARY KEY,
      plan_id INT NOT NULL,
      orden TINYINT NOT NULL DEFAULT 1,
      lugar_id INT NULL,
      lugar_nombre VARCHAR(200) NOT NULL,
      tipo VARCHAR(40) NOT NULL DEFAULT 'Entrega',
      requiere_evidencia TINYINT(1) NOT NULL DEFAULT 1,
      INDEX idx_tpp_plan (plan_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await ensureColumn(
    "tms_evidencias",
    "parada_id",
    "parada_id INT NULL",
  );

  await ensureColumn(
    "flota_viaje_evidencias",
    "parada_id",
    "parada_id INT NULL",
  );

  // Migrar planes viejos: carga + descarga → paradas (una vez por proceso, lotes chicos).
  if (!tmsParadasMigrated) {
    tmsParadasMigrated = true;
    try {
      const sinParadas = await query<RowDataPacket[]>(
        `SELECT p.id, p.lugar_carga_id, p.lugar_descarga_id,
                lc.nombre AS carga_nombre, ld.nombre AS descarga_nombre
         FROM tms_planes_viaje p
         LEFT JOIN tms_lugares lc ON lc.id = p.lugar_carga_id
         LEFT JOIN tms_lugares ld ON ld.id = p.lugar_descarga_id
         WHERE NOT EXISTS (
           SELECT 1 FROM tms_plan_paradas x WHERE x.plan_id = p.id
         )
         AND (p.lugar_carga_id IS NOT NULL OR p.lugar_descarga_id IS NOT NULL)
         LIMIT 40`,
      );
      for (const p of sinParadas) {
        let orden = 1;
        if (p.lugar_carga_id || p.carga_nombre) {
          await execute(
            `INSERT INTO tms_plan_paradas
              (plan_id, orden, lugar_id, lugar_nombre, tipo, requiere_evidencia)
             VALUES (?, ?, ?, ?, 'Carga', 1)`,
            [
              Number(p.id),
              orden++,
              p.lugar_carga_id ? Number(p.lugar_carga_id) : null,
              String(p.carga_nombre || "Carga"),
            ],
          );
        }
        if (p.lugar_descarga_id || p.descarga_nombre) {
          await execute(
            `INSERT INTO tms_plan_paradas
              (plan_id, orden, lugar_id, lugar_nombre, tipo, requiere_evidencia)
             VALUES (?, ?, ?, ?, 'Descarga', 1)`,
            [
              Number(p.id),
              orden++,
              p.lugar_descarga_id ? Number(p.lugar_descarga_id) : null,
              String(p.descarga_nombre || "Descarga"),
            ],
          );
        }
      }
      // Si aún quedan, permitir otro lote en el próximo arranque en frío.
      if (sinParadas.length >= 40) tmsParadasMigrated = false;
    } catch {
      /* ok si tms aún no existe */
    }
  }
}
