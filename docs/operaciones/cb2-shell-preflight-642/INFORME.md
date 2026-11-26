# CB2 Shell — preflight posterior al merge de #642

**Dictamen: APTO PARA PREFLIGHT** (el código y el esquema esperado están verificados en laboratorio). **No está acreditado que Hostinger lo esté usando:** falta ejecutar el preflight SQL en producción (solo lectura), comprobar las banderas efectivas y confirmar el despliegue. No se declara listo para producción.

Base: `main` en `869b03cf`. No se ejecutó SQL productivo, no se instalaron migraciones, no se tocaron datos, banderas ni permisos, no se crearon vehículos.

## 1. Estado de cada requisito

| # | Requisito | Estado | Evidencia |
|---|---|---|---|
| 1 | `main` contiene `61274ffb` (#642) y `869b03cf` (#643) | **OK** | `git merge-base --is-ancestor` de ambos contra `origin/main`; `869b03cf` es la punta |
| 2 | Rutas, componentes y tablas del flujo | **OK** | sección 2 |
| 3 | Requisitos de instalación (identidades independientes, pilotos reportados, unidades externas) | **OK, verificado en laboratorio** | sección 3; `shell-uso-real-preflight.db.test.ts` recorre N1→N4 + tablas Shell con las migraciones reales |
| 4 | Banderas y valores esperados | **OK (lectura de código)** | sección 4; el valor real en producción **no se pudo leer** |
| 5 | Preflight SQL de solo lectura (MariaDB 11.8.9) | **OK** | `sql/preflight-2026-11-cb2-shell-uso-real.sql`, 7/7 en laboratorio |
| 6 | Escenarios de laboratorio | **OK** | sección 5 (matriz de 11 casos, cliente y servidor) |
| 7 | Contradicciones LISTO cliente / servidor | **Sin contradicciones en la matriz** | sección 6 (con 2 diferencias conocidas, en sentido seguro) |
| 8 | Cómo verificar el despliegue de #642 | **Hallazgo: el diagnóstico actual no puede probarlo** | sección 7 y Draft PR #664 |

## 2. Rutas, componentes y tablas del flujo Shell nuevo
- **API** (`/api/empresas/{slug}/flota/combustible/…`): `catalogos` (GET: empleados Activo/Baja con fecha de baja, vehículos + unidades externas, banderas), `cb2/preview`, `cb2/confirmar`, `cb2/reanudar`, `cb2/importaciones/{id}/filas`, `cb2/importaciones/{id}/pilotos-nombres`, `cb2/terceros` (POST `UNIDAD`/`PILOTO`: alta de la unidad externa desde el vale), `cb2/pilotos-reporte`, `cb2/corregir`, `cb2/diagnostico`.
- **Componentes:** `importar.tsx`, `historial.tsx`, `asignacion.tsx`, `revision-nombres.tsx` (`PilotoShellVale`), `unidad-shell-vale.tsx` y `unidad-shell.ts`, `preview-vista.tsx`, `preview-model.ts` (`seleccionSegura`, `pilotoShellResuelto`), `problemas-asignacion.ts`.
- **Tablas:** `flota_cb2_consumos` (+ `piloto_externo_id`, `unidad_externa_id`, `identidad_externa`, `vehiculo_id` NULL), `flota_cb2_filas`, `flota_cb2_asignaciones`, `flota_cb2_externos_{pilotos,unidades,asociaciones}`, `flota_cb2_pilotos_reportados`, `flota_cb2_consumo_piloto_reportado`, `flota_cb2_pilotos_equivalencias`, `auditoria`, `empleados` (`estado`, `fecha_egreso`, `fecha_alta`), `flota_vehiculos` (solo lectura: no se crean vehículos).

## 3. Qué función exige qué instalación
| Función | Requiere |
|---|---|
| Shell con unidad interna + empleado (activo/baja) o piloto reportado | base CB2 + 3 tablas Shell (15 guardas, 4 índices únicos) — **sin banderas** |
| Confirmar unidad externa desde el vale; consumo en unidad externa con empleado o reportado | lo anterior + **nivel ≥ 3** (`ck_cb2_piloto_unico`, `INDEPENDIENTE_V1`) + `CB2_TERCEROS_DIRECTOS_APROBADA=1` |
| Piloto reportado sobre unidad externa | **nivel 4** (`ck_cb2_piloto_reportado`, `REPORTADO_V1`) |
| Fecha de baja visible | columna `empleados.fecha_egreso` (si falta, la interfaz sigue funcionando sin la fecha) |
Si el registro de pilotos está **parcial**, la aplicación responde **503** (no se degrada): el preflight lo marca `DETENER Y AUDITAR`.

## 4. Banderas (solo lectura de código; sus valores se verifican con el diagnóstico)
| Variable | Valor esperado para este flujo |
|---|---|
| `CB2_TERCEROS_DIRECTOS_APROBADA` | `1` (solo para unidades/identidades externas; sin ella el vale lo explica y no registra) |
| `CB2_TERCEROS_D2_APROBADA` | apagada (no necesaria) |
| `CB2_PUBLIC_ORIGIN` | sin definir (por defecto `https://novalvion.com`) o el origen HTTPS exacto del sitio; si no coincide, los POST dan 403 |
| `CB2_DOCUMENTOS_FASE2`, `FLOTA_FUSIONES_APROBADAS`, `FLOTA_PROPIEDAD_EXTERNA` | no necesarias |
Ojo: `loadRuntimeEnv` indica que el archivo persistente de configuración puede prevalecer sobre el panel; el valor **efectivo** es el que devuelve el diagnóstico.

## 5. Resultados de laboratorio (MariaDB 11.8.9 desechable, sin red)
- **Paridad cliente/servidor** (`terceros.db.test.ts`, 33/33). Cada caso calcula el estado con el código del cliente (`revisionCandidatos` + `seleccionShell`) y luego envía lo mismo al servidor (`preview` + `confirmarArchivo`):

| Escenario | Cliente | Servidor |
|---|---|---|
| empleado activo (reconocido) | LISTO | acepta |
| empleado de baja (reconocido) | LISTO | acepta |
| piloto reportado confirmado | LISTO | acepta |
| piloto externo válido | LISTO | acepta |
| unidad interna | LISTO | acepta |
| unidad externa + reportado | LISTO | acepta (sin crear vehículo en Flota) |
| externo sin identidad / sin decisión de piloto | PENDIENTE | n/a (no se puede enviar) |
| placa ambigua sin unidad | PENDIENTE | n/a |
| placa ambigua, unidad elegida **sin** motivo | PENDIENTE | **rechaza** |
| placa ambigua, unidad elegida **con** motivo | LISTO | acepta |
| combustible sin clasificar (`20W50`) | PENDIENTE | **rechaza** |
Tras la matriz: sin vehículos nuevos, empleados sin cambios (Activo/Baja intactos) y cada consumo guarda la identidad correcta.
- **Preflight** (`shell-uso-real-preflight.db.test.ts`, 7/7): veredicto correcto en N0, N1, N2, N3 sin tablas Shell, N3 + Shell (apto con limitación), N4 (apto), registro de pilotos parcial y CHECK inconsistente (`DETENER Y AUDITAR`), lectura exclusiva de `@esquema` (con otra base activa o `information_schema`), parámetros inválidos → `ESQUEMA_INVALIDO`, y prueba de solo lectura (sin DML/DDL; filas y esquema idénticos antes/después).
- Las pruebas anteriores de #641/#642 se conservan (`terceros.db.test.ts`, `empleados-baja.db.test.ts`).

## 6. Contradicciones cliente ↔ servidor
Ninguna en la matriz. Diferencias conocidas, ambas en sentido seguro (el cliente es más estricto): (1) filas Shell **sin nombre de piloto** no se pueden confirmar en el cliente; el servidor no exige decisión de nombre para un nombre vacío; (2) el cliente no conoce bloqueos propios del servidor (consumo previo, unidad en taller que el servidor revalida) — el servidor sigue siendo la autoridad.

## 7. Cómo verificar el despliegue de #642 (un merge no implica despliegue)
1. **Hostinger:** confirmar en hPanel que el despliegue activo corresponde al commit `61274ffb` o posterior (no se asume auto-despliegue desde `main`) y que el build terminó sin errores.
2. **Diagnóstico autenticado (solo lectura):** `GET /api/empresas/{slug}/flota/combustible/cb2/diagnostico`. Hoy devuelve `revisionFuncional: "cb2-identidades-independientes-v2"`, que **no cambió con #641/#642**, y `shaDeclarado` solo si alguien definió `NOVALVION_DEPLOY_SHA`. **Hallazgo:** no demuestra #642. El Draft PR **#664** agrega `revisionShell` ("cb2-shell-vales-unidades-v1"); tras desplegarlo, su presencia prueba el código.
3. **Señal de interfaz (hoy):** en un archivo Shell, el editor del vale (botón «Editar») debe mostrar «Piloto del Excel» y una línea «Unidad interna / externa / no identificada…»; un build anterior muestra el panel «Revisar pilotos por nombre distinto». Esta señal es visual y manual; no se probó contra producción.
4. **Banderas efectivas:** el mismo diagnóstico (`tercerosDirectos`, `tercerosHabilitados`) y `GET …/catalogos` (`identidadesIndependientes`, `pilotoReportadoExterno`, `pilotosReportados`, `tercerosDirectos`).

## 8. Preflight de solo lectura para producción
`sql/preflight-2026-11-cb2-shell-uso-real.sql` (phpMyAdmin → SQL; editar solo `@esquema`). Devuelve un veredicto y los hechos por objeto. **Complementa** (no reemplaza) a `preflight-2026-11-cb2-nivel-instalacion.sql`, que compara la estructura exacta por firma SHA-256: ejecutar ambos. Veredictos: `APTO PARA PREFLIGHT` (nivel 4 + tablas Shell), `APTO PARA PREFLIGHT con limitación` (nivel 3), `NO APTO: …`, `DETENER Y AUDITAR`.

## 9. Riesgos pendientes
- Estado real de Hostinger desconocido: esquema, banderas y despliegue sin verificar (esta sesión no consulta producción).
- Si `fecha_egreso` no existe en producción, los avisos de baja funcionan sin fecha.
- `CB2_PUBLIC_ORIGIN` distinto del dominio real bloquearía las altas (403).
- Dependencia de entorno del equipo de desarrollo: `main` ahora requiere `fake-indexeddb` para tests de autoguardado; el `node_modules` compartido de esta sesión no lo tiene (3 errores de `tsc` ajenos a estos cambios).
