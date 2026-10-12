-- PROPUESTA (NO EJECUTAR sin autorización explícita) — Parametrización contable por entidad: roles → cuentas y bancos.
-- KT (entidad_id = 1) y MONACO (entidad_id = 2), empresa_id = 1.
--
-- ESTADO: PROPUESTO PARA REVISIÓN. NO se ha ejecutado en ningún entorno real. Antes de ejecutar algo de este archivo:
--   1) autorización explícita del responsable y respaldo de la base;
--   2) sql/preflight-2026-10-contabilidad-parametrizacion-roles-bancos.sql con compuerta «APTO» (§8) y sin problemas en §6-§7.
--
-- Contenido:
--   §1  DDL de `cont_cuentas_rol` (aditivo; no existe estructura previa reutilizable).            [ejecutable, propuesto]
--   §2  Carga de los 14 roles confirmados (7 por entidad), FALLA CERRADO.                         [ejecutable, propuesto]
--   §3  Bancos en `cont_cuentas_bancarias`                                                         [COMENTADO / BLOQUEADO]
--   §4  Pendientes (VENTAS_BIENES, 11103006, …)                                                    [COMENTADO]
--   §5  Endurecimientos opcionales (únicos de alias, triggers de cuenta activa)                    [COMENTADO]
--
-- No genera pólizas, no toca facturas, pagos, retenciones, FEL ni registrarAsiento, no hace UPDATE/DELETE.
-- Mismo código ≠ misma fila: TODO se resuelve por empresa_id + entidad_id + codigo (KT y MONACO tienen cuentas distintas
-- con códigos iguales).

-- ═════════════════════════════ §1. DDL — cont_cuentas_rol ═══════════════════════════════════════════════════════════
-- Una fila = «en ESTA entidad, el rol X usa ESTA cuenta». Garantías de integridad en la base de datos:
--   · UNIQUE (empresa_id, entidad_id, rol): un solo rol por entidad (no hay duplicados).
--   · FK compuesta a cont_entidades(empresa_id, id).
--   · FK compuesta a cont_cuentas(empresa_id, entidad_id, id): la cuenta DEBE ser de la misma empresa y entidad
--     (imposible asignar una cuenta de KT a MONACO o viceversa, ni por SQL directo).
--   · CHECK de lista cerrada de roles. VENTAS_BIENES NO está en la lista A PROPÓSITO: mientras Contabilidad no confirme el
--     código de la cuenta, la base rechaza cualquier fila de ese rol. Habilitarlo exigirá un ALTER aprobado con código
--     confirmado. BANCOS tampoco es un rol fijo: se resuelve por cont_cuentas_bancarias.
--   · La cuenta INACTIVA no se puede impedir con una FK: lo cubren la carga (§2, solo cuentas activas), el resolvedor
--     (siempre JOIN … activa = 1) y el preflight §7; trigger opcional en §5.
CREATE TABLE IF NOT EXISTS cont_cuentas_rol (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  entidad_id INT NOT NULL,
  rol VARCHAR(40) NOT NULL,
  cuenta_id INT NOT NULL,
  activa TINYINT(1) NOT NULL DEFAULT 1,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cont_cuentas_rol (empresa_id, entidad_id, rol),
  KEY idx_cont_cuentas_rol_cuenta (empresa_id, entidad_id, cuenta_id),
  CONSTRAINT fk_cont_rol_entidad FOREIGN KEY (empresa_id, entidad_id)
    REFERENCES cont_entidades(empresa_id, id) ON DELETE RESTRICT,
  CONSTRAINT fk_cont_rol_cuenta FOREIGN KEY (empresa_id, entidad_id, cuenta_id)
    REFERENCES cont_cuentas(empresa_id, entidad_id, id) ON DELETE RESTRICT,
  CONSTRAINT ck_cont_rol_valido CHECK (rol IN (
    'CLIENTES', 'IVA_POR_PAGAR', 'VENTAS_SERVICIOS', 'RETENCION_IVA', 'ANTICIPOS', 'TRANSITO_BANCARIO', 'DEVOLUCIONES_VENTAS'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ═════════════════════════════ §2. Carga de roles confirmados — FALLA CERRADO ═══════════════════════════════════════
-- Mapeo (mismo código en ambas entidades, FILAS distintas; se resuelve por empresa + entidad + código):
--   CLIENTES → 11203001 · IVA_POR_PAGAR → 21401001 · VENTAS_SERVICIOS → 41101003 · RETENCION_IVA → 11302005
--   ANTICIPOS → 21302001 · TRANSITO_BANCARIO → 11101002 · DEVOLUCIONES_VENTAS → 41501002
-- Cada cuenta debe existir en ESA entidad, estar ACTIVA y tener el tipo esperado del rol; si una no cumple, la fila NO se
-- inserta, el conteo no llega a 14 y el cierre es ROLLBACK. Un rol ya existente hace fallar el INSERT (UNIQUE).
DROP TEMPORARY TABLE IF EXISTS esperado_roles;
CREATE TEMPORARY TABLE esperado_roles (
  entidad_id INT NOT NULL,
  rol        VARCHAR(40) NOT NULL,
  codigo     VARCHAR(40) NOT NULL,
  tipo       VARCHAR(40) NOT NULL,
  PRIMARY KEY (entidad_id, rol)
) DEFAULT CHARSET=utf8mb4;

INSERT INTO esperado_roles (entidad_id, rol, codigo, tipo) VALUES
  (1, 'CLIENTES',            '11203001', 'Activo'),
  (1, 'IVA_POR_PAGAR',       '21401001', 'Pasivo'),
  (1, 'VENTAS_SERVICIOS',    '41101003', 'Ingreso'),
  (1, 'RETENCION_IVA',       '11302005', 'Activo'),
  (1, 'ANTICIPOS',           '21302001', 'Pasivo'),
  (1, 'TRANSITO_BANCARIO',   '11101002', 'Activo'),
  (1, 'DEVOLUCIONES_VENTAS', '41501002', 'Ingreso'),
  (2, 'CLIENTES',            '11203001', 'Activo'),
  (2, 'IVA_POR_PAGAR',       '21401001', 'Pasivo'),
  (2, 'VENTAS_SERVICIOS',    '41101003', 'Ingreso'),
  (2, 'RETENCION_IVA',       '11302005', 'Activo'),
  (2, 'ANTICIPOS',           '21302001', 'Pasivo'),
  (2, 'TRANSITO_BANCARIO',   '11101002', 'Activo'),
  (2, 'DEVOLUCIONES_VENTAS', '41501002', 'Ingreso');

START TRANSACTION;

INSERT INTO cont_cuentas_rol (empresa_id, entidad_id, rol, cuenta_id, activa)
SELECT 1, e.entidad_id, e.rol, c.id, 1
FROM esperado_roles e
JOIN cont_cuentas c
  ON c.empresa_id = 1 AND c.entidad_id = e.entidad_id AND c.codigo = e.codigo
 AND c.activa = 1 AND c.tipo = e.tipo
ORDER BY e.entidad_id, e.rol;
SET @insertadas := ROW_COUNT();   -- -1 si el INSERT falló (p. ej. rol duplicado)

-- Verificación EXACTA: cada rol esperado apunta a la cuenta (entidad, código) esperada, activa y del tipo esperado.
SET @diferencias := (
  SELECT COUNT(*)
  FROM esperado_roles e
  LEFT JOIN cont_cuentas_rol r ON r.empresa_id = 1 AND r.entidad_id = e.entidad_id AND r.rol = e.rol
  LEFT JOIN cont_cuentas c ON c.id = r.cuenta_id
  WHERE r.id IS NULL
     OR c.empresa_id <> 1 OR c.entidad_id <> e.entidad_id OR c.codigo <> e.codigo
     OR c.activa <> 1 OR c.tipo <> e.tipo OR r.activa <> 1
);
SET @esperadas := (SELECT COUNT(*) FROM esperado_roles);
SET @cierre := IF(@esperadas = 14 AND @insertadas = 14 AND @diferencias = 0, 'COMMIT', 'ROLLBACK');
PREPARE cierre FROM @cierre; EXECUTE cierre; DEALLOCATE PREPARE cierre;

SELECT @esperadas AS roles_esperados, @insertadas AS roles_insertados, @diferencias AS diferencias, @cierre AS cierre,
       IF(@cierre = 'COMMIT', 'CARGA CONFIRMADA', 'REVERTIDO: no se cambio nada') AS resultado;

-- Estado final (solo lectura)
SELECT r.entidad_id, r.rol, c.codigo AS cuenta_codigo, c.nombre AS cuenta_nombre, c.tipo, r.activa
FROM cont_cuentas_rol r JOIN cont_cuentas c ON c.id = r.cuenta_id
WHERE r.empresa_id = 1 ORDER BY r.entidad_id, r.rol;

DROP TEMPORARY TABLE IF EXISTS esperado_roles;

-- ═════════════════════════════ §3. BANCOS — COMENTADO / BLOQUEADO ═══════════════════════════════════════════════════
-- BLOQUEADO hasta que el responsable confirme, POR BANCO: (a) que sigue operativo, (b) alias, (c) moneda y (d) los
-- ÚLTIMOS 4 dígitos a mostrar en `referencia`. NO se inventan alias ni números. NUNCA el número completo.
-- Requisitos: la cuenta contable ya existe en ESA entidad (preflight §2/§6). Se enlaza por (empresa, entidad, código),
-- nunca por id escrito a mano. INSERT simple (falla ante duplicado: UNIQUE(empresa, entidad, cuenta) y la FK compuesta
-- impiden repetir o cruzar entidad). Un banco por cuenta: el registro duplicado 0001/0002 de Milenium para Mónaco NO
-- puede repetirse (queda UNA fila; un segundo alias no es posible sobre la misma cuenta).
--
-- KT — candidatos (Milenium, con movimiento hasta 2026):
-- INSERT INTO cont_cuentas_bancarias (empresa_id, entidad_id, cuenta_id, banco, alias, referencia, moneda, activa)
-- SELECT 1, 1, c.id, 'Banco Industrial', '<ALIAS A CONFIRMAR>', '***<ULTIMOS_4>', 'GTQ', 1
--   FROM cont_cuentas c WHERE c.empresa_id = 1 AND c.entidad_id = 1 AND c.codigo = '11103002' AND c.activa = 1
-- UNION ALL
-- SELECT 1, 1, c.id, 'G&T Continental',   '<ALIAS A CONFIRMAR>', '***<ULTIMOS_4>', 'GTQ', 1
--   FROM cont_cuentas c WHERE c.empresa_id = 1 AND c.entidad_id = 1 AND c.codigo = '11103001' AND c.activa = 1
-- UNION ALL
-- SELECT 1, 1, c.id, 'Banco Industrial',  '<ALIAS A CONFIRMAR: fondo operativo>', '***<ULTIMOS_4>', 'GTQ', 1
--   FROM cont_cuentas c WHERE c.empresa_id = 1 AND c.entidad_id = 1 AND c.codigo = '11103004' AND c.activa = 1;
--
-- KT — 11103006 G&T CONTINENTAL: SIN movimiento desde 2023-06 y NO homologada en cont_cuentas. PENDIENTE confirmar si
-- sigue activa; si sí, primero homologar la cuenta y luego dar de alta el banco. NO se incluye.
--
-- MONACO — único banco con movimiento:
-- INSERT INTO cont_cuentas_bancarias (empresa_id, entidad_id, cuenta_id, banco, alias, referencia, moneda, activa)
-- SELECT 1, 2, c.id, 'Banco Industrial', '<ALIAS A CONFIRMAR>', '***<ULTIMOS_4>', 'GTQ', 1
--   FROM cont_cuentas c WHERE c.empresa_id = 1 AND c.entidad_id = 2 AND c.codigo = '11103002' AND c.activa = 1;
--
-- Verificación posterior (esperado 0 filas): SELECT … del preflight §6.4-§6.5 y §7.

-- ═════════════════════════════ §4. PENDIENTES ═══════════════════════════════════════════════════════════════════════
--   · VENTAS_BIENES: rol confirmado, CÓDIGO pendiente de Contabilidad. NO hay INSERT, y la CHECK de §1 lo rechaza. No usar
--     41101001 / 41101002 automáticamente. Al confirmarse: homologar la cuenta (tipo Ingreso) y ALTER aprobado de la CHECK.
--   · Bancos de §3: alias / últimos 4 / vigencia.
--   · 11103006 (KT), 11101001 CAJA GENERAL (KT, sin uso desde 2023-06), 11104003 (dólares): decisión de Contabilidad.
--   · Roles futuros (RETENCION_ISR, PROVISION_RETENCION_IVA, …): fuera de alcance (ISR pendiente).

-- ═════════════════════════════ §5. ENDURECIMIENTOS OPCIONALES — COMENTADO ═══════════════════════════════════════════
-- (a) Evitar un mismo banco+alias repetido dentro de una entidad (hoy no hay UNIQUE; el preflight §6.4 lo detecta):
-- ALTER TABLE cont_cuentas_bancarias
--   ADD UNIQUE INDEX IF NOT EXISTS uq_cont_cb_alias (empresa_id, entidad_id, banco, alias);
-- (b) Impedir en la propia base un rol ACTIVO sobre cuenta inactiva (requiere privilegio TRIGGER; si el hosting no lo
--     permite, lo cubre el resolvedor con JOIN … activa = 1):
-- DELIMITER //
-- CREATE TRIGGER trg_cont_rol_cuenta_activa_i BEFORE INSERT ON cont_cuentas_rol FOR EACH ROW
-- BEGIN
--   IF NEW.activa = 1 AND (SELECT activa FROM cont_cuentas WHERE id = NEW.cuenta_id) <> 1 THEN
--     SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'La cuenta del rol esta inactiva';
--   END IF;
-- END//
-- DELIMITER ;
