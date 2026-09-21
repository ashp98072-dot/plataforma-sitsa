# Cotizaciones — Propuesta de persistencia del costeo (Fase 3)

> **ESTO NO ES UNA MIGRACIÓN Y NO DEBE EJECUTARSE.**
> Es una **propuesta para revisión y aprobación**. Los bloques `sql` de este documento son ilustrativos de un diseño pendiente: no están en `sql/`, no forman parte de ningún flujo de migración y no se aplican automáticamente. Antes de convertirlos en migración faltan decisiones de negocio (ver "Decisiones pendientes"). Este PR **no** agrega columnas a `tms_cotizaciones`, no crea tablas y no ejecuta SQL.

Contexto: el motor puro `src/lib/tms/cotizacion-costeo.ts` (ver `docs/COTIZACIONES-COSTEO-MOTOR.md`) **no lee ninguna de estas tablas**. Recibe todo por `InputCosteoServicio` y devuelve el desglose completo.

Convenciones tomadas de `sql/migrate-2026-09-cotizador-tms.sql`: `INT AUTO_INCREMENT`, `empresa_id` con FK a `empresas`, FK **compuesta** `(empresa_id, id)` para el aislamiento multiempresa, `InnoDB utf8mb4`.

## Requisito de snapshot (obligatorio)

Una cotización debe guardar **todos** los valores usados en su costeo. Una cotización histórica **no puede cambiar** si después cambian combustible, salario, viáticos, seguro, GPS, llantas, aceite, depreciación, rendimiento o parámetros de la ruta.

Por eso el diseño separa:

- **Tablas vivas** (A y B): se editan/versionan por vigencia.
- **Tablas de snapshot INMUTABLE** (C y D): copian los valores, **nunca** los referencian con FK viva, y la aplicación **solo hace `INSERT`** (jamás `UPDATE`/`DELETE` de contenido).

Con `perfil_snapshot`, `parametros_snapshot` e `input_snapshot` el cálculo es reproducible sin consultar ninguna tabla viva.

## Resumen de las cuatro tablas

| Tabla | Rol | Naturaleza |
|---|---|---|
| `tms_cotizacion_costeo_perfiles` | Perfiles de unidad (parámetros del motor por perfil) | Viva |
| `tms_cotizacion_costeo_parametros` | Parámetros económicos por vigencia | Viva |
| `tms_cotizacion_costeos` | Snapshot del costeo de una cotización (1:1) | **Inmutable** |
| `tms_cotizacion_costeo_componentes` | Renglones de componentes del snapshot | **Inmutable** |

Relaciones: `tms_cotizacion_costeos.cotizacion_id → tms_cotizaciones` (FK compuesta, ver índice requerido); `tms_cotizacion_costeo_componentes.costeo_id → tms_cotizacion_costeos` (FK compuesta, `ON DELETE CASCADE`). `perfil_id` en el snapshot **no** tiene FK (fotografía histórica).

## Índice compuesto requerido en `tms_cotizaciones`

La FK compuesta de la tabla C exige una clave única `(empresa_id, id)` en `tms_cotizaciones`. Es un cambio **aditivo de índice** (no de columnas) que debe revisarse y aprobarse antes de aplicar:

```sql
ALTER TABLE tms_cotizaciones ADD UNIQUE KEY uq_cotizacion_empresa_id (empresa_id, id);
```

## A) Perfiles de unidad (catálogo vivo)

Un perfil = un juego de parámetros del motor. No hay columnas ni lógica por tipo de vehículo.

```sql
CREATE TABLE IF NOT EXISTS tms_cotizacion_costeo_perfiles (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  codigo VARCHAR(40) NOT NULL,                 -- p. ej. CAMION_5T, CABEZAL
  nombre VARCHAR(120) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  costo_adquisicion DECIMAL(14,2) NULL,        -- informativo
  dias_operacion_mes DECIMAL(5,2) NOT NULL,    -- divisor mensual→diario de GPS/seguro
  gps_mensual DECIMAL(12,2) NOT NULL DEFAULT 0,
  seguro_vehiculo_mensual DECIMAL(12,2) NOT NULL DEFAULT 0,
  costo_aceite_servicio DECIMAL(12,2) NOT NULL DEFAULT 0,
  vida_util_aceite_km DECIMAL(12,2) NOT NULL,
  costo_juego_llantas DECIMAL(14,2) NOT NULL DEFAULT 0,   -- total del juego (ya integra la cantidad de llantas)
  vida_util_llantas_km DECIMAL(12,2) NOT NULL,
  rendimiento_km_galon DECIMAL(8,3) NOT NULL,
  -- Depreciación del vehículo (todas NULL = no deprecia).
  deprec_valor_base DECIMAL(14,2) NULL,
  deprec_anios DECIMAL(5,2) NULL,
  deprec_dias_operacion_mes DECIMAL(5,2) NULL,
  -- Equipo de refrigeración, separado de la depreciación del vehículo.
  refrig_valor_base DECIMAL(14,2) NULL,
  refrig_anios DECIMAL(5,2) NULL,
  refrig_dias_operacion_mes DECIMAL(5,2) NULL,
  creado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_costeo_perfil_codigo (empresa_id, codigo),
  UNIQUE KEY uq_costeo_perfil_empresa_id (empresa_id, id),
  CONSTRAINT fk_costeo_perfil_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

## B) Parámetros económicos por vigencia (catálogo vivo)

Se inserta una fila nueva cuando cambia el combustible, un salario, un viático, etc. La vigente es la de mayor `vigente_desde <= fecha de cotización`. La aplicación validaría que no haya traslapes de vigencia por empresa.

```sql
CREATE TABLE IF NOT EXISTS tms_cotizacion_costeo_parametros (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  vigente_desde DATE NOT NULL,
  precio_combustible_galon DECIMAL(10,4) NOT NULL,
  iva_tasa DECIMAL(6,4) NOT NULL,              -- fracción: 0.1200
  costo_piloto_dia DECIMAL(12,2) NOT NULL,
  costo_auxiliar_dia DECIMAL(12,2) NOT NULL,
  viatico_piloto_dia DECIMAL(12,2) NOT NULL DEFAULT 0,
  viatico_auxiliar_dia DECIMAL(12,2) NOT NULL DEFAULT 0,
  viatico_guia_dia DECIMAL(12,2) NOT NULL DEFAULT 0,
  hotel_dia DECIMAL(12,2) NULL,
  margen_objetivo DECIMAL(6,4) NULL,           -- fracción: 0.2000
  creado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_costeo_param_vigencia (empresa_id, vigente_desde),
  CONSTRAINT fk_costeo_param_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

## C) Snapshot del costeo de una cotización (1:1, INMUTABLE)

Requiere el índice compuesto descrito arriba en `tms_cotizaciones`.

```sql
CREATE TABLE IF NOT EXISTS tms_cotizacion_costeos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  cotizacion_id INT NOT NULL,
  -- Origen (SIN FK viva: si el perfil/parámetros cambian, esto NO se altera).
  perfil_id INT NULL,
  perfil_codigo VARCHAR(40) NOT NULL,
  perfil_nombre VARCHAR(120) NOT NULL,
  -- Copia COMPLETA de lo que consumió el motor.
  perfil_snapshot JSON NOT NULL,               -- PerfilCosteoUnidad tal como se usó
  parametros_snapshot JSON NOT NULL,           -- ParametrosEconomicosCosteo tal como se usó
  input_snapshot JSON NOT NULL,                -- km, días, cantidades, banderas, overrides, otros costos, precio de venta
  motor_version VARCHAR(20) NOT NULL,          -- versión de las fórmulas; permite auditar recálculos
  -- Resultados denormalizados para consultas/reportes (los componentes viven en D).
  costo_operativo DECIMAL(16,6) NOT NULL,
  iva DECIMAL(16,6) NOT NULL,
  costo_con_iva DECIMAL(16,6) NOT NULL,
  margen_objetivo DECIMAL(6,4) NOT NULL,
  precio_sugerido DECIMAL(16,6) NOT NULL,
  precio_venta DECIMAL(14,2) NULL,
  utilidad_estimada DECIMAL(16,6) NULL,
  margen_real DECIMAL(10,6) NULL,              -- utilidad / costo con IVA (margen SOBRE COSTO)
  creado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cotizacion_costeo_cotizacion (empresa_id, cotizacion_id),
  UNIQUE KEY uq_cotizacion_costeo_empresa_id (empresa_id, id),
  CONSTRAINT fk_cotizacion_costeo_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_cotizacion_costeo_cotizacion FOREIGN KEY (empresa_id, cotizacion_id) REFERENCES tms_cotizaciones (empresa_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

## D) Componentes del snapshot (INMUTABLE)

Un renglón por componente de `ResultadoCosteoServicio.componentes`, incluidos los "otros costos" itemizados. `SUM(monto)` = `costo_operativo` de C.

```sql
CREATE TABLE IF NOT EXISTS tms_cotizacion_costeo_componentes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  costeo_id INT NOT NULL,
  orden SMALLINT NOT NULL,
  clave VARCHAR(60) NOT NULL,                  -- depreciacion, gps, combustible, otro:0, ...
  concepto VARCHAR(200) NOT NULL,
  monto DECIMAL(16,6) NOT NULL,
  UNIQUE KEY uq_costeo_componente_orden (costeo_id, orden),
  INDEX idx_costeo_componente_empresa (empresa_id, costeo_id),
  CONSTRAINT fk_costeo_componente_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_costeo_componente_costeo FOREIGN KEY (empresa_id, costeo_id) REFERENCES tms_cotizacion_costeos (empresa_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

## Decisiones pendientes (antes de convertir esto en migración)

1. **Cardinalidad**: ¿un costeo por cotización (1:1, como está propuesto — recostear implicaría crear otra cotización) o historial de recosteos con uno vigente? **La propuesta 1:1 actual está pendiente de aprobación.**
2. **Precisión de persistencia**: aquí `DECIMAL(16,6)` para no redondear prematuramente; la política de redondeo de presentación aún no existe.
3. **Dos porcentajes históricos del libro (15 % / 20 %)**: el motor aplica **un** margen; no se modela un segundo hasta que negocio confirme su significado.
4. **Relación con la tarifa comercial**: `tarifa_cotizada` sigue siendo la tarifa **comercial**; el costeo solo la alimenta/sugiere. Falta definir cómo, sin tocar estados ni el flujo actual.
5. **Permisos y confidencialidad**: el costeo es información interna de costos y no debe salir en el PDF comercial; falta definir el permiso de lectura/escritura.
6. **Índice compuesto** en `tms_cotizaciones` (arriba): aprobar como cambio aditivo aparte.
7. **Semántica de hotel/viáticos automáticos** (por persona, noches = días − 1): ver `docs/COTIZACIONES-COSTEO-MOTOR.md`.

## Cuándo se convierte en migración

Solo después de aprobar los puntos anteriores, en un PR propio de Fase 3, siguiendo el patrón de `sql/migrate-*` (revisión manual, sin ejecución automática) y con su propia verificación contra la base real.
