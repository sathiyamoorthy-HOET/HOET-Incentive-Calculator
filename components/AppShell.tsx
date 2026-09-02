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
import { ActiveRun, Computed, Config } from "@/lib/types";
import { configProblem } from "@/lib/validate";
import { saveConfig } from "@/app/actions";
import { signOut } from "@/app/login/actions";
import Mark from "./Mark";
import ThemeToggle from "./ThemeToggle";

/** Every page of the app, in the order they appear in the rail. */
const TABS = [
  ["/run", "Run a month"],
  ["/results", "Results"],
  ["/history", "History"],
  ["/team", "Team"],
  ["/rate-card", "Rate card"],
  ["/video-types", "Video types"],
] as const;

type Sync = "idle" | "busy" | "ok" | "err";

type AppState = {
  /** The shared rate card as it is now, including unsaved local edits. */
  config: Config;
  /** The rate card the report on screen is priced with: a snapshot, or config. */
  activeConfig: Config;
  update: (fn: (draft: Config) => void) => void;
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

  /* Pushes whatever the last edit produced. Separate from the debounce so the
     banner below can retry a save the database refused. */
  const flush = useCallback(async () => {
    const toSave = pendingConfig.current;
    if (!toSave) return;

    /* A duplicate name cannot be stored, and the database refuses the whole
       config when it sees one. Say so plainly instead of spending a round trip
       to be told in constraint language. */
    const problem = configProblem(toSave);
    if (problem) {
      setSync("err");
      setSyncMsg(problem);
      return;
    }

    setSync("busy");
    setSyncMsg("Saving…");
    const res = await saveConfig(toSave);
    if (res.ok) {
      setSync("ok");
      setSyncMsg("Saved for everyone");
    } else {
      setSync("err");
      setSyncMsg(res.error);
    }
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

    if (timer.current) clearTimeout(timer.current);
    setSync("busy");
    setSyncMsg("Saving…");
    timer.current = setTimeout(flush, 700);
  }, [flush]);

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  /* An edit lives in the browser for up to the debounce before it reaches the
     database. Closing the tab in that window would drop it silently, so ask. */
  useEffect(() => {
    if (sync !== "busy" && sync !== "err") return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [sync]);

  const activeConfig = run?.snapshot ?? config;
  const result = useMemo(
    () => (run ? compute(activeConfig, run.rows) : null),
    [activeConfig, run]
  );

  const value = useMemo<AppState>(
    () => ({ config, activeConfig, update, month, setMonth, run, setRun, result }),
    [config, activeConfig, update, month, run, result]
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
        <span className={"sync " + sync} title={syncMsg}>
          <i />
          {syncMsg || "All settings shared"}
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

      {sync === "err" && (
        <div className="note bad savefail" role="alert">
          <strong>That change was not saved.</strong> {syncMsg}{" "}
          <button className="btn o" style={{ marginLeft: 8 }} onClick={() => flush()}>
            Try again
          </button>
        </div>
      )}

      <main>{children}</main>

    </AppCtx.Provider>
  );
}
