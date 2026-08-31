# Fase 2A: seguridad de asientos y propuesta de entidades contables

## Implementado, sin migración

Se conserva la ruta contabilidad/asientos, el guard efectivo del módulo, el GET,
el formato de respuesta y el estado Registrado. No se altera la pantalla actual.
El POST delega en una función que valida y luego usa una sola conexión/transacción:

1. Validación: fecha real (1000–9999), número hasta 40 caracteres, glosa hasta 500,
   entre 2 y 500 líneas, ID positivo, importe no negativo dentro de DECIMAL(14,2),
   máximo dos decimales. Cada línea tiene exclusivamente debe o haber positivo.
2. Cuadre exacto en centavos BigInt. No redondea importes inválidos.
3. Bloqueo de cuentas en orden de ID con FOR UPDATE, filtro por empresa del guard,
   y comprobación de existencia y estado activo antes de escribir la cabecera.
4. Cabecera, líneas y auditoría en la misma conexión. Commit solo al terminar todo.
   Si una operación falla se solicita rollback y se libera la conexión.
5. La restricción única existente (empresa_id, numero) sigue evitando duplicados.
   Conflictos/locks retornan 409. Errores no previstos no exponen SQL; si no puede
   confirmarse el resultado se pide consultar el listado antes de reintentar.

Reutiliza cont_cuentas, cont_asientos, cont_asiento_detalle y auditoria. Requiere
las tablas InnoDB del esquema actual. No crea períodos, libro ni importador aún.
Pruebas automatizadas con conexión simulada: no sustituyen probar concurrencia,
FKs y rollback en una copia controlada de MariaDB antes de importar movimientos.

## Separación KT/Mónaco: propuesta para aprobar antes de SQL

No separar el tenant operativo kt-monaco ni duplicar vehículos/clientes/empleados.
Agregar en una próxima fase una identidad contable interna por razón social:

- Tenant operativo KT/Mónaco → entidad contable KT.
- Tenant operativo KT/Mónaco → entidad contable Mónaco.
- Origen Milenium 01 → KT; origen 08 → Mónaco actual.
- Origen 00 → histórico de Mónaco, en lote separado hasta conciliar el solapamiento.
  Una base histórica no crea por sí sola otra razón social ni se suma a saldos 08.

Nombres orientativos: cont_entidades (identidad), cont_entidad_usuarios (acceso
explícito) y cont_importaciones (procedencia/estado de lote). Reutilizar cuentas y
asientos actuales, incorporando entidad_id y restricciones compuestas cuando se
apruebe el modelo. El código de cuenta podrá repetirse entre entidades, nunca en
la misma entidad. Los números de partida deberán tener ámbito de entidad/período
aprobado antes de importar, sin inventar prefijos para ocultar colisiones.

El guard futuro debe verificar simultáneamente acceso efectivo a Contabilidad,
tenant y entidad solicitada; acceso operativo a kt-monaco no debe conceder por sí
solo ambas contabilidades. Una partida y todas sus cuentas pertenecen a la misma
entidad; restricciones de base y validación server-side deben reforzar esa regla.
Los listados, exportaciones, CxC/CxP y limpieza deberán respetar ese mismo ámbito.

## Transición futura sin asignaciones silenciosas

1. Inventariar las filas actuales y acordar a qué entidad pertenecen; no asignarlas
   automáticamente a KT por compartir el tenant ni inferir identidad por nombre.
2. Proponer migración manual con nuevos campos/tablas primero, sin ejecutarla.
3. Aplicar backfill aprobado, conciliar y comprobar que no quedan filas ambiguas.
4. Actualizar todas las lecturas/escrituras y restricciones antes de permitir
   cuentas de ambas entidades. No quitar anticipadamente la unicidad actual.
5. Registrar procedencia de importación (empresa/base/tabla/clave/lote/huella) para
   reintentos idempotentes y trazabilidad; nunca fusionar partidas por fecha sola.

## Homologación pendiente

TIPO_CTA, MULTIP_CTA y CTACOM_CTA requieren confirmación con Contabilidad o
documentación del sistema origen. No se presupone que 1–5 corresponden al enum
actual ni se deduce signo/debe/haber de MULTIP_CTA. Confirmar también cuentas de
agrupación vs movimiento, jerarquía y fecha de corte/histórico.

Los siguientes PR deben resolver entidad/permisos/períodos, homologación del
catálogo y vista previa antes de importar saldos. Coordinar cualquier asiento
automático con Facturación, manteniendo un identificador de documento origen.
No se han tocado Facturación, Planillas, TMS ni los archivos de Milenium.

## Fuera de esta fase

No hay pantallas nuevas, SQL de migración, importación real, publicación de bases
privadas ni merge automático. La separación por entidad es diseño, NO una
funcionalidad ya disponible. El POST reforzado aún opera al nivel de empresa
existente; por eso no autoriza importar las dos razones sociales al tenant común.
