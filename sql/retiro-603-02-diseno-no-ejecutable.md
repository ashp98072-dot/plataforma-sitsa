# Retiro 603: diseño bloqueado, no ejecutable

El bloque anterior `retiro-603-02-eliminacion-pendiente.sql` fue retirado del
estado actual del PR. **No usarlo desde commits anteriores ni cambiar sus flags.**
No se entrega una sentencia de eliminación, rutina, ejecutor ni comando de
activación. El estado de este procedimiento es BLOQUEADO; no hay excepción
histórica aprobada ni validación de ejecución MariaDB 11.8.

Contrato para una futura implementación, sujeto a nueva revisión:

1. Confirmar esquema, operador, aprobación, herramienta y ventana sin escritores
   ni DDL, incluyendo jobs, cron, integraciones y sincronizadores de kilometraje.
2. Revisar inventario completo: cantidad de columnas FK, cantidad de restricciones
   y manifiesto ordenado con posiciones y destinos. Las 15 filas comunicadas no
   determinan cuántas restricciones existen. Aprobar ambas cantidades y huella
   del manifiesto; repetir comparación contra metadata completa y visible.
3. Capturar filas completas 603/FRESCOFRESH/4/C-035BXR y 1297/KT/1/C-035BXR;
   conservar backup restaurable y PK/contenidos de las 13 líneas y unidad TMS.
4. Contar referencias externas globalmente. Solo excluir la fila con PK 603 en
   flota_vehiculos; examinar todas sus demás filas y todas las tablas de acceso,
   filtros, documentos, JSON, auditoría y relaciones, sin excepciones de tabla.
5. Clasificar cada candidato de texto/JSON. Una mención histórica legítima solo
   podrá aceptarse por registro y contenido exactos mediante el manifiesto de
   revisión descrito en docs/FLOTA-RETIRO-603-AUDITORIA.md. Ninguna está aceptada
   actualmente. Referencias operativas siguen bloqueando; no se reescribe evidencia.
6. Validar experimentalmente parser, cliente, sesiones, bloque, cursor, prepared
   statements, errores, advertencias, truncamientos, aislamiento, commit y
   rollback en MariaDB 11.8. Esta validación no está autorizada en esta tarea;
   su ausencia es un bloqueo, no una certificación documental.
7. El futuro control transaccional deberá verificar identidad y exactamente una
   fila objetivo; proteger todos los registros preservados mediante locks y
   snapshots no nulos completos, y no depender de comparar dos lecturas de la
   misma instantánea MVCC. Cualquier error/interferencia revierte la transacción
   propia sin tocar operaciones previas de otra sesión.
8. Solo tras resolver lo anterior, proponer una operación limitada al 603 con
   auditoría nueva en la misma transacción y postcheck independiente. No borrar
   ni reasociar auxiliares, no cambiar permisos, propietario o empresa y no tocar
   el 1297, fondos, TMS ni históricos.

Las pruebas offline y los SELECT preparados de preflight no autorizan ese futuro
paso. El postcheck de lectura es una especificación posterior, no evidencia de
que se haya realizado el retiro.
