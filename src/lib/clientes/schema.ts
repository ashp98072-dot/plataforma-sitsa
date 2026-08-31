import type { RowDataPacket } from "mysql2";
import { execute, query } from "@/lib/db";
import { invalidarCacheEmpresa } from "@/lib/empresas";

let ready: Promise<void> | null = null;

/** Crea tablas de clientes compartidos (Hostinger incremental). */
export async function asegurarSchemaClientes(): Promise<void> {
  if (!ready) {
    ready = asegurarInner().catch((e) => {
      ready = null;
      throw e;
    });
  }
  await ready;
}

async function asegurarInner(): Promise<void> {
  await execute(`
    CREATE TABLE IF NOT EXISTS clientes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      empresa_id INT NOT NULL,
      codigo VARCHAR(40) NULL,
      nombre VARCHAR(200) NOT NULL,
      razon_social VARCHAR(250) NULL,
      nit VARCHAR(40) NULL,
      rtu VARCHAR(60) NULL,
      telefono VARCHAR(80) NULL,
      email VARCHAR(160) NULL,
      direccion VARCHAR(300) NULL,
      contacto_nombre VARCHAR(160) NULL,
      contacto_telefono VARCHAR(80) NULL,
      tipo VARCHAR(40) NOT NULL DEFAULT 'comercial',
      estado VARCHAR(20) NOT NULL DEFAULT 'Activo',
      notas TEXT NULL,
      tms_cliente_id INT NULL,
      creado_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      actualizado_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_clientes_tms (empresa_id, tms_cliente_id),
      KEY idx_clientes_empresa_nombre (empresa_id, nombre),
      KEY idx_clientes_empresa_estado (empresa_id, estado),
      CONSTRAINT fk_clientes_empresa FOREIGN KEY (empresa_id)
        REFERENCES empresas(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  // Asegurar columnas si la tabla ya existía en versión corta.
  const cols = await columnas("clientes");
  const needed: [string, string][] = [
    ["codigo", "codigo VARCHAR(40) NULL"],
    ["razon_social", "razon_social VARCHAR(250) NULL"],
    ["rtu", "rtu VARCHAR(60) NULL"],
    ["email", "email VARCHAR(160) NULL"],
    ["contacto_nombre", "contacto_nombre VARCHAR(160) NULL"],
    ["contacto_telefono", "contacto_telefono VARCHAR(80) NULL"],
    ["tipo", "tipo VARCHAR(40) NOT NULL DEFAULT 'comercial'"],
    ["notas", "notas TEXT NULL"],
    ["tms_cliente_id", "tms_cliente_id INT NULL"],
    ["creado_at", "creado_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP"],
    [
      "actualizado_at",
      "actualizado_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP",
    ],
  ];
  for (const [name, ddl] of needed) {
    if (cols.has(name)) continue;
    try {
      await execute(`ALTER TABLE clientes ADD COLUMN ${ddl}`);
    } catch {
      /* ignore */
    }
  }
}

async function columnas(tabla: string): Promise<Set<string>> {
  try {
    const rows = await query<RowDataPacket[]>(
      `SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`,
      [tabla],
    );
    return new Set(rows.map((r) => String(r.c)));
  } catch {
    return new Set();
  }
}

const modulosPatched = new Set<number>();

/**
 * Asegura que la empresa tenga los módulos clientes/facturacion en modulos_json
 * sin borrar los existentes (Hostinger ya sembrado).
 */
export async function asegurarModulosClientesFacturacion(
  empresaId: number,
): Promise<void> {
  if (modulosPatched.has(empresaId)) return;
  try {
    const rows = await query<RowDataPacket[]>(
      "SELECT modulos_json FROM empresas WHERE id = ? LIMIT 1",
      [empresaId],
    );
    if (!rows[0]) return;
    let mods: string[] = [];
    const raw = rows[0].modulos_json;
    if (raw) {
      mods =
        typeof raw === "string"
          ? (JSON.parse(raw) as string[])
          : (raw as string[]);
    }
    const set = new Set(mods);
    let changed = false;
    for (const m of ["clientes", "facturacion"]) {
      if (!set.has(m)) {
        set.add(m);
        changed = true;
      }
    }
    if (!changed) {
      modulosPatched.add(empresaId);
      return;
    }
    const next = [...set];
    await execute("UPDATE empresas SET modulos_json = ? WHERE id = ?", [
      JSON.stringify(next),
      empresaId,
    ]);
    invalidarCacheEmpresa({ id: empresaId });
    modulosPatched.add(empresaId);
  } catch {
    /* no bloquear el módulo si falla el JSON */
  }
}
