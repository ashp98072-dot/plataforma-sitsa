/**
 * Solo para fixtures de pruebas con esquema MÍNIMO (sin FK) que no prueban cobros pero ejecutan SQL de saldos: `SQL_COBRADO` necesita las dos tablas de CxC-1.
 * Las pruebas de cobros usan la migración REAL (sql/migrate-2026-10-cxc-cobros-multifactura.sql).
 */
export const SQL_TABLAS_COBROS_MINIMAS = `
  CREATE TABLE fact_cobros(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, entidad_id INT NOT NULL, cliente_id INT NOT NULL, fecha_cobro DATE NOT NULL,
    monto_total DECIMAL(14,2) NOT NULL, estado VARCHAR(10) NOT NULL DEFAULT 'VIGENTE') ENGINE=InnoDB;
  CREATE TABLE fact_cobro_aplicaciones(id INT AUTO_INCREMENT PRIMARY KEY, empresa_id INT NOT NULL, entidad_id INT NOT NULL, cobro_id INT NOT NULL,
    factura_id INT NOT NULL, monto DECIMAL(14,2) NOT NULL) ENGINE=InnoDB;
`;
