import { Config } from "./types";

/**
 * What one editing session did to the rate card, in words.
 *
 * The rate card decides what people are paid, so it is not saved until someone
 * says so — and a confirmation that only says "save?" is not worth stopping
 * for. These are the lines it shows instead: what changed, from what, to what.
 *
 * Everything here is compared by name rather than by position, because names
 * are what the database stores these lists under. Reordering a list therefore
 * reads as no change at all, which is exactly what it is.
 */

const n = (v: number) => String(Math.round(v * 1000) / 1000);

/** One list of things, each reduced to a name and a description of its state. */
type Snap = Map<string, string>;

function diff(out: string[], noun: string, before: Snap, after: Snap) {
  for (const [name, now] of after) {
    const was = before.get(name);
    if (was === undefined) out.push(`${noun} added — ${name}${now ? ": " + now : ""}`);
    else if (was !== now) out.push(`${noun} — ${name}: ${was} → ${now}`);
  }
  for (const name of before.keys()) {
    if (!after.has(name)) out.push(`${noun} removed — ${name}`);
  }
}

const rateSnap = (c: Config): Snap =>
  new Map(
    c.rates.map((r) => [
      r.cat,
      `A ${n(r.r[0] ?? 0)} · B ${n(r.r[1] ?? 0)} · C ${n(r.r[2] ?? 0)} · D ${n(r.r[3] ?? 0)}` +
        ` · review ${n(r.review ?? 0)}`,
    ])
  );

const patternSnap = (c: Config): Snap =>
  new Map(c.patterns.map((p) => [p.name, `${n(p.target)} points over ${n(p.days)} days`]));

const bandSnap = (c: Config): Snap =>
  new Map((c.payBands ?? []).map((b) => [`+${n(b.from)} above target`, `₹${n(b.rate)} a point`]));

const revSnap = (c: Config): Snap =>
  new Map(
    (c.revPen ?? []).map((pct, i) => [`${i + 1} round${i ? "s" : ""} of revision`, `${n(pct)}%`])
  );

const teamSnap = (c: Config): Snap =>
  new Map(
    c.team.map((e) => [
      e.name,
      [
        `slab ${e.slab}`,
        e.pattern || "no work pattern",
        e.days == null ? "standard days" : `${n(e.days)} days`,
        e.target == null ? "pattern target" : `target ${n(e.target)}`,
        e.reviewer ? "reviews" : "edits",
        `known as ${[...e.alias].sort().join(", ") || "nothing else"}`,
      ].join(" · "),
    ])
  );

const mapSnap = (c: Config): Snap => new Map(c.map.map(([source, cat]) => [source, cat]));

const ignoreSnap = (c: Config): Snap => new Map(c.ignore.map((x) => [x, ""]));

export function describeChanges(a: Config, b: Config): string[] {
  const out: string[] = [];

  if (a.ppd !== b.ppd) out.push(`Points per working day: ${n(a.ppd)} → ${n(b.ppd)}`);
  if ((a.pipMonths ?? 3) !== (b.pipMonths ?? 3)) {
    out.push(
      `Months below target before a PIP: ${n(a.pipMonths ?? 3)} → ${n(b.pipMonths ?? 3)}`
    );
  }

  diff(out, "Payout", bandSnap(a), bandSnap(b));
  diff(out, "Revisions", revSnap(a), revSnap(b));
  diff(out, "Points per minute", rateSnap(a), rateSnap(b));
  diff(out, "Work pattern", patternSnap(a), patternSnap(b));
  diff(out, "Editor", teamSnap(a), teamSnap(b));
  diff(out, "Video type mapping", mapSnap(a), mapSnap(b));
  diff(out, "Name left out of every run", ignoreSnap(a), ignoreSnap(b));

  return out;
}
