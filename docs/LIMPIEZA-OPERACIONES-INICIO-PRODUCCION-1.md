# Limpieza de Operaciones para inicio de producción

Este paquete prepara una sola empresa para iniciar Operaciones desde cero. Es deliberadamente manual: **no ejecuta SQL, no borra archivos y no está conectado a un botón de la aplicación**.

## Orden de ejecución

1. Hacer respaldo de base de datos y del directorio de uploads.
2. Detener temporalmente capturas de Operaciones para la empresa objetivo.
3. Ejecutar `sql/preview-limpieza-operaciones-inicio-produccion.sql` con `empresa_id` y `codigo` exactos.
4. Guardar los conteos maestros y exportar el manifiesto de archivos.
5. Si `viajes_vinculados_a_facturacion` es mayor que cero, detenerse. El script no borra facturas ni pagos.
6. Ejecutar `sql/limpieza-operaciones-inicio-produccion.sql`. Revisar sus conteos dentro de la transacción y ejecutar manualmente `COMMIT` o `ROLLBACK`.
7. Solo después del `COMMIT`, borrar las rutas del manifiesto mediante `borrarArchivosFisicos` de `src/lib/admin/limpiar-archivos.ts`. Ese helper limita la operación a la empresa, valida la raíz real y rechaza symlinks/salidas de directorio.
8. Ejecutar `sql/verificar-limpieza-operaciones-inicio-produccion.sql` y comparar los maestros exactamente con el PREVIEW.

## Clasificación real del esquema

| Clase | Tablas | Tratamiento |
|---|---|---|
| MAESTRO | `tms_clientes`, `tms_cliente_contactos`, `tms_cliente_ubicaciones`, `tms_cliente_usuarios` | Preservar |
| MAESTRO | `tms_cliente_rutas`, `tms_cliente_ruta_paradas`, `tms_cliente_ruta_personal`, `tms_cliente_ruta_tarifas` | Preservar |
| MAESTRO | `empleados`, `usuarios`, `usuario_empresa`, `usuario_modulo`, `usuario_firmas`, RRHH y marcajes | Preservar |
| MAESTRO | `flota_vehiculos`, predios, talleres y configuración de flota | Preservar |
| MAESTRO | `tms_personal`, `tms_unidades`, `tms_lugares`, `tms_viaticos_config` | Preservar |
| TRANSACCIONAL | `tms_planes_viaje`, `tms_evidencias`, `tms_viaticos`, `tms_gastos_operativos`, `tms_solicitudes_fondo`, `tms_solicitudes_cliente`, `tms_cotizaciones` | Eliminar para la empresa |
| DEPENDIENTE | `tms_plan_paradas`, `tms_plan_auxiliares`, `tms_solicitud_fondo_lineas`, `tms_solicitud_paradas` | Eliminar con su padre |
| DEPENDIENTE | viajes/lecturas/evidencias/combustible de flota ligados a los planes objetivo | Eliminar con su plan |
| DEPENDIENTE | `firmas_electronicas` de módulos `VIATICOS` y `FONDOS` ligadas a registros objetivo | Eliminar solo esas firmas |
| DUDOSO | `ops_multas`, `ops_multas_revisiones`, `ops_multa_documentos` | No tocar: el esquema no contiene una relación inequívoca con el viaje |
| DUDOSO | `fact_factura_viajes` y facturación relacionada | No tocar y bloquear toda la operación si existe vínculo |
| DUDOSO | cabecera `flota_combustible_conciliaciones` | Preservar; solo se eliminan filas ligadas a cargas objetivo |
| AUDITORÍA | `auditoria` y demás historial no exclusivamente transaccional | Preservar |

## Alcance y controles

- Se incluyen planes en cualquier estado, incluso abiertos o en progreso.
- Los `DELETE` se ordenan desde dependencias hacia padres y se ejecutan en una transacción.
- La selección exige coincidencia de `empresas.id` y `empresas.codigo`; con valores inválidos no se elimina nada.
- Un vínculo con `fact_factura_viajes` bloquea todos los `DELETE` para evitar una limpieza parcial.
- Los archivos se manifiestan antes, la base se confirma primero y el borrado físico ocurre después.
- No se elimina ninguna multa porque hoy no puede demostrarse por FK que sea exclusivamente de un viaje de prueba.
- No se modifica `src/lib/rrhh/catalogos-nomina.ts`.

**CLIENTES Y RUTAS NO SE TOCAN.** Sus contactos, ubicaciones, paradas predeterminadas, personal habitual y tarifarios también se conservan.
