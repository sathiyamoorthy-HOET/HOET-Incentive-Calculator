import { redirect } from "next/navigation";

/**
 * Results used to be a page of its own. It is now the second half of Run a
 * month — a report and what it paid are one thing — but links to this address
 * are in people's history and in old messages, so it still leads somewhere.
 */
export default function Page() {
  redirect("/run");
}
