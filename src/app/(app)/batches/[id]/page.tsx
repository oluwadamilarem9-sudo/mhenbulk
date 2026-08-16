import { notFound, redirect } from "next/navigation";
import { z } from "zod";

import { BatchDetail } from "@/features/smart-batching/components/batch-detail";
import { getSmartBatchDetail } from "@/features/smart-batching/queries";
import { createClient } from "@/lib/supabase/server";

export const metadata = {
  title: "Smart Batch",
};

export default async function SmartBatchPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) notFound();
  const detail = await getSmartBatchDetail(user.id, id.data);
  if (!detail) notFound();

  return <BatchDetail detail={detail} />;
}
