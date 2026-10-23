// Solo para el smoke local de auditoría. Impide usar node_modules de worktrees padres.
import Module from "node:module";
import path from "node:path";
import { realpathSync } from "node:fs";
const root = realpathSync(process.cwd()).toLowerCase() + path.sep;
const resolver = Module._resolveFilename;
Module._resolveFilename = function (...args) {
  const resolved = Reflect.apply(resolver, this, args);
  if (path.isAbsolute(resolved) && resolved.includes(`${path.sep}node_modules${path.sep}`) && !resolved.toLowerCase().startsWith(root)) {
    throw new Error("El smoke local no permite fallback a node_modules externos.");
  }
  return resolved;
};
