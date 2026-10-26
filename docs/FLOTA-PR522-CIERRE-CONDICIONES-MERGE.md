# PR #522: cierre de condiciones del formulario

Base de esta corrección: `52e50e6a182b592440dc4a0c8b9a9fa3afe12da4`.
Alcance: formulario de Flota, pruebas y este informe. Sin cambios de servidor,
permisos, esquema, migraciones, kilometraje, acceso ni resolución de placas.

## Corrección y pruebas

Ambos guardados usan una única referencia de exclusión por formulario, tomada
sincrónicamente antes de la solicitud. El estado React deshabilita el fieldset
completo; la referencia evita doble entrada incluso desde eventos del mismo
render. El bloqueo cubre respuesta, JSON y recarga, con liberación en `finally`.
Se bloquean cambio/cierre de unidad y las acciones de baja/eliminación iniciadas
desde el listado mientras guarda el formulario; no cambia su implementación HTTP.
No se encolan guardados con datos antiguos ni se reintentan automáticamente.

El guardado de propiedad mantiene los demás campos pendientes. Los errores de
validación, conflicto, servidor, red y JSON conservan el borrador. El guardado
general exitoso conserva su cierre habitual, con los controles bloqueados durante
la solicitud para impedir ediciones posteriores que pudiera descartar la respuesta.
Una respuesta perdida puede corresponder a un commit real: verificar resultado
antes de repetir. El candado es de esta instancia del formulario, no una promesa
de exclusión entre pestañas; la revisión de propiedad del servidor no cambia.

`guardado-vehiculo.dom.test.ts` monta el componente real `FlotaClient`, con HTTP
simulado y respuestas diferidas. Sus 11 casos cubren ambos órdenes de guardado,
doble envío antes de un nuevo render, bloqueo de controles/cambio de unidad,
preservación tras recarga de propiedad, HTTP 400/409/500, red, JSON inválido,
cancelación y bloqueo durante la recarga. No conecta a ninguna base.

Validación: **1.068 aprobadas, 92 omitidas**, en Flota y componentes Flota/CB2
(94 archivos aprobados, seis omitidos). TypeScript sin emisión aprobado.
ESLint: hook/pruebas sin errores ni advertencias; cliente general conserva los
ocho errores `react-hooks/set-state-in-effect` de main, mismas reglas/mensajes.
`git diff --check` aprobado. No se ejecutan build productivo ni pruebas de motor.

## Despliegue: evidencia de código y pendientes externos

Revisados `package.json`, `next.config.ts`, `scripts/start-hostinger.mjs`,
`scripts/pack-hostinger.mjs`, `DEPLOY-HOSTINGER.md`, `env.hostinger.example`,
`propiedad.ts`, rutas de vehículos y bootstrap de Flota.

- `build` ejecuta `next build`; `start`, `next start`; `start:hostinger` carga
  configuración externa y ejecuta `next start`. No invocan `db:init` ni el SQL
  de propiedad. El empaquetador copia/prepara el ZIP, sin ejecutar esa migración.
- `db:init` sigue siendo un comando explícito independiente. No hay hooks npm
  pre/post install, build o start que lo invoquen en este package.json.
- El flag requiere el valor exacto `FLOTA_PROPIEDAD_EXTERNA=1`; el código no lo
  asigna automáticamente. Apagado, se omite el enriquecimiento con columnas nuevas
  y el servicio de escritura de propiedad rechaza la operación.
- Los SQL de propiedad permanecen separados y manuales, sin ejecutarlos ni
  modificarlos. El bootstrap preexistente puede hacer DDL al atender peticiones;
  no incorpora las columnas nuevas de propiedad. No afirmar que toda la
  aplicación está libre de DDL automático.

**Pendiente externo:** confirmar por el responsable de Hostinger el flag efectivo
en todos los procesos y fuentes de configuración, comandos reales de build/start,
hooks adicionales y ausencia de tareas externas que invoquen inicialización o SQL.
El arranque puede heredar variables del entorno o cargarlas desde archivos externos;
el repositorio no certifica sus valores. No se inspeccionaron credenciales,
configuración efectiva, archivos de Hostinger ni producción.

## Riesgos preexistentes expresamente pendientes

`actualizarKmActualVehiculo` puede propagar kilometraje entre 603 y 1297 por
placa/acceso compartido. `vehiculoPorPlaca` puede resolver una coincidencia exacta
ambigua mediante `LIMIT 1`. No se corrigen ni se deshabilitan aquí. El merge
**no garantiza aislamiento absoluto del vehículo 1297** ni certifica ausencia de
escritores o efectos en producción. Requieren autorización y trabajo separados.

## Veredicto separado del retiro

**APTO CON CONDICIONES para merge del código con funcionalidad apagada.**
La condición de carrera queda corregida y verificada localmente. La condición
operativa externa sigue pendiente: confirmar flag apagado y comandos/hooks sin
migraciones ni `db:init`. No declarar comprobado ese punto por inspección del código.
La decisión no habilita la funcionalidad ni autoriza ejecutar migraciones.

El retiro del 603 continúa **BLOQUEADO**, incluido su acceso `(603,1)`. No cambia
el 1297, sus 13 referencias de fondos, su unidad TMS ni ningún histórico. No se
ejecutaron SQL, bases de prueba, modificaciones productivas, merge ni deploy.
