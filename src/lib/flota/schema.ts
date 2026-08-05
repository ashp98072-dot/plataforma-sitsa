/**
 * Migración alternativa compatible con MySQL que no soporta
 * ADD COLUMN IF NOT EXISTS (ejecutar columna por columna ignorando errores).
 */
import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";

async function columnaExiste(
  tabla: string,
  columna: string,
): Promise<boolean> {
  const rows = await query<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
    [tabla, columna],
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

async function ensureColumn(
  tabla: string,
  columna: string,
  ddl: string,
): Promise<void> {
  if (await columnaExiste(tabla, columna)) return;
  await execute(`ALTER TABLE ${tabla} ADD COLUMN ${ddl}`);
}

/** Asegura columnas/tablas de flota completa (idempotente). */
export async function asegurarSchemaFlota(): Promise<void> {
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
    "flota_lecturas",
    "conductor",
    "conductor VARCHAR(120) NULL",
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
}
