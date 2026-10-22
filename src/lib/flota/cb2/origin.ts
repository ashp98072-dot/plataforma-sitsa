import { ErrorCB2 } from "./model";

// Server-owned configuration, never inferred from Host / X-Forwarded-*.
const PUBLIC_ORIGIN = "https://novalvion.com";
function originURL(value: string): URL | undefined {
    try {
        const url = new URL(value);
        return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url : undefined;
    } catch { return undefined; }
}
export function validarOrigenCB2(req: Request) {
    const configured = process.env.CB2_PUBLIC_ORIGIN ?? PUBLIC_ORIGIN;
    const publicURL = originURL(configured);
    if (!publicURL || publicURL.protocol !== "https:" || configured !== publicURL.origin || configured.includes("*"))
        throw new ErrorCB2("La configuración de acceso a Combustibles no es válida. Contacta al administrador.", 503);
    const trusted = new Set([publicURL.origin]);
    const requestURL = new URL(req.url);
    if (process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(requestURL.hostname))
        trusted.add(requestURL.origin);
    const origin = req.headers.get("origin");
    const referer = req.headers.get("referer");
    const source = origin !== null ? originURL(origin) : referer ? originURL(referer) : undefined;
    if (!source || (origin !== null && origin !== source.origin) || !trusted.has(source.origin) || req.headers.get("sec-fetch-site") === "cross-site")
        throw new ErrorCB2("No pudimos verificar el origen de la solicitud. Abre Combustibles desde la plataforma e inténtalo de nuevo.", 403);
}
