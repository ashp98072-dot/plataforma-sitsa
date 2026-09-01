-- CLIENTE-PORTAL-1-MODELO-USUARIOS-AUTH — modelo base del Portal del
-- Cliente: usuarios de acceso por cliente TMS + solicitud previa al plan
-- (aún sin flujo de creación/conversión — solo el modelo, ver alcance del
-- ticket). Base de docs/CLIENTE-PORTAL-0-DISCOVERY-SOLICITUDES-SEGUIMIENTO.md.
--
-- ESTADO: MANUAL. NO se ejecuta automáticamente en runtime (a propósito NO
-- se sigue el patrón de src/lib/flota/schema.ts, el único precedente de
-- DDL en caliente del proyecto — ver discovery, sección "hallazgo a
-- documentar sin corregirlo"). NO se ha ejecutado en ningún entorno
-- (ni local ni producción) al momento de crear este archivo.
--
-- Aditiva. Idempotente donde es razonablemente posible: CREATE TABLE IF
-- NOT EXISTS para las 3 tablas nuevas (si ya existieran, no se tocan) +
-- comprobación previa por information_schema antes de cada ALTER sobre
-- una tabla existente (tms_clientes, tms_planes_viaje). Compatible con
-- MariaDB/MySQL, InnoDB, utf8mb4 — mismas convenciones que el resto de
-- sql/*.sql.
--
-- AJUSTE PRE-MERGE PR #167: además de la UNIQUE(empresa_id, id) de
-- tms_clientes (punto 0), se agrega la misma UNIQUE(empresa_id, id) en
-- tms_planes_viaje (punto 0b) y se reemplazan 3 FKs simples por FKs
-- COMPUESTAS (empresa_id + el id referenciado) para que ninguna relación
-- del modelo nuevo pueda cruzar tenants a nivel de base de datos:
-- usuario que crea una solicitud, paradas de una solicitud, y plan
-- enlazado a una solicitud. Ver el detalle en cada tabla más abajo.
--
-- ORDEN DE DESPLIEGUE:
--   1) Ejecutar este archivo completo, en orden, en una sola sesión
--      (phpMyAdmin o cliente equivalente).
--   2) Ejecutar las consultas de POST-VERIFICACIÓN al final y confirmar
--      que devuelven lo esperado.
--   3) No requiere backfill de datos: las 3 tablas nacen vacías y nada en
--      la aplicación las usa todavía (ningún endpoint de creación de
--      solicitudes ni de conversión existe aún — eso es
--      CLIENTE-PORTAL-2/3). El único consumidor de este archivo en esta
--      fase es tms_cliente_usuarios, vía el alta manual de staff
--      (POST /api/empresas/[slug]/tms/clientes/[clienteId]/usuarios).
--
-- ROLLBACK: solo documental, no se automatiza (mismo criterio que el
-- resto de migraciones de este proyecto). Mientras ninguna fila dependa
-- todavía de estas tablas (cierto hasta que se implemente
-- CLIENTE-PORTAL-2 en adelante), revertir es seguro con:
--   DROP TABLE IF EXISTS tms_solicitud_paradas;
--   DROP TABLE IF EXISTS tms_solicitudes_cliente;
--   DROP TABLE IF EXISTS tms_cliente_usuarios;
--   ALTER TABLE tms_clientes DROP INDEX uq_tmsclientes_empresa_id;
--   ALTER TABLE tms_planes_viaje DROP INDEX uq_tmsplanes_empresa_id;
-- (el orden importa: paradas antes que solicitudes por la FK entre
-- ambas; usuarios antes del DROP INDEX no es necesario pero se agrupan
-- juntos por claridad).

SET NAMES utf8mb4;
SET @db := DATABASE();

-- ============================================================
-- 0) tms_clientes: UNIQUE (empresa_id, id) para poder ser destino de una
-- FK COMPUESTA (empresa_id, cliente_id) desde las tablas nuevas de abajo.
-- Es la única forma de que la base de datos (no solo la aplicación)
-- impida la inconsistencia "empresa_id de la empresa A + cliente_id de
-- un cliente que en realidad pertenece a la empresa B" exigida por el
-- ticket. `id` ya es PRIMARY KEY (único globalmente en toda la tabla),
-- así que este índice compuesto no relaja ninguna garantía existente —
-- solo agrega la combinación de columnas que MySQL/MariaDB exige como
-- destino válido de una FK compuesta.
--
-- Nota honesta: las tablas hermanas ya existentes (tms_cliente_contactos,
-- tms_cliente_rutas, tms_cliente_ubicaciones — ver
-- migrate-2026-08-viat-4-contactos-rutas.sql / viat-1) NO tienen esta
-- protección compuesta; cada una valida empresa_id y cliente_id por
-- separado, sin garantizar a nivel de FK que ambos coincidan. Este
-- archivo NO las toca (fuera de alcance de este ticket) — solo aplica el
-- estándar más estricto, explícitamente pedido por este ticket, a las
-- tablas nuevas que crea.
-- ============================================================
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tms_clientes'
    AND INDEX_NAME = 'uq_tmsclientes_empresa_id'
);
SET @sql := IF(@idx_exists = 0,
  'ALTER TABLE tms_clientes ADD UNIQUE KEY uq_tmsclientes_empresa_id (empresa_id, id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================
-- 0b) tms_planes_viaje: misma UNIQUE (empresa_id, id) que el punto 0,
-- ahora sobre tms_planes_viaje — necesaria para que
-- tms_solicitudes_cliente.plan_id (punto 2 más abajo) pueda usar una FK
-- COMPUESTA (empresa_id, plan_id) en vez de una FK simple que solo
-- garantiza que el plan exista, sin garantizar que sea de la misma
-- empresa. Igual que en tms_clientes, `id` ya es PRIMARY KEY (único
-- globalmente), así que este índice no relaja ninguna garantía
-- existente ni requiere validar/tocar ninguna fila de una tabla con
-- datos reales — es puramente aditivo.
--
-- Por qué la FK compuesta de abajo protege SOLO empresa_id y no también
-- cliente_id (AJUSTE PRE-MERGE PR #167, punto 3): tms_planes_viaje.cliente_id
-- es NULLABLE (un plan puede no tener cliente asignado), así que no
-- existe ninguna combinación de columnas de tms_planes_viaje que
-- garantice "cliente_id coincide" de forma confiable a nivel de FK — una
-- FK compuesta que incluyera cliente_id fallaría o se volvería
-- inconsistente en cualquier plan con cliente_id NULL. Forzar que
-- cliente_id nunca sea NULL en tms_planes_viaje para poder agregar esa
-- protección sería alterar de forma riesgosa un modelo existente con
-- datos reales — exactamente lo que este ticket pide NO improvisar. La
-- igualdad de cliente_id entre la solicitud y el plan candidato deberá
-- validarse en aplicación, bajo lock/transacción (mismo patrón ya usado
-- en el proyecto: SELECT ... FOR UPDATE + validación antes de escribir),
-- en CLIENTE-PORTAL-3 (conversión solicitud → plan) antes de llenar
-- plan_id — no es parte de este ticket.
SET @idx_exists := (
  SELECT COUNT(*) FROM information_schema.STATISTICS
  WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'tms_planes_viaje'
    AND INDEX_NAME = 'uq_tmsplanes_empresa_id'
);
SET @sql := IF(@idx_exists = 0,
  'ALTER TABLE tms_planes_viaje ADD UNIQUE KEY uq_tmsplanes_empresa_id (empresa_id, id)',
  'SELECT 1'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ============================================================
-- 1) tms_cliente_usuarios — usuarios de acceso al Portal del Cliente.
-- Relación 1 cliente TMS → N usuarios (a propósito NO 1:1 como
-- colaborador_credenciales — ver
-- docs/CLIENTE-PORTAL-0-DISCOVERY-SOLICITUDES-SEGUIMIENTO.md §3.1/§15).
-- En esta fase (CLIENTE-PORTAL-1) solo personal interno de SITSA puede
-- insertar aquí (endpoint de staff, ver alcance D del ticket); el propio
-- cliente NO puede crear otros usuarios todavía.
--
-- DECISIÓN — UNIQUE del email: GLOBAL (email), NO (empresa_id, email) ni
-- (empresa_id, cliente_id, email). Razón: el login del cliente (POST
-- /api/cliente-portal/auth/login) recibe SOLO email+password, sin
-- selector previo de empresa/cliente — exactamente igual que
-- colaborador_credenciales.username, que también es único GLOBALMENTE
-- (ver migrate-2026-08-rrhh-colaborador-auth2.sql, uq_colab_cred_username)
-- por la misma razón: el login de colaborador tampoco pide empresa.
-- Si el email fuera único solo dentro de una empresa (o de un cliente),
-- dos empresas (o dos clientes de la misma empresa) podrían dar de alta
-- el mismo email para dos cuentas distintas, y el login por email+password
-- no tendría forma de saber cuál de las dos usar sin pedir un dato
-- adicional que hoy no se pide en la pantalla de login. Mantener el
-- email inequívoco en TODO el sistema es justamente lo que permite que
-- el login siga siendo solo email+password. Si en el futuro el negocio
-- decide permitir el mismo email en más de una empresa/cliente, eso
-- exige agregar un selector de empresa/cliente al login ANTES de relajar
-- este UNIQUE — no es un cambio que se pueda hacer solo en la base de
-- datos sin tocar también el flujo de login.
--
-- AJUSTE PRE-MERGE PR #167 (punto 1): además de la PK simple (id) y del
-- UNIQUE de email, se agrega la clave candidata compuesta
-- (empresa_id, cliente_id, id) — id sigue siendo la PK real; esta es una
-- clave ADICIONAL, no un reemplazo. Es el destino que necesita la FK
-- compuesta de tms_solicitudes_cliente.creado_por_usuario_cliente_id más
-- abajo, para que la base de datos garantice que el usuario que crea una
-- solicitud pertenece EXACTAMENTE al mismo empresa_id + cliente_id que
-- la propia solicitud — no solo que el usuario exista en algún lado.
CREATE TABLE IF NOT EXISTS tms_cliente_usuarios (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  cliente_id INT NOT NULL,
  nombre VARCHAR(160) NOT NULL,
  email VARCHAR(160) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  salt VARCHAR(255) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  debe_cambiar_password TINYINT(1) NOT NULL DEFAULT 1,
  ultimo_acceso DATETIME NULL,
  creado_por VARCHAR(100) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tmscliusr_email (email),
  UNIQUE KEY uq_tmscliusr_empresa_cliente_id (empresa_id, cliente_id, id),
  INDEX idx_tmscliusr_cliente (empresa_id, cliente_id, activo),
  CONSTRAINT fk_tmscliusr_empresa FOREIGN KEY (empresa_id)
    REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_tmscliusr_empresa_cliente FOREIGN KEY (empresa_id, cliente_id)
    REFERENCES tms_clientes(empresa_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 2) tms_solicitudes_cliente — solicitud de viaje previa al plan. NUNCA
-- escribe directamente en tms_planes_viaje (ver discovery §4/§5): solo
-- Operaciones, en una fase posterior (CLIENTE-PORTAL-3), podrá convertir
-- una solicitud en un plan real, llenando `plan_id`. En esta fase
-- (CLIENTE-PORTAL-1) la tabla se crea pero NINGÚN endpoint la usa
-- todavía — preparación de modelo únicamente.
--
-- `estado`: VARCHAR + validación de aplicación (no ENUM/CHECK — mismo
-- criterio que tms_planes_viaje.estado y el resto del proyecto). Valores
-- conceptuales: SOLICITADA | EN_REVISION | PROGRAMADA | RECHAZADA |
-- CANCELADA (ver src/lib/tms/solicitudes-cliente.ts para cuando exista
-- lógica de transición — no forma parte de este ticket).
--
-- `plan_id` UNIQUE cuando no es NULL: MySQL/MariaDB, a diferencia de
-- otras bases de datos, SÍ permite múltiples filas NULL en una columna
-- UNIQUE (NULL nunca se compara como duplicado de otro NULL) — por eso
-- un UNIQUE (aunque ahora sea compuesto con empresa_id, ver más abajo)
-- funciona correctamente aquí: múltiples solicitudes sin plan asignado
-- (NULL) conviven sin problema, pero en cuanto plan_id deja de ser NULL,
-- ese plan queda enlazado exclusivamente a esa solicitud — ninguna otra
-- solicitud puede apuntar al mismo plan_id.
--
-- Misma protección compuesta empresa_id+cliente_id que tms_cliente_usuarios
-- (ver comentario del punto 0 de este archivo).
--
-- AJUSTE PRE-MERGE PR #167 (puntos 1-3): se agrega UNIQUE (empresa_id, id)
-- — clave candidata necesaria para que tms_solicitud_paradas (punto 3 más
-- abajo) pueda referenciar esta tabla con una FK compuesta — y se
-- reemplazan 2 FKs simples por FKs compuestas:
--  - creado_por_usuario_cliente_id: ahora FK compuesta
--    (empresa_id, cliente_id, creado_por_usuario_cliente_id) →
--    tms_cliente_usuarios(empresa_id, cliente_id, id). Antes solo se
--    garantizaba que el usuario existiera en algún cliente/empresa
--    cualquiera; ahora la base de datos impide crear una solicitud de la
--    empresa A / cliente A "creada por" un usuario que en realidad
--    pertenece a la empresa/cliente B.
--  - plan_id: ahora FK compuesta (empresa_id, plan_id) →
--    tms_planes_viaje(empresa_id, id) — impide enlazar por error una
--    solicitud de la empresa A a un plan de la empresa B. La UNIQUE que
--    antes era solo (plan_id) pasa a ser (empresa_id, plan_id): sigue
--    siendo equivalente en la práctica (un plan_id concreto pertenece
--    siempre a una única empresa, garantizado por la FK compuesta), y
--    además es la que exige el motor para poder indexar la FK compuesta.
--    La igualdad de CLIENTE (no solo de empresa) entre la solicitud y el
--    plan NO se protege a nivel de FK — ver el comentario del punto 0b
--    más arriba para la razón (tms_planes_viaje.cliente_id es NULLABLE)
--    y dónde queda documentada esa validación pendiente
--    (CLIENTE-PORTAL-3, bajo lock/transacción).
--
-- IMPORTANTE — esta FK compuesta NO puede usar ON DELETE SET NULL (el
-- diseño original, cuando la FK era simple, sí lo hacía): SET NULL
-- pondría a NULL TODAS las columnas de la FK, incluida empresa_id, que
-- es NOT NULL en esta tabla — MySQL/MariaDB rechaza esa combinación al
-- crear la tabla. Se usa ON DELETE RESTRICT en su lugar, lo cual es
-- seguro en la práctica: en todo el proyecto tms_planes_viaje nunca se
-- borra físicamente (solo cambia de estado — ver
-- docs/AUDITORIA-MIGRACIONES-ESTADO-REAL.md), así que RESTRICT no
-- bloqueará ninguna operación real hoy, y de paso impide accidentalmente
-- borrar un plan que una solicitud todavía referencia sin desenlazarlo
-- primero.
CREATE TABLE IF NOT EXISTS tms_solicitudes_cliente (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  cliente_id INT NOT NULL,
  creado_por_usuario_cliente_id INT NOT NULL,
  estado VARCHAR(20) NOT NULL DEFAULT 'SOLICITADA',
  fecha_solicitada DATE NOT NULL,
  hora_solicitada TIME NULL,
  referencia_cliente VARCHAR(120) NULL,
  observaciones VARCHAR(500) NULL,
  motivo_rechazo VARCHAR(500) NULL,
  plan_id INT NULL,
  version INT NOT NULL DEFAULT 1,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tmssolicli_empresa_id (empresa_id, id),
  UNIQUE KEY uq_tmssolicli_plan (empresa_id, plan_id),
  INDEX idx_tmssolicli_cliente (empresa_id, cliente_id, estado),
  INDEX idx_tmssolicli_usuario (empresa_id, cliente_id, creado_por_usuario_cliente_id),
  CONSTRAINT fk_tmssolicli_empresa FOREIGN KEY (empresa_id)
    REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_tmssolicli_empresa_cliente FOREIGN KEY (empresa_id, cliente_id)
    REFERENCES tms_clientes(empresa_id, id) ON DELETE CASCADE,
  CONSTRAINT fk_tmssolicli_usuario FOREIGN KEY (empresa_id, cliente_id, creado_por_usuario_cliente_id)
    REFERENCES tms_cliente_usuarios(empresa_id, cliente_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_tmssolicli_plan FOREIGN KEY (empresa_id, plan_id)
    REFERENCES tms_planes_viaje(empresa_id, id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- 3) tms_solicitud_paradas — paradas ordenadas de una solicitud (origen +
-- N entregas + destino final), estructura análoga a tms_plan_paradas
-- (ver discovery §7) pero para la SOLICITUD, no para el plan ya
-- programado.
--
-- AJUSTE PRE-MERGE PR #167 (punto 2): a diferencia del diseño original
-- (que sí seguía el criterio de tms_cliente_ruta_paradas de confiar sin
-- más en que la fila padre ya estaba aislada), aquí se decidió proteger
-- la relación con una FK COMPUESTA: `empresa_id` en esta tabla es
-- redundante con el de la solicitud padre, y una columna tenant
-- duplicada SIN integridad relacional es exactamente el riesgo que este
-- ajuste pide cerrar (no la Opción A de eliminar `empresa_id` — se
-- mantiene, porque permite filtrar/borrar por empresa sin JOIN, mismo
-- motivo que ya usa tms_cliente_ruta_paradas — pero ahora protegida). La
-- FK es (empresa_id, solicitud_id) →
-- tms_solicitudes_cliente(empresa_id, id): la base de datos ahora
-- impide que una parada con `empresa_id` de la empresa A apunte a una
-- solicitud que en realidad es de la empresa B.
--
-- `tipo`: VARCHAR + validación de aplicación en INSERT (Opción C del
-- ticket), NO ENUM ni CHECK. A diferencia del legado
-- tms_plan_paradas.tipo (VARCHAR totalmente libre, sin ninguna
-- validación en su único punto de escritura), aquí la aplicación SIEMPRE
-- valida contra una lista cerrada de 3 valores (Carga/Entrega/Descarga)
-- antes de escribir — ver TIPOS_SOLICITUD_PARADA/validarParadasSolicitud
-- en src/lib/tms/solicitudes-cliente.ts. Se eligió VARCHAR + validación
-- de aplicación y no ENUM/CHECK porque: (a) es el mismo criterio que usa
-- el 100% de las columnas tipo/estado ya existentes en este proyecto
-- (cero ENUM, cero CHECK en todo sql/*.sql hoy); (b) evita introducir
-- aquí el primer ENUM/CHECK del proyecto, cuyo comportamiento exacto
-- entre versiones de MariaDB/MySQL (sobre todo CHECK, soportado de forma
-- desigual según versión y nunca antes verificado en este entorno de
-- producción) no está probado; (c) sigue permitiendo agregar un tipo
-- nuevo en el futuro con un cambio de aplicación, sin ALTER de esquema.
-- Las reglas de negocio "exactamente 1 Carga + 0..N Entrega + exactamente
-- 1 Descarga" tampoco son expresables como una restricción de fila
-- individual (dependen del conjunto completo de paradas de una
-- solicitud) — se validan en aplicación, no en SQL.
--
-- `cliente_ubicacion_id` es informativo únicamente, SIN FK — mismo
-- criterio ya usado en tms_plan_paradas.cliente_ubicacion_id
-- (migrate-2026-08-viat-1-cliente-ubicaciones.sql) y en
-- tms_cliente_ruta_paradas.cliente_ubicacion_id: si esa ubicación
-- guardada del cliente se edita o desactiva después, la parada ya
-- solicitada no debe perder ni reinterpretar lo que el cliente pidió en
-- su momento.
--
-- `cantidad_entregas` NO existe como columna: se deriva siempre con
-- COUNT(*) WHERE tipo='Entrega' (ver discovery §8) — mismo criterio que
-- el resto de conteos de paradas en el proyecto (nunca se guarda un
-- contador aparte que se pueda desincronizar).
CREATE TABLE IF NOT EXISTS tms_solicitud_paradas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  solicitud_id INT NOT NULL,
  orden TINYINT NOT NULL DEFAULT 1,
  tipo VARCHAR(20) NOT NULL,
  lugar_nombre VARCHAR(200) NOT NULL,
  cliente_ubicacion_id INT NULL,
  referencia VARCHAR(300) NULL,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tmssolpar_solicitud (empresa_id, solicitud_id, orden),
  CONSTRAINT fk_tmssolpar_empresa FOREIGN KEY (empresa_id)
    REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_tmssolpar_empresa_solicitud FOREIGN KEY (empresa_id, solicitud_id)
    REFERENCES tms_solicitudes_cliente(empresa_id, id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ============================================================
-- POST-VERIFICACIÓN (ejecutar después, revisar el resultado a mano —
-- ninguna de estas consultas modifica datos)
-- ============================================================

-- a) Confirmar los nuevos índices compuestos en tablas existentes:
-- SHOW INDEX FROM tms_clientes WHERE Key_name = 'uq_tmsclientes_empresa_id';
-- SHOW INDEX FROM tms_planes_viaje WHERE Key_name = 'uq_tmsplanes_empresa_id';

-- b) Confirmar las 3 tablas nuevas y sus FKs (revisar en el resultado
-- que fk_tmssolicli_usuario y fk_tmssolpar_empresa_solicitud/
-- fk_tmssolicli_plan queden como FOREIGN KEY COMPUESTAS, no simples):
-- SHOW CREATE TABLE tms_cliente_usuarios;
-- SHOW CREATE TABLE tms_solicitudes_cliente;
-- SHOW CREATE TABLE tms_solicitud_paradas;

-- c) Confirmar que las 3 tablas nacen vacías (esperado: 0 en las tres):
-- SELECT COUNT(*) FROM tms_cliente_usuarios;
-- SELECT COUNT(*) FROM tms_solicitudes_cliente;
-- SELECT COUNT(*) FROM tms_solicitud_paradas;

-- d) Confirmar que ningún cliente existente queda "huérfano" respecto a
-- su empresa (debe devolver 0 filas — si devolviera alguna, el ALTER del
-- punto 0 habría fallado antes de llegar aquí, así que esto es solo una
-- doble verificación):
-- SELECT c.id, c.empresa_id FROM tms_clientes c
-- LEFT JOIN empresas e ON e.id = c.empresa_id
-- WHERE e.id IS NULL;

-- e) AJUSTE PRE-MERGE PR #167 — confirmar que ningún plan existente
-- queda "huérfano" respecto a su empresa (debe devolver 0 filas; si
-- devolviera alguna, el ALTER del punto 0b habría fallado antes):
-- SELECT p.id, p.empresa_id FROM tms_planes_viaje p
-- LEFT JOIN empresas e ON e.id = p.empresa_id
-- WHERE e.id IS NULL;
