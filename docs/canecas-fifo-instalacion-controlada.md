# Instalación controlada FIFO en Hostinger

Este procedimiento queda preparado para que lo ejecute el responsable cuando exista autorización específica de instalación. No se ejecuta al desplegar el código. La migración contiene DDL con confirmaciones implícitas: no hay rollback transaccional de una instalación parcial.

1. Detener escrituras y DDL de Canecas, incluidos procesos externos, durante toda la ventana. Tomar un respaldo completo reciente de la base desde Hostinger; descargarlo y verificar que sea legible y restaurable en una base aislada. Conservar el respaldo y un registro de hora y base. No continuar si no hay respaldo verificado.
2. Obtener el contrato completo de las ocho tablas desde el respaldo estructural real y contrastarlo con las definiciones y metadatos visibles de la base y cuenta instaladora. Revisar tipos, signos, defaults, índices, claves foráneas y acciones, CHECK y motores, así como el preflight y la migración. Guardar el JSON revisado, con `formato: 1`, `base` exacta y `contrato` con las cinco secciones de `contrato-base.mjs`, en una ruta privada fuera del repositorio y del directorio público. No deducir estructuras de conteos ni dar por validado un contrato solo porque coincide consigo mismo. Si falta evidencia, detenerse.
3. En una terminal autorizada con Node, dependencias, conexión TLS verificada y la cuenta instaladora, configurar de forma privada `CANECAS_SQL_HOST`, `CANECAS_SQL_PORT` (opcional), `CANECAS_SQL_DATABASE`, `CANECAS_SQL_USER`, `CANECAS_SQL_PASSWORD`, `CANECAS_SQL_CA` (ruta de la CA) y `CANECAS_CONTRATO_VALIDADO` (ruta del JSON revisado). No poner contraseñas en el historial de comandos ni compartirlas. La cuenta debe tener los privilegios directos exigidos por el instalador. Si no hay terminal, CA o acceso TLS con esa cuenta, detenerse.
4. Tras la autorización de instalación, desde la raíz de la versión revisada ejecutar exactamente:

```sh
node scripts/ci/canecas/ejecutar-costos-controlado.mjs --ejecutar
```

La misma conexión toma un bloqueo cooperativo, comprueba privilegios y condiciones, activa modos estrictos solo en la sesión, ejecuta el preflight y compara el contrato antes de cualquier DDL. Ejecuta cada operación por separado, detiene ante advertencias y verifica postcheck, triggers, FK y contrato posterior. Restaura modos y libera el bloqueo. El bloqueo cooperativo no detiene clientes ajenos: mantener suspendidas las escrituras.
5. Exigir salida `Preflight, migración y postcheck completos.` y código de salida cero; revisar los conteos de conciliación pendientes antes de reanudar escrituras. Si aparece cualquier error o advertencia, conservar su registro y mantener Canecas detenido. No volver a ejecutar ni intentar revertir ALTER sueltos: ejecutar el diagnóstico de solo lectura `sql/recuperacion-2026-11-canecas-costos-wip.sql`, conservar el estado y decidir una recuperación supervisada con el respaldo. La restauración debe practicarse primero en un entorno aislado y acordarse según el estado real; no sobrescribir producción automáticamente.

El respaldo estructural y el contrato privado del entorno real no están incluidos en este repositorio. La ruta privada evita publicar estructura sensible; no convierte una captura no revisada en evidencia validada. El instalador se detiene si el archivo falta, es inválido, corresponde a otra base o no coincide.
