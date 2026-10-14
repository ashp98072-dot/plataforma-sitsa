# Navegación global: auditoría y corrección acotada

Base: `b432bd80dc52d29c9b5584c73718099c276f24a2`. Rama: `codex/navegacion-sesion-rendimiento`.
Sin SQL productivo, datos reales, reglas de negocio ni merge.

## Evidencia y causas demostradas

1. **Salida sin exclusión ni feedback.** El menú cerraba antes de esperar POST/logout, no bloqueaba clics repetidos ni manejaba fallos. El harness ejecuta el componente real BASE: dos invocaciones inmediatas producen dos POST y dos push.
2. **Carrera de cookie de sesión.** El guard global escucha pointerdown/teclado/touch. Un POST/activity iniciado por actividad humana puede quedar esperando la lectura de usuarios mientras POST/logout borra la cookie (logout usa cero SELECT). Al terminar, activity firma y escribe otra cookie. Prueba con los endpoints reales, JWT sintético y BD/cookies mockeadas: BASE permite delete → set. Esto demuestra la carrera del código; no es una captura de que ocurrió en producción.
3. **La selección comparte esa cookie.** Una renovación pendiente puede conservar el tenant anterior. Se ordena renovación → selección → eventual logout, sin alterar ningún endpoint o regla de autenticación.
4. **Waterfall del selector.** La página cliente vacía hacía GET/auth/me después de montar. Ese GET lee permisos que el selector no consume. Selector server-side conserva getSession vigente y empresasParaUsuario, sin cargar matriz ni hacer ese GET.
5. **Matriz repetida dentro de un render RSC.** Layout de empresa y Dashboard Operaciones leen permisosEfectivos(usuario, rol). Las dos llamadas reales BASE hacen dos SELECT para un no Admin. React cache deduplica únicamente dentro del mismo render (mismo patrón que getSession/obtenerEmpresaPorSlug existentes). No cambia el cálculo ni extiende frescura entre requests.

### Hipótesis descartadas / no modificadas

- Root layout: tema local + guard, sin consulta propia ni contador SQL.
- Layout de empresa: ya paraleliza empresa/lista/permisos; getSession y empresas ya tienen el patrón de deduplicación del repo.
- Sidebar: ShellNavLink ya usa prefetch=false y no router.prefetch; grupos cerrados desmontan enlaces. Los contadores son cantidades de enlaces permitidos, no consultas remotas.
- useEmpresaSession/useEmpresaActiva reutilizan el contexto; no hacen GET/auth/me por cada página.
- La campana ya agrupa solicitudes y difiere la carga inicial; intervalo 150 s. No se modifica feed, notificaciones TMS ni vacaciones.
- Activity ya evita GET/POST solapados; se conserva throttle, reloj confirmado, renovación por actividad humana y expiración. La mejora aquí es ordenar escrituras de cookie ante una acción de sesión.
- Middleware verifica JWT localmente y deja pasar APIs; no ejecuta SQL. No se modifica.
- Next conserva layouts entre navegaciones; NO se afirma que todo cambio de página vuelva a ejecutar el layout completo.

## Cambios y seguridad

- Ref síncrona para bloquear doble clic antes del siguiente render; disabled/aria-busy y Saliendo…/Cargando empresa…/Cambiando empresa…; errores explícitos y reintento.
- Coordinador cliente compartido guarda SOLO Promises en curso y flags de transición, no sesión, tokens, tenant ni permisos. El trabajo se elimina en finally; no se conserva una Promise resuelta. Una salida compartida hace un POST y una navegación, incluso ante un 401 tardío.
- Antes de salir/seleccionar se detienen nuevas renovaciones y se espera la pendiente: abortarla no probaría que un Set-Cookie no llegó. No se modifica fecha de actividad ni reglas del servidor.
- Logout y selección navegan una sola vez mediante location.replace después de confirmar el POST: frontera de sesión/tenant con documento limpio, sin reutilizar Router Cache privado del contexto anterior. Entre módulos se conserva Next Link; no se desactiva Next globalmente.
- Cambiar empresa conserva su Link/href, regla de dominio y permisos. onNavigate respeta navegación normal/teclado y no intercepta la apertura nativa en otra pestaña. Respaldo de 8 s solo para Link cancelado; nunca desbloquea un POST pendiente.
- Selector dinámico server-side valida getSession, pasa solo username/rol y empresas autorizadas. El POST existente revalida pertenencia y escribe la cookie: no se confía en una empresa libre del navegador.
- Matriz global actual (empresa_id IS NULL): memo RSC por usuario + rol; sin Map/TTL/unstable_cache/use cache compartido. Requests nuevos leen de nuevo; Route Handlers sin dispatcher conservan lectura por llamada. Guards y filtro de capacidades por empresa intactos.
- Los TTL de empresas preexistentes NO se amplían ni se modifican; no se presenta esta PR como eliminación de ese riesgo existente.
- Portales colaborador/cliente conservan su flujo independiente.

## Medición reproducible BASE → HEAD

Windows, Node 24.18.0/npm 11.16.0, mismas dependencias, fetch/BD/cookies sintéticos. Harness VM ejecuta handlers originales, siguiendo el patrón de pruebas del repo; memo RSC usa dispatcher de test delimitado por render. No es navegador ni latencia productiva.

| Escenario medido | BASE | HEAD |
|---|---|---|
| Doble invocación logout antes de respuesta | 2 POST, 2 push | 1 POST, 1 navegación de documento |
| Selector, dos clics antes de respuesta | GET/me + 2 POST, 2 push | 0 GET/me + 1 POST, 1 navegación |
| Selector, un clic normal | GET/me + 1 POST | 1 POST (sin GET/me) |
| Datos del selector, SQL frío | 3 SELECT en /me | 2 SELECT en página SSR |
| Matriz layout + Dashboard Operaciones, mismo render/no Admin | 2 SELECT iguales | 1 SELECT, salida igual |
| Logout backend | 0 SELECT | 0 SELECT |
| Carrera de cookie | delete → set posible | set → delete; sin renovación nueva durante salida |

Tiempo controlado: inyectando 400 ms al GET/me, BASE no tiene botones de empresas hasta esos 400 ms; HEAD los recibe desde el render inicial, sin espera cliente adicional. Esto excluye el costo SSR y NO demuestra un ahorro de 400 ms de producción ni una reducción universal del tiempo total. La sincronización previa de activity puede seguir demorando la salida si esa request ya era lenta; el estado visual aparece desde el primer clic. No se inventa un ranking de rutas por latencia.

### Recorridos solicitados

| Recorrido | Evidencia local / lecturas comunes |
|---|---|
| RRHH → Empleados | ShellNavLink real: un intento y href correcto, sin fetch/prefetch manual en BASE/HEAD. Empleados carga listado + catálogo de supervisores (2 GET de datos por código, sin cambiar negocio); fotos/edición pueden añadir requests. |
| Empleados → Dashboard RRHH | Mismo wiring sin precarga; dashboard usa su GET de datos. Hook de empresa no agrega /me. |
| RRHH → Operaciones | Mismo wiring; en entrada donde layout y Dashboard se renderizan juntos se elimina una lectura repetida de matriz no Admin. Si el layout ya está preservado, no se promete ese ahorro. |
| Operaciones → Programación | Mismo wiring; listado/pendientes son 2 GET en paralelo por código, con polling propio. Editor/cargos pueden añadir requests; no se tocan. |
| Cambiar empresa | Un Link a /select-empresa, sin POST ni refresh en el handler; datos SSR sin GET/me posterior. |
| Seleccionar Kuiqtrans / Logiservicios Mónaco | Fixture explícito kt-monaco: un POST al endpoint protegido, cookie del servidor y una navegación; ajena devuelve 403 sin cookie. No se consulta producción. |
| Salir | Un POST/logout, estado Saliendo…, coordinación con activity y una navegación /login. |

Los conteos de los handlers y SELECT anteriores están medidos por pruebas. Los GET de datos de módulos son wiring revisado, NO una captura total de Network. No se midieron RSC/HTML/assets ni tiempos reales de las pantallas completas: siguen pendientes de QA en navegador. No se afirma equivalencia con las 113–150 requests reportadas históricamente.

## Validación

- Dirigidas finales: 97/97.
- Suite BASE: 10.258 pass / 22 fail / 415 skip.
- Suite HEAD: 10.288 pass / 22 fail / 415 skip; comparación por archivo, nombre exacto y mensaje principal: misma composición, cero regresiones nuevas.
- TypeScript, ESLint dirigido, diff-check y build limpios; avisos de middleware/Cache-Control/filesystem en archivos no modificados.
- Las pruebas que comparan fuentes históricas se omiten si el objeto BASE no existe en un checkout shallow; sin fetch desde tests.

## Archivos

Código: src/components/account-menu.tsx; src/components/session-inactivity-guard.tsx; src/lib/session-navigation.ts; src/lib/permisos.ts; src/app/select-empresa/page.tsx; src/app/select-empresa/select-empresa-client.tsx.

Pruebas: account-menu.test.ts; novalvion-branding.test.ts (ubicación del mismo markup); rendimiento-local.test.ts (nuevo import del guard en VM); navigation-session.test.ts; permisos-request.test.ts; session-navigation.test.ts; select-empresa/select-empresa.test.ts. Documento: este archivo.

## Riesgos / QA posterior

1. Una renovación HTTP anterior muy lenta seguirá retrasando el POST/logout o selección, para mantener orden seguro de cookies. No se agrega timeout que simule una salida exitosa; feedback inmediato y exclusión de repetidos.
2. location.replace descarta el contexto privado pero implica carga de documento/assets en fronteras de sesión. No se afirma que sea más rápida en todas las redes. Navegación entre módulos continúa cliente.
3. No se aceleran consultas de negocio, generación de reportes o payloads de páginas; no hay evidencia productiva para optimizarlas en esta PR.
4. QA después de despliegue aprobado: rol Admin y no Admin; probar los siete recorridos con Network Preserve log; contar requests RSC, HTML, API y assets por separado; medir TTFB y click→contenido; repetir con activity pendiente, dos clics rápidos, empresa única, empresa ajena, fallo de red, logout→login con otro usuario y otra pestaña. Confirmar un POST y un destino por acción y ninguna restauración de cookie/tenant anterior.
5. NO SQL, NO datos productivos, NO cambios de TMS/liquidación/cargos/RRHH/facturación, NO merge.

## Fallos idénticos BASE/HEAD (identidad exacta)

| Archivo (src/) | Test | Mensaje principal |
|---|---|---|
| components/tms/centro-logistico-resumen.test.ts | Centro logístico: navegación y resumen visual presenta el título y las secciones en el orden requerido | AssertionError: expected false to be true // Object.is equality |
| lib/compras/contratos.test.ts | no modifica RRHH, credenciales ni esquema SQL | AssertionError: expected true to be false // Object.is equality |
| lib/compras/requerimiento-ui.test.ts | ajuste transversal sin SQL, RRHH, programación ni credenciales | AssertionError: expected true to be false // Object.is equality |
| lib/rrhh/vacaciones-sync-invalida.test.ts | contratos de invalidación y esquema migración aditiva coincide exactamente con schema y protege tenant por FK compuesta | AssertionError: expected '-- Plataforma corporativa multiempres…' to contain 'CREATE TABLE IF NOT EXISTS rrhh_vacac…' |
| lib/tms/programacion-import-excel.test.ts | generarPlantillaProgramacion define named ranges de libro para los 3 catálogos usados en dropdowns | Error: Command failed: unzip -p "C:/Users/Admin/AppData/Local/Temp/claude/xlsxtest/plantilla-programacion-test.xlsx" xl/workbook.xml |
| lib/tms/vehiculo-solicitado.test.ts | catálogo reutilizado: perfiles de costeo por empresa GET /tms/catalogos lo expone (aditivo) con la empresa de la sesión | AssertionError: expected 'import { NextResponse } from "next/se…' to match /personal,\n\s+vehiculosSolicitables,/ |
| app/e/[slug]/programacion/programacion-exportar-imagen-wiring.test.ts | programacion-client.tsx — Exportar imagen «Exportar imagen» solo existe en Programación — ningún otro módulo importa programacion-exportar-imagen ni programacion-imagen | AssertionError: expected [ …(2) ] to deeply equal [] |
| app/e/[slug]/atraccion-talento/reportes/page.test.ts | ATRACCION-TALENTO-1/2 — closure de filtros en cargar() 38) el montaje inicial sigue siendo una sola carga: el useEffect que llama cargar() al montar tiene deps [] — cambiar un filtro por sí solo NO dispara fetch | AssertionError: expected -1 to be greater than -1 |
| app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts | PATCH — editar el TC de un viaje PROPIO editar OTROS campos conserva el TC (no reescribe las columnas TC) y el propio plan se autoexcluye de la validación | AssertionError: expected 400 to be 200 // Object.is equality |
| app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts | PATCH — editar el TC de un viaje PROPIO el mismo TC enviado de nuevo no se re-valida (ni por taller) ni se reescribe | AssertionError: expected 400 to be 200 // Object.is equality |
| app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts | PATCH — editar el TC de un viaje PROPIO cambiar de TC valida el nuevo (acceso + clasificación) y reescribe id + fotografía | AssertionError: expected 400 to be 200 // Object.is equality |
| app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts | PATCH — editar el TC de un viaje PROPIO cambiar a un TC ya asignado ese día a OTRO plan -> 409 (backend, no solo UI) | AssertionError: expected 400 to be 409 // Object.is equality |
| app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts | PATCH — editar el TC de un viaje PROPIO cambiar la fecha del plan revalida el TC contra la NUEVA fecha | AssertionError: expected 400 to be 409 // Object.is equality |
| app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts | PATCH — editar el TC de un viaje PROPIO tcVehiculoId: null quita el TC | AssertionError: expected 400 to be 200 // Object.is equality |
| app/api/empresas/[slug]/tms/planes/programacion-tc.test.ts | PATCH — TC de un viaje TERCERIZADO y cambio de tipo edición conserva/actualiza el snapshot externo (tcExternoPlaca en mayúsculas) sin tocar el catálogo interno | AssertionError: expected 400 to be 200 // Object.is equality |
| app/api/empresas/[slug]/tms/planes/programacion-viajes-tercerizados.test.ts | PATCH /tms/planes — patchTipoViaje: cambio de tipo aislado un PATCH sin tipoViaje sigue el flujo normal (no entra a patchTipoViaje, no dispara su SELECT dedicado) | AssertionError: expected 400 to be 200 // Object.is equality |
| app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts | PATCH /tms/planes — editar y dejar el regreso estimado en null regresoEstimado: null con piloto asignado no da 400 y guarda NULL (sin inventar una hora) | AssertionError: expected 400 to be 200 // Object.is equality |
| app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts | PATCH /tms/planes — editar y dejar el regreso estimado en null un plan que ya no tenía regreso estimado se puede seguir editando sin exigirlo | AssertionError: expected 400 to be 200 // Object.is equality |
| app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts | PATCH /tms/planes — editar y dejar el regreso estimado en null al editar sin regreso estimado, se valida la fecha efectiva | TypeError: Cannot read properties of undefined (reading 'sql') |
| app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts | PATCH /tms/planes — editar y dejar el regreso estimado en null editar y dejar null conserva la validación por empresa y excluye al propio plan | TypeError: Cannot read properties of undefined (reading 'sql') |
| app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts | PATCH /tms/planes — editar y dejar el regreso estimado en null editar y conflicto con un viaje abierto de OTRO plan del mismo piloto: 409 | AssertionError: expected 400 to be 409 // Object.is equality |
| app/api/empresas/[slug]/tms/planes/regreso-opcional.test.ts | identidad de personal por empleado — POST y PATCH usan la misma regla PATCH: al mover el viaje, el piloto (personal 12, empleado 55) choca con un viaje donde el mismo empleado es Auxiliar (personal 10): 409 | AssertionError: expected 400 to be 409 // Object.is equality |
