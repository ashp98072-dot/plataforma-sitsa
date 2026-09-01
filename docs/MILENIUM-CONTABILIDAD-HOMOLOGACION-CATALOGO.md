# Milenium → Contabilidad: homologación del catálogo de cuentas

Fecha: 2026-09-01. Estado: preparación de homologación, NO importación, NO vista
previa, NO importador. Continúa `docs/MILENIUM-CONTABILIDAD-FASE1.md` (ya
actualizado contra `docs/CONTABILIDAD-C2-TRANSICION.md` y
`docs/CONTABILIDAD-C3A-CAPTURA.md`, PR #116 fusionado en
`71c581d26ab84b26c74b770c2a9a4b5625e4555b`). No repite decisiones ya resueltas
allí (identidad contable KT/Mónaco vía `entidad_id`, transacción del asiento
manual) — remite a ese documento para esas dos.

Este documento NO homologa nada por sí solo: propone una matriz para que el
responsable contable la confirme o la corrija. Ningún campo pasa a
`CONFIRMADO` sin evidencia técnica verificable en este repositorio o sin
respuesta explícita del responsable.

## 1. Modelo origen (Milenium `co01.dbf`, vía `scripts/milenium/cuentas.mjs`)

Campos leídos hoy por la herramienta (`analizarCuentas`), con su tipo DBF tal
como los declara el propio archivo (no una suposición — es lo que exige
`leerDbf` al validar la selección de campos):

| Campo | Tipo DBF | Notas técnicas confirmadas |
| --- | --- | --- |
| `CODIGO_CTA` | `C` (carácter) | Se valida contra el límite destino (40); se detectan duplicados por forma normalizada (mayúsculas, sin diacríticos, sin espacios extremos). |
| `NOMBRE_CTA` | `C` | Decodificado Windows-1252 → Unicode; se valida contra el límite destino (200). |
| `TIPO_CTA` | `N` (numérico, sin decimales) | Solo se cuenta su distribución de valores (`tipos_origen`); ningún significado asumido. |
| `NIVEL_CTA` | `N` | Se valida que sea entero ≥ 1 (`incidencias.nivel_invalido`); se cuenta su distribución (`niveles_origen`). |
| `LINACTIVA_` | `L` (lógico) | Se invierte a `activa` únicamente como booleano (`true`/`false`/`null` → `estado_desconocido`); el NOMBRE del campo sugiere "línea inactiva", pero esa lectura del nombre no ha sido confirmada por el responsable. |
| `CTACOM_CTA` | `L` | Leído desde Fase 1, pero su distribución NUNCA se reportó hasta este ticket — ver sección 4. |
| `MULTIP_CTA` | `N` | Igual que arriba — leído sin reportar distribución hasta este ticket. |

No hay ningún otro campo de `co01.dbf` incorporado a la herramienta (no se ha
inspeccionado, por ejemplo, un posible campo de cuenta padre/agrupadora — ver
sección 5). El lector rechaza cualquier DBF que no sea VFP `0x30` / Windows-1252
(marca `0x03`); no hay evidencia dentro de este repo de haber ejecutado la
herramienta contra una copia real de Milenium ni de haber registrado su salida
en ningún documento — ver sección 4.

## 2. Modelo destino (`cont_cuentas`, `sql/schema.sql`)

```sql
CREATE TABLE cont_cuentas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  entidad_id INT NULL DEFAULT NULL,
  codigo VARCHAR(40) NOT NULL,
  nombre VARCHAR(200) NOT NULL,
  tipo VARCHAR(40) NOT NULL,
  nivel INT NOT NULL DEFAULT 1,
  activa TINYINT(1) NOT NULL DEFAULT 1,
  UNIQUE KEY uq_cuenta_entidad (empresa_id, entidad_id, codigo),
  ...
);
```

- `entidad_id`: nullable a nivel de columna (compatibilidad con filas previas a
  C2), pero toda escritura nueva vía `crearRegistro()` la exige mediante el
  ámbito autorizado (`src/lib/contabilidad/registros.ts`, `ambito.ts`) — este es
  el mecanismo ya resuelto que separa KT de Mónaco (ver `FASE1.md`).
- `tipo`: la columna es `VARCHAR(40)`, sin `ENUM` nativo de MySQL/MariaDB — el
  conjunto cerrado real vive en la validación de la API:
  `z.enum(["Activo", "Pasivo", "Capital", "Ingreso", "Gasto"])`
  (`src/lib/contabilidad/registros.ts:22`). Son 5 valores, clasificación
  contable estándar (activo/pasivo/capital/ingreso/gasto) — no un enum
  numérico ni ligado a ningún esquema de Milenium.
- `nivel`: `INT`, sin límite superior de negocio documentado; no es una
  referencia a otra fila (no hay columna `padre_id` ni autorreferencia).
- `activa`: `TINYINT(1)`, es el ÚNICO campo que hoy filtra qué cuentas se
  pueden usar en una partida (`src/lib/contabilidad/asientos.ts:53`:
  `cuentas.some((c) => ... Number(c.activa) !== 1)` rechaza la partida). No
  existe ningún campo que distinga cuenta de **agrupación** de cuenta de
  **movimiento** — hoy, técnicamente, cualquier cuenta activa de cualquier
  nivel podría usarse en un asiento.
- No existe ninguna columna de **naturaleza deudora/acreedora** (signo
  esperado del saldo) en `cont_cuentas` hoy.
- Unicidad: `(empresa_id, entidad_id, codigo)` — el mismo código puede
  repetirse en dos entidades distintas (KT y Mónaco), nunca dentro de la
  misma entidad.

## 3. Campos Milenium exactos ya descubiertos

Confirmado por relectura directa de `scripts/milenium/cuentas.mjs` (línea de
selección de campos): `CODIGO_CTA`, `NOMBRE_CTA`, `TIPO_CTA`, `NIVEL_CTA`,
`LINACTIVA_`, `CTACOM_CTA`, `MULTIP_CTA` — exactamente los 7 que pide este
ticket, ni uno más. No se ha inspeccionado ningún otro DBF del catálogo
contable (`co02`–`co08`, bancos, cartera, etc. — ver
`docs/MILENIUM-INVENTARIO-FUNCIONAL.md` para el inventario estructural de esos
267 archivos, que tampoco los abrió).

## 4. TIPO_CTA / CTACOM_CTA / MULTIP_CTA — qué sabemos y qué no

**No hay ningún resultado real documentado en este repositorio.** Se revisó
`docs/MILENIUM-CONTABILIDAD-FASE1.md`, `FASE2.md`, `FASE2B.md` y
`MILENIUM-INVENTARIO-FUNCIONAL.md`: ninguno registra una salida real de
`revisar-cuentas.mjs` (ni conteos, ni valores, ni un ejemplo). La única pista
existente es una advertencia explícita en `FASE1.md`: *"TIPO_CTA ... Pendiente
de homologación; NO asumir significado de 1–5"* — una nota de precaución
sobre un posible rango observado, no un conteo ni una confirmación.

| Campo | Qué podemos afirmar TÉCNICAMENTE (por el código) | Qué NO podemos afirmar sin datos/responsable |
| --- | --- | --- |
| `TIPO_CTA` | Es numérico entero sin decimales en el DBF; la herramienta ya agrupa su distribución (`tipos_origen`) desde Fase 1. `FASE1.md` deja constancia de una posible observación informal de valores 1–5, sin confirmar. | Qué significa cada valor (¿Activo/Pasivo/Capital/Ingreso/Gasto? ¿algo más granular?), si el conjunto de valores es realmente 1–5 en las 3 bases, si es consistente entre KT/Mónaco/histórico, y cuál es la correspondencia 1:1 (o N:1) contra los 5 valores del `tipo` destino. |
| `CTACOM_CTA` | Es lógico (booleano) en el DBF. Hasta este ticket, la herramienta lo LEÍA pero nunca reportaba su distribución — corregido en esta entrega (`ctacom_origen`, ver sección 7). El nombre sugiere "cuenta común" o "cuenta de agrupación", pero es una lectura del nombre del campo, no una confirmación. | Su significado real, si distingue cuenta de agrupación vs. cuenta de movimiento (el destino no tiene ese concepto hoy — ver sección 2), y qué proporción de `true`/`false` aparece en cada base real. |
| `MULTIP_CTA` | Es numérico entero sin decimales en el DBF. Igual que `CTACOM_CTA`: se leía sin reportar distribución; corregido en esta entrega (`multip_origen`). El nombre sugiere "multiplicador", posiblemente signo (+1/-1) para naturaleza deudora/acreedora — pura hipótesis por el nombre. | Si es un multiplicador de signo, un factor de presentación, o algo sin relación con naturaleza contable; su rango real de valores; si determina el debe/haber esperado de la cuenta. |

**Ninguna fila de esta tabla puede convertirse en regla de importación sin que
el responsable contable/Milenium la confirme con evidencia real (ejecutar la
herramienta actualizada contra una copia estable y compartir — o describir —
los conteos que arroje, más su interpretación del sistema origen).**

## 5. ¿`NIVEL_CTA` permite reconstruir jerarquía por sí solo?

**No.** Es un entero de profundidad (o al menos eso sugiere su nombre), pero
por sí solo NO identifica:

- **Cuenta padre**: no existe en la selección de campos actual ningún
  `CTAPADRE_CTA`/`CTA_PADRE` ni columna equivalente de referencia a otra fila.
  Dos cuentas de `NIVEL_CTA = 2` no tienen, con los datos leídos hoy, forma de
  saber cuál es hija de cuál sin un campo de enlace explícito.
- **Cuentas de agrupación vs. cuentas de movimiento**: ninguno de los 7 campos
  leídos declara esto directamente. `CTACOM_CTA` es candidato por su nombre
  (sección 4), pero no está confirmado.
- **Naturaleza deudora/acreedora**: no hay campo confirmado para esto; ni
  origen ni destino tienen hoy una columna dedicada (`MULTIP_CTA` es
  candidato especulativo, sección 4).
- **Cuentas utilizables en partidas**: en el destino, hoy ES `activa` el único
  filtro (sección 2) — pero eso NO equivale a "cuenta de movimiento" del
  origen; una cuenta de agrupación Milenium podría estar `activa` en el
  sentido de "no dada de baja" sin ser una cuenta donde deban registrarse
  partidas.

El propio `CODIGO_CTA` de ejemplo usado en las pruebas (`"001.01"`, con punto)
podría sugerir una estructura jerárquica por segmentos de código — pero es
solo el dato ficticio de una prueba unitaria, nunca un código real observado;
no se puede usar como evidencia de que el código origen realmente codifica
jerarquía de esa forma.

**Conclusión: falta, como mínimo, (a) confirmar si existe un campo de cuenta
padre en `co01.dbf` que hoy no se lee, (b) la semántica real de `CTACOM_CTA`,
y (c) una regla explícita del responsable contable sobre qué hace que una
cuenta sea "de movimiento" en el sistema origen.**

## 6. Matriz de homologación propuesta

| Campo/regla origen | Campo/regla destino | Estado | Nota |
| --- | --- | --- | --- |
| `CODIGO_CTA` | `cont_cuentas.codigo` | **CONFIRMADO** | Mapeo directo de texto, conservando ceros iniciales; validado contra el límite VARCHAR(40) del destino; detección de duplicados normalizados ya implementada. |
| `NOMBRE_CTA` | `cont_cuentas.nombre` | **CONFIRMADO** | Decodificación Windows-1252 → Unicode ya implementada y probada; validado contra VARCHAR(200). |
| Empresa/base origen (01/08/00) | `cont_cuentas.entidad_id` | **CONFIRMADO** | Resuelto en C2 (ver `FASE1.md`): KT → entidad KT; Mónaco 08 y Mónaco 00 → LA MISMA entidad Mónaco (no dos entidades). |
| `LINACTIVA_` | `cont_cuentas.activa` (invertido) | **PROPUESTO / REQUIERE VALIDACIÓN** | Técnicamente trivial invertir un booleano; lo que falta confirmar es que "línea inactiva" en Milenium equivale exactamente a "cuenta no utilizable" en destino, en las 3 bases por igual. |
| `NIVEL_CTA` | `cont_cuentas.nivel` | **PROPUESTO / REQUIERE VALIDACIÓN** | Copiar el entero es trivial; su SIGNIFICADO (profundidad real, consistencia entre bases) no está confirmado, y por sí solo no reconstruye jerarquía (sección 5). |
| `TIPO_CTA` | `cont_cuentas.tipo` (Activo/Pasivo/Capital/Ingreso/Gasto) | **SIN EQUIVALENCIA** | No existe diccionario de valores confirmado; no inferir del rango numérico observado informalmente. |
| `CTACOM_CTA` | (sin columna destino hoy) | **SIN EQUIVALENCIA / NO IMPORTAR TODAVÍA** | El destino no distingue agrupación de movimiento; incluso si se confirma el significado origen, falta decidir cómo (o si) modelarlo en destino. |
| `MULTIP_CTA` | (sin columna destino hoy, posible naturaleza) | **SIN EQUIVALENCIA** | Hipótesis de signo/naturaleza sin confirmar; el destino tampoco tiene columna de naturaleza deudora/acreedora hoy. |
| Cuenta padre / jerarquía real | (sin columna origen identificada, sin columna destino) | **NO IMPORTAR TODAVÍA** | Falta identificar el campo origen (si existe) antes de proponer cualquier destino. |
| Cuenta de agrupación vs. movimiento | (sin columna destino hoy) | **NO IMPORTAR TODAVÍA** | Depende de resolver `CTACOM_CTA` (o el campo que corresponda) Y de decidir si se modela en destino antes de permitir escrituras de partidas importadas. |
| Naturaleza deudora/acreedora | (sin columna origen confirmada, sin columna destino) | **NO IMPORTAR TODAVÍA** | Bloquea homologar `MULTIP_CTA`; sin esto, un importador no podría validar signo de saldos. |

Ninguna fila de esta matriz autoriza escritura. Los estados `PROPUESTO /
REQUIERE VALIDACIÓN` describen una implementación técnicamente posible, no
una regla aprobada.

## 7. Ajuste mínimo aplicado a la herramienta (esta entrega)

`scripts/milenium/cuentas.mjs`: `analizarCuentas()` ahora agrega `ctacom_origen`
y `multip_origen` al informe, con el mismo patrón exacto ya usado por
`tipos_origen`/`niveles_origen` (conteo por valor visto, `sin_valor` para
`NULL`) — ambos campos ya se leían desde Fase 1, pero su distribución nunca se
reportaba. Sin cambios en el lector DBF (`leerDbf`), sin nuevos campos
leídos, sin red, sin escritura de archivos, sin SQL, sin importación. El
informe sigue sin exponer códigos/nombres de cuentas reales (confirmado por
test dedicado). `listo_para_importar` sigue fijo en `false`.

Cuando el responsable ejecute `node scripts/milenium/revisar-cuentas.mjs
<ruta> KT|MONACO|MONACO_HISTORICO` con esta versión, el JSON impreso ya
incluirá las distribuciones de `TIPO_CTA`, `CTACOM_CTA` y `MULTIP_CTA` — eso
es lo que falta para poder llenar la sección 4 con evidencia real.

## 8. Preguntas concretas para el responsable contable / Milenium

1. ¿Qué significa cada valor de `TIPO_CTA`? ¿Corresponde 1:1 a
   Activo/Pasivo/Capital/Ingreso/Gasto, o es más granular (requiriendo mapear
   varios valores origen a un mismo `tipo` destino)?
2. ¿`CTACOM_CTA` distingue cuenta de agrupación (no usable en partidas) de
   cuenta de movimiento (sí usable)? Si no, ¿qué campo del sistema Milenium sí
   lo distingue?
3. ¿`MULTIP_CTA` determina la naturaleza deudora/acreedora (signo esperado del
   saldo)? Si no, ¿qué representa realmente?
4. ¿Existe en `co01.dbf` (u otro DBF relacionado) un campo de cuenta padre o
   código de agrupación superior que hoy no se está leyendo? ¿Cómo se
   reconstruye la jerarquía real en Milenium?
5. ¿El significado de estos 3 campos es idéntico entre las bases KT (01),
   Mónaco actual (08) y Mónaco histórico (00), o puede variar por base/época?
6. Para las cuentas con `LINACTIVA_` en blanco/nulo (`estado_desconocido` en
   el informe), ¿cuál es el tratamiento correcto — tratarlas como activas,
   inactivas, o requieren revisión caso por caso?
7. ¿Hay un catálogo de referencia (documento, capacitación interna, o el
   propio manual de Milenium) que ya documente el significado de `TIPO_CTA`/
   `CTACOM_CTA`/`MULTIP_CTA`, evitando tener que inferirlo solo de los datos?

## 9. Criterio de aceptación antes de permitir una vista previa/importador

Todo lo siguiente debe cumplirse — no basta con avanzar parcialmente:

1. Las 3 preguntas de homologación (`TIPO_CTA`, `CTACOM_CTA`, `MULTIP_CTA`,
   preguntas 1–3 de la sección 8) respondidas por el responsable contable,
   con evidencia (conteos reales de la herramienta actualizada) que respalde
   la interpretación acordada.
2. Regla explícita y aprobada para identificar cuentas de agrupación vs. de
   movimiento — y decisión de si/cómo se modela esa distinción en
   `cont_cuentas` (columna nueva, migración aditiva propuesta, nunca
   ejecutada sin autorización).
3. Regla explícita para naturaleza deudora/acreedora, si se decide que hace
   falta antes de importar saldos.
4. Confirmación de si existe (y dónde) un campo de cuenta padre real; si no
   existe, decisión explícita de cómo tratar la ausencia de jerarquía
   verificable (¿se importa plano? ¿se reconstruye por segmentos de
   `CODIGO_CTA`, previa validación de que el código realmente sigue esa
   convención en TODAS las cuentas?).
5. Ejecución real de la herramienta (actualizada, sección 7) contra las 3
   bases (KT/Mónaco actual/Mónaco histórico) y registro de sus resultados
   (aunque sea en un documento de seguimiento aparte, sin nombres/códigos de
   cuenta) — hoy no existe ningún resultado real documentado.
6. Todo lo anterior aprobado explícitamente por el responsable — no inferido
   ni asumido por esta sesión ni por ningún PR de código.

Sin estos 6 puntos, diseñar una vista previa de importación repetiría el
riesgo que Fase 1 ya advirtió: inventar equivalencias que no están
confirmadas por quien conoce el sistema origen.
