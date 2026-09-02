"use server";

import { randomInt } from "crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { serviceKey, MISSING_SERVICE_KEY_MESSAGE } from "@/lib/env";

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/* No look-alike characters: these passwords get read out loud. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789";

function tempPassword(): string {
  let s = "";
  for (let i = 0; i < 14; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}

/**
 * Only someone already on the access list may change it. The check is a read
 * through the caller's own session, so row-level security answers it: a
 * non-staff account sees no rows and gets no further.
 */
async function requireStaff() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user?.email) throw new Error("Not signed in.");

  const email = user.email.trim().toLowerCase();
  const { data } = await supabase
    .from("allowed_emails")
    .select("email")
    .eq("email", email)
    .maybeSingle();

  if (!data) throw new Error("Only people on the access list can manage access.");
  return { supabase, email };
}

export type AddUserResult =
  | { ok: true; email: string; password: string | null; listedOnly?: boolean }
  | { ok: false; error: string };

/**
 * Puts an address on the access list and stops there, leaving the person to
 * sign themselves up and choose their own password. Needs no service-role key,
 * and no password ever has to be passed along by hand.
 */
export async function allowEmail(name: string, emailInput: string): Promise<AddUserResult> {
  try {
    const { supabase } = await requireStaff();

    const email = emailInput.trim().toLowerCase();
    const full = name.trim();
    if (!EMAIL.test(email)) return { ok: false, error: "That does not look like an email address." };

    const { data: listed } = await supabase
      .from("allowed_emails")
      .select("email")
      .eq("email", email)
      .maybeSingle();

    if (!listed) {
      const { error } = await supabase
        .from("allowed_emails")
        .insert({ email, note: full || null });
      if (error) return { ok: false, error: error.message };
    }

    revalidatePath("/admin");
    return { ok: true, email, password: null, listedOnly: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not add that address." };
  }
}

/**
 * Adds someone in the order the database requires: the address has to be on
 * the access list before the account exists, because a trigger on auth.users
 * refuses to create an account for an address that is not listed.
 */
export async function addUser(name: string, emailInput: string): Promise<AddUserResult> {
  try {
    const { supabase } = await requireStaff();

    const email = emailInput.trim().toLowerCase();
    const full = name.trim();
    if (!EMAIL.test(email)) return { ok: false, error: "That does not look like an email address." };
    if (!serviceKey()) return { ok: false, error: MISSING_SERVICE_KEY_MESSAGE };

    const admin = createAdminClient();

    /* Look before leaping: an address that already has an account only needs
       listing, and creating one twice fails halfway through. */
    const { data: existing, error: listError } = await admin.auth.admin.listUsers({
      page: 1,
      perPage: 1000,
    });
    if (listError) return { ok: false, error: listError.message };
    const hasAccount = existing.users.some((u) => u.email?.toLowerCase() === email);

    const { data: listed } = await supabase
      .from("allowed_emails")
      .select("email")
      .eq("email", email)
      .maybeSingle();

    if (!listed) {
      const { error } = await supabase
        .from("allowed_emails")
        .insert({ email, note: full || null });
      if (error) return { ok: false, error: error.message };
    }

    if (hasAccount) {
      revalidatePath("/admin");
      return { ok: true, email, password: null };
    }

    const password = tempPassword();
    const { error: authError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: full ? { full_name: full } : undefined,
    });

    if (authError) {
      /* Leave the list as it was found. A listed address with no account reads
         as a half-finished job to whoever opens the page next. */
      if (!listed) await supabase.from("allowed_emails").delete().eq("email", email);
      return { ok: false, error: authError.message };
    }

    revalidatePath("/admin");
    return { ok: true, email, password };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not add that person." };
  }
}

export type RemoveUserResult = { ok: true } | { ok: false; error: string };

/** Takes away both halves of access: the account and the listing. */
export async function removeUser(emailInput: string): Promise<RemoveUserResult> {
  try {
    const { supabase, email: mine } = await requireStaff();
    const email = emailInput.trim().toLowerCase();

    if (email === mine) {
      return { ok: false, error: "You cannot remove your own access. Ask the other admin." };
    }

    /* profiles.id *is* the auth user id, so this is the whole lookup. */
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .ilike("email", email)
      .maybeSingle();

    if (profile) {
      if (!serviceKey()) return { ok: false, error: MISSING_SERVICE_KEY_MESSAGE };
      const admin = createAdminClient();
      const { error } = await admin.auth.admin.deleteUser(profile.id);
      if (error) return { ok: false, error: error.message };
    }

    const { error } = await supabase.from("allowed_emails").delete().eq("email", email);
    if (error) return { ok: false, error: error.message };

    revalidatePath("/admin");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not remove that person." };
  }
}
