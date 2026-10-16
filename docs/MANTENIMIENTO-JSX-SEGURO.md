# Mantenimiento técnico — JSX seguro

## Alcance

Base exacta: `31338b251d2fbdaabc5476820ec81f658f7fdffd`.
Rama: `codex/mantenimiento-jsx-seguro`. No SQL, migraciones, datos ni merge.

Único cambio de aplicación: escape técnico de dos comillas en
`src/components/flota/vehiculo-documentos.tsx:201` (columnas BASE 30 y 35).
El editor también agrega el salto de línea final ausente; no tiene efecto runtime.

- JSX BASE: `Título (para "Otro")`
- JSX HEAD: `Título (para &quot;Otro&quot;)`
- Texto visible BASE y HEAD: `Título (para "Otro")`
- HTML React BASE y HEAD: `Título (para &quot;Otro&quot;)`

Clasificación A: escape JSX con equivalencia demostrada. No se modificaron
estructura funcional, hooks, efectos, refs, estado, handlers, condiciones,
permisos, validaciones, APIs, cálculos ni textos visibles.

## Evidencia de equivalencia

`src/components/flota/vehiculo-documentos-texto.test.ts` contiene dos pruebas:

1. Congela el nodo JSX original, incluidos sus espacios/saltos, y verifica el
   texto y HTML producidos por TypeScript JSX y ReactDOMServer.
2. Extrae por AST el nodo real del componente y compara su render con BASE.

No se normaliza ni recorta el resultado renderizado. No se monta el componente,
no se invocan hooks ni se simulan APIs. Se prueba el nodo afectado con el
runtime JSX y renderer reales.

Además se comparó el JavaScript emitido del componente COMPLETO en BASE/HEAD
con TypeScript (ReactJSX, ESNext, ES2017), normalizando únicamente CRLF/LF de
entrada: igualdad exacta. SHA-256 común:

`4f2cbe91618b72481845140908ef60f399daa6332a5bbcf3261a382d5ef4772f`

## Validación BASE / HEAD

Mismo worktree, Node 24.18.0, npm 11.16.0 y dependencias, sin cambios de
package files. Suites completas ejecutadas sin competir con lint/build.

| Validación | BASE | HEAD |
| --- | --- | --- |
| ESLint global | 42 errores / 0 warnings | 40 errores / 0 warnings |
| ESLint componente | 3 errores | 1 error |
| ESLint prueba nueva | No existía | Limpio |
| Flota/componentes/API dirigidas | 549 pass / 0 fail / 72 skip | 551 pass / 0 fail / 72 skip |
| Suite completa | 10657 pass / 22 fail / 554 skip | 10659 pass / 22 fail / 554 skip |
| TypeScript `--noEmit` | OK | OK |
| `git diff --check` | OK | OK |
| `npm run build` | OK | OK |

ESLint eliminó únicamente los dos `react/no-unescaped-entities` de la línea
201, sin agregar diagnósticos. El `react-hooks/set-state-in-effect` de la
línea 96 permanece deliberadamente intacto. ESLint global/archivo conservan
exit 1 por diagnósticos heredados; no se presentan como limpios.

Comandos principales:

```text
node node_modules/eslint/bin/eslint.js . --format json --output-file node_modules/.jsx-eslint-{base,head}.json
node node_modules/eslint/bin/eslint.js src/components/flota/vehiculo-documentos.tsx
node node_modules/eslint/bin/eslint.js src/components/flota/vehiculo-documentos-texto.test.ts
npx tsc --noEmit
node node_modules/vitest/vitest.mjs run src/lib/flota "src/app/api/empresas/[slug]/flota" src/components/flota --maxWorkers=4
node node_modules/vitest/vitest.mjs run --maxWorkers=4 --reporter=json --outputFile=node_modules/.jsx-tests-{base,head}.json
git diff --check
npm run build
```

Los nombres entre llaves identifican ejecuciones separadas, no argumentos
literales. Reportes temporales permanecen ignorados dentro de node_modules.

El build conserva avisos previos de middleware/Cache-Control y cuatro avisos
de tracing de filesystem en rutas ajenas. No se corrigieron en este ticket.

## Comparación de fallos heredados

Comparación por archivo + fullName + primera línea del mensaje de fallo:
22 identidades iguales, ninguna agregada o eliminada, ninguna suite fallida
sin assertions. **CERO REGRESIONES NUEVAS**. No se modificaron estos tests.

### 1. `src/components/tms/centro-logistico-resumen.test.ts`

- fullName: Centro logístico: navegación y resumen visual presenta el título y las secciones en el orden requerido
- Mensaje principal: `AssertionError: expected false to be true // Object.is equality`
- BASE = HEAD.

### 2. `src/lib/compras/contratos.test.ts`

- fullName: no modifica RRHH, credenciales ni esquema SQL
- Mensaje principal: `AssertionError: expected true to be false // Object.is equality`
- BASE = HEAD.

### 3. `src/lib/compras/requerimiento-ui.test.ts`

- fullName: ajuste transversal sin SQL, RRHH, programación ni credenciales
- Mensaje principal: `AssertionError: expected true to be false // Object.is equality`
- BASE = HEAD.

### 4. `src/lib/rrhh/vacaciones-sync-invalida.test.ts`

- fullName: contratos de invalidación y esquema migración aditiva coincide exactamente con schema y protege tenant por FK compuesta
- Mensaje principal: `AssertionError: expected '-- Plataforma corporativa multiempres…' to contain 'CREATE TABLE IF NOT EXISTS rrhh_vacac…'`
- BASE = HEAD.

### 5. `src/lib/tms/programacion-import-excel.test.ts`

- fullName: generarPlantillaProgramacion define named ranges de libro para los 3 catálogos usados en dropdowns
- Mensaje principal: `Error: Command failed: unzip -p "C:/Users/Admin/AppData/Local/Temp/claude/xlsxtest/plantilla-programacion-test.xlsx" xl/workbook.xml`
- BASE = HEAD.

### 6. `src/lib/tms/vehiculo-solicitado.test.ts`

- fullName: catálogo reutilizado: perfiles de costeo por empresa GET /tms/catalogos lo expone (aditivo) con la empresa de la sesión
- Mensaje principal: `AssertionError: expected 'import { NextResponse } from "next/se…' to match /personal,\n\s+vehiculosSolicitables,/`
- BASE = HEAD.

### 7. `src/app/e/[slug]/programacion/programacion-exportar-imagen-wiring.test.ts`

- fullName: programacion-client.tsx — Exportar imagen «Exportar imagen» solo existe en Programación — ningún otro módulo importa programacion-exportar-imagen ni programacion-imagen
- Mensaje principal: `AssertionError: expected [ …(2) ] to deeply equal []`
- BASE = HEAD.

### 8. `src/app/e/[slug]/atraccion-talento/reportes/page.test.ts`

- fullName: ATRACCION-TALENTO-1/2 — closure de filtros en cargar() 38) el montaje inicial sigue siendo una sola carga: el useEffect que llama cargar() al montar tiene deps [] — cambiar un filtro por sí solo NO dispara fetch
- Mensaje principal: `AssertionError: expected -1 to be greater than -1`
- BASE = HEAD.

### 9. `src/app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts`

- fullName: PATCH — editar el TC de un viaje PROPIO editar OTROS campos conserva el TC (no reescribe las columnas TC) y el propio plan se autoexcluye de la validación
- Mensaje principal: `AssertionError: expected 400 to be 200 // Object.is equality`
- BASE = HEAD.

### 10. `src/app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts`

- fullName: PATCH — editar el TC de un viaje PROPIO el mismo TC enviado de nuevo no se re-valida (ni por taller) ni se reescribe
- Mensaje principal: `AssertionError: expected 400 to be 200 // Object.is equality`
- BASE = HEAD.

### 11. `src/app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts`

- fullName: PATCH — editar el TC de un viaje PROPIO cambiar de TC valida el nuevo (acceso + clasificación) y reescribe id + fotografía
- Mensaje principal: `AssertionError: expected 400 to be 200 // Object.is equality`
- BASE = HEAD.

### 12. `src/app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts`

- fullName: PATCH — editar el TC de un viaje PROPIO cambiar a un TC ya asignado ese día a OTRO plan -> 409 (backend, no solo UI)
- Mensaje principal: `AssertionError: expected 400 to be 409 // Object.is equality`
- BASE = HEAD.

### 13. `src/app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts`

- fullName: PATCH — editar el TC de un viaje PROPIO cambiar la fecha del plan revalida el TC contra la NUEVA fecha
- Mensaje principal: `AssertionError: expected 400 to be 409 // Object.is equality`
- BASE = HEAD.

### 14. `src/app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts`

- fullName: PATCH — editar el TC de un viaje PROPIO tcVehiculoId: null quita el TC
- Mensaje principal: `AssertionError: expected 400 to be 200 // Object.is equality`
- BASE = HEAD.

### 15. `src/app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts`

- fullName: PATCH — TC de un viaje TERCERIZADO y cambio de tipo edición conserva/actualiza el snapshot externo (tcExternoPlaca en mayúsculas) sin tocar el catálogo interno
- Mensaje principal: `AssertionError: expected 400 to be 200 // Object.is equality`
- BASE = HEAD.

### 16. `src/app/api/empresas/[slug]/tms/planes/programacion-viajes-tercerizados.test.ts`

- fullName: PATCH /tms/planes — patchTipoViaje: cambio de tipo aislado un PATCH sin tipoViaje sigue el flujo normal (no entra a patchTipoViaje, no dispara su SELECT dedicado)
- Mensaje principal: `AssertionError: expected 400 to be 200 // Object.is equality`
- BASE = HEAD.

### 17. `src/app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts`

- fullName: PATCH /tms/planes — editar y dejar el regreso estimado en null regresoEstimado: null con piloto asignado no da 400 y guarda NULL (sin inventar una hora)
- Mensaje principal: `AssertionError: expected 400 to be 200 // Object.is equality`
- BASE = HEAD.

### 18. `src/app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts`

- fullName: PATCH /tms/planes — editar y dejar el regreso estimado en null un plan que ya no tenía regreso estimado se puede seguir editando sin exigirlo
- Mensaje principal: `AssertionError: expected 400 to be 200 // Object.is equality`
- BASE = HEAD.

### 19. `src/app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts`

- fullName: PATCH /tms/planes — editar y dejar el regreso estimado en null al editar sin regreso estimado, se valida la fecha efectiva
- Mensaje principal: `TypeError: Cannot read properties of undefined (reading 'sql')`
- BASE = HEAD.

### 20. `src/app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts`

- fullName: PATCH /tms/planes — editar y dejar el regreso estimado en null editar y dejar null conserva la validación por empresa y excluye al propio plan
- Mensaje principal: `TypeError: Cannot read properties of undefined (reading 'sql')`
- BASE = HEAD.

### 21. `src/app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts`

- fullName: PATCH /tms/planes — editar y dejar el regreso estimado en null editar y conflicto con un viaje abierto de OTRO plan del mismo piloto: 409
- Mensaje principal: `AssertionError: expected 400 to be 409 // Object.is equality`
- BASE = HEAD.

### 22. `src/app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts`

- fullName: identidad de personal por empleado — POST y PATCH usan la misma regla PATCH: al mover el viaje, el piloto (personal 12, empleado 55) choca con un viaje donde el mismo empleado es Auxiliar (personal 10): 409
- Mensaje principal: `AssertionError: expected 400 to be 409 // Object.is equality`
- BASE = HEAD.

## Riesgos y exclusiones

Riesgo funcional mínimo: el JavaScript emitido y el texto renderizado son
idénticos. La prueba no sustituye QA integral de todos los estados del componente,
que no fueron alterados. Los 40 errores globales y 22 fallos heredados quedan
fuera de alcance. No se tocaron backend, SQL, permisos ni otros módulos.
PR exclusivamente para revisión; **NO MERGE**.
