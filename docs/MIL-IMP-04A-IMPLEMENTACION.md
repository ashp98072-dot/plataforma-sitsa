# MIL-IMP-04A — implementación controlada para auditoría

2026-11-09, Guatemala. Estado: desarrollo local, SIN publicación ni habilitación productiva. Rama `feature/mil-imp04a-vencimiento-congelado`; worktree `.worktrees/mil-imp04a`. Base exacta `373bb48704f14904326037573081280ab2222fcd` (#580), coincidente con main remoto verificado por conector GitHub al inicio. No se actualizó main ni origin/main. La creación de esta rama/worktree fue expresamente autorizada en la solicitud adjunta.

## Comportamiento implementado

Perfil numérico por empresa/entidad/cliente, 0–365 días, aprobación explícita y revisión creciente. No duplica clientes ni interpreta condicion_credito. Configurar o aprobar usa la capacidad nueva `facturacion_credito` / acción de catálogo `administrar_credito`, sin equivalencia con crear/emitir/pagos y sin grants por rol. Incluso Admin requiere concesión explícita almacenada para esta capacidad nueva; se mantienen los guards existentes de emisión/consulta. No se cambió ningún usuario ni asignación.

El formulario de configuración se ofrece dentro del detalle de la factura/borrador del cliente y libro, solo si el servidor autoriza su consulta. Evita otro maestro de clientes. Admite guardar plazo aprobado o sin aprobar, revisión esperada y motivo obligatorio; audita valores anteriores/nuevos, actor y ámbito. El perfil aprobado es requisito de crédito; no se presume aprobado por existir texto, por ser Admin o por abrir un borrador.

Vista previa de vencimiento con fecha real elegida para emisión. Días calendario, emisión como día cero, sin ajustar fines de semana/festivos; contado = cero días. El servidor devuelve propuesta y token HMAC ligado a actor, factura, cliente, empresa, entidad, fecha, regla y revisión, válido 15 minutos. Recalcula y compara al emitir dentro de la transacción: perfil/fecha/condición cambiados requieren nueva revisión. El token NO sustituye guards ni permite enviar fecha/plazo/revisión definitivos desde HTTP. Utiliza secreto de autenticación ya existente, con prefijo de dominio MIL04A; no agrega credenciales.

Durante Borrador→Emitida se inserta un snapshot separado con fecha base, días, vencimiento, regla MIL04A_CALENDARIO_V1, fuente CONTADO/PERFIL, revisión y actor/instante. El INSERT y auditoría comparten conexión, commit y rollback con emitirFactura. PK por factura y lock existente del borrador impiden doble snapshot/emisión. Triggers deniegan UPDATE y DELETE del snapshot. Cambiar perfil después no consulta ni actualiza snapshots. No se implementa renegociación ni corrección de emitidas.

El detalle de Facturación consulta el snapshot mediante endpoint propio y lo muestra como vencimiento congelado. Contabilidad/CxC incorpora fechas por lote a listarDocumentosCxc y muestra columna de vencimiento, sin N+1 ni recalcular con perfil actual. Cartera general y antigüedad por emisión conservan sus cálculos/exportaciones; no se convierten en morosidad ni saldo histórico. No se cambió dinero, pagos, retención, bancos ni tributos.

## Compatibilidad y condiciones de esquema

- Facturas emitidas históricas sin snapshot continúan sin vencimiento determinado. No backfill ni lectura del perfil actual para completarlas.
- Nuevos borradores sin entidad o condición explícita conservan la vía compatible sin snapshot; la vista previa informa que quedan fuera del circuito determinado. No se les asigna entidad ni plazo automáticamente.
- Modelo completamente anterior a FACT-4: compatibilidad sin snapshot, verificando primero factura/empresa/estado y ausencia de ambas columnas. Modelo FACT-4 parcial: rechazo 503, sin tratarlo silenciosamente como legado.
- Para entidad+CONTADO/CREDITO explícitos se exige contrato de esquema FINAL, también al escribir un perfil. CLEAN/DIVERGENTE bloquean la incorporación al circuito. No crear ni reparar tablas desde servicios.
- La consulta de snapshot tolera tabla ausente devolviendo no determinado; nunca calcula uno ficticio. No significa que el esquema esté listo para emitir con vencimiento.

## Archivos y contratos

| Área | Archivos / funciones |
| --- | --- |
| Cálculo/entrada pura | `src/lib/facturacion/vencimiento.ts`: calcularVencimiento, fechaCredito, plazoCredito, perfilCreditoSchema |
| Servicio | `credito.ts`: guardarPerfilCredito, obtenerPerfilCredito, previsualizarVencimiento, congelarVencimientoTx, leerVencimiento(s). Locks de entidad activa, cliente del ámbito y perfil; auditoría transaccional |
| Esquema runtime | `credito-esquema.ts`: SELECT generado, mismo contrato que preflight; sin DDL. No caché positiva que oculte cambios de esquema |
| Emisión | `facturas.ts emitirFactura`: llama congelarVencimientoTx antes del UPDATE; el helper tx revierte ambas escrituras ante error |
| Autorización/API | `credito-http.ts`; `permisos-catalogo.ts`; clientes/[id]/credito GET/PUT; facturas/[id]/vencimiento GET/POST; emitir/route.ts contrato estricto y traducción segura de errores |
| UI | `credito-factura.tsx` y `facturas-panel.tsx`: configuración contextual, revisión antes de emitir y consulta congelada; `contabilidad/cxc-client.tsx` columna de fecha |
| Lectura CxC | `contabilidad/cxc/cxc.ts` lote scoped; `cuentas-por-cobrar-shared.ts` amplía solo tipo de vencimiento a string, sin cambiar cálculos ni rótulo del reporte base |
| SQL/generación | `scripts/mil-imp04a/generar-sql.mjs`, `sql/mil-imp04a/{preflight,migrate,postcheck}.sql`, contract.json |
| Pruebas/QA | vencimiento.test.ts, credito-http.test.ts, credito-compat.test.ts, credito.db.test.ts; regresión de facturas/route/catálogo. `scripts/mil-imp04a/lab.mjs`; tsconfig.mil04a.json para verificación focal |

Endpoints no aceptan empresa/actor/aprobación de vencimiento finales enviados por cliente. Perfil PUT acepta exclusivamente días, aprobada, revisión esperada y motivo; la revisión es control de concurrencia, no una autorización. Previsualización acepta solo fechaEmision; emitir acepta sus campos existentes y token. La aprobación del plazo NO concede permiso para emitir o consultar otra empresa.

## SQL propuesto: identidad, NULL y recuperación

Dos tablas nuevas InnoDB, `fact_credito_perfiles` y `fact_vencimientos`; ninguna fila antigua se modifica. Ámbitos/días/metadatos en tablas nuevas NOT NULL. Ausencia de fila de perfil no equivale a plazo cero; ausencia de snapshot equivale a vencimiento no determinado. Los NULL heredados de entidad en fact_facturas se conservan.

Índices aditivos únicos `uq_mil04a_cliente_ambito(empresa_id,id)` y `uq_mil04a_factura_ambito(empresa_id,entidad_id,cliente_id,id)` permiten FKs compuestas hacia los maestros reales sin debilitar índices existentes. FK de snapshot amarra empresa/entidad/cliente/factura; perfil amarra cliente/empresa y entidad/empresa. Reglas de borrado/actualización RESTRICT; PK del snapshot factura_id. CHECK de rango/fechas/regla/fuente y triggers inmutables. Perfil PK empresa/entidad/cliente. Índice de lectura por ámbito/vencimiento/factura.

Preflight y postcheck son exclusivamente SELECT sobre metadatos (sin datos reales). Reconocen CLEAN (objetos del ticket ausentes y prerrequisitos válidos), FINAL (columnas/orden/tipos/null/defaults, claves, FKs, CHECK y triggers esperados) o DIVERGENTE (parcial/incompatible). MariaDB 11.8/InnoDB, FK y CHECK activos son prerrequisitos. La migración hace guard y SIGNAL antes de DDL divergente; no usar cliente con --force/continuar tras error. No automatizar ejecución en Hostinger.

**DDL no es transaccional:** ALTER/CREATE pueden confirmar implícitamente. Una falla intermedia deja DIVERGENTE; detener y revisar, no relanzar forzando IF NOT EXISTS ni desactivar FKs. La reaplicación se probó desde FINAL; no se promete reparación automática de parciales.

Procedimiento de recuperación para revisión del DBA, NO ejecutado fuera del laboratorio: conservar backup validado y SHOW CREATE/contrato previo antes de cualquier futura aplicación autorizada; suspender escrituras afectadas durante ventana; exigir CLEAN/FINAL y postcheck FINAL. Si falla DDL, mantener escritores detenidos, conservar metadatos/logs y restaurar respaldo en entorno de recuperación verificado o preparar reparación específica auditada. No borrar tablas/snapshots con datos para volver a CLEAN. Si falla una operación de aplicación, rollback de esa transacción conserva factura en Borrador y no deja snapshot/auditoría parcial. Si ya hubo emisiones confirmadas, conservar snapshots/índices y detener el circuito antes de retirar una versión de código: volver sin más a una aplicación antigua permitiría emitir sin congelación. No se entrega DROP destructivo como rollback automático.

Riesgos: creación de índices puede requerir locks, espacio y tiempo; DDL debe revisarse en versión y esquema efectivos, que no se consultaron. Los nuevos UNIQUE incluyen id global y no renumeran ni fusionan datos. Contrato runtime de metadatos se consulta por operación: agrega coste y debe medirse con volumen real autorizado. Locks conservadores de cliente serializan perfiles y emisión del mismo cliente, incluso entre entidades; errores de deadlock/timeout se responden como conflicto, sin éxito ficticio. Despliegue debe coordinar todos los escritores; no convivir con binarios antiguos que omitan snapshots.

## Pruebas ejecutadas y evidencia

Resultados finales:

| Verificación | Resultado |
| --- | --- |
| Regresión focal final, reporte `mil04a-regresion-final.json` | PASS: 272 pruebas; sin FAIL/SKIP. Incluye fechas, crédito/permisos/compatibilidad, facturas, cartera, antigüedad/Excel, cobros, CxC, tenant y contrato de emisión |
| MariaDB 11.8.9 aislada, ejecución final `lab-IKXDTM/vitest.json` | PASS: 7 pruebas; sin FAIL/SKIP |
| TypeScript focal con tsconfig.mil04a.json | PASS sobre archivos afectados y dependencias importadas; no stubs de tipos para ocultar fallos |
| ESLint sobre todo TS/TSX/MJS afectado | PASS, salida 0 |
| TypeScript completo --noEmit --incremental false | FAIL ambiental: 15 TS2307 por fake-indexeddb ausente en pruebas de borradores, sin errores del ticket en ese intento. Dependencias no instaladas ni lockfile modificado |
| DOM interactivo / navegador / build completo | NO EJECUTADOS. No servidor web levantado. No se declara QA visual ni PASS integral |

El reporte focal incluye escenarios de: 2026-07-15+30=2026-08-14, cero días/contado, bisiesto, fin de semana sin traslado, invalidación de plazo/fecha, contrato cerrado, sin autorización incluida Admin sin grant, legado pre-FACT4 y esquema parcial. El laboratorio ejecuta servicios reales, sin mock de cálculo, de guardarPerfilCredito/congelarVencimientoTx ni de emitirFactura. Mock de db solo redirige al pool del laboratorio verificado; las funciones de bootstrap de clientes están bloqueadas para impedir DDL incidental.

Laboratorio: binario local MariaDB 11.8.9 fijado por SHA256, datadir nuevo temporal, pipe aleatorio, TCP deshabilitado, entorno limpio sin .env, esquema aleatorio, identidad comprobada antes de SQL y SHUTDOWN. Proceso creado por este runner y apagado al finalizar; no se usan servicios ya abiertos. Solo fixtures sintéticos y máximo monetario de prueba. El datadir se conserva temporalmente para auditoría; la evidencia local conserva logs/resultados. Ning?n datadir, log ni artefacto temporal forma parte del commit de auditor?a.

Las siete pruebas de motor cubren CLEAN→FINAL y reaplicación; DIVERGENTE sin continuación; histórica emitida sin backfill; crédito sin perfil aprobado; empresa/entidad/cliente ajenos; cambio de perfil entre preview/emisión y después de emitir; contado; token manipulado; dos conexiones y una emisión/snapshot; FK cruzada; rechazo UPDATE/DELETE de snapshot; fallo de INSERT y fallo de auditoría posterior al UPDATE que revierten factura/snapshot.

Se conservan fallos intermedios, no se ocultan: primer ensayo rechazó separador SQL legado que no admite rutinas; otro superó timeout de prueba de migración (se fijó 30s para metadatos); al reforzar FKs, otro detectó alias ausente en CTE (corregido a objetos(ok)); otro test de catálogo esperaba lista anterior sin administrar_credito (expectativa actualizada sin quitar cobertura previa). Son errores de esta implementación/ensayo, no fallos atribuidos a la base. Resultados iniciales y finales separados en evidencia. Pruebas posteriores del motor y regresión final pasan. No presentar omisión de laboratorio como éxito: al ejecutar credito.db.test.ts sin manifiesto, sus casos hacen SKIP, mientras el runner explícito sí los ejecutó.

Comandos reproducibles desde el worktree (sin credenciales productivas):

```text
node scripts/mil-imp04a/generar-sql.mjs
node scripts/mil-imp04a/lab.mjs --run-isolated
node ../../node_modules/typescript/bin/tsc -p tsconfig.mil04a.json
node ../../node_modules/typescript/bin/tsc --noEmit --incremental false
```

La lista exacta de archivos y títulos ejecutados está en los JSON de Vitest; se entregan también logs de ESLint/TypeScript. Entorno compartido instalado: Vitest 4.1.11, mientras package.json pide 4.1.12; falta fake-indexeddb y no se instaló happy-dom. No se cambió package.json/lockfile. Resolver reproducibilidad global y verificar UI con dependencias válidas antes de habilitación.

## Límites y pendientes de aprobación

Desarrollo autorizado por solicitud MIL-IMP-04A, sin asumir aprobación operativa de toda política MIL-IMP-04. No saldo histórico, nuevos asientos, serie REV, reversos contables, FEL, notas de crédito, anticipos, renegociaciones, cambios tributarios ni tratamiento masivo de legados. No modificar MIL-IMP-01/02/03 o trabajos PriceSmart.

Pendientes: auditoría independiente del diff/SQL y permiso granular; aprobación funcional/operativa del alcance de nuevas emisiones, política de concesión y responsables; validación del esquema real en fase autorizada; plan de despliegue coordinado y recuperación; rendimiento/locks con volumen; dependencias completas y QA visual. Una fecha congelada administrativa no certifica FEL ni acredita cartera histórica.

No hubo SQL en Hostinger, conexiones productivas, datos reales, despliegue, commit, push, PR ni merge. Detención antes de cualquier publicación.


## Preparaci?n de auditor?a remota

Se publica exclusivamente la lista de archivos siguiente. Los reportes JSON, logs, datadirs, ZIP y copias temporales bajo artifacts/ permanecen locales y fuera del commit. No se alteran package.json ni lockfile. SQL propuesto, ejecutado solamente en laboratorio sint?tico aislado; ninguna migraci?n productiva ejecutada ni hook autom?tico agregado. El generador escribe archivos; el laboratorio requiere --run-isolated y verifica su servidor propio antes de SQL. La aplicaci?n solo consulta metadatos para validar el contrato de esquema.

### Diagn?stico de TypeScript completo

Los 15 errores son TS2307: resoluci?n ausente de fake-indexeddb en 15 archivos de pruebas ajenos al diff. package.json ya declara ^6.2.7, pero el m?dulo falta en node_modules compartido. No son 15 fallos de aserciones ni 15 defectos demostrados del ticket. No se ejecut? comparaci?n integral contra una instalaci?n limpia de la base; por ello no se afirma PASS global ni se atribuye una regresi?n funcional. Se verific? que esos archivos no se incluyen en el commit.

Para reproducir el diagn?stico en el entorno actual: node ../../node_modules/typescript/bin/tsc --noEmit --incremental false. En un entorno desechable con dependencias completas instaladas desde el lockfile, volver a ejecutar TypeScript completo y las suites DOM pertinentes; falta esa validaci?n. No se instala nada ni se modifica el lockfile en esta publicaci?n.

Archivos se?alados por los 15 errores:

- `src/app/e/[slug]/fondos/fondos-autoguardado.dom.test.ts`
- `src/app/e/[slug]/gastos/gastos-autoguardado.dom.test.ts`
- `src/components/borradores/autoguardado.dom.test.ts`
- `src/components/borradores/salida-borradores.dom.test.ts`
- `src/components/compras/requerimiento-autoguardado.dom.test.ts`
- `src/components/compras/requerimiento-limite-lineas.dom.test.ts`
- `src/lib/borradores/controlador.test.ts`
- `src/lib/borradores/coordinacion.test.ts`
- `src/lib/borradores/excepciones-inesperadas.test.ts`
- `src/lib/borradores/nucleo.test.ts`
- `src/lib/borradores/purga-cancelacion.test.ts`
- `src/lib/borradores/purga-persistente.test.ts`
- `src/lib/borradores/qa-integral-autoguardado.dom.test.ts`
- `src/lib/borradores/qa-limites-lineas.dom.test.ts`
- `src/lib/borradores/sesion-borradores.test.ts`

### Lista exacta de archivos del commit

- `src/app/api/empresas/[slug]/facturacion/facturas/[id]/emitir/route.test.ts`
- `src/app/api/empresas/[slug]/facturacion/facturas/[id]/emitir/route.ts`
- `src/components/contabilidad/cxc-client.tsx`
- `src/components/facturacion/facturas-panel.tsx`
- `src/lib/contabilidad/cxc/cxc.ts`
- `src/lib/facturacion/cuentas-por-cobrar-shared.ts`
- `src/lib/facturacion/facturas.test.ts`
- `src/lib/facturacion/facturas.ts`
- `src/lib/facturacion/permisos-config-requisitos.test.ts`
- `src/lib/permisos-catalogo.ts`
- `docs/MIL-IMP-04A-IMPLEMENTACION.md`
- `scripts/mil-imp04a/generar-sql.mjs`
- `scripts/mil-imp04a/lab.mjs`
- `sql/mil-imp04a/contract.json`
- `sql/mil-imp04a/migrate.sql`
- `sql/mil-imp04a/postcheck.sql`
- `sql/mil-imp04a/preflight.sql`
- `src/app/api/empresas/[slug]/facturacion/clientes/[id]/credito/route.ts`
- `src/app/api/empresas/[slug]/facturacion/facturas/[id]/vencimiento/route.ts`
- `src/components/facturacion/credito-factura.tsx`
- `src/lib/facturacion/credito-compat.test.ts`
- `src/lib/facturacion/credito-esquema.ts`
- `src/lib/facturacion/credito-http.test.ts`
- `src/lib/facturacion/credito-http.ts`
- `src/lib/facturacion/credito.db.test.ts`
- `src/lib/facturacion/credito.ts`
- `src/lib/facturacion/vencimiento.test.ts`
- `src/lib/facturacion/vencimiento.ts`
- `tsconfig.mil04a.json`
