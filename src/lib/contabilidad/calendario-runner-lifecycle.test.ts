import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {EventEmitter} from 'node:events';
import {describe,it,expect,vi} from 'vitest';
import {observarServidor,cerrarServidor} from '../../../scripts/ci/c3c1/lifecycle.mjs';
function fixture(){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'c3c1-mariadb-close-mock-'));
  fs.writeFileSync(path.join(dir,'server.log'),'');
  const child=Object.assign(new EventEmitter(),{pid:123,exitCode:null,signalCode:null,kill:vi.fn(()=>true)});
  return {dir,child,record:observarServidor(child,dir)};
}
describe('Runner MariaDB: cierre con mocks, sin base de datos',()=>{
  it('exige petición, salida 0 y evidencia de servidor',async()=>{
    const f=fixture();await cerrarServidor(f.record,f.dir,async()=>{
      fs.writeFileSync(path.join(f.dir,'server.log'),'Shutdown completed');f.child.emit('exit',0,null);
    },50);
    expect(f.child.kill).not.toHaveBeenCalled();expect(fs.readFileSync(path.join(f.dir,'shutdown.jsonl'),'utf8')).toContain('shutdown-confirmed');
  });
  it.each(['log','code','signal','request'])('rechaza cierre no acreditado: %s',async(mode)=>{
    const f=fixture();await expect(cerrarServidor(f.record,f.dir,async()=>{
      if(mode!=='log')fs.writeFileSync(path.join(f.dir,'server.log'),'Shutdown complete');
      f.child.emit('exit',mode==='code'?1:0,mode==='signal'?'SIGTERM':null);
      if(mode==='request')throw Error('fallo');
    },50)).rejects.toThrow('UNCONFIRMED');
  });
  it('timeout fuerza solo el hijo original y siempre falla',async()=>{
    const f=fixture();f.child.kill.mockImplementation(()=>{f.child.emit('exit',0,null);return true;});
    await expect(cerrarServidor(f.record,f.dir,()=>new Promise(()=>{}),10)).rejects.toThrow('UNCONFIRMED');
    expect(f.child.kill).toHaveBeenCalledWith(0);expect(f.child.kill).toHaveBeenCalledWith();
    expect(fs.readFileSync(path.join(f.dir,'shutdown.jsonl'),'utf8')).toContain('forced-stop');
  });
  it('no termina un PID que dejó de corresponder al hijo conservado',async()=>{
    const f=fixture();f.child.pid=999;
    await expect(cerrarServidor(f.record,f.dir,async()=>{},1)).rejects.toThrow('UNCONFIRMED');expect(f.child.kill).not.toHaveBeenCalled();
  });
  it('rechaza salida previa y no anuncia éxito antes del finally',async()=>{
    const f=fixture();f.child.emit('exit',0,null);const request=vi.fn();
    await expect(cerrarServidor(f.record,f.dir,request,10)).rejects.toThrow('BEFORE_SHUTDOWN');expect(request).not.toHaveBeenCalled();
    const runner=fs.readFileSync('scripts/ci/c3c1/run-windows.mjs','utf8');
    expect(runner.indexOf('pruebas y apagado confirmados')).toBeGreaterThan(runner.indexOf('await cerrarServidor'));
  });
});
