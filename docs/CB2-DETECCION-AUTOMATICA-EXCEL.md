# CB2: detección automática de HALEL / SHELL

Base: main `8e92fe65`, posterior al PR #517. Rama independiente: `feat/cb2-detectar-formato-excel`.

## Muestras y alcance

No se encontraron `CONSUMOS SHELL(2).xlsx` ni `REPORTE DE COMBUSTIBLE HALEL(2).xlsx` en el repositorio ni en los adjuntos disponibles. Se emplean fixtures sintéticos basados en los encabezados documentados y los fixtures sintéticos existentes de ambos parsers. No se inventan ni usan datos de producción.

El cambio afecta solo las cargas nuevas de CB2 a preview/confirmar y su interfaz. La reanudación de importaciones guardadas sigue utilizando el perfil y versión de parser persistidos. No cambia el esquema, datos históricos, fórmulas permitidas, importes, clasificación, identificación de empleados/unidades, huellas, claves, duplicados, permisos ni asociación de documentos.

## Detección conservadora

`detectarFormatoCB2` inspecciona todos los encabezados de todas las hojas, incluidas las ocultas, dentro de los límites existentes. No usa nombres de archivo ni de hojas para elegir formato; tampoco proveedor comercial, nombres de personas o valores de consumos.

Comparte con el parser v2 la normalización y reconocimiento de columnas existentes, sin cambiar sus reglas: mayúsculas, tildes, espacios y puntuación se normalizan. Se requiere la misma estructura operativa no ambigua de fecha, vale, placa, galones, precio y monto. Además, se exige encabezado de piloto, serie y factura para una identificación concluyente.

| Formato | Firma diferencial adicional |
| --- | --- |
| SHELL | GLS, MONTO y una columna de producto reconocida por el parser |
| HALEL | GALONES, COSTO TOTAL y una columna de kilometraje reconocida por el parser |

FECHA, PILOTO y PLACAS por sí solos no determinan un formato. FechaFactura y FECHA siguen siendo alternativas del parser. Los encabezados pueden aparecer después de títulos, vacíos o lotes, desplazados a otras columnas, reordenados y repetidos. No se limita la búsqueda a A1 ni a las primeras 25 filas.

Se rechazan encabezados completos sin firma clara, híbridos, columnas duplicadas y filas con al menos cuatro indicios de encabezado que no formen una tabla completa compatible. Las hojas de notas sin tablas reconocibles se conservan como auxiliares según el análisis existente. Se rechaza la mezcla de HALEL/SHELL en hojas distintas o en una sola hoja; no se elige el primer formato ignorando el resto. Las variantes no documentadas se rechazan en lugar de adivinar.

## Límites y seguridad

Antes de ExcelJS se ejecutan los validadores actuales de tamaño, contenedor y OOXML: límite de archivo 50 MB, expansión ZIP/XML acotada a 80 MB, máximo 20 hojas, 5.000 filas por hoja, 10.000 totales y 100 columnas, además de las protecciones existentes contra contenedores/relaciones inválidos. El detector no ejecuta fórmulas ni utiliza una fórmula como firma de encabezado.

La detección precede al parser elegido, que conserva sus propias comprobaciones. Esto implica una lectura acotada adicional del libro en cada preview/confirmación; no se promete coste idéntico al flujo anterior. Se privilegia mantener el parser histórico intacto. No se añade un caché que permita eludir la revalidación del archivo.

Autenticación, autorización y origen se verifican antes del procesamiento; el proveedor de empresa y la moneda siguen siendo entradas independientes. El detector nunca asigna un proveedor. La validación vigente del servicio comprueba su pertenencia y disponibilidad.

## Contrato y recibos

En multipart, perfil pasa a ser opcional. Si un cliente anterior lo envía, debe ser HALEL o SHELL y coincidir con el formato detectado: una contradicción se rechaza antes de llamar al servicio de preview/confirmar. El perfil usado por el parser siempre procede de la detección del servidor.

Preview añade `perfilDetectado`. El resto de su respuesta se conserva. Confirmar vuelve a detectar los mismos bytes; el servicio recibe el perfil validado y conserva el recibo firmado, digest e idempotencia existentes. No se incorpora el campo nuevo de respuesta al digest de solicitud. La interfaz conserva el perfil detectado en la identidad de reintento y comprueba tanto hash como formato al solicitar un nuevo recibo antes de confirmar.

Clientes antiguos con un formato reconocible y perfil correcto siguen funcionando. Los archivos genéricos o variantes antiguas sin firma diferencial clara ya no se admiten como cargas nuevas, aunque el cliente envíe un perfil manual: requerirán una muestra/revisión del formato, no un bypass. Las importaciones ya guardadas siguen reanudándose con su evidencia y perfil persistidos. Un reintento de carga antigua no concluyente también queda sujeto a detección; no debe alterarse una solicitud incierta para intentar forzarla.

En una futura publicación, backend compatible primero y frontend después, o ambas versiones de forma atómica. El frontend nuevo rechaza una respuesta sin perfilDetectado y no supone un formato para funcionar contra un backend anterior.

## Interfaz

Se elimina el estado y selector Perfil. Se mantienen Proveedor de la empresa, Moneda declarada, Excel y Analizar Excel. El formato se detecta automáticamente en el análisis existente, una vez seleccionados archivo/proveedor/moneda; no se sube un archivo por seleccionar únicamente un proveedor ni se adivina la empresa comercial del Excel. Se muestra «Formato detectado: HALEL/SHELL» después de un análisis exitoso.

Cambiar archivo, proveedor o moneda invalida la vista previa. Un análisis fallido elimina una vista previa anterior y no ofrece continuar. La UI muestra el error recibido ante mezcla/desconocimiento; no incluye un selector de respaldo para forzar el formato.

## Verificación

Fixtures sintéticos: firmas documentadas, encabezados normalizados/reordenados/repetidos y desplazados hasta fila 37/columna D, hojas de títulos/lotes/notas, varias hojas mensuales, mezclas también en hoja oculta, híbridos/duplicados/incompletos y límites/corrupción OOXML.

Pruebas de detección y despacho comprueban que analizar con el perfil detectado produce las mismas filas que el parser existente explícito, incluidas fórmulas SHELL. Pruebas HTTP usan detección real con servicios simulados para comprobar que nombre/perfil del cliente no fuerzan formato, que se vuelve a detectar al confirmar, que no se cambia proveedor/moneda y que un rechazo no invoca persistencia. El test de origen existente recorre preview real y recibo firmado con conexión simulada.

Pruebas DOM cubren la ausencia del selector, formato visible para ambos perfiles, proveedor independiente, limpieza al cambiar archivo/error, fallo cerrado ante servidor antiguo y ausencia de confirmar si cambia el formato del recibo. Se ejecutan también las regresiones existentes de CB2/flota, sin suites de BD real, TypeScript, ESLint y git diff --check.

Resultados ejecutados: **80 archivos / 911 pruebas aprobadas**, excluyendo `*.db.test.ts` y `*-rollout-db.test.ts`; se incluyen flota, componentes de flota y `tenant-combustible.test.ts`, con maxWorkers=2. `npx.cmd tsc --noEmit --incremental false`, ESLint de todos los TypeScript modificados/nuevos y `git diff --check`: aprobados. La búsqueda de navegadores devolvió `[]`; no se verificó visualmente la interfaz ni se obtuvieron capturas.

No se ejecutó SQL, no se crearon bases de datos ni ambientes, y no se accedió a producción, desplegó o fusionó. El PR queda como borrador. Pendientes: contraste con los dos Excel reales, variantes adicionales de proveedores, medición con archivos máximos y revisión visual/teclado/lector de pantalla en navegador si no está disponible en la sesión.
