import { createHash } from "node:crypto";

/** Serialización canónica JSON (claves ordenadas) para huellas estables. Solo datos JSON puros. */
export function serializarCanonico(input: unknown): string {
  if (input === null || typeof input === "string" || typeof input === "boolean") return JSON.stringify(input);
  if (typeof input === "number" && Number.isFinite(input)) return JSON.stringify(input);
  if (Array.isArray(input)) return `[${input.map(serializarCanonico).join(",")}]`;
  if (typeof input === "object" && input && Object.getPrototypeOf(input) === Object.prototype) {
    return `{${Object.keys(input)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${serializarCanonico((input as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  throw new TypeError("Solo se admiten valores JSON canónicos.");
}

export function huellaDe(input: unknown): string {
  return createHash("sha256").update(serializarCanonico({ version: 1, contenido: input })).digest("hex");
}
