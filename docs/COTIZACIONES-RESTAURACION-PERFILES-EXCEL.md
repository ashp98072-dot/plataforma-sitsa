# Recuperación propuesta de perfiles de costeo

Fuente entregada: `COTIZADOR RUTAS.xlsx` (el pedido la llama `COTIZADOR RUTAS(2).xlsx`; verificar que sea la misma versión antes de aplicar). Esta propuesta **no** ejecuta SQL ni reconstruye cotizaciones o snapshots. Requiere revisión de negocio del bloque base elegido y del tenant antes de ejecución manual.

## Modelo y alcance

La tabla real es `tms_cotizacion_costeo_perfiles` (`sql/schema.sql`, `src/lib/tms/cotizacion-costeo-ajustes.ts`). `empresa_id` identifica el tenant y `(empresa_id,codigo)` es único. El motor (`src/lib/tms/cotizacion-costeo.ts`) espera GPS y seguro mensuales divididos por `dias_operacion_mes`, aceite por servicio dividido por vida útil en km, juego **completo** de llantas dividido por vida útil en km, y combustible como `distanciaKm / rendimientoKmGalon * precioCombustibleGalon`. Depreciación y refrigeración son sendas ternas valor base/años/días de operación. `costo_adquisicion` es informativo; se deja NULL porque el Excel rotula el costo como base de depreciación, sin demostrar un valor de adquisición independiente. No se importan combustible/precio, salarios, viáticos, IVA, márgenes ni totales de ruta: pertenecen a vigencias/escenarios, no al perfil.

Los códigos/nombres provienen de `CODIGOS_PERFIL_COSTEO` en `src/lib/tms/cotizacion-costeo.ts`, no se inventan. Los tests que usan un `CABEZAL` de 9.3 km/galón son fixtures del motor, no evidencia de registros borrados de producción. No hay un seed histórico canónico con IDs/valores de los perfiles eliminados; el preflight permite revisar el estado real antes de restaurar.

## Preview exacto de los cinco registros propuestos

| Código | Nombre | Días GPS/seguro | GPS mensual | Seguro mensual | Aceite/servicio | Vida aceite km | Juego llantas | Vida llantas km | Rend. km/gal | Deprec. base/años/días | Refrig. base/años/días |
|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---|---|
| `CAMION_2_7T` | Camión 2.7 toneladas | 30 | 140 | 1150 | 1350 | 5000 | 5000 | 50000 | 22 | 150000 / 5 / 26 | NULL |
| `CAMION_5T` | Camión 5 toneladas | 30 | 140 | 1150 | 1500 | 5000 | 6900 | 50000 | 17 | 182142.86 / 5 / 26 | NULL |
| `CAMION_5T_REFRIGERADO` | Camión 5 toneladas refrigerado | 30 | 140 | 1150 | 1500 | 5000 | 7800 | 50000 | 14 | 182142.86 / 5 / 26 | 100000 / 5 / 26 |
| `CAMION_10T` | Camión 10 toneladas | 30 | 140 | 1150 | 2500 | 5000 | 9900 | 50000 | 9.5 | 120000 / 5 / 26 | NULL |
| `CABEZAL` | Cabezal | 30 | 140 | 1150 | 3000 | 5000 | 10200 | 50000 | 8 | 250000 / 5 / 26 | NULL |

Todos activos (`activo=1`), `costo_adquisicion=NULL`. Valores en quetzales donde aplique. No se fijan IDs; la base los asigna.

## Trazabilidad al workbook (fórmulas, no totales calculados)

- `COSTEO 2.7 TON`: F21/G21/H21 son GPS/seguro/aceite. I21=1250 e I22=`I21*4` → juego 5000. F23=`F21/30`, G23=`G21/30`, H23=`H21/5000`, I23=`I22/50000`. J25=`(J24/22)*J23` → 22 km/gal. H14=150000, H16=`H14/60`, H17=`H16/26` → 5 años y 26 días de depreciación.
- `COSTEO 5 TON`: bloque normal E21/F21/G21, H21=1150, H22=`H21*6` → 6900; E23/F23 dividen entre 30; G23/H23 entre 5000/50000; I25=`(I24/17)*I23`. G14=182142.86, G16=`G14/60`, G17=`G16/26`.
- `COSTEO 5 TON`: bloque refrigerado E37/F37/G37, H37=1300, H38=`H37*6` → 7800; E39/F39 dividen entre 30; G39/H39 entre 5000/50000; I41=`(I40/14)*I39`. I14=100000, I16=`I14/60`, I17=`I16/26` aporta la terna adicional de refrigeración. La depreciación del vehículo permanece separada.
- `COSTEO 10 TON`: D21/E21/F21, G21=1650, G22=`G21*6` → 9900; E23 divide entre 30, F23/G23 entre 5000/50000; H25=`(H24/9.5)*H23`. F14=120000, F16=`F14/60`, F17=`F16/26`. D23 **no** divide GPS entre 30 en el primer escenario, pero D31=`D29/30` en el segundo; se toma 30 como convención mensual del modelo y se deja esta discrepancia para revisión.
- `COSTEO CABEZALES ` (el nombre de hoja contiene un espacio final): D21/E21/F21, G21=1700, G22=`G21*6` → 10200; D23/E23 dividen entre 30, F23/G23 entre 5000/50000; H25=`(H24/8)*H23`. F14=250000, F16=`F14/60`, F17=`F16/26`.

## Ambigüedades que requieren conformidad antes de ejecutar

El primer bloque de cada hoja principal se toma como base de perfil, no se mezclan escenarios. Los bloques secundarios cambian valores: 2.7T pasa a seguro 1050, aceite 1325, llantas 4400 y rendimiento 24.5; 5T normal a seguro 1050, llantas 6150 y rendimiento 20; 10T y cabezal tienen seguro 1050 en el segundo bloque. Son escenarios alternativos, no otro perfil sin confirmación. `Contenedores` es un conjunto de rutas de cabezal con GPS 170.72/174.10, seguro 1550, aceite 1860, 18 llantas de 2137 y rendimiento 9.3; contradice la hoja principal de cabezales. El fixture actual del motor coincide con `Contenedores` en esos parámetros, pero no prueba que ese fuera el perfil productivo eliminado. `Hoja1` y `COSTEO 10 ` son otros escenarios, no se insertan automáticamente. **Confirmar con negocio si `CABEZAL` debe tomar la hoja principal o `Contenedores` antes de usar la migración.**

## Operación segura (pendiente, NO ejecutada)

1. Seleccionar explícitamente la base y reemplazar `REEMPLAZAR_SLUG_EMPRESA` por el slug exacto de `empresas` en ambos SQL. No asumir ID 1 ni que KT/Mónaco compartan perfiles por pertenecer a un tenant. Aplicar una vez por tenant autorizado.
2. Ejecutar **solo** `sql/preflight-2026-09-restaurar-perfiles-cotizaciones.sql`. Revisar `DATABASE()`, esquema real, perfiles existentes y estado. `APLICAR` exige ninguno de los cinco códigos; `NOOP` exige los cinco con valores propuestos idénticos; `DETENER` indica tenant inexistente, registros parciales o divergencia. Comparar los valores del preview con negocio antes de avanzar.
3. Solo tras aprobación separada y `APLICAR`, ejecutar manualmente `sql/migrate-2026-09-restaurar-perfiles-cotizaciones.sql`. Un segundo intento no duplica ni sobrescribe códigos. Un estado parcial o divergente no inserta nada; volver al preflight.
4. Verificar nuevamente lectura y UI. No se tocan snapshots (`tms_cotizacion_costeos`), cotizaciones, rutas ni vigencias. La restauración de perfiles vivos no recalcula históricos.
