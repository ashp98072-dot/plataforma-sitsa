# C-2B — importación de evidencia del proveedor, no conciliación

Base `f0f5941b1e4909bc31e7e3e00e0a4ecf44408d21`, posterior a #475. Esta rama no consulta/modifica producción ni hace merge. SQL de reproducción únicamente en MariaDB local desechable.

## Discovery y modelo

Ya existen `flota_combustible_conciliaciones` y `flota_combustible_conciliacion_filas` en `src/lib/flota/schema.ts`, con archivo privado y snapshots de conciliación. El parser anterior exige PRODUCTO y toma una hoja; no sirve para HALEL ni conserva km/serie/factura. No se modifica ese parser/motor.

Se amplían ambas tablas, no se crean tablas paralelas. Cabecera C2B: proveedor del catálogo `compras_proveedores`, snapshot de nombre, SHA-256 del binario, perfil HALEL versión 1, estado IMPORTADA, resumen JSON y usuario ID; archivo/ruta/MIME/tamaño/fecha/username existentes. UNIQUE empresa/proveedor/hash bloquea reimportación exacta, sin excepción administrativa en esta fase. Proveedor se bloquea para serializar confirmaciones.

Línea C2B: hoja/fila, estado_parseo, fingerprint, clave_operacion, clasificación de duplicado y referencia a canónica de la misma importación/empresa. `datos_importacion JSON` versión de parser en cabecera conserva textos originales (fecha/placa/vale/galones/precio/total/km/piloto/serie/factura), fechaReporte nullable, normalizaciones, números decimales en strings exactos, motivos, referencia canónica ordinal y aviso de aparición previa. `origen_celdas JSON` conserva dirección/tipo/formato/valor completo, incluidas fórmulas y resultados disponibles (no evaluados). NULL representa ausencia, no cero. JSON puede aparecer físicamente como LONGTEXT en MariaDB.

Campos nuevos nullable para legados, sin backfill. C2B guarda estado legacy DESCARTADA/motivo «Importación sin conciliación» únicamente como compatibilidad de columnas NOT NULL; ese campo NO es la clasificación C2B. Lecturas legacy excluyen perfil HALEL por `perfil_parser IS NULL`; el historial viejo queda sin reinterpretar. C2B no escribe carga_combustible_id ni snapshots de sistema ni solicitud_fondo_linea_id.

## Parsing y duplicados

ExcelJS ya instalado, importado solo en servidor. Alias cerrados normalizados sin tildes/puntuación; búsqueda de cabecera en primeras 25 filas. Requiere columnas vale+placa+(total o galones), rechaza columnas ambiguas. Una fila operativa válida requiere vale, placa y total o galones positivos. Blancas/cabeceras/preámbulos/notas sin vale/placa/totales se conservan como IGNORADA con motivo; filas operativas incompletas son INVALIDA. Hojas sin cabecera se conservan como ignoradas y se advierten; se exige al menos una hoja reconocida y una operación válida. Nunca se evalúan fórmulas; fila operativa con fórmula/error => INVALIDA. El original permite auditar lo que no se interpretó.

Fecha neutral de reporte, nunca consumo; se reutiliza normalizarFechaExcel y se respeta sistema 1904. Strings numéricos usan punto decimal o miles explícitos estilo 1,234.50; ambiguos/no reconocidos quedan NULL con advertencia. Galones/precio/total hasta 6 decimales; km hasta 3, sin truncar (NO MARCA KM queda texto/NULL). Piloto es texto del proveedor, no empleado; nunca crea RRHH. No se resuelven vehículos.

Vale: Unicode NFC, trim/espacios/mayúsculas, sin borrar ceros/guiones; formatos numéricos puros de ceros preservan padding visible y raw conserva el número original. Placa: mayúsculas/espacios y guiones Unicode, sin quitar prefijo C. Identificadores numéricos que ya perdieron ceros en origen no pueden reconstruirse por adivinación.

Fingerprint v1: SHA-256 de tupla normalizada vale, placa, fecha de reporte, galones, precio, total, serie, factura, km y piloto. Unidades numéricas se comparan como decimales exactos, texto ausente/no interpretable se conserva. Primera aparición en orden de hoja/fila es canónica determinista; repeticiones equivalentes => EXACTO con referencia, nunca se eliminan. Clave de advertencia: hash del vale normalizado; otro fingerprint con ese vale => POSIBLE, sin fusionar (vale puede reutilizarse). Ambas claves se consultan solo dentro de empresa+proveedor. Entre importaciones se marca POSIBLE_DUPLICADO_PREVIO por esa clave, sin FK automática ni fusión. Conteo único es estimación por fingerprint válido, no consumo certificado; no se presenta suma financiera.

Archivo real revisado de solo lectura: tres hojas, 20 apariciones y 10 operaciones normalizadas únicas. Fixture sintético anonimizado reproduce 10+5+5, texto/decimal km, piloto desconocido, facturas por fila, variaciones de encabezados y totales. No se incorpora el archivo privado al repo.

## Flujo, seguridad y límites

Conciliar permite preview/confirmar; Ver permite listado/detalle/descarga. Guards existentes conservan tenant/Admin; no nuevos permisos. Proveedor activo de empresa obligatoriamente elegido con CatalogoSearchSelect. Ningún vínculo a empleados, unidades, Fondos o vales.

Preview no escribe BD ni archivo. Se entrega recibo JWT HS256 con audiencia específica, usuario/tenant/proveedor/hash/versión/digest del preview y expiración 15 minutos; no sirve como token de sesión. Confirmación reenvía original, verifica recibo y recalcula todo bajo transacción+lock proveedor. Si la clasificación previa cambió, 409 y nuevo preview; evita confirmar un archivo distinto o datos manipulados. Hash repetido bloqueado incluso con concurrencia mediante UNIQUE. No guardar un preview enviado por el cliente.

Confirmación: proveedor/tenant, hash/duplicados, archivo privado mediante guardarUploadExcel, cabecera, todas las filas serialmente, auditoría y commit. Fallo previo al commit => rollback y borrado compensatorio del archivo nuevo. Caída abrupta del proceso o resultado incierto de COMMIT sigue siendo una limitación del patrón filesystem/BD (no atomicidad distribuida); requiere conciliación operativa de archivos. Ante COMMIT incierto se conserva evidencia y se registra empresa/hash para revisión, nunca se destruye un archivo posiblemente referenciado.

MIME/extensión/tamaño antes de ExcelJS, ZIP central acotado (sin ZIP64/cifrado, 2,000 entradas y 80 MB declarados expandidos), máximo aplicación 50 MB. 20 hojas, 5,000 filas por hoja, 10,000 total, 100 columnas, 100 KB raw por fila y 8 MB raw por libro. Rechaza excesos; no trunca filas. Son límites operativos del importador, no garantía del límite del proxy. Preview/detalle paginan visualmente 100 filas; listado hasta 100 importaciones. Escapado de texto por React; no evalúa ni renderiza HTML/fórmulas del archivo. Descarga protegida por tenant+perfil y path validado, nunca ruta del cliente.

## SQL y rollout

Scripts `sql/{preflight,migrate,postcheck}-2026-10-combustibles-c2b-importaciones.sql` corregidos para rollout físico. El operador informó que ejecutó cabecera en producción y que filas falló sin cambios; esta rama no ejecutó esos scripts allí. Metadata en information_schema y lecturas de datos certifican tipos/signedness/nullability/default/EXTRA, charset/collation, JSON_VALID, orden de columnas/unique/prefijos de índices, tabla/esquema/columnas referenciadas y RESTRICT/RESTRICT. No se usa IF NOT EXISTS como certificación ni se repara metadata divergente. FKs compuestas proveedor/empresa y línea/cabecera, canónica dentro de misma importación; usuarios globales. Índices cubren hash, perfil, clave/fingerprint y origen. No convertir collation ni cambiar datos legados.

Estados reconocidos: CLEAN (0 objetos C2B), PARTIAL_HEADER_COMPLETE (14/14 objetos de cabecera correctos y 0 objetos C2B en filas), FINAL (14/14 y 16/16) y DIVERGENTE. Los conteos incluyen columnas, índices explícitos y FKs; JSON se certifica como LONGTEXT bin con su CHECK nativo, no se convierte. Tablas base, tipos INT signed, PK/único padre e InnoDB también se verifican. Huérfanos o referencias inválidas convierten el resultado a DIVERGENTE. Otro parcial => SIGNAL antes del primer DDL.

Desde CLEAN se aplica cabecera; desde PARTIAL_HEADER_COMPLETE se omite totalmente su ALTER, después de certificarlo. Filas siempre usa cuatro ALTER separados: A columnas; B índices; comprobación física del UNIQUE empresa/conciliacion/id; C FK a cabecera; D FK autorreferenciada. FINAL no ejecuta DDL y devuelve NOOP. Si se interrumpe entre fases, se detiene ante el nuevo parcial; no continúa/repara estados no autorizados.

Preflight y postcheck son de solo lectura de tablas: usan SELECT/SHOW, asignaciones a variables de sesión y un bloque BEGIN NOT ATOMIC con PREPARE/EXECUTE de SELECT constantes para no referenciar columnas aún ausentes. No crean rutinas/funciones, no escriben datos, no requieren PROCESS ni SHOW ENGINE INNODB STATUS. NULL en una métrica indica comprobación no aplicable porque falta el contrato; no se presenta como cero certificado. Postcheck exige FINAL y 0 huérfanos/referencias canónicas inválidas. Migrate compara automáticamente conteos legacy antes/después en la misma sesión; postcheck en otra conexión exige comparar con el preflight guardado, no inventa preservación entre sesiones.

Procedimiento de continuación productiva: guardar resultado de preflight completo en la BD seleccionada; exigir PARTIAL_HEADER_COMPLETE con 14/14 de cabecera y filas legacy, sin huérfanos; revisar SHOW CREATE/INDEX y conteos; solo con autorización ejecutar el migrate completo (sin separar bloques ni perder las variables de sesión); exigir CONTINUADO_PARTIAL_HEADER_COMPLETE/FINAL; ejecutar postcheck y comparar conteos; segunda ejecución autorizada debe devolver NOOP. Ejecutar en ventana sin escrituras ni DDL concurrentes. phpMyAdmin debe procesar los delimitadores/bloques MariaDB del archivo completo. No desplegar código dependiente de columnas antes de FINAL.

DDL no transaccional; una interrupción necesita diagnóstico manual. Sin DDL en bootstrap/requests. Se probaron scripts contra MariaDB 11.8.9 local, no contra producción. La certificación productiva corresponde al preflight que ejecute el operador. C2A queda intacto. Sin matching C2C, tolerancias, cierre, contabilidad ni cuentas por pagar.

### Diagnóstico reproducido del errno 150

El DDL original falló en MariaDB 11.8.9 local con 1005/150. SHOW WARNINGS identificó fk_fccif_canonica: «There is no index in the referenced table where the referenced columns appear as the first columns». Al crear el UNIQUE y la FK autorreferenciada en el mismo ALTER, no se encontraba el índice físico referenciado. La sentencia de filas falló íntegra y cabecera quedó aplicada, reproduciendo el patrón comunicado de Hostinger. La solución por fases se probó con el mismo motor; no se atribuye el diagnóstico a un SHOW ENGINE productivo que no estuvo disponible.

Los reportes legacy no tienen proveedor/hash/clave fiables: no se les atribuyen duplicados C2B por adivinación ni se hace backfill. La advertencia entre importaciones cubre únicamente reportes HALEL C2B del mismo tenant/proveedor. Verificar auditoria InnoDB, FK/CHECK habilitados y UPLOAD_DIR persistente privado antes de desplegar.

La nueva columna hoja_origen usa utf8mb4_bin para que el índice de origen no confunda nombres de hoja distintos por acentos bajo la collation AI de la tabla. No convierte columnas existentes ni cambia la collation de tabla.

## Validación local y pendientes

Misma máquina/dependencias/comando en BASE y C2B: `npx vitest run src/lib/flota/combustible src/app/api/empresas/[slug]/flota/combustible src/lib/tms/fondos src/app/api/empresas/[slug]/tms/fondos`.

- BASE exacta: 599 aprobadas / 21 omitidas / 0 fallos.
- C2B: 631 aprobadas / 21 omitidas / 0 fallos: 32 pruebas adicionales, cero regresiones en esta suite dirigida ampliada. No suite global completa.
- TypeScript, ESLint dirigido, git diff --check y npm run build exitosos. Build conserva avisos existentes en archivos no modificados (middleware, Cache-Control y filesystem tracing).
- Fixture anónimo, parser multifolio/alias/raw, 20→10, ceros, km textual/decimal, piloto desconocido, invalidación de fórmulas, duplicados internos/previos/hash, recibo vinculado al contexto, preview sin escrituras, transacción/rollback/auditoría/archivo, commit incierto, conteos de placeholders y referencia canónica. Permisos HTTP con guards reales y servicios simulados. Render HTML de tabla y filtros.
- Ese baseline corresponde a la entrega inicial. La corrección de rollout agrega pruebas reales de MariaDB y contratos SQL; se registra su resultado final más abajo. No se incorporó el Excel privado ni dependencias nuevas. No merge.

Pruebas DB opt-in: `$env:C2B_TEST_LOCAL_DB='1'; npx vitest run src/lib/flota/combustible-importaciones-rollout-db.test.ts`. Puerto fijo 127.0.0.1:34079; antes de crear BD verifica MariaDB 11.8.9 y datadir local node_modules/.c2b-mariadb-data. No utiliza DB_* ni configuración/credenciales de la aplicación. Crea solo BD c2b_test_* y datos sintéticos, y los elimina al finalizar. Incluye preservación de todos los valores legacy, no solo conteos, reproducción original, CLEAN/PARTIAL/FINAL/NOOP, tipos/índices/FKs incorrectos, JSON/LONGTEXT, parciales inesperados y huérfanos. No se ejecuta por defecto si no se habilita expresamente.

Corrección de rollout: comparación contra HEAD anterior `708b7f44aa2d36cbb253ea0558236fc60ec66033`, mismas dependencias/máquina/comando dirigido: BASE 631 aprobadas / 21 omitidas / 0 fallos; corrección 649 aprobadas / 21 omitidas / 0 fallos. Las 18 adicionales son 16 pruebas con MariaDB 11.8.9 real y 2 contratos estáticos. Ejecución aislada DB/contratos: 21/21. Un usuario local sin PROCESS recibió 1227 al intentar SHOW ENGINE, pero completó los tres scripts correctamente. TypeScript, ESLint de los dos tests, diff-check y build OK. No se repitió suite global completa. Se ejecutó SQL únicamente en instancia local desechable con datos sintéticos; no SQL productivo ni datos reales. Parser, UI y servicios no cambiaron en esta corrección.
