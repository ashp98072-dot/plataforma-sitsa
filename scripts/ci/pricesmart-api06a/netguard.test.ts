// Pruebas de la guardia de red con conexiones REALES de `net` contra servidores locales de prueba (sin MariaDB). Corrigen el hueco de la ejecución 1:
// allí la guardia rechazó la conexión legítima porque Node llama a Socket.prototype.connect con UN arreglo normalizado y la prueba estática solo probaba isAllowedConnect aislada.
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { connectTarget, guardedConnect } from "./netguard.mjs";
import { isAllowedConnect } from "./safety.mjs";

const servers: net.Server[] = [];
afterEach(() => { vi.restoreAllMocks(); while (servers.length) servers.pop()?.close(); });
const listenTcp = () => new Promise<{ srv: net.Server; port: number; accepted: () => number }>((resolve) => {
  let n = 0; const srv = net.createServer((s) => { n++; s.end(); }); servers.push(srv);
  srv.listen(0, "127.0.0.1", () => resolve({ srv, port: (srv.address() as net.AddressInfo).port, accepted: () => n }));
});
/** El evento 'connect' del cliente puede llegar antes que 'connection' del servidor: se espera (hasta 3 s) a que el servidor registre las conexiones esperadas. */
const until = async (cond: () => boolean) => { for (let i = 0; i < 60 && !cond(); i++) await new Promise((r) => setTimeout(r, 50)); };
const connects = (make: () => net.Socket) => new Promise<boolean>((resolve) => { const s = make(); s.once("connect", () => { s.destroy(); resolve(true); }); s.once("error", () => resolve(false)); });
/** Instala la guardia EXACTAMENTE como lab-setup.ts (vi.spyOn + mockImplementation sobre el prototipo). */
function install(manifest: { pipe: string; port: number }) {
  const original = net.Socket.prototype.connect;
  vi.spyOn(net.Socket.prototype, "connect").mockImplementation(guardedConnect(original, manifest) as never);
}

describe("connectTarget: todas las formas de llamar a Socket.prototype.connect", () => {
  it("el arreglo normalizado de Node (la causa del fallo de la ejecución 1) se desempaqueta", () => {
    expect(connectTarget([[{ host: "127.0.0.1", port: 59980 }, undefined]])).toEqual({ host: "127.0.0.1", port: 59980, path: undefined });
    expect(connectTarget([[{ path: "\\\\.\\pipe\\x" }, () => {}]])).toMatchObject({ path: "\\\\.\\pipe\\x" });
  });
  it("opciones, número+host, número solo, cadena numérica y ruta", () => {
    expect(connectTarget([{ host: "127.0.0.1", port: 5 }])).toEqual({ host: "127.0.0.1", port: 5, path: undefined });
    expect(connectTarget([{ port: 5 }])).toMatchObject({ host: "localhost", port: 5 });
    expect(connectTarget([5, "127.0.0.1"])).toMatchObject({ host: "127.0.0.1", port: 5 });
    expect(connectTarget([5])).toMatchObject({ host: "localhost", port: 5 });
    expect(connectTarget(["3306"])).toMatchObject({ host: "localhost", port: 3306 });
    expect(connectTarget(["\\\\.\\pipe\\x"])).toEqual({ path: "\\\\.\\pipe\\x" });
  });
  it("formas desconocidas se NIEGAN (fail-closed)", () => {
    const m = { pipe: "ps06a-x", port: 50123 };
    for (const args of [[], [undefined], [null], [[]], [[null, null]], [{}], [{ fd: 7 }], [true], [[[{ host: "127.0.0.1", port: 50123 }]]]]) expect(isAllowedConnect(connectTarget(args as never), m)).toBe(false);
  });
  it("las formas legítimas pasan isAllowedConnect y las ajenas no", () => {
    const m = { pipe: "ps06a-x", port: 50123 };
    expect(isAllowedConnect(connectTarget([[{ host: "127.0.0.1", port: 50123 }, undefined]]), m)).toBe(true);
    expect(isAllowedConnect(connectTarget([[{ path: "\\\\.\\pipe\\ps06a-x" }, undefined]]), m)).toBe(true);
    for (const args of [[[{ host: "127.0.0.1", port: 3306 }, undefined]], [[{ host: "localhost", port: 50123 }, undefined]], [[{ path: "\\\\.\\pipe\\MySQL" }, undefined]], [50123], ["3306"]]) expect(isAllowedConnect(connectTarget(args as never), m)).toBe(false);
  });
});

describe("guardia instalada como en lab-setup.ts, con sockets reales", () => {
  it("PERMITE 127.0.0.1:<puerto del laboratorio> en todas las formas de net.createConnection/net.connect y llega al servidor", async () => {
    const { port, accepted } = await listenTcp(); install({ pipe: "ps06a-test", port });
    expect(await connects(() => net.createConnection({ host: "127.0.0.1", port }))).toBe(true);
    expect(await connects(() => net.createConnection(port, "127.0.0.1"))).toBe(true);
    expect(await connects(() => net.connect({ host: "127.0.0.1", port, family: 4 }))).toBe(true);
    expect(await connects(() => net.connect(port, "127.0.0.1"))).toBe(true);
    await until(() => accepted() >= 4); expect(accepted()).toBe(4);
  });
  it("NIEGA con una excepción síncrona, ANTES de abrir un socket: otros puertos, localhost, ::1, hosts externos, 3306, 5432 y formas sin host", async () => {
    const lab = await listenTcp(); const other = await listenTcp(); install({ pipe: "ps06a-test", port: lab.port });
    const attempts: (() => net.Socket)[] = [
      () => net.createConnection({ host: "127.0.0.1", port: other.port }), () => net.createConnection(other.port, "127.0.0.1"), () => net.createConnection({ host: "127.0.0.1", port: lab.port + 1 }),
      () => net.createConnection({ host: "127.0.0.1", port: 3306 }), () => net.createConnection(5432, "127.0.0.1"), () => net.createConnection(33060, "127.0.0.1"),
      () => net.createConnection({ host: "localhost", port: lab.port }), () => net.createConnection({ host: "::1", port: lab.port }), () => net.createConnection({ host: "0.0.0.0", port: lab.port }),
      () => net.createConnection({ host: "mysql.hostinger.example", port: 3306 }), () => net.createConnection({ host: "203.0.113.5", port: lab.port }),
      () => net.createConnection(lab.port), () => net.createConnection({ port: lab.port }), () => net.createConnection("3306"),
    ];
    for (const attempt of attempts) expect(attempt).toThrow(/prohibido/);
    expect(lab.accepted()).toBe(0); expect(other.accepted()).toBe(0);   // ningún intento llegó a un servidor
  });
  it.skipIf(process.platform !== "win32")("PERMITE el pipe del laboratorio (ruta y opciones) y NIEGA cualquier otro pipe", async () => {
    const name = `ps06a-guard-test-${process.pid}-${Date.now()}`; const pipePath = `\\\\.\\pipe\\${name}`;
    let n = 0; const srv = net.createServer((s) => { n++; s.end(); }); servers.push(srv); await new Promise<void>((r) => srv.listen(pipePath, () => r()));
    install({ pipe: name, port: 50999 });
    expect(await connects(() => net.createConnection({ path: pipePath }))).toBe(true);
    expect(await connects(() => net.createConnection(pipePath))).toBe(true);
    await until(() => n >= 2); expect(n).toBe(2);
    expect(() => net.createConnection({ path: "\\\\.\\pipe\\MySQL" })).toThrow(/prohibido/);
    expect(() => net.createConnection("\\\\.\\pipe\\otro")).toThrow(/prohibido/);
  }, 30000);
  it("el desempaquetado es lo que lo hace funcionar: con la lógica anterior (arreglo tratado como ruta) la conexión legítima habría sido rechazada", () => {
    const old = (args: unknown[]) => { const first = args[0]; if (first && typeof first === "object" && !Array.isArray(first)) return first as object; if (typeof first === "number") return { host: "localhost", port: first }; return { path: String(first) }; };
    const normalized = [[{ host: "127.0.0.1", port: 50123 }, undefined]];
    expect(isAllowedConnect(old(normalized) as never, { pipe: "x", port: 50123 })).toBe(false);          // defecto reproducido
    expect(isAllowedConnect(connectTarget(normalized as never), { pipe: "x", port: 50123 })).toBe(true);  // corregido
  });
});

describe("lab-setup.ts usa la guardia corregida", () => {
  const src = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "lab-setup.ts"), "utf8");
  it("importa guardedConnect y no conserva análisis propio de argumentos", () => {
    expect(src).toContain('import { guardedConnect } from "./netguard.mjs"'); expect(src).toContain("guardedConnect(original, manifest)");
    expect(src).not.toMatch(/function target\(|String\(first\)|isAllowedConnect/);
    for (const need of ["tls, \"connect\"", "http, \"request\"", "https, \"request\"", "dgram, \"createSocket\"", "dns, \"lookup\"", "stubGlobal(\"fetch\""]) expect(src).toContain(need);   // el resto de bloqueos sigue
  });
});
