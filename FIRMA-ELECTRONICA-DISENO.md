# Firma electrónica interna — diseño técnico (PORTAL-HARDENING-2, Fase H)

Estado: **DISEÑO CERRADO, NO IMPLEMENTADO.** Ninguna tabla, endpoint ni UI de
este documento existe todavía. No ejecutar el SQL propuesto sin
autorización explícita — ver `sql/propuesta-2026-08-firma-electronica.sql`
(archivo de referencia, NO aplicado).

## 1. Objetivo

Base transaccional segura para firmar electrónicamente acciones sensibles
del sistema (cierre de viaje, autorización de descuento RRHH, pago de
multa, autorización de viáticos, futuras facturas/compras), sin depender
de una imagen de firma manuscrita como único mecanismo de seguridad. Este
PR **no activa firma en ninguna acción real** — solo deja lista la base
para activarla módulo por módulo en tickets futuros.

## 2. Qué NO es esta fase

- No es una integración con un Prestador de Servicios de Certificación
  autorizado en Guatemala (Firma Electrónica Avanzada). Ver sección 8.
- No reemplaza la autenticación de sesión existente — es una
  **reautenticación puntual** para un acto específico, adicional al login.
- No se activa en ninguna acción existente todavía (cerrar viaje, RRHH,
  multas siguen funcionando exactamente igual que hoy).

## 3. Registro de firma — qué se guarda por cada firma

Cada firma queda asociada a:

| Campo | Origen | Notas |
|---|---|---|
| `empresa_id` | sesión del servidor | nunca del cliente — aislamiento multiempresa |
| `usuario_id` | sesión del servidor (staff) | NULL si quien firma es un colaborador del Portal sin cuenta `usuarios` |
| `empleado_id` | sesión del servidor (Portal) | NULL si quien firma es staff sin ficha de empleado vinculada |
| `accion` | fijo por el endpoint que la invoca | p.ej. `cerrar_viaje`, `autorizar_descuento_rrhh`, `pagar_multa` |
| `modulo` | fijo por el endpoint | p.ej. `tms`, `rrhh`, `multas` |
| `entidad_tipo` / `entidad_id` | fijo por el endpoint | p.ej. `plan_viaje` / 123 |
| `fecha_hora_servidor` | `NOW()` del servidor | NUNCA la hora del cliente |
| `hash_payload` | calculado en el servidor | SHA-256 del payload canónico (sección 4) |
| `payload_canonico` | calculado en el servidor | el JSON exacto que se hasheó — se guarda completo para poder verificar/auditar el hash después, no solo confiar en él |
| `sesion_id` | sesión del servidor, si existe | identificador de sesión ya existente en la arquitectura, si aplica |
| `ip` | request del servidor | si la arquitectura ya la registra en algún punto equivalente |
| `user_agent` | header del request | opcional |
| `metodo` | `'PASSWORD'` o `'PIN'` | cuál mecanismo de reautenticación se usó |
| `resultado` | `'EXITOSA'` o `'FALLIDA'` | intentos fallidos de reautenticación también se registran (control de fuerza bruta), pero un intento FALLIDA nunca autoriza la acción sensible |
| `codigo_firma` | generado por el servidor | identificador legible único, p.ej. `SIG-2026-000123` |
| `version` | fijo | versión del formato de payload firmado, para poder evolucionar el esquema sin romper firmas antiguas |

Identidad del firmante: exactamente uno de `usuario_id`/`empleado_id` debe
estar presente (regla de aplicación, no CHECK de MySQL — evita depender de
una versión de MySQL con soporte completo de CHECK).

## 4. Hash del payload — qué se firma realmente

`hash_payload = SHA-256(payload_canonico)`, donde `payload_canonico` es un
JSON con claves ordenadas alfabéticamente y sin espacios, construido por
el propio backend (nunca aceptado del cliente), con al menos:

```json
{
  "accion": "cerrar_viaje",
  "empresaId": 7,
  "entidadId": 123,
  "entidadTipo": "plan_viaje",
  "fechaHoraServidor": "2026-08-27T14:50:00-06:00",
  "valoresRelevantes": { "estadoAnterior": "En ruta", "estadoNuevo": "Cerrado" },
  "version": "1"
}
```

`valoresRelevantes` lo define cada acción sensible al activarla (p.ej.
para pagar una multa: monto, referencia; para autorizar un descuento:
monto por cuota, número de cuotas) — es lo que hace que la firma sea
verificable contra lo que realmente ocurrió, no solo "alguien firmó algo".

## 5. Reautenticación — PIN vs contraseña

Se evaluaron dos mecanismos; **se recomienda PIN de firma independiente**
sobre reingresar la contraseña de sesión:

- **Contraseña de sesión**: más simple de implementar (reutiliza el
  verificador de contraseña ya existente), pero mezcla "estoy en mi
  sesión" con "estoy autorizando este acto específico" — y en el Portal
  del piloto, la sesión de colaborador puede no tener contraseña en el
  mismo sentido que un usuario de staff.
- **PIN de firma independiente (recomendado)**: un PIN corto (4-6 dígitos)
  configurado aparte de la contraseña, exclusivo para firmar. Nunca se
  guarda en texto plano — se hashea con el mismo mecanismo ya usado en el
  proyecto para contraseñas (reutilizar, no inventar criptografía nueva).
  Bloqueo temporal tras N intentos fallidos (`intentos_fallidos` /
  `bloqueado_hasta` en `firma_pins`, sección 6).

El modal de firma ("Firmar electrónicamente") pide el PIN (o contraseña,
según lo que se decida activar), y el backend valida ANTES de ejecutar la
acción sensible — nunca al revés.

## 6. Tablas propuestas (NO aplicadas — ver sección 1)

```sql
CREATE TABLE IF NOT EXISTS firmas_electronicas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  usuario_id INT NULL,
  empleado_id INT NULL,
  accion VARCHAR(60) NOT NULL,
  modulo VARCHAR(40) NOT NULL,
  entidad_tipo VARCHAR(60) NOT NULL,
  entidad_id INT NOT NULL,
  fecha_hora_servidor DATETIME NOT NULL,
  hash_payload CHAR(64) NOT NULL,
  payload_canonico TEXT NOT NULL,
  sesion_id VARCHAR(128) NULL,
  ip VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  metodo VARCHAR(20) NOT NULL,
  resultado ENUM('EXITOSA','FALLIDA') NOT NULL DEFAULT 'EXITOSA',
  codigo_firma VARCHAR(30) NOT NULL,
  version VARCHAR(10) NOT NULL DEFAULT '1',
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_firma_codigo (codigo_firma),
  INDEX idx_firma_entidad (empresa_id, entidad_tipo, entidad_id),
  INDEX idx_firma_accion (empresa_id, accion, creado_en),
  CONSTRAINT fk_firma_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_firma_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE SET NULL,
  CONSTRAINT fk_firma_empleado FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE IF NOT EXISTS firma_pins (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  usuario_id INT NULL,
  empleado_id INT NULL,
  pin_hash VARCHAR(255) NOT NULL,
  intentos_fallidos INT NOT NULL DEFAULT 0,
  bloqueado_hasta DATETIME NULL,
  actualizado_en DATETIME NOT NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pin_usuario (empresa_id, usuario_id),
  UNIQUE KEY uq_pin_empleado (empresa_id, empleado_id),
  CONSTRAINT fk_pin_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_pin_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios(id) ON DELETE CASCADE,
  CONSTRAINT fk_pin_empleado FOREIGN KEY (empleado_id) REFERENCES empleados(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

Notas de índices/seguridad:
- `hash_payload`/`payload_canonico` nunca se actualizan tras el INSERT —
  la tabla es de solo-inserción (append-only) a nivel de aplicación; no se
  expone ningún UPDATE/DELETE de firmas desde la UI.
- `codigo_firma` es lo único que se muestra al usuario final (además de
  fecha/firmante) — el hash es para verificación técnica/auditoría, no
  para mostrarlo completo en pantalla salvo a un Admin.
- `firma_pins` es una tabla separada de `usuarios`/`empleados` — el PIN
  nunca convive con el hash de la contraseña de sesión, para que
  comprometer uno no comprometa el otro.

## 7. Atomicidad y auditoría

Regla dura: **nunca "acción realizada pero firma falló"**. Cuando una
acción sensible active firma:

1. Validar PIN/contraseña (fuera de la transacción de negocio — un PIN
   incorrecto no debe ni empezar a tocar la tabla de negocio).
2. Si es válido: dentro de la MISMA transacción que ejecuta la acción de
   negocio (p.ej. cerrar el viaje), insertar la fila en
   `firmas_electronicas` y hacer el cambio de negocio — commit conjunto o
   rollback conjunto (mismo patrón `conn` ya usado en
   `cerrarDescuentoInterno`/`crearDescuentoDesdeMulta`/etc. de este
   proyecto).
3. Auditoría existente (`auditoria`) sigue registrando el evento de
   negocio como hoy, y adicionalmente puede referenciar `codigo_firma` en
   su `detalle` para trazabilidad cruzada, sin duplicar el registro.

## 8. Firma Electrónica Avanzada (Guatemala) — punto de integración futuro

Este diseño es firma electrónica **interna/transaccional** (prueba de que
un usuario autenticado, en un momento dado, con una reautenticación
puntual, autorizó una acción con un hash verificable) — NO es Firma
Electrónica Avanzada bajo la Ley para el Reconocimiento de las
Comunicaciones y Firmas Electrónicas de Guatemala, que requiere un
certificado emitido por un Prestador de Servicios de Certificación
autorizado. Cuando el negocio decida necesitar valor legal pleno (p.ej.
para contratos o facturas ante SAT), el punto de integración futuro sería:
sustituir/complementar el hash interno por una firma criptográfica emitida
por ese prestador sobre el mismo `payload_canonico`, guardando el
certificado/referencia en un campo adicional de `firmas_electronicas`
(diseño NO detallado aquí — requiere elegir proveedor autorizado, fuera de
alcance de este ticket). **No se inventan certificados propios.**

## 9. Acciones candidatas a activar firma (ninguna activada en este PR)

- Cerrar viaje (`viajes_cerrar:editar`)
- Autorizar viáticos
- Autorizar descuento RRHH (vínculo multa→planilla)
- Pago de multa
- Futuras facturas / compras / autorizaciones

Activar firma en cualquiera de estas es una decisión de negocio (impacto
en el flujo de usuarios, no solo técnico) y debe pedirse explícitamente
ticket por ticket.

## 10. Permisos y lifecycle

- Lectura de `firmas_electronicas` (para mostrar "Firmado por: ... /
  código: ... / hash: ...") reutilizaría el mismo permiso que ya protege
  la entidad firmada (p.ej. ver el viaje) — no se crea un permiso nuevo
  solo para leer firmas.
- Configurar el propio PIN (`firma_pins`) requeriría un endpoint nuevo,
  protegido por sesión propia (usuario/colaborador configura SU PIN,
  nunca el de otro) — no diseñado en detalle en esta fase.
- No hay borrado de firmas desde la aplicación — son un registro legal
  de auditoría; su ciclo de vida termina solo si la empresa se elimina
  (`ON DELETE CASCADE` vía `empresa_id`), igual que el resto de tablas
  operativas de este proyecto.
