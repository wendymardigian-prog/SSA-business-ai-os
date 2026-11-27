import type { ConversationRow } from "@/lib/inbox/types";
import type { ListCursor } from "@/lib/inbox/list-cursor";

/** Lo que devuelven las acciones de `lib/actions/inbox-list.ts` (los tipos no pueden vivir en un archivo "use server"). */

export type InboxMoreResult =
  | { ok: true; rows: ConversationRow[]; hasMore: boolean; cursor: ListCursor | null; draftConversationIds: string[] }
  | { ok: false; error: string };

export type InboxByIdsResult =
  | { ok: true; rows: ConversationRow[]; notMatching: string[]; draftConversationIds: string[] }
  | { ok: false; error: string };
