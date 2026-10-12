# RRHH: primera fase de rendimiento

Base: main `7ab5d3548c8776643352d2ddc3dd456734f3569b`. No migraciones, índices ni cambios de reglas de saldo, FIFO, antigüedad, nómina o permisos. Los conteos siguientes son estáticos, no tiempos medidos en producción; excluyen autorización e inicialización del esquema.

| Camino | Antes | Después |
|---|---|---|
| Dashboard normal | 6 estadísticas +24 gerenciales +3 situación =33 SELECT | 6+4+3 =13 SELECT |
| Portal boletas | 1+P SELECT; todas las líneas de cada período | 1 SELECT de períodos +1 batch de líneas del empleado; P=0 sólo1 |
| Detalle boleta | 2 SELECT; todas las líneas | 2 SELECT; sólo línea del empleado |
| Staff vacaciones resumen | 3 sync y3 lecturas de períodos +3 de historial | 1 sync y1 lectura de períodos +3 de historial |
| Portal vacaciones API | 2 sync +3 lecturas | 1 sync +2 lecturas |
| Portal vacaciones render | 3 sync +7 lecturas | 1 sync +6 lecturas |
| Catálogo supervisores | montaje +cambios de filtros +refresh de edición | montaje/empresa +refresh de edición |

Una sync normal completa mantiene sus cinco SELECT y posibles INSERT/UPDATE dentro de su propia transacción. Así, staff resumen pasa de20 a9 SELECT, portal API de13 a7 y render de22 a11 en ese camino. No se cambia la transacción ni se elimina una sincronización necesaria. Salidas tempranas y modo histórico generan otros conteos. Si el navegador pide resumen y listado por separado, ambos requests siguen sincronizando una vez cada uno: no hay caché entre requests.

## Vacaciones

`crearLecturaVacacionesEmpleado` se crea dentro del GET/render con empresa y empleado autorizados. Comparte una Promise de sincronización y la lectura de períodos entre saldo y desglose. Historial lee después de esa misma sincronización y usa sus advertencias. Nunca se guarda globalmente ni comparte conexiones/transacciones. Los helpers públicos anteriores siguen sincronizando individualmente para los consumidores no migrados. Historial mantiene su fallback aditivo ante errores.

Las regresiones usan el motor existente y una BD en memoria transaccional: comparación exacta de DTO y estado final frente a los tres helpers previos, múltiples períodos, inexistente, sin fecha de alta, FIFO consumido, modo histórico, empresa ajena, separación de requests, error/rollback y GET staff/portal. La sincronización masiva no se modifica.

## Boletas

Se conserva `listarPeriodos` y su LIMIT100 **antes** del filtro Cerrada/Pagada. El batch vincula empresa, empleado de sesión y cada período mediante placeholders. Mantiene el mapper y COALESCE de sueldo vigente. La respuesta conserva orden, campos y filtro de visibilidad.

El esquema definido en `planillas.ts` incluye `uq_plan_linea(periodo_id,id_empleado)`: no debería haber duplicados. Para esquemas legados, se conserva la primera línea del orden retornado, como find(), y hay una regresión específica. Si dos duplicados tienen nombre idéntico, el SQL anterior tampoco definía un desempate estable; no se inventa un nuevo criterio. No se crean ni reparan constraints. Los dos CREATE TABLE de inicialización existentes en proceso frío permanecen sin cambios y no forman parte del conteo SELECT.

## Dashboard

Sólo se consolida el bloque gerencial en cuatro GROUP BY mes: altas, bajas, nómina y bitácora. Los meses vacíos se completan en JS. Se conservan empresa, estados, fórmula de costo, clasificación de bitácora, orden de meses y valores cero/null de los indicadores. Ante fallo de una consulta agregada, ese indicador queda no disponible para los meses del rango.

**Main incluye el mes actual completo**, confirmado por código y tests. Se conserva por indicación explícita del usuario; limitarlo a hoy sería otra PR funcional. Se corrigió el comentario que describía el comportamiento como parcial. La zona de Guatemala y los límites de meses siguen calculándose con el mismo código. Las columnas de fecha del esquema son DATE. No se tocan estadísticas diarias ni situación.

## Supervisores

Se separan los efectos de lista y catálogo. El catálogo depende sólo de su callback con slug; las recargas explícitas tras guardar se mantienen. Prueba estructural con AST verifica dependencias y separación de efectos. El endpoint aún incluye metadata de fotos/documentos: una respuesta reducida podría abordarse después, fuera de esta fase.

## Alertas masivas: propuesta para otra PR

Sin cambios en `sincronizarVacacionesEmpleadosActivos`, sus locks, Map diario o loop serial.

- `VacacionesAlertasPanel` llama alertas, recordatorios y bitácora al montar y cada150 segundos: tres requests por ciclo, de los que uno llama la sincronización masiva.
- `NotificacionesBell`, montado en app-shell, carga notificaciones diferido y cada150 segundos: un request adicional; con permiso vacaciones.ver también llama esa sincronización.
- Dos llamadas al sincronizador por ciclo de ambos componentes, con tiempos de montaje distintos; dentro del mismo proceso/empresa/día comparten Promise. No equivalen a dos recorridos completos. Otro proceso, reinicio o nuevo día vuelve a recorrer.
- Producción reporta105 elegibles. Modo normal completo frío: 3+5×105 =528 SELECT en alertas, más105 transacciones y W escrituras; caliente sólo dos SELECT finales. No son tiempos medidos, ni garantía de que todos sigan el camino completo.

La siguiente PR debería primero medir frío/caliente sin provocar GET mutadores en producción; diseñar lecturas batch de base/consumos y sincronización explícita con invalidación por registro, aprobación, eliminación, fecha de alta y política. Conservar FIFO, verificación histórica, aniversario, vencimiento, topes y aislamiento. No paralelizar105 transacciones ni añadir cron/caché persistente sin ese diseño.

## Validación

Tests RRHH, regresiones nuevas, TypeScript, ESLint de archivos cambiados, build y diff-check se ejecutan localmente. El build usa variables de BD vacías y destino local, sin credenciales de producción. Una ejecución ampliada encontró14 fallos de TMS; se reprodujeron los mismos14 sobre la copia original de main, y TMS no se modificó. No se afirma mejora en milisegundos hasta medir un despliegue autorizado.
