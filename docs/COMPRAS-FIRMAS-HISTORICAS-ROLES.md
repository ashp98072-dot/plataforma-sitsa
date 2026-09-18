# Copias históricas de firmas en Compras

Base: `0779b2d98802bf08848e474a97e72109c41f1852`. Sin SQL ni backfill.

- Requirente: acción `REQUERIR_COMPRA`, rol funcional `REQUIRIENTE`.
- Encargado: acción `GESTIONAR_COMPRA`, rol funcional `ENCARGADO_COMPRAS`.
- Autorizante: conserva `AUTORIZAR_COMPRA`, su permiso, prohibición de autoautorización y firma obligatoria.

Al crear o cambiar una persona mientras está Pendiente, el servidor resuelve
su identidad y copia su plantilla disponible mediante `leerBytesFirmaGuardada`.
Las copias se registran en `firmas_electronicas` con método `FIRMA_MANUSCRITA`,
origen `GUARDADA`, nombre snapshot y total/código al capturar. Estas dos acciones
son captura de plantilla, **no consentimiento ni autorización realizada por la
persona representada**. El usuario que registra queda en auditoría.

Sin plantilla disponible/PNG válido no se crea firma electrónica ni se bloquea
por esa ausencia. Errores de persistencia sí abortan para no confirmar estados
inconsistentes. Copias físicas creadas se compensan si falla la transacción;
rollback y compensación son best-effort y preservan el error original.

Auditoría registra `capturar_requerir_compra` / `capturar_gestionar_compra`, con
`requerimientoId`, `usuarioId` y `firmaId` (NULL si no hubo copia), en la misma
transacción. La última asociación por rol selecciona la firma histórica exacta,
filtrada nuevamente por empresa/módulo/entidad/acción. Un evento NULL impide
resucitar firmas antiguas, incluso en cambios A → B → A. Las ediciones sin cambio
de persona no crean eventos de captura ni leen Mi firma.

El PDF nunca consulta usuarios/plantillas actuales. Conserva los tres bloques y
el diseño/paginación, rellenando únicamente imágenes históricas disponibles.
Requerimientos anteriores sin asociación auditada conservan líneas manuales;
no se completa retroactivamente RC-2026-000001. Excel no cambia.

QA local usa trazos sintéticos y fixtures, no firmas personales ni escrituras
en producción. El recorrido autenticado con usuarios reales queda para QA del
entorno desplegado; no debe utilizarse para reconstruir requerimientos previos.
