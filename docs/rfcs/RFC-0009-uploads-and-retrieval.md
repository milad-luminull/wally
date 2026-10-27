# Private uploads and document retrieval

- **Status:** proposed; not implemented. Revised 2026-10-26 for the new platform.
- **Date:** 2026-10-19
- **Context:** [Platform migration](RFC-0011-platform-migration.md)

## Scope

Store documents in private EU object storage, and use permission-filtered pgvector
retrieval for document search. This follows the [database migration](RFC-0008-firestore-to-supabase.md).
Identity follows the [Supabase Auth RFC](RFC-0012-supabase-auth-and-mcp.md).

The storage provider is open:

- Supabase Storage is preferred for the prototype, because the Free plan includes 1 GB (owner brief, citing
  [Supabase pricing](https://supabase.com/pricing)).
- Google Cloud Storage replaces it only if integration, operations, region or cost
  measurements justify that.

Pick one before implementation.

## Approach

- Authorize ownership, board access, file type and quota before issuing a short-lived
  signed upload URL. Validate the completed object before processing.
- Start with proposed limits of 25 MB/document and 1 GB retained files/user.
- Store bytes in object storage and metadata in SQL. Process documents through the
  [durable worker pipeline](RFC-0010-durable-ai-workers.md); keep bytes out of queue messages.
- Keep original documents authoritative and embeddings rebuildable, with model/version
  metadata. Filter retrieval by current access before returning content to a model.
- Delete originals and derived text/vectors together. Verify EU processing for extraction
  and embeddings as well as storage.
- Back up file bytes separately from the database. A database dump holds only the
  attachment metadata.

## Done when

Private access, quotas, upload validation, retrieval isolation and deletion are tested.
Choose supported document types before implementation. Voice/video uploads need separate
size, duration and resumable-transfer limits.
