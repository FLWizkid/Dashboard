import { NextResponse, type NextRequest } from "next/server";

import { getSessionUser } from "@/lib/auth";
import {
  getConnectorRepository,
  LinkNotFoundError,
} from "@/lib/connectors/repository";
import { updateLinkSchema } from "@/lib/connectors/schema";

export const dynamic = "force-dynamic";

/** Confirming a suggested link — the second half of confirm-before-link. */
export async function PATCH(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = updateLinkSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", issues: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const repository = await getConnectorRepository();

  try {
    const link = await repository.confirmLink(id);
    return NextResponse.json({ link });
  } catch (error) {
    if (error instanceof LinkNotFoundError) {
      return NextResponse.json({ error: error.message }, { status: 404 });
    }
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}

export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const { id } = await context.params;
  const repository = await getConnectorRepository();

  try {
    await repository.unlink(id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
