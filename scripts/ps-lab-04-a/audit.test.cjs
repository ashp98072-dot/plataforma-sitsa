const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {audit,inspect,load,read,sha}=require('./audit.cjs');
const {compare}=require('./debian-version.cjs');
const {parse}=require('./verify-local.cjs');
const inputs=()=>['baseline-relations.json','manifest.proposed.json','verification.inherited.json','contents.inherited.json'].map(read);
test('copied manifests match the verified provenance hashes',()=>{
  const provenance=read('provenance.json');assert.equal(provenance.original_inventory_checksums.length,41);
  assert.equal(provenance.guest_evidence.holds,0);assert.equal(load().errors.length,0);
  assert.notEqual(sha(Buffer.from('changed')),provenance.copied[0].sha256);
});
test('exact profiles preserve 690 baseline records without upgrades or removals',()=>{
  const args=inputs(),before=JSON.stringify(args);const result=audit(...args);
  assert.equal(JSON.stringify(args),before);
  assert.deepEqual(result.profiles.map(p=>[p.profile,p.new_packages,p.total_packages,p.payload_bytes,p.dump_owner_included]),[
    ['core',10,700,11008492,false],['hybrid',13,703,12926548,true],['full',18,708,27258326,true]]);
  const names=i=>new Set(args[1].scenarios[i].packages.map(p=>p.name));
  for(const name of names(0)) assert(names(1).has(name));
  for(const name of names(1)) assert(names(2).has(name));
  assert(result.profiles.every(p=>p.baseline_changes.length===0));
});
test('Debian epochs, revisions and prereleases use inherited comparator',()=>{
  for(const [a,b,result] of [['1:1','2',1],['1.0~rc1','1.0',-1],['1.0-1','1.0-1.1',-1],['1.01','1.1',0],['1.0','1.0-0',0]]) assert.equal(compare(a,b),result);
});
test('wrong pinned versions and architecture fail closed',()=>{
  const args=inputs();const p=args[1].scenarios[0].packages.find(p=>p.name==='nginx');p.version='1.24.0-2ubuntu7.18';p.architecture='arm64';
  const r=audit(...args);assert(r.errors.includes('PIN:nginx'));assert(r.errors.includes('ARCH:nginx'));
});
test('missing package reference and exact dependency are detected',()=>{
  const args=inputs();args[1].scenarios[0].packages=args[1].scenarios[0].packages.filter(p=>p.name!=='nginx-common');
  assert(audit(...args).errors.some(e=>e.startsWith('core:MISSING:nginx:')));
  assert(inspect([{Package:'a',Version:'1',Depends:'b (= 2)'},{Package:'b',Version:'1'}]).some(e=>e.startsWith('MISSING:')));
});
test('known conflicts and breaks in either direction block',()=>{
  assert.deepEqual(inspect([{Package:'nginx-common',Version:'1.24',Breaks:'nginx (<< 1.22.1-8)'},{Package:'nginx',Version:'1.20'}]),['CONFLICT:nginx-common:Breaks:nginx']);
  assert.deepEqual(inspect([{Package:'a',Version:'1'},{Package:'b',Version:'1',Conflicts:'a'}]),['CONFLICT:b:Conflicts:a']);
});
test('alternatives and versioned Provides checked without choosing packages',()=>{
  assert.deepEqual(inspect([{Package:'a',Version:'1',Depends:'missing | virtual (= 2)'},{Package:'provider',Version:'1',Provides:'virtual (= 2)'}]),[]);
  assert(inspect([{Package:'a',Version:'1',Depends:'b [amd64]'}]).some(e=>e.startsWith('UNSUPPORTED:')));
});
test('baseline mutation, duplicate and false promotion rejected',()=>{
  const args=inputs();args[0].packages.pop();args[1].scenarios[0].packages.push({...args[1].scenarios[0].packages[0],name:'adduser'});
  args[1].selected_profile='hybrid';args[1].download_authorized=true;
  const r=audit(...args);assert(r.errors.includes('BASELINE_COUNT'));assert(r.errors.includes('BASELINE_CHANGE_OR_DUPLICATE:adduser'));assert(r.errors.includes('UNAUTHORIZED_PROMOTION'));
});
test('incomplete indexes and wrong catalog digest fail closed',()=>{
  const args=inputs();args[2][0].catalogs.pop();args[1].scenarios[0].packages[0].source_catalog_sha256='0'.repeat(64);
  const r=audit(...args);assert(r.errors.includes('INCOMPLETE_INDEXES'));assert(r.errors.some(e=>e.startsWith('INDEX_REFERENCE:')));
});
test('Recommends retained as proposals and dump property is mandatory',()=>{
  const args=inputs();const result=audit(...args);assert(result.profiles[1].recommends[0].relation.includes('mariadb-client-compat'));
  args[3].contents.files=[];assert(audit(...args).errors.includes('DUMP_OWNER'));
});
test('deterministic outputs never claim APT validation or operational certification',()=>{
  const first=JSON.stringify(load());assert.equal(first,JSON.stringify(load()));const result=JSON.parse(first);
  assert.deepEqual(result,read('analysis.json'));
  assert.equal(result.status,'PROPOSED_NOT_INSTALLABLE');assert.equal(result.apt_simulation,'NOT_EXECUTED');assert.equal(result.operational_isolation_certified,false);assert.equal(result.download_authorized,false);assert.equal(result.selected_profile,null);
});
test('Deb822 parser rejects incomplete records and preserves continuation fields',()=>{
  assert.deepEqual(parse('Package: a\nDepends: b,\n c\n'),[{Package:'a',Depends:'b, c'}]);
  assert.throws(()=>parse('Package: a\nbroken'));assert.throws(()=>parse('Package: a\nPackage: b'));
});
test('analysis has no execution, network, installation or destructive instructions',()=>{
  const source=fs.readFileSync(path.join(__dirname,'audit.cjs'),'utf8');
  assert(!/child_process|\bfetch\s*\(|https?\.request|writeFile|rmSync|execSync|spawn/.test(source));
  const procedure=fs.readFileSync(path.resolve(__dirname,'../../docs/integraciones/pricesmart/s06b1/ps-lab-04-a/PROCEDIMIENTO-APT.md'),'utf8');
  assert(!/\b(?:sudo|curl|wget)\b|apt-get\s+(?:install|remove|purge|update|upgrade)|dpkg\s+--(?:install|remove)|Remove-Item|rm -rf/.test(procedure));
});
