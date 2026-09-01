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
| `TIPO_CTA` | `N` (numérico, sin decimales) | Se cuenta su distribución (`tipos_origen`); evidencia real (sección 4.1): exactamente {1,2,3,4,5} en las tres bases. Significado sin asumir. |
| `NIVEL_CTA` | `N` | Se valida que sea entero ≥ 1 (`incidencias.nivel_invalido`); se cuenta su distribución (`niveles_origen`). Evidencia real: exactamente {1,2,3,4,5} en las tres bases. |
| `LINACTIVA_` | `L` (lógico) | Se invierte a `activa` únicamente como booleano (`true`/`false`/`null` → `estado_desconocido`); el NOMBRE del campo sugiere "línea inactiva", pero esa lectura del nombre no ha sido confirmada por el responsable. Evidencia real: 0 cuentas inactivas y 0 `estado_desconocido` en las tres bases. |
| `CTACOM_CTA` | `L` | Leído desde Fase 1; su distribución ya se reporta (`ctacom_origen`, PR #159). Evidencia real: `false` en el 100% de las cuentas de las tres bases (ver sección 4.1/4.2). |
| `MULTIP_CTA` | `N` | Igual que arriba (`multip_origen`, PR #159). Evidencia real: exactamente {1,-1} en las tres bases. |

No hay ningún otro campo de `co01.dbf` incorporado a la herramienta (no se ha
inspeccionado, por ejemplo, un posible campo de cuenta padre/agrupadora — ver
sección 5). El lector rechaza cualquier DBF que no sea VFP `0x30` / Windows-1252
(marca `0x03`); la herramienta ya se ejecutó contra las tres bases reales y su
salida (agregada, sin nombres/códigos de cuenta) está incorporada en este
documento — ver sección 4.

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

**Actualización con evidencia real.** El usuario ejecutó `revisar-cuentas.mjs`
(versión con `ctacom_origen`/`multip_origen`, PR #159 fusionado en
`256f6e16b3bdb7acb411e7393e09ce187a3ede3f`) contra las tres bases reales y
compartió el JSON completo de las tres corridas — nunca los DBF, nunca
nombres/códigos de cuenta. Esto reemplaza la ausencia de evidencia que
señalaba la versión anterior de este documento: ya HAY conteos reales, pero
siguen siendo solo **distribuciones agregadas**, no una interpretación
semántica confirmada.

### 4.1 Evidencia real — comparativa KT / Mónaco actual / Mónaco histórico

| | KT (01, BASES001) | Mónaco actual (08, BASES008) | Mónaco histórico (00, BASES000) |
| --- | --- | --- | --- |
| Registros vigentes | 658 | 618 | 574 |
| Marcados borrados | 0 | 0 | 0 |
| Inactivos (`LINACTIVA_`) | 0 | 0 | 0 |
| Incidencias (las 8 categorías) | todas 0 | todas 0 | todas 0 |
| `TIPO_CTA=1` | 176 | 164 | 154 |
| `TIPO_CTA=2` | 109 | 98 | 88 |
| `TIPO_CTA=3` | 18 | 18 | 17 |
| `TIPO_CTA=4` | 36 | 36 | 24 |
| `TIPO_CTA=5` | 319 | 302 | 291 |
| `NIVEL_CTA=1` | 8 | 8 | 7 |
| `NIVEL_CTA=2` | 18 | 18 | 17 |
| `NIVEL_CTA=3` | 47 | 46 | 43 |
| `NIVEL_CTA=4` | 75 | 73 | 70 |
| `NIVEL_CTA=5` | 510 | 473 | 437 |
| `CTACOM_CTA=false` | 658 (100%) | 618 (100%) | 574 (100%) |
| `CTACOM_CTA=true` | 0 | 0 | 0 |
| `MULTIP_CTA=1` | 495 | 466 | 445 |
| `MULTIP_CTA=-1` | 163 | 152 | 129 |
| SHA-256 `co01.dbf` | `d091ec9c...ed4fb0` | `e1a1c0a0...447b4eb` | `ead94686...16ecace` |

La huella SHA-256 de `s02.dbf` (catálogo de empresas) fue **idéntica en las
tres ejecuciones** (`96d0b428...e2ade3bbd`) — consistente con que las tres
corridas leyeron el mismo archivo de empresas compartido entre las tres
carpetas, tal como espera `revisar-cuentas.mjs` (`s02.dbf` vive en la raíz,
`co01.dbf` dentro de cada carpeta `BASES00X`).

### 4.2 Qué podemos afirmar TÉCNICAMENTE ahora (con evidencia real)

| Campo | Confirmado por esta evidencia | Sigue SIN poder afirmarse |
| --- | --- | --- |
| `TIPO_CTA` | El conjunto de valores observados es **exactamente {1, 2, 3, 4, 5}** en las tres bases reales — sin valores fuera de ese rango, sin `sin_valor` (NULL). Las frecuencias varían por base pero la distribución relativa es similar (p. ej. el valor 5 es siempre el más frecuente en las tres). | Qué significa cada valor (¿Activo/Pasivo/Capital/Ingreso/Gasto en algún orden? ¿otra clasificación?); si el orden/mapeo es el mismo en las tres bases (los conteos por sí solos no lo prueban). |
| `NIVEL_CTA` | El conjunto de valores observados es **exactamente {1, 2, 3, 4, 5}** en las tres bases, sin `sin_valor`. El nivel 5 concentra la mayoría de cuentas en las tres (510/658, 473/618, 437/574) — consistente con una estructura donde los niveles bajos son pocas cuentas "resumen" y el nivel más profundo es donde vive la mayoría del catálogo. | Si el nivel numérico corresponde a profundidad real de jerarquía o es solo una etiqueta; sigue sin existir un campo de cuenta padre observado (ver sección 5) — la distribución por sí sola no reconstruye el árbol. |
| `CTACOM_CTA` | **Es `false` en el 100% de las cuentas de las tres bases** (658/658, 618/618, 574/574) — ni un solo `true`, ni un solo `sin_valor`. Con esta evidencia, `CTACOM_CTA` **NO sirve para discriminar cuentas dentro de estos tres catálogos** (no separa ningún subconjunto: todas comparten el mismo valor). | Por qué el campo existe si nunca varía en estas tres bases (¿es un campo heredado sin uso actual? ¿solo varía en otras tablas o versiones de Milenium que no se han inspeccionado?) — no asumir que "siempre false" significa "no importa" sin que el responsable lo confirme. |
| `MULTIP_CTA` | El conjunto de valores observados es **exactamente {1, -1}** en las tres bases — sin ceros, sin otros valores, sin `sin_valor`. La proporción `1`/`-1` es similar en las tres (~75%/~25%). | Si `1`/`-1` representa naturaleza deudora/acreedora, signo de presentación en reportes, o alguna otra regla — la evidencia técnica (dos valores opuestos) es **consistente con** una hipótesis de signo, pero no la confirma; sigue siendo una hipótesis hasta que el responsable la valide. |

**Ninguna fila de esta tabla pasa a `CONFIRMADO` en la matriz de homologación
(sección 6) por tener ahora evidencia técnica real — la evidencia reduce la
incertidumbre sobre el RANGO de valores, pero no resuelve su SIGNIFICADO
contable, que sigue dependiendo del responsable.**

## 5. ¿`NIVEL_CTA` permite reconstruir jerarquía por sí solo?

**No — confirmado también con la evidencia real de la sección 4.1.** Los
valores observados (exactamente {1,2,3,4,5} en las tres bases, concentrados
mayoritariamente en el nivel 5) son consistentes con una estructura de
profundidad, pero un entero de profundidad por sí solo NO identifica:

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
| `LINACTIVA_` | `cont_cuentas.activa` (invertido) | **PROPUESTO / REQUIERE VALIDACIÓN** | Técnicamente trivial invertir un booleano; evidencia real: 0 inactivas y 0 `estado_desconocido` en las 3 bases (sección 4.1) — sin casos reales todavía para confirmar que la inversión produce el resultado esperado. Falta confirmar con el responsable que "línea inactiva" equivale exactamente a "cuenta no utilizable" en destino. |
| `NIVEL_CTA` | `cont_cuentas.nivel` | **PROPUESTO / REQUIERE VALIDACIÓN** | Copiar el entero es trivial; evidencia real confirma el rango {1..5} en las 3 bases (sección 4.2), pero su SIGNIFICADO (profundidad real, consistencia entre bases) sigue sin confirmar, y por sí solo no reconstruye jerarquía (sección 5). |
| `TIPO_CTA` | `cont_cuentas.tipo` (Activo/Pasivo/Capital/Ingreso/Gasto) | **SIN EQUIVALENCIA** | Evidencia real confirma el rango exacto {1,2,3,4,5} en las 3 bases (sección 4.2) — coincide en CANTIDAD con los 5 valores destino, pero eso NO prueba una correspondencia 1:1; no existe diccionario de valores confirmado; no inferir del rango numérico observado. |
| `CTACOM_CTA` | (sin columna destino hoy) | **SIN EQUIVALENCIA / NO IMPORTAR TODAVÍA** | Evidencia real: `false` en el 100% de las cuentas de las 3 bases (sección 4.2) — con este dato el campo NO discrimina nada dentro de estos catálogos. El destino tampoco distingue agrupación de movimiento; incluso si se confirma el significado origen, falta decidir cómo (o si) modelarlo en destino. |
| `MULTIP_CTA` | (sin columna destino hoy, posible naturaleza) | **SIN EQUIVALENCIA** | Evidencia real confirma el rango exacto {1,-1} en las 3 bases (sección 4.2) — consistente con una hipótesis de signo, pero no la confirma. El destino tampoco tiene columna de naturaleza deudora/acreedora hoy. |
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

El usuario ya ejecutó `node scripts/milenium/revisar-cuentas.mjs <ruta>
KT|MONACO|MONACO_HISTORICO` con esta versión contra las tres bases reales;
el JSON de esas tres corridas es la evidencia incorporada en la sección 4.1.

## 8. Preguntas concretas para el responsable contable / Milenium

**Reducidas tras la evidencia real de la sección 4** — se retiran las
preguntas que la evidencia ya respondió técnicamente (por ejemplo, el rango
exacto de valores de cada campo, o si hay `LINACTIVA_` en blanco: no lo hay
en ninguna de las 3 bases) y quedan únicamente las que siguen abiertas porque
dependen de significado/negocio, no de datos:

1. ¿Qué significa exactamente cada valor `TIPO_CTA` 1, 2, 3, 4, 5 en Milenium?
2. ¿`MULTIP_CTA=1` y `MULTIP_CTA=-1` representan naturaleza deudora/acreedora,
   signo de presentación, u otra regla?
3. ¿Qué determina en Milenium si una cuenta es de movimiento o solo de
   agrupación? (Con la evidencia real, `CTACOM_CTA` es `false` en el 100% de
   las cuentas de las tres bases — no sirve para responder esto por sí solo.)
4. ¿Existe en `co01.dbf` u otra tabla un campo que identifique cuenta padre o
   jerarquía explícita?
5. ¿`LINACTIVA_=true` significa exactamente que una cuenta no puede
   utilizarse en partidas?
6. ¿Estas reglas son iguales para KT, Mónaco actual y Mónaco histórico? (La
   evidencia real muestra que las TRES bases usan el mismo rango de valores
   en los 4 campos — {1..5}/{1..5}/{false}/{1,-1} — pero eso no prueba que el
   SIGNIFICADO de cada valor sea idéntico entre bases.)

## 9. Criterio de aceptación antes de permitir una vista previa/importador

Todo lo siguiente debe cumplirse — no basta con avanzar parcialmente:

1. Las preguntas de homologación semántica (`TIPO_CTA`, `MULTIP_CTA`,
   `CTACOM_CTA`/agrupación-movimiento — preguntas 1–3 de la sección 8)
   respondidas por el responsable contable. La evidencia real (sección 4) ya
   fija el RANGO exacto de valores; falta su SIGNIFICADO.
2. Regla explícita y aprobada para identificar cuentas de agrupación vs. de
   movimiento — y decisión de si/cómo se modela esa distinción en
   `cont_cuentas` (columna nueva, migración aditiva propuesta, nunca
   ejecutada sin autorización). Con la evidencia real, `CTACOM_CTA` no puede
   ser la respuesta (siempre `false` en las 3 bases) — hace falta otra fuente.
3. Regla explícita para naturaleza deudora/acreedora, si se decide que hace
   falta antes de importar saldos.
4. Confirmación de si existe (y dónde) un campo de cuenta padre real; si no
   existe, decisión explícita de cómo tratar la ausencia de jerarquía
   verificable (¿se importa plano? ¿se reconstruye por segmentos de
   `CODIGO_CTA`, previa validación de que el código realmente sigue esa
   convención en TODAS las cuentas?).
5. ~~Ejecución real de la herramienta contra las 3 bases y registro de sus
   resultados~~ — **CUMPLIDO en esta entrega** (sección 4.1): las tres
   corridas reales (KT/Mónaco actual/Mónaco histórico) están documentadas,
   sin nombres/códigos de cuenta, con huella SHA-256 de cada `co01.dbf`.
6. Todo lo anterior aprobado explícitamente por el responsable — no inferido
   ni asumido por esta sesión ni por ningún PR de código.

El punto 5 ya está resuelto; los puntos 1–4 y 6 (significado semántico,
decisión de modelo, aprobación del responsable) **siguen pendientes**. Sin
ellos, diseñar una vista previa de importación repetiría el riesgo que Fase 1
ya advirtió: inventar equivalencias que no están confirmadas por quien conoce
el sistema origen — tener el RANGO de valores no es tener su SIGNIFICADO.
