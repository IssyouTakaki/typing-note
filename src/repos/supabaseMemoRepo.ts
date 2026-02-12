
import { supabase } from "../lib/supabaseClient";

export type MemoRow = {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  updated_at?: string | null;
  deleted_at?: string | null;
};

export async function createMemo(params: { userId: string; content: string }) {
  const { userId, content } = params;

  const { data, error } = await supabase
    .from("memos")
    .insert({ user_id: userId, content })
    .select("id,user_id,content,created_at,updated_at")
    .single();

  if (error) throw error;
  return data as MemoRow;
}

export async function listMemos(params: { userId: string; limit?: number }) {
  const { userId, limit = 50 } = params;

  // updated_at が無い場合もあるので created_at で並べるのが安全
  const { data, error } = await supabase
    .from("memos")
    .select("id,user_id,content,created_at,updated_at")
    .eq("user_id", userId)
    .is("deleted_at", null) // ←追加（ゴミ箱除外）
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as MemoRow[];
}

export async function getMemo(params: { userId: string; id: string }) {
  const { userId, id } = params;

  const { data, error } = await supabase
    .from("memos")
    .select("id,user_id,content,created_at,updated_at")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();

  if (error) throw error;
  return (data ?? null) as MemoRow | null;
}

export async function updateMemo(params: { userId: string; id: string; content: string }) {
  const { userId, id, content } = params;

  const now = new Date().toISOString();

  const { data, error } = await supabase
    .from("memos")
    .update({ content, updated_at: now }) 
    .eq("user_id", userId)
    .eq("id", id)
    .select("id,user_id,content,created_at,updated_at")
    .single();

  if (error) throw error;
  return data as MemoRow;
}

export async function listDustMemos(params: { userId: string; limit?: number }) {
  const { userId, limit = 50 } = params;

  const { data, error } = await supabase
    .from("memos")
    .select("id,user_id,content,created_at,updated_at,deleted_at")
    .eq("user_id", userId)
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false })
    .limit(limit);

  if (error) throw error;
  return (data ?? []) as MemoRow[];
}
