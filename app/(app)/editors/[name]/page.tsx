import Link from "next/link";
import { loadEditorReport } from "@/app/actions";
import EditorTab from "@/components/EditorTab";

export const metadata = { title: "Editor" };

/** One editor's own history, at its own address so it can be sent to them. */
export default async function Page({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const report = await loadEditorReport(decodeURIComponent(name));

  if (!report) {
    return (
      <section className="panel on">
        <h2>{decodeURIComponent(name)}</h2>
        <div className="note bad">
          No saved run has a row for this editor. They may have been added to the team after the
          last run, or renamed since — a rename starts their history again under the new name.
        </div>
        <p className="sub">
          <Link href="/editors">Back to all editors</Link>
        </p>
      </section>
    );
  }

  return <EditorTab report={report} />;
}
