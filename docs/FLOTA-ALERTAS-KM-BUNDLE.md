# Rendimiento navegación — helpers de Flota sin ExcelJS

## Alcance

BASE actualizada y validada: `63531dbc44784463a0496919625e6550597eeb66`.
Rama: `codex/flota-alertas-km-ligero`.

Solo se trasladan `kmPendienteServicio` y `estiloAlertaKm` a
`src/lib/flota/alertas-km.ts`, sin imports ni efectos de módulo.
Flota importa desde ese archivo. `import-excel.ts` mantiene reexports
compatibles y su import original de ExcelJS para las operaciones Excel.
No se modificaron rutas API, hooks, permisos, cálculos, textos, clases,
estado, datos, dependencias, configuración, SQL ni migraciones.

Main se incorporó con merge normal, sin rebase ni conflictos:
`e570585aa1741aac093a2aa17c63b912a9152ebd`.
Padres: `f96a97e4d736124496bed7ad36aadb8a259113b2` y
`63531dbc44784463a0496919625e6550597eeb66`.
Los 48 archivos de #485 (Programación/Planes) están idénticos a la nueva BASE.
El diff de #487 sigue limitado a sus cinco archivos; cero commits detrás.

## Equivalencia

Las dos declaraciones movidas son textualmente idénticas a BASE.
También es idéntico el JavaScript emitido por TypeScript (ES2022/CommonJS):
SHA-256 `baf078bab7ff7d34fd63260c7ac3f3cbe88678b0366a367d842e9db1d9aac22f`.

25 pruebas nuevas cubren:
- antes/en/después del servicio, último servicio nulo, km actual nulo,
  intervalo habitual 5000 desde la constante del caller, personalizado,
  cero, valores fraccionarios y lectura menor al último servicio;
- todos los rangos de alerta: null, vencido/0, crítico hasta 500,
  próximo hasta 1500 y normal desde 1501;
- clases CSS, textos, footer y formato numérico es-GT;
- reexports como las mismas funciones, módulo ligero sin imports
  y wiring del cliente;
- generación de un XLSX real con `generarPlantillaFlota()` y lectura con
  `parsearExcelFlota()`, verificando placa, km, intervalo, marca y modelo.

No se añadió un default implícito al helper: sigue recibiendo el intervalo.
El default de 5000 continúa perteneciendo al caller.

## Bundle BASE / HEAD

Build local Next 16.3.6, Node 24.18.0, npm 11.16.0.
BASE y HEAD se compilaron de nuevo en worktrees separados con las mismas
versiones de dependencias, sin .env productivo. No se reutilizaron los
artefactos de la comparación anterior para estas mediciones.

Se inspeccionó
`.next/server/app/e/[slug]/flota/page_client-reference-manifest.js`:
los entryJSFiles de la página menos los del layout compartido identifican
el wrapper; sus referencias compiladas a chunks identifican los dos
archivos que se cargan inmediatamente al montar FlotaClient.
No se incluyeron módulos hijos opcionales, runtime compartido, CSS, RSC ni datos.

| Medida | BASE bytes | HEAD bytes | Reducción |
| --- | ---: | ---: | ---: |
| Dos chunks dinámicos de FlotaClient | 1070464 | 117104 | 89,06 % |
| Mismos chunks, gzip local | 291363 | 28796 | 90,12 % |
| JS específico incluyendo wrapper | 1075121 | 121761 | 88,67 % |
| JS específico incluyendo wrapper, gzip | 293075 | 30509 | 89,59 % |

BASE:
- wrapper: `36i1bwg2xjzz6.js`;
- dinámicos: `1u1q0h5c89x-k.js`, `0is9gfmu039q1.js` (incluye ExcelJS).

HEAD:
- wrapper: `0h39hthz43uaj.js`;
- dinámicos: `1u1q0h5c89x-k.js`, `0l8us5xvjqck_.js`;
- ninguno contiene ExcelJS;
- el trace `server/app/api/empresas/[slug]/flota/import/route.js.nft.json`
  sigue incluyendo ExcelJS; la importación/exportación permanece server-side.

Se conservan dos chunks dinámicos; no se afirma reducir su número.
No cambian requests API. Gzip es una medición local aproximada, no bytes
observados en Hostinger ni una medición de latencia productiva.

## Validación

- Nuevas: 25/25.
- Dirigidas Flota (lib/componentes/página/API): 576 pass / 0 fail / 72 skip.
- Completa BASE nueva exacta: 10815 pass / 22 fail / 599 skip.
- Completa HEAD actualizado: 10840 pass / 22 fail / 599 skip.
- Comando completo: `node node_modules/vitest/vitest.mjs run --maxWorkers=4 --reporter=json`.
- Comparación de fallos por archivo + fullName + primera línea del mensaje:
  idénticos; cero nuevos y cero eliminados.
- ESLint dirigido: módulo ligero, pruebas e import-excel limpios.
  Flota conserva exactamente ocho errores preexistentes
  `react-hooks/set-state-in-effect` en 529, 533, 590, 931, 946, 963, 974 y 994;
  comparación BASE/HEAD de regla, línea, columna, mensaje y severidad idéntica.
  No se intentó corregirlos ni deshabilitarlos.
- Builds BASE/HEAD: exit 0, con los cuatro warnings de tracing existentes fuera del alcance.
- TypeScript independiente (`tsc --noEmit`) BASE/HEAD: exit 0; diff-check: OK.

La primera ejecución del pipeline BASE terminó con error nativo de Windows
`-1073741819` después de generar los artefactos. No se contó como aprobada:
la repetición aislada confirmó build y TypeScript con exit 0, sin cambios de código.

Los 22 fallos heredados incluyen guards antiguos de Compras sensibles al diff,
unzip ausente en Windows, contratos de fuente de RRHH/centro logístico/
Programación/reclutamiento y casos PATCH de Programación. No se tocaron.

## Riesgos y QA posterior

Cambio puramente estructural, con equivalencia de funciones y contratos probada.
No se midió navegación autenticada en navegador en este ticket.
Después del despliegue conviene verificar Network con caché fría:
entrada a Flota, alertas en bordes 0/500/1500, cambio de pestaña y
generación/importación de plantilla. No convertir bytes de bundle en una
promesa de reducción equivalente de tiempo de navegación.

Sin SQL productivo, datos reales ni merge.
