# Compras / Repuestos — Fase 2

Base: `dded5ef1398f7808d3bb5c9921d48923886aa22d`. Sin cambios SQL ni ejecución de migraciones. Usa las tablas de Fase 1 ya desplegadas.

## Contrato y permisos

`compras_requerimientos` tiene ver/crear/editar/eliminar y es independiente de `compras_proveedores`. No recibe defaults activos para roles no Admin. El guard requiere además capacidad TMS de la empresa. La landing acepta cualquiera de los dos permisos; proveedores sigue protegido exclusivamente por su permiso.

API (todas las respuestas llevan `Cache-Control: private, no-store`):

- GET/POST `/api/empresas/[slug]/compras/requerimientos`.
- GET/PATCH `/api/empresas/[slug]/compras/requerimientos/[id]`.
- GET `/api/empresas/[slug]/compras/catalogos`, protegido por requerimientos:ver.

Listado: filtros `codigo`, `desde`, `hasta`, `estado`, `proveedor_id`. Crear/editar reciben cabecera editable y listado completo de líneas; PATCH exige `version`. Zod estricto rechaza tenant, estado, código, total de cabecera, snapshots y solicitante. Importes positivos, hasta dos decimales y límite DECIMAL(12,2); suma en centavos enteros, validando también límite de cabecera.

## Identidad y snapshots

Entidades contables activas y vehículos activos propios del tenant. No se usa `listarVehiculosAccesibles`, que incluye unidades compartidas incompatibles con la FK compuesta de Compras. No se usa el resolver de entidades de Fondos/Gastos, restringido a códigos KT/MONACO: aquí se consultan las entidades activas reales del tenant sin hardcodear códigos/nombres.

Requirente y solicitante usan `resolverUsuarioDeEmpresaTx`: usuario global activo con vínculo `usuario_empresa` o `acceso_todas_empresas`, nombre real disponible. Solicitante y creado_por proceden exclusivamente de sesión al crear y no cambian al editar. No se permite seleccionar otro solicitante.

Proveedor se resuelve en servidor, mismo tenant. Snapshots de nombre, razón social, NIT, banco, cuenta y días de crédito. Nuevas líneas/cambios de proveedor requieren proveedor activo; una línea existente con proveedor inactivo y mismo ID conserva su snapshot y sigue editable. Igual preservación de unidad histórica inactiva si no cambia el vehículo. La descripción de vehículo combina placa/descripción (o marca/modelo), limitada a los 200 caracteres del campo existente; sin vehículo permite descripción manual nullable.

Métodos de pago replican las opciones operativas actuales de Gastos, incluyendo Transferencia móvil, sin importar su modelo completo ni modificarlo. Condición Contado/Crédito independiente de los días de crédito del proveedor.

## Concurrencia, código y auditoría

Código `RC-año-ID` usa AUTO_INCREMENT, siguiendo la convención de Fondos. Es único por tenant, seguro ante concurrencia, no usa MAX+1. El ID es global: no promete una secuencia anual/por empresa sin huecos. Un código temporal UUID de 40 caracteres se reemplaza dentro de la misma transacción antes del commit.

PATCH bloquea cabecera con FOR UPDATE, valida Pendiente y versión, bloquea líneas, valida cada ID contra empresa+requerimiento, y valida referencias antes de escrituras. UPDATE condicionado a versión/estado e incremento de versión; conflicto 409 exige actualizar sin recalcular silenciosamente.

Líneas existentes: UPDATE con mismo ID. Nuevas: INSERT. Removidas: DELETE individual con permiso eliminar, solo tras verificar ausencia de **cualquier** fila de documentos (sin filtrar retirados). Esta única consulta preventiva a `compras_linea_documentos` no implementa adjuntos. No existe DELETE de requerimientos.

Mutaciones y `registrarAuditoriaTx` comparten conexión/transacción. Auditoría incluye ID/código, cantidad, total anterior/nuevo, IDs agregados/editados/eliminados y usuario, sin replicar cuentas/contactos. Cualquier fallo, incluida auditoría, hace rollback.

## UI y límites de fase

Listado con filtros y acciones por permiso. Formulario nuevo y detalle con edición explícita `?editar=1`. Cabecera, múltiples tarjetas de líneas responsive, IDs locales estables, ayuda de proveedor no vacía, total inmediato presentacional. Guardado calcula nuevamente el total en servidor. Autorizada/Rechazada solo lectura; 409 permite recargar explícitamente descartando cambios locales.

Sin adjuntos, PDF/Excel, autorizaciones/rechazos, pagos, firmas, notificaciones ni integración con Fondos/Gastos. RRHH y SQL de Fase 1 permanecen intactos.

Pruebas dirigidas: contrato estricto, importes/fechas, aislamiento/referencias tenant, permisos independientes, transacciones/rollback, snapshots, código, IDs estables, protección de documentos, versión/409 y render/contratos UI. Son pruebas con base de datos simulada; no ejecutan SQL en producción.
