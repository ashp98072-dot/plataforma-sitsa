# Secuencia de activación FIFO

Pendiente de autorización de instalación, contrato estructural completo revisado y acceso TLS verificable para la cuenta instaladora. No ejecutar mientras alguno falte.

1. Suspender escrituras y DDL de Canecas; obtener respaldo completo, verificar restauración en base aislada y conservarlo. El bloqueo del instalador no impide escrituras de otros clientes.
2. Usar el respaldo estructural existente para construir y revisar el contrato de las ocho tablas en formato `formato`, `base`, `contrato`; comprobarlo contra el esquema esperado, no solo contra conteos. Guardarlo en una ruta privada y configurar `CANECAS_CONTRATO_VALIDADO` con esa ruta. El respaldo existente debe incluir las ocho tablas y ser del mismo entorno.
3. En la terminal autorizada, configurar `CANECAS_SQL_HOST`, `CANECAS_SQL_DATABASE`, `CANECAS_SQL_USER`, `CANECAS_SQL_PASSWORD` y `CANECAS_SQL_CA`; `CANECAS_SQL_PORT` es opcional. Ejecutar desde la raíz de la versión revisada y detenerse ante cualquier error:

```sh
node scripts/ci/canecas/ejecutar-costos-controlado.mjs --ejecutar
node scripts/ci/canecas/ejecutar-salidas-controlado.mjs --ejecutar
```

La primera salida debe confirmar `Preflight, migración y postcheck completos.`; la segunda, `Instalación y postcheck de salidas completos.`. Verificar sus códigos de salida antes de continuar; no encadenar los comandos sin comprobar el primero. Conciliar existencias sin capa y costos pendientes antes de registrar salidas. Las salidas quedan bloqueadas si hay reservas sin asignación por capa o capas de valoración inicial con prioridad desconocida. No levantar esos bloqueos manualmente: primero debe existir una política FIFO aprobada y probada. El instalador crea y verifica cinco triggers que protegen la inmutabilidad de salidas y detalles; verificar también sus definiciones en el postcheck.

4. Ante error o advertencia, dejar Canecas detenido y no reintentar. El DDL puede haber quedado parcialmente aplicado. Ejecutar únicamente el diagnóstico de lectura `sql/recuperacion-2026-11-canecas-costos-wip.sql` para costos o `sql/recuperacion-canecas-salidas-solo-lectura.sql` para salidas, conservar el registro y decidir recuperación supervisada con el respaldo; no borrar objetos ni restaurar automáticamente producción.

## Si no hay TLS remoto

No hay todavía un importador phpMyAdmin que garantice en la misma sesión la comparación completa del contrato, parada ante cada advertencia y postcheck de ambos instaladores. No importar directamente los SQL WIP ni suprimir las compuertas. Para una alternativa phpMyAdmin segura falta implementar y probar ese importador con el entorno concreto; como alternativa operativa, el administrador puede habilitar temporalmente una conexión TLS verificada para la cuenta instaladora. No usar `rejectUnauthorized: false`.
