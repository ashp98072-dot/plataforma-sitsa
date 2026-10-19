# Hostinger: límite del pool de build (Next 16.3.6)

## Cambio mínimo

BASE: `1bc0a57a5aa6b326769185e2b6e830edea68858d`.
Se agrega únicamente `experimental.cpus: 1` a `next.config.ts`.
`npm run build` sigue ejecutando `next build`; no se cambian dependencias,
Turbopack, loaders, headers, compresión, rutas ni lógica funcional.

## Soporte y alcance exactos

Esta opción es **experimental**, no una API estable documentada con garantía de
compatibilidad futura. Se utiliza después de comprobar su funcionamiento en la
versión exacta instalada, no por analogía con versiones anteriores:

- [Esquema oficial v16.3.6](https://github.com/vercel/next.js/blob/v16.3.6/packages/next/src/server/config-schema.ts): acepta `cpus` numérico.
- [Build oficial v16.3.6](https://github.com/vercel/next.js/blob/v16.3.6/packages/next/src/build/index.ts): `getNumberOfWorkers()` utiliza `experimental.cpus`; el resultado configura el pool de recolección de páginas y prerender.
- El default instalado es `max(1, CPUs detectadas - 1)`, salvo override interno
  de CI. El log productivo de 63 workers es compatible con esa selección, pero
  no se midió el inventario de CPU ni la cuota de threads de Hostinger.
- `staticGenerationMaxConcurrency` limita trabajo dentro de cada worker; no
  limita el pool que falla durante recolección. No es un sustituto equivalente.
- `turbopackPluginRuntimeStrategy: "workerThreads"` existente corresponde a
  loaders, no a este pool. Se conserva intacto.

No se introducen variables privadas/no documentadas. El límite no garantiza un
solo thread total: Node, Rust/Turbopack y loaders pueden crear otros threads.
El error OS 11/SIGABRT señala agotamiento de recursos; la cuota exacta del host
no se reprodujo localmente. Debe verificarse el siguiente deploy antes de dar
por resuelto el incidente. Si persiste, revisar límites de procesos/threads con
Hostinger en lugar de añadir variables internas a ciegas.

## Comparación local BASE / HEAD

Misma máquina Windows, mismas dependencias, Next 16.3.6, Node **20.20.2** y npm
**10.8.2**, mismo comando `npm run build`, sin `.next` ni buildinfo de TypeScript
al iniciar cada pasada. Node portable oficial con checksum SHA256 verificado;
sin modificar la instalación global ni archivos package. Sin SQL productivo.

| Medida | BASE | HEAD |
| --- | ---: | ---: |
| Exit code | 0 | 0 |
| Workers de recolección | 11 | 1 |
| Workers de prerender | 11 | 1 |
| Tareas estáticas completadas | 54/54 | 54/54 |
| Tiempo total observado | 174,43 s | 93,27 s |
| Entradas app-paths | 465 | 465 |
| Entradas prerender estáticas | 11 | 11 |
| Reglas de headers | 7 | 7 |

Una sola ejecución por variante, BASE primero. Aunque ambas arrancan sin caché
de Next, cachés del SO y variabilidad local afectan tiempos: **no demuestra una
aceleración**, ni representa latencia de Hostinger. Reducir paralelismo puede
alargar builds en otras máquinas. El resultado demostrado es el límite real
de workers con Node 20 y que ambos builds completan.

Se comparó JSON canónico de `app-paths-manifest`, `routes-manifest`, headers y
formas de rutas prerender (sin secretos de preview ni timings): hashes iguales
BASE/HEAD. No se afirma identidad binaria de todos los artefactos.
Ambos conservan los cuatro warnings previos de tracing de filesystem, además
de avisos existentes de middleware/Cache-Control; no se corrigen en este ticket.

## Pruebas y reproducción

`src/next-config-build-workers.test.ts` ejecuta el selector real extraído del
paquete instalado y prueba defaults 11/63 frente al límite 1, además del caso
default 1. Valida también el esquema oficial, versión y configuración conservada.
El test falla deliberadamente al cambiar de versión para exigir nueva revisión.

```powershell
node --version # usar Node 20 también para los procesos hijos
npm --version
npm run build
npx vitest run src/next-config-build-workers.test.ts src/next-config-headers.test.ts --maxWorkers=2
npx eslint next.config.ts src/next-config-build-workers.test.ts
npx tsc --noEmit
git diff --check
```

Pruebas dirigidas: 12/12. El primer intento de Vitest en sandbox falló antes de
ejecutar tests por EPERM al renombrar su caché temporal; el mismo comando fuera
del sandbox pasó. No se ejecuta suite funcional completa: no cambia código de
negocio. Validación productiva pendiente: observar `using 1 worker` y finalización
del build sin SIGABRT. No requiere SQL, migración ni cambios de datos.
