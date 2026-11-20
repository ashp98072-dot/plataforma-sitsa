# TMS — programaciones duplicadas del 19/11/2026 (33 pares PLAN-…-001..033 vs 034..066)

Estado: **IMPLEMENTADO + VERIFICADO TÉCNICAMENTE** (pruebas unitarias y contra MariaDB 11.8.9 desechable). Este PR **no contiene ni ejecuta** ninguna operación sobre producción. Sin merge ni despliegue.

### Situación en producción (según lo informado por el responsable; no verificado por este código ni por quien lo redactó)
- El responsable informa que los **66 planes del 19/11/2026 (33 pares) fueron confirmados mediante consultas a la base de producción**, y que la **limpieza de los duplicados se realizó** fuera de este PR.
- Aquí **no se registran** ids, conteos de planes cancelados, método ni resultados de esa limpieza porque no se aportaron a este PR. Debe anexarse la evidencia del responsable (salida de R2/R3 antes y después, ids tratados, usuario y hora) antes de dar el caso por cerrado.
- Las secciones 4 y 5 describen el procedimiento previsto; **no** deben leerse como constancia de lo ejecutado.

## 1. Causa raíz (código)

Hay tres caminos que insertan en `tms_planes_viaje` un lote de planes. Los tres generan el código con «máximo del día + 1» (`src/lib/tms/codigo-plan.ts:17-36`), de modo que **un segundo lote completo del mismo día numera correlativamente 034..066**: ese patrón es lo esperable de «se insertó dos veces el mismo lote de 33», no de una colisión de códigos.

| Camino | ¿Puede entrar un 2.º lote idéntico? | Dónde |
|---|---|---|
| **Copiar programación** (`/tms/programacion/copiar/confirmar`) | **SÍ, si el origen es otro**. El único anti-duplicado es por **plan origen** (`copiasVigentesDeOrigen`, `programacion-lote.ts:237-256`, usado en `:493-494`): ve solo copias previas de *ese mismo* plan origen. No ve un viaje idéntico creado por Excel, a mano, o por la copia de **otro día** con la misma programación. Además, que la unidad/piloto ya estén ocupados en el destino **solo avisa** (decisión de copia fiel, `programacion-lote.ts:503-507`), y el aviso se acepta con la huella. | `programacion-lote.ts` |
| Importación Excel (`/tms/programacion/importar`) | No por un doble clic (el candado `tms_traslape_<empresa>` serializa y la 2.ª revalidación ve el traslape de unidad/piloto). **Pero** no hay idempotencia por archivo: `hashArchivo` solo se guarda en la auditoría (`programacion-import.ts:1013-1019`) y nunca se compara. Protege únicamente el traslape de recursos. | `programacion-import.ts:808+` |
| Alta individual / solicitudes | Protegidos: traslape bajo candado (alta) y `plan_id` bajo `FOR UPDATE` (solicitud). | `planes/route.ts`, `solicitudes-cliente-operaciones.ts:369` |

Doble clic / reintento de la **misma** copia ya estaba cubierto (prueba existente «doble confirmación»). Lo que no estaba cubierto es el **mismo contenido por otra vía**, que es exactamente lo que ven los 33 pares.

## 2. Corrección

`src/lib/tms/programacion-lote.ts` — nuevo anti-duplicado **por contenido** (`gemelosExactosEnDestino`, `claveGemelo`, regla en `resolverYValidar`): al copiar, si la fecha destino ya tiene un viaje **propio, no cancelado** con la **misma ruta + hora de carga (no nula) + unidad + piloto**, esa fila es un **error bloqueante** («Posible duplicado: … ya tiene el viaje PLAN-…») y el lote entero se rechaza (todo o nada, como el resto de errores de integridad). Misma unidad y piloto a la misma hora no pueden ser dos viajes reales.

Lo que **no** cambia: un recurso ocupado con otra hora/ruta sigue siendo solo aviso; un gemelo **Cancelado** no cuenta; tercerizados, otra fecha y otra empresa no se tocan; el anti-duplicado por origen sigue igual.

**Decisión de negocio que conviene confirmar:** esto endurece la «copia fiel» solo para el gemelo exacto. Si el propietario prefiere que siga siendo aviso, se revierte quitando el bloque marcado «anti-duplicado por CONTENIDO».

No se tocó la importación Excel ni el alta manual (ya bloquean por traslape). Pendiente opcional, **no incluido**: idempotencia por `hashArchivo` en la importación.

### Concurrencia (revisada)
`confirmarLote` toma `GET_LOCK('tms_traslape_<empresa>')` en una conexión dedicada **antes** de revalidar (incluida `gemelosExactosEnDestino`), inserta en otra conexión con transacción, hace `COMMIT` y **solo después** (bloque `finally`) libera el candado. Por eso una 2.ª confirmación simultánea espera, y cuando obtiene el candado ya ve los planes confirmados de la 1.ª: la consulta inicial **por sí sola no** da exclusividad; la da el candado, que es el mismo que usan el alta manual y la importación Excel. Si no se obtiene en 8 s → 409 sin escribir. Probado: 2 confirmaciones simultáneas del mismo lote, 2 de orígenes distintos con contenido idéntico, orden `GET_LOCK → COMMIT → RELEASE_LOCK`, un control (sin exclusión el duplicado sí entra) y, en MariaDB real, que el 2.º `GET_LOCK` espera y tras `COMMIT + RELEASE_LOCK` ve el viaje. No se encontró una carrera real que corregir en el flujo de copia.

Atomicidad: el rechazo por «Posible duplicado» ocurre antes de abrir la transacción (no escribe nada). Un fallo a mitad de inserción hace rollback total (planes, auxiliares, paradas, viáticos, orígenes y auditoría); probado, y el mismo lote se puede reintentar después.

## 3. Pruebas

- `src/lib/tms/programacion-lote.test.ts` (191/191, incluye concurrencia, atomicidad y normalización): «REGRESIÓN 33 pares» (un lote de 33 se crea; el mismo lote desde otro día origen se rechaza completo: 33 errores, 0 planes nuevos); gemelo sin `tms_plan_origen` (Excel/manual) bloqueado nombrando el código; y 7 casos **negativos** que prueban que NO se suponen duplicados (gemelo cancelado, otra hora, otra unidad, otro piloto, otra ruta, otra fecha, otra empresa). Sin la corrección, las 2 pruebas de regresión fallan (comprobado).
- `src/lib/tms/programacion-duplicada.db.test.ts` (5/5, MariaDB 11.8.9 real): el SQL real de `gemelosExactosEnDestino` y el diagnóstico de solo lectura (33 pares, relaciones, auditoría, sin modificar filas, parámetros inválidos, sin escrituras).
- `tsc --noEmit` limpio; ESLint limpio en los 3 archivos. En `src/lib/tms` + `src/app/api/empresas` hay 9 archivos de prueba que fallan (p. ej. `programacion-tc`, `gastos/catalogos`, `cotizacion-doble-eje-sql`); fallan **igual con el `programacion-lote.ts` original** (comprobado en 3 de ellos, 24 pruebas) y no importan este módulo: ajenos a este cambio.

## 4. Evidencia

- **Confirmado por código:** los tres hechos de la tabla anterior.
- **No confirmado por este PR** (solo por la verificación en producción que informa el responsable, ver encabezado): que los 66 registros existan físicamente como filas distintas, cuál camino los creó y quién.
- Hecho a tener en cuenta: `tms_planes_viaje` **no tiene `creado_en`/`creado_por`**. Hora y usuario de creación salen de `tms_plan_origen` (copias) y de la auditoría del lote (`copiar_programacion`/`importar_programacion`).

### Cómo comprobarlo (solo lectura)
Ejecute en phpMyAdmin `sql/diagnostico-2026-11-tms-programacion-duplicada.sql` (solo `SELECT`/`SET`/`PREPARE` de `SELECT`; ajuste `@fecha`, y `@empresa` si quiere limitarlo). Devuelve:
1. **R1** resumen del día por empresa/estado.
2. **R2** los pares con IDs reales, estado, hora, unidad, auxiliares, y para cada lado `tms_plan_origen` (tipo, plan y **fecha origen**, usuario, hora). Compare: ¿el lado `b` tiene origen `COPIA` y el `a` no? ¿de qué fecha origen?
3. **R3** relaciones de cada plan (paradas, auxiliares, viáticos, evidencias, gastos, viaje de Flota, **factura**, liquidación, cargos, solicitud).
4. **R4** auditoría del lote (usuario, hora, tipo: copiar/importar).

Cómo leerlo: si en los 33 pares el 034..066 tiene `origen_b_tipo = COPIA` con `origen_b_fecha` ≠ 19/11 y el 001..033 no tiene origen → copia sobre un día que ya existía (camino 1). Si ninguno tiene origen y R4 muestra una importación → camino 2. Dos filas con la misma ruta pero distinta hora/unidad/piloto **no** aparecen como par.

## 5. Propuesta de limpieza supervisada (NO ejecutada; solo si R2–R4 lo confirman)

Criterio para llamar «copia» a un plan (todos a la vez): (a) es el de **mayor id** del par, (b) estado `Programado` (sin salida, sin cierre), (c) **R3 en cero** en todo (sin factura, gasto, evidencia, viaje de Flota, liquidación, viáticos pagados), (d) R2 muestra datos idénticos, (e) **el otro plan del par sí se conserva** y está completo. Un plan con cualquier relación **no se toca**: se revisa a mano.

Mecanismo recomendado: **cancelar con la pantalla/acción normal de la aplicación**, plan por plan (conserva historial y auditoría; `Cancelado` no cuenta para disponibilidad ni para el anti-duplicado). **No** `DELETE`. Pasos: 1) respaldo previo de las tablas del plan; 2) el responsable de Operaciones aprueba la lista de ids derivada de R2/R3; 3) cancelar; 4) re-ejecutar R2 (los cancelados quedan visibles con su estado) y confirmar que los 33 conservados siguen `Programado` con sus relaciones. Reversión: reabrir/duplicar según el flujo vigente, usando el respaldo si hiciera falta.

Si en algún par ambos tienen relaciones, o no hay origen que indique cuál es la copia, **detenerse y decidir con Operaciones** cuál conservar.

## 6. Límites que permanecen
- **Importación Excel:** sin idempotencia por archivo (`hashArchivo` solo en auditoría) ni anti-duplicado por contenido; depende solo del traslape de recursos (que ignora piloto/unidad aún no existentes en TMS en la primera carga). No se modificó.
- **Dentro de un mismo lote de copia**, dos filas idénticas siguen siendo un aviso aceptable (decisión de copia fiel con prueba existente), no un bloqueo. Copiar un día que ya contiene duplicados puede, por tanto, replicarlos si el usuario acepta los avisos. Cambiarlo es decisión de negocio.
- **Ediciones (PATCH):** cambiar hora/unidad/piloto de un plan existente hasta igualar a otro no pasa por esta regla.
- **Piloto sin `id_empleado`** en `tms_personal` (registros antiguos) y **placas escritas distinto** que no resuelven a la misma unidad no se detectan como gemelo.
- No hay índice único en base de datos para esta regla (requeriría una migración; no se hizo).
- Tercerizados y filas sin hora, unidad o piloto no se evalúan (por diseño: no se suponen duplicados).
- Confirmar con el propietario que el gemelo exacto **bloquee** en vez de solo avisar (§2).
- Falta anexar la evidencia de la limpieza ya realizada (ver el encabezado).
