# Mantenimiento técnico — ronda 3 ultra conservadora

Base exacta: `af736097db37bc3255a44be3b9cf99c07218b353`.
Rama: `codex/mantenimiento-tecnico-ronda3`.

## Discovery primero: ESLint global BASE

1.700 archivos TS/TSX revisados: 42 errores / 2 warnings. Ningún autofix ni cambio de configuración.

| Clase | Diagnósticos BASE | Decisión |
| --- | --- | --- |
| A — seguro, implementado | 2 no-unused-vars: _omitido en tests de Prestaciones POST/PATCH | Sustituir únicamente la preparación del fixture negativo por copia local tipada Partial + delete de codigoConcepto en la copia. Aserción de ausencia real. Sin handlers ni producción modificados. |
| B — no implementado | 2 react/no-unescaped-entities en components/flota/vehiculo-documentos.tsx | Son errores, NO los dos warnings. No editar JSX ni texto; no se intenta una corrección de render en esta ronda. |
| C — no tocar | 34 react-hooks/set-state-in-effect y 6 react-hooks/refs | No cambios de efectos, dependencias, refs, memoización, estado ni ciclo de render. |

No se amplía el recorte con helpers, ramas supuestamente muertas, comentarios o archivos aparentemente obsoletos. No hay borrados de archivos ni cambios secundarios para aumentar el PR.

## Archivos (solo dos tests y este reporte)

- src/app/api/empresas/[slug]/rrhh/prestaciones/route.test.ts
- src/app/api/empresas/[slug]/rrhh/prestaciones/[id]/route.test.ts
- docs/MANTENIMIENTO-TECNICO-RONDA3.md

No se modifican route.ts ni otros archivos de producción. Tampoco SQL, queries, migraciones, contratos HTTP, permisos, auditoría, cálculos, validaciones, concurrencia, hooks, UI, dependencias/package files, AGENTS.md ni catalogos-nomina.ts. Worktree nuevo; checkout original y cambios ajenos preservados.

## Cambio y equivalencia de los fixtures

Antes: destructuring de codigoConcepto hacia un binding descartado _omitido, seguido del rest sinCodigo.

Después: copiar bodyValido/patchValido a sinCodigo (Partial solo local al test), borrar codigoConcepto únicamente en esa copia y comprobar `expect(sinCodigo).not.toHaveProperty("codigoConcepto")`. No se sustituye ausencia por undefined ni null. Los mismos handlers reciben el mismo request. No se agregan tests con nuevos nombres, no se cambian las expectativas de estado/respuesta ni los 22 tests heredados fallidos.

Los fixtures son objetos literales propios con cinco campos de valores primitivos, sin getters, proxies ni símbolos. No se extrae un helper genérico ni se afirma equivalencia para objetos arbitrarios.

Comprobación aislada BASE vs HEAD:
1. Leer las fuentes originales con git show BASE:ruta y las de HEAD.
2. Extraer y exigir que el literal bodyValido/patchValido sea idéntico.
3. Ejecutar solo el literal y la preparación sinCodigo de cada versión en VM aislada, transpileModule de TypeScript (ES2017 / ESNext); no importar ni ejecutar handlers/BD.
4. Comparar mediante deepStrictEqual: Reflect.ownKeys, orden, Object.getOwnPropertyDescriptors, prototipo ordinario, JSON.stringify de sinCodigo y del PATCH con el mismo override tipo.
5. Exigir que el fixture original siga intacto y conserve su codigoConcepto.

Resultado: equivalentes los dos casos. JSON negativo de POST (también base de PATCH):
```json
{"empleadoId":7,"tipo":"Bonificación anual julio","monto":500,"fecha":"2026-09-01"}
```

JSON final PATCH (override ya existente, no modificado):
```json
{"empleadoId":7,"tipo":"Nuevo label distinto","monto":500,"fecha":"2026-09-01"}
```

Producción: diff de src excluyendo *.test.ts vacío. No es pertinente afirmar que el JS de los tests sea idéntico: cambia su preparación local y se añade la aserción. Las fuentes/runtime de aplicación no se modifican; no se toca render/JSX, por lo que no se necesita nueva prueba DOM. Se reutilizan las pruebas HTTP existentes para verificar la salida con los mismos requests.

## Validación BASE / HEAD

Misma máquina, Node v24.18.0 / npm 11.16.0; dependencias y configuración intactas. BASE completado antes de editar. Suite completa sin build ni ESLint concurrentes por este ticket, para evitar el timeout de recorrido de archivos constatado en ronda 2. Sin cambio de timeouts ni modificaciones a tests heredados. Informes temporales en node_modules (ignorados).

| Comprobación | BASE | HEAD |
| --- | --- | --- |
| ESLint global src | 42 errores / 2 warnings | 42 errores / 0 warnings |
| ESLint dos archivos tocados | 0 errores / 2 warnings | 0 errores / 0 warnings |
| tsc --noEmit | OK | OK |
| git diff --check | OK | OK |
| Prestaciones lib/API dirigidas | 26 pass / 0 fail / 0 skip | 26 pass / 0 fail / 0 skip |
| Suite completa | 10.657 pass / 22 fail / 554 skip | 10.657 pass / 22 fail / 554 skip |
| npm run build | OK | OK en repetición sin cambios |
| Equivalencia de ambos fixtures | Oráculo BASE | OK |

Comandos:
- `node node_modules/eslint/bin/eslint.js src --format json --output-file node_modules/.ronda3-eslint-{base,head}.json`; dirigido con los dos paths anteriores.
- `npx tsc --noEmit`, `git diff --check`, `npm run build`.
- `node node_modules/vitest/vitest.mjs run src/lib/rrhh/prestaciones 'src/app/api/empresas/[slug]/rrhh/prestaciones' --maxWorkers=4 --reporter=json --outputFile=node_modules/.ronda3-dirigidas-{base,head}.json`.
- `node node_modules/vitest/vitest.mjs run --maxWorkers=4 --reporter=json --outputFile=node_modules/.ronda3-tests-{base,head}.json`.

Incidencia local de build: el primer HEAD compiló y terminó TypeScript, pero el proceso terminó con código Windows -1073741819 (0xC0000005) durante Collecting page data, sin diagnóstico de fuente. No se aprobó esa ejecución ni se modificó código/configuración para ocultarla. Se repitió exactamente npm run build y terminó correctamente; después pasaron las 26 dirigidas y se ejecutó la suite completa. No se atribuye una causa técnica más específica sin stack/diagnóstico nativo.

Comparación final: CERO REGRESIONES NUEVAS. Los 22 fallos coinciden exactamente por archivo + fullName + mensaje principal, sin fallos adicionales, ausentes ni suites fallidas sin tests. Los dos archivos modificados no contienen ninguno de esos tests fallidos. ESLint elimina únicamente los dos no-unused-vars y no introduce diagnósticos nuevos. Los informes JSON quedan ignorados bajo node_modules, no incorporados al PR.

### Los 22 fallos comunes BASE / HEAD, por archivo + fullName + mensaje principal

1. `src/components/tms/centro-logistico-resumen.test.ts` — Centro logístico: navegación y resumen visual presenta el título y las secciones en el orden requerido
   Mensaje principal: AssertionError: expected false to be true // Object.is equality

2. `src/lib/compras/contratos.test.ts` — no modifica RRHH, credenciales ni esquema SQL
   Mensaje principal: AssertionError: expected true to be false // Object.is equality

3. `src/lib/compras/requerimiento-ui.test.ts` — ajuste transversal sin SQL, RRHH, programación ni credenciales
   Mensaje principal: AssertionError: expected true to be false // Object.is equality

4. `src/lib/tms/programacion-import-excel.test.ts` — generarPlantillaProgramacion define named ranges de libro para los 3 catálogos usados en dropdowns
   Mensaje principal: Error: Command failed: unzip -p "C:/Users/Admin/AppData/Local/Temp/claude/xlsxtest/plantilla-programacion-test.xlsx" xl/workbook.xml

5. `src/lib/tms/vehiculo-solicitado.test.ts` — catálogo reutilizado: perfiles de costeo por empresa GET /tms/catalogos lo expone (aditivo) con la empresa de la sesión
   Mensaje principal: AssertionError: expected 'import { NextResponse } from "next/se…' to match /personal,\n\s+vehiculosSolicitables,/

6. `src/lib/rrhh/vacaciones-sync-invalida.test.ts` — contratos de invalidación y esquema migración aditiva coincide exactamente con schema y protege tenant por FK compuesta
   Mensaje principal: AssertionError: expected '-- Plataforma corporativa multiempres…' to contain 'CREATE TABLE IF NOT EXISTS rrhh_vacac…'

7. `src/app/e/[slug]/programacion/programacion-exportar-imagen-wiring.test.ts` — programacion-client.tsx — Exportar imagen «Exportar imagen» solo existe en Programación — ningún otro módulo importa programacion-exportar-imagen ni programacion-imagen
   Mensaje principal: AssertionError: expected [ …(2) ] to deeply equal []

8. `src/app/e/[slug]/atraccion-talento/reportes/page.test.ts` — ATRACCION-TALENTO-1/2 — closure de filtros en cargar() 38) el montaje inicial sigue siendo una sola carga: el useEffect que llama cargar() al montar tiene deps [] — cambiar un filtro por sí solo NO dispara fetch
   Mensaje principal: AssertionError: expected -1 to be greater than -1

9. `src/app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts` — PATCH — editar el TC de un viaje PROPIO editar OTROS campos conserva el TC (no reescribe las columnas TC) y el propio plan se autoexcluye de la validación
   Mensaje principal: AssertionError: expected 400 to be 200 // Object.is equality

10. `src/app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts` — PATCH — editar el TC de un viaje PROPIO el mismo TC enviado de nuevo no se re-valida (ni por taller) ni se reescribe
   Mensaje principal: AssertionError: expected 400 to be 200 // Object.is equality

11. `src/app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts` — PATCH — editar el TC de un viaje PROPIO cambiar de TC valida el nuevo (acceso + clasificación) y reescribe id + fotografía
   Mensaje principal: AssertionError: expected 400 to be 200 // Object.is equality

12. `src/app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts` — PATCH — editar el TC de un viaje PROPIO cambiar a un TC ya asignado ese día a OTRO plan -> 409 (backend, no solo UI)
   Mensaje principal: AssertionError: expected 400 to be 409 // Object.is equality

13. `src/app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts` — PATCH — editar el TC de un viaje PROPIO cambiar la fecha del plan revalida el TC contra la NUEVA fecha
   Mensaje principal: AssertionError: expected 400 to be 409 // Object.is equality

14. `src/app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts` — PATCH — editar el TC de un viaje PROPIO tcVehiculoId: null quita el TC
   Mensaje principal: AssertionError: expected 400 to be 200 // Object.is equality

15. `src/app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts` — PATCH — TC de un viaje TERCERIZADO y cambio de tipo edición conserva/actualiza el snapshot externo (tcExternoPlaca en mayúsculas) sin tocar el catálogo interno
   Mensaje principal: AssertionError: expected 400 to be 200 // Object.is equality

16. `src/app/api/empresas/[slug]/tms/planes/programacion-viajes-tercerizados.test.ts` — PATCH /tms/planes — patchTipoViaje: cambio de tipo aislado un PATCH sin tipoViaje sigue el flujo normal (no entra a patchTipoViaje, no dispara su SELECT dedicado)
   Mensaje principal: AssertionError: expected 400 to be 200 // Object.is equality

17. `src/app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts` — PATCH /tms/planes — editar y dejar el regreso estimado en null regresoEstimado: null con piloto asignado no da 400 y guarda NULL (sin inventar una hora)
   Mensaje principal: AssertionError: expected 400 to be 200 // Object.is equality

18. `src/app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts` — PATCH /tms/planes — editar y dejar el regreso estimado en null un plan que ya no tenía regreso estimado se puede seguir editando sin exigirlo
   Mensaje principal: AssertionError: expected 400 to be 200 // Object.is equality

19. `src/app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts` — PATCH /tms/planes — editar y dejar el regreso estimado en null al editar sin regreso estimado, se valida la fecha efectiva
   Mensaje principal: TypeError: Cannot read properties of undefined (reading 'sql')

20. `src/app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts` — PATCH /tms/planes — editar y dejar el regreso estimado en null editar y dejar null conserva la validación por empresa y excluye al propio plan
   Mensaje principal: TypeError: Cannot read properties of undefined (reading 'sql')

21. `src/app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts` — PATCH /tms/planes — editar y dejar el regreso estimado en null editar y conflicto con un viaje abierto de OTRO plan del mismo piloto: 409
   Mensaje principal: AssertionError: expected 400 to be 409 // Object.is equality

22. `src/app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts` — identidad de personal por empleado — POST y PATCH usan la misma regla PATCH: al mover el viaje, el piloto (personal 12, empleado 55) choca con un viaje donde el mismo empleado es Auxiliar (personal 10): 409
   Mensaje principal: AssertionError: expected 400 to be 409 // Object.is equality

## Índice individual de diagnósticos ESLint BASE

Todos quedan cubiertos por las decisiones anteriores; líneas referidas a BASE.

| Clase | Archivo/línea | Regla |
| --- | --- | --- |
| A | src/app/api/empresas/[slug]/rrhh/prestaciones/[id]/route.test.ts:74 | @typescript-eslint/no-unused-vars |
| A | src/app/api/empresas/[slug]/rrhh/prestaciones/route.test.ts:70 | @typescript-eslint/no-unused-vars |
| C | src/app/e/[slug]/cms/page.tsx:26 | react-hooks/set-state-in-effect |
| C | src/app/e/[slug]/flota/flota-client.tsx:529 | react-hooks/set-state-in-effect |
| C | src/app/e/[slug]/flota/flota-client.tsx:533 | react-hooks/set-state-in-effect |
| C | src/app/e/[slug]/flota/flota-client.tsx:590 | react-hooks/set-state-in-effect |
| C | src/app/e/[slug]/flota/flota-client.tsx:931 | react-hooks/set-state-in-effect |
| C | src/app/e/[slug]/flota/flota-client.tsx:946 | react-hooks/set-state-in-effect |
| C | src/app/e/[slug]/flota/flota-client.tsx:963 | react-hooks/set-state-in-effect |
| C | src/app/e/[slug]/flota/flota-client.tsx:974 | react-hooks/set-state-in-effect |
| C | src/app/e/[slug]/flota/flota-client.tsx:994 | react-hooks/set-state-in-effect |
| C | src/app/e/[slug]/reciclaje/page.tsx:30 | react-hooks/set-state-in-effect |
| C | src/app/e/[slug]/rrhh/centros-costo/page.tsx:34 | react-hooks/set-state-in-effect |
| C | src/app/e/[slug]/rrhh/configuracion/page.tsx:42 | react-hooks/set-state-in-effect |
| C | src/app/e/[slug]/rrhh/en-ruta/page.tsx:44 | react-hooks/set-state-in-effect |
| C | src/app/e/[slug]/rrhh/inventario/page.tsx:168 | react-hooks/set-state-in-effect |
| C | src/app/e/[slug]/rrhh/marcajes/manual/page.tsx:198 | react-hooks/set-state-in-effect |
| C | src/app/e/[slug]/rrhh/marcajes/manual/page.tsx:202 | react-hooks/set-state-in-effect |
| C | src/app/e/[slug]/rrhh/marcajes/manual/page.tsx:221 | react-hooks/set-state-in-effect |
| C | src/app/e/[slug]/rrhh/planillas/page.tsx:191 | react-hooks/set-state-in-effect |
| C | src/app/e/[slug]/rrhh/recordatorios/page.tsx:92 | react-hooks/set-state-in-effect |
| C | src/app/e/[slug]/rrhh/ubicaciones-marcaje/page.tsx:65 | react-hooks/set-state-in-effect |
| C | src/app/e/[slug]/tarimas/page.tsx:29 | react-hooks/set-state-in-effect |
| C | src/components/facturacion/facturacion-client.tsx:104 | react-hooks/set-state-in-effect |
| C | src/components/facturacion/facturacion-client.tsx:141 | react-hooks/set-state-in-effect |
| C | src/components/facturacion/facturacion-client.tsx:202 | react-hooks/set-state-in-effect |
| C | src/components/flota/inventario-equipo.tsx:158 | react-hooks/set-state-in-effect |
| C | src/components/flota/inventario-equipo.tsx:166 | react-hooks/set-state-in-effect |
| C | src/components/flota/tomar-foto.tsx:41 | react-hooks/set-state-in-effect |
| C | src/components/flota/vehiculo-documentos.tsx:96 | react-hooks/set-state-in-effect |
| B | src/components/flota/vehiculo-documentos.tsx:201 | react/no-unescaped-entities |
| B | src/components/flota/vehiculo-documentos.tsx:201 | react/no-unescaped-entities |
| C | src/components/operaciones/disponibilidad-client.tsx:77 | react-hooks/set-state-in-effect |
| C | src/components/rrhh/bitacora-legal-empleado.tsx:48 | react-hooks/set-state-in-effect |
| C | src/components/rrhh/documentos-modal.tsx:121 | react-hooks/set-state-in-effect |
| C | src/components/rrhh/evidencias-modal.tsx:51 | react-hooks/set-state-in-effect |
| C | src/components/rrhh/solicitudes-vacaciones-panel.tsx:69 | react-hooks/set-state-in-effect |
| C | src/components/theme-toggle.tsx:18 | react-hooks/set-state-in-effect |
| C | src/lib/empresa-session.tsx:55 | react-hooks/refs |
| C | src/lib/empresa-session.tsx:56 | react-hooks/refs |
| C | src/lib/empresa-session.tsx:57 | react-hooks/refs |
| C | src/lib/empresa-session.tsx:58 | react-hooks/refs |
| C | src/lib/empresa-session.tsx:60 | react-hooks/refs |
| C | src/lib/empresa-session.tsx:64 | react-hooks/refs |

## Riesgos y pendientes

Riesgo bajo: solo fixtures sintéticos de tests, con igualdad del objeto final y su JSON; no hay runtime productivo modificado. No se cambia arquitectura para bajar diagnósticos. Los 42 errores (40 hooks/refs y dos JSX) y los fallos heredados quedan para tickets independientes. Se conservan avisos preexistentes de build de middleware deprecado, Cache-Control y filesystem tracing en archivos ajenos.

No SQL, migraciones, datos reales, QA productivo ni merge.
