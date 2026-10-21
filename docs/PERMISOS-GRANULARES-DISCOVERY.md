# Permisos granulares y sidebar — discovery

Base de inspección: `98c94c7be4a0284e73c830e285b0c7f9834c59a6`.
No se consultó producción ni Hostinger. Los tipos físicos aquí descritos
proceden de `sql/schema.sql`, no de una inspección de BD.

## Arquitectura actual y evidencias

- `usuarios`: identidad, rol_global VARCHAR(40), activo y acceso_todas_empresas.
- `usuario_empresa`: alcance de empresas; `usuario_modulo`: permisos globales
  con empresa_id NULL, modulo VARCHAR(40) y puede_ver/crear/editar/eliminar.
  No hay tabla de roles/permisos normalizada ni JSON de acciones.
- `src/lib/permisos-shared.ts`: catálogo, defaults de rol, etiquetas,
  grupos y tienePermiso; ver actualmente infiere las demás acciones.
- `src/lib/permisos.ts`: lectura vigente de BD, defaults para filas ausentes
  y compatibilidad con almacenamiento antiguo de dos flags. Los desmarques
  se guardan en filas explícitas, no deben desaparecer.
- `src/lib/auth.ts`, `src/app/api/usuarios/route.ts`: escritura/listado de
  usuarios; API exclusivamente Admin. La matriz vive en
  `src/app/e/[slug]/usuarios/page.tsx` y hoy presenta CRUD para todas las filas.
- `src/lib/empresa-session.tsx`: sesión resuelta en layout para UI.
- `src/lib/tenant.ts`: sesión, alcance de empresa, capacidad empresarial y
  guard de cada módulo. `src/lib/rrhh-page-guard.ts` protege páginas RRHH;
  `src/lib/compras/acceso.ts` mantiene ver/crear/editar independientes.
- `src/lib/api-guard.ts`: guards antiguos por rol; no sustituyen el guard
  tenant. `src/app/e/[slug]/layout.tsx` decide capacidades navegables.
- `src/components/app-shell.tsx`: menú y activo; Flota usa una misma ruta
  con query tab. linkActive descarta la query: por eso todos sus hijos se
  activan. Cotizaciones/Ajustes también pueden coincidir por prefijo.

## Mapa de acciones reales

V/C/E/D significan las columnas heredadas, NO implican que existan cuatro
operaciones. Rutas API debajo de `src/app/api/empresas/[slug]/`, salvo
que se indique otro archivo. Menú construido en app-shell y RRHH_NAV/FLOTA_NAV.

| Módulo | Permisos actuales / acciones reales / guard actual | Menú / problema |
| --- | --- | --- |
| Empleados | empleados:V/C/E/D; ficha, importar, editar, desactivar y documentos; empleados/route.ts y [id]/route.ts, requireTenantRrhh | empleados:V; D incluye documentos, no inventar anulación |
| Marcajes | marcajes:V/C/E; asistencia, importación y correcciones; rrhh/asistencia y marcajes | marcajes:V; no CRUD universal |
| Reportes RRHH | reportes:V; rrhh/reportes/route.ts, evidencia y presentación/exportación | reportes:V; no C/E/D de reportes |
| Vacaciones | vacaciones:V/C/E/D; solicitudes, decisión, boleta, quitar; rrhh/vacaciones | vacaciones:V; acciones bajo flags compartidos |
| En Ruta | en_ruta:V/C/D; rrhh/en-ruta/route.ts | en_ruta:V; combinado visualmente con vacaciones |
| Incidencias | incidencias:V/C/E; rrhh/incidencias y anexo | incidencias:V; no eliminar inventado |
| Configuración RRHH | configuracion:V/E; configuración, ubicaciones; fiscal usa además C/E | configuracion:V; no tocar motor fiscal |
| Planillas | planillas:V/C/E; crear período, líneas, autorizar, reportar/exportar; rrhh/planillas | planillas:V; no nómina ni reglas de cálculo en alcance |
| Descuentos | descuentos:V/C/E; registrar, editar/cancelar/importar/exportar; rrhh/descuentos | descuentos:V; cancelar no equivale genéricamente a eliminar |
| Prestaciones | prestaciones:V/C/E/D; rrhh/prestaciones; D anula prestación | prestaciones:V; etiqueta específica, no reasignación a otra acción |
| Horas Extra | horas_extra:V/E; registrar/decidir bajo E; rrhh/horas-extra | horas_extra:V |
| Inventario RRHH | inventario:V/C/E; artículos/entregas/devolución/cambio; rrhh/inventario | inventario:V; no reglas de inventario en alcance |
| Centros de Costo | centros_costo:V/E; crear/editar/activar bajo E; rrhh/centros-costo | centros_costo:V |
| Entrevistas | entrevistas:V/E; candidatos, documentos, seguimientos, reportes; rrhh/entrevistas | entrevistas:V; grupo Atracción de Talento separado |
| Recordatorios | recordatorios:V/E; registrar/editar/completar; rrhh/recordatorios | recordatorios:V |
| Bitácora Legal | bitacora_legal:V/E; registrar/seguir casos; rrhh/bitacora-legal y casos-legales | bitacora_legal:V |
| Requerimientos RRHH | rrhh_requerimientos:V/C/E; src/lib/rrhh/requerimiento-acceso.ts | base propia; autorizar separado |
| Autorizar RRHH | rrhh_requerimientos_autorizar:E; autorizar/rechazar | acción especializada, no CRUD independiente |
| Proveedores RRHH | rrhh_proveedores:V/C/E; src/lib/rrhh/requerimiento-acceso.ts | rrhh_proveedores:V; no Compras |
| Dashboard Operaciones | tms:V y roles; dashboard-operaciones | bypass de rol en menú |
| Disponibilidad flota | tms:V o flota_vehiculos/reportes:V; operaciones/disponibilidad | rol y permisos mixtos |
| Rutas | rutas:V/C/E/D o tms:acción; requireTenantRutas | depende además de opsMods/tms; puede esconder acceso propio |
| Programación | programacion:V/C/E; POST/PATCH planes; requireTenantProgramacion | bypass Operaciones y padre tms; no eliminar ficticio |
| Planes / Viajes | programacion:V o tms:V; requireTenantProgramacionOTms | comparte audiencia, cierre separado |
| Cerrar viaje | viajes_cerrar:E; tms/planes/[id]/cerrar, requireTenantViajesCerrar | especializado; no C/D |
| Viáticos | viaticos:V; registro manual por flujos TMS/requerimientos, decisiones separadas | menú admite acciones especializadas sin base |
| Autorizar viático | viaticos_autorizar:E; autorizar/rechazar | no fallback a editar general |
| Pagar viático | viaticos_pagar:V/E; bandeja/entregar y export bancario | especializado |
| Liquidar viático | viaticos_liquidar:E; liquidar | especializado, independiente |
| Comprobantes viático | viaticos_comprobantes:V; PDF histórico protegido | especializado, no PDF factura |
| Gastos operativos | gastos:V/C/E/D o tms:acción; tms/gastos | registro, edición, desactivar y export; autorizar separado |
| Solicitudes de fondo | gastos:V/C/E o tms:acción; tms/fondos | mismo permiso de captura, autorización gastos_autorizar:E |
| Autorizar gastos | gastos_operativos_autorizar:E | no usar autorización de Fondos |
| Reportes Operaciones | gastos:V/tms:V; tms/reportes/gastos/exportar | export bajo V, sin CRUD reportes |
| Cotizaciones | cotizaciones:V/C/E o tms:acción; tms/cotizaciones, [id]/estado | falta en catálogo asignable; estado comparte E |
| Costeo confidencial | cotizaciones_costeo:V/C/E; requireTenantCotizacionesCosteo | sin fallback comercial/TMS; preservar confidencialidad |
| Ajustes costeo | cotizaciones_ajustes:V/C/E; vigencias INSERT, perfiles PATCH | base propia; nunca mutar snapshots |
| Multas | multas:V/C/E; operaciones/multas, revisiones/documentos | base propia; anular con descuento exige RRHH adicional |
| Accesos proveedores | rol, tenant y asignación; proveedor_portales, src/lib/proveedores/acceso.ts | no matriz actual; cifrado/revelación no se reescriben |
| Compras requerimientos | compras_requerimientos:V/C/E; src/lib/compras/acceso.ts | V estricto, catálogos admiten V/C/E |
| Autorizar Compras | compras_autorizar:E | independiente, sin fallback TMS/proveedores |
| Proveedores comerciales | compras_proveedores:V/C/E | base propia; no maestro de credenciales |
| Facturación clientes | facturacion:V/C/E; facturas GET/POST/PATCH; emitir/anular:E; pagos:C | además alcanceFacturacion por rol; causa estructural de ocultamiento |
| TMS / Logística | tms:V/escritura compartida crear/editar/rol | solo Admin tiene enlace; capacidades técnicas existentes |
| Clientes | clientes:V/escritura compartida; src/lib/clientes/acceso.ts | base propia |
| Dashboard Flota | flota / permisos de submódulos | query vacía, comparte pathname con tabs |
| Vehículos | flota_vehiculos:V/C/E/D, importación y documentos; flota/vehiculos | ?tab=vehiculos; error activo común |
| Taller / Registrar / Historial | flota_servicios:V/C/E; flota/servicios y adjuntos | tabs distintos, mismo módulo; eliminar no universal |
| Compras / Facturas Flota | flota_compras:V/escritura servicios compartida | tab=compras, no confundir con Compras Operaciones |
| Inventario Flota | flota_inventario:V/C/E/D; flota/inventario-equipo | tab=inventario-equipo |
| Lecturas | flota_lecturas:V/escritura compartida; flota/lecturas | tab=lecturas |
| Reportes Flota | flota_reportes:V; flota/reportes | tab=reportes; no C/E/D ficticio |
| Registrar viaje Flota | flota_piloto:V/C; viajes/evidencias/permisos-externos | tab=piloto; distinto de planes TMS |
| Combustible | flota_combustible:V/E; revisión/aprobación/conciliación; guard propio | tab=combustible; registro piloto en portal con identidad distinta |
| Contabilidad | contabilidad:V; escrituras C o E/rol bajo requireTenantModulo; asientos, entidades, CXC/CXP | base propia; no lógica contable en alcance |
| Facturación empresa | facturacion:V más alcanceFacturacion; cuestionario empresa | distinto del CRUD de facturas, roles limitan alcance |
| Reciclaje / Tarimas | respectivos V/escritura bajo requireTenantModulo | acciones de módulo, no CRUD inventado |
| CMS | cms:V/escritura requireTenantModulo | Sitio Web |
| Administración | Usuarios/limpieza exclusivamente Admin; dashboard Gerencia por rol | mantener bypass, no nuevos usuarios especiales |

## Caso reportado mcaal

No se conocen aún sus filas efectivas ni su rol. No es legítimo afirmar una
causa individual exacta sin esos datos. Hay una causa reproducible independiente
del username: JefeOperaciones/GerenteOperaciones/AuxiliarOperaciones con
facturacion:ver no pasa alcanceFacturacion(...).verClientes y no ve el menú.
FacturasPanel sí usa el permiso propio de facturacion. La API de clientes
también mantiene un alcance por rol: no se debe habilitar el cuestionario
confundiendo acceso a facturas con edición de requisitos.

La corrección debe permitir llegar a la pestaña Facturas con permiso base
facturacion:ver, manteniendo independientes los alcances de cuestionarios.
No hay endpoint PDF de factura encontrado; no se crea una capacidad inexistente.

## Política de compatibilidad propuesta

Conservar nombres y flags existentes. Acciones nuevas separadas (emitir,
anular, registrar pago, estado de cotización, exportaciones reales) se pueden
representar con filas adicionales cuyo modulo cabe en VARCHAR(40).
Mapear exclusivamente los grants que YA daban esa acción; nunca eliminar
genérico hacia anular. Una fila explícita de acción, incluso falsa, prevalece
al adaptador. Preservar filas desconocidas al editar.

La visualización inferida antigua requiere adaptación explícita al leer,
no un OR de todas las acciones en el sidebar nuevo. Compras tiene V estricto
desde antes: no convertir crear/editar de Compras en acceso a su listado.
Al asignar una acción nueva activar su base; al quitar base limpiar acciones
dependientes. No perder revocaciones ni convertir roles en excepciones.

No se necesita cambio de esquema para filas adicionales según schema.sql;
no se ejecuta ni se propone ALTER innecesario. La compatibilidad de la BD real
no fue consultada; no se afirma que se haya migrado ningún usuario.

## Implementación entregada

### Fuente central y UI

`src/lib/permisos-catalogo.ts` define las seis áreas, módulos, acciones reales,
etiquetas, dependencias, adaptación legacy y operaciones masivas. Las acciones
que ya compartían un guard permanecen agrupadas con un nombre explícito; no se
fabrica CRUD ni una capacidad PDF de factura que no existe.

El editor de Usuarios consume ese catálogo, conserva permisos especializados y
filas desconocidas, activa Ver al conceder una acción y limpia el módulo y sus
filas dependientes al quitar Ver. Administración se muestra como información:
Usuarios/limpieza siguen siendo exclusivos del rol Admin, no asignables en la matriz.
Costeo conserva la advertencia CONFIDENCIAL y su guard separado.

### Persistencia y equivalencias

Se reutiliza `usuario_modulo`: no hay SQL/migración nueva. Los identificadores
caben en VARCHAR(40); se conservan los cuatro flags existentes. Las nuevas filas
usan puede_ver como bit de la acción específica, no como lectura de otro módulo.

| Acción nueva | Grant previo equivalente |
| --- | --- |
| facturacion_emitir | facturacion:editar |
| facturacion_anular | facturacion:editar, nunca eliminar |
| facturacion_pagos | facturacion:crear |
| cotizaciones_estado | cotizaciones:editar o TMS:editar legacy |
| programacion_exportar | programacion:ver o TMS:ver legacy |
| tms_gestionar / reciclaje_gestionar / tarimas_gestionar | escritura que su guard general ya aceptaba por crear/editar/rol |
| cms_publicar | escritura que el guard CMS ya aceptaba |

Las filas de viaticos_autorizar/pagar/liquidar/comprobantes, viajes_cerrar,
gastos_autorizar, gastos_operativos_autorizar, compras_autorizar y
rrhh_requerimientos_autorizar se reutilizan, no se reemplazan.
Accesos proveedores conserva rol/tenant/asignación y cifrado; la matriz permite
restringir sus acciones sin ampliar los roles que ya tenían acceso.

El adaptador materializa en memoria las lecturas ya inferidas por los guards
antiguos, incluyendo las lecturas de permisos especializados y Flota. No concede
listado de compras_requerimientos desde crear/editar, porque ese guard ya era
estricto. Los grants heredados de TMS para Rutas/Gastos/Cotizaciones se convierten
en sus equivalentes propios; no se vuelven a aplicar después de guardar V2.

La fila técnica `permisos_acciones_v2` distingue la matriz explícita de una matriz
legacy. Una denegación explícita de acción prevalece sobre su equivalencia
anterior. Quitar Ver también elimina la lectura de las filas hijas, evitando que
sus GET vuelvan a habilitar el módulo. No se migra masivamente a ningún usuario.

Guardar la matriz es transaccional y conserva filas en cero; un fallo hace
rollback, no deja permisos parcialmente reemplazados. La variante antigua de dos
flags sigue admitiendo lectura legacy; guardar V2 exige los cuatro flags del
schema canónico y falla ANTES del DELETE si faltan. No se degrada silenciosamente
una revocación. La versión física de producción no fue consultada: si una
instalación todavía tiene solo dos flags, requiere verificar previamente su
esquema, no ejecutar este editor suponiendo compatibilidad.

### Sidebar y backend

`src/lib/sidebar-activo.ts` selecciona un enlace visible más específico por
pathname y query. Reconoce las pestañas Flota, vistas Facturación y bookmarks
Flota por segmento; no activa hermanos por prefijos parciales. El grupo ganador
se abre sin resaltar todos sus hijos. La visibilidad usa Ver explícito.

Facturación clientes deja de depender del alcance de cuestionarios por rol para
mostrar su enlace. Con facturacion:ver se llega a Facturas, incluso si el rol no
puede consultar requisitos de clientes. Esos cuestionarios mantienen sus alcances
anteriores. La página y APIs exigen base Ver; emitir, anular y pagos tienen guards
propios. El catálogo mínimo de facturas consulta solo id/nombre de clientes
activos de la empresa; no expone cuestionarios ni concede su administración.

Estado de cotización y exportación de viajes usan acciones específicas.
Autorizar/rechazar, cerrar, aprobar combustible, liquidar, costeo y ajustes
conservan sus guards especializados existentes; no se sustituyen por un permiso
general. Rutas/Gastos/Cotizaciones V2 respetan su permiso propio, no recuperan una
revocación desde TMS. Los guards generales TMS/Reciclaje/Tarimas/CMS validan su
acción central, conservando la equivalencia legacy por rol únicamente en el
adaptador.

Facturas y Accesos proveedores presentan botones según acciones independientes.
CMS/Reciclaje/Tarimas ocultan los formularios sin gestionar/publicar; el panel de
habilitaciones TMS usa la misma acción central que su guard. No se cambian datos,
estados de negocio, cálculos, montos, PDFs, RRHH funcional ni nómina.

### Límite del diagnóstico individual

La causa estructural de Facturación está reproducida con fixtures de
JefeOperaciones/GerenteOperaciones/AuxiliarOperaciones con facturacion:ver.
No se recibieron el rol y las filas efectivas reales de mcaal: no se afirma que
esa sea la causa individual exacta en producción ni que se hayan corregido sus
datos. No hay excepciones por username.

## Validación final

Base exacta: `98c94c7be4a0284e73c830e285b0c7f9834c59a6`, aún origin/main
tras el último fetch. Rama `codex/permisos-granulares-sidebar`.

- Dirigidas permisos/sidebar/APIs y habilitaciones: **210/210**, 21 archivos.
- `npx tsc --noEmit`: exitoso.
- `git diff --check`: exitoso.
- `npm run build`: exitoso, Next.js 16.3.6. Avisos de middleware,
  Cache-Control/tracing en rutas no modificadas; no se cambia configuración.
- ESLint sobre archivos tocados: **6 errores preexistentes / 0 nuevos**,
  regla react-hooks/set-state-in-effect. Se ejecutó también sobre los mismos
  archivos del BASE: CMS 1, Reciclaje 1, Tarimas 1, FacturacionClient 3.
  No se suprimieron reglas ni se reporta lint completamente limpio.

### Suite completa comparada por identidad

Misma máquina Windows, Node v24.18.0/npm 11.16.0, mismas dependencias
(package-lock sin cambios), mismo comando `npx vitest run --reporter=json`.
BASE ejecutado en worktree detached del SHA exacto; HEAD en worktree aislado.
Reportes generados fuera del repositorio.

| Ejecución | Pass | Fail | Skip |
| --- | ---: | ---: | ---: |
| BASE | 8483 | 21 | 15 |
| HEAD | 8538 | 21 | 15 |

Comparación normalizando únicamente el prefijo absoluto del worktree:
archivo + nombre completo + mensaje principal. **Composición idéntica:
CERO REGRESIONES NUEVAS**. No se deduce preexistencia solo por estar fuera de
este ticket. Los dos guards de Compras que inspeccionan un diff histórico
también fallaron en el BASE ejecutado ahora. La falta de unzip está confirmada
en ambas ejecuciones. Las aserciones de fuente/mocks que sí necesitaban actualización
por los nuevos helpers se ajustaron conservando sus comprobaciones funcionales.

Fallos comunes BASE/HEAD:

1. `src/components/tms/centro-logistico-resumen.test.ts`
   - Test: Centro logístico: navegación y resumen visual presenta el título y las secciones en el orden requerido
   - Mensaje: AssertionError: expected false to be true // Object.is equality

2. `src/lib/compras/contratos.test.ts`
   - Test: no modifica RRHH, credenciales ni esquema SQL
   - Mensaje: AssertionError: expected true to be false // Object.is equality

3. `src/lib/compras/requerimiento-ui.test.ts`
   - Test: ajuste transversal sin SQL, RRHH, programación ni credenciales
   - Mensaje: AssertionError: expected true to be false // Object.is equality

4. `src/lib/tms/programacion-import-excel.test.ts`
   - Test: generarPlantillaProgramacion define named ranges de libro para los 3 catálogos usados en dropdowns
   - Mensaje: Error: Command failed: unzip -p "C:/Users/Admin/AppData/Local/Temp/claude/xlsxtest/plantilla-programacion-test.xlsx" xl/workbook.xml

5. `src/lib/tms/vehiculo-solicitado.test.ts`
   - Test: catálogo reutilizado: perfiles de costeo por empresa GET /tms/catalogos lo expone (aditivo) con la empresa de la sesión
   - Mensaje: AssertionError: expected 'import { NextResponse } from "next/se…' to match /personal,\n\s+vehiculosSolicitables,/

6. `src/app/e/[slug]/programacion/programacion-exportar-imagen-wiring.test.ts`
   - Test: programacion-client.tsx — Exportar imagen «Exportar imagen» solo existe en Programación — ningún otro módulo importa programacion-exportar-imagen ni programacion-imagen
   - Mensaje: AssertionError: expected [ …(2) ] to deeply equal []

7. `src/app/e/[slug]/atraccion-talento/reportes/page.test.ts`
   - Test: ATRACCION-TALENTO-1/2 — closure de filtros en cargar() 38) el montaje inicial sigue siendo una sola carga: el useEffect que llama cargar() al montar tiene deps [] — cambiar un filtro por sí solo NO dispara fetch
   - Mensaje: AssertionError: expected -1 to be greater than -1

8. `src/app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts`
   - Test: PATCH — editar el TC de un viaje PROPIO editar OTROS campos conserva el TC (no reescribe las columnas TC) y el propio plan se autoexcluye de la validación
   - Mensaje: AssertionError: expected 400 to be 200 // Object.is equality

9. `src/app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts`
   - Test: PATCH — editar el TC de un viaje PROPIO el mismo TC enviado de nuevo no se re-valida (ni por taller) ni se reescribe
   - Mensaje: AssertionError: expected 400 to be 200 // Object.is equality

10. `src/app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts`
   - Test: PATCH — editar el TC de un viaje PROPIO cambiar de TC valida el nuevo (acceso + clasificación) y reescribe id + fotografía
   - Mensaje: AssertionError: expected 400 to be 200 // Object.is equality

11. `src/app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts`
   - Test: PATCH — editar el TC de un viaje PROPIO cambiar a un TC ya asignado ese día a OTRO plan -> 409 (backend, no solo UI)
   - Mensaje: AssertionError: expected 400 to be 409 // Object.is equality

12. `src/app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts`
   - Test: PATCH — editar el TC de un viaje PROPIO cambiar la fecha del plan revalida el TC contra la NUEVA fecha
   - Mensaje: AssertionError: expected 400 to be 409 // Object.is equality

13. `src/app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts`
   - Test: PATCH — editar el TC de un viaje PROPIO tcVehiculoId: null quita el TC
   - Mensaje: AssertionError: expected 400 to be 200 // Object.is equality

14. `src/app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts`
   - Test: PATCH — TC de un viaje TERCERIZADO y cambio de tipo edición conserva/actualiza el snapshot externo (tcExternoPlaca en mayúsculas) sin tocar el catálogo interno
   - Mensaje: AssertionError: expected 400 to be 200 // Object.is equality

15. `src/app/api/empresas/[slug]/tms/planes/programacion-viajes-tercerizados.test.ts`
   - Test: PATCH /tms/planes — patchTipoViaje: cambio de tipo aislado un PATCH sin tipoViaje sigue el flujo normal (no entra a patchTipoViaje, no dispara su SELECT dedicado)
   - Mensaje: AssertionError: expected 400 to be 200 // Object.is equality

16. `src/app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts`
   - Test: PATCH /tms/planes — editar y dejar el regreso estimado en null regresoEstimado: null con piloto asignado no da 400 y guarda NULL (sin inventar una hora)
   - Mensaje: AssertionError: expected 400 to be 200 // Object.is equality

17. `src/app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts`
   - Test: PATCH /tms/planes — editar y dejar el regreso estimado en null un plan que ya no tenía regreso estimado se puede seguir editando sin exigirlo
   - Mensaje: AssertionError: expected 400 to be 200 // Object.is equality

18. `src/app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts`
   - Test: PATCH /tms/planes — editar y dejar el regreso estimado en null al editar sin regreso estimado, se valida la fecha efectiva
   - Mensaje: TypeError: Cannot read properties of undefined (reading 'sql')

19. `src/app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts`
   - Test: PATCH /tms/planes — editar y dejar el regreso estimado en null editar y dejar null conserva la validación por empresa y excluye al propio plan
   - Mensaje: TypeError: Cannot read properties of undefined (reading 'sql')

20. `src/app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts`
   - Test: PATCH /tms/planes — editar y dejar el regreso estimado en null editar y conflicto con un viaje abierto de OTRO plan del mismo piloto: 409
   - Mensaje: AssertionError: expected 400 to be 409 // Object.is equality

21. `src/app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts`
   - Test: identidad de personal por empleado — POST y PATCH usan la misma regla PATCH: al mover el viaje, el piloto (personal 12, empleado 55) choca con un viaje donde el mismo empleado es Auxiliar (personal 10): 409
   - Mensaje: AssertionError: expected 400 to be 409 // Object.is equality

## Archivos del cambio (49)

No se incluyen sql/, schema, package-lock, catalogos-nomina ni cambios ajenos
del checkout principal. Las modificaciones en tests de Compras/RRHH/Programación
son contratos de navegación o mocks de guards, no lógica productiva de esos módulos.

```text
src/app/api/empresas/[slug]/facturacion/facturas/[id]/anular/route.test.ts
src/app/api/empresas/[slug]/facturacion/facturas/[id]/anular/route.ts
src/app/api/empresas/[slug]/facturacion/facturas/[id]/emitir/route.test.ts
src/app/api/empresas/[slug]/facturacion/facturas/[id]/emitir/route.ts
src/app/api/empresas/[slug]/facturacion/facturas/[id]/pagos/route.test.ts
src/app/api/empresas/[slug]/facturacion/facturas/[id]/pagos/route.ts
src/app/api/empresas/[slug]/portales-proveedores/[id]/revelar/route.ts
src/app/api/empresas/[slug]/portales-proveedores/[id]/route.ts
src/app/api/empresas/[slug]/portales-proveedores/route.test.ts
src/app/api/empresas/[slug]/portales-proveedores/route.ts
src/app/api/empresas/[slug]/tms/cotizaciones/[id]/estado/route.ts
src/app/api/empresas/[slug]/tms/reportes/viajes/export/route.test.ts
src/app/api/empresas/[slug]/tms/reportes/viajes/export/route.ts
src/app/api/usuarios/route.ts
src/app/e/[slug]/cms/page.tsx
src/app/e/[slug]/cotizaciones/page.tsx
src/app/e/[slug]/facturacion/page.tsx
src/app/e/[slug]/layout.tsx
src/app/e/[slug]/reciclaje/page.tsx
src/app/e/[slug]/tarimas/page.tsx
src/app/e/[slug]/tms/page.tsx
src/app/e/[slug]/usuarios/page.tsx
src/components/app-shell-atraccion-talento.test.ts
src/components/app-shell-operaciones.test.ts
src/components/app-shell.tsx
src/components/facturacion/facturacion-client.tsx
src/components/facturacion/facturas-panel.tsx
src/components/facturacion/viajes-pendientes-panel.tsx
src/components/proveedores/portales-proveedores-client.tsx
src/components/tms/habilitaciones-panel.test.ts
src/lib/compras/contratos.test.ts
src/lib/compras/requerimiento-ui.test.ts
src/lib/permisos-shared.ts
src/lib/permisos.ts
src/lib/rrhh/requerimiento-acceso-rrhh.test.ts
src/lib/tenant.ts
src/lib/tms/cotizaciones-acciones-ui.test.ts
src/lib/tms/reportes-viajes-tc.test.ts
src/lib/tms/vehiculo-solicitado.test.ts
docs/PERMISOS-GRANULARES-DISCOVERY.md
src/app/api/empresas/[slug]/facturacion/facturas/catalogos/route.test.ts
src/app/api/empresas/[slug]/facturacion/facturas/catalogos/route.ts
src/components/app-shell-facturacion-permisos.test.ts
src/lib/permisos-catalogo.test.ts
src/lib/permisos-catalogo.ts
src/lib/permisos-persistencia.test.ts
src/lib/sidebar-activo.test.ts
src/lib/sidebar-activo.ts
src/lib/tenant-acciones-catalogo.test.ts
```

## Límites y entrega

- No se ejecutó SQL en producción ni se accedió a Hostinger.
- No requiere migración para el schema canónico de cuatro flags.
- No hay cambios de cálculos, PDFs, inventario, programación de recursos o nómina.
- La matriz continúa siendo global al usuario, con alcance de empresas separado
  en usuario_empresa; este PR no transforma ese contrato.
- Falta confirmar las filas efectivas del usuario reportado para atribuirle
  una causa individual; sí se prueba y corrige la inconsistencia estructural.
- Un único PR hacia main; **NO MERGE**.
