import { NextResponse, type NextRequest } from "next/server";

import { getSessionUser } from "@/lib/auth";
import { connectorForUrl } from "@/lib/connectors/registry";
import {
  AlreadyLinkedError,
  getConnectorRepository,
} from "@/lib/connectors/repository";
import { attachSchema, listLinksQuerySchema } from "@/lib/connectors/schema";
import { ConnectorError } from "@/lib/connectors/types";

export const dynamic = "force-dynamic";

/**
 * Attaching external context, and reading what is attached.
 *
 * The POST does the whole job in one call — resolve the URL, store the
 * reference, attach it — because from the owner's side it is one act. Three
 * round trips would mean three ways to end up half-done.
 */
export async function GET(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const query = listLinksQuerySchema.safeParse(
    Object.fromEntries(request.nextUrl.searchParams),
  );
  if (!query.success) {
    return NextResponse.json(
      { error: "Invalid query", issues: query.error.flatten() },
      { status: 400 },
    );
  }

  const repository = await getConnectorRepository();
  const { taskId, noteId, limit } = query.data;

  try {
    const links = taskId
      ? await repository.linksForTask(taskId)
      : noteId
        ? await repository.linksForNote(noteId)
        : await repository.allLinks(limit);

    return NextResponse.json({ links });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = attachSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { url, refId, taskId, noteId, relation } = parsed.data;
  const repository = await getConnectorRepository();

  try {
    let resolvedRefId = refId;

    if (url) {
      const connector = connectorForUrl(url);
      if (!connector) {
        return NextResponse.json(
          {
            error:
              "No connected service recognises that link. Connect it, or check the address.",
          },
          { status: 422 },
        );
      }

      const resolved = await connector.resolve(url);
      const ref = await repository.upsertRef(resolved);
      resolvedRefId = ref.id;
    }

    const link = await repository.linkRef({
      refId: resolvedRefId!,
      taskId,
      noteId,
      relation,
      // Pasting a URL onto a task is an explicit act. It does not need a
      // second question — but nothing *else* may set this.
      confirmed: true,
    });

    return NextResponse.json({ link }, { status: 201 });
  } catch (error) {
    // Already attached is a success from the owner's point of view: they
    // double-clicked, or pasted the same link twice.
    if (error instanceof AlreadyLinkedError) {
      return NextResponse.json({ link: error.existing }, { status: 200 });
    }

    if (error instanceof ConnectorError) {
      return NextResponse.json(
        { error: error.message, kind: error.kind },
        { status: statusFor(error) },
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

/**
 * A connector failure as an HTTP status.
 *
 * `unavailable` is 503 rather than 500 so the interface can say "the service
 * is down, try later" instead of "something went wrong", which is the
 * difference between a message that helps and one that worries.
 */
function statusFor(error: ConnectorError): number {
  switch (error.kind) {
    case "auth":
      return 401;
    case "forbidden":
      return 403;
    case "not_found":
      return 404;
    case "unrecognised":
      return 422;
    case "rate_limited":
      return 429;
    case "unavailable":
      return 503;
    default:
      return 502;
  }
}
