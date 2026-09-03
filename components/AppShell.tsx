"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { compute } from "@/lib/calc";
import { describeChanges } from "@/lib/changes";
import { ActiveRun, Computed, Config } from "@/lib/types";
import { configProblem } from "@/lib/validate";
import { saveConfig } from "@/app/actions";
import { signOut } from "@/app/login/actions";
import Mark from "./Mark";
import ThemeToggle from "./ThemeToggle";

/** Every page of the app, in the order they appear in the rail. */
const TABS = [
  ["/run", "Run a month"],
  ["/history", "History"],
  ["/editors", "Editor reports"],
  ["/team", "Team"],
  ["/rate-card", "Rate card"],
  ["/video-types", "Video types"],
  ["/admin", "Admin"],
] as const;

type Sync = "idle" | "busy" | "ok" | "err";

type AppState = {
  /** The shared rate card as it is now, including unsaved local edits. */
  config: Config;
  /** The rate card the report on screen is priced with: a snapshot, or config. */
  activeConfig: Config;
  update: (fn: (draft: Config) => void) => void;
  /**
   * Holds edits back instead of saving them, for as long as a card that asks
   * for confirmation is open. Balanced by `closeGuard`.
   */
  openGuard: () => void;
  closeGuard: () => void;
  /** True while there are edits waiting to be confirmed or thrown away. */
  staging: boolean;
  /** What is waiting, in words. Empty when nothing has actually changed. */
  changes: string[];
  /** Keep the staged edits (true) or put the rate card back as it was. */
  endStage: (save: boolean) => void;
  month: string;
  setMonth: (m: string) => void;
  run: ActiveRun | null;
  setRun: React.Dispatch<React.SetStateAction<ActiveRun | null>>;
  result: Computed | null;
};

const AppCtx = createContext<AppState | null>(null);

export function useApp(): AppState {
  const v = useContext(AppCtx);
  if (!v) throw new Error("useApp must be used inside AppShell.");
  return v;
}

/** For components that are usually inside AppShell but need not insist on it. */
export function useMaybeApp(): AppState | null {
  return useContext(AppCtx);
}

/**
 * The chrome every page shares — header, page rail — plus the state that has to
 * outlive a navigation: the rate card being edited and the report on screen.
 * It lives in the route group's layout, which React keeps mounted as the URL
 * changes, so moving between pages never drops an uploaded report.
 */
export default function AppShell({
  initialConfig,
  userLabel,
  children,
}: {
  initialConfig: Config;
  userLabel: string;
  children: React.ReactNode;
}) {
  const [config, setConfig] = useState<Config>(initialConfig);
  const [run, setRun] = useState<ActiveRun | null>(null);
  const [month, setMonth] = useState("");
  const [sync, setSync] = useState<Sync>("idle");
  const [syncMsg, setSyncMsg] = useState("");
  const [, startTransition] = useTransition();
  const pathname = usePathname();

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingConfig = useRef<Config | null>(null);

  /* The rate card as it was when the first card was opened for editing, and a
     count of how many such cards are open. While one is, edits are held in the
     browser instead of being pushed: money is not changed for everybody on a
     700ms timer. The baseline is what Discard puts back. */
  const [baseline, setBaseline] = useState<Config | null>(null);
  const guards = useRef(0);
  /* Both of these are read from event handlers, never while rendering, so they
     are kept in step after the commit rather than during it. */
  const configRef = useRef(config);
  const stagingRef = useRef(false);
  useEffect(() => { configRef.current = config; }, [config]);
  useEffect(() => { stagingRef.current = baseline !== null; }, [baseline]);

  /* Pushes whatever the last edit produced. Separate from the debounce so the
     banner below can retry a save the database refused. */
  const flush = useCallback(async (): Promise<boolean> => {
    const toSave = pendingConfig.current;
    if (!toSave) return true;

    /* A duplicate name cannot be stored, and the database refuses the whole
       config when it sees one. Say so plainly instead of spending a round trip
       to be told in constraint language. */
    const problem = configProblem(toSave);
    if (problem) {
      setSync("err");
      setSyncMsg(problem);
      return false;
    }

    setSync("busy");
    setSyncMsg("Saving…");
    const res = await saveConfig(toSave);
    if (res.ok) {
      setSync("ok");
      setSyncMsg("Saved for everyone");
      return true;
    }
    setSync("err");
    setSyncMsg(res.error);
    return false;
  }, []);

  /* Config edits are frequent (every keystroke on a rate), so they are applied
     to local state at once and pushed to Supabase on a short debounce. */
  const update = useCallback((fn: (draft: Config) => void) => {
    setConfig((prev) => {
      const next: Config = JSON.parse(JSON.stringify(prev));
      fn(next);
      pendingConfig.current = next;
      return next;
    });

    if (stagingRef.current) return;

    if (timer.current) clearTimeout(timer.current);
    setSync("busy");
    setSyncMsg("Saving…");
    timer.current = setTimeout(flush, 700);
  }, [flush]);

  const openGuard = useCallback(() => {
    guards.current += 1;
    /* An edit made elsewhere may still be sitting on the debounce. Let it go
       now, so the baseline this card is measured against is a saved one and
       Discard cannot take something with it that was never staged. */
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
      flush();
    }
    setBaseline((b) => b ?? JSON.parse(JSON.stringify(configRef.current)));
  }, [flush]);

  /* Closing the last card does not save and does not discard: whatever was
     typed stays staged, and the bar at the foot of the page is what decides
     its fate. Only when nothing was actually changed does the baseline go. */
  const closeGuard = useCallback(() => {
    guards.current = Math.max(0, guards.current - 1);
    if (guards.current > 0) return;
    setBaseline((b) =>
      b && describeChanges(b, configRef.current).length === 0 ? null : b
    );
  }, []);

  const endStage = useCallback(async (save: boolean) => {
    const base = baseline;
    if (!base) return;
    if (save) {
      /* Staged edits never scheduled a flush, so this is the first the
         database hears of them. A refusal leaves them exactly where they were:
         still staged, still listed, and the reason is on screen. */
      const ok = await flush();
      if (!ok) return;
      setBaseline(guards.current > 0 ? JSON.parse(JSON.stringify(configRef.current)) : null);
    } else {
      const back: Config = JSON.parse(JSON.stringify(base));
      pendingConfig.current = null;
      setConfig(back);
      configRef.current = back;
      setBaseline(guards.current > 0 ? JSON.parse(JSON.stringify(back)) : null);
      setSync("idle");
      setSyncMsg("");
    }
  }, [baseline, flush]);

  const changes = useMemo(
    () => (baseline ? describeChanges(baseline, config) : []),
    [baseline, config]
  );

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  /* An edit lives in the browser for up to the debounce before it reaches the
     database. Closing the tab in that window would drop it silently, so ask. */
  useEffect(() => {
    if (sync !== "busy" && sync !== "err" && changes.length === 0) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [sync, changes.length]);

  const activeConfig = run?.snapshot ?? config;
  const result = useMemo(
    () => (run ? compute(activeConfig, run.rows) : null),
    [activeConfig, run]
  );

  const value = useMemo<AppState>(
    () => ({
      config, activeConfig, update, openGuard, closeGuard,
      staging: baseline !== null, changes, endStage,
      month, setMonth, run, setRun, result,
    }),
    [config, activeConfig, update, openGuard, closeGuard, baseline, changes, endStage, month, run, result]
  );

  return (
    <AppCtx.Provider value={value}>
      <header>
        <Link className="brand" href="/run">
          <Mark className="mark" />
          <h1>HOET Incentive calculator</h1>
        </Link>
        <div className="mo">
          <span>Month</span>
          <input
            type="text"
            value={month}
            onChange={(e) => setMonth(e.target.value)}
            placeholder="e.g. August 2026"
          />
        </div>
        <div className="sp" />
        <span
          className={"sync " + (changes.length ? "busy" : sync)}
          title={changes.length ? "These edits are not saved yet" : syncMsg}
        >
          <i />
          {changes.length
            ? changes.length === 1
              ? "1 change not saved"
              : changes.length + " changes not saved"
            : syncMsg || "All settings shared"}
        </span>
        <div className="row">
          <ThemeToggle />
          <span className="who">{userLabel}</span>
          <button className="lnk" onClick={() => startTransition(() => { signOut(); })}>
            Sign out
          </button>
        </div>
      </header>

      <nav className="tabs" aria-label="Pages">
        {TABS.map(([href, label]) => (
          <Link
            key={href}
            href={href}
            aria-current={
              pathname === href || pathname.startsWith(href + "/") ? "page" : undefined
            }
          >
            {label}
          </Link>
        ))}
      </nav>

      {sync === "err" && changes.length === 0 && (
        <div className="note bad savefail" role="alert">
          <strong>That change was not saved.</strong> {syncMsg}{" "}
          <button className="btn o" style={{ marginLeft: 8 }} onClick={() => flush()}>
            Try again
          </button>
        </div>
      )}

      <main>{children}</main>

      {changes.length > 0 && (
        <div className="note pending" role="status">
          <strong>
            {changes.length === 1
              ? "One change is waiting to be saved."
              : changes.length + " changes are waiting to be saved."}
          </strong>{" "}
          Nobody else sees any of this until you save it.
          <ul className="changes">
            {changes.slice(0, 8).map((line, i) => (
              <li key={i}>{line}</li>
            ))}
            {changes.length > 8 && <li className="muted">and {changes.length - 8} more</li>}
          </ul>
          {sync === "err" && (
            <p className="sub" style={{ color: "var(--rose)", margin: "0 0 10px" }}>
              <strong>That did not save.</strong> {syncMsg}
            </p>
          )}
          <div className="row">
            <button className="btn" onClick={() => endStage(true)} disabled={sync === "busy"}>
              {sync === "busy" ? "Saving…" : "Save for everyone"}
            </button>
            <button className="btn o" onClick={() => endStage(false)}>
              Discard
            </button>
          </div>
        </div>
      )}

    </AppCtx.Provider>
  );
}
