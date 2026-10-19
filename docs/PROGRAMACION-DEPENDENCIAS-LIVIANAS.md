# Programación: dependencias iniciales sin Zod

BASE actualizada: `52a23786e4dfdbe26f794f2a7b2ed717d8c95058`.
BASE inicial: `9373adf493d7aaa27668bbeeb02fda9288ef2396` (main al iniciar).
Rama: `codex/programacion-dependencias-livianas`.
Main avanzó por #493 durante la validación. Se incorporó mediante merge normal
sin conflictos: `f8e3b2029ddf5590b1472e3f664b8c1018ae33ee`. Los cambios de CxC
son exactamente los de main; no pertenecen al diff de esta PR ni se editaron.

## Alcance y equivalencia

Se extraen únicamente dos declaraciones:

- `textoCuadrilla` → `src/lib/tms/cuadrilla-presentacion.ts`.
- `MAX_FILAS_EDICION_RAPIDA = 200` → `src/lib/tms/edicion-rapida-limites.ts`.

Los módulos originales conservan reexports compatibles. El esquema usa la misma
constante importada, sin duplicarla. El tipo de Cuadrilla se importa solo como
tipo: no hay ciclo runtime ni import emitido del contrato desde presentación.
Programación y sus helpers apuntan a los módulos livianos.

No se modifican PlanForm, el componente EdicionRapida, esquemas/validaciones,
mensajes, handlers, JSX, efectos, polling, filtros, disponibilidad, guardados,
permisos, endpoints, SQL, dependencias ni configuración. Tampoco Contabilidad,
CxC/CxP o archivos ajenos del checkout principal.

Las pruebas comparan con el objeto Git BASE:

- JavaScript emitido de `textoCuadrilla`: idéntico.
- Declaraciones de los esquemas: idénticas (normalizando únicamente CRLF/LF).
- Cuerpos de Programación y helpers fuera de imports: idénticos.
- Esquemas reales BASE/HEAD con la misma versión de Zod: mismos resultados y
  mensajes, incluidos externos/internos inválidos, duplicados y límites 200/201.
- Exportaciones históricas y nuevas: misma función/mismo valor.
- Grafo estático inicial: ya no alcanza los dos módulos de esquemas ni Zod;
  los módulos livianos no emiten imports runtime.

Los tests históricos se omiten si no existe el objeto BASE en un checkout
shallow; no hacen fetch. Los tests HEAD de wiring/reexports/grafo siguen activos.
En la validación local estuvieron disponibles todos los objetos y pasaron los 23.

## Bundle medido

Next 16.3.6, Node 20.20.2, npm 10.8.2, mismas dependencias y máquina Windows.
Se reconstruyó la BASE actualizada y se conservaron sus artefactos; los tamaños
de Programación coinciden con la BASE inicial. Build HEAD nuevo, sin reutilizar
`.next` de BASE. No se presentan tiempos de build como latencia productiva.

Se evalúa `page_client-reference-manifest.js` de Programación y se toman sus
`entryJSFiles` menos los del layout de empresa. Se suman bytes y gzip local por
archivo, sin contar dos veces un chunk. No incluye framework/runtime compartido,
layout, CSS, RSC, API ni las herramientas cerradas.

| JS específico inicial | BASE | HEAD | Reducción |
| --- | ---: | ---: | ---: |
| Bytes | 342381 | 55072 | 83,91 % |
| Gzip local | 83953 | 18291 | 78,21 % |
| Chunks | 3 | 2 | 1 |

BASE:
- `2pmbn-w31r5t1.js`: 24188 bytes / 8247 gzip.
- `3m0g799rg5szc.js`: 283465 bytes / 64625 gzip (Zod).
- `2cntrq8a_5w00.js`: 34728 bytes / 11081 gzip.

HEAD:
- `28qj4dnrqdnpy.js`: 20304 bytes / 7210 gzip.
- `0zmrp8wnwp8n0.js`: 34768 bytes / 11081 gzip.

Zod sale COMPLETAMENTE de esta entrada inicial específica, no del proyecto.
El loader diferido de PlanForm sigue referenciando `3m0g799rg5szc.js`, junto con
`3kmxlntzxc5pg.js` y `43fi9t50lfhyu.js`. Los esquemas/backend continúan usando
Zod normalmente. No se quita la dependencia ni se cambia la carga dinámica
preexistente. Se comprobaron grafo fuente, manifiesto y referencias compiladas;
no se basa la conclusión únicamente en buscar el nombre de una librería.

## Validación y riesgos

Comandos (Node 20 también para procesos hijos):

```text
vitest run programacion cuadrilla edicion-rapida plan-form rango-fechas rango-que-contiene --maxWorkers=4
vitest run --maxWorkers=4 --reporter=json --outputFile=<reporte-local>
tsc --noEmit
eslint <los siete archivos TypeScript modificados/nuevos>
git diff --check
npm run build
```

Nuevas: 23/23. Dirigidas: 1416 aprobadas / 10 fallos heredados, todos presentes
en la suite BASE; revalidadas también dentro de la suite completa tras el merge
de main. ESLint dirigido BASE y HEAD limpio. Builds BASE y HEAD exitosos
(exit 0); conservan los cuatro warnings de tracing de filesystem anteriores,
fuera del alcance, y los avisos existentes de middleware/Cache-Control.

Suite completa, misma máquina, Node/npm/dependencias y comando:

| Resultado | BASE actualizada | HEAD actualizado |
| --- | ---: | ---: |
| Aprobadas | 10980 | 11003 |
| Fallidas | 22 | 22 |
| Omitidas | 670 | 670 |

Fallos comparados por archivo relativo + `fullName` + primera línea del mensaje:
idénticos, cero nuevos y cero eliminados. Sin suites fallidas sin assertions.
Los 22 se distribuyen en Centro logístico (1), guards históricos de Compras (2),
contrato de esquema Vacaciones (1), `unzip` ausente en Windows (1), contrato
textual de vehículo solicitado (1), wiring de imagen Programación (1), montaje
Atracción talento (1), PATCH TC (7), PATCH tercerizados (1) y regreso
opcional/identidad de personal (6). No se corrigieron ni modificaron esos tests.
SHA-256 del conjunto ordenado de identidades de fallo:
`020d8973bfbecd866c841297abf1834ac6c713389949062b8db51c9cb639925e`.

TypeScript independiente (`tsc --noEmit`) HEAD: exit 0; TypeScript de ambos
builds: exit 0. Diff-check limpio. Los manifiestos canónicos de rutas
`app-paths-manifest.json` y `routes-manifest.json` son idénticos BASE/HEAD.
La primera suite HEAD sobre la BASE inicial se interrumpió al detectar el
avance de main; no se cuenta como validación completa. Se repitió completa con
la BASE nueva y el resultado anterior es el definitivo.

Archivos de la PR: `programacion-client.tsx`, `edicion-rapida-helpers.ts`,
`cuadrilla-contrato.ts`, `edicion-rapida-schema.ts`, los dos módulos livianos,
`programacion-dependencias-livianas.test.ts` y este documento (8 en total).

Riesgo bajo: separación de módulos, no reescritura de lógica. Los tamaños y
hashes de chunks pueden cambiar al actualizar Next. No se midió navegación
autenticada ni latencia productiva; el ahorro demostrado es de bytes/dependencias
iniciales. QA manual recomendado: entrar sin editores abiertos, abrir Nuevo,
Edición rápida y exportar Cuadrilla; Zod puede descargarse cuando realmente se
monta PlanForm, conservando validaciones. Sin SQL productivo ni merge.
