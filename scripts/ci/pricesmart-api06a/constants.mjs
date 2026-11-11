// PRICESMART-API-06A — constantes FIJAS del laboratorio. Importar este archivo no tiene efectos.
// Cualquier cambio de estas constantes requiere nueva revisión independiente.

export const REQUIRED_BRANCH = 'feature/pricesmart-api06a-mariadb-real';
// API-07: la extensión B10 vive en su propia rama apilada; lista CERRADA de ramas exactas (nunca un patrón).
export const ALLOWED_BRANCHES = Object.freeze([REQUIRED_BRANCH, 'feature/pricesmart-api07-lab-outbox', 'feature/pricesmart-api09-adaptacion-durable', 'feature/tms-confirmacion-lab-b12']);
export const LAB_ACK_ENV = 'PS_API06A_LAB_ACK';
export const LAB_ACK_PHRASE = 'SINTETICO-LOCAL-SIN-PRODUCCION-NI-HOSTINGER';

// Motor reutilizado: MariaDB portable 11.8.9 ya presente en .lab-runtime/ (ignorado por git).
// zipSha256 = archiveSHA256 registrado en docs/evidence/combustibles-pr2-mariadb-11.8.9/source.json.
// manifestSha256 = SHA-256 de engine-manifest.json (624 archivos con su SHA-256, calculado desde el ZIP verificado).
export const ENGINE = Object.freeze({
  dirName: 'mariadb-11.8.9-winx64',
  zipName: 'mariadb-11.8.9-winx64.zip',
  zipSha256: '830c46727d9278eae212ae3eca44eeb9e71b2a68704e95f344a64fba7b1963f5',
  manifestSha256: '0ed5810ba8479f1b70987880231582fba68c3639037592678e53c57201db49ab',
  fileCount: 624,
  versionPrefix: '11.8.9',
  mariadbdSha256: 'de2c4350e36bcdff6a18b614a21701a8a827509f44f51274411bb52a2849f9e5',
});

export const RUN_PREFIX = 'novalvion-ps-api06a-';
export const HOST = '127.0.0.1';
export const PORT_MIN = 49152;
export const PORT_MAX = 65535;
// Puertos de otros servicios conocidos. Todos quedan fuera del rango (defensa en profundidad).
export const FORBIDDEN_PORTS = Object.freeze([1433, 1521, 3306, 3307, 3308, 5432, 6379, 27017, 33060]);
export const LOCK_WAIT_SECONDS = 3;
// El proceso padre NO debe tener configuración de bases/entornos reales. Si alguna de estas variables existe, el ejecutor se detiene.
export const FORBIDDEN_PARENT_ENV = /^(DB_|DATABASE_URL|MYSQL|MARIADB|PG[A-Z_]*$|HOSTINGER|SANDBOX_|NOVALVION_|AUTH_SECRET|PORTAL_CREDENTIALS_KEY|FEL_|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY)/i;

// Alcances sintéticos registrados administrativamente (ps_api01_scopes). Solo datos ficticios.
export const LAB_SCOPES = Object.freeze([
  Object.freeze({ tenantId: 1, clientId: 1, integrationId: 'qa-integration' }),
  Object.freeze({ tenantId: 1, clientId: 2, integrationId: 'qa-integration' }),
  Object.freeze({ tenantId: 2, clientId: 1, integrationId: 'qa-integration' }),
  Object.freeze({ tenantId: 1, clientId: 1, integrationId: 'qa-other' }),
]);

// Fases del ejecutor (variable PS06A_PHASE que recibe el proceso de pruebas).
export const PHASES = Object.freeze(['main', 'crash-prepare', 'crash-verify']);
