import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validarOrigenCB2 } from "./origin";
const publicOrigin = "https://novalvion.com";
const request = (headers: Record<string, string>, url = "http://internal:3000/api/preview") => new Request(url, { method: "POST", headers });
beforeEach(() => { vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("CB2_PUBLIC_ORIGIN", undefined); });
afterEach(() => vi.unstubAllEnvs());
describe("origen CB2 fijado por el servidor", () => {
    it.each(["https://novalvion.com/api/preview", "http://internal:3000/api/preview", "http://127.0.0.1:3000/api/preview"])("acepta el origen público con URL directa o proxy: %s", url => {
        expect(() => validarOrigenCB2(request({ origin: publicOrigin }, url))).not.toThrow();
    });
    it("acepta Referer del mismo origen cuando el navegador omite Origin", () => {
        expect(() => validarOrigenCB2(request({ referer: `${publicOrigin}/e/kt-monaco/combustibles` }))).not.toThrow();
    });
    it.each<Record<string, string>>([
        {}, { origin: "https://externo.example" }, { origin: "https://novalvion.com.evil.test" },
        { origin: "https://sub.novalvion.com" }, { origin: "http://novalvion.com" },
        { origin: "https://novalvion.com:444" }, { origin: "null" }, { origin: "" },
        { origin: `${publicOrigin}, https://evil.test` }, { origin: `${publicOrigin}/path` },
        { origin: "https://user@novalvion.com" }, { referer: "https://externo.example/path" },
        { origin: "https://evil.test", referer: `${publicOrigin}/safe` },
        { origin: publicOrigin, "sec-fetch-site": "cross-site" },
        { origin: "http://internal:3000", host: "internal:3000" },
        { origin: "https://evil.test", "x-forwarded-host": "evil.test", "x-forwarded-proto": "https", forwarded: "host=evil.test;proto=https" },
        { host: "novalvion.com", "x-forwarded-host": "novalvion.com", "x-forwarded-proto": "https" },
    ])("rechaza cabeceras ausentes, externas o manipuladas: %j", headers => {
        expect(() => validarOrigenCB2(request(headers))).toThrow(expect.objectContaining({ status: 403 }));
    });
    it("no usa forwarded como fuente de confianza, incluso detrás del proxy", () => {
        expect(() => validarOrigenCB2(request({ origin: publicOrigin, "x-forwarded-host": "evil.test", "x-forwarded-proto": "http" }))).not.toThrow();
    });
    it("permite un único origen HTTPS de configuración, sin listas ni comodines", () => {
        vi.stubEnv("CB2_PUBLIC_ORIGIN", "https://staging.example");
        expect(() => validarOrigenCB2(request({ origin: "https://staging.example" }))).not.toThrow();
        expect(() => validarOrigenCB2(request({ origin: publicOrigin }))).toThrow();
    });
    it.each(["*", "https://*.example", "http://novalvion.com", "https://novalvion.com/path", "https://user@novalvion.com", "https://novalvion.com,https://evil.test", ""])("configuración inválida falla cerrada: %s", value => {
        vi.stubEnv("CB2_PUBLIC_ORIGIN", value);
        expect(() => validarOrigenCB2(request({ origin: publicOrigin }))).toThrow(expect.objectContaining({ status: 503 }));
    });
    it("localhost es solo desarrollo/pruebas, nunca producción", () => {
        const local = request({ origin: "http://localhost:3000" }, "http://localhost:3000/api/preview");
        expect(() => validarOrigenCB2(local)).toThrow();
        vi.stubEnv("NODE_ENV", "development");
        expect(() => validarOrigenCB2(local)).not.toThrow();
        expect(() => validarOrigenCB2(request({ origin: "https://evil.test" }, "https://evil.test/api/preview"))).toThrow();
    });
});
