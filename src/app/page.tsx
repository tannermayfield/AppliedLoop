import { redirect } from "next/navigation";

// The app has no public landing page in v0. The authenticated layout sends signed-out visitors
// to /sign-in.
export default function Home() {
  redirect("/today");
}
