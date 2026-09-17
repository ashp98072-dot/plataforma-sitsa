# Compras / Repuestos — Fase 1

Base: `8fcc7cc575acaefd55207ba3715e93849ede854d`. Solo catálogo comercial;
sin requerimientos ejecutables, adjuntos, PDF, Excel, autorización o integración.
No se ha ejecutado SQL ni conectado a producción desde este PR.

## Contrato y aplicación del SQL

DDL exacto: `sql/migrate-2026-09-compras-base.sql`, copiado en `sql/schema.sql`.
Cuatro CREATE TABLE IF NOT EXISTS, ordenados por dependencias:
compras_proveedores, compras_requerimientos, compras_requerimiento_lineas,
compras_linea_documentos. InnoDB, utf8mb4_unicode_ci, IDs INT signed.
Objetivo: MariaDB 11.8.9, sin asumir que el esquema físico de Compras está
verificado por la revisión previa de las tablas fiscales.

Antes de aplicar, el operador debe ejecutar y revisar el preflight de lectura
`sql/preflight-2026-09-compras-base.sql` sobre la base seleccionada.
Devuelve versión, engines/collations, tipos/signedness, índices y FKs físicas,
y una decisión por cada tabla prevista:

- APLICAR: tabla ausente y padres compatibles.
- NOOP: tabla existente coincide con columnas, defaults, índices y FKs esperados.
- DETENER: diferencia de contrato o dependencia incompatible; NO aplicar ninguna tabla.

IF NOT EXISTS no verifica ni corrige tablas existentes. Revisar también SHOW
CREATE TABLE de las existentes: el preflight no reemplaza revisión humana de
CHECKs, triggers o restricciones adicionales. No hay ALTER/DROP/backfill/seeds.
No deshabilitar FOREIGN_KEY_CHECKS al aplicar la migración.

## Compatibilidad con schema.sql

Los cuatro padres existentes declaran id INT signed, PK id, ENGINE InnoDB y
DEFAULT CHARSET utf8mb4; schema.sql no fija su collation (depende del servidor).
cont_entidades y flota_vehiculos declaran empresa_id INT signed e índices
únicos (empresa_id,id). No se afirma que esos índices/FKs existan en producción.
Las FKs INT no requieren igualdad de collation entre tablas; las nuevas
columnas de texto sí usan una collation explícita uniforme.

Si tipos, engines o índices físicos no cumplen, detener y proponer un cambio
separado autorizado; esta migración no altera tablas existentes. Las FKs a
usuarios garantizan identidad global, no pertenencia tenant: el futuro flujo
de requerimientos debe validar acceso usuario/empresa en aplicación.

Las FKs compuestas nuevas garantizan que línea, proveedor, requerimiento y
documento pertenezcan al mismo tenant y que el documento apunte a la línea
del requerimiento correcto. ON DELETE RESTRICT, sin cascadas destructivas.
Cada línea mantiene su id; su futura edición deberá actualizar por id y no
borrar/recrear el conjunto. Estado previsto: Pendiente/Autorizada/Rechazada.

NIT tiene índice (empresa_id,nit), no UNIQUE: admite sucursales. La cuenta
bancaria/contacto habitual es única por proveedor en este modelo mínimo.

## API y permisos

- GET/POST `/api/empresas/[slug]/compras/proveedores`.
- GET/PATCH `/api/empresas/[slug]/compras/proveedores/[id]`.
- GET admite `q` literal por nombre comercial, razón social o NIT.
- No DELETE físico; PATCH activo=false/true inactiva/reactiva.

El guard exige empresa accesible con TMS habilitado y permiso específico
compras_proveedores:ver/crear/editar. No hereda tms/gastos/fondos/portales,
ni concede defaults nuevos a roles no Admin. Admin usa la matriz general
existente; no se decide ningún rol autorizante de Compras.
El menú usa el permiso propio, no requiere tms:ver (el guard valida capacidad
de la empresa). Sin APIs para las otras tres tablas en esta fase.

Validación Zod estricta: trim de strings; vacío opcional pasa a NULL. NIT
opcional, sin deducciones/matching. Días crédito entero no negativo. PATCH
parcial conserva campos omitidos; no acepta identidad tenant/auditoría del cliente.
Lecturas/actualizaciones siempre filtran empresa_id. Un id ajeno responde 404.

## Auditoría y concurrencia

Crear/editar/inactivar/reactivar guardan auditoría dentro de la misma
transacción con registrarAuditoriaTx. PATCH bloquea el registro con FOR UPDATE.
Acciones: crear_proveedor_compras, editar_proveedor_compras,
inactivar_proveedor_compras, reactivar_proveedor_compras.
Detalle: proveedorId, usuarioId, nombres de campos enviados y resumen económico
no bancario/identidad antes/después. No replica número de cuenta, correos,
direcciones o teléfonos. Un fallo de auditoría revierte la operación.

## Límites de verificación

Tests dirigidos usan DB/tenant mocks y verifican consultas/identidad,
validación, permisos, transacción/auditoría y contratos SQL/UI.
No se probaron migración contra MariaDB real ni UI manual en navegador;
esas comprobaciones quedan para el operador tras revisar/aplicar SQL autorizado.
proveedor_portales, Gastos/Fondos y RRHH no se modifican.

Verificaciones: 34/34 tests nuevos de Compras; al ampliar los tests dirigidos
a permisos y menú, 70/71 pasan. El fallo de app-shell-operaciones.test.ts
es preexistente: espera /reportes/gastos, pero el main base ya enlaza /reportes.
No se cambia esa ruta ni ese test en este PR. TypeScript, lint dirigido y
git diff --check limpios. No se ejecutó la suite completa.
