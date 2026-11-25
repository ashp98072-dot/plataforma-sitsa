-- PRUEBA CONTROLADA (solo lectura, sin DDL): este cliente continua despues de un error
-- Base de datos: u611730801_Plataforma (referencias explicitas; NO depende de USE ni de la base seleccionada en phpMyAdmin).
-- VERIFICACION DE SOLO LECTURA: no modifica nada. Cada fila debe decir OK (o ser informativa). Cualquier DETENER: no continuar.
-- Ejecutelo UNA vez en phpMyAdmin, antes de la etapa 1. La segunda sentencia falla A PROPOSITO (error 1242).
-- Si en el resultado NO aparece la fila "DESPUES DEL ERROR", el cliente se detiene tras un error (esperado).
-- Si SI aparece "DESPUES DEL ERROR", el cliente CONTINUA tras un error: no confie en que un error detenga el resto del archivo; la etapa 6 (trigger) es la unica sin guarda intrinseca.
--
SELECT 'ANTES DEL ERROR' AS marcador;
SELECT (SELECT 'error intencional' UNION ALL SELECT 'de la prueba') AS error_intencional;
SELECT 'DESPUES DEL ERROR: el cliente CONTINUA tras un error' AS marcador;
