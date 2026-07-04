"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

type TimeEntryInsert = Database["public"]["Tables"]["time_entries"]["Insert"];

const PATH = "/dashboard/hours";

export async function addTimeEntry(formData: FormData) {
  const label = String(formData.get("label") ?? "").trim();
  if (!label) return;

  const hours = Number(formData.get("hours"));
  if (!Number.isFinite(hours) || hours <= 0 || hours > 24) return;

  const loggedOn = String(formData.get("logged_on") ?? "").trim();

  const supabase = await createClient();
  // logged_on defaults to current_date in the DB when omitted.
  const payload: TimeEntryInsert = loggedOn
    ? { label, hours, logged_on: loggedOn }
    : { label, hours };
  const { error } = await supabase.from("time_entries").insert(payload);
  if (error) throw new Error(error.message);

  revalidatePath(PATH);
}

export async function deleteTimeEntry(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  const { error } = await supabase.from("time_entries").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(PATH);
}
