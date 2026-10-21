# Planes / Viajes — catálogo ligero de filtros

## Base y alcance

BASE: `bf19db81ac239680ffcaab4b90ed9615637636b4` (main al iniciar).
Rama: `codex/planes-catalogo-filtros`. Sin merge, migraciones ni ejecución SQL productiva.

## Discovery

En `src/app/e/[slug]/planes/planes-viajes-client.tsx` los únicos consumidores del catálogo son:

| Dato | Propiedades usadas | Uso |
| --- | --- | --- |
| clientes | id, nombre | opciones del filtro Cliente |
| unidades TMS | id, placa | opciones del filtro Unidad |
| personal tipo exactamente Piloto | id, nombre | opciones del filtro Piloto |

Ruta es texto libre (código o destino); no carga un catálogo de rutas. Estado, estado de facturación y estado de cobro proceden de constantes locales. Las filas, KPI, snapshots y detalles proceden del reporte/expediente, no de este catálogo. Lugares, Flota accesible y perfiles de vehículo solicitado no se usan aquí.

## Cambio

Nuevo GET privado `/api/empresas/[slug]/tms/planes/catalogos` devuelve únicamente:

```text
clientes: [{ id, nombre }]
unidades: [{ id, placa }]
pilotos: [{ id, nombre }]
```

Usa el mismo `requireTenantProgramacionOTms(slug)` del catálogo anterior, antes de leer datos, y la empresa resuelta por el guard. No acepta una empresa enviada por query string. Conserva `Cache-Control: private, no-store`, sin caché compartida.

El endpoint global `/tms/catalogos` NO cambia. Programación y otros consumidores quedan intactos. En el frontend solo cambian tres líneas: URL, propiedad de pilotos y tipo local (ya no necesita tipo).

### Equivalencia preservada

- Incluye activos e inactivos como BASE; no introduce filtros de estado.
- Clientes: orden TMS por nombre, nombre compartido preferido cuando existe vínculo. El último vínculo en el orden del catálogo compartido prevalece, como el Map anterior. También conserva el nombre vacío y fallback si el módulo compartido falla.
- Unidades: conserva identidad `tms_unidades.id` y orden por placa (no sustituye por Flota).
- Pilotos: conserva orden por nombre y comparación JS exacta `tipo === "Piloto"`; no la reemplaza por igualdad SQL dependiente de collation.
- No cambian filtros seleccionados, labels, limpieza, pestañas, query params/deep-link, cierres, facturación/cobros, paginación ni filtros de exportación Excel.
- No modifica permisos, sesiones ni guard global.

## Preparación en frío y riesgo conocido

Se reutiliza deliberadamente el puente existente: `asegurarSchemaClientes`, `asegurarModulosClientesFacturacion`, `asegurarVinculosTmsClientes`. Quitar ese puente podría omitir clientes activos recién vinculados en instalaciones existentes. El intento adicional de asegurar esquema durante la lectura compartida mantiene la tolerancia/reintento de BASE.

Estos helpers heredados pueden ejecutar bootstrap y vinculación en frío (incluidas escrituras existentes). Esta PR NO agrega un algoritmo de escritura, migración ni limpieza de datos. No se ejecutaron estos helpers contra producción: las pruebas mockean esa preparación. El costo frío depende del esquema y vínculos pendientes; no se presenta como costo fijo ni se incluye en la cifra de consultas calientes.

## Medición reproducible

Test: `src/app/api/empresas/[slug]/tms/planes/catalogos/route.test.ts`, caso «mide JSON y queries con 104 elementos sintéticos por catálogo».

Ejecuta ambos handlers reales con el mismo mock de BD y los loaders reales de lectura del catálogo anterior. Mockea guard y preparación de esquema/vínculos. Crea 104 clientes, unidades, pilotos, lugares, vehículos y perfiles; compara la proyección por igualdad profunda. No mide latencia productiva ni usa datos reales.

| Métrica | BASE | HEAD |
| --- | ---: | ---: |
| Requests propios al entrar (catálogo + reporte, sin shell/detalles) | 2 | 2 |
| Consultas de datos del catálogo caliente, sin guard/bootstrap | 7 | 4 |
| JSON UTF-8 sin compresión | 57.225 bytes | 9.167 bytes |
| Colecciones de respuesta | 6 | 3 |
| Campos por cliente / unidad / piloto retornado | 6 / 6 / 7 | 2 / 2 / 2 |

JSON: **−83,98 %**. Consultas: **−42,86 %**. Además se eliminan del flujo dos subconsultas correlacionadas de conteo de contactos en `listarClientes` (no eran round trips separados), el mapper completo de clientes y la lectura de atributos de Flota. La cifra 7 de BASE supone la primera consulta de Flota exitosa; BASE puede reintentar si faltan columnas/tablas. HEAD no consulta Flota.

No se reportan milisegundos de mocks como latencia de SQL ni promesa de mejora productiva. No cambia sustancialmente el bundle: el objetivo es trabajo backend y payload.

## Pruebas y verificación

- Comparación de ambos endpoints: orden, inactivos, alias/último vínculo, fallback, vacío, igualdad exacta de tipo Piloto, proyecciones y conteo de consultas.
- Guard: propaga 401/403/404 sin lecturas; tenant proviene del guard incluso con empresa ajena en URL; todas las consultas se filtran por empresa.
- Wiring frontend: ejecuta el callback real extraído del AST y el efecto BASE con mocks de fetch; mismas opciones y fallback, una petición, recarga por slug, no escribe filtros seleccionados. Ejecuta el constructor real de filtros y verifica ids, ruta, facturación/cobro y deep-link. Tests existentes cubren exportación y pestañas.
- No se afirma QA manual con navegador/BD real; queda recomendado comparar Network y opciones con una sesión autorizada después del despliegue.

Validación sobre la misma BASE, máquina, Node/npm y dependencias:

- Dirigidas Planes/catálogo/Excel: **137/137**, incluidos **14 tests nuevos**.
- Suite completa BASE: **10.852 pass / 22 fail / 599 skip**.
- Suite completa HEAD: **10.866 pass / 22 fail / 599 skip**.
- Identidad de los fallos comparada por archivo relativo, `fullName` y primera línea del mensaje: **idéntica**, sin fallos nuevos/eliminados ni suites fallidas sin assertions. No se modificaron los tests heredados.
- TypeScript BASE y HEAD: limpio. ESLint dirigido BASE y HEAD: limpio. Diff-check: limpio.
- Build BASE y HEAD: exitosos (exit 0). El primer intento HEAD sufrió salida nativa Windows `-1073741819` durante recolección de páginas; repetido aisladamente, completó sin cambios de código. Ambos conservan avisos heredados de middleware, Cache-Control y tracing de filesystem.

Los 22 fallos heredados se distribuyen en Centro logístico (1), guards históricos de Compras (2), contrato de esquema Vacaciones (1), `unzip` ausente (1), contrato textual de vehículo solicitado (1), wiring de imagen Programación (1), montaje Atracción talento (1), PATCH TC (7), PATCH tercerizados (1) y regreso opcional/identidad de personal (6). Están fuera de alcance; se compararon en esta ejecución, no por una medición histórica.

## Fuera de alcance

Sin índices, SQL/esquema, paginación, prefetch, caché global, Programación, Contabilidad, Empleados o refactors adicionales. Se preservan los cambios ajenos del checkout principal.
