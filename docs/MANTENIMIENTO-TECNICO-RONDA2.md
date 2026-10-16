# Mantenimiento técnico — ronda 2

Base exacta: `0d7968ac6b004d05f52be66f2fff1bf95c49d881`.
Rama: `codex/mantenimiento-tecnico-ronda2`.

## Alcance y clasificación

Un solo tipo de mantenimiento: retirar seis specifiers de import sin uso en seis rutas de Flota. No se elimina ninguna función, archivo, módulo ni dependencia. Cada módulo conserva otros imports usados; por tanto no se elimina su evaluación. Ningún cambio en handlers, contratos, permisos, validaciones, respuestas, UI, cálculos, auditoría, queries, locks, transacciones ni concurrencia. Sin SQL, migraciones ni datos.

Barrido fresco ESLint de los 1.700 archivos TS/TSX de src, sin autofix ni cambios de reglas. Clasificación de los 50 diagnósticos BASE:

| Clase | Hallazgo | Decisión |
| --- | --- | --- |
| A — seguro | Seis imports sin referencias en rutas Flota | Implementar solo la eliminación del specifier. JS emitido idéntico en los seis casos. |
| A — fuera del recorte | Dos bindings _omitido sin uso en tests API RRHH/prestaciones | Conservar para no mezclar dominios ni modificar tests ajenos; el rest destructuring no se elimina ciegamente. |
| B — requiere prueba | Dos react/no-unescaped-entities en components/flota/vehiculo-documentos.tsx | Diferir: JSX/UI es otro tipo de mantenimiento y el mismo componente contiene efectos. No implementado. |
| C — no tocar | 34 react-hooks/set-state-in-effect y 6 react-hooks/refs | Ningún autofix, cambio de dependencias, memoización, refs, estado ni ciclo de efectos. |

No quedan diagnósticos prefer-const en este baseline. No se buscan simplificaciones especulativas para aumentar artificialmente el tamaño del PR. Helpers, ramas aparentemente muertas y archivos aparentemente obsoletos se conservan sin evidencia inequívoca adicional. Los efectos señalados por ESLint y los 22 tests fallidos requieren tickets independientes; no se afirma que cada diagnóstico sea un defecto funcional demostrado.

## Cambios exactos

Todos bajo src/app/api/empresas/[slug]/flota:

| Ruta | Único specifier retirado | Módulo que permanece importado |
| --- | --- | --- |
| inventario-equipo/route.ts | invalidarCatalogoInventario | @/lib/flota/inventario-equipo |
| planes-salida/route.ts | asegurarSchemaFlota | @/lib/flota/schema |
| reportes/route.ts | asegurarSchemaFlota | @/lib/flota/schema |
| servicios/[id]/adjuntos/route.ts | asegurarSchemaFlotaLectura | @/lib/flota/schema |
| verificar-piloto/route.ts | asegurarSchemaFlota | @/lib/flota/schema |
| viajes/[id]/paradas/route.ts | asegurarSchemaFlota | @/lib/flota/schema |

invalidarCatalogoInventario sigue definido y llamado por las rutas categorias/areas de inventario-equipo; no se elimina ni modifica su invalidación. asegurarSchemaFlota/asegurarSchemaFlotaLectura siguen definidos y se conservan todas sus llamadas reales.

Séptimo archivo: docs/MANTENIMIENTO-TECNICO-RONDA2.md (este reporte). No se modifican AGENTS.md, package*.json, configuración, RRHH, catalogos-nomina.ts ni cambios concurrentes. El checkout original permanece íntegro; trabajo en worktree separado.

## Evidencia de equivalencia

Comparación local con TypeScript transpileModule, module ESNext / target ES2017, de cada ruta contra git show BASE:ruta. Se normalizan CRLF/LF de ambas entradas antes de compilar; no se normaliza/elimina ninguna instrucción del resultado. Igualdad completa del JavaScript emitido y SHA-256 iguales:

| Ruta | SHA-256 JS en BASE y HEAD |
| --- | --- |
| inventario-equipo/route.ts | `bf69cbf6989ed262e9fb251996f2997cdecfe9a2acbbf3b3e31d7a1b1fab336b` |
| planes-salida/route.ts | `7ac79a85a707d70595cb0ecccd77692603953bec5dd4f152d81b8cc4e4df0046` |
| reportes/route.ts | `c0c847c2a0aa3d369244f71cbcbb87e3964ee22fd100ce0588f84f6bca360923` |
| servicios/[id]/adjuntos/route.ts | `eaa97e045f9732a4108cdd69077a65a24f095aa58a4ead6f842622b548c05457` |
| verificar-piloto/route.ts | `1b7d5b2539e37209644e3895abe410a74120c6a8e309bc0435f55eb8408410a9` |
| viajes/[id]/paradas/route.ts | `3bee9cf7afffaf563683593e98fed5581211b265c32449b5878d69fa0c6dd0f0` |

Los imports ya eran eliminados al emitir JavaScript porque no se usaban. No se reclama mejora de latencia/bundle: es reducción de deuda/diagnósticos, sin cambios runtime. No se necesitan fixtures nuevos ni mocks que reescriban comportamiento; se reutiliza la suite existente y se añade esta comprobación de equivalencia emitida.

Reproducción: para las seis rutas de la tabla, leer `git show 0d7968ac6b004d05f52be66f2fff1bf95c49d881:ruta` y el archivo HEAD; aplicar `s.replaceAll("\\r\\n", "\\n")`; compilar con `ts.transpileModule(s, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2017 } }).outputText`; exigir igualdad exacta. Sin ejecutar los handlers ni conectarse a BD.

## Validación

Misma máquina, Node v24.18.0 / npm 11.16.0, dependencias y configuración sin cambios. BASE ejecutado completamente antes de editar; HEAD después de las seis eliminaciones. Pruebas DB opt-in omitidas; no servicios de BD ni configuración productiva usados en esta ronda.

| Validación | BASE | HEAD |
| --- | --- | --- |
| Flota + APIs | 549 pass / 0 fail / 72 omitidas | 549 pass / 0 fail / 72 omitidas |
| Suite completa | 10.657 pass / 22 fail / 554 omitidas | 10.657 pass / 22 fail / 554 omitidas |
| ESLint global src | 42 errores / 8 warnings | 42 errores / 2 warnings; cero nuevos |
| ESLint seis rutas tocadas | 6 warnings | 0 errores / 0 warnings |
| tsc --noEmit | OK | OK |
| git diff --check | OK | OK |
| npm run build | OK | OK |
| JS emitido seis rutas | Oráculo BASE | Idéntico en las seis |

Comandos de pruebas: `node node_modules/vitest/vitest.mjs run --maxWorkers=4 --reporter=json --outputFile=node_modules/.ronda2-tests-{base,head}.json`; dirigidas agregan filtros `src/lib/flota 'src/app/api/empresas/[slug]/flota'`. ESLint global: `node node_modules/eslint/bin/eslint.js src --format json --output-file node_modules/.ronda2-eslint-{base,head}.json`; dirigido: los seis paths de esta tabla. Más `npx tsc --noEmit`, `git diff --check` y `npm run build`. Se usa el entorno local autorizado fuera del sandbox para evitar el EPERM de caché/junctions constatado en ronda 1; no se modificó configuración por ello.

Incidencia de ejecución: el primer HEAD completo, simultáneo a validaciones pesadas, produjo 10.656 pass / 23 fail / 554 omitidas. El extra fue contabilidad/factura-emitida.test.ts → «INERTE: el evaluador no está conectado a ningún flujo productivo / ningún módulo de producción lo importa»: recorrido síncrono de src tardó 9.226 ms y el runner devolvió STACK_TRACE_ERROR al exceder el límite temporal (withTimeout también verifica duración síncrona). El mismo archivo sin cambios pasó aislado 24/24; ese test tardó 1.011 ms. No se modificaron test, timeout, configuración ni código de Contabilidad. La suite completa repetida sin build/ESLint concurrentes terminó 10.657 pass / 22 fail / 554 omitidas, con exactamente los mismos fallos que BASE. El primer resultado no se oculta ni se clasifica como fallo heredado.

CERO REGRESIONES NUEVAS en la validación final: comparación por archivo + fullName + mensaje principal idéntica, sin nuevos fallos ni suites fallidas sin tests. El informe de la repetición se conserva localmente como node_modules/.ronda2-tests-head-final.json (ignorado). ESLint elimina exactamente seis no-unused-vars sin agregar diagnósticos; los 42 errores y dos warnings restantes no se modifican.

### Identidades de los 22 fallos comunes BASE / HEAD final

1. `src/components/tms/centro-logistico-resumen.test.ts` — Centro logístico: navegación y resumen visual presenta el título y las secciones en el orden requerido
   Mensaje: AssertionError: expected false to be true // Object.is equality

2. `src/lib/compras/contratos.test.ts` — no modifica RRHH, credenciales ni esquema SQL
   Mensaje: AssertionError: expected true to be false // Object.is equality

3. `src/lib/compras/requerimiento-ui.test.ts` — ajuste transversal sin SQL, RRHH, programación ni credenciales
   Mensaje: AssertionError: expected true to be false // Object.is equality

4. `src/lib/rrhh/vacaciones-sync-invalida.test.ts` — contratos de invalidación y esquema migración aditiva coincide exactamente con schema y protege tenant por FK compuesta
   Mensaje: AssertionError: expected '-- Plataforma corporativa multiempres…' to contain 'CREATE TABLE IF NOT EXISTS rrhh_vacac…'

5. `src/app/e/[slug]/programacion/programacion-exportar-imagen-wiring.test.ts` — programacion-client.tsx — Exportar imagen «Exportar imagen» solo existe en Programación — ningún otro módulo importa programacion-exportar-imagen ni programacion-imagen
   Mensaje: AssertionError: expected [ …(2) ] to deeply equal []

6. `src/lib/tms/programacion-import-excel.test.ts` — generarPlantillaProgramacion define named ranges de libro para los 3 catálogos usados en dropdowns
   Mensaje: Error: Command failed: unzip -p "C:/Users/Admin/AppData/Local/Temp/claude/xlsxtest/plantilla-programacion-test.xlsx" xl/workbook.xml

7. `src/lib/tms/vehiculo-solicitado.test.ts` — catálogo reutilizado: perfiles de costeo por empresa GET /tms/catalogos lo expone (aditivo) con la empresa de la sesión
   Mensaje: AssertionError: expected 'import { NextResponse } from "next/se…' to match /personal,\n\s+vehiculosSolicitables,/

8. `src/app/e/[slug]/atraccion-talento/reportes/page.test.ts` — ATRACCION-TALENTO-1/2 — closure de filtros en cargar() 38) el montaje inicial sigue siendo una sola carga: el useEffect que llama cargar() al montar tiene deps [] — cambiar un filtro por sí solo NO dispara fetch
   Mensaje: AssertionError: expected -1 to be greater than -1

9. `src/app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts` — PATCH — editar el TC de un viaje PROPIO editar OTROS campos conserva el TC (no reescribe las columnas TC) y el propio plan se autoexcluye de la validación
   Mensaje: AssertionError: expected 400 to be 200 // Object.is equality

10. `src/app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts` — PATCH — editar el TC de un viaje PROPIO el mismo TC enviado de nuevo no se re-valida (ni por taller) ni se reescribe
   Mensaje: AssertionError: expected 400 to be 200 // Object.is equality

11. `src/app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts` — PATCH — editar el TC de un viaje PROPIO cambiar de TC valida el nuevo (acceso + clasificación) y reescribe id + fotografía
   Mensaje: AssertionError: expected 400 to be 200 // Object.is equality

12. `src/app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts` — PATCH — editar el TC de un viaje PROPIO cambiar a un TC ya asignado ese día a OTRO plan -> 409 (backend, no solo UI)
   Mensaje: AssertionError: expected 400 to be 409 // Object.is equality

13. `src/app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts` — PATCH — editar el TC de un viaje PROPIO cambiar la fecha del plan revalida el TC contra la NUEVA fecha
   Mensaje: AssertionError: expected 400 to be 409 // Object.is equality

14. `src/app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts` — PATCH — editar el TC de un viaje PROPIO tcVehiculoId: null quita el TC
   Mensaje: AssertionError: expected 400 to be 200 // Object.is equality

15. `src/app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts` — PATCH — TC de un viaje TERCERIZADO y cambio de tipo edición conserva/actualiza el snapshot externo (tcExternoPlaca en mayúsculas) sin tocar el catálogo interno
   Mensaje: AssertionError: expected 400 to be 200 // Object.is equality

16. `src/app/api/empresas/[slug]/tms/planes/programacion-viajes-tercerizados.test.ts` — PATCH /tms/planes — patchTipoViaje: cambio de tipo aislado un PATCH sin tipoViaje sigue el flujo normal (no entra a patchTipoViaje, no dispara su SELECT dedicado)
   Mensaje: AssertionError: expected 400 to be 200 // Object.is equality

17. `src/app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts` — PATCH /tms/planes — editar y dejar el regreso estimado en null regresoEstimado: null con piloto asignado no da 400 y guarda NULL (sin inventar una hora)
   Mensaje: AssertionError: expected 400 to be 200 // Object.is equality

18. `src/app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts` — PATCH /tms/planes — editar y dejar el regreso estimado en null un plan que ya no tenía regreso estimado se puede seguir editando sin exigirlo
   Mensaje: AssertionError: expected 400 to be 200 // Object.is equality

19. `src/app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts` — PATCH /tms/planes — editar y dejar el regreso estimado en null al editar sin regreso estimado, se valida la fecha efectiva
   Mensaje: TypeError: Cannot read properties of undefined (reading 'sql')

20. `src/app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts` — PATCH /tms/planes — editar y dejar el regreso estimado en null editar y dejar null conserva la validación por empresa y excluye al propio plan
   Mensaje: TypeError: Cannot read properties of undefined (reading 'sql')

21. `src/app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts` — PATCH /tms/planes — editar y dejar el regreso estimado en null editar y conflicto con un viaje abierto de OTRO plan del mismo piloto: 409
   Mensaje: AssertionError: expected 400 to be 409 // Object.is equality

22. `src/app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts` — identidad de personal por empleado — POST y PATCH usan la misma regla PATCH: al mover el viaje, el piloto (personal 12, empleado 55) choca con un viaje donde el mismo empleado es Auxiliar (personal 10): 409
   Mensaje: AssertionError: expected 400 to be 409 // Object.is equality

## Riesgos / fuera de alcance

Persisten diagnósticos y fallos heredados; no se silencian reglas ni se corrigen hooks/SQL/funcionalidad para forzar verde. No pruebas contra producción ni afirmación de certificación DB. Riesgo bajo: diff runtime invariante, mismo grafo de módulos importados y eliminación de imports inequívocamente no usados. Sin SQL, datos ni merge.

Ambos builds conservan los avisos preexistentes de middleware deprecado, Cache-Control y cuatro trazas de acceso dinámico a filesystem en archivos no modificados. No se intentó corregirlos aquí.
