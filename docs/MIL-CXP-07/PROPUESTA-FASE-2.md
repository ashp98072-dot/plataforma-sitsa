# Propuesta mínima — no implementada

## Causa y superficie de exposición

`http.ts:listarProveedoresHttp` prueba Facturas y, sólo si falla, Fiscal. Si Facturas autoriza, no evalúa el permiso fiscal para la proyección. `proveedor-fiscal.ts:listarProveedoresCxp` selecciona y mapea todos los campos fiscales sin recibir una capacidad de visibilidad. La combinación permite leer el maestro fiscal por una ruta alternativa a la que correctamente deniega 403.

La UI no constituye una barrera: `cxp-client.tsx` permite la pestaña Proveedores con `puedeVer` o `puedeVerFiscal`, y sus columnas régimen/ISR/estado consumen `p.fiscal` sin condicionar el renderizado al permiso fiscal. El catálogo de cuentas y el botón de edición sí tienen controles distintos. En esta fase la observación de UI es estática, sin prueba de navegador.

Estado de cuenta (`http-estado-cuenta.ts` y `estado-cuenta.ts`) ya separa acceso base y `verFiscal`. Ese patrón apoya un cambio de proyección, sin retirar el acceso comercial del usuario que registra facturas.

## Compatibilidad que impide una corrección de una sola línea

No basta con reemplazar siempre `fiscal` por null al faltar permiso fiscal. Dos consumidores en `cxp-client.tsx` filtran proveedores elegibles mediante `p.fiscal?.activo`:

- Registro de facturas: selector de proveedores configurados.
- Registro de pagos: selector equivalente.

Ocultar el objeto sin adaptar esos consumidores puede dejar vacíos los selectores para un operador legítimo de facturas/pagos que carece de permiso fiscal. No se debe resolver concediendo permiso fiscal a ese operador.

Otros consumidores del listado: pestaña Proveedores, `cxp-estado-cuenta.tsx`, `cxp-antiguedad.tsx`. Se deben revisar tipos, proveedores sin configuración y estados de carga antes de implementar. Los permisos para sólo pagos y la decisión de acceso al catálogo compartido deben conservar su contrato actual; no ampliarlos implícitamente en este ticket.

## Cambio propuesto

1. Mantener la autorización del listado como Facturas **o** Fiscal, después de tenant/módulo. Evaluar explícitamente la capacidad fiscal en el servidor también cuando Facturas autoriza. Admin conserva su excepción vigente.
2. Introducir una proyección explícita de lectura en el servicio: sin capacidad fiscal, no seleccionar ni enviar régimen, sujeción o IDs de cuentas. El valor por defecto de la nueva opción debe ser restrictivo y los callers internos que necesiten configuración completa deben indicarlo expresamente. No permitir que un parámetro cliente active `verFiscal`.
3. Conservar `fiscal` completo para Fiscal/Admin; sin permiso devolver `fiscal:null` y añadir una señal operativa limitada, por ejemplo `configuracionFiscalActiva`, para mantener elegibilidad del selector. **La divulgación de existencia/estado de configuración debe ratificarse como parte del contrato**, porque es una señal adicional; no codificar automáticamente una decisión de negocio pendiente.
4. La señal no contiene régimen, ISR ni cuentas. Si se requiere distinguir ausencia de configuración de falta de visibilidad, definir un discriminante de respuesta (`fiscalVisible`) sin reutilizar null como «sin configurar». Usar nombre y semántica aprobados antes de implementar; los nombres anteriores son propuestas.
5. Adaptar los dos selectores al indicador operativo y condicionar las columnas de maestro fiscal al permiso/capacidad. No mostrar «Sin configurar» cuando en realidad los campos están ocultos por autorización. Mantener formas/lecturas fiscales completas para quien sí está autorizado.
6. Mantener sin cambios PUT fiscal, cálculo ISR de facturas, snapshots, pagos, política contable, acceso central a libros y H-02. No introducir permisos nuevos ni migraciones para resolver esta proyección.

Una alternativa es limitar sólo la respuesta HTTP y conservar la consulta completa internamente. Tiene menor alcance inicial, pero sigue consultando información restringida y facilita regresiones de proyección. Se recomienda la opción de proyección explícita en servicio con defaults restrictivos, revisando todos sus consumidores.

## Aceptación de Fase 2

- Convertir la prueba de contrato `it.fails` a una prueba positiva normal sólo al implementar la corrección autorizada. Mantener la caracterización original como evidencia histórica, no exigir que siga filtrando datos.
- Matriz de cinco perfiles sobre listado/config/cuentas: sólo Facturas conserva HTTP 200 y catálogo comercial, sin régimen/ISR/cuentas fiscales; Fiscal/Admin conservan la configuración autorizada; ninguno permanece denegado.
- Validar la matriz real de permisos, incluidas concesiones efectivas legadas y V2; no confundir bits persistidos con permiso efectivo.
- Registrar una factura y seleccionar proveedor para pago en pruebas aisladas sin conceder permiso fiscal adicional; no convertir la ausencia de datos restringidos en selector vacío o estado falso «sin configurar».
- Payload y consulta sin campos sensibles no autorizados; no sólo ocultación visual. Evaluar si la señal operativa mínima requiere autorización funcional adicional.
- Regresión del acceso tenant/módulo y las entidades, y del reporte de estado de cuenta que ya protege régimen/ISR. La observación de entidad ajena/inexistente debe quedar corregida en un ticket específico o documentada con decisión explícita; no ensanchar H-01 silenciosamente.
- Ejecutar TypeScript, lint focalizado, suite CxP offline y, en una fase autorizada separada si se exige, prueba de servidor/sesiones y motor aislados. No conectar automáticamente producción ni iniciar servicios.

## Riesgos y recomendación

La exposición requiere sesión, acceso a empresa, módulo y permiso efectivo de Facturas; no es una ruta pública ni una fuga entre empresas demostrada. Aun así contradice el permiso explícito de ver maestro fiscal y puede exponer clasificación tributaria y referencias de cuentas a operadores que no deben consultar ese maestro.

Prioridad recomendada: alta dentro de CxP, antes de autorización operativa. **Autorizar diseño definitivo de la señal operativa y corrección de proyección en Fase 2**, con revisión independiente previa. Esta entrega no aplica el cambio, no concede permisos y no afirma impacto real en usuarios/datos empresariales.
