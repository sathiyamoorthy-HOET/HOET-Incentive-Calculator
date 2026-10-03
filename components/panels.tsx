"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { compute } from "@/lib/calc";
import { monthName, parseMonth } from "@/lib/months";
import { ActiveRun, Config, SourceRow } from "@/lib/types";
import { saveAdjustments, settleUpload } from "@/app/actions";
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

/**
 * Uploading a report and reading what it paid are one page, because they are
 * one job: the upload has no result to show, and the result has nothing to say
 * until a report is loaded. The uploader stands in until there is a run, and
 * "Run another report" puts it back.
 */
export function RunPanel() {
  const { config, activeConfig, run, result, month, setMonth, update, setRun } = useApp();

  if (run) {
    return (
      <ResultsTab
        config={activeConfig}
        liveConfig={config}
        run={run}
        result={result}
        month={month}
        setMonth={setMonth}
        update={update}
        setKudos={(name, v) =>
          setRun((r) => (r ? { ...r, kudos: { ...r.kudos, [name]: v } } : r))
        }
        setLeave={(name, v) =>
          setRun((r) => (r ? { ...r, leave: { ...r.leave, [name]: v } } : r))
        }
        onRerunLive={() => setRun((r) => (r ? { ...r, snapshot: null, savedId: null } : r))}
        onSaved={(id) => setRun((r) => (r ? { ...r, savedId: id } : r))}
        goRun={() => setRun(null)}
      />
    );
  }

  return (
    <RunTab
      onLoaded={async (rows, fileName, source, held) => {
        /* The window just confirmed says which month this is; failing that
           the file name usually carries the period. Only when the box is
           empty: a month someone typed is never overwritten. */
        let label = month.trim();
        if (!label) {
          const m = parseMonth(source.period?.to) || parseMonth(fileName);
          if (m) {
            label = monthName(m);
            setMonth(label);
          }
        }

        /* Settle before showing any figures. A cut already paid for in an
           earlier month must not appear on Results as money owed — but this
           month's own earlier save is not an earlier month. */
        const settled = await settleUpload(config, rows, label);
        if (!settled.ok) return settled.error;

        setRun({ rows: settled.rows, held, fileName, source, snapshot: null, savedId: null, kudos: {}, leave: {} });
        return null;
      }}
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
  kudos: savedKudos,
  leave: savedLeave,
}: {
  id: number;
  monthLabel: string;
  fileName: string;
  rows: SourceRow[];
  snapshot: Config;
  kudos: Record<string, number>;
  leave: Record<string, number>;
}) {
  const { config, update, setRun, setMonth } = useApp();
  const router = useRouter();

  /* Kudos and leave are what a saved run still takes: typed here,
     saved with their own button, and the figures every page then shows. */
  const [adj, setAdj] = useState({ kudos: savedKudos, leave: savedLeave });
  const [stored, setStored] = useState(adj);
  const dirty = useMemo(() => !sameMap(adj.kudos, stored.kudos) || !sameMap(adj.leave, stored.leave), [adj, stored]);

  const run = useMemo<ActiveRun>(
    () => ({ rows, fileName, snapshot, savedId: id, kudos: adj.kudos, leave: adj.leave }),
    [rows, fileName, snapshot, id, adj]
  );
  const result = useMemo(() => compute(snapshot, rows, adj.kudos, adj.leave), [snapshot, rows, adj]);

  return (
    <ResultsTab
      config={snapshot}
      liveConfig={config}
      run={run}
      result={result}
      month={monthLabel}
      update={update}
      setKudos={(name, v) => setAdj((a) => ({ ...a, kudos: { ...a.kudos, [name]: v } }))}
      setLeave={(name, v) => setAdj((a) => ({ ...a, leave: { ...a.leave, [name]: v } }))}
      adjustDirty={dirty}
      onSaveAdjust={async () => {
        const res = await saveAdjustments(id, adj);
        if (res.ok) {
          setStored(adj);
          router.refresh();
        }
        return res;
      }}
      onRerunLive={() => {
        setMonth(monthLabel);
        setRun({ rows, fileName, snapshot: null, savedId: null, kudos: adj.kudos, leave: adj.leave });
        router.push("/run");
      }}
      onSaved={() => {}}
      goRun={() => {
        setRun(null);
        router.push("/run");
      }}
    />
  );
}

function sameMap(a: Record<string, number>, b: Record<string, number>): boolean {
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...names].every((n) => (a[n] ?? null) === (b[n] ?? null));
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
