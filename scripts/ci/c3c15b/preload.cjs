/* eslint-disable @typescript-eslint/no-require-imports -- Pol?tica y guard s?ncronos del preload Node --require. */
// Exclusivo del proceso Next del laboratorio. No se instala globalmente.
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),dns=require('node:dns'),dgram=require('node:dgram');
const {fail,validateConfig,envCandidates}=require('./policy.cjs');
const file=process.env.C3C15B_PRIVATE;if(!file)fail('C15B_PRIVATE_REQUIRED');
const ctx=JSON.parse(fs.readFileSync(file,'utf8'));validateConfig(ctx.config);
const candidates=new Set(envCandidates(ctx.config.repo).map(p=>path.resolve(p).toLowerCase()));
const forbidden=p=>typeof p==='string'&&(candidates.has(path.resolve(p).toLowerCase())||/(?:^|[\\/])(?:\.env(?:\.[^\\/]*)?|app\.env)$/.test(p));
const exists=fs.existsSync.bind(fs);
for(const name of ['readFile','readFileSync']){const original=fs[name];fs[name]=function(p,...args){if(forbidden(p))fail('C15B_ENV_READ_BLOCKED');return original.call(this,p,...args);};}
const promiseRead=fs.promises.readFile.bind(fs.promises);fs.promises.readFile=async(p,...args)=>{if(forbidden(p))fail('C15B_ENV_READ_BLOCKED');return promiseRead(p,...args);};
fs.existsSync=p=>{if(forbidden(p)&&exists(p))fail('C15B_ENV_FILE');return exists(p);};
const connect=net.Socket.prototype.connect;
net.Socket.prototype.connect=function(...args){
 let o=args[0];if(Array.isArray(o))o=o[0];if(typeof o==='number')o={port:o,host:typeof args[1]==='string'?args[1]:'localhost'};
 if(!o||!['127.0.0.1','localhost','::1'].includes(o.host)||![ctx.config.port,ctx.config.httpPort].includes(Number(o.port)))fail('C15B_NETWORK_BLOCKED');
 return connect.apply(this,args);
};
const lookup=dns.lookup.bind(dns);dns.lookup=(host,...a)=>{if(!['localhost','127.0.0.1','::1'].includes(host))fail('C15B_DNS_BLOCKED');return lookup(host,...a);};
for(const k of Object.keys(dns))if(k.startsWith('resolve')||k==='reverse')dns[k]=()=>fail('C15B_DNS_BLOCKED');
for(const k of Object.keys(dns.promises))if(k.startsWith('resolve')||k==='reverse'||k==='lookup')dns.promises[k]=()=>fail('C15B_DNS_BLOCKED');
dgram.createSocket=()=>fail('C15B_UDP_BLOCKED');
const db=require('./database.cjs'),mysql=require('mysql2/promise');
mysql.createPool=options=>{
 const allowed=['host','port','user','password','database','waitForConnections','connectionLimit','queueLimit','enableKeepAlive','timezone'];
 if(!options||Object.keys(options).some(k=>!allowed.includes(k)))fail('C15B_POOL_OPTIONS');
 if(options.host!==ctx.config.host||Number(options.port)!==ctx.config.port||options.database!==ctx.config.database||options.user!==ctx.config.user||options.password!==ctx.password)fail('C15B_POOL_TARGET');
 return db.verifiedPool(ctx,true);
};
mysql.createConnection=()=>fail('C15B_UNEXPECTED_CONNECTION');
Object.assign(process.env,{DB_HOST:ctx.config.host,DB_PORT:String(ctx.config.port),DB_NAME:ctx.config.database,DB_USER:ctx.config.user,DB_PASSWORD:ctx.password,AUTH_SECRET:ctx.authSecret,NEXT_TELEMETRY_DISABLED:'1'});
