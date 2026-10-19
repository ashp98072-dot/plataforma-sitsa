# Vacaciones: catálogo ligero de empleados

## Alcance y base

- Base inicial: `262081384e7ec6edd21dbaae6013a8fb187e942e`.
- Base de revisión final: `303ef2720c98f67d94d5368d16bcdcf87cb7f478`.
- Main se incorporó mediante merges normales (primero `092f68ff`, después `303ef272`), sin editar los cambios ajenos de Facturación/CxC/CxP. El diff contra main solo incluye los seis archivos de este ticket.
- Solo cambia el origen del catálogo de empleados de Vacaciones. No cambia saldos, solicitudes, aprobaciones, historial, alertas, cálculos ni UI.

## Discovery y equivalencia

La pantalla usa exclusivamente `id`, `codigo`, `nombre` y `dpi`. El endpoint anterior era `GET /api/empresas/[slug]/empleados`, sin parámetros: devuelve todos los empleados del tenant, sin filtro de estado ni límite, ordenados por `nombre`. Incluye activos, bajas e históricos.

El nuevo `GET /api/empresas/[slug]/rrhh/vacaciones/empleados` conserva ese universo y `ORDER BY nombre`; no añade desempate ni filtrado. Proyecta únicamente las cuatro columnas. La normalización de null/números conserva la del mapper anterior, sin trim adicional.

Se mantiene exactamente `requireTenantRrhh(slug, "empleados", "ver")`. No basta con `vacaciones:ver`, no hay fallback, ni empresa recibida del navegador. Los rechazos del guard se devuelven sin lecturas de datos. Caché: `private, no-store` en ambos endpoints.

El único cambio en la página es la URL. Permanecen intactos `EmpleadoPicker`, búsqueda por nombre/código/DPI, ranking, límite visual de 120 opciones, selección inicial del primer elemento y conservación de selección al recargar. El catálogo no tiene ese límite de 120.

No se reutiliza Supervisores: su universo Activo no es equivalente.

## Consultas y compatibilidad heredada

El catálogo anterior ejecuta una lectura de empleados, dos agregaciones de documentos/foto y, si no está cacheada, una lectura de configuración. El nuevo ejecuta una lectura de cuatro columnas y no usa documentos, fotos ni configuración.

Ambos mantienen la misma llamada heredada `asegurarSchemaEmpleados().catch(...)`. Ese helper existente puede consultar metadata e intentar preparación DDL al arrancar en esquemas antiguos. No se cambia ni se añade bootstrap nuevo; eliminarlo sería otro alcance. Las cifras siguientes excluyen guard y bootstrap compartidos. Las pruebas simulan la BD y el bootstrap; no se ejecutaron contra producción ni se cambió SQL/esquema/migraciones.

## Medición reproducible sintética

Fixture de 104 empleados, incluyendo bajas; handlers reales con consultas simuladas, mapper/configuración/documentos reales y misma proyección visible. Node 20.20.2, npm 10.8.2.

| Métrica | Endpoint anterior | Catálogo ligero |
| --- | ---: | ---: |
| JSON, bytes | 108.510 | 8.955 |
| gzip local, bytes | 2.413 | 1.104 |
| Campos por empleado | 54 | 4 |
| Requests de catálogo por invocación de carga | 1 | 1 |
| Consultas de datos, configuración sin caché | 4 | 1 |
| Consultas de datos, configuración cacheada | 3 | 1 |

JSON: reducción de 91,75 %. gzip: reducción de 54,25 %. La compresión es una medición local, no una afirmación de transferencia gzip en Hostinger. No se afirma que la pantalla completa haga un único request: sus demás cargas no cambian.

La última ejecución de 20 muestras dio medianas de 3,30 ms y 0,84 ms (reducción local aproximada del 74,5 %). Incluye mocks, aserciones y serialización; varía con la carga local y no mide SQL real, red ni latencia productiva. No es un umbral de aprobación.

Reproducir la medición:

```powershell
npx vitest run src/lib/rrhh/vacaciones-empleados-catalogo.test.ts --maxWorkers=1 --testNamePattern 'mide ambos'
```

## Pruebas y validación

Las pruebas comparan el endpoint anterior y el nuevo en los mismos escenarios: universo/orden, búsquedas, nulls, más de 120 empleados, vacío, error de lectura, tenant resuelto por guard, rechazo de permisos y configuración cacheada/no cacheada. Las pruebas de wiring ejecutan el callback real de la página BASE y HEAD, comparan eventos de carga/selección y comprueban que todo el archivo solo difiere en la URL.

En clones shallow sin el objeto Git BASE, la comparación de fuente histórica se omite; las pruebas del endpoint y wiring HEAD siguen ejecutándose. En esta validación local está presente el objeto BASE.

### Resultados BASE/HEAD

Misma máquina, Node 20.20.2, npm 10.8.2, mismas dependencias y comando de suite completa `vitest run --maxWorkers=4 --reporter=json`:

| Suite completa | Aprobadas | Fallidas | Omitidas |
| --- | ---: | ---: | ---: |
| BASE `303ef272` | 11.037 | 22 | 689 |
| HEAD | 11.057 | 22 | 689 |

Los 22 fallos coinciden por archivo + `fullName` + primera línea del mensaje; no hay suites fallidas sin tests fallidos adicionales. Cero regresiones nuevas. Incluyen Centro logístico, dos guards de Compras, dependencia `unzip` ausente en Windows, contrato de vehículo solicitado, contrato textual de esquema de vacaciones, wiring de imagen, Atracción de talento y pruebas PATCH heredadas de TMS. No se modifican esos tests ni sus módulos.

La comparación intermedia sobre `092f68ff` tuvo 23 fallos idénticos BASE/HEAD: el adicional era el escaneo de fuentes de `factura-emitida`, que registró `STACK_TRACE_ERROR` y duraciones de 35–42 segundos. En la BASE final ese test pasó en 3,6 segundos y también pasa en HEAD final. No se modificó para conseguir verde.

- 20/20 tests nuevos aprobados.
- Dirigida `vacaciones empleados empleado-picker busqueda-personas supervisores`: 970 aprobadas / 1 fallida / 0 omitidas; el único fallo es el contrato textual del esquema de vacaciones, también fallido en BASE. Esa misma composición se ratificó para sus archivos dentro de la suite HEAD final.
- TypeScript independiente (`tsc --noEmit`): PASS.
- ESLint dirigido de los cinco archivos TS/TSX: PASS.
- ESLint global adicional, antes de incorporar #497/#498: 40 errores / 0 warnings, todos fuera de los archivos tocados; no se corrige deuda ajena. Después de incorporar esos merges se repitió ESLint dirigido de todos los archivos TS/TSX de este ticket: PASS.
- `git diff --check`: PASS.
- Build BASE intermedia (`092f68ff`): PASS. Build HEAD final sobre `303ef272`: PASS.

El primer build HEAD compiló pero se interrumpió durante TypeScript con un código nativo de Windows `0xC0000005`, sin diagnóstico TypeScript. La repetición sin suite ni lint concurrentes pasó, al igual que el build final tras incorporar `303ef272`. No se cambió configuración/código para ocultarlo.

## Riesgos y QA posterior

- Riesgo acotado a la nueva ruta y su proyección; se conserva el endpoint general para otros consumidores.
- El arranque en frío conserva el costo de preparación heredado, fuera del ahorro medido.
- La pantalla todavía carga el catálogo completo y conserva sus disparos de carga existentes: no se introduce paginación, deduplicación global ni cambios de hooks.
- QA autenticado posterior: buscar por nombre/código/DPI, seleccionar histórico, recargar, cambiar tenant y comprobar 403 sin `empleados:ver`.
- Sin SQL productivo, migraciones, datos reales ni merge de PR.
