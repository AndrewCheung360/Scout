-- Adds pgvector for chat-RAG over a report's sources (Phase 3 / the chat dock, G4).
-- Apply where pgvector is available:
--   • Supabase: built in (this just enables it).
--   • Local Homebrew Postgres: `brew install pgvector` first, then run this.
create extension if not exists vector;
alter table sources add column if not exists embedding vector(768);
