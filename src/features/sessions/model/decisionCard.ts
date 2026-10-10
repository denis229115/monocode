import type { Block, Session } from "./session";
import {
  CUSTOM_OPTION_ID,
  isCustomSelection,
  type UserQuestion,
  type UserQuestionOption,
  type UserQuestionReply,
} from "./userQuestion";

type AnsweredReply = Extract<UserQuestionReply, { kind: "answered" }>;

/**
 * A card of questions an agent leaves in its chat with the app CLI's
 * `chat.ask`. The call returns at once so the agent can end its turn; the card
 * waits on the turn that asked until the user answers it, which sends the
 * answers as the agent's next message, or dismisses it.
 */
export type DecisionCard = {
  /** The CLI request ID, unique within the session that asked. */
  id: string;
  questions: UserQuestion[];
  askedAt: number;
  outcome?:
    | { kind: "answered"; at: number; reply: AnsweredReply }
    | { kind: "dismissed"; at: number };
};

export const DECISION_FIELDS = ["questions"] as const;

const MAX_QUESTIONS = 4;
const MAX_OPTIONS = 9;
const MAX_LINKS = 4;

function text(value: unknown, name: string, max: number): string {
  if (typeof value !== "string" || !value.trim() || value.length > max)
    throw new Error(`${name} must be text under ${max} characters`);
  return value.trim();
}

function line(value: unknown, name: string, max: number): string {
  return text(value, name, max).replace(/\s+/g, " ");
}

function flag(value: unknown, name: string): boolean | undefined {
  if (value !== undefined && typeof value !== "boolean")
    throw new Error(`${name} must be true or false`);
  return value as boolean | undefined;
}

function fields(value: unknown, name: string, allowed: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${name} must be an object`);
  const record = value as Record<string, unknown>;
  const extra = Object.keys(record).filter((key) => !allowed.includes(key));
  if (extra.length)
    throw new Error(`${name} does not take ${extra.join(", ")}`);
  return record;
}

function webLink(value: unknown): string {
  const raw = text(value, "each link", 2000);
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("each link must be a full http or https URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("each link must be a full http or https URL");
  return url.href;
}

function option(value: unknown, where: string): UserQuestionOption {
  const input = fields(value, `${where} option`, [
    "label",
    "description",
    "value",
    "recommended",
  ]);
  const label = line(input.label, "label", 120);
  const description =
    input.description === undefined
      ? undefined
      : text(input.description, "description", 500);
  // What answering sends; the label stands in when the agent gives none.
  const id =
    input.value === undefined ? label : line(input.value, "value", 500);
  if (id === CUSTOM_OPTION_ID) throw new Error(`${id} is reserved`);
  const recommended = flag(input.recommended, "recommended");
  return {
    id,
    label,
    ...(description ? { description } : {}),
    ...(recommended ? { recommended: true } : {}),
  };
}

function question(value: unknown, index: number): UserQuestion {
  const input = fields(value, `Question ${index + 1}`, [
    "id",
    "header",
    "question",
    "options",
    "multiSelect",
    "allowCustom",
    "links",
  ]);
  const id = input.id === undefined ? `q${index + 1}` : line(input.id, "id", 64);
  const rawOptions = input.options ?? [];
  if (!Array.isArray(rawOptions) || rawOptions.length > MAX_OPTIONS)
    throw new Error(`options must be a list of at most ${MAX_OPTIONS}`);
  const options = rawOptions.map((entry) => option(entry, `Question ${id}`));
  if (new Set(options.map((entry) => entry.id)).size !== options.length)
    throw new Error(
      `Question ${id} has two options that send the same answer; give each its own value`,
    );
  if (options.filter((entry) => entry.recommended).length > 1)
    throw new Error(`Question ${id} can recommend one option at most`);
  const allowCustom = flag(input.allowCustom, "allowCustom") ?? true;
  if (!options.length && !allowCustom)
    throw new Error(`Question ${id} has no options and no typed answer`);
  const rawLinks = input.links ?? [];
  if (!Array.isArray(rawLinks) || rawLinks.length > MAX_LINKS)
    throw new Error(`links must be a list of at most ${MAX_LINKS} URLs`);
  const links = rawLinks.map(webLink);
  const header =
    input.header === undefined ? undefined : line(input.header, "header", 60);
  return {
    id,
    ...(header ? { header } : {}),
    prompt: text(input.question, "question", 2000),
    multiSelect: flag(input.multiSelect, "multiSelect") ?? false,
    allowCustom,
    options,
    ...(links.length ? { links } : {}),
  };
}

/** The questions from the CLI's input, checked field by field. */
export function parseDecisionQuestions(value: unknown): UserQuestion[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_QUESTIONS)
    throw new Error(`questions must be a list of 1 to ${MAX_QUESTIONS}`);
  const questions = value.map(question);
  if (new Set(questions.map((entry) => entry.id)).size !== questions.length)
    throw new Error("Each question needs its own id");
  return questions;
}

export function sameDecisionQuestions(
  a: readonly UserQuestion[],
  b: readonly UserQuestion[],
): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** What one question's answer sends: option values, or the typed answer. */
function answerFor(
  question: UserQuestion,
  reply: AnsweredReply,
): string | undefined {
  const custom = reply.custom?.[question.id]?.trim();
  const selected = reply.answers[question.id] ?? [];
  const values = selected.length
    ? selected.flatMap((id) =>
        isCustomSelection(question, id) ? (custom ? [custom] : []) : [id],
      )
    : custom
      ? [custom]
      : [];
  return values.length ? values.join(", ") : undefined;
}

/** The agent's next message: each question on a line and its answer under it. */
export function decisionAnswerText(
  card: DecisionCard,
  reply: AnsweredReply,
): string {
  return card.questions
    .map(
      (question) =>
        `${question.prompt}\n${answerFor(question, reply) ?? "(skipped)"}`,
    )
    .join("\n\n");
}

export function decisionCards(blocks: readonly Block[]): DecisionCard[] {
  return blocks.flatMap((block) => block.decisionCards ?? []);
}

export function waitingDecisionCards(
  blocks: readonly Block[],
): DecisionCard[] {
  return decisionCards(blocks).filter((card) => !card.outcome);
}

export function findDecisionCard(
  blocks: readonly Block[],
  id: string,
): DecisionCard | undefined {
  return decisionCards(blocks).find((card) => card.id === id);
}

/** Keeps the card on the turn that asked, beside that turn's other cards. */
export function recordDecisionCard(
  session: Session,
  turnId: string,
  card: DecisionCard,
): Session {
  return {
    ...session,
    blocks: session.blocks.map((block) =>
      block.id === turnId
        ? { ...block, decisionCards: [...(block.decisionCards ?? []), card] }
        : block,
    ),
  };
}

/** Answers or dismisses a waiting card; a settled one stays as it was. */
export function settleDecisionCard(
  session: Session,
  id: string,
  outcome: NonNullable<DecisionCard["outcome"]>,
): Session {
  let changed = false;
  const blocks = session.blocks.map((block) => {
    if (!block.decisionCards?.some((card) => card.id === id && !card.outcome))
      return block;
    changed = true;
    return {
      ...block,
      decisionCards: block.decisionCards.map((card) =>
        card.id === id ? { ...card, outcome } : card,
      ),
    };
  });
  return changed ? { ...session, blocks } : session;
}

function restoredStrings(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function restoredOutcome(value: unknown): DecisionCard["outcome"] {
  if (!value || typeof value !== "object") return undefined;
  const outcome = value as Record<string, unknown>;
  const at = typeof outcome.at === "number" ? outcome.at : 0;
  if (outcome.kind === "dismissed") return { kind: "dismissed", at };
  if (outcome.kind !== "answered") return undefined;
  const reply = (outcome.reply ?? {}) as Record<string, unknown>;
  const answers: Record<string, string[]> = {};
  if (reply.answers && typeof reply.answers === "object")
    for (const [key, ids] of Object.entries(reply.answers))
      if (Array.isArray(ids))
        answers[key] = ids.filter((id) => typeof id === "string");
  const custom = restoredStrings(reply.custom);
  return {
    kind: "answered",
    at,
    reply: { kind: "answered", answers, ...(custom ? { custom } : {}) },
  };
}

function restoredQuestion(value: unknown): UserQuestion[] {
  if (!value || typeof value !== "object") return [];
  const q = value as Record<string, unknown>;
  if (typeof q.id !== "string" || typeof q.prompt !== "string") return [];
  const options = Array.isArray(q.options)
    ? q.options.flatMap((entry): UserQuestionOption[] => {
        const o = (entry ?? {}) as Record<string, unknown>;
        if (typeof o.id !== "string" || typeof o.label !== "string") return [];
        return [
          {
            id: o.id,
            label: o.label,
            ...(typeof o.description === "string"
              ? { description: o.description }
              : {}),
            ...(o.recommended === true ? { recommended: true } : {}),
          },
        ];
      })
    : [];
  const links = Array.isArray(q.links)
    ? q.links.filter(
        (link): link is string =>
          typeof link === "string" && /^https?:\/\//i.test(link),
      )
    : [];
  return [
    {
      id: q.id,
      ...(typeof q.header === "string" ? { header: q.header } : {}),
      prompt: q.prompt,
      multiSelect: q.multiSelect === true,
      allowCustom: q.allowCustom !== false,
      options,
      ...(links.length ? { links } : {}),
    },
  ];
}

/** Decision cards from a saved block, dropping any that no longer make sense. */
export function restoreDecisionCards(
  value: unknown,
): DecisionCard[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cards = value.flatMap((entry): DecisionCard[] => {
    if (!entry || typeof entry !== "object") return [];
    const card = entry as Record<string, unknown>;
    if (typeof card.id !== "string" || !Array.isArray(card.questions))
      return [];
    const questions = card.questions.flatMap(restoredQuestion);
    if (!questions.length) return [];
    const outcome = restoredOutcome(card.outcome);
    return [
      {
        id: card.id,
        questions,
        askedAt: typeof card.askedAt === "number" ? card.askedAt : 0,
        ...(outcome ? { outcome } : {}),
      },
    ];
  });
  return cards.length ? cards : undefined;
}
