import { parseAccount } from './database-identity';
import { MIGRATION_SCHEMA_PRIVILEGES, REGISTRY_WRITER_POLICY, RUNTIME_PRIVILEGE_POLICY, type AccountRole, type PrivilegePolicy } from './grants-audit';

// PRICESMART API-21 — PLAN DE PRIVILEGIOS por cuenta (ejecución, escritura del registro administrativo y migración), PREPARADO PARA REVISIÓN y NUNCA EJECUTADO por este código. Genera únicamente sentencias GRANT
// mínimas y distintas por rol, a partir de las mismas políticas que usa la auditoría (`auditRoleGrants`), de modo que lo que se concede es exactamente lo que se verifica. No crea cuentas, no incluye contraseñas ni
// `IDENTIFIED BY`, jamás emite `WITH GRANT OPTION`, privilegios globales (`*.*`), `DELETE`, `DROP` ni `TRUNCATE`, y rechaza hosts de cuenta con comodines. Las credenciales de las cuentas son un asunto de la infraestructura
// (se crean y rotan fuera de este código). Una persona con autorización revisa y ejecuta el plan; aquí solo se produce texto. Función pura; no se importa desde la aplicación.
const NAME = /^[A-Za-z0-9_]{1,64}$/;
const q = (id: string) => `\`${id}\``;

function tableGrants(schema: string, account: string, policy: PrivilegePolicy): string[] {
  const out: string[] = [];
  for (const table of Object.keys(policy)) {
    const plain: string[] = [];
    for (const spec of policy[table]) {
      const m = /^([A-Z ]+?)(?:\((.*)\))?$/.exec(spec) as RegExpExecArray;
      if (m[2] === undefined) plain.push(m[1].trim());
      else out.push(`GRANT ${m[1].trim()} (${m[2].split(',').map(c => q(c.trim())).join(', ')}) ON ${q(schema)}.${q(table)} TO ${account}`);
    }
    if (plain.length) out.unshift(`GRANT ${plain.join(', ')} ON ${q(schema)}.${q(table)} TO ${account}`);
  }
  return out;
}

/** Sentencias GRANT (solo texto, para revisión) de un rol. Lanza `INVALID_ACCOUNT` ante identificadores inválidos o un host con comodines. */
export function buildAccountGrantPlan(role: AccountRole, input: { schema: string; user: string; host: string }): string[] {
  const { schema, user, host } = input ?? ({} as { schema: string; user: string; host: string });
  if (typeof schema !== 'string' || !NAME.test(schema) || typeof user !== 'string' || typeof host !== 'string' || parseAccount(`${user}@${host}`) === null || /[%_]/.test(host)) throw new Error('INVALID_ACCOUNT');
  const account = `${q(user)}@${q(host)}`;
  if (role === 'runtime') return tableGrants(schema, account, RUNTIME_PRIVILEGE_POLICY);
  if (role === 'registryWriter') return tableGrants(schema, account, REGISTRY_WRITER_POLICY);
  if (role === 'migration') return [`GRANT ${MIGRATION_SCHEMA_PRIVILEGES.join(', ')} ON ${q(schema)}.* TO ${account}`];
  throw new Error('INVALID_ACCOUNT');
}
