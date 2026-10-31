import { EventEmitter } from "node:events";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exists: vi.fn(), read: vi.fn(), spawn: vi.fn(), validate: vi.fn(), mode: vi.fn(),
}));
vi.mock("node:fs", () => ({ existsSync: mocks.exists, readFileSync: mocks.read }));
vi.mock("fs", () => ({ existsSync: mocks.exists, readFileSync: mocks.read }));
vi.mock("child_process", () => ({ spawn: mocks.spawn }));
vi.mock("node:child_process", () => ({ spawn: mocks.spawn }));
vi.mock("../../scripts/sandbox-config.mjs", () => ({ sandboxMode: mocks.mode, validateSandboxConfig: mocks.validate }));

const originalArgv = process.argv;
beforeEach(() => {
  process.argv = ["node", "script", "start"];
  vi.resetModules(); vi.clearAllMocks();
  mocks.exists.mockReturnValue(false); mocks.mode.mockReturnValue(false);
  mocks.spawn.mockReturnValue(Object.assign(new EventEmitter(), { kill: vi.fn() })); mocks.validate.mockReturnValue({});
  vi.spyOn(process, "once").mockReturnValue(process);
  vi.stubEnv("DB_USER", "fixture"); vi.stubEnv("PORT", "4316");
  vi.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => { process.argv = originalArgv; vi.restoreAllMocks(); vi.unstubAllEnvs(); });

it("preserves production next start arguments and inherited env", async () => {
  await import("../../scripts/start-hostinger.mjs");
  expect(mocks.validate).not.toHaveBeenCalled();
  expect(mocks.spawn.mock.calls[0][1].slice(1)).toEqual(["start", "-p", "4316"]);
  expect(mocks.spawn.mock.calls[0][2].env).toBe(process.env);
});
it("preserves first persistent env selection without overriding panel values", async () => {
  mocks.exists.mockReturnValue(true); mocks.read.mockReturnValue("DB_USER=other\nSTARTUP_TEST_FIXTURE=from-file");
  await import("../../scripts/start-hostinger.mjs");
  expect(mocks.read).toHaveBeenCalledOnce(); expect(process.env.DB_USER).toBe("fixture");
  expect(process.env.STARTUP_TEST_FIXTURE).toBe("from-file");
  delete process.env.STARTUP_TEST_FIXTURE;
});
it("validates sandbox before spawn, skips env files and binds loopback", async () => {
  mocks.mode.mockReturnValue(true);
  await import("../../scripts/start-hostinger.mjs");
  expect(mocks.validate).toHaveBeenCalledOnce(); expect(mocks.read).not.toHaveBeenCalled();
  expect(mocks.spawn.mock.calls[0][1].slice(1)).toEqual(["start", "-p", "4316", "-H", "127.0.0.1"]);
});
it("does not spawn when sandbox validation fails", async () => {
  mocks.mode.mockReturnValue(true); mocks.validate.mockImplementationOnce(() => { throw new Error("invalid sandbox"); });
  await expect(import("../../scripts/start-hostinger.mjs")).rejects.toThrow("invalid sandbox");
  expect(mocks.spawn).not.toHaveBeenCalled();
});
it("explicit sandbox command cannot silently start production", async () => {
  await expect(import("../../scripts/start-sandbox.mjs")).rejects.toThrow(/requiere/);
  expect(mocks.spawn).not.toHaveBeenCalled();
});
it.each([["start"], ["dev", "--hostname", "127.0.0.1"], ["build"], ["start", "-p", "4316"]])("preserves generic production CLI arguments %j", async (...args) => {
  process.argv = ["node", "script", ...args];
  await import("../../scripts/next-command.mjs");
  expect(mocks.validate).not.toHaveBeenCalled();
  expect(mocks.spawn.mock.calls[0][1].slice(1)).toEqual(args);
});
it("generic sandbox start validates before Next and binds loopback", async () => {
  mocks.mode.mockReturnValue(true);
  await import("../../scripts/next-command.mjs");
  expect(mocks.validate).toHaveBeenCalledOnce();
  expect(mocks.spawn.mock.calls[0][1].slice(1)).toEqual(["start", "--hostname", "127.0.0.1"]);
});
it.each([["dev"], ["build"], ["start", "--hostname", "0.0.0.0"]])("blocks unreviewed sandbox CLI arguments %j before spawn", async (...args) => {
  process.argv = ["node", "script", ...args]; mocks.mode.mockReturnValue(true);
  await expect(import("../../scripts/next-command.mjs")).rejects.toThrow(/solo permite/);
  expect(mocks.spawn).not.toHaveBeenCalled();
});
it("generic command never starts Next when validation fails", async () => {
  mocks.mode.mockReturnValue(true); mocks.validate.mockImplementationOnce(() => { throw new Error("invalid sandbox"); });
  await expect(import("../../scripts/next-command.mjs")).rejects.toThrow("invalid sandbox");
  expect(mocks.spawn).not.toHaveBeenCalled();
});
it("forwards shutdown signals in the generic production wrapper", async () => {
  await import("../../scripts/next-command.mjs");
  const handler = vi.mocked(process.once).mock.calls.find(([signal]) => signal === "SIGTERM")?.[1];
  expect(handler).toBeTypeOf("function");
  handler!();
  expect(mocks.spawn.mock.results[0].value.kill).toHaveBeenCalledWith("SIGTERM");
});
