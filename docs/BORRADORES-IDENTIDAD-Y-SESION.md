# Borradores locales — identidad autenticada y política de sesión (BORR-1b)

Estado: **IMPLEMENTADO y VERIFICADO TÉCNICAMENTE** en la rama. No probado en navegadores reales, no desplegado, no aprobado para
producción. BORR-1b **no activa** el autoguardado de ningún formulario (Solicitudes de fondo, Gastos, Requerimientos de compra).

## 1. `ownerKey`

Identificador opaco del propietario de un borrador local. Lo calcula **el servidor** (`src/lib/borradores/owner-key.ts`, solo
servidor) y llega al cliente en `EmpresaSessionProvider` (layout `/e/[slug]` → `AppShell` → provider). El navegador nunca lo
deriva ni lo elige.

```
ownerKey = "o1_" + base64url( HMAC-SHA256( HKDF-SHA256(secreto, salt="novalvion/borradores", info="owner-key/v1"), "usuario:<id>" ) )
```

* `<id>` es el **id interno** de `usuarios` (`session.id`); nunca el `username` (puede cambiar) ni el JWT.
* Determinista: mismo usuario → mismo `ownerKey` en cada inicio de sesión, empresa y equipo. Usuarios distintos → distintos.
* No contiene ni permite recuperar el id, el secreto ni datos del JWT. `o1_` versiona el algoritmo.
* Contexto entregado al cliente: solo `{ ownerKey, empresaId, empresaSlug }`, con la empresa ya validada por el layout.

### Fuente del secreto y configuración (Hostinger)

| Prioridad | Variable | Requisito | Notas |
|---|---|---|---|
| 1 | `BORRADORES_OWNER_SECRET` | **Opcional**, ≥ 32 caracteres, aleatorio | Clave dedicada. Si está definida pero es inválida **no** se cae a `AUTH_SECRET` (rotaría los `ownerKey` sin aviso): la función queda desactivada. |
| 2 | `AUTH_SECRET` | ≥ 16 caracteres (ya obligatorio en producción) | Se usa solo mediante HKDF (separación de dominio); nunca directamente. |

* **No se agrega ninguna variable obligatoria.** En producción `AUTH_SECRET` ya existe; no hace falta tocar Hostinger.
* Sin secreto adecuado (p. ej. desarrollo local sin `AUTH_SECRET`), `ownerKey` es `null` y los borradores quedan **desactivados**.
  Nunca se usa un valor efímero ni público; se rechazan los valores públicos conocidos (respaldo de desarrollo y ejemplos).
* El secreto no se registra ni aparece en errores. No guardar `BORRADORES_OWNER_SECRET` en el repositorio.
* Recomendación opcional: definir `BORRADORES_OWNER_SECRET` (p. ej. `openssl rand -base64 48`) para desacoplar los borradores de
  la rotación de `AUTH_SECRET`.

### Implicaciones de rotar el secreto

Cambiar la clave efectiva cambia **todos** los `ownerKey`. Los borradores locales ya guardados siguen en IndexedDB pero dejan de ser
alcanzables por su dueño (no se pierden ni se muestran a otros; caducan a los 14 días). Rotar `AUTH_SECRET` además cierra todas las
sesiones. Para evitar el efecto sobre los borradores: definir `BORRADORES_OWNER_SECRET` **antes** de rotar `AUTH_SECRET` y mantenerlo.

## 2. Política de sesión y limpieza local

| Evento | Qué ocurre con los borradores locales |
|---|---|
| Apagón / cierre inesperado del navegador | Se conservan. |
| **Expiración de sesión** (inactividad, 401) | Se conservan; no hay limpieza. Quedan aislados por `ownerKey`: el siguiente usuario del equipo no los ve; el dueño los recupera al volver a entrar. |
| **Salir explícitamente** (menú de cuenta, selector de empresa) con borradores | Se muestra una decisión informada: *conservar* (por defecto), *borrar* (equipo compartido, **irreversible**: aún no hay respaldo en servidor) o *cancelar* la salida. Ante cualquier duda se conserva. |
| Salir sin borradores / sin `ownerKey` | Sin preguntas. |
| Error o lentitud de IndexedDB en la **consulta previa** (solo lectura) | La salida no se bloquea (3 s máx.); no se pidió destruir nada y no se toca nada. |
| **Borrar elegido y no confirmado por completo** (parcial, error, plazo vencido, resultado incierto) | La salida **NO continúa en silencio**: aparece una advertencia con lo ocurrido y tres opciones: *Reintentar eliminación*, *Salir* (conservando lo que pueda quedar; si el resultado es incierto la etiqueta es «Salir sin confirmar el estado de los borradores») o *Cancelar salida*. Sin decisión, o si la interfaz falla, la salida se cancela. «Borrados» solo se informa con todas las transacciones confirmadas. |
| «No guardar en este equipo» | Con confirmación, desactiva la persistencia (preferencia no sensible en `localStorage`, por equipo) y elimina **solo** los borradores del usuario. Si el borrado falla, queda desactivada con residuos informados; si no se puede guardar la preferencia, no se borra nada. |

La salida por expiración la dispara `SessionInactivityGuard` mediante `cerrarSesion`, que **no** invoca la limpieza. La limpieza se
engancha solo en los dos puntos de salida explícita mediante `permitirSalidaExplicita()` (`session-navigation.ts`), registrado por
`RegistroSalidaBorradores`.

### Excepciones inesperadas durante la salida

La política clasifica cualquier excepción por **fase**:

* **Antes de que el usuario autorice borrar** (consulta previa de solo lectura, interfaz de consentimiento): no se pidió destruir
  nada → la salida puede continuar sin borrar (`consulta_fallida`).
* **Durante o después de autorizar el borrado** (la purga, la interpretación de su resultado, la propia advertencia): el resultado
  es **incierto** (`error_inesperado`). Se advierte con el mismo diálogo (sin afirmar que los borradores siguen intactos ni que se
  borraron; se informa el progreso confirmado cuando existe) y la salida **no continúa** salvo que el usuario elija «Salir sin
  confirmar el estado de los borradores». Sin interfaz de advertencia, o si ésta falla, la salida se cancela.
* La preparación del almacenamiento (antes de leer o borrar) puede fallar sin bloquear la salida; una excepción que escapara de
  toda la política (defecto) se trata como incierta: se advierte y, sin decisión, se cancela.
* El informe de una purga que rechaza usa el **progreso registrado** (borrados ya confirmados), no «cero».

### Cancelación de la purga y resultados

`purgarUsuario(ownerKey, { signal, consentidoEn, alProgresar })` implementa una **cancelación cooperativa** con `AbortSignal`:

* Cada operación (consulta y borrado) tiene un plazo de 3 s. Al vencer se **cancela** la purga: no se inicia ninguna eliminación
  nueva, y una transacción que aún no ejecutó su decisión **ya no borra** (la señal se comprueba también dentro de la decisión
  transaccional). Se espera una gracia de 0,5 s a que la purga informe su estado real.
* Una transacción que **ya emitió su borrado** no puede revertirse: se confirmará aunque se cancele. Por eso el resultado se
  informa como **incierto** (`indeterminados`) y la advertencia no promete conservación ni afirma haber borrado.
* Resultados distintos: *completo y confirmado*, *parcial* (conocido), *fallido* (error de almacenamiento), *tiempo agotado*
  (con o sin operación en vuelo), *conservación voluntaria* y *cancelación de la salida*. El resumen cuenta `eliminados`,
  `fallidos`, `cambiados`, `pendientes` e `indeterminados`.
* Solo se borra la **misma versión** que se listó (`borradorId` + revisión): una versión creada o editada después se conserva
  (`cambiados`). `consentidoEn` excluye además todo lo guardado tras el consentimiento, también en los reintentos.
* Si el usuario vuelve a iniciar sesión mientras una purga cancelada sigue en cola, esa operación ya no borra (cancelada) y, de
  hacerlo, la comparación de versión protege cualquier borrador nuevo.

Nunca se eliminan borradores de otros usuarios; el borrado por usuario usa el índice `ownerKey` y revalida en la transacción.
Los borradores **vencidos de otros usuarios** del mismo navegador permanecen hasta que su dueño vuelva (no se borran ajenos).

## 3. Limitaciones asumidas

* IndexedDB **no cifra** ni aísla con fuerza a usuarios del mismo perfil del navegador: el aislamiento por `ownerKey` es lógico.
* El diálogo inicial de consentimiento (conservar / borrar) usa `window.confirm` (marcador de posición); la advertencia posterior a un borrado no confirmado ya es un diálogo propio (`alertdialog`). BORR-1c/1d unificarán ambos.
* La cancelación es **cooperativa**: no revierte una transacción de borrado ya emitida (resultado incierto, informado como tal).
* Ningún formulario guarda borradores aún: hoy la política es inerte hasta que un adaptador escriba.
* La preferencia «No guardar en este equipo» no tiene aún interfaz para activarla (solo la lógica y sus pruebas).
