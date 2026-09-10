import { redirect } from "next/navigation";

type Props = { params: Promise<{ slug: string }> };

export default async function ReporteViajesPage({ params }: Props) {
  const { slug } = await params;
  redirect(`/e/${slug}/planes`);
}
