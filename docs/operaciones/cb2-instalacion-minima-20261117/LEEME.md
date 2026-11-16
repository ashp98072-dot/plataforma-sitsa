# CB2 en Hostinger — plan mínimo de instalación (preflight → SQL → postcheck)

Base: `origin/main a709e0f2` (incluye #629 y #628). **No se consultó ni modificó producción**: no se sabe qué migraciones están instaladas. El primer paso del plan *es* averiguarlo con una consulta de solo lectura. Nada de esto se ejecuta sin autorización del propietario; no se activa ningún flag.

## 1. Dependencias reales (verificadas en MariaDB 11.8.9 real, `src/lib/flota/cb2/instalacion-minima.db.test.ts`)

```
base CB2 (consumos con uq_cb2c_ambito, asignaciones PR514)           ← ya requerida por todo
  └─ nivel 1  migrate-2026-11-cb2-terceros.sql                (3 tablas externas + columnas asociacion/identidad + CHECK v1)
       └─ nivel 2  migrate-2026-11-cb2-terceros-directos.sql          (piloto_externo_id/unidad_externa_id + FK + CHECK v2)
            └─ nivel 3  migrate-2026-11-cb2-identidades-independientes.sql (ck_cb2_piloto_unico + CHECK v3 INDEPENDIENTE_V1)
                 └─ nivel 4  migrate-2026-11-cb2-piloto-reportado.sql (singular; ck_cb2_piloto_reportado + CHECK v4 REPORTADO_V1)   [opcional]
Shell: migrate-2026-11-cb2-pilotos-reportados.sql (plural, 3 tablas)  → paquete de #629, sobre consumos
Fondos: migrate-2026-11-cb2-fondos-vinculos.sql (1 tabla)              → paquete de #629; EXIGE uq_fondolin_c2a_empresa_id (C2A) en tms_solicitud_fondo_lineas
```
- **Cada paso es un ALTER que reemplaza `ck_cb2c_unidad_tipo` y NO es idempotente**: repetirlo falla (columna/restricción duplicada) y no cambia nada (probado).
- Saltarse pasos falla sin cambiar nada (directos/independientes sin terceros; directos sin nivel 1…).
- **Defecto corregido en esta rama:** `piloto-reportado` se podía aplicar sobre el nivel 2 sin error; después `identidades-independientes` devolvía el CHECK a la forma v3 y se **perdía `REPORTADO_V1`**. Ahora su primer renglón (`DROP/ADD ck_cb2_piloto_unico`) exige el nivel 3 y el ALTER entero falla si falta.
- Las columnas nuevas llegan NULL a las filas históricas: ninguna migración de la cadena modifica ni borra filas (conteo igual antes/después, probado).

## 2. Qué es obligatorio y qué no, para lo pedido

| Función en Hostinger | Obligatorio | Opcional / no relacionado |
|---|---|---|
| Importar Shell, asignar, vale Pendiente→Listo, consumo, historial | base CB2 + **nivel ≥ 3** de la cadena + 3 tablas Shell (paquete #629) | — |
| Registro directo de pilotos y unidades externos | **nivel ≥ 3** (nivel 2 permite alta, pero la asignación independiente `INDEPENDIENTE_V1` exige el 3) + flag `CB2_TERCEROS_DIRECTOS_APROBADA` (decisión del propietario) | — |
| Vincular consumo con fondos | tabla `flota_cb2_fondos_vinculos` (paquete #629) + índice `uq_fondolin_c2a_empresa_id` (C2A) | — |
| Nombre reportado sobre **unidad externa** sin piloto registrado | — | **nivel 4** (`piloto-reportado`). Sin él esa combinación sigue bloqueada (el CHECK la rechaza, probado); basta registrar el piloto externo antes. Recomendable si los archivos Shell traen nombres no registrados. |
| `operaciones-idempotencia-fondos-gastos` | **No** (el código CB2 no lee esas columnas; la app tolera su ausencia) | El propio archivo declara que **ya se aplicó en producción (2026-10-12)**; es idempotente. Verificar con su preflight, no reaplicar. |
| `fondos-vehiculos-compartidos` | **No** (solo permite que líneas de fondo/gastos usen vehículos compartidos de otra empresa; no interviene en el vínculo CB2) | Su sintaxis era **inválida en MariaDB 11.8.9**; corregida (`FOREIGN KEY IF NOT EXISTS`), idempotente, probada. Aplicar solo si Operaciones usa vehículos compartidos en fondos, tras su preflight. |

## 3. Plan único (solo después de auditoría y con autorización)

1. **Pausar** importaciones, altas y conciliación CB2 durante los ALTER (cada paso de la cadena reconstruye `flota_cb2_consumos`; anotar antes `SELECT COUNT(*) FROM flota_cb2_consumos`). Verificar a mano base y versión (11.8.9).
2. **Preflight de solo lectura:** `sql/preflight-2026-11-cb2-nivel-instalacion.sql`. Guardar sus tres resultados (hechos y nivel, prerrequisitos, definición actual de los CHECK) y la captura `00-capturar-checks-solo-lectura.sql` del paquete #629.
   - `prerrequisitos` deben ser: `consumos_innodb=1`, `uq_cb2c_ambito=1`, `cols_asignacion_de_3=3`, `uq_fondolin_c2a_empresa_id=1` (si es 0, el vínculo con fondos no se puede instalar: detener).
   - `nivel_detectado = INCONSISTENTE` → **detener y auditar** (instalación parcial/manual). No improvisar.
3. **Instalar solo lo que falta, en orden, uno por uno** (columna `siguiente_paso` del detector): `terceros` → `terceros-directos` → `identidades-independientes` (→ `piloto-reportado`, opcional). Tras cada uno: `sql/postcheck-2026-11-cb2-nivel-instalacion.sql` y repetir el detector: debe subir exactamente un nivel; `faltantes`/`motor` vacíos; conteo de filas igual. Si un paso falla: **no repetir a ciegas** (no es idempotente); detener, revisar con el detector.
4. **Tablas Shell y vínculo con fondos:** pasos 3–5 de `docs/operaciones/cb2-cierre-20261116/LEEME.md` (preflights, `20-instalar-*`, postchecks `30/31`). Ya aprobados; no se repite aquí.
5. **Opcional, por separado:** `fondos-vehiculos-compartidos` (con `sql/preflight-2026-10-fondos-vehiculos-compartidos.sql` y su verificación final) solo si se necesitan vehículos compartidos en fondos.
6. **Flags** (decisión del propietario, ninguno se activa aquí): `CB2_TERCEROS_DIRECTOS_APROBADA=1` solo con nivel ≥ 3 acreditado y código aprobado; `CB2_TERCEROS_D2_APROBADA` sigue apagado; `FLOTA_FUSIONES_APROBADAS` y `CB2_DOCUMENTOS_FASE2` no son necesarios para este alcance.

## 4. Bloqueos concretos
1. **Estado productivo desconocido**: hay que ejecutar el detector y los preflights en Hostinger (solo lectura) para saber qué niveles faltan.
2. Si el nivel < 3: instalar la cadena (3 ALTER con reconstrucción de tabla; ventana de pausa).
3. Si `uq_fondolin_c2a_empresa_id` no existe: el vínculo con fondos queda bloqueado hasta acreditar C2A (`migrate-2026-10-combustibles-c2a-fondos.sql`).
4. Tablas Shell y fondos del paquete #629 aún sin instalar (no se asume su estado).
5. Decisión del propietario sobre `CB2_TERCEROS_DIRECTOS_APROBADA`.
6. Respaldo phpMyAdmin sin todos los CHECK: solo laboratorio privado, nunca recuperación fiel (ver #629).

Verificación de los archivos: `SQL.sha256` (los SHA-256 de los archivos de `sql/` que usa este plan; una prueba comprueba que coinciden).
