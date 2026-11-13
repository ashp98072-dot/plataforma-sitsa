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
