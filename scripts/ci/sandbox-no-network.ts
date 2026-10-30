import net from "node:net";
import tls from "node:tls";
import http from "node:http";
import https from "node:https";
import dgram from "node:dgram";
import dns from "node:dns";
import { beforeEach, vi } from "vitest";

// Reinstalled after restoreAllMocks between cases. A network attempt fails the test.
beforeEach(() => {
  const denied = () => { throw new Error("S02: network access forbidden in offline tests"); };
  vi.spyOn(net.Socket.prototype, "connect").mockImplementation(denied);
  vi.spyOn(tls, "connect").mockImplementation(denied);
  vi.spyOn(http, "request").mockImplementation(denied);
  vi.spyOn(https, "request").mockImplementation(denied);
  vi.spyOn(http, "get").mockImplementation(denied);
  vi.spyOn(https, "get").mockImplementation(denied);
  vi.spyOn(dgram, "createSocket").mockImplementation(denied);
  vi.spyOn(dns, "lookup").mockImplementation(denied);
  vi.stubGlobal("fetch", denied);
});
