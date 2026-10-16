# C-2B — importación de evidencia del proveedor, no conciliación

Base `f0f5941b1e4909bc31e7e3e00e0a4ecf44408d21`, posterior a #475. No producción/SQL/merge.

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

Scripts `sql/{preflight,migrate,postcheck}-2026-10-combustibles-c2b-importaciones.sql` propuestos, no ejecutados. SHOW de tablas/columnas/índices/engine/collation, padres y huérfanos; detener ante tabla paralela equivalente/estado parcial/contrato divergente. Revisión humana obligatoria de definiciones exactas antes de IF NOT EXISTS; esa cláusula no certifica compatibilidad. FKs compuestas proveedor/empresa y línea/cabecera, canónica dentro de misma importación; usuarios globales, todas RESTRICT. Índices cubren hash, perfil, clave/fingerprint y origen. No convertir collation ni cambiar datos legados. Afecta tablas legacy con FK nuevas: cualquier huérfano debe detener el despliegue, no limpiarlo en este ticket.

Migrar/postcheck antes de desplegar código que lee campos nuevos. DDL no transaccional; una interrupción necesita revisar estado parcial. Sin DDL en bootstrap/requests. No se ha certificado el DDL físico de producción ni probado la migración contra ella. C2A queda intacto. Sin matching C2C, tolerancias, cierre, contabilidad ni cuentas por pagar.

Los reportes legacy no tienen proveedor/hash/clave fiables: no se les atribuyen duplicados C2B por adivinación ni se hace backfill. La advertencia entre importaciones cubre únicamente reportes HALEL C2B del mismo tenant/proveedor. Verificar auditoria InnoDB, FK/CHECK habilitados y UPLOAD_DIR persistente privado antes de desplegar.

La nueva columna hoja_origen usa utf8mb4_bin para que el índice de origen no confunda nombres de hoja distintos por acentos bajo la collation AI de la tabla. No convierte columnas existentes ni cambia la collation de tabla.

## Validación local y pendientes

Misma máquina/dependencias/comando en BASE y C2B: `npx vitest run src/lib/flota/combustible src/app/api/empresas/[slug]/flota/combustible src/lib/tms/fondos src/app/api/empresas/[slug]/tms/fondos`.

- BASE exacta: 599 aprobadas / 21 omitidas / 0 fallos.
- C2B: 631 aprobadas / 21 omitidas / 0 fallos: 32 pruebas adicionales, cero regresiones en esta suite dirigida ampliada. No suite global completa.
- TypeScript, ESLint dirigido, git diff --check y npm run build exitosos. Build conserva avisos existentes en archivos no modificados (middleware, Cache-Control y filesystem tracing).
- Fixture anónimo, parser multifolio/alias/raw, 20→10, ceros, km textual/decimal, piloto desconocido, invalidación de fórmulas, duplicados internos/previos/hash, recibo vinculado al contexto, preview sin escrituras, transacción/rollback/auditoría/archivo, commit incierto, conteos de placeholders y referencia canónica. Permisos HTTP con guards reales y servicios simulados. Render HTML de tabla y filtros.
- No SQL ejecutado ni certificación física/DDL real; pruebas de BD y navegación completa con datos reales quedan pendientes de un entorno autorizado después del preflight. No se incorporó el Excel privado ni dependencias nuevas. No merge.
