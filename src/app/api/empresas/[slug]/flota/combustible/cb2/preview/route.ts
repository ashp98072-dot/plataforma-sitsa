import { cb2Http } from "@/lib/flota/cb2/http";
export const runtime = "nodejs";
export async function POST(req: Request, ctx: {
    params: Promise<{
        slug: string;
    }>;
}) {
    const p = await ctx.params;
    return cb2Http(req, p.slug, "preview");
}
