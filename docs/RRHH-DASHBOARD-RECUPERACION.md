# Recuperación de indicadores del dashboard RRHH

El historial conserva los indicadores: 908dfbd (bitácora), 57d03de (situación
diaria), 0a6ac5b (neto/costo mensual). No se encontraron eliminados del código.
La captura coincide con indicadores sin cargar, no demuestra ausencia de datos.
No se consultó la base de producción ni sus logs para identificar el error SQL.

Fallo encontrado: Promise.all en el API rechazaba toda la respuesta si fallaba
la bandeja diaria. El cliente no manejaba rechazos/JSON inválido ni mostraba
errores HTTP. En ese caso quedaban únicamente las tarjetas de navegación.

Se aíslan las tres secciones, se muestran avisos y se permite reintentar.
Las métricas fallidas no representan cero. Se mantiene el guard y el filtro
de empresa. Se cancela la petición anterior al cambiar empresa o desmontar.
Selector de mes sobre los seis meses existentes; historial desplegado inicialmente.
Se conservan asistencia, altas, bajas, nómina, bitácora y todos los accesos.

Altas usan fecha_alta; bajas usan fecha_egreso y estado Baja. No reconstruye
empleados borrados ni episodios de recontratación. Neto/costo mantiene períodos
Cerrada/Pagada por mes de inicio. El mes actual es parcial.
No se ejecuta SQL, migración, importación ni modificación de datos.

Pruebas simuladas de fallos parciales, guard, empresa, métricas y fechas.
Validación operativa pendiente en el despliegue: revisar avisos del servidor
si alguna consulta sigue fallando; no se inventa una reparación del esquema.
