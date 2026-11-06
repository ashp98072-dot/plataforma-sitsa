# MIL-CXP-07 — H-01: auditoría y reproducción de permisos fiscales

Fecha: 2026-11-06 (Guatemala). Fase 1 exclusivamente. **H-01 REPRODUCIDO en pruebas aisladas en proceso, sin corrección implementada.** No hay aprobación productiva ni cierre del hallazgo.

## Resultado y decisión recomendada

Un usuario sintético con `cxp_facturas:ver` y sin `cxp_proveedor_fiscal:ver` obtiene HTTP 200 en el listado de proveedores y recibe configuración fiscal completa. El mismo usuario obtiene HTTP 403 en la ruta fiscal directa y en el catálogo de cuentas. El problema es la proyección de datos del listado compartido: la denegación de la ruta específica no protege los mismos campos cuando se consultan por el listado.

La reproducción ejecuta los **Route Handlers, `requireTenant`, `requireTenantCxp`, resolución real de permisos, `tienePermiso`, ámbito y servicio/mapeo de proveedores** sin reemplazarlos. Se sustituyen únicamente sesión, fuente de empresas/membresías y frontera `@/lib/db` con datos sintéticos. No se usa una BD, un navegador ni un servidor HTTP real. No equivale a una prueba de despliegue, cookies firmadas, middleware o ejecución SQL en motor.

Se recomienda autorizar una Fase 2 de corrección mínima de la proyección y sus consumidores, después de revisar el contrato y la excepción de compatibilidad descritos en [PROPUESTA-FASE-2.md](PROPUESTA-FASE-2.md). **No implementar automáticamente.**

## Base y aislamiento

- Repositorio: `ashp98072-dot/plataforma-sitsa`.
- `origin/main` actualizado mediante fetch de lectura: **`b350cac75bb698719fb8b79f8c0082fd8623482b`**, merge #577 de MIL-CXP-06. No se hizo pull/merge sobre otros worktrees.
- Rama nueva: `feature/mil-cxp07-permisos-fiscales`; worktree nuevo: `.worktrees/mil-cxp07`. Al crearse heredó seguimiento a `origin/main`; no se ejecutó push ni se modificó ese seguimiento. Una futura publicación debe usar un refspec explícito para su propia rama, previa autorización.
- Se leyeron `AGENTS.md`, `CLAUDE.md`, el plan raíz (pilotos/RRHH, ajeno al alcance), el expediente MIL-CXP-06, la política `CONTABILIDAD-ACCESO-UNIFICADO.md` y el catálogo de permisos. No hay instrucciones anidadas detectadas mediante `rg --files -g AGENTS.md -g CLAUDE.md` en la base.
- Se consultaron las guías locales Next 16.4.1 de Route Handlers y Vitest en `node_modules/next/dist/docs/01-app/`, antes de escribir las pruebas. Las rutas usan parámetros Promise y Request/Response reales en proceso; no se cambió código Next funcional.
- Dependencias preparadas sólo aquí mediante `npm.cmd ci --offline --ignore-scripts --no-audit --no-fund` (533 paquetes). Lockfile y manifiestos intactos; no se cargó `.env`, no se abrieron conexiones SQL ni se aplicaron migraciones.
- Sólo se añade una suite de auditoría y esta carpeta de evidencia. No se altera MIL-CXP-06 ni los worktrees existentes.

## Contrato de autorización

Fuentes: `src/lib/permisos-shared.ts` define permiso fiscal como régimen/ISR/cuentas, `permisos-catalogo.ts` expone acciones separadas, y `http-estado-cuenta.ts` protege expresamente régimen/sujeción con permiso fiscal. Este contrato **no prohíbe** que un lector de facturas conozca los importes/retención de sus facturas ni requiere quitar snapshots fiscales ya autorizados del documento. H-01 se limita al maestro fiscal actual del proveedor.

| Ruta (prefijo `/api/empresas/[slug]/contabilidad/cxp`) | Contrato de acceso existente | Respuesta esperada para información fiscal |
| --- | --- | --- |
| `GET /proveedores?entidad=…` | Facturas **o** Fiscal, conservando tenant/módulo | Proveedores comerciales disponibles a ambos; régimen, sujeción y cuentas sólo con Fiscal o Admin. Actualmente no filtra el objeto `fiscal` |
| `GET /proveedores/[id]/fiscal?entidad=…` | `cxp_proveedor_fiscal:ver` | Configuración sólo con ese permiso/Admin; deniega correctamente al lector de facturas en la prueba |
| `GET /cuentas?entidad=…` | `cxp_proveedor_fiscal:ver` | Catálogo de cuentas sólo con ese permiso/Admin; deniega correctamente al lector de facturas |
| `PUT /proveedores/[id]/fiscal?entidad=…` | `cxp_proveedor_fiscal:editar` | Inspección estática: permiso de edición específico. **No ejecutado**; esta fase no evalúa escrituras |

`requireTenantCxp` exige una sesión y acceso a la empresa, luego permite Admin o comprueba módulo Contabilidad y permiso efectivo. Admin omite comprobación de módulo/fila **después** del tenant. No hay asignación adicional usuario–entidad: la política vigente habilita libros de la empresa, y `cont_entidad_usuarios` no restringe. No se propone cambiar esa política.

Las entradas de prueba representan perfiles de lectura con acciones de creación/edición/eliminación falsas y matriz V2 explícita. En modo legado, `tienePermiso` puede inferir lectura desde otras acciones; el criterio debe basarse en permiso **efectivo**, no sólo en el bit crudo `puede_ver`. No se asume que una cuenta real tenga estos perfiles ni se modificaron usuarios persistidos.

## Matriz ejecutada (cinco usuarios sintéticos)

Todos usan empresa sintética 101/libro 11, salvo las pruebas específicas de aislamiento.

| Perfil | Facturas:ver | Fiscal:ver | GET listado | Maestro fiscal en listado, observado | GET fiscal | GET cuentas | Evaluación de seguridad |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Ambos | Sí | Sí | 200 | Completo | 200 | 200 | Conforme al contrato |
| Sólo facturas | Sí | No | 200 | **Completo: exposición H-01** | 403 | 403 | **NO CONFORME** |
| Sólo fiscal | No | Sí | 200 | Completo | 200 | 200 | Conforme al contrato |
| Ninguno | No | No | 403 | No devuelto; sin consulta de proveedores | 403 | 403 | Denegación correcta |
| Admin | No explícitos | No explícitos | 200 | Completo | 200 | 200 | Excepción de Admin vigente |

Campos presentes en `fiscal`: `proveedorId`, `entidadId`, `regimenFiscal`, `sujetoIsr`, `cuentaProveedorId`, `cuentaAnticipoId`, `cuentaGastoId`, `activo`. Identificadores/nombre/NIT/días de crédito comerciales no se clasifican aquí como datos fiscales restringidos. Fixture de ejemplo: proveedor 1001, régimen GENERAL, sujeto ISR, cuentas 11001/11002/11003, todo sintético.

El resultado reproducible del perfil sin permiso fiscal está en [reproduccion-h01.json](reproduccion-h01.json), con JSON recibido, estados y texto/parámetros de las consultas interceptadas (no ejecutadas por un motor).

## Separación de empresa/entidad

| Control | Resultado aislado | Límite de la evidencia |
| --- | --- | --- |
| Sin sesión | 401 en las tres rutas, sin lectura de datos de proveedor | `getSession` sustituido; no verifica JWT/cookie reales |
| Empresa ajena no incluida en membresías | 403 antes de consultar datos, incluso para Admin con membresía sintética excluyente | Ejecuta guard real; la fuente real de membresías se sustituye. No implica que el resolver real de empresas restrinja por defecto a Admin |
| Empresa inexistente/inactiva | 404 | Empresas sintéticas |
| Sin módulo Contabilidad | No Admin: 403; Admin: 200 | Excepción de módulo vigente |
| Entidad inválida, repetida o fuera de INT | 400 antes de consultar datos | Validador real |
| Libros 11/12 de la misma empresa | Configuraciones distintas, sin mezclar los IDs fiscales | Se verifican joins/WHERE y parámetros reales; filas proporcionadas por doble |
| Cambio a empresa 202 permitida | Sólo proveedor 2001/configuración 21001; cambio de cookie interceptado | No se firma ni persiste cookie real |
| Empresa enviada en query string | No reemplaza empresa del tenant | Parámetro cliente no concede permisos |
| Entidad ajena 21 o inexistente 999 con empresa 101 | **200 con catálogo comercial de empresa 101 y `fiscal:null`**, no 404; config directa null y cuentas vacías | No se observan datos fiscales de empresa 202. Falta validación explícita de pertenencia de entidad en estas lecturas |

La última fila es una **observación relacionada de ámbito**: la sintaxis de entidad se valida, pero estas tres lecturas no exigen que exista en la empresa antes de consultar. No se declara una fuga entre empresas: las consultas inspeccionadas contienen scope compuesto. Conviene decidir su tratamiento separado del cambio mínimo H-01; no se corrige en esta fase.

## Estado y límites

**H-01 abierto y reproducido mediante integración aislada en proceso.** El criterio de confidencialidad del maestro fiscal falla para el perfil de facturas únicamente. El fallo esperado de la suite documenta ese incumplimiento; no debe presentarse como seguridad aprobada.

**H-02 sigue abierto, no investigado ni implementado aquí.** Comprobación de M-3A/M-3B1 en entorno real y conciliación histórica Milenium continúan pendientes. Ninguna prueba usa datos empresariales reales, motor SQL, producción, una VM ni laboratorio MariaDB.

La emulación de consultas sólo acredita que las rutas/servicios generaron filtros y parámetros esperados y mapearon fixtures coherentes. No demuestra ejecución SQL, constraints, planes, concurrencia, caché de permisos dentro de un request Next real, autorización de cookies, middleware o una sesión de navegador. La prueba de revocación sólo cubre llamadas sucesivas bajo Vitest, sin un contexto de caché React de servidor.

Evidencia y comandos: [VERIFICACION.md](VERIFICACION.md). Propuesta sin aplicar: [PROPUESTA-FASE-2.md](PROPUESTA-FASE-2.md). Detención para auditoría independiente de ChatGPT; sin commit, push, PR o merge.
