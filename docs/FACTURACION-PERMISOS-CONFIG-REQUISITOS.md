# Facturación: configuración de la empresa y requisitos de clientes como permisos asignables

Estado: **IMPLEMENTADO + VERIFICADO TÉCNICAMENTE** (tsc, eslint, pruebas unitarias, build). **No probado en navegador ni contra base real.** Sin SQL: son filas nuevas de `usuario_modulo` (VARCHAR(40)), que ya se guardan sin migración.

## Causa

Tras el PR #411 la matriz de Facturación permitía Ver / Crear / Editar borrador / Emitir / Anular / Registrar pago, pero tres cosas seguían decidiendo **solo por rol** con `alcanceFacturacion(session.rol)`:

| Dónde | Efecto |
|---|---|
| `src/app/e/[slug]/facturacion/page.tsx` | pestañas «Configuración empresa» / «Requisitos clientes» y modo edición |
| `src/components/app-shell.tsx` | destino del menú «Facturación clientes» y entrada «Facturación empresa» |
| `GET/PUT /facturacion/empresa`, `GET /facturacion/clientes`, `GET/PUT /facturacion/clientes/[clienteId]` | 403 por rol |

Además esos endpoints pasaban por `requireTenantModulo("facturacion", editar)`, que exige `facturacion:editar/crear` o que el **rol** tenga el módulo: un `AuxiliarOperaciones` (su rol no incluye Facturación) solo con permiso de configuración no habría podido guardar aunque se levantara el filtro por rol.

## Permisos agregados (catálogo central `permisos-catalogo.ts`)

Facturación clientes (Contabilidad / Facturación) conserva Ver, Crear borrador, Editar borrador, Emitir, Anular y Registrar pago, y agrega:

| Acción | Fila persistida | Flag |
|---|---|---|
| Ver configuración de facturación de la empresa (`ver_empresa`) | `facturacion_empresa` | ver |
| Editar configuración de facturación de la empresa (`editar_empresa`) | `facturacion_empresa` | editar |
| Ver requisitos de facturación de clientes (`ver_requisitos`) | `facturacion_clientes_requisitos` | ver |
| Editar requisitos de facturación de clientes (`editar_requisitos`) | `facturacion_clientes_requisitos` | editar |

- Nombres ≤ 40 caracteres. Sin fallback a `facturacion:editar` (a diferencia de Emitir/Anular/Pagar): **sin fila explícita no hay acceso**, salvo la equivalencia legacy de abajo.
- **Dependencias** (mismo mecanismo `cambiarAccion`, con un campo opcional `requiere`): activar cualquiera activa «Ver» de Facturación; «Editar» activa el «Ver» de su sección; quitar el «Ver» de una sección limpia su «Editar»; quitar «Ver Facturación» limpia todo lo de Facturación.
- **Independientes de Emitir:** «Emitir factura» sigue siendo únicamente borrador → emitida; no concede, ni se concede desde, configuración o requisitos (tampoco `facturacion:editar`).
- Matriz de Usuarios: subbloques «Configuración de la empresa» y «Requisitos de clientes» dentro de Facturación clientes (campo opcional `grupo`; no cambia catálogo ni persistencia).

## Frontend

`FacturacionPage` y el sidebar obtienen `verEmpresa / editarEmpresa / verClientes / editarClientes` con `capacidadesFacturacion(permisosEfectivos, rol)` (`src/lib/facturacion/capacidades.ts`): Admin todo; sin «Ver Facturación» nada; «Editar» exige «Ver» de la sección. `FacturacionClient` no cambia: con `ver` muestra la pestaña y el formulario en solo lectura, con `editar` habilita «Guardar respuestas», sin permiso no hay pestaña.

## Backend

Nuevo `requireFacturacionConfig(slug, accion)` (`src/lib/facturacion/acceso.ts`): asegura tablas y `modulos_json` (como antes) y llama a `requireTenantFacturacion`, ahora con las 4 acciones nuevas. Sin permiso → **403** (aunque la pestaña esté oculta).

| Endpoint | Permiso |
|---|---|
| `GET /facturacion/empresa` | ver configuración empresa |
| `PUT /facturacion/empresa` | editar configuración empresa |
| `GET /facturacion/clientes`, `GET /facturacion/clientes/[id]` | ver requisitos clientes |
| `PUT /facturacion/clientes/[id]` | editar requisitos clientes |

Los endpoints de facturas, viajes pendientes, emitir, anular y pagos **no cambian** (ya usaban `requireTenantFacturacion` por permiso).

## Compatibilidad legacy (no se rompe a nadie)

`alcanceFacturacionPorRol` (`alcance-rol.ts`, función pura) queda **solo como equivalencia**: `adaptarPermisosLegacy(permisos, rol)` materializa las filas nuevas cuando **aún no existen** y el usuario tiene «Ver Facturación»:

- Admin: ver/editar empresa y clientes (bypass existente).
- Contabilidad: ver/editar configuración de la empresa.
- Operaciones: ver/editar requisitos de clientes.
- Visualizador: lectura de ambas.
- Facturador: lectura de requisitos de clientes.
- Resto de roles (p. ej. AuxiliarOperaciones, JefeOperaciones): nada, igual que antes.

Esto cubre matrices anteriores a la V2 **y** V2 ya guardadas que todavía no tenían estas filas (no pierden el acceso que tenían). Una vez que existe una fila —aunque esté en cero— **manda la matriz**: negar desde Usuarios quita lo que el rol daba. La matriz de Usuarios muestra lo heredado por rol y, al guardar, lo deja como filas explícitas. No hay excepciones por `username`.

## Caso AuxiliarOperaciones (tipo mcaal, sin hardcodear el usuario)

- rol AuxiliarOperaciones + Ver Facturación + ver/editar configuración empresa → abre «Configuración empresa» y guarda (PUT 200); no ve Requisitos clientes (403).
- mismo rol + solo ver configuración → la lee, `PUT` → 403.
- mismo rol + Emitir factura sin ver configuración → emite, pero no ve «Configuración empresa» (403).

## Pruebas

`src/lib/facturacion/permisos-config-requisitos.test.ts` (45): catálogo y VARCHAR(40), dependencias, capacidades (base, solo lectura, emitir independiente, secciones independientes), legacy por rol, matriz explícita como fuente de verdad, guardado conserva lo heredado, **403 reales** en los 5 métodos de los 3 endpoints, Admin, tenant ajeno/empresa sin módulo, y cableado (página, sidebar y rutas sin `alcanceFacturacion(rol)`). `app-shell-facturacion-permisos.test.ts` se adapta a permisos efectivos (mismos resultados).

## Para activar el caso real (acción manual, después del deploy)

En Usuarios → el usuario → Facturación clientes: marcar **Ver configuración de la empresa** (y **Editar…** si debe guardar). No se cambia ningún permiso automáticamente.
