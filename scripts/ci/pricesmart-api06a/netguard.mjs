// PRICESMART-API-06A — lógica PURA de la guardia de red del laboratorio (la instala lab-setup.ts). Corrección de la ejecución 1: Node llama a
// Socket.prototype.connect con UN ÚNICO argumento que es un ARREGLO normalizado [opciones, callback] (net.createConnection → socket.connect(normalized)).
// La versión anterior lo trataba como ruta de pipe y rechazaba TODA conexión, incluida la permitida. Una forma desconocida se sigue negando (fail-closed).
import { isAllowedConnect } from './safety.mjs';

/** Destino de una llamada a Socket.prototype.connect, en cualquiera de sus formas: ([opciones, cb]) | (opciones[, cb]) | (puerto[, host][, cb]) | (ruta[, cb]). */
export function connectTarget(args) {
  let first = args[0];
  if (args.length === 1 && Array.isArray(first)) first = first[0];   // forma normalizada interna de Node
  if (first && typeof first === 'object' && !Array.isArray(first)) {
    return { host: first.host ?? 'localhost', port: first.port, path: first.path };
  }
  if (typeof first === 'number') return { host: typeof args[1] === 'string' ? args[1] : 'localhost', port: first };
  if (typeof first === 'string') {
    if (/^\d+$/.test(first)) return { host: typeof args[1] === 'string' ? args[1] : 'localhost', port: Number(first) };   // Node trata una cadena numérica como puerto
    return { path: first };
  }
  return { host: undefined, port: undefined, path: undefined };   // forma desconocida: isAllowedConnect la niega
}

/** Sustituto de Socket.prototype.connect: solo deja pasar el pipe del run o 127.0.0.1:<puerto del run>; lanza ANTES de abrir ningún socket. */
export function guardedConnect(original, manifest) {
  return function guarded(...args) {
    if (!isAllowedConnect(connectTarget(args), manifest)) throw new Error('API-06A: acceso de red prohibido fuera de 127.0.0.1:<puerto del laboratorio>');
    return original.apply(this, args);
  };
}
