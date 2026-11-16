# #624 después del merge de #623 — cierre para auditoría

Base comprobada: `main` **ccfed468794d154ae6efa250280b9a57e6a37d58**, merge normal de #623. #624 incorpora esa base mediante el merge normal **427165b756dd6ce0bd4460d91de5264d3271aee1**, con el head anterior de #624 como primer padre y main como segundo padre. Sin rebase, squash ni merge del PR. Código corregido y probado: **f679ff71166f5d7a61bbd82d9a74d26c39a06ddb**. Los commits posteriores de esta entrega agregan evidencia y documentación.

## Resolución y conservación

Se resolvieron los cinco solapamientos en `service.ts` y `terceros.db.test.ts` con los dos archivos exactos de la composición previamente auditada. El árbol del merge es **00d4845a38f761e74b67bef74236ad0fabcadffd**, idéntico al árbol final aprobado para la simulación anterior. Conserva ambos imports, `perfil` y validaciones de Shell, normalización/equivalencias de unidad, comparación de piloto y vehículos históricos, y completas las dos pruebas MariaDB.

[Diff exacto del merge y resolución](../evidence/pr624-post623/resolution.diff). Después del merge solo cambiaron el handler TMS, cuatro archivos de pruebas y un modelo SQL de pruebas; no se alteraron las funcionalidades Shell de #623 ni los resolvedores de identidad física/canónica ya auditados.

## Investigación individual de los cinco fallos

| Caso original | Causa comprobada | Corrección |
|---|---|---|
| POST unidad normal con TC, `programacion-tc.test.ts` | El doble devuelve cero empresas para el nuevo SELECT empresarial con bloqueo; además carece de lecturas Flota/catálogo TMS y búsqueda del ID insertado. | Modelar empresa 7, vehículo 10 activo y persistencia/consulta de unidad en la conexión de pruebas. Se mantiene 200 y snapshots TC originales. |
| POST regreso vacío/ausente con placa, `regreso-opcional.test.ts` | El doble de traslapes solo conoce personal y omite la empresa y el catálogo TMS necesarios para la unidad sin vínculo Flota. | Modelar esas consultas y el INSERT/SELECT de la unidad con FK NULL. Se mantiene el contrato de regreso opcional. |
| PATCH unidad en taller, mañana, `route-patch-equivalencia.test.ts` | El doble reconoce GET_LOCK/RELEASE_LOCK, pero no el bloqueo empresarial ni la identidad de la unidad 77. | Modelar empresa, Flota y unidad; se conservan 409 para hoy, 200 para mañana y la advertencia original. |
| PATCH unidad en ruta, mañana, mismo archivo | Mismo doble SQL incompatible; el error del resolvedor cae en la respuesta genérica 500. | Mismo modelo, conservando 409 para hoy, 200 para mañana y advertencia/piloto originales. |
| PATCH cambio de unidad sin cambiar vehículo solicitado/tarifa, `vehiculo-solicitado.test.ts` | El doble no responde a las consultas nuevas del resolvedor. | Modelar vehículo 77 y catálogo TMS. Se mantiene 200, nuevo unidad_id y ausencia de cambios de vehículo solicitado/tarifa. |

Los **cinco son dobles SQL incompatibles**, no expectativas legítimamente obsoletas. Pasan con `resolverUnidadTms`, `resolverUnidadTmsTx` y `resolverUnidadCanonica` **reales**. No se mockean estos módulos ni se usa el adaptador antiguo de upsert. `unidad-canonica-sql.fixture.ts` modela exclusivamente E/S: empresa, vehículos y unidades; representa un esquema sin alias/maestro físico instalado y delega las otras consultas al modelo original de cada handler. Los esquemas con alias, identidades físicas y guardas se verifican en MariaDB real.

No se eliminó ni cambió ninguna de las **335 líneas de aserciones originales** de esos cuatro archivos. Tampoco se omitieron pruebas. [Cinco casos y resultados](../evidence/pr624-post623/five-cases.json), [comprobación de expectativas conservadas](../evidence/pr624-post623/expectations-preserved.json).

## Defecto funcional relacionado, también corregido

La investigación descubrió además que los handlers no conservaban el contrato de errores del resolvedor: POST dejaba escapar `ErrorCB2` antes de la transacción de alta; PATCH lo convertía en 500 tras rollback. Ahora ambos devuelven su estado HTTP y mensaje controlado, incluidos **403** por empresa no vigente y **409** por identidad ambigua. Los errores inesperados mantienen su tratamiento anterior.

Cuatro regresiones nuevas ejecutan los resolvedores reales contra el modelo SQL: POST/PATCH × 403/409. Las cuatro fallaron antes de la corrección; ahora pasan, comprueban rollback y ausencia de INSERT/UPDATE de planes. Los casos POST también comprueban que no se inserten nuevas unidades. No se cambió el criterio de elección/bloqueo del resolvedor para hacerlas pasar. Esta cobertura HTTP usa E/S simulada explícita; no se afirma que los handlers completos se hayan ejecutado en MariaDB.

## Verificación final

| Comprobación | Resultado |
|---|---|
| main ccfed468, seis archivos TMS históricos | 139 aprobadas, 15 fallidas |
| #624 actualizado, CB2/TMS dirigida | **1328 aprobadas, 15 fallidas, 50 omitidas por compuertas** |
| Conjunto de fallos finales frente a main | **Exactamente los mismos 15 nombres; cero fallos nuevos** |
| Cinco casos propios del PR original | **5/5 aprobados**, expectativas conservadas |
| Nuevas regresiones HTTP | **4/4 aprobadas**, con evidencia roja anterior |
| MariaDB real 11.8.9 | **38/38 aprobadas** |
| TypeScript, ESLint de 37 archivos de código, build completo, diff-check | **Código 0** |
| npm ci offline, dependencias propias del package-lock | **Código 0** |

La suite dirigida devuelve código 1 por los **15 fallos históricos**. No se presenta como completamente verde. Se compararon contra una exportación exacta del nuevo main, sin reemplazar módulos en runtime. Se conservaron fuera del alcance sus validaciones/expectativas: 14 escenarios PATCH y un conteo de consultas del catálogo. [Comparación individual](../evidence/pr624-post623/historical-comparison.json).

MariaDB usa datadir nuevo, named pipe aleatorio, `skip-networking=1`, sin `.env` ni conexión productiva; cierre del servidor comprobado. Prueba identidades físicas, alias, unicidad, empresa, concurrencia, referencias históricas y resolvedor TMS. Las 50 omisiones de la suite unitaria corresponden a compuertas de entorno; las 38 pruebas reales se ejecutaron aparte con el entorno del laboratorio.

[Resumen, SHA y hashes de reportes/logs](../evidence/pr624-post623/summary.json). Los reportes completos permanecen en `.lab-runtime`; no se publican datadirs, respaldos ni configuración privada. El aviso de deprecación middleware/proxy del build se conserva sin cambiar configuración.

Comando MariaDB:

```text
node scripts/ci/cb2-identidades/run-windows.mjs --run-isolated <motor-verificado> scripts/ci/pricesmart-api06a/engine-manifest.json
```

Suite dirigida: `src/lib/flota/cb2`, `src/components/flota/cb2`, catálogo canónico TMS, importación de planes/TC/unidad, edición rápida/viáticos, copia/lote, Excel, rutas de planes y copia. Se ejecutó con `--maxWorkers=2 --testTimeout=20000`; no se ejecutó toda la suite general ajena a este alcance.

No se hizo merge de #624, SQL productivo, deploy ni cambios de flags. Se publica únicamente la actualización del mismo PR Draft y se detiene para auditoría independiente de ChatGPT.
