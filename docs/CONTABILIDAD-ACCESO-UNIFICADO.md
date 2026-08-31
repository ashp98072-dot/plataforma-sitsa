# Libros separados, permisos centralizados

Decisión confirmada: KT y Mónaco mantienen dos libros dentro de la empresa
operativa KT/Mónaco. El tenant procede del slug validado, no de datos enviados
por el usuario. No se fusionan, crean ni reasignan cuentas o partidas.

La autorización de ver y escribir procede de Administración → Usuarios,
mediante requireTenantModulo en cada endpoint. Se conserva el contrato existente
de escritura crear O editar y la validación de acceso a la empresa.
Contabilidad ya no requiere una segunda asignación por libro.
Esto implica que el permiso central de Contabilidad cubre todos los libros activos
de las empresas a las que el usuario tiene acceso, incluido KT y Mónaco.

La configuración solo crea/desactiva libros y sigue reservada a Admin.
La antigua acción acceso se rechaza. cont_entidad_usuarios permanece intacta
como tabla legada, pero no concede ni restringe acceso. Sin migración ni borrado.

Si existe un único libro activo se selecciona automáticamente. Con dos o más,
se exige elección explícita; no se deduce de nombres ni del primer resultado.
El cambio de empresa/libro desmonta la captura y consulta anteriores.
Si solo se ha creado KT, Admin aún debe crear Mónaco: no se genera automáticamente.

Pruebas: guard central real de API (lectura, escritura denegada y revocación),
aislamiento empresa/libro, selección inequívoca, rechazo de asignaciones legadas,
regresión de captura/detalle y limpieza. Sin pruebas contra producción.
Períodos y reversos siguen pendientes; esta entrega ajusta el acceso antes de
continuar ese diseño.
