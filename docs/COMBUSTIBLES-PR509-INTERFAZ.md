# PR #509 — Interfaz de Combustibles

Base: main 9b1259ba (PR #508 integrado, incluida correccion de ORIGEN).
La interfaz se integra en `/e/[slug]/combustibles`, la opcion EXISTENTE de
**Operaciones → Combustibles**, entre Planes / Viajes y Viaticos. No se cambia
app-shell, no se agregan rutas/opciones de Flota ni otro punto de entrada CB2.

## Funciones entregadas

- Importar Excel HALEL/SHELL, proveedor de la empresa y moneda GTQ/USD declarada.
- Preview con vale, placa, fecha, importes, errores, motivos y documento verificable.
  Selector buscable de unidades del catalogo accesible. Seleccion por candidato:
  sus apariciones comparten unidad; bloqueados no se pueden forzar.
- Confirmacion parcial explicita. Se conserva toda la evidencia, tambien sin
  candidatos seleccionados si el operador confirma guardar solo evidencia.
  Antes de confirmar se obtiene recibo NUEVO para las decisiones exactas.
- Consumos con busqueda por vale/placa, proveedor, estado y fechas; filtros en
  servidor ANTES de la paginacion por cursor. Seleccion de lote entre paginas.
- Consulta paginada de facturas por proveedor/identidad. Documento existente
  conserva proveedor y ceros del numero. Asociacion atomica de consumos del
  mismo proveedor/moneda con revisiones de TODAS las importaciones del lote.
  Permite captura documental completa o seleccion de una factura existente.
  Fecha y total opcionales NO se calculan desde consumos. No hay reasignaciones.
- Historial con estado/revision/resumen, evidencia y eventos paginados visualmente.
  Para resolver y presentar trazabilidad se recuperan TODAS las paginas del diario,
  sin asumir que la primera contiene los originales o la revision vigente.
- Reanudacion solo Admin con conciliar, seleccion/motivo y revision esperada.
  El Excel privado sigue siendo fuente exclusiva en servidor. La interfaz no
  envia celdas editadas ni moneda elegida en lugar de la original validada.
- Descarga privada del Excel via endpoint autenticado; errores/MIME incorrecto
  se presentan en pantalla. Blob temporal, attachment y URL revocada al descargar.
- Estados de carga, vacio, error y confirmacion; acciones deshabilitadas durante
  operaciones, respuestas tardias de listados ignoradas al cambiar filtro/tenant.

## Funciones existentes conservadas tras revisar su uso

Registrar vale, estaciones, revision/aprobacion, fondos y conciliacion de vales
continuan disponibles. La revision existente queda en un bloque desplegable de
la misma pantalla, sin duplicar su implementacion. Las importaciones historicas
HALEL v1/C2B, sus archivos y conciliacion conservan sus rutas y servicios.
Su acceso se rotula `Importaciones historicas / conciliacion`; nueva importacion
historica abre por defecto HALEL v1. El diagnostico v2 de solo lectura permanece
como opcion de diagnostico, con indicacion de usar la pantalla principal para
confirmar CB2. No se migra ni convierte evidencia historica automaticamente.

## Endpoints reutilizados

Prefijo `/api/empresas/[slug]/flota/combustible/cb2`:

| Endpoint | Interfaz |
| --- | --- |
| POST /preview | Analizar y renovar recibo con seleccion final |
| POST /confirmar | Confirmacion parcial |
| POST /reanudar | Reanudacion Admin |
| POST /asociar | Asociacion documental de lote |
| GET /consumos | Listado filtrado y paginado |
| GET /facturas | Consulta/seleccion de documentos |
| GET /importaciones | Historial y revisiones del lote |
| GET /importaciones/[id]/filas | Evidencia y trazabilidad completas |
| GET /importaciones/[id]/archivo | Descarga privada |

Tambien se reutiliza GET combustible/catalogos para proveedores/unidades: ya
existia y no se modifica. No hay endpoints nuevos. Ampliaciones de lectura CB2:
preview agrega snapshots legibles (sin tocar recibo/validaciones); GET admite
proveedorId, estado, desde/hasta y buscar. Parametros validados, SQL parametrizado,
ambito de empresa siempre servidor, busqueda literal con LOCATE/UPPER (no wildcard).
Los filtros aplicables no cambian el contrato de escrituras ni las tablas.

## Permisos y reintentos

La pagina sigue usando requireTenantFlotaCombustible(ver); recibe actor/Admin y
capacidades resueltas en servidor. Escrituras requieren conciliar y reanudacion
Admin. Cada endpoint conserva su guard y validaciones transaccionales originales.
No se considera el ocultamiento de controles una autorizacion.

OperacionCB2 impide envios simultaneos. Por intento guarda clave aleatoria,
fingerprint de decisiones y snapshot de peticion; tras red/500/503 o respuesta
incompleta NO genera otra clave ni permite cambiar la solicitud pendiente.
Un 200 sin eventos/identidad de importacion certificable tampoco es exito.
Rechazo definitivo permite corregir explicitamente; conflicto de revision exige
recargar datos y preparar una solicitud nueva, no alterar un reintento incierto.

sessionStorage esta separado por usuario y slug de empresa. Guarda SOLO la
referencia de idempotencia y decisiones necesarias para reconstruir el intento;
no guarda Excel, celdas originales, recibos, credenciales ni tokens de sesion.
Tras recargar, asociar/reanudar se recuperan con MISMO cuerpo y revision original,
aunque el estado actual haya avanzado por un commit cuya respuesta se perdio.
Confirmar necesita volver a seleccionar el mismo Excel y reproducir las decisiones
conservadas (visibles en el panel); se renueva recibo sin cambiar la clave.
Al obtener exito se elimina el pendiente. Si sessionStorage no esta disponible,
solo existe recuperacion en memoria: mantener la pestana abierta hasta resolver.
Cerrar la pestana borra sessionStorage; una perdida total requiere diagnostico
por historial antes de iniciar otra accion. Nunca se reintenta automaticamente
una escritura con clave nueva ni se asume que un error implica rollback.

## Pruebas y evidencia

- Suite dirigida de unidad/regresion: **201 pruebas PASS**, incluido DOM funcional.
- **9 pruebas con componentes montados en Happy DOM/React**: importacion parcial,
  seleccion de unidad, respuesta perdida/reintento identico, consulta/asociacion
  con ceros y revisiones, reanudacion Admin y enlace privado, solo lectura,
  conciliar sin Admin, filtros, paginacion/seleccion y recarga tras COMMIT incierto.
- Pruebas de controlador: doble envio, misma clave, tenant/usuario aislados,
  diario completo con multiples paginas, respuesta 200 incompleta y descarga fallida.
- Pruebas de ubicacion/compatibilidad: unica opcion entre Planes/Viaticos, mismos
  enlaces de vales/estaciones/historicos; regresion HALEL v1/v2, OOXML, C2C y permisos.
- **20 casos MariaDB 11.8.9 reales aislados PASS**, incluidos filtros/cursor,
  preservacion de ceros y tenant; las 15 incidencias canonicas siguen en cero tras
  cada caso. Instancia portable propia con TCP apagado y named pipe UUID;
  cierre SHUTDOWN=0. No se uso Hostinger, respaldos ni credenciales productivas.
- TypeScript sin emision, ESLint dirigido y git diff --check PASS.

Happy DOM 21.0.4 es dependencia SOLO de desarrollo para probar formularios/clics.
No se agrega framework visual ni dependencia de produccion. No hay Actions.
Evidencia compacta y hashes de fuentes: [evidence/combustibles-pr509-interfaz/](evidence/combustibles-pr509-interfaz/).

Desde checkout con Node 20+ y npm ci, pruebas de interfaz:

```powershell
npx vitest run src/components/flota/cb2 --maxWorkers=1
npx vitest run src/lib/flota/cb2/http.test.ts src/components/flota/combustible-preview-v2.test.ts src/lib/flota/combustible-ux-captura.test.ts src/components/app-shell-operaciones.test.ts
npx tsc --noEmit --incremental false
npx eslint src/components/flota/cb2 src/components/flota/combustibles-client.tsx 'src/app/e/[slug]/combustibles/page.tsx' src/lib/flota/cb2/http.ts src/lib/flota/cb2/service.ts
```

Laboratorio de motor opt-in, preparacion portable del PR #508 sin endpoints
externos: `node scripts/ci/combustibles-pr508-backend/run-windows.mjs --run-isolated`.
Se aplica DDL exclusivamente a bases sinteticas UUID creadas por la suite; no es
una migracion ni debe apuntarse a una base compartida o productiva.

## Verificacion manual pendiente en entorno de pruebas autorizado

1. Entrar por Operaciones → Combustibles; comprobar orden de menu y tema existente.
2. Importar fixture HALEL/SHELL con filas seguras/bloqueadas; elegir unidades y
   confirmar parcial. Revisar pendientes y originales en Historial.
3. Como Admin reanudar; como conciliar no Admin comprobar ausencia de ese control.
4. Filtrar/paginar consumos, seleccionar lote, elegir factura con numero `000001`,
   asociar y comprobar estado documental/historial. Probar otra moneda/proveedor:
   debe rechazarse, nunca reasignar.
5. Descargar Excel original privado. Revocar acceso/sesion y verificar error.
6. Simular respuesta perdida en servidor de pruebas: reintentar y recargar para
   verificar misma clave/revision y ausencia de efectos duplicados.
7. Abrir vales, estaciones e importaciones historicas y verificar continuidad.

Limites: las pruebas DOM usan respuestas simuladas (no navegador real ni render
visual de Hostinger); el laboratorio verifica motor/contratos por separado. No se
certifica una ejecucion browser→HTTP→MariaDB de despliegue, ni volumen maximo,
moviles reales, latencia de red o comportamiento del CDN. No se ejecuto build con
servicios/entornos productivos. El PR queda Draft para auditoria independiente,
sin merge, sin SQL ni operaciones de datos en produccion y sin cambios de esquema.
