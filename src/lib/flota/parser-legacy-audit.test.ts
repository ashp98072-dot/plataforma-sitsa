import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { analizarProveedorV2 } from "./combustible-importacion-v2";
import { fixtureHalelV2, fixtureShellV2 } from "./combustible-importacion-v2.fixture";
// Hash de JSON.stringify(preview) calculado con el parser de main
// 468ec843571c2d4a5f29458bbdf1f3a4e43ae1a4 y estas fixtures sintéticas.
// Antes de fijarlos se comparó deepEqual con el módulo original de ese commit.
it.each([
    ["HALEL", fixtureHalelV2, "7f2fffb4ab463c8387583f279da507c2a3b757fad7f744180280ad448675c375"],
    ["SHELL", fixtureShellV2, "59c4ed7522cd950bf698a25ea50b15708894902019268ffc86586444b05cce18"],
] as const)("reproducción completa parser histórico %s", async (perfil, fixture, esperado) => {
    const original = await analizarProveedorV2(await fixture(), perfil, undefined, 1);
    expect(createHash("sha256").update(JSON.stringify(original)).digest("hex")).toBe(esperado);
});
