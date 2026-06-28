# Context: identity

Users / accounts. Minimal at first (single-user); grows to multi-user with Supabase Auth in Phase 4.

## Glossary

- **User** — an account that owns reports, watches, and conversations.

## Responsibilities

Owns the `User` type and (later) auth integration.
Other contexts reference a user by `userId` only.
