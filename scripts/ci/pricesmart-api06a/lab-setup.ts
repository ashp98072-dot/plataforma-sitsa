import dgram from "node:dgram";
import dns from "node:dns";
import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import { readFileSync } from "node:fs";
import { beforeEach, vi } from "vitest";
import { guardedConnect } from "./netguard.mjs";

// Guardia de red del laboratorio API-06A: la ÚNICA conexión permitida es el pipe administrativo del run o 127.0.0.1:<puerto del run>.
// Cualquier otro destino (MySQL80 :3306, PostgreSQL, Hostinger, DNS, HTTP) lanza ANTES de abrir un socket.
const manifestPath = process.env.PS06A_MANIFEST;
if (!manifestPath) throw new Error("API-06A: falta PS06A_MANIFEST; este archivo solo se carga desde el ejecutor del laboratorio.");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { pipe: string; port: number };
const original = net.Socket.prototype.connect;

beforeEach(() => {
  const denied = () => { throw new Error("API-06A: acceso de red prohibido fuera de 127.0.0.1:<puerto del laboratorio>"); };
  vi.spyOn(net.Socket.prototype, "connect").mockImplementation(guardedConnect(original, manifest) as never);
  vi.spyOn(tls, "connect").mockImplementation(denied);
  vi.spyOn(http, "request").mockImplementation(denied);
  vi.spyOn(https, "request").mockImplementation(denied);
  vi.spyOn(http, "get").mockImplementation(denied);
  vi.spyOn(https, "get").mockImplementation(denied);
  vi.spyOn(dgram, "createSocket").mockImplementation(denied);
  vi.spyOn(dns, "lookup").mockImplementation(denied);
  vi.stubGlobal("fetch", denied);
});
