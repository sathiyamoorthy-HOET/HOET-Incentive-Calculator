import Link from "next/link";
import { notFound } from "next/navigation";
import { loadRun } from "@/app/actions";
import { SavedRunPanel } from "@/components/panels";

export const metadata = { title: "Saved run" };

/** One saved run, at its own address, priced with the rate card of the day. */
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const runId = Number(id);
  if (!Number.isInteger(runId) || runId <= 0) notFound();

  const res = await loadRun(runId);
  if (!res.ok) {
    return (
      <section className="panel on">
        <h2>Saved run</h2>
        <div className="note bad">{res.error}</div>
        <p className="sub">
          <Link href="/history">Back to History</Link>
        </p>
      </section>
    );
  }

  return (
    <SavedRunPanel
      id={runId}
      monthLabel={res.monthLabel}
      fileName={
        (res.monthLabel ? res.monthLabel + " · " : "") + (res.fileName || "Saved run")
      }
      rows={res.rows}
      snapshot={res.config}
    />
  );
}
