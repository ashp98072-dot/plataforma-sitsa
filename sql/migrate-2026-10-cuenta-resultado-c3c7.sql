-- Propuesta MariaDB; no ejecutar automáticamente. Requiere infraestructura A existente.
-- Idempotente: conserva la tabla, sus datos, FK y clave única empresa/libro/rol.
ALTER TABLE cont_cuentas_rol
 DROP CONSTRAINT IF EXISTS ck_cont_rol_valido,
 ADD CONSTRAINT ck_cont_rol_valido CHECK (rol IN
 ('CLIENTES','IVA_POR_PAGAR','VENTAS_SERVICIOS','RETENCION_IVA','TRANSITO_BANCARIO','ANTICIPOS','DEVOLUCIONES_VENTAS','VENTAS_BIENES','RESULTADO_EJERCICIO'));
