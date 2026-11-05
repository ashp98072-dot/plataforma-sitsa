// Read originals only. Public-key verification uses an independent temporary keyring.
// No network fallback, acquisition, package execution, or writes to original evidence.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),zlib=require('node:zlib');
const {spawnSync}=require('node:child_process');
const assert=require('node:assert/strict');
const {read,sha}=require('./audit.cjs');
function parse(text) {
  return text.replace(/\r\n/g,'\n').trim().split(/\n\n+/).map(block=>{
    const result={}; let field;
    for(const line of block.split('\n')) {
      if(/^\s/.test(line)){assert(field);result[field]+=' '+line.trim();}
      else {const m=/^([^:]+):\s*(.*)$/.exec(line);assert(m);field=m[1];assert(!(field in result));result[field]=m[2];}
    }
    return result;
  });
}
function verify(source,guest,gpg) {
  const provenance=read('provenance.json');
  const bytes=name=>fs.readFileSync(path.join(source,name));
  for(const entry of provenance.original_inventory_checksums) assert.equal(sha(bytes(entry.file)),entry.sha256,entry.file);
  const originalSums=bytes('SHA256SUMS').toString().trim().split(/\r?\n/).map(line=>{const m=/^([a-f0-9]{64})  (.+)$/.exec(line);assert(m);return {file:m[2],sha256:m[1]};});
  assert.deepEqual(originalSums,provenance.original_inventory_checksums.map(({file,sha256})=>({file,sha256})));
  for(const p of provenance.copied) assert.equal(sha(fs.readFileSync(path.resolve(source,'..',p.source))),p.sha256,p.file);
  const guestRead=name=>fs.readFileSync(path.join(guest,name));
  const guestSums=guestRead('SHA256SUMS').toString().trim().split(/\r?\n/);
  assert.equal(guestSums.length,4);
  for(const line of guestSums){const m=/^([a-f0-9]{64}) [ *]([^/\\]+)$/.exec(line);assert(m);assert.equal(sha(guestRead(m[2])),m[1]);}
  const baseline=read('baseline-relations.json');
  assert.equal(sha(guestRead('guest-dpkg-status')),baseline.source_sha256);
  const status=parse(guestRead('guest-dpkg-status').toString());
  assert.equal(status.length,690);
  assert.deepEqual(status.map(r=>Object.fromEntries(Object.keys(baseline.packages[status.indexOf(r)]).map(k=>[k,r[k]]))),baseline.packages);
  const selections=guestRead('guest-selections.txt').toString().trim().split(/\r?\n/).map(l=>l.trim().split(/\s+/));
  assert.equal(selections.length,690);assert.equal(new Set(selections.map(s=>s[0])).size,690);
  assert(selections.every(([name,state])=>state==='install' && baseline.packages.some(p=>p.Package===name.split(':')[0])));
  assert.equal(guestRead('guest-architectures.txt').toString().replace(/\r\n/g,'\n').trim(),'PRIMARY\namd64\nFOREIGN');
  assert.equal(guestRead('guest-dpkg-audit.txt').toString().trim(),'dpkg_audit_exit=0');
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'ps-lab04a-public-'));
  // Git for Windows GPG uses MSYS paths; native GPG uses Windows paths.
  const gpgPath=value=>process.platform==='win32' && /[\\/]Git[\\/]usr[\\/]bin[\\/]gpg\.exe$/i.test(gpg)
    ? value.replace(/\\/g,'/').replace(/^([A-Za-z]):/,(_,drive)=>'/'+drive.toLowerCase()) : value;
  const invoke=args=>{
    const r=spawnSync(gpg,['--no-options','--homedir',gpgPath(home),'--batch','--no-autostart','--no-auto-key-retrieve',...args.map(gpgPath)],{encoding:'utf8',maxBuffer:2000000});
    assert.equal(r.status,0,'GPG failed; no automatic acquisition permitted');return r;
  };
  try {
    for(const key of ['ubuntu-archive-key.asc','mariadb-keyring.gpg','node-key.asc']) invoke(['--import',path.join(source,'metadata',key)]);
    const reports=read('verification.inherited.json');
    const clears=new Map();
    for(const v of reports){
      const name=v.name==='node-SHASUMS256.txt.asc'?v.name:v.name+'-InRelease';
      const r=invoke(['--status-fd','2','--decrypt',path.join(source,'metadata',name)]);
      assert(r.stderr.includes('VALIDSIG '+v.fingerprint+' '));
      assert(!/\[GNUPG:\] (BADSIG|EXPKEYSIG|EXPSIG|REVKEYSIG|KEYREVOKED|KEYEXPIRED|SIGEXPIRED)/.test(r.stderr));
      const clear=r.stdout.replace(/\r\n/g,'\n');clears.set(v.name,clear);
      if(v.name.startsWith('node-')) {assert.equal(clear.trim(),bytes('metadata/node-SHASUMS256.txt').toString().trim());assert(clear.includes(read('manifest.proposed.json').node.sha256+'  node-v24.18.0-linux-x64.tar.xz'));continue;}
      assert.equal(sha(bytes('metadata/'+name)),v.inrelease_sha256);
      assert.equal(/^Date: (.+)$/m.exec(clear)?.[1],v.date);
      assert.equal(/^Valid-Until: (.+)$/m.exec(clear)?.[1]||null,v.valid_until);
      const block=clear.split('SHA256:\n')[1]?.split(/\n\S/)[0];assert(block);
      const lines=block.trim().split('\n').map(l=>l.trim().split(/\s+/));
      for(const c of v.catalogs){
        const component=c.name.includes('-universe-')?'universe':'main';
        for(const compressed of [true,false]){
          const relative=component+'/binary-amd64/Packages'+(compressed?'.gz':'');
          const entry=lines.find(l=>l[2]===relative);assert(entry,'Incomplete signed index');
          const name=c.name.replace(/\.gz$/,compressed?'.gz':'');const b=bytes('metadata/'+name);
          assert.equal(sha(b),entry[0]);assert.equal(b.length,Number(entry[1]));
          if(compressed) assert.equal(sha(zlib.gunzipSync(b)),c.uncompressed_sha256);
        }
      }
    }
    const contents=read('contents.inherited.json').contents;
    const cb=bytes('metadata/mariadb-Contents-amd64.gz');assert.equal(sha(cb),contents.sha256);assert.equal(cb.length,contents.size);
    assert(clears.get('mariadb').split('\n').some(l=>l.trim().replace(/\s+/g,' ')===`${contents.sha256} ${contents.size} Contents-amd64.gz`));
    const contentText=zlib.gunzipSync(cb).toString();
    for(const file of contents.files) assert(contentText.split('\n').some(l=>l.trim().replace(/\s+/g,' ')===file));
    const catalogs=new Map();
    for(const s of read('manifest.proposed.json').scenarios) for(const p of s.packages){
      if(!catalogs.has(p.source_catalog)) catalogs.set(p.source_catalog,parse(bytes('metadata/'+p.source_catalog).toString()));
      const r=catalogs.get(p.source_catalog).find(r=>r.Package===p.name&&r.Version===p.version&&r.Architecture===p.architecture);assert(r,'Missing exact catalog record');
      for(const [field,key] of Object.entries({SHA256:'sha256',Filename:'filename',Size:'size_bytes',Depends:'depends','Pre-Depends':'pre_depends',Conflicts:'conflicts',Breaks:'breaks',Replaces:'replaces',Recommends:'recommends'})) assert.equal(String(r[field]??''),String(p[key]??''),p.name+':'+field);
    }
    return {original_checksums:41,guest_checksums:4,baseline_packages:690,holds:0,signatures_reverified:5,signed_catalogs:7,contents_verified:true,exact_selected_records_verified:true,trust_anchor:'Inherited official fingerprints; independent source provenance not re-researched',freshness_approved:false,apt_simulation:'NOT_EXECUTED',status:'PROPOSED_NOT_INSTALLABLE'};
  } finally { fs.rmSync(home,{recursive:true,force:true}); }
}
if(require.main===module){try {assert.equal(process.argv.length,5,'Arguments: source-ps-lab-04 guest-evidence gpg-executable');console.log(JSON.stringify(verify(...process.argv.slice(2)),null,2));} catch(e){console.error(e.message);process.exitCode=1;}}
module.exports={parse,verify};
