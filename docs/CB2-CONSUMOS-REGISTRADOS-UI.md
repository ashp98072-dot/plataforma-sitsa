# CB2: presentación de consumos registrados

Base: main `485c8c4d`, posterior a la fusión del PR #516. Rama independiente `feat/cb2-consumos-registrados`.

## Alcance

La tabla histórica pasa a doce columnas: selección, vale, fecha, placa/unidad, proveedor, galones, precio unitario, monto, factura, empleado, combustible y acciones. Reutiliza el contenedor, tabla, filas alternadas, contraste, encabezados y columnas fijas, editor y foco del PR #516. Solo añade ajustes locales para alinear cifras y distribuir las columnas históricas. No cambia la tabla de revisión de importaciones.

`TablaConsumosCB2` recibe los registros y el estado de selección existentes. Los filtros y la paginación de 50 registros siguen usando `useListadoCB2`; la selección múltiple permanece en `ConsumosCB2`. `CorregirCB2` admite ahora un borrador local controlado por la tabla; conserva permisos, confirmación obligatoria, invalidación de aceptación al editar y el contrato del payload. La asociación documental, claves e idempotencia permanecen intactas. No se modifican backend, contratos, parser, cálculos, facturación, permisos ni datos históricos.

## Formatos exclusivamente visuales

`formatos-consumos.ts` usa la dependencia existente Decimal.js sin convertir los DECIMAL de texto a Number y sin cambiar configuración global:

- GTQ: `Q 400.00`, con dos decimales y separador de miles.
- USD: `US$ 400.00`; no se convierte moneda ni se etiqueta un dólar como quetzal.
- Galones: hasta tres decimales, sin ceros finales innecesarios.
- Precio unitario: entre dos y seis decimales, según el valor existente.
- Redondeo HALF_UP únicamente de presentación; no recalcula monto, precio o galones.
- Ausencia: «No informado»; valor no interpretable: «No disponible», sin inventar cero.

Las cifras originales se mantienen en los registros, en el atributo title de las celdas y en el detalle visible por teclado. Por ejemplo, `9.999900` galones se muestran como `10`, y `400.004300` como `Q 400.00`, conservando ambos originales. Si los galones cambian numéricamente por el redondeo visual, aparece «Redondeado · ver original»: un summary nativo con nombre accesible por consumo permite desplegar el valor exacto sin abrir Procedencia ni depender del tooltip. Quitar ceros finales (`10.100000` → `10.1`) no genera un aviso de redondeo. Ningún formato se usa para construir una solicitud de corrección o factura.

Empleado y clasificación se muestran directamente desde los campos existentes. Sin empleado: «Sin vínculo»; ID vinculado sin nombre: se identifica el ID y la ausencia de nombre. Clasificación ausente: «Sin clasificación»; una clasificación explícita NO_DETERMINADO se distingue de esa ausencia. Los códigos desconocidos se muestran como no reconocidos.

## Detalles y trazabilidad

Detalles abre una fila expandible con importación y consumo, documento/factura, componente de trazabilidad existente, valores originales y evidencia completa recibida en el registro. Incluye historial de asignaciones y corrección auditada con los permisos anteriores. Escape cierra y devuelve foco al botón. La tabla conserva borradores de corrección en memoria por API de empresa, proveedor e ID de consumo; cerrar, filtrar o paginar ya no los descarta.

No se amplía el API: las referencias de origen siguen limitadas a 25 por consumo en esta vista. El detalle conserva la indicación de consultar todas las apariciones y el archivo en Historial → Ver trazabilidad. «Evidencia recibida completa» corresponde al registro recibido, no promete que esa respuesta contenga el Excel entero o todas las apariciones. La selección múltiple y los borradores se conservan entre páginas/filtros.

### Borradores locales

Se conservan unidad, empleado (incluido borrado), combustible, motivo y revisión de origen. La aceptación no se guarda y debe marcarse nuevamente tras el desmontaje de la fila. Si al volver cambió la revisión del consumo, se avisa y el borrador mantiene su revisión original para no adoptar silenciosamente la versión nueva: el servidor sigue comprobando revisiones con su lógica existente. «Descartar borrador» permite empezar explícitamente con los datos actuales. Un fallo al guardar conserva el borrador; solo un guardado exitoso o el descarte explícito lo elimina.

No se usa localStorage, sessionStorage ni persistencia remota para estos borradores. Se pierden al recargar o desmontar completamente la pantalla; una nota en el editor comunica ese alcance. Las operaciones inciertas siguen usando la persistencia y recuperación de solicitudes existente, que no se modificó.

## Verificación

- TypeScript: `npx.cmd tsc --noEmit --incremental false`.
- ESLint de todos los TypeScript modificados/nuevos.
- **32 archivos CB2 / 289 pruebas aprobadas**, sin suites `*.db.test.ts`: formatos y redondeo decimal exacto, ceros en factura, vínculo/clasificación ausentes, registro original congelado e intacto, detalle/escape/foco, permisos, filtros, selección entre páginas, payload documental exacto sin cifras redondeadas y corrección/reintento con la misma clave y revisión. Las regresiones adicionales cubren borradores entre páginas/filtros, aislamiento por empresa/proveedor/ID, reconfirmación al regresar, revisión original ante cambios concurrentes, retención tras errores, guardado/descarte explícito y el desplegable nativo con galones originales solo ante redondeo real.
- Pruebas de contraste claro/oscuro heredadas del #516, que leen los mismos tokens usados por esta tabla.
- `git diff --check` y análisis de sintaxis CSS con PostCSS.

TypeScript y ESLint de todos los TypeScript del PR, así como diff check, se repitieron y aprobaron para estas dos mejoras. La suite actual completa aprobó 32 archivos/289 casos sin timeout. En la validación inicial de este PR, una ejecución simultánea con TypeScript/ESLint agotó los 5 segundos de una prueba DOM existente de pilotos; su repetición aprobó los entonces 277 casos sin modificar la prueba ni sus límites. El análisis de sintaxis CSS anterior sigue vigente: estas mejoras no cambian estilos.

## Verificación visual pendiente y restricciones

El inventario de navegadores devolvió `[]`; no se obtuvieron capturas ni se ejecutó una verificación visual en navegador. Quedan pendientes escritorio, laptop, tablet, teléfono, ambos temas, desplazamiento horizontal/vertical, superposiciones de columnas fijas, zoom, Tab/Shift+Tab, foco real de controles hidden y lector de pantalla. Las pruebas DOM y el cálculo de contraste no reemplazan esas verificaciones.

No se ejecutó SQL ni se crearon bases de datos, ambientes de prueba o staging. Sin acceso a producción, migraciones, modificación de consumos, despliegue ni fusión. Se mantiene como PR borrador para auditoría independiente.
