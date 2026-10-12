# Navegación bajo demanda y requests en curso

Base de medición: `9ccc0a0c786fd3c3b00aa3d23cd30feb4e7094eb`.
PR independiente de RRHH Fase 2 y de #442. Sin SQL ni cambios de datos,
permisos, rutas, expiración de sesión o contenido de notificaciones.

## Discovery y causa demostrada

- `src/components/app-shell.tsx` construye el sidebar según permisos. Un Admin
  con RRHH/TMS/Flota/Clientes/Contabilidad/Facturación/CMS/Usuarios/Gerencia
  habilitados tiene 55 enlaces disponibles si abre todos los grupos; RRHH tiene
  18. No es el número visible de cualquier usuario: depende de módulos, permisos,
  grupos abiertos, tamaño y scroll. Grupos cerrados no montan `ShellNavLink`.
- `src/components/shell-nav-link.tsx` YA tenía `prefetch={false}`. No era prefetch
  automático por viewport: un scheduler manual llamaba `router.prefetch(href)`
  tras 40 ms en hover/focus/touch y algunos clicks. Su Set global evitaba repetir
  href, pero no la visita involuntaria a muchas rutas y no cancelaba al salir.
  Se elimina el scheduler, conservando Next Link, href, click y pending.
- Menús de tarjetas en `src/app/e/[slug]/rrhh/page.tsx` (6),
  `src/app/e/[slug]/reportes/page.tsx` (5) y
  `src/components/tms/centro-logistico-resumen.tsx` (5) usaban prefetch por defecto.
  Se añade `prefetch={false}`. Feed dinámico de la campana también, porque puede
  contener muchos enlaces repetidos. AccountMenu y dashboards masivos ya lo
  desactivaban. Links aislados/detalles permanecen con su comportamiento.
- No hay otro `router.prefetch` productivo encontrado en `src`, ni precarga
  manual de rutas en AppShell. No se desactiva Next globalmente.

Esto demuestra disparadores innecesarios de tráfico, NO atribuye exactamente
las 113–150 requests de producción a ellos. Runtime saturado es una hipótesis
compatible, no una medición del servidor. MariaDB bloqueada y motores de
vacaciones repetidos no tienen soporte en la evidencia entregada.

## Campana y costo del feed

`src/components/notificaciones-bell.tsx` conserva primera carga idle (timeout
5 s; fallback 2.5 s), intervalo 150 s, apertura y Actualizar. Ahora poll/click
no inician otro GET mientras uno esté pendiente. Sin caché de respuestas.
Cleanup aborta la solicitud al desmontar/cambiar slug e ignora respuesta vieja.
Errores de red liberan la guarda y mantienen el feed anterior.

`src/app/api/empresas/[slug]/notificaciones/route.ts` NO se modifica.
Medición con sus helpers reales y DB mock (Admin, sin candidatos de vacaciones):

| Componente del cuerpo del endpoint | SELECT |
| --- | ---: |
| Permisos externos | 1 |
| Alertas KM (TTL 90 s frío/caliente) | 1 / 0 |
| Recordatorios + licencias + documentos | 3 |
| Vacaciones fresh: política + candidatos | 2 |
| Solicitudes de vacaciones + saldos | 2 |
| Viáticos (3), cierre, atrasados, facturables, compras | 7 |
| Total cuerpo frío/caliente | 16 / 15 |

No incluye queries de autenticación/tenant ni permisos no-Admin; su cantidad
depende de cachés y permisos. Test `route-rendimiento.test.ts` ejecuta helpers
REALES, devuelve cero candidatos simulados y comprueba 0 conexiones de motor,
0 escrituras. No representa timings de producción ni cambia #440/vacaciones.

## Activity

`src/components/session-inactivity-guard.tsx`: GET al montar, foco o volver
visible; POST solo interacción humana confiable (pointerdown/keydown/touchstart),
throttle 60 s y coordinación best-effort existente entre pestañas (lock 15 s).
El intervalo de 1 s SOLO revisa expiración local; no llama HTTP.

Antes, GET podía comenzar durante POST y actividad humana podía iniciar POST
durante GET. Ahora una request pendiente bloquea el inicio de otra en el mismo
guard. Humanos recibidos durante GET se agrupan y envían al terminar, conservando
el timestamp local de la interacción real. Durante POST se conserva throttle
anterior. Un 401 mantiene logout, no dispara una renovación pendiente. No se
cachea autenticación ni se cambian endpoints, significado de actividad o tiempos
de expiración. Coordinación multipestaña sigue siendo best-effort, no un mutex
global del servidor. Demora de 12 s requiere traza runtime/pool/red: no se
concluye su causa a partir de processlist sin queries largas.

## Medición reproducible antes/después

`npx vitest run src/components/rendimiento-local.test.ts --reporter=verbose`

Harness local con código real obtenido de `git show BASE:path` y working tree;
timers controlados, fetch/router instrumentados, sin conexión a BD/producción.
No es browser Network ni conteo RSC.
Las 3 comparaciones históricas se omiten si un checkout shallow no contiene el
objeto BASE; no hacen fetch automático. Para reproducirlas, disponer del SHA base
en git antes de ejecutar. En la validación local actual se ejecutaron, sin skips.

| Escenario idéntico | Base | Nuevo |
| --- | ---: | ---: |
| Sidebar cerrado: enlaces montados / prefetch | 0 / 0 | 0 / 0 |
| Admin todos los grupos abiertos: enlaces disponibles | 55 | 55 |
| Render del sidebar: llamadas manuales a prefetch | 0 | 0 |
| Hover/focus/touch sobre los 18 enlaces de RRHH, 50 ms por evento | 18 | 0 |
| Click: callback de navegación | 1 | 1 |
| Campana: inicial + 2 ticks con primer fetch pendiente | 3 GET | 1 GET |
| Activity: GET pendiente + humanos/foco/visibilidad repetidos | 2 simultáneas | 1 |
| Activity: humano agrupado tras completar GET | POST ya paralelo | 1 POST secuencial |
| Activity: foco/visibilidad mientras POST sigue pendiente | inicia GET | no inicia GET |

La campana puede cancelar 1 fetch en cleanup; no hay duplicación en curso.
Las cifras de requests totales/RSC y latencias notificaciones/activity NO se
midieron en navegador productivo. No se extrapolan estos conteos a 113–150.

## Validación manual posterior (sin ejecutar durante este ticket)

1. Build de producción; mismo usuario/tenant/pantalla y cache inicial comparable.
2. Network Preserve log + Disable cache: navegar y esperar mismo lapso; registrar
   total, RSC (`_rsc`/header RSC), initiator, duración, canceladas y concurrencia.
3. Abrir RRHH/Operaciones, mover mouse/tabular sin click: ninguna precarga de
   ShellNavLink; cerrar grupos y confirmar que no montan links.
4. Click en rutas autorizadas: conserva navegación, activo/pending y permisos.
5. Throttle red: abrir/Actualizar campana durante GET lento; máximo 1 en curso.
   Cambiar tenant: abortar/ignorar anterior, nunca aplicar feed del otro tenant.
6. GET activity lento: foco/visibilidad y actividad humana no solapan HTTP; humano
   en espera produce POST secuencial. 401 sigue cerrando sesión; no cachear auth.
7. Comparar HAR internamente sin compartir secretos; tiempos de 500–1000 ms/12 s
   pueden necesitar diagnóstico adicional. No declarar mejora de latencia medida
   hasta realizar esta validación manual.

## Validación local final

Archivos exactos (13):

1. `src/components/shell-nav-link.tsx`
2. `src/components/notificaciones-bell.tsx`
3. `src/components/session-inactivity-guard.tsx`
4. `src/components/tms/centro-logistico-resumen.tsx`
5. `src/app/e/[slug]/rrhh/page.tsx`
6. `src/app/e/[slug]/reportes/page.tsx`
7. `src/lib/session-activity-client.ts`
8. `src/lib/session-activity-client.test.ts`
9. `src/components/navegacion-prefetch.test.ts`
10. `src/components/notificaciones-bell-poll.test.ts`
11. `src/components/rendimiento-local.test.ts`
12. `src/app/api/empresas/[slug]/notificaciones/route-rendimiento.test.ts`
13. `docs/RENDIMIENTO-NAVEGACION-PREFETCH.md`

- Pruebas nuevas: 17/17 (sin skip). Dirigida ampliada: 121 pass / 1 fail.
- Único fallo ampliado: `Centro logístico: navegación y resumen visual > presenta
  el título y las secciones en el orden requerido`, línea 15 de
  `src/components/tms/centro-logistico-resumen.test.ts`.
  Reproducido: base 14 pass / 1 fail en esa suite, mismos archivos que el SHA BASE
  (diff de ambos paths vacío). No se corrige un requisito visual ajeno aquí.
- TypeScript y ESLint dirigido limpios; git diff --check limpio; build exitoso.
  Advertencias existentes: Cache-Control, middleware deprecado y 4 advertencias
  de filesystem tracing fuera de los archivos productivos modificados.
- Ningún SQL, dato, endpoint productivo ni configuración de vacaciones ejecutado
  o cambiado; #442 no se modifica. No merge de esta PR.
