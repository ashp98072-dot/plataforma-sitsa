# Programación — filtro por rango de fechas

BASE: `601991e4a14ea23b08ef963c875a7e2c4779c12f`.
Rama: `codex/programacion-rango-fechas`.

## Discovery y decisiones

- `ProgramacionClient` ya dispone de `rangoFechas(hoy, rango, fechaSeleccionada)`: Hoy, Mañana, Semana (hoy + 6 días) y Fecha. Por defecto abre en Mañana.
- Listado: `GET /api/empresas/[slug]/tms/planes?fechaDesde=...&fechaHasta=...`. Acepta ambos extremos y usa BETWEEN inclusivo, pero mantiene LIMIT 200.
- Pendientes: segunda petición paralela con `pendienteCierre=1`, sin límite ni fechas por diseño histórico.
- Excel/PDF: `/tms/programacion/reporte`, mismos extremos/filtros pero sin LIMIT 200. PNG/JPG se construyen desde las filas `visibles`.
- Solo `plan` se leía desde URL; fechas y filtros no se persistían. No existía otro helper de rango personalizado que hubiera que sustituir.
- Negocio autorizó explícitamente: **solo Rango sin LIMIT 200** y **Pendiente de cierre acotado por fechas en Rango**. Los modos anteriores conservan sus reglas.

## Implementación

Se agrega Rango al selector existente, con Desde/Hasta y campos de fecha obligatorios. Inicialmente usa hoy/hoy, o los extremos de la URL. Conserva los extremos elegidos al alternar de modo, pero no los aplica fuera de Rango.

`rangoFechas` mantiene los tres argumentos anteriores y recibe un cuarto argumento opcional con el intervalo. Todas las cargas/recargas y exportaciones consumen los mismos `desde/hasta` derivados; no hay un eje independiente para exportar.

`src/lib/tms/programacion-rango.ts` contiene el contrato de intervalo, validación pura compartida por cliente/endpoints y serialización/restauración de URL. Valida presencia, formato, fecha real y desde <= hasta, sin zona horaria del navegador. No establece máximo de días.

### URL

Ejemplo: `/e/empresa/programacion?desde=2026-12-31&hasta=2027-01-02`.

- La página del servidor entrega los extremos como estado inicial, sin consultar la BD ni crear otra fuente de fechas.
- Los cambios aceptados serializan ese estado con `history.replaceState`, integrado con App Router y sin recarga/RSC adicional.
- Al salir de Rango se eliminan ambos parámetros. Se preservan parámetros ajenos y hash.
- Un parámetro incompleto activa Rango inválido: muestra error, no cae silenciosamente a Mañana ni consulta un historial sin extremos.
- No se agrega persistencia nueva de Estado/Piloto/Unidad/Cliente: mantienen su comportamiento anterior. El rango sí se conserva al recargar/compartir.
- `plan` sigue abriendo el editor puntual; si hay intervalo explícito en la URL, no lo sustituye automáticamente por Hoy/Mañana/Semana.

### Backend compatible

Se reutilizan los dos endpoints actuales; no hay ruta nueva:

- Solo peticiones con `rango=1` exigen ambos extremos válidos y habilitan el listado completo del intervalo.
- Sin esa marca se mantiene LIMIT 200 y el contrato previo.
- En Rango se envían extremos también a la petición de pendientes; se conserva la condición existente de pendiente.
- Excel/PDF con `rango=1` aplican las fechas incluso con PendienteCierre y excluyen Cerrados, igual que el tablero. Los reportes anteriores no cambian.
- No cambian guards, tenant, empresa, enriquecimiento de filas, SQL de escritura, POST/PATCH, disponibilidad, locks ni viáticos.

### Exportaciones y edición

- Excel y PDF usan el mismo `reporteQueryString`, incluidos rango/Estado/Piloto/Unidad/Cliente.
- PNG y JPG siguen tomando `visibles`, incluidos los mismos filtros y snapshots Propio/Tercerizado.
- Con intervalo inválido no se hacen cargas; no se muestran filas de ese intervalo y no se exporta. Al entrar/cambiar Rango se bloquea exportación desde el handler hasta completar la carga, evitando exportar el conjunto anterior antes del efecto.
- La secuencia de cargas existente invalida respuestas anteriores cuando se invalida el intervalo.
- La procedencia `rangoCompleto` se actualiza junto a la respuesta aplicada y registra si corresponde a una lectura completa del intervalo actual. No es otro filtro: impide habilitar exportación con una respuesta limitada/antigua incluso si un `finally` anterior ya quitó `loading`.
- En Rango, si falla la lectura de pendientes o su respuesta es incompleta, la carga no se certifica y muestra error; así no se habilita exportar un conjunto que no llegó completo. Los modos anteriores conservan su degradación histórica de pendientes a vacío.
- Cambios de modo y extremos pasan por `siSePuedenPerderCambios`: si se cancela la confirmación del borrador de Edición rápida, no cambia estado ni URL.
- No se modifican PlanForm, EdicionRapida, Copiar programación, cierres, solicitudes ni viáticos. Se conserva la lógica existente después de guardar; si automáticamente cambia a Semana, se retira el rango de la URL.

## Pruebas y alcance de validación

- Casos de un día/igualdad, varios días, cruces de mes/año, calendario inválido, extremos vacíos e invertidos.
- URL, recarga real de la función page, parámetros incompletos/repetidos, limpieza de URL al cambiar de modo.
- Ejecución de funciones/callbacks reales extraídos del AST: filtros combinados, vacío, Propio/Tercerizado, vehículo solicitado, URL Excel/PDF, guard PNG/JPG, handlers con confirmación aceptada/cancelada, recargas/polling invalidado y pendientes acotados.
- Endpoint GET: tenant, parámetros, 400 antes de leer datos, intervalo inclusivo, más de 200 filas, compatibilidad de modos anteriores.
- Reporte: Excel/PDF con rango + pendientes + filtros, rechazo de intervalo inválido y compatibilidad sin marca.
- Tests existentes de Programación, formularios, Edición rápida y exportaciones. Se actualizan únicamente los contratos textuales afectados por el quinto modo/guard de exportación.
- Los tests no conectan producción. No se afirma QA interactiva con una sesión real ni benchmark de latencia productiva.

### Validación final

- **60 pruebas nuevas aprobadas**: fechas/URL, UI y handlers reales, listado y reportes.
- Dirigidas Programación/formulario/Edición rápida/fechas/exportaciones: **544 pass / 1 fail heredado** (`programacion-exportar-imagen-wiring`: imports de otros módulos; mismo archivo/nombre/mensaje que BASE).
- Suite completa BASE: **10.866 pass / 22 fail / 599 skip**.
- Suite completa HEAD: **10.926 pass / 22 fail / 599 skip**.
- Comparación por archivo relativo + `fullName` + mensaje principal: **idénticos 22 fallos**, sin fallos nuevos/eliminados ni suites fallidas sin assertions. **Cero regresiones nuevas**.
- TypeScript, ESLint dirigido de los 12 archivos TS/TSX, diff-check y builds BASE/HEAD: correctos. Se conservan avisos heredados de middleware, Cache-Control y tracing de filesystem.
- Una pasada concurrente con build agotó los ~5 s de un escaneo de archivos de `contabilidad/factura-emitida.test.ts`. Pasó aislado (24/24) y no se repitió en la suite final sin build paralelo. No se modificó ese test ni se ampliaron timeouts.
- Los 22 fallos heredados incluyen los guards históricos de Compras, contrato de esquema Vacaciones, `unzip` ausente, Centro logístico, contratos de fuente de vehículo solicitado/imagen/Atracción talento y PATCH de Programación/TC/regreso. No se corrigieron en este ticket.
- POST/PATCH de viajes se compararon contra BASE y permanecen idénticos; PlanForm, EdicionRapida, Copiar programación, viáticos y `sql/` no tienen cambios.

### Archivos (13)

- Frontend: `src/app/e/[slug]/programacion/page.tsx`, `src/app/e/[slug]/programacion/programacion-client.tsx`.
- Helper compartido y tests: `src/lib/tms/programacion-rango.ts`, `src/lib/tms/programacion-rango.test.ts`.
- Listado: `src/app/api/empresas/[slug]/tms/planes/route.ts`, `src/app/api/empresas/[slug]/tms/planes/route.test.ts`.
- Reporte: `src/app/api/empresas/[slug]/tms/programacion/reporte/route.ts`, `src/app/api/empresas/[slug]/tms/programacion/reporte/route.test.ts`.
- Pruebas UI/contratos: `src/app/e/[slug]/programacion/programacion-rango-ui.test.ts`, `src/app/e/[slug]/programacion/programacion-filtro-fecha.test.ts`, `src/app/e/[slug]/programacion/programacion-exportar-imagen-wiring.test.ts`, `src/lib/tms/plan-form-cambios.test.ts`.
- Documentación: este archivo.

## Riesgos / QA posterior

No se impone un límite nuevo: Rango puede cargar muchos viajes. Se conservan el polling de 30 s y el mecanismo de disponibilidad por fecha única, por lo que un intervalo amplio puede aumentar payload, render, número de consultas/peticiones por día y tamaño del canvas/exportaciones. No se introduce paginación ni se cambia disponibilidad en este ticket. Conviene probar un rango operativo representativo antes de elegir intervalos de años.

QA manual pendiente con sesión autorizada: abrir Rango, validar mensajes, compartir URL, combinar filtros, descargar Excel/PDF/PNG/JPG, cambiar a Hoy/Semana y verificar cancelación de cambio cuando existe un borrador de Edición rápida.

Sin esquema/migraciones, SQL productivo, datos reales ni merge. Checkout principal y cambios ajenos preservados.
