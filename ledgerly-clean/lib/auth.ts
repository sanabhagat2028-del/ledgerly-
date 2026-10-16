import { createClient, createServiceClient } from "@/lib/supabase/server";

export type Authed = {
  userId: string;
  email: string;
  premium: boolean;
};

/** Returns the signed-in user and their plan, or null. Reads the profile with the user's own session. */
export async function getAuthed(): Promise<Authed | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("plan").eq("id", user.id).maybeSingle();
  return { userId: user.id, email: user.email ?? "", premium: profile?.plan === "premium" };
}

/** Service-role client for writes the user is not allowed to make directly. Always scope queries by userId. */
export const admin = createServiceClient;
