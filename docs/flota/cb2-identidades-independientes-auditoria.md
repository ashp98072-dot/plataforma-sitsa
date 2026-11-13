# Auditoría pendiente: piloto independiente e identidad física

Las cuatro combinaciones usan identidades independientes y una sola identidad de piloto. Selección manual prevalece sobre sugerencias; las propuestas automáticas requieren coincidencia inequívoca. Se conserva el piloto informado y el snapshot anterior. La política A/B anterior sigue disponible cuando terceros directos está apagado.

## SQL propuesto (no ejecutado en producción)

1. Respaldo privado actualizado y laboratorio desechable con MariaDB 11.8.9.
2. `sql/preflight-2026-11-identidad-fisica.sql`: verificar tipos, motores, privilegios CREATE/ALTER/REFERENCES/TRIGGER, CHECK CB2 vigente y ausencia de instalación parcial. Ejecutar también el preflight/postcheck de fusiones existente.
3. `sql/migrate-2026-11-cb2-identidades-independientes.sql` (ALTER único, sin UPDATE de consumos).
4. `sql/migrate-2026-11-flota-identidad-fisica.sql` (cuatro tablas vacías, quince triggers, ninguna aprobación).
5. `sql/postcheck-2026-11-identidad-fisica.sql` y postcheck de fusiones existente. Detenerse ante cualquier código SQL distinto de cero; DDL no tiene rollback global. No usar `--force`, no reejecutar ciegamente una instalación parcial.

La interfaz solo ofrece el nuevo contrato CB2 con terceros directos habilitados y el CHECK `ck_cb2_piloto_unico` presente. No se cambian flags. Una instalación física parcial bloquea catálogos en vez de mostrar duplicados sin garantías.

## Consolidación entre empresas

La herramienta en Duplicados inspecciona solo IDs accesibles. Requiere placa comparable, tipo y chasis real coincidentes, acceso vigente, ausencia de alias anteriores y operaciones abiertas. Cada empresa administradora y propietaria aprueba explícitamente evidencia y revisión. Se serializan aprobaciones por identidad; ninguna se aplica automáticamente. Después de la primera aprobación ya no se admiten nuevos miembros.

Solo el estado APROBADA agrupa el catálogo: prefiere el registro de la empresa activa; si no existe, usa un registro ya compartido. Nunca concede accesos. Históricos conservan IDs, empresa, propiedad y fuentes. No cambia las fusiones anteriores ni su prohibición entre empresas. Propuestas/miembros/aprobaciones son inmutables y no tienen flujo de cancelación en esta entrega: inspeccionar antes de proponer; cambios físicos posteriores requieren auditoría independiente.

## Pares reales y diagnóstico

651/1300 y 684/1301 NO están aprobados con esta entrega. Las pruebas usan esos IDs con datos físicos sintéticos. Falta la ruta al respaldo actualizado posterior a CB2; el respaldo pre-CB2 solo verifica compatibilidad de esquema y conservación histórica, sin acreditar el estado actual.

Solo lectura, con sesión autorizada: GET `/api/empresas/{slug}/flota/combustible/cb2/diagnostico` devuelve BUILD_ID, SHA declarado validado (puede ser null), revisión `cb2-identidades-independientes-v2` y booleanos efectivos. GET `/api/empresas/{slug}/flota/combustible/catalogos` devuelve `tercerosDirectos`, `tercerosHabilitados`, `identidadesIndependientes`. Consultar desde la sesión existente y compartir solo estos campos; no exportar el catálogo completo ni credenciales. Un SHA declarado no demuestra por sí solo el contenido desplegado.

## Reproducción local

`node scripts/ci/cb2-identidades/run-windows.mjs --run-isolated <MariaDB-verificado> scripts/ci/pricesmart-api06a/engine-manifest.json`

Suite DOM/HTTP y módulo: `node node_modules/vitest/vitest.mjs run src/components/flota/cb2 src/lib/flota/cb2 --maxWorkers=2 --testTimeout=20000`. Los runners privados guardan resultados y datos en `.lab-runtime`, fuera de Git. Nunca publicar respaldos ni snapshots privados.

## Corrección de auditoría: operaciones abiertas

`sinOperacionesAbiertas` comprueba las diez columnas utilizadas y los motores InnoDB antes de ejecutar consultas. Si una tabla/columna falta, devuelve 503 con el contrato faltante; no interpreta un error SQL como ausencia de operaciones. No depende de `fecha_plan` para determinar cierre.

- Flota: `vehiculo_id → flota_vehiculos.id`; solo `cerrado` con `hora_llegada` es terminal.
- TMS directo: `tc_vehiculo_id → flota_vehiculos.id`.
- TMS indirecto: `unidad_id → tms_unidades.id → flota_vehiculo_id → flota_vehiculos.id`. No se compara `unidad_id` directamente con un ID de Flota.
- TMS `Cerrado` y `Cancelado` son terminales, incluso con fecha de hoy/futura. `Programado`, `En ruta`, `Cargado`, `Descargado`, NULL y estados desconocidos bloquean conservadoramente. No se modifica ningún estado.

Contrato contrastado con `sql/schema.sql`, lógica de cierre/disponibilidad del repositorio y consultas ejecutadas sobre la restauración privada **pre-CB2 de 13/11/2026 07:17**, con CB2 y fusiones reproducidas en MariaDB 11.8.9. Regresiones sintéticas cubren viajes cerrados, abiertos, cierre sin llegada, reservas TMS por ambas relaciones, estados terminales hoy/futuros, desconocidos y columna faltante. El preflight lista explícitamente columnas, tipos, relaciones y distribución de estados.

**Pendiente sobre respaldo actualizado:** confirmar que no existan diferencias de columnas, motores o relaciones posteriores a esa copia; ejecutar el preflight en una restauración actual; inventariar accesos/propiedad/identificadores y todas las referencias de 651/1300 y 684/1301; comprobar sus estados operativos y obtener las aprobaciones empresariales. No se acreditan los pares reales, la configuración efectiva desplegada ni compatibilidad productiva únicamente con esta copia antigua.

Validación dirigida del 13/11: 31 pruebas MariaDB desechable, cuatro pruebas sobre restauración privada (incluida ejecución del preflight), cuatro pruebas DOM/esquema y cinco regresiones del runner aprobadas; ESLint y diff-check sin errores. `npm ci` completo y `npm run build` completo terminaron con código 0 en copia aislada con dependencias propias, sin archivos de configuración privada, flags ni acceso a BD productiva. Next 16.4.1 compiló, comprobó TypeScript y generó 54/54 páginas estáticas con la configuración original. Entorno: Windows, Node 24.18.0; se ejecutaron los mismos comandos npm del despliegue, no se afirma haber probado el host Linux. Avisos del build: middleware/proxy, cabeceras, tracing dinámico y fallback de workerThreads de Node 24; sin cambios de configuración para ocultarlos. `npm ci` informó ocho vulnerabilidades de dependencias existentes; no se cambió el lockfile ni se ejecutó audit fix.
