import { spawn } from 'node:child_process';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verify } from './artifact.mjs';
import { sandboxMode, validateSandboxConfig } from './sandbox-config.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
try {
  if (!sandboxMode() || !/^24\./.test(process.versions.node)) throw new Error('profile');
  const manifest = verify(root, process.env.S05_ARTIFACT_SHA256, true);
  if (process.platform !== 'linux' || manifest.arch !== process.arch || manifest.node !== process.versions.node || process.env.NODE_OPTIONS || process.env.NODE_PATH) throw new Error('platform');
  validateSandboxConfig(process.env, root);
  if (process.env.PORT !== '3000') throw new Error('port');
  const child = spawn(process.execPath, [join(root, 'server.js')], {
    cwd: root, stdio: 'inherit', env: { ...process.env, HOSTNAME: '127.0.0.1', PORT: '3000', NODE_ENV: 'production' },
  });
  const terminate = () => child.kill('SIGTERM');
  const interrupt = () => child.kill('SIGINT');
  process.once('SIGTERM', terminate); process.once('SIGINT', interrupt);
  child.once('error', () => { console.error('S05_START_FAILED'); process.exitCode = 1; });
  child.once('exit', (code, signal) => {
    process.removeListener('SIGTERM', terminate); process.removeListener('SIGINT', interrupt);
    process.exitCode = code ?? (signal === 'SIGTERM' ? 143 : signal === 'SIGINT' ? 130 : 1);
  });
} catch { console.error('S05_START_REJECTED'); process.exitCode = 1; }
