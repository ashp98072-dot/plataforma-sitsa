import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

describe("MiFirmaPanel — protección contra eliminación", () => {
  it("no muestra ni invoca la acción de eliminar firma", () => {
    const src = readFileSync(new URL("./mi-firma-panel.tsx", import.meta.url), "utf8");
    expect(src).not.toContain("Eliminar firma");
    expect(src).not.toContain('method: "DELETE"');
    expect(src).toContain("Cambiar firma");
  });
});
