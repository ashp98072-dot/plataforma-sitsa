# Fondos diarios (Programación + Solicitudes de Fondos) — orden de despliegue

Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE** (tsc, build, pruebas contra MariaDB 11.8.9 desechable). **No probado en producción.** Nada de esto se ejecuta automáticamente.

## Principio de compatibilidad
El código detecta la migración con una sonda de columnas. **Sin migración la integración queda apagada** (no aparece el selector, no se sincroniza nada) y Programación/Fondos se comportan como antes. Por eso el orden seguro es **migración primero y después el código**, o código primero y migración cuando se quiera encender.

## Orden exacto
1. **Respaldo** de `tms_planes_viaje`, `tms_solicitudes_fondo`, `tms_solicitud_fondo_lineas` (y `auditoria` si se desea).
2. **Código**: merge del PR a `main` (Hostinger despliega solo). Con la BD sin migrar el comportamiento no cambia. Comprobar que la app arranca y que Programación y Fondos cargan.
3. **Migración** (manual, en horario de baja carga): ejecutar `sql/migrate-2026-11-fondos-diarios.sql`. Es idempotente (se puede repetir); la última consulta devuelve las 7 columnas esperadas. Duración: ALTER sobre tablas de fondos y planes.
   - Dentro de 5 minutos (caché positiva) o 30 s (negativa) el sistema detecta la migración sin reiniciar.
4. **Comprobación funcional** (empresa de prueba o un día controlado):
   1. En Programación, en un viaje Propio con viático > 0, elegir *Empresa requirente* (KT o Mónaco) y guardar.
   2. En Fondos debe existir UNA solicitud *Diaria · Programación* de esa fecha y empresa, con una línea por viático; segundo viaje del mismo día/empresa → misma solicitud, nueva línea.
   3. En la solicitud: monto, beneficiario y viaje están bloqueados; método de pago y cuenta se pueden editar; **Resincronizar** responde «Todo está sincronizado.».
   4. Autorizar (requirente de Operaciones definido) y agregar un viaje nuevo al mismo día/empresa → debe aparecer una solicitud *Complementaria (excepcional)*, la principal no cambia.
   5. Copiar una programación → no debe crear solicitudes de fondos.
5. Si algo falla en el paso 4: apagar la función es posible sin perder datos — ver reversión.

## Reversión
- **Solo código** (lo más simple): revertir el merge en `main`. Con la migración aplicada el código anterior ignora las columnas nuevas; las solicitudes diarias ya creadas quedan como solicitudes normales.
- **Estructura**: `sql/rollback-2026-11-fondos-diarios.sql`. **Es seguro por defecto**: si existen viajes con empresa requirente, solicitudes diarias/complementarias o líneas automáticas **no borra nada** y lo informa (`estado_rollback = BLOQUEADO`). Revertir con datos existentes exige, en la misma sesión y tras respaldar:
  ```sql
  SET @CONFIRMAR_PERDIDA_DE_DATOS = 'SI';
  SOURCE sql/rollback-2026-11-fondos-diarios.sql;
  ```
  Efecto de forzar: las líneas automáticas pasan a ser manuales (pierden la protección y su viático de origen) y se pierde la empresa requirente de cada viaje. Orden: 1) revertir el código, 2) rollback SQL, 3) verificar `columnas_que_quedan = 0`.
- El rollback deja un índice auxiliar inocuo `idx_fondolin_solicitud_rb` (necesario para poder quitar `uq_fondolin_viatico` sin romper la FK).

## Verificación realizada
- Laboratorio MariaDB 11.8.9 desechable: migración aplicada 2 veces, 17 pruebas de integración (agrupación, sin duplicados, concurrencia, diferencial, autorizada→complementaria, permisos, protección de líneas, rechazadas, unicidad, aislamiento de empresa, resincronizar, rollback seguro) y 21 de Fase 1.
- Pendiente (no hecho): prueba manual en un entorno con datos reales y de la interfaz en navegador.

---

# Fase 3 — «Otros fondos del viaje»

Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE** (tsc, ESLint, build, 48 pruebas contra MariaDB 11.8.9 desechable). No probado en producción ni en navegador. Requiere la Fase 2 (migración `sql/migrate-2026-11-fondos-diarios.sql`) ya aplicada.

## Qué agrega
- Sección «Otros fondos del viaje» en Programación (debajo de los viáticos): varias líneas con categoría, monto, descripción, beneficiario (empleado de RRHH: piloto, auxiliar u otro), método de pago y cuenta/teléfono (sugeridos desde RRHH y corregibles).
- Se guardan con el viaje (tabla `tms_plan_otros_fondos`) y se consolidan **en la misma solicitud diaria** (misma lógica de la Fase 2) como líneas `AUTO_OTRO`: unidad, cliente, fecha, viaje y empresa requirente se heredan del viaje.
- Reglas: diferencial con ids estables; método de pago/cuenta editados en Fondos se conservan salvo que se cambien en Programación; autorizada → complementaria; un otro fondo ya autorizado no se edita ni retira desde Programación; «Viáticos» no es categoría de otros fondos (evita pagar dos veces); nueva categoría compartida «Peajes».
- Combustible: no crea desembolsos; solo concilia vales contra una línea de fondos ya autorizada. Una línea `AUTO_OTRO` de categoría «Combustible» es la solicitud de dinero y los vales la justifican; no hay segundo desembolso.

## Orden exacto
1. Respaldo de `tms_solicitud_fondo_lineas` y `tms_solicitudes_fondo`.
2. Código a `main` (sin migración la sección no aparece y los viáticos siguen igual).
3. Migración manual: `sql/migrate-2026-12-fondos-otros.sql` (idempotente; reemplaza de forma atómica la restricción `ck_fondolin_origen`).
4. Comprobación: en un viaje Propio con empresa requirente agregar un hospedaje y un peaje → la solicitud diaria muestra 1 línea de viático + 2 de otros fondos, protegidas (solo método de pago/cuenta editables); guardar de nuevo no duplica; tras autorizar, un nuevo otro fondo va a una complementaria.

## Reversión
- Código: revertir el merge. Estructura: `sql/rollback-2026-12-fondos-otros.sql` — **se niega a borrar si existen otros fondos o líneas `AUTO_OTRO`** (`BLOQUEADO`); con `SET @CONFIRMAR_PERDIDA_DE_DATOS = 'SI';` revierte y convierte esas líneas en manuales. Debe ejecutarse **antes** que el rollback de la Fase 2.
