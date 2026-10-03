import { listAccountability } from "@/app/actions";
import PipTab from "@/components/PipTab";

export const metadata = { title: "PIP" };

/** Every saved month, cut down to the editors who fell under the PIP line. */
export default async function Page() {
  const data = await listAccountability();
  return <PipTab data={data} />;
}
