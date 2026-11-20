import fs from 'node:fs';import path from 'node:path';import http from 'node:http';import next from 'next';
const ctx=JSON.parse(fs.readFileSync(process.env.C3C15B_PRIVATE,'utf8'));
const app=next({dev:true,dir:ctx.config.repo,hostname:'127.0.0.1',port:ctx.config.httpPort,webpack:true,
 conf:{distDir:'.next-c3c15b',serverExternalPackages:['mysql2','exceljs','pdfkit'],poweredByHeader:false,experimental:{cpus:1}}});
await app.prepare();const handler=app.getRequestHandler();let stopping=false;
const server=http.createServer(async(req,res)=>{
 const url=new URL(req.url,'http://127.0.0.1');
 if(url.pathname.startsWith('/_c15b/')){
  if(req.headers['x-c15b-token']!==ctx.token){res.writeHead(403).end();return;}
  if(url.pathname==='/_c15b/identity'){res.setHeader('Content-Type','application/json');res.end(JSON.stringify({id:ctx.id}));return;}
  if(url.pathname==='/_c15b/stop'&&req.method==='POST'&&!stopping){stopping=true;res.end('STOPPING');server.close(async()=>{await app.close();process.exit(0);});return;}
  res.writeHead(404).end();return;
 }
 const auth=/^\/api\/auth\/(login|logout|select-empresa|activity)$/.test(url.pathname);
 const read=req.method==='GET'||req.method==='HEAD';
 const page=/^\/(login|select-empresa)$/.test(url.pathname)||/^\/e\/qa-[ab]\/contabilidad(?:\/calendario)?\/?$/.test(url.pathname)||url.pathname.startsWith('/_next/')||/\.(svg|png|ico|woff2?)$/.test(url.pathname);
 const api=/^\/api\/empresas\/qa-[ab]\/contabilidad\//.test(url.pathname);
 const technical=/\/(politicas-autorizacion|expedientes|validacion-precontable|preparacion-regularizacion|origen-revisiones)$/.test(url.pathname);
 if(!((auth&&req.method==='POST')||(read&&(page||api))||(req.method==='POST'&&api&&technical))){res.writeHead(403,{'Content-Type':'application/json'}).end('{"error":"Ruta fuera del laboratorio C3C-15B"}');return;}
 await handler(req,res);
});
server.on('upgrade',app.getUpgradeHandler());
server.listen(ctx.config.httpPort,'127.0.0.1',()=>{
 fs.writeFileSync(path.join(path.dirname(process.env.C3C15B_PRIVATE),'next-instance.json'),JSON.stringify({id:ctx.id,pid:process.pid,port:ctx.config.httpPort,estado:'RUNNING'}));
 process.send?.({ready:true,id:ctx.id});
});
