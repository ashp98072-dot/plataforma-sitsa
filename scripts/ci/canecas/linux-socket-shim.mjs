// Solo laboratorio Linux/CI: redirige los sockets de pipe de Windows (\\.\pipe\...) que usan las pruebas
// y los CLI de Canecas hacia el socket Unix del MariaDB desechable. Se carga con NODE_OPTIONS=--import,
// así también aplica a los procesos hijo (CLI de instalación). No toca TCP ni TLS.
import { createRequire } from 'node:module';

const socket = process.env.CANECAS_LAB_UNIX_SOCKET;
if (socket && process.platform !== 'win32') {
  if (!/^\/[^\0]+$/.test(socket)) throw new Error('CANECAS_LAB_UNIX_SOCKET inválido');
  const mysql = createRequire(import.meta.url)('mysql2/promise');
  const pipe = /^\\\\\.\\pipe\\/;
  const redirigir = opciones => (opciones && typeof opciones === 'object' && typeof opciones.socketPath === 'string' && pipe.test(opciones.socketPath) ? { ...opciones, socketPath: socket } : opciones);
  for (const nombre of ['createPool', 'createConnection']) {
    const original = mysql[nombre];
    mysql[nombre] = (opciones, ...resto) => original.call(mysql, redirigir(opciones), ...resto);
  }
}
