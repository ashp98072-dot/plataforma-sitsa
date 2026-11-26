-- ETAPA 1: columnas quien_lleva y quien_recibe en canecas_ventas
-- Base de datos: u611730801_Plataforma (referencias explicitas; NO depende de USE, DATABASE() ni de la base seleccionada en phpMyAdmin: sirve con information_schema, mysql o ninguna).
-- ETAPA DE ESCRITURA. Requisitos: respaldo restaurable verificado y autorizacion expresa del responsable.
-- Pegue y ejecute TODO el archivo en UNA sola peticion. Si hay un error, DETENGASE y no avance a otra etapa.
-- Aditiva e idempotente (ADD COLUMN IF NOT EXISTS): no modifica filas, indices, CHECK ni triggers. Mientras no se ejecute la etapa 2, las columnas existen pero el trigger aun no las protege: ejecute la etapa 2 enseguida.
--

ALTER TABLE `u611730801_Plataforma`.canecas_ventas
  ADD COLUMN IF NOT EXISTS quien_lleva VARCHAR(160) NULL,
  ADD COLUMN IF NOT EXISTS quien_recibe VARCHAR(160) NULL;
