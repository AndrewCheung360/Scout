/** Identity context. Minimal at first (single-user); Supabase Auth in Phase 4. */
export type User = {
  id: string;
  email: string;
  createdAt: string; // ISO 8601
};
