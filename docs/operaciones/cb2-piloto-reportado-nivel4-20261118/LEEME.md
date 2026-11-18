# CB2 nivel 4 (`piloto-reportado`) — preflight, impacto, ejecución y postcheck

Migración auditada: `sql/migrate-2026-11-cb2-piloto-reportado.sql` (sin cambios). **No se ejecutó en producción**; la ejecuta el propietario.

## Qué hace y a quién afecta
- Un solo `ALTER TABLE flota_cb2_consumos`: reemplaza `ck_cb2_piloto_unico` por su misma definición (guarda de orden: si el nivel 3 no está, falla entero), agrega `ck_cb2_piloto_reportado` y amplía `ck_cb2c_unidad_tipo` (v3 → v4: las 4 ramas anteriores idénticas + la rama `REPORTADO_V1`).
- **Impacto sobre filas existentes: ninguno.** v4 ⊇ v3 y `ck_cb2_piloto_reportado` solo restringe filas con política `REPORTADO_V1` (que antes no pueden existir). El `ALTER` reconstruye la tabla (bloquea escrituras mientras dura): ejecutar en ventana, con importaciones pausadas.
- **Para qué sirve:** sin este nivel, un nombre no registrado (p. ej. Luis Escobar, mensajero fuera de planilla) sobre una **unidad externa** no se puede guardar como piloto reportado: el CHECK de nivel 3 lo rechaza.

## Orden (solo lectura → ALTER → solo lectura)
1. `30-preflight-nivel4.sql` con la base de la aplicación seleccionada. **Si phpMyAdmin tiene `information_schema` seleccionada**, usa `30-preflight-nivel4-esquema.sql` y edita el nombre en la línea `SET @esquema = '...'`. Debe dar `APTO PARA APLICAR NIVEL 4`; con `YA INSTALADO` no ejecutes nada; con `DETENER Y AUDITAR` lee `motivo` y compara con `00-capturar-checks-solo-lectura.sql`. Anota `filas_consumos`.
2. Ejecuta `sql/migrate-2026-11-cb2-piloto-reportado.sql` **una sola vez** (no es idempotente: repetirlo falla sin cambiar nada).
3. `40-postcheck-nivel4.sql` (o `-esquema`; opcionalmente pega `filas_consumos` en `SET @filas_antes`). Debe dar `OK: NIVEL 4 INSTALADO`.

## Cómo decide
Compara por SHA-256 el texto real de los CHECK de MariaDB 11.8.9 (mismas firmas que el detector `sql/preflight-2026-11-cb2-nivel-instalacion.sql`) y cuenta en la base indicada las filas que el nuevo CHECK rechazaría (esperado 0). Fail-closed: esquema no fijado, inexistente, del sistema o con nombre inválido, tabla ausente/no InnoDB, columnas de niveles 1–3 ausentes o CHECK distintos → `DETENER Y AUDITAR`.

## Probado (MariaDB 11.8.9 real, desechable) — `src/lib/flota/cb2/piloto-reportado-nivel4.db.test.ts`
Sobre el respaldo restaurado: nivel 3 → APTO (original y variante ejecutada desde `information_schema`, resultados idénticos) → impacto 0 → migración → postcheck OK (ambas variantes) → preflight `YA INSTALADO` → reaplicar falla → conteo de filas igual. Fail-closed en 7 casos. **Limitación:** el respaldo no trae los CHECK de la cadena (17 de 194); el nivel 3 se instaló desde el repositorio. El resultado real en Hostinger depende de que sus CHECK coincidan con las firmas: por eso el preflight es obligatorio.
