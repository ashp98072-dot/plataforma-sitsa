# PR #507: correccion de cotejamientos de metadata

Fecha de auditoria: 2026-10-22. No se ejecuto SQL ni se cambio Hostinger.

## Diagnostico

El cruce problematico del preflight esta en `fks_reales`:

```sql
FROM information_schema.KEY_COLUMN_USAGE AS k
JOIN information_schema.REFERENTIAL_CONSTRAINTS AS r
 ON r.CONSTRAINT_SCHEMA = k.CONSTRAINT_SCHEMA AND r.TABLE_NAME = k.TABLE_NAME
 AND r.CONSTRAINT_NAME = k.CONSTRAINT_NAME
```

Estas son comparaciones entre columnas IMPLICIT de distintas tablas de metadata,
no comparaciones gobernadas por collation_connection. El error comunicado es
compatible con este cruce entre utf8mb3_general_ci y utf8mb3_general1400_as_ci.
Sin reproduccion real no se atribuye el primer fallo a una de las tres claves:
el optimizador puede evaluar cualquiera primero. Las nueve tablas InnoDB y la
ausencia de CB2 no evitan que se consulte la metadata de FKs base.

## Correccion y alcance

Ambos operandos de los cruces textuales se convierten con
`CONVERT(... USING utf8mb4) COLLATE utf8mb4_bin`. Tambien se aplica a la
comparacion de esquemas con DATABASE(), y a las comparaciones del contrato
esperado de columnas, indices, FKs, CHECK y colisiones de nombres.
Las comparaciones binarias distinguen mayusculas y acentos; no se relajan las
validaciones. Dimensiones numericas y NON_UNIQUE siguen siendo numericos.
No cambia ningun CREATE TABLE, dato, variable ni cotejamiento persistente.
Los literales comparados con una sola columna no son cruces entre dos columnas
IMPLICIT. CHECK y generacion ya tenian conversion y cotejamiento explicitos.

Los cuatro bloques canonicos (preflight, dos en migrate, postcheck) siguen
identicos. Se conservan conteos 86/34/18/26, orden de columnas, acciones FK,
restricciones de entorno y clasificacion CLEAN/FINAL/DIVERGENTE.

Referencia: [documentacion de cotejamientos de MariaDB](https://mariadb.com/docs/server/reference/data-types/string-data-types/character-sets/setting-character-sets-and-collations).

## Validaciones

- PASS: `node scripts/ci/combustibles-pr2-lab/run.mjs --self-test`.
  Incluye snapshots tipados, fixtures mutados, 13 tablas, conteos, limites,
  truncamientos, aserciones positivas/negativas del arnes e identidad de los
  cuatro contratos. Nueva regresion estatica exige los tres cruces FK explicitos
  y rechaza cruces textuales implicitos; preserva cinco comparaciones numericas.
- PASS: `node --check scripts/ci/combustibles-pr2-lab/run.mjs`.
- PASS: `git diff --check`.
- Pendiente: sintaxis y ejecucion SQL, reproduccion del #1267 y desaparicion
  efectiva en MariaDB 11.8.9. MariaDB y Docker no estan disponibles localmente.
  El self-test no ejecuta SQL ni demuestra comportamiento del motor.

Antes de migrar, repetir solamente el preflight manual completo y conservar su
salida. Esperado con las cuatro CB2 ausentes: base_compatible=1 y CLEAN, solo
si todas las comprobaciones BASE pasan. La ausencia de CB2 por si sola no
certifica compatibilidad. Migracion, postcheck FINAL y casos adversos requieren
el laboratorio MariaDB real y su autorizacion independiente.

Los archivos locales preexistentes sin seguimiento (.github/ y el documento de
laboratorio abierto en el IDE) se excluyen de este cambio.
