import { getPageContext } from "@/lib/app-context";

/**
 * Everything under (authenticated) requires a signed-in student. A signed-out visitor is
 * redirected to /sign-in. Pages still call `getPageContext()` themselves to get the AppContext,
 * and every domain query is scoped to that user. This layout is a convenience, not the security
 * boundary.
 */
export default async function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
  await getPageContext();
  return children;
}
