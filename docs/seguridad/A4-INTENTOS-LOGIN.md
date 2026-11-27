# A4 — Protección contra intentos de login

Estado: **IMPLEMENTADO + VERIFICADO TÉCNICAMENTE** (MariaDB 11.8.9 desechable, pruebas unitarias y de rutas). **No instalado ni activado en producción.**
**SQL requerido: SÍ** (migración aditiva, aplicación MANUAL por el propietario). La aplicación **no** ejecuta SQL.

## Qué protege
Las tres rutas de login por usuario y contraseña, cada una con su propio alcance:

| Ruta | Alcance | Identificador |
|---|---|---|
| `POST /api/auth/login` | `staff` | `username` |
| `POST /api/portal/auth/login` | `colaborador` | `username` |
| `POST /api/cliente-portal/auth/login` | `cliente` | `email` |

No existe otra vía que verifique credenciales sin sesión: una prueba estática (`auth-intentos-rutas.test.ts`) exige que `verificarCredenciales*` solo se invoque desde esas tres rutas y **dentro** de `protegerLogin`. Fuera del alcance de este cambio (requieren una sesión ya autenticada): cambio de contraseña y reautenticación de firma (`verificarPasswordUsuarioActual`). La API M2M de PriceSmart tiene su propio limitador.

## Política (valores iniciales, configurables)
| Variable | Por defecto | Rango | Efecto |
|---|---|---|---|
| `AUTH_INTENTOS_PROTECCION` | (apagada) | `1` | Activa la protección. Cualquier otro valor la deja apagada. |
| `AUTH_INTENTOS_SECRETO` | — | ≥ 32 caracteres | Secreto del HMAC. **Propio**: no reutilizar `AUTH_SECRET`. Obligatorio con la protección activa. |
| `AUTH_INTENTOS_ID_MAX` | 5 | 3–50 | Fallos por identificador dentro de la ventana. |
| `AUTH_INTENTOS_VENTANA_S` | 900 | 60–86400 | Ventana de conteo (15 min). |
| `AUTH_INTENTOS_BLOQUEO_ID_BASE_S` / `_MAX_S` | 60 / 900 | — | Bloqueo progresivo del identificador: 1, 2, 4, 8 y 15 min como máximo. |
| `AUTH_INTENTOS_IP_MAX` | 30 | 10–1000 | Fallos por IP dentro de la ventana. |
| `AUTH_INTENTOS_BLOQUEO_IP_S` | 300 | 30–3600 | Bloqueo de la IP (fijo, corto). |
| `AUTH_INTENTOS_RETENCION_S` | 86400 | 3600–604800 | Filas inactivas sin bloqueo vigente se borran después de este tiempo. |
| `AUTH_INTENTOS_MAX_FILAS` | 200000 | — | Por encima, la limpieza recorta las filas más antiguas sin bloqueo vigente. |

Reglas:
- Los fallos se cuentan **exista o no** el identificador. Las respuestas son genéricas: 401 con el mensaje de siempre, 429 «Demasiados intentos» con `Retry-After`.
- Durante un bloqueo la contraseña **no** se verifica (tampoco la correcta) y el bloqueo **no** se alarga con nuevos intentos.
- Un login correcto borra el contador de su identificador, pero **no** el de la IP.
- Un identificador inexistente o inactivo ejecuta el mismo scrypt que uno real (`verificacionFicticia`), así que el tiempo de respuesta no revela si existe.
- Privacidad: la tabla guarda solo HMAC-SHA256 (hex) del identificador normalizado (NFKC, minúsculas, sin espacios externos) y de la IP. Nada en texto claro.

### IP de origen y NAT empresarial
- La IP es la **última** entrada de `X-Forwarded-For`, la que añade el proxy del alojamiento, o `X-Real-IP` si no hay. Sin una IP válida no se aplica el límite por IP, para no agrupar a todos en un contador. El límite por identificador sigue aplicándose.
- Una oficina detrás de un NAT comparte IP. El umbral es 30 fallos de **todas** sus personas en 15 minutos, y el bloqueo de IP dura solo 5 minutos. Las cuentas individuales no se bloquean por la IP. La prueba «IP COMPARTIDA» lo comprueba.
- Si una oficina grande lo alcanza con uso legítimo, sube `AUTH_INTENTOS_IP_MAX`.
- Si el proxy no añade `X-Forwarded-For`, un atacante podría variar ese valor y eludir **solo** el límite por IP; el del identificador se mantiene.

## Comportamiento ante fallos (falla cerrado)
Con la protección **activa**, cualquiera de estas situaciones produce una respuesta **503** genérica con `Retry-After: 60`:
- falta el secreto o es inválido;
- la tabla no existe;
- hay un error SQL o sin conexión al leer o registrar.

En esos casos no se verifica la contraseña ni se crea sesión. Se registra una línea `[auth-intentos] <alcance>: protección de login no disponible (<CÓDIGO> <code>/<errno>)`, sin usuario, IP ni mensaje del motor.

Con la protección **apagada** todo funciona como antes, aunque la tabla no exista.

## Procedimiento de instalación y activación (orden obligatorio)
1. **Despliegue del código con la protección APAGADA** (`AUTH_INTENTOS_PROTECCION` ausente). El comportamiento es idéntico al actual. Probar los tres logins.
2. **Preflight** (solo lectura): `sql/preflight-2026-12-auth-intentos-login.sql`. Verificar que la versión es 11.8.x, que `tabla_ya_existe_esperado_0` vale 0 y que la cuenta tiene `CREATE`.
3. **Migración** (manual, con autorización): `sql/migrate-2026-12-auth-intentos-login.sql`. La consulta final debe devolver 1 / 8 / 2.
4. **Postcheck** (solo lectura): `sql/postcheck-2026-12-auth-intentos-login.sql`. Todos los valores deben coincidir con el esperado del alias.
5. **Secreto:** crear `AUTH_INTENTOS_SECRETO` (≥ 32 caracteres aleatorios, por ejemplo 48 bytes en base64) en las variables de entorno del alojamiento. No se imprime ni se versiona.
6. **Activar:** `AUTH_INTENTOS_PROTECCION=1` y reiniciar la aplicación.
7. **Verificación posterior:**
   - un login correcto de cada portal da 200;
   - 5 contraseñas incorrectas con un usuario de prueba dan 401 ×5 y luego 429 con `Retry-After`;
   - en la tabla aparecen filas con `clave` de 64 hex;
   - no hay líneas `[auth-intentos]` en el registro.
8. **Si algo falla:** quitar `AUTH_INTENTOS_PROTECCION` y reiniciar. Vuelve el comportamiento anterior sin tocar la base.

**Reversión completa:** primero el paso 8. Después, opcionalmente, `sql/rollback-2026-12-auth-intentos-login.sql`. No ejecutar el rollback con la protección activa: el login respondería 503.

**Desbloqueo manual de emergencia** (soporte):
```sql
DELETE FROM auth_intentos_login WHERE tipo = 'ID' AND bloqueado_hasta > UTC_TIMESTAMP(6);
```
Desbloquea **todas** las cuentas bloqueadas (no las IP). Para una sola cuenta hace falta su HMAC; este cambio no incluye una herramienta para calcularlo.

## Concurrencia y crecimiento
- Cada fallo actualiza la clave del identificador y luego la de la IP, cada una en **su propia transacción**: `INSERT … ON DUPLICATE KEY UPDATE` más `SELECT … FOR UPDATE`, con reintentos ante 1020/1205/1213.
- Nunca se sostienen dos filas a la vez, así que no hay interbloqueos entre instancias. Todo el tiempo sale del reloj de la base (`UTC_TIMESTAMP(6)`).
- La limpieza se ejecuta en ~2 % de los fallos y borra como máximo 1000 filas por pasada; nunca borra bloqueos vigentes.
- En reposo, la tabla contiene como máximo las claves con actividad en las últimas 24 horas.

## Riesgos residuales
- Cuentas con hash legado sha256: la verificación real es más rápida que el scrypt ficticio. Se migran a scrypt en su próximo login correcto.
- El bloqueo de una IP compartida afecta a todos sus usuarios durante 5 minutos (ver NAT).
- Cambio de contraseña y reautenticación de firma no tienen límite propio; requieren una sesión válida.
- Los mensajes de error 500 de las rutas de staff y colaboradores (ya existentes) describen la configuración de la base al usuario; no se cambiaron aquí.
