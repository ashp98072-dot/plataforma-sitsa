-- FONDOS-GASTOS-METODO-PAGO-1
--
-- Agrega método de pago a las líneas de Solicitudes de fondo, mismo
-- catálogo/tipo de dato que ya usa tms_gastos_operativos.metodo_pago
-- (ver src/lib/tms/gastos.ts, METODOS_PAGO_GASTO). No se toca
-- tms_gastos_operativos: ya tiene metodo_pago/numero_cuenta_pago desde
-- sql/migrate-2026-09-tms-gastos-reportes.sql.
--
-- El destino de pago sigue viviendo en la columna existente `cuenta`
-- (bancaria o número de transferencia móvil, según metodo_pago) — no se
-- crea una columna nueva para el número móvil.
--
-- Registros existentes: metodo_pago queda NULL y se interpretan bajo el
-- comportamiento tradicional (etiqueta "Cuenta"), sin ningún reetiquetado
-- ni migración de datos.
--
-- SOLO EJECUTAR MANUALMENTE tras autorización explícita — no se corre
-- desde la aplicación ni en este PR.

ALTER TABLE tms_solicitud_fondo_lineas
  ADD COLUMN IF NOT EXISTS metodo_pago VARCHAR(40) NULL DEFAULT NULL AFTER cuenta;
