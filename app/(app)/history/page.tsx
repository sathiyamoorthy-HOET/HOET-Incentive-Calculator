import { listRuns } from "@/app/actions";
import HistoryTab from "@/components/HistoryTab";

export const metadata = { title: "History" };

export default async function Page() {
  const runs = await listRuns();
  return <HistoryTab runs={runs} />;
}
