import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";

async function columnaExiste(tabla: string, columna: string): Promise<boolean> {
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

const COLUMNAS: [string, string][] = [
  ["dpi", "dpi VARCHAR(20) NULL"],
  ["nit", "nit VARCHAR(20) NULL"],
  ["igss", "igss VARCHAR(30) NULL"],
  ["irtra", "irtra VARCHAR(30) NULL"],
  ["telefono", "telefono VARCHAR(40) NULL"],
  ["email", "email VARCHAR(120) NULL"],
  ["direccion", "direccion VARCHAR(255) NULL"],
  ["sexo", "sexo VARCHAR(20) NULL"],
  ["fecha_nacimiento", "fecha_nacimiento DATE NULL"],
  ["tipo_contrato", "tipo_contrato VARCHAR(40) NULL DEFAULT 'fijo'"],
  ["forma_pago", "forma_pago VARCHAR(40) NULL DEFAULT 'transferencia'"],
  ["sueldo_base", "sueldo_base DECIMAL(12,2) NULL"],
  ["bono_incentivo", "bono_incentivo DECIMAL(12,2) NULL"],
  ["bono_herramientas", "bono_herramientas DECIMAL(12,2) NULL"],
  ["profesion", "profesion VARCHAR(120) NULL"],
  ["primer_nombre", "primer_nombre VARCHAR(80) NULL"],
  ["segundo_nombre", "segundo_nombre VARCHAR(80) NULL"],
  ["tercer_nombre", "tercer_nombre VARCHAR(80) NULL"],
  ["cuarto_nombre", "cuarto_nombre VARCHAR(80) NULL"],
  ["primer_apellido", "primer_apellido VARCHAR(80) NULL"],
  ["segundo_apellido", "segundo_apellido VARCHAR(80) NULL"],
  ["apellido_casada", "apellido_casada VARCHAR(80) NULL"],
  ["pais_origen", "pais_origen VARCHAR(80) NULL"],
  ["municipio", "municipio VARCHAR(80) NULL"],
  ["etnia", "etnia VARCHAR(80) NULL"],
  ["religion", "religion VARCHAR(80) NULL"],
  ["idioma", "idioma VARCHAR(80) NULL"],
  ["licencia_numero", "licencia_numero VARCHAR(40) NULL"],
  ["licencia_tipo", "licencia_tipo VARCHAR(10) NULL"],
  ["licencia_vence", "licencia_vence DATE NULL"],
  ["fecha_egreso", "fecha_egreso DATE NULL"],
  ["observaciones", "observaciones TEXT NULL"],
  ["cuenta_bancaria", "cuenta_bancaria VARCHAR(60) NULL"],
  ["tipo_cuenta", "tipo_cuenta VARCHAR(40) NULL"],
  ["banco", "banco VARCHAR(80) NULL"],
  ["contacto_emergencia", "contacto_emergencia VARCHAR(200) NULL"],
];

let ready: Promise<void> | null = null;

export async function asegurarSchemaEmpleados(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      for (const [col, ddl] of COLUMNAS) {
        try {
          await ensureColumn("empleados", col, ddl);
        } catch {
          /* columna o permisos */
        }
      }
      try {
        await execute(`
          CREATE TABLE IF NOT EXISTS empleado_cambios (
            id INT AUTO_INCREMENT PRIMARY KEY,
            empresa_id INT NOT NULL,
            id_empleado INT NOT NULL,
            campo VARCHAR(60) NOT NULL,
            valor_anterior VARCHAR(255) NULL,
            valor_nuevo VARCHAR(255) NULL,
            registrado_por VARCHAR(80) NULL,
            creado_at DATETIME NOT NULL,
            INDEX idx_emp_cambios_emp (empresa_id, id_empleado)
          )`);
      } catch {
        /* ok */
      }
    })();
  }
  await ready;
}
