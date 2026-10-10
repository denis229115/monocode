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
 * waits until the user answers it, which sends the answers as the agent's next
 * message, or dismisses it. Cards are saved beside the transcript, so one is
 * found by its request ID however little of the conversation is loaded.
 */
export type DecisionCard = {
  /** The CLI request ID, unique within the session that asked. */
  id: string;
  /** The block that opens the turn that asked; its summary shows there. */
  turnId: string;
  questions: UserQuestion[];
  askedAt: number;
  outcome?: DecisionOutcome;
};

export type DecisionOutcome =
  | { kind: "answered"; at: number; reply: AnsweredReply }
  | { kind: "dismissed"; at: number };

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

/**
 * The rules every card keeps, from the CLI or from storage: answers are kept
 * by question id, so ids must be distinct and never name an object property.
 */
function checkQuestions(questions: UserQuestion[]): UserQuestion[] {
  if (questions.length < 1 || questions.length > MAX_QUESTIONS)
    throw new Error(`questions must be a list of 1 to ${MAX_QUESTIONS}`);
  for (const question of questions) {
    const { id } = question;
    if (id in Object.prototype)
      throw new Error(`Question id ${id} is a reserved name; choose another`);
    if (question.options.length > MAX_OPTIONS)
      throw new Error(`options must be a list of at most ${MAX_OPTIONS}`);
    const values = question.options.map((option) => option.id);
    if (values.includes(CUSTOM_OPTION_ID))
      throw new Error(`${CUSTOM_OPTION_ID} is reserved`);
    if (new Set(values).size !== values.length)
      throw new Error(
        `Question ${id} has two options that send the same answer; give each its own value`,
      );
    if (question.options.filter((option) => option.recommended).length > 1)
      throw new Error(`Question ${id} can recommend one option at most`);
    if (!question.options.length && !question.allowCustom)
      throw new Error(`Question ${id} has no options and no typed answer`);
    if ((question.links?.length ?? 0) > MAX_LINKS)
      throw new Error(`links must be a list of at most ${MAX_LINKS} URLs`);
  }
  if (new Set(questions.map((entry) => entry.id)).size !== questions.length)
    throw new Error("Each question needs its own id");
  return questions;
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
  if (!Array.isArray(rawOptions))
    throw new Error(`options must be a list of at most ${MAX_OPTIONS}`);
  const rawLinks = input.links ?? [];
  if (!Array.isArray(rawLinks))
    throw new Error(`links must be a list of at most ${MAX_LINKS} URLs`);
  const links = rawLinks.map(webLink);
  const header =
    input.header === undefined ? undefined : line(input.header, "header", 60);
  return {
    id,
    ...(header ? { header } : {}),
    prompt: text(input.question, "question", 2000),
    multiSelect: flag(input.multiSelect, "multiSelect") ?? false,
    allowCustom: flag(input.allowCustom, "allowCustom") ?? true,
    exactOptions: true,
    options: rawOptions.map((entry) => option(entry, `Question ${id}`)),
    ...(links.length ? { links } : {}),
  };
}

/** The questions from the CLI's input, checked field by field. */
export function parseDecisionQuestions(value: unknown): UserQuestion[] {
  if (!Array.isArray(value))
    throw new Error(`questions must be a list of 1 to ${MAX_QUESTIONS}`);
  if (value.length > MAX_QUESTIONS)
    throw new Error(`questions must be a list of 1 to ${MAX_QUESTIONS}`);
  return checkQuestions(value.map(question));
}

const own = (record: object, key: string) =>
  Object.prototype.hasOwnProperty.call(record, key);

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, canonical((value as Record<string, unknown>)[key])]),
  );
}

/** Whether a retry asks the same questions, whatever order storage kept keys in. */
export function sameDecisionQuestions(
  a: readonly UserQuestion[],
  b: readonly UserQuestion[],
): boolean {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/** What one question's answer sends: option values, or the typed answer. */
function answerFor(
  question: UserQuestion,
  reply: AnsweredReply,
): string | undefined {
  const custom = own(reply.custom ?? {}, question.id)
    ? reply.custom?.[question.id]?.trim()
    : undefined;
  const selected = own(reply.answers, question.id)
    ? reply.answers[question.id]
    : [];
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

export function waitingDecisionCards(
  cards: readonly DecisionCard[] | undefined,
): DecisionCard[] {
  return (cards ?? []).filter((card) => !card.outcome);
}

export function findDecisionCard(
  session: Pick<Session, "decisionCards">,
  id: string,
): DecisionCard | undefined {
  return session.decisionCards?.find((card) => card.id === id);
}

/** The cards asked during one transcript turn, in the order they were asked. */
export function turnDecisionCards(
  cards: readonly DecisionCard[] | undefined,
  turn: readonly Block[],
): DecisionCard[] {
  if (!cards?.length) return [];
  const ids = new Set(turn.map((block) => block.id));
  return cards.filter((card) => ids.has(card.turnId));
}

/** Puts the stored card in the session, in place of any earlier copy. */
export function withDecisionCard(
  session: Session,
  card: DecisionCard,
): Session {
  const cards = session.decisionCards ?? [];
  const at = cards.findIndex((entry) => entry.id === card.id);
  return {
    ...session,
    decisionCards:
      at < 0
        ? [...cards, card]
        : cards.map((entry, index) => (index === at ? card : entry)),
  };
}

function restoredStrings(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  return entries.length ? Object.fromEntries(entries) : undefined;
}

function restoredOutcome(value: unknown): DecisionOutcome | undefined {
  if (!value || typeof value !== "object") return undefined;
  const outcome = value as Record<string, unknown>;
  const at = typeof outcome.at === "number" ? outcome.at : 0;
  if (outcome.kind === "dismissed") return { kind: "dismissed", at };
  if (outcome.kind !== "answered") return undefined;
  const reply = (outcome.reply ?? {}) as Record<string, unknown>;
  const answers = Object.fromEntries(
    Object.entries(
      reply.answers && typeof reply.answers === "object" ? reply.answers : {},
    ).flatMap(([key, ids]) =>
      Array.isArray(ids)
        ? [[key, ids.filter((id): id is string => typeof id === "string")]]
        : [],
    ),
  );
  const custom = restoredStrings(reply.custom);
  return {
    kind: "answered",
    at,
    reply: { kind: "answered", answers, ...(custom ? { custom } : {}) },
  };
}

function restoredQuestion(value: unknown): UserQuestion {
  const q = (value ?? {}) as Record<string, unknown>;
  if (typeof q.id !== "string" || typeof q.prompt !== "string")
    throw new Error("A saved question needs an id and a prompt");
  const options = Array.isArray(q.options)
    ? q.options.map((entry): UserQuestionOption => {
        const o = (entry ?? {}) as Record<string, unknown>;
        if (typeof o.id !== "string" || typeof o.label !== "string")
          throw new Error("A saved option needs an id and a label");
        return {
          id: o.id,
          label: o.label,
          ...(typeof o.description === "string"
            ? { description: o.description }
            : {}),
          ...(o.recommended === true ? { recommended: true } : {}),
        };
      })
    : [];
  const links = Array.isArray(q.links) ? q.links.map(webLink) : [];
  return {
    id: q.id,
    ...(typeof q.header === "string" ? { header: q.header } : {}),
    prompt: q.prompt,
    multiSelect: q.multiSelect === true,
    allowCustom: q.allowCustom !== false,
    exactOptions: true,
    options,
    ...(links.length ? { links } : {}),
  };
}

/** A saved card, held to the same rules as a new one, or nothing. */
export function restoreDecisionCard(value: unknown): DecisionCard | undefined {
  if (!value || typeof value !== "object") return undefined;
  const card = value as Record<string, unknown>;
  if (
    typeof card.id !== "string" ||
    typeof card.turnId !== "string" ||
    !Array.isArray(card.questions)
  )
    return undefined;
  try {
    const questions = checkQuestions(card.questions.map(restoredQuestion));
    const outcome = restoredOutcome(card.outcome);
    return {
      id: card.id,
      turnId: card.turnId,
      questions,
      askedAt: typeof card.askedAt === "number" ? card.askedAt : 0,
      ...(outcome ? { outcome } : {}),
    };
  } catch {
    return undefined;
  }
}

export function restoreDecisionCards(value: unknown): DecisionCard[] {
  return Array.isArray(value)
    ? value.flatMap((entry) => restoreDecisionCard(entry) ?? [])
    : [];
}
