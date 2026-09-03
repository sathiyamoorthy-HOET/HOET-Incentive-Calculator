import { listAccountability } from "@/app/actions";
import EditorsTab from "@/components/EditorsTab";

export const metadata = { title: "Editor reports" };

/** Every saved run read the other way round: editors down, months across. */
export default async function Page() {
  const data = await listAccountability();
  return <EditorsTab data={data} />;
}
