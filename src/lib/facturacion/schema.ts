import { execute } from "@/lib/db";

let ready: Promise<void> | null = null;

export async function asegurarSchemaFacturacion(): Promise<void> {
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
    CREATE TABLE IF NOT EXISTS fact_empresa_perfil (
      empresa_id INT NOT NULL PRIMARY KEY,
      respuestas_json LONGTEXT NOT NULL,
      completado_pct TINYINT UNSIGNED NOT NULL DEFAULT 0,
      actualizado_por INT NULL,
      actualizado_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT fk_fact_emp_empresa FOREIGN KEY (empresa_id)
        REFERENCES empresas(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);

  await execute(`
    CREATE TABLE IF NOT EXISTS fact_cliente_perfil (
      id INT AUTO_INCREMENT PRIMARY KEY,
      empresa_id INT NOT NULL,
      cliente_id INT NOT NULL,
      respuestas_json LONGTEXT NOT NULL,
      completado_pct TINYINT UNSIGNED NOT NULL DEFAULT 0,
      actualizado_por INT NULL,
      actualizado_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_fact_cli (empresa_id, cliente_id),
      KEY idx_fact_cli_empresa (empresa_id),
      CONSTRAINT fk_fact_cli_empresa FOREIGN KEY (empresa_id)
        REFERENCES empresas(id) ON DELETE CASCADE,
      CONSTRAINT fk_fact_cli_cliente FOREIGN KEY (cliente_id)
        REFERENCES clientes(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}
