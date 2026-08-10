import { NextResponse, type NextRequest } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { connectorAvailability, getConnector } from "@/lib/connectors/registry";
import { getConnectorRepository } from "@/lib/connectors/repository";
import { searchQuerySchema } from "@/lib/connectors/schema";
import { ConnectorError } from "@/lib/connectors/types";

export const dynamic = "force-dynamic";

/**
 * Two searches behind one endpoint.
 *
 * `linked` looks through what the owner has already attached, locally. It is
 * the default because the common question is "where did I put that pull
 * request", and answering it should not depend on GitHub being up.
 *
 * `provider` asks the service, for finding something to attach in the first
 * place. It is a deliberate second step rather than a merged result set: a
 * list that silently mixes "things you linked" with "things that exist"
 * makes it impossible to tell what you have already decided about.
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const query = searchQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!query.success) {
    return NextResponse.json(
      { error: "Invalid query", issues: query.error.flatten() },
      { status: 400 },
    );
  }

  const { q, scope, limit } = query.data;

  try {
    if (scope === "linked") {
      const repository = await getConnectorRepository();
      const refs = await repository.searchRefs(q, limit);
      return NextResponse.json({ refs, scope });
    }

    const availability = connectorAvailability("github");
    if (!availability.configured) {
      // Not an error: a box with no connector is a valid configuration. The
      // interface says what to do rather than showing a failure.
      return NextResponse.json({
        refs: [],
        scope,
        reason: availability.reason,
      });
    }

    const connector = getConnector("github");
    if (!connector.capabilities.search || !connector.search) {
      return NextResponse.json({
        refs: [],
        scope,
        reason: "This connector cannot be searched.",
      });
    }

    const results = await connector.search({ query: q, limit });
    return NextResponse.json({ results, scope });
  } catch (error) {
    if (error instanceof ConnectorError) {
      return NextResponse.json(
        { error: error.message, kind: error.kind },
        { status: error.kind === "rate_limited" ? 429 : 502 },
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
