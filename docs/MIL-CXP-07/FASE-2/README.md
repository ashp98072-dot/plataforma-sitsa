# MIL-CXP-07 — Fase 2: corrección controlada de H-01

Fecha: 2026-11-06 (Guatemala). Rama `feature/mil-cxp07-permisos-fiscales`; base `b350cac75bb698719fb8b79f8c0082fd8623482b`. **Implementado y verificado técnicamente mediante pruebas aisladas. Pendiente de auditoría independiente, integración y aprobación operativa.** Sin commit, push, PR o merge.

## Resultado

Un lector de facturas conserva HTTP 200 y el catálogo comercial de proveedores, pero recibe `fiscal:null` para todos ellos. El servidor no consulta ni proyecta el maestro fiscal sin el permiso efectivo `cxp_proveedor_fiscal:ver`. Fiscal/Admin conservan configuración completa; ninguno sigue recibiendo 403. No se añaden permisos, no se modifican roles y no se amplía el permiso de registrar facturas: `ver` no concede `editar`.

La prueba que fallaba de forma esperada en Fase 1 ahora es una regresión normal que pasa. **No quedan `it.fails` ni fallos esperados en la suite.** Las rutas fiscales directa y de cuentas conservan sus denegaciones.

## Archivos funcionales modificados exactamente

| Archivo | Cambio y motivo |
| --- | --- |
| `src/lib/contabilidad/cxp/http.ts` | Sólo `listarProveedoresHttp`: comprueba ambos permisos mediante `requireTenantCxp`; conserva el acceso OR al catálogo y pasa la capacidad fiscal calculada en servidor. No lee permisos/capacidades de query string |
| `src/lib/contabilidad/cxp/proveedor-fiscal.ts` | Sólo `listarProveedoresCxp`: opción interna `verFiscal=false` por defecto; sin capacidad, SELECT comercial sin JOIN/columnas fiscales y `fiscal:null`. Con capacidad, conserva JOIN por empresa/entidad/proveedor y mapeo existentes |
| `src/components/contabilidad/cxp-client.tsx` | Facturas/Pagos seleccionan por estado comercial `p.activo`, sin leer `fiscal.activo`. Pestaña Proveedores muestra columnas fiscales y edición únicamente con permiso de ver fiscal; no interpreta el null oculto como «Sin configurar» |

Cambios de pruebas:

- `src/lib/contabilidad/cxp/mil-cxp07-h01.test.ts`: suite nueva de la Fase 1, convertida a regresión de Fase 2; matriz real en proceso y controles de consultas/proyección, defaults restrictivos, privacidad entre libros y compatibilidad V2/legado.
- `src/lib/contabilidad/cxp/mil-cxp07-consumidores.dom.test.ts`: nueva suite DOM happy-dom para selectores y consumidores del listado.
- `src/lib/contabilidad/cxp/cxp-m3a.db.test.ts`: únicamente dos llamadas pasan `{ verFiscal:true }` explícito para conservar el contrato de esa prueba de servicio autorizado. **No se ejecutó esta suite DB ni sus migraciones.**

No se modificaron `tenant.ts`, catálogo/resolución de permisos, cálculo fiscal, facturas/pagos de servicio, escrituras fiscales, migraciones, esquema, manifiestos de dependencias, reportes/instantáneas de H-02 ni MIL-CXP-06. No se editaron otros worktrees ni el workspace principal.

## Contrato antes/después

| Perfil efectivo | Antes: listado | Después: listado | GET config / cuentas |
| --- | --- | --- | --- |
| Ambos | 200 y fiscal completo | 200 y fiscal completo | 200 / 200 |
| Sólo Facturas | **200 y fiscal completo sin autorización fiscal** | **200, campos comerciales y `fiscal:null`; sin consulta fiscal** | 403 / 403 |
| Sólo Fiscal | 200 y fiscal completo | 200 y fiscal completo | 200 / 200 |
| Ninguno | 403 | 403, sin consulta de proveedores | 403 / 403 |
| Admin | 200 y fiscal completo | 200 y fiscal completo | 200 / 200 |

Campos comerciales conservados: `id`, `nombre`, `nit`, `diasCredito`, `activo`. El `activo` sigue siendo exclusivamente el del maestro comercial. Campos de configuración protegidos: régimen, sujeción ISR, cuentas y estado/existencia de configuración fiscal; el objeto completo queda inaccesible en este listado sin capacidad fiscal.

El servicio mantiene el nombre y forma de respuesta (`fiscal` completo o null); no introduce indicadores nuevos. La capacidad `verFiscal` es sólo argumento interno derivado del guard. En modo V2, un bit de edición fiscal no reabre una lectura denegada explícitamente. En modo legado se respeta la inferencia de lectura por edición existente en `tienePermiso`; no se redefine la política central.

Ejemplo posterior reproducible: [regresion-h01.json](regresion-h01.json). Contiene HTTP 200 para catálogo comercial, 403 para ruta fiscal directa, payload sin configuración y consulta interceptada sin referencias al maestro fiscal.

## Selectores: decisión de contrato y alternativas

Se eligió **selección basada únicamente en el catálogo comercial activo**, de forma independiente a los permisos fiscales. No se publica un indicador `configuracionFiscalActiva`, ni se filtra el catálogo según configuración oculta: ambos revelarían indirectamente su existencia/estado.

Esto evita vaciar los selectores al ocultar el objeto fiscal y mantiene seleccionables a los proveedores legítimos. La configuración sigue validándose en los servicios existentes al calcular/registrar facturas. No se retira un control de escritura ni se cambia la definición de proveedor válido. Para pagos, la selección sigue cargando las facturas del proveedor en la entidad y el servicio mantiene sus controles de aplicaciones/proveedor/estado/saldo.

**Diferencia de experiencia explícita:** los proveedores activos sin configuración o con configuración fiscal inactiva también pueden aparecer en el selector. Si no cumplen las condiciones del servicio, la operación recibe el rechazo existente; no se habilitan escrituras nuevas. No se ha redefinido la elegibilidad contable. Esta diferencia también se aplica a lectores fiscales para que la selección comercial no dependa del nivel de acceso al maestro.

Alternativas no implementadas: indicador operativo mínimo, o catálogo filtrado por configuración. Requieren decidir expresamente si la divulgación de elegibilidad/existencia está autorizada. No se ampliaron permisos ni se asumió esa autorización. El revisor puede pedir otro contrato de UX antes de integrar, manteniendo la corrección de confidencialidad.

## Pruebas ejecutadas

| Comprobación | Resultado |
| --- | --- |
| Focalizadas H-01, consumidores y HTTP existente | **93/93 PASS**, 3 archivos, exit 0 |
| Regresión CxP offline | **368/368 PASS**, 22 archivos, exit 0; cero fallos esperados |
| Matriz de seguridad en proceso | 62 casos de H-01, incluidos los cinco perfiles y las tres rutas, defaults, V2/legado y ámbito |
| Consumidores DOM | 6 casos PASS: selección de facturas, pagos y carga de facturas por proveedor, tabla comercial, lector fiscal/editor, antigüedad y estado de cuenta |
| TypeScript global | `--noEmit --incremental false`: exit 0 |
| ESLint de los seis TS/TSX afectados | `--max-warnings 0`: exit 0 |
| `git diff --check` | Exit 0; sólo cuatro archivos rastreados modificados (tres funcionales y un test DB) |

Comandos desde este worktree:

```powershell
node node_modules/vitest/vitest.mjs run src/lib/contabilidad/cxp/mil-cxp07-h01.test.ts src/lib/contabilidad/cxp/mil-cxp07-consumidores.dom.test.ts src/lib/contabilidad/cxp/cxp-http.test.ts --no-file-parallelism --reporter=verbose
node node_modules/vitest/vitest.mjs run src/lib/contabilidad/cxp --exclude '**/*.db.test.ts' --no-file-parallelism --reporter=verbose --reporter=json --outputFile=docs/MIL-CXP-07/FASE-2/regresion.json
node node_modules/typescript/bin/tsc --noEmit --incremental false
node node_modules/eslint/bin/eslint.js src/lib/contabilidad/cxp/http.ts src/lib/contabilidad/cxp/proveedor-fiscal.ts src/components/contabilidad/cxp-client.tsx src/lib/contabilidad/cxp/mil-cxp07-h01.test.ts src/lib/contabilidad/cxp/mil-cxp07-consumidores.dom.test.ts src/lib/contabilidad/cxp/cxp-m3a.db.test.ts --max-warnings 0
git diff --check
```

Las pruebas usan los Route Handlers, tenant/CxP guard, resolución de permisos y mapeo reales en proceso. Se sustituyen sesión, fuente de empresas/membresías y frontera de consultas con fixtures sintéticos; `getPool` falla si se intenta abrirlo. Las aserciones comprueban filtros/parámetros y ausencia de columnas/tabla fiscal en la consulta del perfil restringido; no ejecutan SQL. Los tests DOM verifican React montado en happy-dom, sin servidor HTTP ni navegador real.

## Riesgos y pendientes

- No hay nueva validación en motor SQL, middleware, JWT/cookies reales ni QA visual de navegador. La prueba de servicio DB ajustada queda pendiente para un laboratorio expresamente autorizado. No se debe presentar el doble de consultas como certificación del motor.
- Se conserva la política central por empresa/libro; no se implementa autorización adicional usuario–entidad. La observación previa de entidad ajena/inexistente que devuelve 200/null sigue pendiente; no se soluciona en H-01 ni se atribuye a H-02. El catálogo comercial sin permiso fiscal es propio de la empresa y común a sus libros; el JOIN autorizado conserva los filtros de entidad.
- El límite existente de 300 proveedores continúa. No se agregan paginación, permisos de sólo pagos sobre el catálogo ni cambios de catálogos.
- La configuración fiscal ya autorizada puede seguir apareciendo en la ruta específica y en el listado para Fiscal/Admin. Los importes/snapshots de facturas no se cambian: H-01 protege el maestro fiscal actual, no redefine el acceso al documento de factura.
- H-01 queda **corregido localmente y probado de forma aislada**, pendiente de dictamen independiente e integración; no aprobado para producción. **H-02 permanece abierto y sin cambios.** M-3A/M-3B1 reales y conciliación histórica Milenium siguen pendientes.

## Cadena de evidencia y entrega

Los documentos, JSON, logs y ZIP de Fase 1 se conservan como evidencia histórica del defecto anterior. Su manifiesto de entonces corresponde a la suite original dentro de `MIL-CXP-07-AUDITORIA.zip`; esa suite en el workspace fue actualizada para Fase 2 y ya no debe verificarse contra el hash histórico de Fase 1. No se reescribe el resultado anterior ni se presenta como vigente.

Esta carpeta contiene resultados actuales, patch de los archivos rastreados modificados, identidad/hashes y manifiesto nuevo que también incluye las dos suites nuevas. El paquete Fase 2 incluye fuentes completas afectadas y evidencia histórica mínima para comparar. Los logs originales de Fase 1 no se sobrescriben. No se modificó la política Git de integridad; cualquier futura integración deberá revisar preservación de bytes de estos artefactos por separado.

**Detención para auditoría independiente de ChatGPT. Sin commit, push, PR, merge, SQL productivo, migraciones ni acceso a bases reales.**
