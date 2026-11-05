# Autoguardado local de borradores — hook, recuperación y coordinación entre pestañas (BORR-1c)

Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE** en la rama. No probado en navegadores reales ni en Hostinger, no desplegado, no
aprobado para producción. **No está conectado a ningún formulario oficial** (Solicitudes de fondo, Gastos operativos, Requerimientos de
compra): esa integración corresponde a BORR-1d, 1e y 1f. No hay SQL, endpoints ni sincronización con servidor.

## 1. Piezas

| Pieza | Archivo | Rol |
|---|---|---|
| Controlador | `src/lib/borradores/controlador.ts` | Lógica de autoguardado de UN borrador (usuario + empresa + tipo). Sin React. |
| Hook | `src/lib/borradores/use-borrador-local.ts` | `useBorradorLocal({ tipo, esquemaVersion, payload, … })`: capa fina de React. |
| Coordinación de salida | `src/lib/borradores/coordinacion.ts` | Suspende los autoguardados antes de la purga de cierre de sesión. |
| Canal entre pestañas | `src/lib/borradores/canal.ts` | `BroadcastChannel` opcional con degradación segura. |
| Textos | `src/lib/borradores/etiquetas.ts` | Funciones puras con todos los mensajes (es-GT). |
| Interfaz | `src/components/borradores/` | Indicador, diálogo de recuperación, advertencia de conflicto, advertencia de borrador, control «No guardar en este equipo», diálogo base accesible. |
| Demostración | `src/components/borradores/demo-autoguardado.tsx` | **Solo pruebas / demostración local.** No está montada en ninguna ruta. |

## 2. Estados y garantías

Fases: `sin_contexto`, `desactivado`, `consultando`, `decision_pendiente`, `en_espera`, `activo`, `conflicto`, `bloqueado`, `suspendido`,
`cerrado`. En `activo`, el estado visible reutiliza la máquina de BORR-1a: *Cambios pendientes → Guardando → Guardado*, o *Error al guardar*.

* **«Guardado» solo tras confirmar la transacción de IndexedDB.** El estado es «Guardando» mientras la confirmación no llega.
* **Debounce** configurable (800 ms por defecto) más un **tope máximo de espera** (5 s) para que la escritura continua no deje una
  ventana de pérdida larga.
* **Una sola escritura en vuelo.** Los cambios que llegan durante la escritura se guardan después, siempre la versión más reciente,
  encadenando la revisión base: una escritura antigua no puede sobrescribir a una más nueva (compare-and-set del núcleo).
* **Sin escrituras innecesarias:** el contenido se compara con lo último guardado; la primera lectura tras montar es la línea base y
  no se guarda por sí sola; un payload no serializable o inválido no se guarda y se muestra el error.
* **Flush** al ocultar la pestaña (`visibilitychange`) y en `pagehide`, y al desmontar (guardado de mejor esfuerzo dirigido al ámbito
  original). **No se usa `beforeunload`.** Nada de esto garantiza sobrevivir a un apagón inmediato: lo no confirmado por IndexedDB
  figura como «Cambios pendientes»/«Guardando» y no se promete.

## 3. Recuperación

Al abrir, se consulta el borrador del usuario/empresa/tipo. Nunca se restaura solo, y **mientras no se decide no se escribe** (no se
sobrescribe lo recuperable). Decisiones: *Recuperar* (si el formulario ya tiene contenido pide confirmar el reemplazo), *Descartar*
(segunda confirmación; `descartar({ confirmado: true })`) o *Decidir después* (el borrador queda intacto y el autoguardado de esa
sesión, en pausa).

| Situación | Recuperar | Descartar |
|---|---|---|
| Disponible | sí | sí (confirmando) |
| Expirado (> 14 días) | sí, con advertencia | sí |
| Esquema anterior | solo si el adaptador aporta `migrar`; se persiste migrado | sí |
| Esquema futuro (incompatible) | no (jamás se sobrescribe) | sí |
| Datos corruptos | no | sí |
| Ya enviado (`completado`) | no | sí |
| Envío sin resolver (`enviando`) | no | **no** (perdería la clave y permitiría duplicar) |

Los archivos adjuntos no se guardan y se avisa que deben solicitarse de nuevo.

## 4. Dos pestañas

El control definitivo es la **revisión atómica de IndexedDB**; el canal solo avisa. Una revisión obsoleta nunca sobrescribe: la pestaña
entra en **conflicto** (`revision_obsoleta`, `otra_pestana`, `descartado_en_otra_pestana`, `ya_no_existe`) y exige decidir: ver la
versión guardada (releer), usar la de la otra pestaña, o conservar la propia (segunda confirmación). **Nunca se fusiona.** Sin
`BroadcastChannel` se degrada: al volver a primer plano se revisa la revisión almacenada. No hay cerrojos ni líder: una pestaña cerrada
de forma inesperada no deja nada bloqueado.

## 5. Sesión, identidad y purga

* El ámbito sale del contexto autenticado (`useContextoBorradores()`); sin él, el autoguardado queda inactivo. Cada cambio de usuario,
  empresa, tipo o versión crea un controlador nuevo con su ámbito inmutable: lo pendiente del anterior se finaliza en SU ámbito (nunca
  en el nuevo) y el hook solo entrega el estado del ámbito vigente.
* La expiración de sesión y los 401 no limpian nada (BORR-1b); al volver a autenticarse se ofrece recuperar.
* **Marca de purga persistente (garantía definitiva contra escrituras tardías):** `purgarUsuario` escribe PRIMERO, en IndexedDB, una marca
  por propietario (`["__purga__", ownerKey]`, sin los campos indexados, así que ningún listado la ve) con una **época** que crece de
  forma estricta (`max(anterior + 1, ahora)`). Cada sesión (formulario) lee la época al empezar y la lleva en TODA escritura
  (`guardar` y `eliminar` con `epocaPurga`); el núcleo la compara **dentro de la misma transacción** de la escritura, mediante la lectura
  adicional `tambienLeer` del almacén: si la época almacenada es mayor, se rechaza con `purga_posterior`. Como las transacciones de
  escritura se serializan, toda escritura o bien se confirma ANTES de la marca (y entonces el listado de la purga la ve y la elimina) o
  bien se evalúa DESPUÉS (y se rechaza). No depende de BroadcastChannel ni de la memoria de ninguna pestaña, y una pestaña antigua
  queda bloqueada («Sesión anterior finalizada», con su contenido aún en pantalla) en su siguiente intento, incluso tras reintentos o
  al desmontarse. Una **sesión nueva** (otra carga del formulario tras autenticarse) lee la época vigente y guarda con normalidad: la
  marca nunca bloquea borradores legítimos posteriores. Si la marca no puede escribirse, la purga **no elimina nada** y falla de forma
  visible; si está dañada, las escrituras fallan cerradas hasta que la siguiente purga la repare. Cancelar la salida reanuda a las
  pestañas coordinadas (adoptan la época vigente); una pestaña que no recibió el aviso permanece bloqueada hasta recargarse (seguro).
* **Salida explícita con «borrar»:** antes de la purga, `suspenderEscriturasDe(ownerKey)` cancela los temporizadores, espera (con tope) a
  las escrituras en vuelo y avisa a las demás pestañas; así un guardado pendiente o tardío no recrea lo eliminado. Si la salida no
  ocurre, los controladores se reanudan y resincronizan sin recrear nada.
* **«No guardar en este equipo»:** la preferencia se consulta en CADA operación del almacén y se refleja al instante en esta pestaña
  (evento propio) y en las otras (`storage`).
* Contrato de envío (`claveEnvio`, `estadoEnvio`, `revision`, `borradorId`): se conserva tal cual. `registrarEnvio` y `resolverEnvio`
  existen solo como contrato para BORR-1d/1e/1f; **no se envía nada** y la clave **nunca se renueva sola**.

## 6. Limitaciones conocidas

* Un debounce no sobrevive a un apagón inmediato; el navegador puede no completar la escritura de `pagehide`/desmontaje.
* La marca de purga cubre a quien escribe con época (el controlador); un llamador heredado del núcleo que omita `epocaPurga` no queda
  protegido (solo el controlador escribe en producción, y una prueba lo fija). La marca es un registro pequeño por propietario que no se
  elimina nunca.
* Una pestaña antigua solo descubre la purga al intentar escribir (o al reactivar la persistencia desde otra pestaña); mientras tanto
  no hay riesgo de recreación, pero tampoco aviso. Si no se pudo leer la época al empezar, esa pestaña no escribe hasta «reintentar».
* Un borrador creado por una sesión **nueva** mientras otra pestaña aún purga se considera trabajo nuevo (`consentidoEn`); no se elimina.
* IndexedDB no cifra; el aislamiento por `ownerKey` es lógico.
* El payload debe ser JSON estable y memoizado; el formulario debe reiniciarse (`key`) al cambiar de ámbito.
* La confirmación inicial del cierre de sesión (conservar/borrar) sigue con `window.confirm`; la advertencia posterior a un borrado no
  confirmado ya es un diálogo propio. Unificarla requeriría ampliar el alcance.
* Sin pruebas en navegadores reales ni contra Hostinger (happy-dom + fake-indexeddb).
