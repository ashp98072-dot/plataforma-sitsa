import fs from 'node:fs';import {describe,it,expect} from 'vitest';
import {sqlC3c2} from '../../../scripts/ci/c3c2/migration.mjs';
describe('C3C2 artefactos SQL, sin ejecutar SQL',()=>{
  it.each(['mysql','mariadb'])('ensayo explícito genera variante %s y nunca activa ni altera historia',engine=>{
    const list=sqlC3c2(process.cwd(),'c3c1_lab_'+'a'.repeat(32),engine);expect(list).toHaveLength(10);
    expect(list.slice(2).join('\n')).not.toMatch(/INSERT\s+INTO|UPDATE\s+cont_asientos|DELETE\s+FROM|DROP\s+TABLE/i);
    expect(list[2]).toContain(engine==='mysql'?'DROP CHECK':'DROP CONSTRAINT');
  });
  it('rechaza destino operativo e incluye doble aprobación y ámbito compuesto',()=>{
    expect(()=>sqlC3c2(process.cwd(),'operativo','mysql')).toThrow('DESTINO_INVALIDO');
    const sql=fs.readFileSync('sql/migrate-2026-10-contabilidad-periodos-c3c2.sql','utf8');
    expect(sql).toContain('decisor_id<>solicitante_id');expect(sql).toContain('FOREIGN KEY(empresa_id,entidad_id,periodo_id)');expect(sql).toContain("DEFAULT 'NO_ACTIVADO'");
  });
});
