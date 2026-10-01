import { num, round } from "@/lib/calc";
import type { EditorCat } from "@/lib/types";

/**
 * The video-type breakdown under an editor: what was delivered, at what rate,
 * what came off for revisions, and the points that leaves. The foot adds up
 * to the figure in the row above it, so the two can be read against each
 * other. Shared by Results and the editor's own page.
 */
export default function Breakdown({ cats }: { cats: EditorCat[] }) {
  if (!cats.length) {
    return <p className="detempty">No work recorded against this editor in the report.</p>;
  }
  const points = cats.reduce((a, c) => a + c.points, 0);
  const projects = cats.some((c) => c.unit === "project");
  const minutes = round(cats.filter((c) => c.unit !== "project").reduce((a, c) => a + c.minutes, 0), 1);

  return (
    <table className="brk">
      <thead>
        <tr>
          <th>Video type</th>
          <th className="r">Delivered</th>
          <th className="r">Rate</th>
          <th className="r">Deducted</th>
          <th className="r">Points</th>
        </tr>
      </thead>
      <tbody>
        {cats.map((c, i) => {
          const bad = c.kind === "untyped";
          return (
            <tr key={c.kind + c.cat + i} className={bad ? "bad" : undefined}>
              <td>
                {c.cat}
                {c.kind === "review" && <span className="tag">reviewed for others</span>}
              </td>
              <td className="r num">
                {c.unit === "project" ? (
                  <>
                    {c.minutes}
                    <span className="unit">{c.minutes === 1 ? "project" : "projects"}</span>
                  </>
                ) : (
                  <>
                    {c.minutes}
                    <span className="unit">min</span>
                  </>
                )}
              </td>
              <td className="r num">
                {c.rate ? (
                  <>
                    {c.rate}
                    <span className="unit">{c.unit === "project" ? "/project" : "/min"}</span>
                  </>
                ) : (
                  <span className="muted-2">—</span>
                )}
              </td>
              <td className="r num">
                {c.deducted ? (
                  <span className="neg">−{c.deducted}</span>
                ) : (
                  <span className="muted-2">—</span>
                )}
              </td>
              <td className="r num">{num(c.points)}</td>
            </tr>
          );
        })}
      </tbody>
      <tfoot>
        <tr>
          <td>Total</td>
          <td className="r num">
            {projects ? "" : (
              <>
                {minutes}
                <span className="unit">min</span>
              </>
            )}
          </td>
          <td />
          <td />
          <td className="r num">{num(points)}</td>
        </tr>
      </tfoot>
    </table>
  );
}
