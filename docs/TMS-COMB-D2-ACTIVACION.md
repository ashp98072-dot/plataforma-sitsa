# Activación D2 (propietario, después del merge)

Configurar en el entorno **del servidor Node**, sin prefijo `NEXT_PUBLIC_`:

```dotenv
CB2_TERCEROS_D2_APROBADA=1
```

Aplicar la variable a todas las instancias del servicio y reiniciarlas mediante el procedimiento habitual autorizado. Ausente o distinta de `1` mantiene D2 cerrada. Este PR no cambia ninguna configuración desplegada. Para cerrar de nuevo, retirar la variable o poner `0` y reiniciar; no se borran asociaciones ni consumos.

Requisito previo: esquema CB2 y migración existente `sql/migrate-2026-11-cb2-terceros.sql` ya instalados y verificados por el propietario. La separación de catálogos no requiere migración, backfill ni cambio de IDs; asociaciones y consumos existentes se conservan. No habilitar la variable si falta ese esquema. No se ejecuta SQL productivo con este trabajo.

1. Administrador autorizado A: empresa correcta → Combustibles CB2 → Tercerizados → **Pilotos tercerizados**. Buscar primero; registrar **Luis Escobar** solo si no existe, con su referencia estable real. No inventar identificadores ni seleccionar una persona homónima.
2. En **Vehículos y motocicletas tercerizados**, buscar y registrar la placa **060 KHK**, tipo **MOTOCICLETA**, con referencia real y descripción. Cada alta es independiente y no crea una asociación.
3. En **Asociaciones**, seleccionar el piloto y la unidad ya registrados, introducir relación y respaldo; guardar PENDIENTE. Reutilizar los IDs para otras relaciones: un piloto puede tener varias unidades y una unidad varios pilotos. No se solicita proveedor en ninguno de estos pasos.
4. Administrador autorizado B, con **ID de usuario distinto del creador de la asociación**: revisar respaldo e IDs en la misma empresa, elegir VERIFICADA y guardar. Cambiar de sesión con la cuenta A no permite autoverificar. El servidor revalida administrador activo, empresa, creador y revisión bajo bloqueo empresarial; la auditoría conserva creador, verificador, actor y transición. Revocar conserva al último verificador y audita al revocante.
5. Volver a analizar el Excel: se actualiza el catálogo y se propone la asociación verificada única de nombre+placa. Pasa a LISTO solo si se completan las validaciones; confirmar el consumo sigue siendo explícito. Pendientes, revocadas, homónimos y placas ambiguas (incluso identidades sin asociación) no se asignan automáticamente. El proveedor sigue siendo obligatorio donde corresponde: importación, facturación y conciliación. Los originales del Excel se conservan.

El registro real y la verificación quedan como pasos manuales posteriores al merge/activación, por instrucción del propietario. Las pruebas usan exclusivamente identidades ficticias; no hay seeds ni altas automáticas de Luis Escobar, empleados o vehículos propios. D1/D3/D4/D5 no cambian.

La API de gestión usa altas discriminadas (`recurso`: PILOTO/UNIDAD/ASOCIACION), GET de catálogos completos y PATCH de revisión; no acepta proveedor ni empresa del cliente. Los contratos de consumo, importación, facturación y conciliación se conservan.

Validación de esta reestructuración: 657 pruebas unitarias/DOM y 19 integraciones MariaDB local sin red PASS; TypeScript, ESLint focal y diff --check PASS. Las integraciones usan contexto de autorización y adaptadores de archivos simulados; verifican transacciones, FK/CHECK, roles vigentes, concurrencia, rollback y conservación de consumos con el motor real. Sin activación ni SQL productivo.
