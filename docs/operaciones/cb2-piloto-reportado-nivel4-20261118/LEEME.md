# CB2 nivel 4 (`piloto-reportado`) — preflight, impacto, ejecución y postcheck

Migración auditada: `sql/migrate-2026-11-cb2-piloto-reportado.sql` (sin cambios). **No se ejecutó en producción**; la ejecuta el propietario.

## Qué hace y a quién afecta
- Un solo `ALTER TABLE flota_cb2_consumos`: reemplaza `ck_cb2_piloto_unico` por su misma definición (guarda de orden: si el nivel 3 no está, falla entero), agrega `ck_cb2_piloto_reportado` y amplía `ck_cb2c_unidad_tipo` (v3 → v4: las 4 ramas anteriores idénticas + la rama `REPORTADO_V1`).
- **Impacto sobre filas existentes: ninguno.** v4 ⊇ v3 y `ck_cb2_piloto_reportado` solo restringe filas con política `REPORTADO_V1` (que antes no pueden existir). El `ALTER` reconstruye la tabla (bloquea escrituras mientras dura): ejecutar en ventana, con importaciones pausadas.
- **Para qué sirve:** sin este nivel, un nombre no registrado (p. ej. Luis Escobar, mensajero fuera de planilla) sobre una **unidad externa** no se puede guardar como piloto reportado: el CHECK de nivel 3 lo rechaza.

## Secuencia mínima y definitiva (N1, N2 y N3 ya certificados en producción: no se repiten)
Todo lo ejecuta el propietario, con importaciones/altas/conciliación CB2 pausadas desde el paso 1 hasta el 8. Nada de esto se ha ejecutado en producción.
1. **Tablas Shell:** `docs/operaciones/cb2-cierre-20261116/10-preflight-shell-esquema.sql` (debe dar cero faltantes/objetos existentes) → `20-instalar-shell.sql` (3 CREATE TABLE).
2. **Postchecks Shell:** `30-postcheck-shell.sql` y `31-integridad-shell.sql` con la base de la aplicación seleccionada; cero anomalías y tablas vacías.
3. **Preflight nivel 4:** `30-preflight-nivel4-esquema.sql` (ya trae `u611730801_Plataforma`; sirve aunque phpMyAdmin tenga otra base seleccionada). Debe dar exactamente `APTO PARA APLICAR NIVEL 4`. Con `YA INSTALADO` no se ejecuta nada; con `DETENER Y AUDITAR` se lee `motivo` y se detiene. Anotar `filas_consumos`.
4. **ALTER nivel 4:** `35-ejecutar-nivel4-esquema.sql`, **una sola vez**. Nombra base y tabla, es un solo ALTER atómico y falla entero si el nivel 3 falta o el 4 ya está.
5. **Postcheck nivel 4:** `40-postcheck-nivel4-esquema.sql` (opcional: pegar `filas_consumos` del paso 3 en `SET @filas_antes`). Debe dar `OK: NIVEL 4 INSTALADO`.
6. **Habilitación controlada** (decisión del propietario, ninguna se activa sola): `CB2_TERCEROS_DIRECTOS_APROBADA` solo con N1–N3 y nivel 4 acreditados; `CB2_TERCEROS_D2_APROBADA` y `CB2_DOCUMENTOS_FASE2` siguen apagados.
7. **Despliegue** de la rama aprobada (PR #636, sin merge hasta la decisión del propietario).
8. **Humo funcional:** subir septiembre, registrar unidades externas con el panel (tipo elegido por la persona), importar, retomar pendientes desde Historial y consultar el mes de Luis Escobar. Las unidades «En taller» y los productos como `20W50` quedan pendientes: la aplicación nunca reactiva unidades ni convierte un producto desconocido en combustible.

## Cómo decide
Compara por SHA-256 el texto real de los CHECK de MariaDB 11.8.9 (mismas firmas que el detector `sql/preflight-2026-11-cb2-nivel-instalacion.sql`) y cuenta en la base indicada las filas que el nuevo CHECK rechazaría (esperado 0). Fail-closed: esquema no fijado, inexistente, del sistema o con nombre inválido, tabla ausente/no InnoDB, columnas de niveles 1–3 ausentes o CHECK distintos → `DETENER Y AUDITAR`.

## Probado (MariaDB 11.8.9 real, desechable) — `35-ejecutar-nivel4-esquema.sql` es idéntico a la migración salvo el calificador de la tabla (prueba) — `src/lib/flota/cb2/piloto-reportado-nivel4.db.test.ts`
Los archivos se ejecutaron SIN editar sobre el respaldo restaurado en una base llamada exactamente `u611730801_Plataforma`, con `information_schema` seleccionada: nivel 3 → APTO (original y variante ejecutada desde `information_schema`, resultados idénticos) → impacto 0 → migración → postcheck OK (ambas variantes) → preflight `YA INSTALADO` → reaplicar falla → conteo de filas igual. Fail-closed en 7 casos. **Limitación:** el respaldo no trae los CHECK de la cadena (17 de 194); el nivel 3 se instaló desde el repositorio. El resultado real en Hostinger depende de que sus CHECK coincidan con las firmas: por eso el preflight es obligatorio.
