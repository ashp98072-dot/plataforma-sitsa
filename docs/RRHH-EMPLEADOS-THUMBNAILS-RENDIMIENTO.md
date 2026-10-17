# RRHH Empleados — miniaturas privadas y catálogo ligero

## Base y alcance

Base inicial: `1237a7ba062bba963b1c1a8310ee83c5e61d3b6b`.
Rama: `codex/empleados-thumbnails`.
No SQL productivo, migración, cambios de esquema, datos ni merge.
No paginación ni virtualización en esta fase.

## Diseño de fotografías

- Nuevo GET `/api/empresas/[slug]/empleados/[id]/foto/miniatura`, runtime Node.
- Guard `requireTenantRrhh(slug, "empleados", "ver")`, validación del ID y pertenencia del empleado antes del helper, incluidos los 304.
- Mismo documento Foto más reciente y criterio de extensión que el original. Se verifica existencia del original en cada petición; borrar el original o su registro no permite servir un derivado viejo.
- WebP calidad 75, máximo 160 × 160, fit inside, sin ampliación de fotos pequeñas, orientación EXIF y transparencia conservadas.
- Original intacto. La ficha, ampliación y consumidores que no optan por `usarMiniatura` mantienen la URL original. Solo el listado de Empleados opta por el derivado; conserva lazy loading, iniciales y permisos.
- Generación progresiva bajo demanda, no durante build/deploy ni mediante backfill. Se prefirió a modificar el POST: cubre también fotos históricas sin añadir riesgo al guardado.
- Derivado en `empresas/{empresaId}/documentos/.miniaturas/{hash}.webp`; no registra un documento nuevo, ni modifica conteos ni fotos anteriores.
- Clave incluye empresa, empleado, documento, ruta relativa, tamaño, mtime y versión del generador. Nuevos documentos/fotos no reutilizan la versión anterior.
- Contención por rutas reales: original y caché deben permanecer dentro del directorio documental canónico del tenant; se rechazan enlaces que escapen.
- Publicación temporal con nombre aleatorio + rename. Map solo para trabajo en curso, eliminado al terminar éxito/error. Máximo dos generaciones simultáneas por proceso, antes de leer los originales.
- Límite de decodificación: 100 megapíxeles. Un original corrupto/no decodificable o mayor a ese presupuesto no se transforma; permanece intacto y la miniatura puede caer a iniciales. No hay fallback automático al original pesado.
- Sharp 0.35.5 queda como dependencia directa, misma versión ya resuelta por Next en BASE; sin upgrades de otras dependencias.

## Caché

Solo el derivado usa `Cache-Control: private, no-cache`, `Vary: Cookie` y ETag débil ligado a la versión. El navegador puede conservar bytes, pero debe revalidar antes de reutilizarlos. No caché pública, CDN compartida ni TTL que omita el guard.

If-None-Match se comprueba DESPUÉS de autorización, pertenencia, selección del documento y comprobaciones del archivo. 304 no incluye cuerpo. Si el archivo derivado se perdió, se vuelve a generar. Errores no se cachean. El endpoint original conserva `private, no-store`.

Las consultas por fotografía NO desaparecen: guard + empleado + documento siguen validándose. Una revalidación evita transferencia y lectura/decodificación del original, no toda actividad de BD/filesystem.

## Supervisores

Nuevo GET `/api/empresas/[slug]/empleados/supervisores`, con el mismo permiso `empleados:ver`.
Una consulta:

```sql
SELECT id, nombre, numero_empleado, codigo FROM empleados
WHERE empresa_id = ? AND estado = 'Activo' ORDER BY nombre
```

Empresa tomada exclusivamente del guard; no del query string. Devuelve `{ empleados: [{ id, nombre, numeroEmpleado, codigo }] }`, privado/no-store. No cuenta documentos, no busca fotos, no ejecuta el mapper de 54 propiedades ni obtiene configuración horaria.

El universo Activo y orden son iguales a la llamada anterior. No depende de los filtros de tabla. Se mantiene exclusión del propio empleado y de IDs ya seleccionados. Los supervisores asignados históricos/inactivos siguen llegando desde el detalle y sus etiquetas siguen acumulándose mediante `mergeSupervisorLabels`. No se modifica la edición ni el modelo de supervisión.

## Medición local BASE / HEAD

Fixtures sintéticos deterministas, no datos ni latencias productivos:

| Medida | BASE | HEAD |
| --- | --- | --- |
| Foto JPEG 1024 × 768 | 648251 bytes | 2980 bytes WebP (−99,54 %) |
| Reutilización condicional de foto | Vuelve a transferir original | 304, cuerpo 0 bytes |
| Catálogo de 104 supervisores | 103735 bytes | 9145 bytes (−91,18 %) |
| Consultas de dominio del catálogo | 3 + configuración cuando no está cacheada | 1 |
| Consultas de dominio por foto, sin guards | 2 | 2, incluso con revalidación |
| Requests iniciales de catálogo | 2 | 2; la segunda es ligera |

Primera medición de helper con filesystem temporal: original ~6,1 ms, derivado frío ~31,2 ms, derivado caliente ~5,0 ms. La primera generación consume CPU adicional; no se presenta como menor TTFB. Tiempos variables de una máquina Windows, sin red/BD real.

Reproducir:
`node node_modules/vitest/vitest.mjs run src/lib/rrhh/foto-empleado-miniatura.test.ts src/lib/rrhh/supervisores-catalogo.test.ts --maxWorkers=1 --disableConsoleIntercept --reporter=verbose`

Los tests comparan los cuatro campos del catálogo con la proyección del listado anterior. El conteo de requests globales/RSC y la sensación de navegación se mantienen pendientes de medición en navegador de producción.

## Pruebas y validación

Node 24.18.0, npm 11.16.0, Next 16.3.6, Sharp 0.35.5. BASE en worktree limpio, HEAD en worktree separado. Mismas versiones de dependencias y comando completo: `node node_modules/vitest/vitest.mjs run --maxWorkers=4 --reporter=json`. Sin .env productivo ni conexión productiva; tests DB opt-in omitidos, nuevos tests con mocks y directorios temporales propios.

Cobertura nueva: JPG/PNG/WebP reales, dimensiones/proporción, EXIF, alpha, foto pequeña, original idéntico, derivado ausente/existente, concurrencia, invalidación por foto/archivo, 304/lista de ETags, sin foto, foto borrada, rutas/links de otra empresa, error de decode, sesión/permiso/tenant, DTO mínimo, equivalencia de catálogo, URL del listado y original en ficha/ampliación.

| Validación | Resultado |
| --- | --- |
| Dirigida Empleados/fotos/supervisores | 196/196 |
| Compatibilidad puntual Planillas/fotos | 53/53; Planillas no se modificó |
| Suite BASE estable | 10708 pass / 22 fail / 599 skip |
| Suite HEAD final | 10737 pass / 22 fail / 599 skip |
| Comparación por archivo + fullName + mensaje principal | 22 identidades idénticas; cero regresiones nuevas |

| ESLint dirigido (todos los TS/TSX tocados) | OK |
| TypeScript --noEmit | OK |
| git diff --check | OK |
| Build final | OK; warnings existentes de tracing fuera del alcance |

Una primera corrida BASE concurrente con preparación del entorno dio dos STACK_TRACE_ERROR adicionales de Contabilidad; no se reprodujeron en la repetición estable. Se comparó la corrida estable por identidad, no solo por cantidad. Un test estático de Planillas detectó un cambio de nombre local del componente; se conservó su contrato existente sin modificar Planillas.

## Riesgos y validación posterior

- La primera generación añade CPU y escritura; hay un máximo de dos generaciones por proceso. La caché debe estar en almacenamiento privado persistente y escribible.
- Versiones antiguas pueden acumular derivados. No se agregó limpieza automática ni backfill; cualquier limpieza futura debe limitarse a derivados, nunca originales.
- Sharp requiere binarios de la plataforma de despliegue y Node compatible (>=20.9); instalar normalmente en Linux, no copiar binarios Windows.
- El límite de decodificación puede dejar iniciales para imágenes corruptas o extraordinariamente grandes; el original y la ficha permanecen disponibles.
- QA manual pendiente con sesión real: roles, tenant incorrecto y revocación antes de 304; fotos grandes/EXIF/formatos; nueva foto, listado, ampliación original; supervisores inactivos asignados; filtros y edición. Medir Network 200/304, bytes y latencia real. Las mediciones sintéticas no certifican tiempos productivos.
- Se recomienda evaluar paginación server-side como fase 2 después de medir el listado real; no se incluye aquí.

## Fallos heredados idénticos BASE/HEAD

- `components/tms/centro-logistico-resumen.test.ts` — Centro logístico: navegación y resumen visual presenta el título y las secciones en el orden requerido
  - Mensaje: AssertionError: expected false to be true // Object.is equality
- `lib/compras/contratos.test.ts` — no modifica RRHH, credenciales ni esquema SQL
  - Mensaje: AssertionError: expected true to be false // Object.is equality
- `lib/compras/requerimiento-ui.test.ts` — ajuste transversal sin SQL, RRHH, programación ni credenciales
  - Mensaje: AssertionError: expected true to be false // Object.is equality
- `lib/rrhh/vacaciones-sync-invalida.test.ts` — contratos de invalidación y esquema migración aditiva coincide exactamente con schema y protege tenant por FK compuesta
  - Mensaje: AssertionError: expected '-- Plataforma corporativa multiempres…' to contain 'CREATE TABLE IF NOT EXISTS rrhh_vacac…'
- `app/e/[slug]/programacion/programacion-exportar-imagen-wiring.test.ts` — programacion-client.tsx — Exportar imagen «Exportar imagen» solo existe en Programación — ningún otro módulo importa programacion-exportar-imagen ni programacion-imagen
  - Mensaje: AssertionError: expected [ …(2) ] to deeply equal []
- `lib/tms/programacion-import-excel.test.ts` — generarPlantillaProgramacion define named ranges de libro para los 3 catálogos usados en dropdowns
  - Mensaje: Error: Command failed: unzip -p "C:/Users/Admin/AppData/Local/Temp/claude/xlsxtest/plantilla-programacion-test.xlsx" xl/workbook.xml
- `lib/tms/vehiculo-solicitado.test.ts` — catálogo reutilizado: perfiles de costeo por empresa GET /tms/catalogos lo expone (aditivo) con la empresa de la sesión
  - Mensaje: AssertionError: expected 'import { NextResponse } from "next/se…' to match /personal,\n\s+vehiculosSolicitables,/
- `app/e/[slug]/atraccion-talento/reportes/page.test.ts` — ATRACCION-TALENTO-1/2 — closure de filtros en cargar() 38) el montaje inicial sigue siendo una sola carga: el useEffect que llama cargar() al montar tiene deps [] — cambiar un filtro por sí solo NO dispara fetch
  - Mensaje: AssertionError: expected -1 to be greater than -1
- `app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts` — PATCH — editar el TC de un viaje PROPIO editar OTROS campos conserva el TC (no reescribe las columnas TC) y el propio plan se autoexcluye de la validación
  - Mensaje: AssertionError: expected 400 to be 200 // Object.is equality
- `app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts` — PATCH — editar el TC de un viaje PROPIO el mismo TC enviado de nuevo no se re-valida (ni por taller) ni se reescribe
  - Mensaje: AssertionError: expected 400 to be 200 // Object.is equality
- `app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts` — PATCH — editar el TC de un viaje PROPIO cambiar de TC valida el nuevo (acceso + clasificación) y reescribe id + fotografía
  - Mensaje: AssertionError: expected 400 to be 200 // Object.is equality
- `app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts` — PATCH — editar el TC de un viaje PROPIO cambiar a un TC ya asignado ese día a OTRO plan -> 409 (backend, no solo UI)
  - Mensaje: AssertionError: expected 400 to be 409 // Object.is equality
- `app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts` — PATCH — editar el TC de un viaje PROPIO cambiar la fecha del plan revalida el TC contra la NUEVA fecha
  - Mensaje: AssertionError: expected 400 to be 409 // Object.is equality
- `app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts` — PATCH — editar el TC de un viaje PROPIO tcVehiculoId: null quita el TC
  - Mensaje: AssertionError: expected 400 to be 200 // Object.is equality
- `app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts` — PATCH — TC de un viaje TERCERIZADO y cambio de tipo edición conserva/actualiza el snapshot externo (tcExternoPlaca en mayúsculas) sin tocar el catálogo interno
  - Mensaje: AssertionError: expected 400 to be 200 // Object.is equality
- `app/api/empresas/[slug]/tms/planes/programacion-viajes-tercerizados.test.ts` — PATCH /tms/planes — patchTipoViaje: cambio de tipo aislado un PATCH sin tipoViaje sigue el flujo normal (no entra a patchTipoViaje, no dispara su SELECT dedicado)
  - Mensaje: AssertionError: expected 400 to be 200 // Object.is equality
- `app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts` — PATCH /tms/planes — editar y dejar el regreso estimado en null regresoEstimado: null con piloto asignado no da 400 y guarda NULL (sin inventar una hora)
  - Mensaje: AssertionError: expected 400 to be 200 // Object.is equality
- `app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts` — PATCH /tms/planes — editar y dejar el regreso estimado en null un plan que ya no tenía regreso estimado se puede seguir editando sin exigirlo
  - Mensaje: AssertionError: expected 400 to be 200 // Object.is equality
- `app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts` — PATCH /tms/planes — editar y dejar el regreso estimado en null al editar sin regreso estimado, se valida la fecha efectiva
  - Mensaje: TypeError: Cannot read properties of undefined (reading 'sql')
- `app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts` — PATCH /tms/planes — editar y dejar el regreso estimado en null editar y dejar null conserva la validación por empresa y excluye al propio plan
  - Mensaje: TypeError: Cannot read properties of undefined (reading 'sql')
- `app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts` — PATCH /tms/planes — editar y dejar el regreso estimado en null editar y conflicto con un viaje abierto de OTRO plan del mismo piloto: 409
  - Mensaje: AssertionError: expected 400 to be 409 // Object.is equality
- `app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts` — identidad de personal por empleado — POST y PATCH usan la misma regla PATCH: al mover el viaje, el piloto (personal 12, empleado 55) choca con un viaje donde el mismo empleado es Auxiliar (personal 10): 409
  - Mensaje: AssertionError: expected 400 to be 409 // Object.is equality

Sin SQL ejecutado contra producción, migraciones, modificaciones de datos productivos ni merge.
