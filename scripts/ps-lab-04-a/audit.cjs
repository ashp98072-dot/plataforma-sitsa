// Offline consistency checks of already selected packages. NEVER an APT resolver.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { compare } = require('./debian-version.cjs');
const directory = path.resolve(__dirname, '../../docs/integraciones/pricesmart/s06b1/ps-lab-04-a');
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const read = name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8'));
function atom(text) {
  const m = /^([a-z0-9+.-]+)(?::(any|native|amd64))?(?:\s*\((<<|<=|=|>=|>>)\s*([^()]+)\))?$/.exec(text.trim());
  if (!m) throw new Error('Unsupported relation: ' + text);
  return { name: m[1], qualifier: m[2], op: m[3], version: m[4] };
}
function matches(record, requirement) {
  if (requirement.qualifier === 'any' && !['allowed', 'foreign'].includes(record['Multi-Arch'])) return false;
  const satisfies = version => !requirement.op || ({ '=': compare(version, requirement.version) === 0, '>=': compare(version, requirement.version) >= 0, '<=': compare(version, requirement.version) <= 0, '>>': compare(version, requirement.version) > 0, '<<': compare(version, requirement.version) < 0 })[requirement.op];
  if (record.Package === requirement.name) return satisfies(record.Version);
  return (record.Provides || '').split(',').filter(Boolean).some(value => {
    const p = atom(value);
    return p.name === requirement.name && (!requirement.op || (p.op === '=' && satisfies(p.version)));
  });
}
function inspect(records) {
  const errors = [];
  for (const record of records) {
    for (const field of ['Depends', 'Pre-Depends']) {
      for (const group of (record[field] || '').split(',').filter(Boolean)) {
        try {
          const alternatives = group.split('|').map(atom);
          if (!alternatives.some(a => records.some(r => matches(r, a)))) errors.push(`MISSING:${record.Package}:${field}:${group.trim()}`);
        } catch { errors.push(`UNSUPPORTED:${record.Package}:${group.trim()}`); }
      }
    }
    for (const field of ['Conflicts', 'Breaks']) {
      for (const group of (record[field] || '').split(',').filter(Boolean)) {
        try {
          const a = atom(group);
          for (const r of records) if (r.Package !== record.Package && matches(r, a)) errors.push(`CONFLICT:${record.Package}:${field}:${r.Package}`);
        } catch { errors.push(`UNSUPPORTED:${record.Package}:${group.trim()}`); }
      }
    }
  }
  return [...new Set(errors)].sort();
}
function audit(baseline, manifest, verification, contents) {
  const errors = [];
  const check = (ok, message) => { if (!ok) errors.push(message); };
  check(baseline.packages.length === 690, 'BASELINE_COUNT');
  check(new Set(baseline.packages.map(p => p.Package)).size === 690, 'BASELINE_DUPLICATES');
  check(baseline.packages.every(p => p.Status === 'install ok installed' && ['amd64', 'all'].includes(p.Architecture)), 'BASELINE_STATE');
  check(manifest.baseline_status_sha256 === baseline.source_sha256, 'BASELINE_HASH');
  check(manifest.status === 'PROPOSED_NOT_INSTALLABLE' && manifest.download_authorized === false && manifest.selected_profile === null, 'UNAUTHORIZED_PROMOTION');
  check(manifest.node.version === '24.18.0' && manifest.node.payload_acquired === false, 'NODE_VERSION');
  check(verification.length === 5 && verification.flatMap(v => v.catalogs).length === 7 && verification.every(v => v.signature_valid), 'INCOMPLETE_INDEXES');
  const catalogs = new Map(verification.flatMap(v => v.catalogs).map(c => [c.name.replace(/\.gz$/, ''), c]));
  check(manifest.scenarios.map(s => s.profile).join(',') === 'core,hybrid,full', 'PROFILE_SET');
  check(contents.contents.files.includes('usr/bin/mariadb-dump database/mariadb-client'), 'DUMP_OWNER');
  const profiles = manifest.scenarios.map(s => {
    check(s.approved === false, 'PROFILE_APPROVAL:' + s.profile);
    const records = [...baseline.packages];
    const seen = new Set(records.map(p => p.Package));
    for (const p of s.packages) {
      check(!seen.has(p.name), 'BASELINE_CHANGE_OR_DUPLICATE:' + p.name); seen.add(p.name);
      check(['amd64', 'all'].includes(p.architecture), 'ARCH:' + p.name);
      check(/^[0-9a-f]{64}$/.test(p.sha256) && Number.isSafeInteger(p.size_bytes) && p.size_bytes > 0, 'PAYLOAD_METADATA:' + p.name);
      const official = /^https:\/\/(archive|security)\.ubuntu\.com\/ubuntu\//.test(p.url) || /^https:\/\/archive\.mariadb\.org\/mariadb-11\.8\.9\//.test(p.url);
      check(p.payload_acquired === false && !p.filename.includes('..') && official, 'ORIGIN:' + p.name);
      const catalog = catalogs.get(p.source_catalog);
      check(catalog && catalog.uncompressed_sha256 === p.source_catalog_sha256, 'INDEX_REFERENCE:' + p.name);
      if (p.name.startsWith('mariadb-') || p.name === 'libmariadb3') check(p.version === '1:11.8.9+maria~ubu2404', 'MARIADB_VERSION:' + p.name);
      const pins = {nginx:'1.24.0-2ubuntu7.19','nginx-common':'1.24.0-2ubuntu7.19',age:'1.1.1-1ubuntu0.24.04.3',acl:'2.3.2-1build1.1'};
      if (pins[p.name]) check(p.version === pins[p.name], 'PIN:' + p.name);
      records.push({Package:p.name,Version:p.version,Architecture:p.architecture,Depends:p.depends,'Pre-Depends':p.pre_depends,Conflicts:p.conflicts,Breaks:p.breaks,Recommends:p.recommends});
    }
    const staticErrors = inspect(records);
    check(s.deb_bytes === s.packages.reduce((n,p)=>n+p.size_bytes,0), 'PROFILE_BYTES:' + s.profile);
    check(JSON.stringify(s.mandatory_unresolved) === '[]' && JSON.stringify(s.conflicts_found) === '[]', 'INHERITED_GRAPH_BLOCKED:' + s.profile);
    errors.push(...staticErrors.map(e => s.profile + ':' + e));
    return {profile:s.profile,new_packages:s.packages.length,total_packages:records.length,payload_bytes:s.packages.reduce((n,p)=>n+p.size_bytes,0),baseline_changes:[],dump_owner_included:s.packages.some(p=>p.name==='mariadb-client'),recommends:s.packages.filter(p=>p.recommends).map(p=>({package:p.name,relation:p.recommends})),static_errors:staticErrors};
  });
  return {status:'PROPOSED_NOT_INSTALLABLE',apt_simulation:'NOT_EXECUTED',selected_profile:null,download_authorized:false,operational_isolation_certified:false,baseline_packages:baseline.packages.length,errors:[...new Set(errors)].sort(),profiles,limits:['Static selected-set checks only; no APT transaction, ordering or full Multi-Arch proof','No payload/maintscript/ELF inspection or installed file integrity','Historical signatures do not establish current freshness or security approval']};
}
function load() {
  const provenance = read('provenance.json');
  for (const p of provenance.copied) if (sha(fs.readFileSync(path.join(directory,p.file))) !== p.sha256) throw new Error('Integrity mismatch: ' + p.file);
  return audit(read('baseline-relations.json'),read('manifest.proposed.json'),read('verification.inherited.json'),read('contents.inherited.json'));
}
if (require.main === module) {
  try { const result=load(); console.log(JSON.stringify(result,null,2)); if(result.errors.length) process.exitCode=1; }
  catch (e) { console.error(e.message); process.exitCode=1; }
}
module.exports={audit,inspect,load,read,sha,matches,atom};
