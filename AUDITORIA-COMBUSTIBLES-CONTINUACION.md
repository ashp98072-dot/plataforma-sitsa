# Combustibles: continuación de auditoría (parcial)

Base comprobada el 26 de noviembre de 2026: `ab2dacae57849a5c6d33a415cc7563483a4656fb`, coincidente con `main` del repositorio oficial en GitHub. El `origin` de esta copia apunta a un repositorio local y no debe utilizarse para publicar. La auditoría preliminar se conserva sin cambios.

## Evidencia revisada

- `src/lib/flota/cb2/http.ts`: las consultas usan permiso `ver`; las acciones de escritura requieren `conciliar` y validación de origen; reanudar y corregir también requieren rol Admin y la autorización se verifica de nuevo antes de aplicar.
- `src/lib/flota/cb2/http.ts` detecta el perfil HALEL/SHELL desde el archivo y rechaza discrepancias con el perfil suministrado; conserva límites de carga y validación de selección.
- `src/components/flota/cb2/historial.tsx`: el historial de importaciones comprende trazabilidad y recuperación, y no debe reemplazarse por el historial cronológico de consumos.
- `src/lib/flota/cb2/consumos-lectura.ts`: las consultas se restringen por empresa y usan cursor por ID, no por fecha. Ordenar solo la página en el navegador produciría un historial cronológico incorrecto entre páginas.
- `src/lib/flota/cb2/conciliacion-documental.ts`: agrega los consumos por factura y moneda, con importes DECIMAL y uniones por empresa/proveedor/factura. Su resultado es documental, no prueba de pago.
- `src/lib/flota/cb2/pilotos-reporte.ts`: suma únicamente consumos y separa los totales por moneda y producto; el reporte actual no incluye totales por piloto. Un nombre reportado no prueba identidad y no se deben fusionar homónimos.
- `src/components/flota/cb2/consumos.tsx`: permite asociar documentos a consumos para usuarios autorizados; `terceros.tsx` y `duplicados.tsx` contienen operaciones administrativas, además de consultas.
- El circuito histórico de vales y estaciones sigue accesible desde `src/components/flota/combustibles-client.tsx` y es independiente de las vistas CB2.

## Cambio en curso

La navegación CB2 se agrupa en Consumos, Importaciones, Facturas y conciliación, y Reportes. Se mantienen montados los componentes y sus permisos, incluida la recuperación de importaciones. Esta agrupación todavía no completa el alcance: faltan el historial cronológico de consumos con paginación coherente, los totales por piloto y período y la validación visual y funcional completa. No se considera esta auditoría final.

## Riesgos y pendientes

Verificar rutas y dependencias restantes, aislamiento de empresa con pruebas representativas, importaciones HALEL y SHELL, precisión de galones e importes, filtros y exportación. Evitar agrupar nombres homónimos como si fueran la misma persona, sumar monedas o presentar como pago un monto de consumo. No se ejecutaron migraciones ni consultas de producción.

## Ampliación del reporte por piloto en curso

La consulta agrega un desglose mensual por nombre original, identificadores vinculados y moneda, usando la misma cláusula y parámetros de filtros que el detalle, dentro de la misma transacción de lectura. Los importes se identifican expresamente como consumos, no pagos. La agrupación por nombre sin vínculo puede reunir homónimos; además, un mismo piloto vinculado puede figurar en varias filas si tiene nombres originales diferentes. El CSV conserva el detalle existente. Pendiente: contrastar las sumas y la exportación con datos representativos en una base de pruebas, revisar el volumen de la agrupación y completar los filtros y la presentación.

La columna `fecha_consumo` es `DATE NOT NULL` (migración PR2); el sistema no registra hora de consumo en ese campo. `creado_en` es hora de registro, no hora de abastecimiento. El código de corrección observado cambia asignaciones, no fecha de consumo. Una marca máxima de ID por sí sola no constituye una instantánea perfecta: una transacción que haya reservado un ID menor puede confirmar después del corte, y las asignaciones pueden corregirse entre páginas. Por tanto, sigue pendiente diseñar y probar la consistencia solicitada bajo concurrencia antes de presentar el historial como terminado.

## Implementación de historial cronológico y límites del cursor

Se agregó `historial-consumos` como consulta separada, sin modificar el historial de importaciones ni su recuperación. El servidor exige permiso de lectura y toma la empresa de la sesión. Ordena por `fecha_consumo DESC, id DESC`; la fecha es DATE y no se inventa una hora. El cursor contiene la fecha y el ID de la última fila y un máximo de ID observado al iniciar; las nuevas inserciones con ID mayor no aparecen hasta reiniciar la consulta. El cursor evita solapamientos por empates de fecha en datos cuyo orden no cambia. No es una instantánea persistente: una transacción que confirma tarde un ID ya reservado puede aparecer u omitirse según su posición respecto al cursor; correcciones entre solicitudes pueden cambiar filtros y valores. Reiniciar la consulta muestra el estado actualizado. Una instantánea estricta necesita otra arquitectura y no se introduce una migración.

La prueba `historial-consumos.test.ts` verifica parámetros, ámbito de empresa, corte, desempate y avance de cursor sobre resultados simulados; `http.test.ts` verifica permiso y empresa del servidor. Estas pruebas no sustituyen pruebas de concurrencia con MariaDB. La revisión visual con navegador y capturas no se ha podido realizar en este entorno de ejecución: no hay herramienta de sesión `node_repl` requerida por la habilidad de control de Windows ni datos de prueba de aplicación configurados. Deben revisarse las cuatro secciones en escritorio y móvil antes de integrar.

El reporte por piloto utiliza agregados SQL DECIMAL separados por moneda, mes, nombre e identificadores. La clave primaria de `flota_cb2_consumo_piloto_reportado` impide más de un vínculo por empresa, proveedor y consumo. La coincidencia numérica de totales y CSV con datos reales todavía requiere pruebas de integración en una base aislada; las pruebas actuales comprueban SQL, filtros y escape de CSV mediante simulaciones, sin SQL productivo. Las agrupaciones por nombre son provisionales y no identifican homónimos. La exportación repite la consulta con los mismos filtros pero se ejecuta en otra solicitud y puede variar si cambian datos entre consultas.
