import { defaultMonoName, type Mono } from "../../monos/model/mono";
import {
  composeInboxMessage,
  inboxComposerCard,
  type InboxItem,
} from "./githubTasks";

/** A Mono the Inbox can send to, named as the rail names it. */
export type InboxMonoChoice = { id: string; name: string };

export function inboxMonoChoices(monos: readonly Mono[]): InboxMonoChoice[] {
  return monos.map((mono) => ({
    id: mono.id,
    name: mono.name?.trim() || defaultMonoName(mono.mascot),
  }));
}

/** What a new chat from this item would send, so a Mono gets the same message. */
export function inboxMonoMessage(item: InboxItem, body?: string): string {
  return composeInboxMessage(inboxComposerCard(item, body), "");
}
