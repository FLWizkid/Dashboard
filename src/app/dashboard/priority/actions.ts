"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { Database } from "@/lib/supabase/database.types";

type PriorityInsert = Database["public"]["Tables"]["priorities"]["Insert"];

const PATH = "/dashboard/priority";

export async function addPriority(formData: FormData) {
  const title = String(formData.get("title") ?? "").trim();
  if (!title) return;

  const levelRaw = Number(formData.get("level"));
  const level = [1, 2, 3].includes(levelRaw) ? levelRaw : 2;

  const supabase = await createClient();
  // user_id defaults to auth.uid() in the DB; RLS enforces ownership.
  const payload: PriorityInsert = { title, level };
  const { error } = await supabase.from("priorities").insert(payload);
  if (error) throw new Error(error.message);

  revalidatePath(PATH);
}

export async function togglePriority(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;
  const isDone = String(formData.get("is_done")) === "true";

  const supabase = await createClient();
  const { error } = await supabase
    .from("priorities")
    .update({ is_done: !isDone })
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(PATH);
}

export async function deletePriority(formData: FormData) {
  const id = String(formData.get("id") ?? "");
  if (!id) return;

  const supabase = await createClient();
  const { error } = await supabase.from("priorities").delete().eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(PATH);
}
