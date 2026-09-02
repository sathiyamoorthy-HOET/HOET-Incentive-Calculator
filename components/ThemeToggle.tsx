"use client";

import { useSyncExternalStore } from "react";

type Theme = "dark" | "light";

/* The chosen theme lives on the document element, written before the first
   paint by the script in the root layout. That attribute is the single source
   of truth, so read it rather than keeping a second copy in React state. */
function subscribe(onChange: () => void) {
  const mo = new MutationObserver(onChange);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
}

const read = (): Theme =>
  document.documentElement.getAttribute("data-theme") === "light" ? "light" : "dark";

/** Dark and light, remembered per person under the key the Podcast SOP uses. */
export default function ThemeToggle() {
  const theme = useSyncExternalStore(subscribe, read, () => "dark" as Theme);
  const light = theme === "light";

  return (
    <button
      className="theme-btn"
      type="button"
      onClick={() => {
        const next: Theme = light ? "dark" : "light";
        document.documentElement.setAttribute("data-theme", next);
        try {
          localStorage.setItem("hoet-theme", next);
        } catch {
          /* private window: the choice simply does not outlive the session */
        }
      }}
      aria-label={light ? "Switch to dark mode" : "Switch to light mode"}
    >
      <span className="ti" aria-hidden="true">
        {light ? "☀" : "☾"}
      </span>
      <span className="tl">{light ? "Light" : "Dark"}</span>
    </button>
  );
}
