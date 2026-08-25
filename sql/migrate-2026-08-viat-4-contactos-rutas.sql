-- VIAT-4 — Programación basada en el proceso real de Operaciones:
-- contactos operativos por cliente + catálogo maestro de rutas/servicios
-- (Operaciones > Rutas) + fotografía histórica de ruta en el viaje.
-- Aditiva e idempotente. NO se ejecuta automáticamente en runtime (mismo
-- criterio que el resto de SITSA: migraciones SQL explícitas antes de
-- desplegar, sin DDL automático en runtime para las tablas nuevas de este
-- módulo). NO se ejecutó en este entorno. NO borra ni transforma ningún
-- dato existente.
--
-- No duplica maestros: cliente_id sigue referenciando tms_clientes (el
-- mismo que ya usa tms_planes_viaje); las paradas de ruta reutilizan
-- tms_cliente_ubicaciones (VIAT-1) en vez de guardar direcciones nuevas.

-- 1) Contactos operativos por cliente (punto 1). Modelo reutilizable de
-- verdad — NO es un campo "telefono_supervisor" suelto. `cargo` es texto
-- libre (Supervisor, Encargado de bodega, Recepción, Administración,
-- Otro… son solo ejemplos, no un catálogo cerrado). Nunca se borra un
-- contacto histórico: "dejar de usarse" es activo=0, igual que
-- tms_cliente_ubicaciones.
CREATE TABLE IF NOT EXISTS tms_cliente_contactos (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  cliente_id INT NOT NULL,
  nombre VARCHAR(160) NOT NULL,
  cargo VARCHAR(120) NULL,
  telefono VARCHAR(80) NULL,
  email VARCHAR(160) NULL,
  observaciones VARCHAR(300) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_tmsclicont_cliente (empresa_id, cliente_id, activo),
  CONSTRAINT fk_tmsclicont_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_tmsclicont_cliente FOREIGN KEY (cliente_id) REFERENCES tms_clientes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2) Catálogo maestro de rutas/servicios del cliente (punto 2 — "hoja
-- CODIGOS DATA" del Excel real). Es una PLANTILLA: Programación COPIA sus
-- datos al viaje (fotografía histórica) en vez de referenciarla en vivo,
-- así que cambiar/desactivar una ruta después nunca altera viajes ya
-- creados. `ubicacion_carga_id` referencia tms_cliente_ubicaciones (sin
-- duplicar direcciones); `contacto_cliente_id` referencia
-- tms_cliente_contactos (sin duplicar teléfonos aparte).
--
-- UNIQUE (empresa_id, cliente_id, codigo) y NO (empresa_id, codigo)
-- global: sin poder inspeccionar aquí el Excel/datos reales de códigos
-- (no se aportó archivo en esta fase para verificarlo), se eligió la
-- opción más flexible/segura — permite que dos clientes distintos usen
-- el mismo código corto (ej. ambos tengan un código "8") sin chocar,
-- consistente con que el selector siempre desambigua mostrando
-- "código — cliente — nombre". Si en la práctica los códigos SÍ son
-- únicos por empresa, esta restricción sigue siendo válida (un
-- UNIQUE por cliente nunca permite menos que uno global) — ajustar
-- después es un ALTER aditivo, no un cambio de datos.
CREATE TABLE IF NOT EXISTS tms_cliente_rutas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  cliente_id INT NOT NULL,
  codigo VARCHAR(40) NOT NULL,
  nombre VARCHAR(200) NULL,
  ubicacion_carga_id INT NULL,
  lugar_carga_texto VARCHAR(300) NULL,
  hora_habitual VARCHAR(20) NULL,
  contacto_cliente_id INT NULL,
  observaciones VARCHAR(300) NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_tmsclirutas_codigo (empresa_id, cliente_id, codigo),
  INDEX idx_tmsclirutas_cliente (empresa_id, cliente_id, activo),
  INDEX idx_tmsclirutas_codigo (empresa_id, codigo),
  CONSTRAINT fk_tmsclirutas_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_tmsclirutas_cliente FOREIGN KEY (cliente_id) REFERENCES tms_clientes(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3) Paradas/destinos de la ruta maestra (una ruta puede tener varios
-- destinos, con orden). Estructura hija análoga a tms_plan_paradas (la
-- del VIAJE) pero para la PLANTILLA — se copian, nunca se referencian en
-- vivo, hacia tms_plan_paradas al seleccionar la ruta en Programación.
CREATE TABLE IF NOT EXISTS tms_cliente_ruta_paradas (
  id INT AUTO_INCREMENT PRIMARY KEY,
  empresa_id INT NOT NULL,
  ruta_id INT NOT NULL,
  cliente_ubicacion_id INT NULL,
  orden TINYINT NOT NULL DEFAULT 1,
  tipo VARCHAR(40) NOT NULL DEFAULT 'Entrega',
  lugar_nombre VARCHAR(200) NOT NULL,
  activo TINYINT(1) NOT NULL DEFAULT 1,
  INDEX idx_tmscliparadas_ruta (ruta_id, activo, orden),
  CONSTRAINT fk_tmscliparadas_empresa FOREIGN KEY (empresa_id) REFERENCES empresas(id) ON DELETE CASCADE,
  CONSTRAINT fk_tmscliparadas_ruta FOREIGN KEY (ruta_id) REFERENCES tms_cliente_rutas(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4) Fotografía histórica de la ruta en el viaje (punto 3/Programación).
-- `ruta_id` es SOLO informativo (de qué ruta salió esta copia) — sin FK,
-- mismo criterio ya usado para tms_plan_paradas.cliente_ubicacion_id
-- (migrate-2026-08-viat-1-cliente-ubicaciones.sql): si la ruta cambia o
-- se desactiva después, este viaje no debe perder ni reinterpretar los
-- datos que efectivamente usó. `ruta_codigo_historico` es el código
-- copiado en el momento (el que debe salir en el reporte tradicional,
-- columna "Código" — nunca se recalcula desde la ruta viva).
ALTER TABLE tms_planes_viaje
  ADD COLUMN IF NOT EXISTS ruta_id INT NULL AFTER referencia_cliente,
  ADD COLUMN IF NOT EXISTS ruta_codigo_historico VARCHAR(40) NULL AFTER ruta_id;
