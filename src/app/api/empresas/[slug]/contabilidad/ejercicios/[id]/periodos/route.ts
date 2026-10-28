import { periodosGet } from "@/lib/contabilidad/calendario-http";
type Ctx = { params: Promise<{ slug: string; id: string }> };
export async function GET(req: Request, { params }: Ctx) {
  const { slug, id } = await params;
  return periodosGet(req, slug, id);
}
