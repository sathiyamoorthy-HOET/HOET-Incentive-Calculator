import { Config } from "./types";

const key = (s: string) => s.trim().toLowerCase();

function firstDuplicate(values: string[]): string | null {
  const seen = new Set<string>();
  for (const v of values) {
    const k = key(v);
    if (!k) continue;
    if (seen.has(k)) return v.trim();
    seen.add(k);
  }
  return null;
}

/**
 * Why this exists: the database stores the config as real rows, and names are
 * their identity — editors, video types, work patterns and aliases are each
 * unique. One duplicate therefore does not fail on its own; it makes *every*
 * later save of *anything* fail, because a save replaces the whole config in
 * one transaction. A rate typed on another page would silently stop being
 * saved until the duplicate was found.
 *
 * So the same rule is checked here before sending, where the message can name
 * the row at fault, and again in `set_config` for callers that are not this UI.
 */
export function configProblem(c: Config): string | null {
  const blankEditor = c.team.findIndex((e) => !e.name.trim());
  if (blankEditor >= 0) return `Editor ${blankEditor + 1} has no name. Every editor needs one.`;

  const dupEditor = firstDuplicate(c.team.map((e) => e.name));
  if (dupEditor) {
    return `Two editors are called "${dupEditor}". Editor names must be different, because the report is matched to editors by name.`;
  }

  const blankType = c.rates.findIndex((r) => !r.cat.trim());
  if (blankType >= 0) return `Video type ${blankType + 1} has no name. Every video type needs one.`;

  const dupType = firstDuplicate(c.rates.map((r) => r.cat));
  if (dupType) return `Two video types are called "${dupType}". Rename one of them.`;

  const dupPattern = firstDuplicate(c.patterns.map((p) => p.name));
  if (dupPattern) return `Two work patterns are called "${dupPattern}". Rename one of them.`;

  const aliases: string[] = [];
  const owner = new Map<string, string>();
  for (const e of c.team) {
    for (const a of e.alias) {
      if (!a.trim()) continue;
      const k = key(a);
      const held = owner.get(k);
      if (held && held !== e.name) {
        return `The name "${a.trim()}" is listed against both ${held} and ${e.name}. One report name can belong to one editor only.`;
      }
      owner.set(k, e.name);
      aliases.push(a);
    }
  }
  const dupAlias = firstDuplicate(aliases);
  if (dupAlias) return `The name "${dupAlias}" is listed twice on the same editor.`;

  const dupSource = firstDuplicate(c.map.map(([source]) => source));
  if (dupSource) {
    return `The video type "${dupSource}" is mapped twice. Remove one of the two rows.`;
  }

  return null;
}
