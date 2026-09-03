"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { compute } from "@/lib/calc";
import { monthName, parseMonth } from "@/lib/months";
import { ActiveRun, Config, SourceRow } from "@/lib/types";
import { settleUpload } from "@/app/actions";
import { useApp } from "./AppShell";
import RunTab from "./RunTab";
import ResultsTab from "./ResultsTab";
import TeamTab from "./TeamTab";
import RatesTab from "./RatesTab";
import MapTab from "./MapTab";

/**
 * One thin client wrapper per page. Each page file stays a Server Component so
 * it can own its metadata; the wrapper is what reaches into the shared state
 * held by AppShell.
 */

export function RunPanel() {
  const { config, month, setMonth, setRun } = useApp();
  const router = useRouter();
  return (
    <RunTab
      onLoaded={async (rows, fileName, source) => {
        /* The report's file name carries the period it covers, so fill the
           month from it rather than leaving a run unlabelled. Only when the
           box is empty: a month someone typed is never overwritten. */
        if (!month.trim()) {
          const m = parseMonth(fileName);
          if (m) setMonth(monthName(m));
        }

        /* Settle before showing any figures. A cut already paid for in an
           earlier month must not appear on Results as money owed. */
        const settled = await settleUpload(config, rows);
        if (!settled.ok) return settled.error;

        setRun({ rows: settled.rows, fileName, source, snapshot: null, savedId: null });
        router.push("/results");
        return null;
      }}
    />
  );
}

export function ResultsPanel() {
  const { config, activeConfig, run, result, month, update, setRun } = useApp();
  const router = useRouter();
  return (
    <ResultsTab
      config={activeConfig}
      liveConfig={config}
      run={run}
      result={result}
      month={month}
      update={update}
      onRerunLive={() => setRun((r) => (r ? { ...r, snapshot: null, savedId: null } : r))}
      onSaved={(id) => setRun((r) => (r ? { ...r, savedId: id } : r))}
      goRun={() => router.push("/run")}
    />
  );
}

/**
 * A run opened from History. The report and the rate card of the day come from
 * the URL's own server render, so the page is shareable: anyone signed in who
 * opens the link sees the same payout.
 */
export function SavedRunPanel({
  id,
  monthLabel,
  fileName,
  rows,
  snapshot,
}: {
  id: number;
  monthLabel: string;
  fileName: string;
  rows: SourceRow[];
  snapshot: Config;
}) {
  const { config, update, setRun, setMonth } = useApp();
  const router = useRouter();

  const run = useMemo<ActiveRun>(
    () => ({ rows, fileName, snapshot, savedId: id }),
    [rows, fileName, snapshot, id]
  );
  const result = useMemo(() => compute(snapshot, rows), [snapshot, rows]);

  return (
    <ResultsTab
      config={snapshot}
      liveConfig={config}
      run={run}
      result={result}
      month={monthLabel}
      update={update}
      onRerunLive={() => {
        setMonth(monthLabel);
        setRun({ rows, fileName, snapshot: null, savedId: null });
        router.push("/results");
      }}
      onSaved={() => {}}
      goRun={() => router.push("/run")}
    />
  );
}

export function TeamPanel() {
  const { config, update } = useApp();
  return <TeamTab config={config} update={update} />;
}

export function RatesPanel() {
  const { config, update } = useApp();
  return <RatesTab config={config} update={update} />;
}

export function MapPanel() {
  const { config, update } = useApp();
  return <MapTab config={config} update={update} />;
}
