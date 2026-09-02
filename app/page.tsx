import { redirect } from "next/navigation";

/** The app proper starts at /run; "/" is only ever a doorway. */
export default function Home() {
  redirect("/run");
}
