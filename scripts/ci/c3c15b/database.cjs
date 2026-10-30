/* eslint-disable @typescript-eslint/no-require-imports -- Pol?tica y guard s?ncronos del preload Node --require. */
const mysql=require('mysql2/promise');
const rawPool=mysql.createPool.bind(mysql),rawConnection=mysql.createConnection.bind(mysql);
const {validateConfig,validateIdentity,validateGrants,fail}=require('./policy.cjs');
const identitySql='SELECT VERSION() version,@@port port,@@datadir datadir,@@bind_address bind,@@pid_file pidFile,DATABASE() db,CURRENT_USER() account,USER() login,@@foreign_key_checks fk,@@check_constraint_checks checks';
async function identity(query,c){const [r]=await query(identitySql);validateIdentity(r[0],c);return r[0];}
function options(c,password){validateConfig(c);return {host:c.host,port:c.port,user:c.user,password,database:c.database,connectTimeout:4000,multipleStatements:false};}
async function open(c,password){
 const connection=await rawConnection(options(c,password));
 try{await identity(connection.query.bind(connection),c);const [g]=await connection.query('SHOW GRANTS');try{validateGrants(g,c);}catch(e){e.grantShapes=g.map(r=>String(Object.values(r)[0]).split(' TO ')[0]);throw e;}return connection;}
 catch(e){connection.destroy();throw e;}
}
async function marker(query,ctx,ready=false){
 const [rows]=await query('SELECT token,estado FROM _c3c15_lab WHERE id=?',[ctx.id]);
 if(rows.length!==1||rows[0].token!==ctx.token||(ready&&rows[0].estado!=='READY'))fail('C15B_MARKER');
}
function guardConnection(conn,ctx,ready=false){
 if(conn._c15bGuard)return conn;
 conn._c15bGuard=true;
 const raw=conn.query.bind(conn),execute=conn.execute.bind(conn);
 const verify=async()=>{await identity(raw,ctx.config);await marker(raw,ctx,ready);};
 conn.query=async(...args)=>{await verify();return raw(...args);};
 conn.execute=async(...args)=>{await verify();return execute(...args);};
 for(const name of ['beginTransaction','commit','rollback']){const fn=conn[name].bind(conn);conn[name]=async(...args)=>{await verify();return fn(...args);};}
 return conn;
}
function verifiedPool(ctx,ready=false){
 const pool=rawPool({...options(ctx.config,ctx.password),connectionLimit:8});
 const get=pool.getConnection.bind(pool);
 pool.getConnection=async()=>{const c=await get();try{await identity(c.query.bind(c),ctx.config);await marker(c.query.bind(c),ctx,ready);return guardConnection(c,ctx,ready);}catch(e){c.destroy();throw e;}};
 for(const method of ['query','execute'])pool[method]=async(...args)=>{const c=await pool.getConnection();try{return await c[method](...args);}finally{c.release();}};
 return pool;
}
module.exports={identitySql,identity,open,options,marker,guardConnection,verifiedPool};
