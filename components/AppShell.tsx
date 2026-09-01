"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { compute } from "@/lib/calc";
import { downloadSettings } from "@/lib/export";
import { Config, RunSummary, SourceRow } from "@/lib/types";
import { saveConfig } from "@/app/actions";
import { signOut } from "@/app/login/actions";
import RunTab from "./RunTab";
import ResultsTab from "./ResultsTab";
import TeamTab from "./TeamTab";
import RatesTab from "./RatesTab";
import MapTab from "./MapTab";
import HistoryTab from "./HistoryTab";

export type ActiveRun = {
  rows: SourceRow[];
  fileName: string;
  /** Set when viewing a saved run: prices it with the rate card of the day. */
  snapshot: Config | null;
  savedId: number | null;
};

const TABS = [
  ["run", "Run a month"],
  ["results", "Results"],
  ["history", "History"],
  ["team", "Team"],
  ["rates", "Rate card"],
  ["map", "Video types"],
] as const;

type Tab = (typeof TABS)[number][0];
type Sync = "idle" | "busy" | "ok" | "err";

export default function AppShell({
  initialConfig,
  initialRuns,
  userLabel,
}: {
  initialConfig: Config;
  initialRuns: RunSummary[];
  userLabel: string;
}) {
  const [config, setConfig] = useState<Config>(initialConfig);
  const [run, setRun] = useState<ActiveRun | null>(null);
  const [month, setMonth] = useState("");
  const [tab, setTab] = useState<Tab>("run");
  const [sync, setSync] = useState<Sync>("idle");
  const [syncMsg, setSyncMsg] = useState("");
  const [, startTransition] = useTransition();

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingConfig = useRef<Config | null>(null);

  /* Config edits are frequent (every keystroke on a rate), so they are applied
     to local state at once and pushed to Supabase on a short debounce. */
  const update = useCallback((fn: (draft: Config) => void) => {
    setConfig((prev) => {
      const next: Config = JSON.parse(JSON.stringify(prev));
      fn(next);
      pendingConfig.current = next;
      return next;
    });

    if (timer.current) clearTimeout(timer.current);
    setSync("busy");
    setSyncMsg("Saving…");
    timer.current = setTimeout(async () => {
      const toSave = pendingConfig.current;
      if (!toSave) return;
      const res = await saveConfig(toSave);
      if (res.ok) {
        setSync("ok");
        setSyncMsg("Saved for everyone");
      } else {
        setSync("err");
        setSyncMsg(res.error);
      }
    }, 700);
  }, []);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  const replaceConfig = useCallback(
    (next: Config) => update((draft) => Object.assign(draft, next)),
    [update]
  );

  const activeConfig = run?.snapshot ?? config;
  const result = useMemo(
    () => (run ? compute(activeConfig, run.rows) : null),
    [activeConfig, run]
  );

  const openRun = useCallback((r: ActiveRun) => {
    setRun(r);
    setTab("results");
  }, []);

  return (
    <>
      <header>
        <h1>HOET Incentive</h1>
        <div className="row" style={{ gap: 7 }}>
          <span style={{ color: "#9AA6B8", fontSize: 12 }}>Month</span>
          <input
            type="text"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            placeholder="e.g. August 2026"
          />
        </div>
        <div className="sp" />
        <span className={"sync " + sync} title={syncMsg}>
          <i />
          {syncMsg || "All settings shared"}
        </span>
        <div className="row">
          <button className="btn o" onClick={() => downloadSettings(config)}>
            Download settings
          </button>
          <button
            className="btn o"
            onClick={() => document.getElementById("loadCfg")?.click()}
          >
            Load settings
          </button>
          <span className="who">{userLabel}</span>
          <button className="lnk" onClick={() => startTransition(() => { signOut(); })}>
            Sign out
          </button>
        </div>
      </header>

      <nav className="tabs" role="tablist">
        {TABS.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id as Tab)}
          >
            {label}
          </button>
        ))}
      </nav>

      <main>
        {tab === "run" && (
          <RunTab
            onLoaded={(rows, fileName) =>
              openRun({ rows, fileName, snapshot: null, savedId: null })
            }
          />
        )}
        {tab === "results" && (
          <ResultsTab
            config={activeConfig}
            liveConfig={config}
            run={run}
            result={result}
            month={month}
            update={update}
            onRerunLive={() => setRun((r) => (r ? { ...r, snapshot: null, savedId: null } : r))}
            onSaved={(id) => setRun((r) => (r ? { ...r, savedId: id } : r))}
            goRun={() => setTab("run")}
          />
        )}
        {tab === "history" && <HistoryTab initialRuns={initialRuns} onOpen={openRun} />}
        {tab === "team" && <TeamTab config={config} update={update} />}
        {tab === "rates" && <RatesTab config={config} update={update} />}
        {tab === "map" && <MapTab config={config} update={update} />}
      </main>

      <input
        type="file"
        id="loadCfg"
        accept=".json"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          const fr = new FileReader();
          fr.onload = (ev) => {
            try {
              const j = JSON.parse(String(ev.target?.result));
              if (!j.rates || !j.team) throw new Error("bad");
              replaceConfig(j as Config);
            } catch {
              alert("That file is not a valid settings file.");
            }
          };
          fr.readAsText(f);
        }}
      />
    </>
  );
}
