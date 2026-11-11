# Activación D2 (propietario, después del merge)

Configurar en el entorno **del servidor Node**, sin prefijo `NEXT_PUBLIC_`:

```dotenv
CB2_TERCEROS_D2_APROBADA=1
```

Aplicar la variable a todas las instancias del servicio y reiniciarlas mediante el procedimiento habitual autorizado. Ausente o distinta de `1` mantiene D2 cerrada. Este PR no cambia ninguna configuración desplegada. Para cerrar de nuevo, retirar la variable o poner `0` y reiniciar; no se borran asociaciones ni consumos.

Requisito previo: esquema CB2 y migración existente `sql/migrate-2026-11-cb2-terceros.sql` ya instalados y verificados por el propietario. No hay una migración nueva ni se ejecuta SQL productivo con este trabajo. No habilitar la variable si falta ese esquema.

1. Administrador autorizado A: empresa correcta → Combustibles CB2 → Tercerizados. Buscar primero; registrar **Luis Escobar**, placa **060 KHK**, tipo **MOTOCICLETA**, con referencias estables reales de piloto/unidad, relación, descripción y respaldo verificados por el propietario. No inventar identificadores ni seleccionar una persona homónima. Conservar los IDs; la asociación queda PENDIENTE.
2. Administrador autorizado B, con **ID de usuario distinto del creador**: revisar el respaldo y los IDs en la misma empresa, elegir VERIFICADA y guardar. Cambiar de sesión con la cuenta A no permite autoverificar. El servidor revalida administrador activo, empresa, creador y revisión bajo bloqueo; la auditoría conserva creador, verificador, actor y transición. Revocar conserva al último verificador y audita al revocante.
3. Volver a analizar el Excel: se actualiza el catálogo y se propone la asociación verificada única de nombre+unidad. Pasa a LISTO solo si placa, identidad, clasificación y demás validaciones son compatibles; confirmar el consumo sigue siendo explícito. Revocadas, pendientes, homónimos, contradicciones y ambigüedades quedan sin asignación automática. Los originales del Excel se conservan.

El registro real y la verificación quedan como pasos manuales posteriores al merge/activación, por instrucción del propietario. Las pruebas usan exclusivamente identidades ficticias; no hay seeds ni altas automáticas de Luis Escobar, empleados o vehículos propios. D1/D3/D4/D5 no cambian.

Validación: 645 pruebas focales unitarias/DOM PASS; 16 integraciones PASS en MariaDB local desechable sin red (adaptadores de archivos y contexto HTTP simulados), incluidas carreras de altas, revisiones, revocación/confirmación y retiro de rol. TypeScript, ESLint focal y diff --check PASS. Instancia apagada y directorio de laboratorio conservado; sin SQL productivo.
