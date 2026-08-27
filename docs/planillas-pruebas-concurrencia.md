# Pruebas locales de concurrencia de Planillas

Estas pruebas NO usan la configuración de la aplicación ni cargan sus archivos
.env. Solo conectan a 127.0.0.1. No deben apuntarse mediante túneles a producción.

Requisitos: servidor MySQL/MariaDB local con InnoDB y usuario exclusivo de pruebas
con permisos para crear y eliminar bases temporales. La suite crea una base
aleatoria con prefijo sitsa_planilla_test_, usa datos ficticios y la elimina al
terminar. No modifica tablas existentes ni ejecuta migraciones del proyecto.

Configurar en la terminal (no guardar contraseñas en el repositorio):

- PLANILLA_TEST_MYSQL=1
- PLANILLA_TEST_USER: usuario local de pruebas
- PLANILLA_TEST_PASSWORD: contraseña de ese usuario
- PLANILLA_TEST_PORT: opcional; predeterminado 3306

Ejecutar:

    npx vitest run src/lib/rrhh/planilla-concurrencia.integration.test.ts

Sin la habilitación explícita, los diez casos aparecen como omitidos, no
aprobados. Una ejecución interrumpida podría dejar su base temporal; revisar el
nombre exacto antes de eliminarla manualmente.

Cobertura:

1. Q1 y Q2 se excluyen mutuamente mientras una transacción mantiene los locks.
2. El guard detecta Q2 confirmada aun bajo un snapshot anterior en REPEATABLE READ.
3. Dos empresas distintas pueden operar y no acceder al período ajeno.
4. Un error intermedio hace rollback de una escritura real.
5. Los estados Generada/Cerrada/Pagada de Q2 bloquean cambios de Q1.
6. Una Q2 Cancelado/Borrador o de otra empresa/mes no bloquea los cambios.

Límites: el esquema reducido prueba los helpers reales de bloqueo, no toda la
generación o reversión de cuotas. Faltan pruebas integrales con el esquema
completo, carga representativa y navegador. Conviene repetir en MariaDB 11.8
antes de dar por validado el comportamiento del motor de producción.

El bloqueo actual serializa las escrituras de Planillas de una misma empresa
(todos sus períodos), en orden de ID. Es deliberadamente conservador. Evaluar
duración y contención antes de reemplazarlo por bloqueos más finos por mes.
