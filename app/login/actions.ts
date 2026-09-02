"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type AuthState = { error: string | null; notice?: string };

export async function signIn(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const next = String(formData.get("next") || "/");

  if (!email || !password) return { error: "Enter your email address and password." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    return {
      error:
        error.message === "Invalid login credentials"
          ? "That email address and password do not match an account. Only addresses on the access list can sign in, and accounts are created by an administrator."
          : error.message,
    };
  }

  revalidatePath("/", "layout");
  redirect(next.startsWith("/") ? next : "/");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}

/**
 * Where the links in Supabase's emails come back to. Server Actions carry an
 * Origin header, so this follows the deployment it was called from — localhost
 * in development, the real domain in production — with no extra configuration.
 */
async function origin(): Promise<string> {
  const h = await headers();
  return h.get("origin") || h.get("referer")?.replace(/(https?:\/\/[^/]+).*/, "$1") || "";
}

/**
 * Self sign-up, which only works for an address an admin has already put on
 * the access list: a trigger on auth.users refuses anything else. That refusal
 * arrives as a generic database error, so it is translated here.
 */
export async function signUpNew(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") || "").trim();
  const password = String(formData.get("password") || "");
  const fullName = String(formData.get("full_name") || "").trim();

  if (!email || !password) return { error: "Enter your email address and a password." };
  if (password.length < 8) return { error: "Use at least 8 characters." };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: fullName ? { full_name: fullName } : undefined,
      emailRedirectTo: (await origin()) + "/auth/confirm?next=/run",
    },
  });

  if (error) {
    if (/database error|saving new user|restricted/i.test(error.message)) {
      return {
        error:
          "That address is not on the access list, so an account cannot be created for it. " +
          "Ask an admin to add it, then try again.",
      };
    }
    if (/signups not allowed|disabled/i.test(error.message)) {
      return {
        error:
          "Sign-up is turned off for this project. An admin can create the account instead, " +
          "or enable it in Supabase → Authentication → Sign In / Providers.",
      };
    }
    return { error: error.message };
  }

  /* A session here means the project does not ask for email confirmation, so
     they are already in. Otherwise they have a link to click. */
  if (data.session) {
    revalidatePath("/", "layout");
    redirect("/run");
  }

  return { error: null, notice: "Check your email for a link to confirm the address, then sign in." };
}

/** Sends the reset link. Says the same thing either way, so it cannot be used
 *  to find out who has an account. */
export async function requestReset(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const email = String(formData.get("email") || "").trim();
  if (!email) return { error: "Enter your email address." };

  const supabase = await createClient();
  await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: (await origin()) + "/auth/confirm?next=/auth/reset",
  });

  return {
    error: null,
    notice: "If that address has an account, a link to set a new password is on its way.",
  };
}

/** Sets a new password for whoever the recovery link signed in. */
export async function updatePassword(_prev: AuthState, formData: FormData): Promise<AuthState> {
  const password = String(formData.get("password") || "");
  if (password.length < 8) return { error: "Use at least 8 characters." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { error: "That link has expired. Ask for a new one from the sign-in page." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  redirect("/run");
}
