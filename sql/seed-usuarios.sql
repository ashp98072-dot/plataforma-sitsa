-- Seed empresas + usuarios (Hostinger / phpMyAdmin)
-- Importar DESPUÉS de schema.sql en la misma base.

INSERT INTO empresas (codigo, nombre, slug, modulos_json, activa)
SELECT 'KT', 'Kuiqtrans / Logiservicios Mónaco', 'kt-monaco',
       '["rrhh","tms","flota","contabilidad","gerencia","cms"]', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM empresas WHERE codigo = 'KT');

INSERT INTO empresas (codigo, nombre, slug, modulos_json, activa)
SELECT 'FRANCISCO', 'Francisco', 'francisco',
       '["rrhh","contabilidad","reciclaje","gerencia","cms"]', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM empresas WHERE codigo = 'FRANCISCO');

INSERT INTO empresas (codigo, nombre, slug, modulos_json, activa)
SELECT 'TARIMAS', 'Tarimas Center', 'tarimas',
       '["rrhh","contabilidad","tarimas","gerencia","cms"]', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM empresas WHERE codigo = 'TARIMAS');

INSERT INTO empresas (codigo, nombre, slug, modulos_json, activa)
SELECT 'FRESCOFRESH', 'Frescofresh', 'frescofresh',
       '["rrhh","contabilidad","gerencia","cms"]', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM empresas WHERE codigo = 'FRESCOFRESH');

INSERT INTO empresas (codigo, nombre, slug, modulos_json, activa)
SELECT 'ECOPLANET', 'Ecoplanet', 'ecoplanet',
       '["rrhh","contabilidad","reciclaje","gerencia","cms"]', 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM empresas WHERE codigo = 'ECOPLANET');

-- Passwords: admin123 / rrhh123 / conta123 / ops123 / predios123
INSERT INTO usuarios (username, password_hash, salt, nombre, rol_global, acceso_todas_empresas, activo)
SELECT 'admin',
       'a179b5e08123bde2d80f279948d54cf4d4c4f4edbd6c6bc4258e9a85a95d38a4',
       'd58b6098a2cbaa4b17da3274f3cbdea6',
       'Administrador General', 'Admin', 1, 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM usuarios WHERE username = 'admin');

INSERT INTO usuarios (username, password_hash, salt, nombre, rol_global, acceso_todas_empresas, activo)
SELECT 'rrhh',
       '7e3237875a5f23c0a6dd82edfdfa1c87838ca370ebfba87856db9ed836033a16',
       'e5b89b187e212f27dfb3fd545d6c2479',
       'Recursos Humanos', 'RRHH', 1, 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM usuarios WHERE username = 'rrhh');

INSERT INTO usuarios (username, password_hash, salt, nombre, rol_global, acceso_todas_empresas, activo)
SELECT 'contabilidad',
       '97d432ac16b4eac612f8b56893cabc4c81af89280090bafd27d76795fdda8d60',
       '2879a492513284e67080c41f1d5b620c',
       'Contabilidad', 'Contabilidad', 1, 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM usuarios WHERE username = 'contabilidad');

INSERT INTO usuarios (username, password_hash, salt, nombre, rol_global, acceso_todas_empresas, activo)
SELECT 'operaciones',
       '50b12c239be55e0649b61f7633beda2b1af6d82f8707f46bedc7b60c5c4e0a47',
       '7e4cd6162af51e79edce256bb6355fcd',
       'Operaciones KT', 'Operaciones', 0, 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM usuarios WHERE username = 'operaciones');

INSERT INTO usuarios (username, password_hash, salt, nombre, rol_global, acceso_todas_empresas, activo)
SELECT 'predios',
       '3ee5e979ce68f402a22d394314fe22d98ae2e054cd3c491edd5418f3463d5d46',
       '668c8a38b317296033647f89f1bce3cf',
       'Coordinador Predios', 'CoordinadorPredios', 0, 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM usuarios WHERE username = 'predios');

INSERT IGNORE INTO usuario_empresa (usuario_id, empresa_id)
SELECT u.id, e.id FROM usuarios u
CROSS JOIN empresas e
WHERE u.username IN ('operaciones', 'predios') AND e.codigo = 'KT';
