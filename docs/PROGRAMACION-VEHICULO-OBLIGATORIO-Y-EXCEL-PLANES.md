# Programación — vehículo solicitado obligatorio + exportación Excel de Planes / Viajes

Sin SQL: el vehículo solicitado ya se guarda en el viaje (`tms_planes_viaje.vehiculo_solicitado_perfil_id` + `vehiculo_solicitado_nombre`, fotografía del nombre). Requiere la migración existente `sql/migrate-2026-10-programacion-vehiculo-solicitado.sql` (ya en el repo); sin ella el POST no tiene dónde guardarlo y el PATCH no aplica la regla.

## Parte 1 — Vehículo solicitado obligatorio

### Caminos que crean o modifican viajes (discovery)
| Camino | Qué hace con el vehículo solicitado |
|---|---|
| `POST /tms/planes` (formulario de Programación; Propio y Tercerizado) | **Obligatorio.** 400 `Selecciona el vehículo solicitado por el cliente.` con error de campo; el perfil debe ser de la empresa de la sesión y activo |
| `PATCH /tms/planes` (editar/reprogramar) | **Obligatorio al guardar cambios** donde el campo es editable (Programado, Cargado, En ruta con llegada). Quitarlo (`null`) se rechaza |
| `PATCH` de transición (`estado: Cargado`, `Cancelado`) y `patchTipoViaje` | No son ediciones de datos: **no se bloquean** (cierres y estados intactos). `Cerrado/Cancelado` y «En ruta sin llegada» no lo exigen (el campo está bloqueado) |
| Copiar programación (`programacion/copiar/*`) | **Hereda** el vehículo del viaje origen (leído en el servidor, nunca del cliente) si su perfil sigue activo en la empresa; un origen histórico sin dato produce una copia sin dato (no se inventa) |
| Edición rápida (`tms/planes/edicion-rapida`) | No lo toca (solo piloto, auxiliares, unidad, TC, tarifa y viáticos; esquema estricto). **Brecha conocida:** puede editar un viaje histórico sin vehículo |
| Importación Excel (`programacion-import.ts`) | No lo toca: **crea viajes sin vehículo solicitado**. Requiere decisión de negocio (¿columna en la plantilla?) |
| Alta desde solicitud de cliente (`solicitudes-clientes/[id]/programar`) | Crea un viaje esqueleto (cliente/fecha/hora) sin recursos; al completarlo en Programación (PATCH) se exige el vehículo |

### Validación
- **Frontend** (`plan-form.tsx`): ya no existe «Sin especificar»; selector `required` + `aria-invalid`, mensaje junto al campo (`role="alert"`) y foco; la validación se hace en `onSubmit` antes de enviar (no depende solo del `required` HTML). En edición se exige solo si el campo es editable.
- **Backend** (`planes/route.ts`): estado HTTP **400** (patrón vigente de `/tms/planes`; ningún endpoint de este módulo usa 422 y `ErrorDominioFormulario` no lo admite), con `error` + `errores[{campo:"vehiculoSolicitadoPerfilId"}]`. Perfil inexistente, inactivo o de otra empresa: 400 (`El vehículo solicitado no existe en el catálogo de esta empresa o no está activo.`). Un valor ya guardado que no cambia no se revalida.
- **Históricos** (`NULL`): se pueden consultar y abrir siempre; el formulario avisa y exige elegir uno al guardar. No hay migración automática ni se infiere desde la placa.

## Parte 2 — Exportar Excel de Planes / Viajes
- **Arquitectura:** reutiliza el exportador server-side existente `GET /tms/reportes/viajes/export` (misma autorización `programacion:exportar` sobre `ver`, mismo parseo de filtros y mismos límites de volumen) con `?vista=planes`. **Exporta todos los viajes del filtro**, no la página (nunca recibe `page/pageSize`; la pantalla manda los mismos filtros y la pestaña Pendientes/Activos o Cerrados). El libro de «Reportes» no cambia. Solo lectura. `exceljs` (ya estándar; sin librerías nuevas).
- **UI:** botón «Exportar Excel» en la vista operativa; se descarga con `fetch` para mostrar junto al botón errores como falta de permiso o exceso de volumen.
- **Permisos:** se reutiliza `programacion:exportar` («Exportar reportes»), que ya existe; no se crea permiso nuevo. Quien consulta pero no tiene ese permiso ve el mensaje de 403.
- **Archivo:** `planes-viajes_YYYY-MM-DD.xlsx`, o `planes-viajes_<desde>_al_<hasta>.xlsx` con rango completo. Encabezado en negrita, autofiltro, encabezado congelado, anchos, wrap en nombres/auxiliares/cuadrilla, fechas y horas reales, km/evidencias/montos como números (formato `Q`).
- **Columnas:** Código, Fecha, Cliente, Ruta, Vehículo solicitado (fotografía del viaje; sin dato «—»), Placa / Unidad, Piloto, Piloto extra, Auxiliares, Cuadrilla, Hora salida, Hora llegada, Km salida, Km llegada, Km recorridos, Evidencias, Tarifa usada, Tarifa comercial, Cargos adicionales, Subtotal comercial, Estado del viaje (con «pendiente de cierre»), Estado de liquidación, Estado factura, Número factura, Monto facturado, Estado cobro, Total factura, Cobrado, Saldo.
- **Notas de datos:** `Cuadrilla` no forma parte del modelo `PlanReporte`; se lee con `cuadrillaDePlanes` (solo lectura, por lotes de 500). «Monto facturado» sigue el criterio de la pantalla (facturado o, si no, borrador; el estado factura lo aclara). `Total factura/Cobrado/Saldo` son de la **factura completa** y se repiten en facturas multiviaje (no sumar por fila).
