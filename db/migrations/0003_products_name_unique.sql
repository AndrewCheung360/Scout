-- Backs the canonical-name dedup path in upsertProduct (src/db/save.ts) with a real constraint so
-- concurrent saves for a brand-new product can't both miss the lookup and insert duplicate rows
-- (issue #3, under a race). The identifiers jsonb path has no equivalent constraint yet.
create unique index products_canonical_name_lower_uidx on products (lower(canonical_name));
