# PR #507: resultados del laboratorio MariaDB 11.8.9

Fecha: 2026-10-22. Fuente inicial: bc12de32f9b3ba3666df4d89ee8707e66cf0b1b4.
El operador reporto CLEAN/base_compatible=1 en Hostinger y respaldo descargado.
Esta ejecucion NO uso ese respaldo ni credenciales, dumps o datos de produccion.
No se conecto a Hostinger, no se modifico main, no se ejecuto workflow ni merge.

## Resultado final

PASS: 22 registros de prueba, 487 ejecuciones del cliente SQL, 11 instancias nuevas
MariaDB 11.8.9 Win64. Run final: 66c734c8-3931-4559-93d7-1a3052b200c8.
Todos los 11 SHUTDOWN devolvieron 0, dejaron de aceptar conexiones y se verifico
que sus PIDs habian terminado. Se preservaron datadirs sinteticos para inspeccion;
no hay servicio instalado ni servidor de laboratorio activo al finalizar.

- Migracion: APLICADA_PENDIENTE_POSTCHECK / FINAL.
- Conteos independientes: 4 tablas, 86 columnas, 34 indices, 18 FK y 26 CHECK.
- Preflight FINAL tras crear; postcheck FINAL en vacio, con consumo pendiente y
  despues de asociar factura/eventos. Las 15 comprobaciones DATO en cero.
- JSON_TABLE efectivo; estado generado STORED cambia PENDIENTE_FACTURA a FACTURADO.
- Vehiculo compartido y dos eventos legitimos en una posicion/revision aceptados;
  evidencia original preservada, tres filas de diario y un consumo referenciado.
- 11 rechazos DML con codigo/SQLSTATE y nombre de FK/CHECK/UNIQUE exactos;
  snapshots antes/despues de las 13 tablas, con tipos y bytes completos, iguales.
- Repetir migracion se rechaza; un diario incompleto da metadata FINAL pero datos
  DIVERGENTE con incidencia concreta, sin falsear certificacion.
- Esquema parcial, longitud alterada, CHECK total alterado, CHECK asociacion
  debilitado, indice CB2 con unicidad alterada y base incompatible: DIVERGENTE,
  guardia de migracion rechazada y sin consultas DATO cuando no corresponde.
- Indice BASE vehiculos: nombre anterior, nombre arbitrario, orden invertido y
  no unico rechazados. El nombre auditado exacto con estructura correcta pasa.
- Metadata con contexto information_schema sigue CLEAN con objetivo explicito;
  objetivo NULL e InnoDB no estricto dan DIVERGENTE. Migracion en otro esquema
  sintetico escribible se bloquea sin crear tablas; postcheck con contexto distinto
  no consulta datos ni certifica RESULTADO FINAL.

Evidencia versionada: [summary.json](evidence/combustibles-pr2-mariadb-11.8.9/summary.json),
[source.json](evidence/combustibles-pr2-mariadb-11.8.9/source.json), aislamiento,
conteos, cuatro SHOW CREATE y postcheck con eventos en el mismo directorio.
source.json registra hashes SHA-256 de los tres SQL, fixtures, ambos runners y
binarios. Se comprobo que coinciden con los archivos probados antes del commit;
los cambios posteriores son documentacion/evidencia. Git puede convertir LF/CRLF
al checkout: comparar el contenido normalizado si se reproducen hashes en otro SO.

Archivo local completo para entregar a auditoria independiente:
.lab-runtime/combustibles-pr2-mariadb-11.8.9-evidence.zip (3,090,980 bytes).
Incluye evidencia de todos los intentos, con SQL enviado, stdout/stderr, resultados,
SHOW CREATE, logs, comandos/procesos y cierres. Excluye binarios y datadirs.
SHA-256: 769da39d24cc4a1cba49a3d985b9f9f7309914f269bf2d7ae55d475fd16e12d1.
El ZIP es local e ignorado por Git; no se publico en GitHub ni en servicios externos.

## Entorno y aislamiento

No habia Docker/MariaDB/WSL ni workflow ejecutable registrado en Actions.
Se agrego un backend portable Windows que comparte suite y aserciones con el arnes
existente, sin suplantar variables de Actions ni desactivar sus guardias.

Distribucion oficial:
https://archive.mariadb.org/mariadb-11.8.9/winx64-packages/mariadb-11.8.9-winx64.zip
Hash ZIP verificado contra sha256sums.txt oficial ANTES de ejecutar:
830c46727d9278eae212ae3eca44eeb9e71b2a68704e95f344a64fba7b1963f5.
Cada escenario crea su propio datadir/UUID y esquema cb2_lab con fixtures sinteticos.
Servidor sin defaults externos, TCP deshabilitado, named pipe unico; cliente
forzado a PIPE, host local punto y ese nombre exacto. Se verifican variables,
datadir y version antes de crear tablas. Sin parametro de host/URL ni credenciales
productivas; entorno de procesos reducido. No se instalan servicios.
No se tocaron los servicios MySQL existentes del equipo.

Es aislamiento de base/proceso, no contenedor/VM ni sandbox del SO. El backend no
tiene los limites de CPU/memoria ni network namespace de Docker. La ruta remota
Actions permanece sin ejecutar; no se publico launcher ni cambio de main.
El README del laboratorio contiene preparacion y comando reproducible.

## Errores encontrados y correcciones

1. Un intento de infraestructura con memoria compartida fallo: este binario no
   admite --shared-memory. Se uso named pipe local con TCP deshabilitado.
   Intento fallido f70ca5a5; no se considero prueba SQL positiva.
2. La prueba de migracion en information_schema obtenia 1044 al resolver DDL,
   antes del SIGNAL 1644 esperado. Se probo la guardia en cb2_other, un segundo
   esquema sintetico escribible: ahora se verifica el SIGNAL previsto y cero tablas.
   No se amplio el comparador de errores para aceptar 1044 como PASS.
3. La migracion creaba las cuatro tablas, pero el contrato rechazaba cinco CHECK:
   ck_cb2c_asociacion, ck_cb2l_payload, ck_cb2l_consumo, ck_cb2l_documento y
   ck_cb2l_marca_origen. MariaDB elimina parentesis redundantes al serializar.
   Se actualizaron solo esas cinco filas esperadas en los cuatro bloques canonicos
   con la representacion real. Se mantienen parentesis significativos en documento.
   DDL, restricciones y comparador REGEXP_REPLACE/binario NO cambian. No se usa
   eliminacion general de parentesis ni equivalencia laxa. Fixture JSON conserva
   las cinco clausulas observadas y una prueba exige coincidencia exacta.
4. Snapshots no contemplaban SMALLINT, presente en las versiones del contrato.
   Se agrega al serializador escalar exacto CAST textual->BINARY; se conserva
   rechazo de tipos no soportados y se agrega una asercion estatica SMALLINT.
5. UPDATE de empresa/proveedor de un consumo ya referenciado activaba primero
   RESTRICT del diario (1451), no la FK de importacion esperada (1452). Los dos
   casos ahora INSERTan un nuevo consumo copiado con ambito incompatible dentro
   de una transaccion sin COMMIT. Se exige 1452/fk_cb2c_importacion y snapshots
   completos iguales despues. No se admite un codigo o constraint alternativo.

Despues de cada fallo se corrigio y repitio. Hubo un run completo PASS de 21
registros (eb86bcf6), seguido de la repeticion FINAL de 22 con el caso adicional
CHECK de asociacion debilitado. Los runs fallidos se conservan en el ZIP y nunca
se cuentan como PASS. No hubo cambios de codigo ejecutado despues del run final.

## Pruebas estaticas

PASS: node --test build-session-preflight.test.mjs (4 pruebas), self-test del arnes,
node --check de los JS cambiados y git diff --check. Los cuatro contratos de
metadata siguen identicos. Comparacion con bc12de32: fuera de las cinco filas
CHECK esperadas, los tres SQL son identicos; todos los CREATE y el comparador
conservador permanecen intactos. El generador mantiene UTF-8 sin BOM.

## Riesgos y trabajo pendiente para auditoria independiente

- El motor probado es MariaDB 11.8.9 Win64, no el build Linux/entorno de Hostinger;
  no se reproduce phpMyAdmin ni su gestion de sesiones. Revisar esa diferencia.
- Los fixtures cubren el contrato minimo de nueve tablas BASE; no son copia del
  esquema completo ni de datos historicos. No certifican produccion, privilegios,
  volumen, bloqueos concurrentes, capacidad de disco o tiempo de DDL de Hostinger.
- Hay 18 FK y 26 CHECK verificados en metadata; los casos DML ejercitan las
  restricciones indicadas, no todas las combinaciones posibles de datos.
- Una interrupcion forzada del runner portable puede impedir su finally; revisar
  los PIDs registrados antes de dar por cerrado un run interrumpido. El run final
  si tuvo sus 11 cierres y procesos verificados.
- DDL tiene commits implicitos; la prueba no lo convierte en rollback global.
  Un parcial real exige diagnostico; no reintentar automaticamente.
- Regenerar y auditar el preflight del SHA final antes de cualquier decision sobre
  produccion. El CLEAN reportado corresponde al SHA anterior, no autoriza migrar.
- La migracion de produccion requiere autorizacion explicita posterior; este
  informe y el respaldo descargado no la sustituyen. No hacer merge como parte
  de esta auditoria. La evaluacion independiente debe revisar cambios y evidencia.
