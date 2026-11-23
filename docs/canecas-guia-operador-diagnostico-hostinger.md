# Guía para el operador: diagnóstico de metadatos Canecas

La causa de los resultados contradictorios observados en Hostinger está **no determinada**. Un resultado vacío no demuestra que una tabla no exista. Esta guía solo recoge evidencia; no autoriza instalar ni ejecutar migraciones.

1. En phpMyAdmin seleccione la base prevista y abra la pestaña **SQL**. Use una cuenta autorizada para consultas de lectura. Abra [diagnostico-canecas-comparacion-solo-select.sql](../sql/diagnostico-canecas-comparacion-solo-select.sql) y ejecute sus cuatro bloques por separado, en este orden, sin modificar la selección de base:
   1. Identidad y sesión: desde `SELECT DATABASE()` hasta `nombres_en_minuscula`.
   2. Conteos de las seis vistas: desde `SELECT 'TABLES' fuente` hasta `CHECK_CONSTRAINTS`.
   3. Comparación de las ocho tablas: desde `SELECT e.nombre` hasta `ORDER BY e.nombre`.
   4. Conteos por fuente y tabla: desde `SELECT 'TABLES' fuente,TABLE_NAME` hasta `ORDER BY fuente,TABLE_NAME`.
2. Tras cada bloque, guarde inmediatamente el resultado completo antes de ejecutar el siguiente: en la zona de resultados use **Exportar** y elija CSV u otro formato tabular disponible que incluya encabezados. Compruebe que la exportación contiene todas las filas y columnas, también las que no aparecen en la página visible; si hay paginación o límite, seleccione todas las filas o exporte todas las páginas. Conserve valores NULL, ceros y campos vacíos sin modificarlos. Si un bloque no devuelve filas o falla, registre ese resultado o el mensaje de error; no lo omita. No use la exportación completa de la base ni incluya registros de negocio.
3. En la misma base, ejecute por separado los ocho bloques siguientes y guarde el resultado completo de cada uno mediante la exportación de resultados o copiando íntegramente la salida, sin truncar la columna `Create Table`:

```sql
SHOW CREATE TABLE empresas;
SHOW CREATE TABLE usuarios;
SHOW CREATE TABLE canecas_productos;
SHOW CREATE TABLE canecas_ubicaciones;
SHOW CREATE TABLE canecas_saldos;
SHOW CREATE TABLE canecas_compras;
SHOW CREATE TABLE canecas_recepciones;
SHOW CREATE TABLE canecas_movimientos;
```

4. Si existe una conexión de solo lectura autorizada con la cuenta prevista para el instalador, repita los cuatro bloques del diagnóstico y los ocho `SHOW CREATE TABLE` en esa conexión, con la misma base seleccionada. Identifique claramente cada conjunto como **phpMyAdmin** o **cuenta del instalador**. La identidad de phpMyAdmin no demuestra la identidad ni los permisos de otra conexión. Si no se dispone de esa conexión, indíquelo; no use el instalador para obtener la evidencia.
5. Antes de compartir, revise los archivos: **no comparta contraseñas, tokens, credenciales ni datos comerciales**. Redacte cuentas, hosts, nombres sensibles de base y tablas ajenas a Canecas, así como sus valores HEX cuando permitan reconstruirlos. Conserve los resultados de las comparaciones, collation, conteos y la relación entre filas, y señale toda redacción. Si una redacción impide evaluar una comparación, indíquelo para que el resultado se trate como no concluyente. Los `SHOW CREATE TABLE` pueden contener nombres sensibles; revíselos sin suprimir sus definiciones estructurales.

Si la base, identidad o visibilidad no pueden confirmarse, registre la limitación. No interprete los ceros como ausencia ni como compatibilidad.
