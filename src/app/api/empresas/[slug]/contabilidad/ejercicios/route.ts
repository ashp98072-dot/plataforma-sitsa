import { ejerciciosGet, ejerciciosPost } from "@/lib/contabilidad/calendario-http";
type Ctx = { params: Promise<{ slug: string }> };
export async function GET(req: Request, { params }: Ctx) { return ejerciciosGet(req, (await params).slug); }
export async function POST(req: Request, { params }: Ctx) { return ejerciciosPost(req, (await params).slug); }
