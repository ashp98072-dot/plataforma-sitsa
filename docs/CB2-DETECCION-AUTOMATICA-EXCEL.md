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

Se rechazan encabezados completos sin firma clara, híbridos, columnas duplicadas y filas con al menos cuatro indicios de encabezado que no formen una tabla completa compatible. Los indicios y las etiquetas de identidad se obtienen de los alias existentes del parser, incluidas sus variantes de fecha, factura, vale y placa. La única excepción para resúmenes rotulados se detalla en la revisión de compatibilidad inferior. Las hojas de notas sin tablas reconocibles se conservan como auxiliares según el análisis existente. Se rechaza la mezcla de HALEL/SHELL en hojas distintas o en una sola hoja; no se elige el primer formato ignorando el resto. Las variantes no documentadas se rechazan en lugar de adivinar.

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

Resultados actualizados: **80 archivos / 915 pruebas aprobadas**, excluyendo `*.db.test.ts` y `*-rollout-db.test.ts`; se incluyen flota, componentes de flota y `tenant-combustible.test.ts`, con maxWorkers=2. `npx.cmd tsc --noEmit --incremental false`, ESLint de los TypeScript modificados en esta revisión y `git diff --check`: aprobados. La búsqueda de navegadores anterior devolvió `[]`; no se verificó visualmente la interfaz ni se obtuvieron capturas.

No se ejecutó SQL, no se crearon bases de datos ni ambientes, y no se accedió a producción, desplegó o fusionó. El PR queda como borrador. Pendientes: contraste con los dos Excel reales, variantes adicionales de proveedores, medición con archivos máximos y revisión visual/teclado/lector de pantalla en navegador si no está disponible en la sesión.

## Última revisión de compatibilidad del PR #518

Los archivos reales siguen sin estar disponibles: una nueva búsqueda por nombres HALEL/SHELL en los adjuntos no devolvió Excel. **Esta revisión es representativa de la estructura comunicada en auditoría, no una validación directa de los dos archivos reales.** Las posiciones y valores de las filas son sintéticos; no se atribuyen a los archivos originales.

Se añadió una fixture con las cuatro hojas y todas las combinaciones de los dos alias de fecha/factura que ya reconoce el parser:

| Hoja | Encabezado representativo | Fecha | Factura |
| --- | --- | --- | --- |
| Hoja1 | Fila 4, columna A | FechaFactura | NRO. DE FACTURA |
| LOTE 2048 | Fila 8, columna A | FECHA | NO. FACTURA |
| LOTE 2054 | Fila 37, columna C | FechaFactura | NO. FACTURA |
| LOTE 2058 | Fila 12, columna B | FECHA | NRO. DE FACTURA |

Cada hoja tiene títulos, vacíos, un encabezado repetido, dos consumos sintéticos únicos y cuatro filas auxiliares: TOTAL, SUB TOTAL, LIQUIDACIÓN, y fecha/importe aislados. Los resúmenes incluyen etiquetas FECHA/Galones/Precio/Costo Total con valores numéricos o fórmulas almacenadas.

La prueba primero reprodujo un falso rechazo del detector: el conteo de cuatro palabras conocidas interpretaba esos resúmenes como encabezados incompletos. Se corrigió exclusivamente la clasificación de encabezados. Si no hay un encabezado completo, una fila solo se excluye de ese conteo si su primer contenido comienza con TOTAL, SUB TOTAL/SUBTOTAL o LIQUIDACIÓN, contiene un valor numérico, fecha o fórmula y no incluye ninguna etiqueta de vale/placa de los alias del parser. No se ejecuta ni valida una fórmula auxiliar para clasificar la fila; el parser sigue conservando su evidencia y reglas actuales.

Los encabezados completos se comprueban antes de esa excepción, por lo que un rótulo LIQUIDACIÓN no oculta una tabla SHELL mezclada con HALEL. Los parciales que incluyen etiquetas de identidad siguen rechazándose, un resumen sin valor no recibe la excepción y un archivo con solo resúmenes no obtiene formato reconocido. No se cambiaron las firmas diferenciales de formatos.

Resultado representativo: HALEL detectado, ocho filas operativas y dieciséis auxiliares con estado IGNORADA e identidad nula, comprobadas por hoja y posición. SHELL mantiene sus tres hojas mensuales con FECHA, VALE, No. Serie, No. factura, MONTO, GLS, PRODUCTO, PRECIO, PILOTO y PLACAS. La fixture HALEL de cuatro hojas también recorre el endpoint de preview con detector, parser y recibo firmado reales y conexión simulada, sin escrituras.

El único cambio del archivo del parser es exportar su tabla de alias para reutilizarla: no se altera ninguna regla de consumos, fórmula, cálculo, identidad, huella o datos históricos. Se conserva el PR #518 en su rama existente y como borrador, sin SQL, producción, fusión ni despliegue.

Validación final de esta revisión: 38 pruebas dirigidas de detector/HTTP aprobadas y suite completa de 80 archivos/915 pruebas aprobadas, sin BD real. TypeScript, ESLint y diff check aprobados. Sigue pendiente la comparación directa con los dos Excel originales.
