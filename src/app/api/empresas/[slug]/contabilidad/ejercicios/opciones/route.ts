import { calendarioOpcionesGet } from "@/lib/contabilidad/calendario-http";
type Ctx = { params: Promise<{ slug: string }> };
export async function GET(_req: Request, { params }: Ctx) { return calendarioOpcionesGet((await params).slug); }
