# Combustibles: permisos granulares

Mismo catálogo central `permisos-catalogo.ts`, editor de Usuarios y persistencia `usuario_modulo` (cuatro flags, empresa_id NULL como hasta ahora). No nuevo sistema, grants por rol ni cambios SQL. Gate empresarial TMS y acceso de sesión al tenant permanecen; Admin conserva el bypass general existente, nunca el de acceso a empresa.

## Acciones/persistencia

| Acción del guard/UI | Fila | Flag |
|---|---|---|
| ver | flota_combustible | puedeVer |
| registrar | flota_combustible_registrar | puedeVer |
| editar_pendientes | flota_combustible_editar_pendientes | puedeVer |
| revisar | flota_combustible_revisar | puedeVer |
| conciliar | flota_combustible_conciliar | puedeVer |
| gestionar_estaciones | flota_combustible_gestionar_estaciones | puedeVer |

Todas las acciones requieren Ver de Combustibles. El editor central activa Ver al conceder una acción; desmarcar Ver limpia sus acciones. Los cinco flags especializados son independientes. Las claves caben en VARCHAR(40). No se exponen acciones nuevas como módulos de navegación ni se heredan desde TMS/Flota.

## Mapa servidor

Prefijo: `/api/empresas/[slug]/flota/combustible`.

| Endpoint | Acción necesaria |
|---|---|
| GET raíz (vales) | ver |
| GET catalogos (proveedor/unidad/estaciones activas) | ver |
| POST raíz | registrar |
| PATCH [id] | editar_pendientes |
| POST [id]/revisar | revisar |
| GET [id]/vale (evidencia) | ver |
| GET resumen | ver |
| POST conciliaciones (importa/procesa/persiste) | conciliar |
| GET conciliaciones, conciliaciones/[id], conciliaciones/[id]/archivo | ver |
| GET/POST estaciones, PATCH estaciones/[id] | gestionar_estaciones |

Lecturas históricas de conciliación/evidencia no se restringen artificialmente a operadores: Ver conserva la consulta ya disponible. Conciliar añade procesamiento, no quita lectura. Un registrador consume estaciones activas desde catalogos sin entrar al CRUD ni conocer inactivas/direcciones del mantenimiento. Página estaciones exige gestionar_estaciones; página principal exige ver.

UI: alta solo registrar; edición solo editar_pendientes y PENDIENTE; aprobar/rechazar solo revisar; formulario de conciliación solo conciliar (lectores abren historial); enlace de estaciones solo gestionar_estaciones. Backend repite la validación, no confía en botones. Servicios conservan validación PENDIENTE, tenant, evidencia, auditoría y reglas monetarias.

## Compatibilidad sin SQL

Se reutiliza `nueva()` y `tieneAccionCatalogo()` del catálogo: si todavía **no existe** la fila especializada, equivale al `flota_combustible.puedeEditar` anterior. Tanto matrices legacy como V2 siguen funcionando inmediatamente, incluidos defaults efectivos del rol que ya tenían ese permiso. Ver no concede ninguna mutación. Crear/eliminar antiguos tampoco se convierten en nuevas acciones, porque el servidor anterior solo aceptaba editar.

Al abrir/guardar permisos, `materializarAcciones`/`normalizarMatriz` generan las cinco filas explícitas preservando sus capacidades equivalentes. Una fila presente en cero prevalece siempre sobre editar legacy; quitar revisar no se recupera al releer ni por rol. No se elimina la fila antigua ni se borran flags históricos. La equivalencia sigue disponible para usuarios que aún no fueron editados; no es necesaria migración masiva de grants. A futuro su retirada exige inventariar/materializar primero todas las matrices (fuera de este ticket).

Riesgo operativo: editar legacy sigue habilitando cada acción cuya fila aún no se haya materializado; es compatibilidad intencional, no una concesión nueva. Administradores deben usar las seis capacidades del editor, no modificar solo editar legacy con SQL. Permisos continúan siendo globales del usuario como antes; acceso/acciones/datos se revalidan contra empresa activa en cada petición.

Sin SQL productivo, sin datos reales, sin Fondos/C-2, sin modificaciones al motor de conciliación/Excel ni a estados/cálculos. Validación local separada de CI. QA de combinaciones de roles en navegador pendiente de revisión.
