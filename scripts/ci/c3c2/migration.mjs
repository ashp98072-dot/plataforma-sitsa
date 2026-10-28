import fs from 'node:fs';
import path from 'node:path';
import {sentencias,prepararMigracion} from '../c3c1/safety.mjs';
export function sqlC3c2(repo,database,engine){
  if(!/^c3c1_lab_[a-f0-9]{32}$/.test(database)||!['mysql','mariadb'].includes(engine))throw Error('C3C2_DESTINO_INVALIDO');
  const c3c1=prepararMigracion(fs.readFileSync(path.join(repo,'sql/migrate-2026-10-contabilidad-calendario-c3c1.sql'),'utf8'),database);
  let text=fs.readFileSync(path.join(repo,'sql/migrate-2026-10-contabilidad-periodos-c3c2.sql'),'utf8');
  if(engine==='mysql')text=text.replace('DROP CONSTRAINT ck_cp_estado','DROP CHECK ck_cp_estado');
  const c3c2=sentencias(text);
  if(c3c2.length!==8||c3c2.some(s=>!/^ALTER TABLE cont_periodos |^CREATE TABLE cont_(control|periodos)_/.test(s)))throw Error('C3C2_MIGRACION_FUERA_CONTRATO');
  return [...c3c1,...c3c2];
}
