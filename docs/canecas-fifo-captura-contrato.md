# Captura de contrato FIFO desde Hostinger

Un operador autorizado puede ejecutar el diagnóstico en una sesión privada de terminal de Hostinger, desde el directorio del proyecto, usando la cuenta exacta prevista para el instalador y Node con las dependencias instaladas. No necesita dar acceso directo a terceros. El servidor debe admitir conexiones TLS verificadas a MariaDB: configure en esa sesión `CANECAS_SQL_HOST`, `CANECAS_SQL_PORT` (opcional), `CANECAS_SQL_DATABASE`, `CANECAS_SQL_USER`, `CANECAS_SQL_PASSWORD` y `CANECAS_SQL_CA` (ruta al certificado CA). Introduzca los valores mediante el mecanismo privado de su entorno, sin incluirlos en comandos guardados, archivos del repositorio ni mensajes. No desactive la verificación TLS. Si no dispone de terminal, Node, CA o conexión TLS, el administrador debe facilitarlos antes de ejecutar el procedimiento.

Guarde el resultado en una ruta privada fuera del directorio público y del repositorio, accesible solo al operador. Por ejemplo, en una terminal Linux con `umask 077`:

```sh
umask 077
node scripts/ci/canecas/diagnostico-contrato-lectura.mjs > /ruta/privada/captura-canecas.json
```

Revise el código de salida: distinto de cero significa captura incompleta o incompatible; no use el archivo parcial. Para contrastar un contrato independiente ya revisado, añada `--esperado /ruta/privada/contrato-esperado.json` antes de la redirección. Sin él, el resultado será `SIN_CONTRATO_ESPERADO`.

El proceso ejecuta exclusivamente SELECT y SHOW. No incluye contraseñas, cuentas, hosts, grants textuales ni definiciones SHOW CREATE en la salida; interpreta grants directos sin roles y registra si las ocho definiciones son visibles. No consulta filas de negocio. **El esquema, nombre de base, defaults y expresiones CHECK pueden contener información sensible:** el operador debe revisar la salida en privado. Si hay contenido sensible, no lo publique ni comparta; cualquier redacción que afecte la comparación exige revisión local. Compruebe por separado en esa misma cuenta las definiciones SHOW CREATE completas contra la captura, sin enviarlas a terceros.

## Contrato esperado independiente

La plantilla [canecas-contrato-esperado-formato.json](canecas-contrato-esperado-formato.json) es deliberadamente inválida: sus arreglos vacíos no son evidencia. Un responsable debe construir el contrato desde definiciones estructurales completas y revisadas, documentar su origen, confirmar base y cuenta, contrastar SHOW CREATE y visibilidad de las ocho tablas y revisar la compatibilidad con `sql/preflight-2026-11-canecas-costos-wip.sql` y la migración. Los campos y orden requeridos para cada sección están en `scripts/ci/canecas/contrato-base.mjs` y las consultas correspondientes en `sql/contrato-base-canecas-solo-lectura.sql`. Preserve tipos, valores NULL, defaults, ordinales, índices, FK, acciones y CHECK íntegros; no infiera estructuras de conteos ni considere validado un contrato por copiar la captura.

El comparador valida integridad y compara estrictamente las cinco secciones. Una coincidencia exige todavía revisión de visibilidad, permisos efectivos, modos y compatibilidad del DDL; la captura no prueba que la cuenta pueda activar modos ni ejecutar DDL. El instalador mantiene su bloqueo anterior al DDL hasta contar con el contrato validado y coincidente. No se ejecuta migración en esta captura.
