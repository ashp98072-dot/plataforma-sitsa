# Mantenimiento técnico acotado — sin cambios funcionales

Base: `209186642f1bc374e3453a3eeb33f3498f311632`.
Rama: `codex/mantenimiento-tecnico`. No SQL, migraciones, datos ni merge.

## Discovery y decisión A/B/C

Barrido de los 1.698 archivos TS/TSX de src con ESLint; búsqueda de declaraciones, imports, normalizadores y referencias con rg; revisión de los archivos de mayor tamaño y de los módulos prioritarios. Es discovery estático y validación local, no un perfilado productivo ni una afirmación de que todo el repositorio carezca de código muerto/N+1.

| Clase | Hallazgo / rutas | Decisión |
| --- | --- | --- |
| A | Import asegurarSchemaFlota sin uso en src/app/api/empresas/[slug]/flota/export/route.ts; import asegurarSchemaFlotaLectura sin uso en flota/import/route.ts | Quitar solo esos specifiers; el mismo módulo schema continúa importado y ejecutándose. Ningún handler/guard/query cambia. |
| A | ws nunca reasignada en src/lib/flota/import-excel.ts | let → const, misma selección de hoja y cuerpo de parser. |
| B | Normalización de placa idéntica en combustible-importacion-parser.ts y combustible-c2c-shared.ts; secuencia de identificador repetida también en normalizarVale | Extraer combustible-identificadores.ts puro, reutilizarlo y reexportar los nombres existentes para conservar consumidores. Mantener String(s ?? "") en normalizarVale. |
| C | Normalizadores legacy combustible-conciliacion.ts, fechas en combustible-form-ui.ts, contratos de Facturación/Contabilidad | No unificar por parecido: dominios/entradas/reglas no son idénticos. |
| C | Transacciones/bloqueos y queries de combustible-staff.ts, combustible-fondos.ts, combustible-importaciones.ts, combustible-c2c.ts; facturacion/confirmaciones-bancarias.ts y contabilidad/eventos.ts | No alterar SQL, orden de operaciones, cachés, aislamiento, auditoría ni concurrencia. Sin N+1 medido/equivalencia suficiente para proponer cambios en este PR. |
| C | flota-client.tsx (~227 KB), programacion/plan-form.tsx (~129 KB), planes-viajes-client.tsx (~117 KB), facturacion/facturas.ts (~87 KB) | No separar pantallas/servicios grandes solo por tamaño; requiere ticket específico y cobertura de estados/efectos. |
| C | Errores existentes de hooks React en Flota/CMS/RRHH/session/theme y otros imports sin uso fuera del recorte | Documentar, no modificar efectos/refs ni aplicar autofix general. |
| C | Dependencias, archivos aparentemente obsoletos, any, tipos y errores de otros dominios | No eliminar ni sustituir sin evidencia completa de consumidores/rutas/configuración. No hay borrados ni cambios package*. |

Facturación/Contabilidad no presentaron diagnósticos de lint en sus directorios lib. Su revisión no justificó cambios inequívocamente seguros dentro de este recorte.

## Cambios exactos (8 archivos)

- src/app/api/empresas/[slug]/flota/export/route.ts
- src/app/api/empresas/[slug]/flota/import/route.ts
- src/lib/flota/import-excel.ts
- src/lib/flota/combustible-importacion-parser.ts
- src/lib/flota/combustible-c2c-shared.ts
- src/lib/flota/combustible-identificadores.ts (nuevo)
- src/lib/flota/combustible-identificadores.test.ts (nuevo)
- docs/MANTENIMIENTO-TECNICO-2026-10.md (este reporte)

Eliminados: dos specifiers de import y las implementaciones duplicadas/comentario de réplica ya obsoleto. Ningún archivo, dependencia, endpoint ni export público eliminado.

## Equivalencia

- Cuatro pruebas nuevas: 1.200 cadenas deterministas con Unicode NFC/descompuesto, espacios/tab/newline/NBSP, ceros, prefijos y guiones; cada salida contra oráculos congelados de BASE. Casos null/undefined conservan contrato de vale.
- Identidad de reexports y pruebas existentes del parser multifolio, fingerprints, clasificación C2C y HTTP. No se toca C-1/C-2A ni matching/tolerancias C2C.
- Grafo runtime por AST desde combustible-c2c-shared.ts: solo el helper puro y decimal.js; sin ExcelJS, crypto, servidor, uploads ni BD. Las utilidades puras no importan parser/Node.
- Comparación local mediante TypeScript transpileModule del JS emitido de ambas rutas frente a git show BASE: idéntico tras normalizar CRLF/LF de las entradas.
- Sin claims de mejora porcentual de bundle/latencia: esta extracción reduce duplicación y riesgo de divergencia, no demuestra un cuello de botella ni una aceleración productiva. Misma complejidad y mismos queries/requests.

## Validación BASE vs HEAD

Misma máquina, Node v24.18.0, npm 11.16.0, dependencias/configuración sin cambios. Sin .env productivo ni servicios de BD levantados para este ticket. Las pruebas opt-in de DB quedaron omitidas.

| Comprobación | BASE | HEAD |
| --- | --- | --- |
| Suite completa (maxWorkers=4) | 10.653 pass / 22 fail / 554 omitidas | 10.657 pass / 22 fail / 554 omitidas |
| Flota y sus APIs (maxWorkers=4) | 545 pass / 0 fail / 72 omitidas | 549 pass / 0 fail / 72 omitidas |
| ESLint src completo | 43 errores / 10 warnings | 42 errores / 8 warnings |
| ESLint siete archivos de código tocados | Diagnósticos A señalados arriba | 0 errores / 0 warnings |
| tsc --noEmit | OK | OK |
| git diff --check | OK | OK |
| npm run build | OK | OK |

CERO REGRESIONES NUEVAS en la suite ejecutada: los 22 fallos coinciden por archivo + fullName + mensaje principal, no solo cantidad. ESLint tampoco agrega diagnósticos: elimina exactamente dos no-unused-vars y un prefer-const. Los 42 errores/8 warnings restantes se mantienen, sin deshabilitar reglas.

Comandos: `node node_modules/vitest/vitest.mjs run --maxWorkers=4 --reporter=json --outputFile=node_modules/.mantenimiento-tests-{base,head}.json`; dirigidas con filtros `src/lib/flota 'src/app/api/empresas/[slug]/flota'`; `npx tsc --noEmit`; `eslint src`; `git diff --check`; `npm run build`. Informes temporales bajo node_modules ignorado, no incorporados al PR.

El primer intento bajo sandbox no ejecutó tests por EPERM al renombrar caché temporal y el build no pudo crear junctions. Se descartaron esos intentos y se repitió BASE/HEAD fuera de esa restricción. No se cambiaron configuración ni dependencias para ocultar esos errores.

Ambos builds mantienen los avisos de middleware deprecado, Cache-Control y cuatro trazas de acceso dinámico a filesystem en rutas no modificadas. No se intentó corregirlos en este recorte.

### Fallos BASE también presentes en HEAD

1. `src/lib/compras/contratos.test.ts` — no modifica RRHH, credenciales ni esquema SQL
   Mensaje principal: AssertionError: expected true to be false // Object.is equality

2. `src/lib/compras/requerimiento-ui.test.ts` — ajuste transversal sin SQL, RRHH, programación ni credenciales
   Mensaje principal: AssertionError: expected true to be false // Object.is equality

3. `src/components/tms/centro-logistico-resumen.test.ts` — Centro logístico: navegación y resumen visual presenta el título y las secciones en el orden requerido
   Mensaje principal: AssertionError: expected false to be true // Object.is equality

4. `src/lib/rrhh/vacaciones-sync-invalida.test.ts` — contratos de invalidación y esquema migración aditiva coincide exactamente con schema y protege tenant por FK compuesta
   Mensaje principal: AssertionError: expected '-- Plataforma corporativa multiempres…' to contain 'CREATE TABLE IF NOT EXISTS rrhh_vacac…'

5. `src/lib/tms/programacion-import-excel.test.ts` — generarPlantillaProgramacion define named ranges de libro para los 3 catálogos usados en dropdowns
   Mensaje principal: Error: Command failed: unzip -p "C:/Users/Admin/AppData/Local/Temp/claude/xlsxtest/plantilla-programacion-test.xlsx" xl/workbook.xml

6. `src/lib/tms/vehiculo-solicitado.test.ts` — catálogo reutilizado: perfiles de costeo por empresa GET /tms/catalogos lo expone (aditivo) con la empresa de la sesión
   Mensaje principal: AssertionError: expected 'import { NextResponse } from "next/se…' to match /personal,\n\s+vehiculosSolicitables,/

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

## Límites y riesgos

No suite DB real ni QA productivo; no se ejecutó SQL ni se tocaron datos reales. No se optimizaron queries, cachés de autorización ni renders por especulación. Los fallos globales heredados y avisos de build ajenos siguen pendientes de tickets propios. El checkout original, catalogos-nomina.ts y cambios concurrentes se preservan fuera del worktree. PR pequeño y sin merge.
