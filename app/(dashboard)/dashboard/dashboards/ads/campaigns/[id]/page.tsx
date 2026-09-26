import { AdsDetailView } from "@/components/dashboards/ads-detail-view";
import { loadDetailPage } from "@/lib/dashboards/ads-detail-page";

export const dynamic = "force-dynamic";

/** Detalle de campaign (F57). La cuenta y el periodo viajan en la URL. */
export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { id } = await params;
  const data = await loadDetailPage({ level: "campaign", objectId: id, searchParams: await searchParams });

  return <AdsDetailView level="campaign" {...data} />;
}
