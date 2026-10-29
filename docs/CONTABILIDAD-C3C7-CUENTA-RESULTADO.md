# C3C-7: cuenta de resultado por libro

Base main: `0195b562c4107226c667cd00ad302bb85eca9002`.

Pantalla: Contabilidad → Configuración contable. Seleccionar libro, consultar cuenta actual, buscar por código/nombre entre cuentas activas de Capital y guardar. Actualizar configuración después de un conflicto de concurrencia. No hay configuración automática por código, nombre o nivel.

API: `GET` y `PUT /api/empresas/[slug]/contabilidad/configuracion/resultado?entidad=ID`. PUT recibe `{cuentaId, cuentaAnteriorId}`; el valor anterior es obligatorio (null inicialmente). No admite empresa, actor ni roles aportados por el cliente.

## Persistencia y autorización

Reutiliza `cont_cuentas_rol`, rol `RESULTADO_EJERCICIO`, sin tabla paralela. La clave única existente empresa/entidad/rol evita duplicados. Los ocho roles comerciales de `ROLES_CONTABLES`, usados en snapshots de facturación, permanecen intactos; no se modifica su resolver con FOR UPDATE para consultar simulaciones de solo lectura.

Lectura: permiso existente del calendario. Modificación: además, usuario activo con permiso explícito de ver y editar Contabilidad y asignación a la empresa; se conserva la autorización global de Admin. No se crean permisos ni grants por defecto, ni se hereda edición del rol Contabilidad. La interfaz recibe `puedeModificar`; el backend revalida siempre.

Guardado en una transacción: bloqueo estable empresa/libro existente, control de cuenta anterior, validación de cuenta con lock, upsert y `registrarAuditoriaTx`. Registra actor ID y username, empresa, libro y cuenta anterior/nueva. Si falla auditoría, rollback. Dos cambios desde la misma cuenta anterior no se sobrescriben silenciosamente.

## Validaciones y política pendiente

Se exige libro activo para modificar; cuenta existente, activa, en el mismo ámbito y de tipo exacto Capital. Se excluyen Ingreso, Gasto, Activo y Pasivo. La simulación revalida la configuración en su misma instantánea, sin locks de escritura: una cuenta desactivada o reclasificada deja de aparecer como válida.

El modelo actual de registro de asientos solo comprueba ámbito y actividad: no tiene atributo de imputabilidad, cuenta padre o prohibición por nivel. **No se inventa que un nivel o prefijo identifica una cuenta de movimiento.** Se permite configurar Capital a distintos niveles como validación técnica, advirtiendo siempre que la imputabilidad e idoneidad formal requieren aprobación contable. No se afirma que cualquier Capital sea automáticamente cuenta de resultado aprobada.

C3C-6 elimina CUENTA_RESULTADO_NO_CONFIGURADA cuando valida la cuenta. Si se invalida, muestra CUENTA_RESULTADO_INVALIDA. Mantiene POLITICA_REGULARIZACION_PENDIENTE, estado INCOMPLETA y propuestaCompleta=null. No registra asientos ni añade acciones de contabilización.

## SQL y verificación

Propuesta: `sql/migrate-2026-10-cuenta-resultado-c3c7.sql`, un ALTER del CHECK existente para admitir el rol nuevo, conservando datos, FK y unicidad. Idempotencia probada ejecutándolo dos veces en MariaDB 11.8.9 desechable. Requiere infraestructura A existente y su constraint nombrado; revisar el esquema de destino antes de una aplicación autorizada. No crea cuentas, roles asignados ni permisos por defecto. No se ejecutó en producción ni en el laboratorio visual activo.

42 pruebas unitarias/contrato (incluida regresión C3C-6); 12 pruebas MariaDB temporal sobre configuración inicial/cambio, cuentas inválidas o ajenas, lector/editor, auditoría, concurrencia inicial y modificación, integración y ausencia de asientos. Ejecutor nuevo: `node scripts/ci/c3c7/run-windows.mjs --run-isolated --engine=mariadb`. Reutiliza utilidades sin modificarlas; el fixture incorpora solo en la base desechable los campos de permisos y la tabla de roles existentes. Sin dependencias nuevas ni validación visual en navegador de C3C-7.
