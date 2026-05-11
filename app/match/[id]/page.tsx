import { MatchArena } from "./MatchArena";

type SearchParams = Promise<{ userId?: string; role?: string }>;
type Params = Promise<{ id: string }>;

export default async function MatchPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const userId = sp.userId ?? "";
  const role = sp.role === "caller" ? "caller" : "callee";
  return <MatchArena matchId={id} userId={userId} role={role} />;
}
