// The Look conversation (glossary): one capture and its turns, open until the panel closes or the hotkey is pressed again.
// No electron imports: tests drive it with mock look streams.
import {
	type Capture,
	createModelResolver,
	LookError,
	type LookErrorKind,
	type look,
	type Settings,
} from "@omnitrix/agent";
import type { HudMessage } from "../preload/index.ts";
import type { AnswerInfo, LookSession } from "./history.ts";

/** What the conversation tells the HUD. */
export type ConversationEvent = Extract<
	HudMessage,
	{ type: "chunk" | "done" | "error" | "notice" | "redacted" | "fallback" }
>;

export type ConversationDeps = {
	look: typeof look;
	/** Read per answer, not at startup: the Console may have changed the key since. */
	getApiKey: () => string | undefined;
	getSettings: () => Settings;
	/** Writes the trace of every outcome, and the history of a finished answer (recordLook). */
	record: (session: LookSession, info: AnswerInfo) => void;
	now: () => number;
	emit: (event: ConversationEvent) => void;
};

export type Conversation = ReturnType<typeof createConversation>;

// Short, plain HUD text per failure; never the provider's raw message or JSON.
const errorMessages: Record<LookErrorKind, { text: string; retry: boolean }> = {
	busy: { text: "Gemini busy, retry", retry: true },
	"rate-limit": {
		text: "Too many requests, wait a moment and retry",
		retry: true,
	},
	"daily-limit": { text: "Daily free limit reached", retry: false }, // the fallback was tried already
	"bad-key": { text: "Bad API key, open Console", retry: false },
	blocked: { text: "Gemini blocked this content", retry: false },
	network: { text: "No connection to Gemini, retry", retry: true },
	aborted: { text: "Cancelled", retry: true },
	other: { text: "Something went wrong, retry", retry: true },
};

export const NO_KEY: ConversationEvent = {
	type: "notice",
	text: "Add API key in Console",
	openConsole: true,
};
export const NO_CONVERSATION: ConversationEvent = {
	type: "notice",
	text: "Nothing to follow up on, press Ctrl+Shift+Space",
};

export function createConversation(deps: ConversationDeps) {
	let controller = new AbortController();
	let session: LookSession | null = null;
	let lastFollowUp: string | undefined; // what Retry asks again

	/** Aborts the old answer (a stale answer must never overwrite a new one). */
	function renew() {
		controller.abort();
		controller = new AbortController();
		return controller.signal;
	}

	/** Streams one answer of the open conversation and records it once it ends, however it ends. */
	async function answer(followUp?: string, retry = false) {
		const signal = renew();
		const current = session;
		if (!current) return deps.emit(NO_CONVERSATION);
		lastFollowUp = followUp;
		const apiKey = deps.getApiKey();
		if (!apiKey) return deps.emit(NO_KEY);

		const settings = deps.getSettings();
		const info: AnswerInfo = {
			startedAt: deps.now(),
			endedAt: 0,
			model: settings.lookModel,
			fallback: false,
			retry,
			followUp,
		};
		const finish = (error?: LookErrorKind) => {
			info.endedAt = deps.now();
			info.error = error;
			try {
				deps.record(current, info);
			} catch (e) {
				console.error("Saving history/trace failed:", e);
			}
		};

		try {
			const { textStream, redactedCount } = deps.look({
				...current,
				followUp,
				settings,
				getModel: createModelResolver(apiKey),
				signal,
				onFallback: () => {
					info.model = settings.lookFallbackModel;
					info.fallback = true;
					deps.emit({ type: "fallback" });
				},
				onUsage: (usage) => {
					info.usage = usage;
				},
			});
			if (redactedCount > 0)
				deps.emit({ type: "redacted", count: redactedCount });
			let full = "";
			// look throws LookError("aborted") on abort and never yields after it, so no abort checks here.
			for await (const chunk of textStream) {
				full += chunk;
				deps.emit({ type: "chunk", text: chunk });
			}
			if (followUp)
				current.conversation.push({ role: "user", content: followUp });
			current.conversation.push({ role: "assistant", content: full });
			current.model = info.model;
			current.fallback ||= info.fallback;
			info.answer = full;
			finish();
			deps.emit({ type: "done" });
		} catch (error) {
			const kind = error instanceof LookError ? error.kind : "other";
			finish(kind);
			if (kind === "aborted") return; // whatever aborted it owns the HUD now
			console.error("Look failed:", error); // the full error stays in the terminal for debugging
			deps.emit({
				type: "error",
				...errorMessages[kind],
				openConsole: kind === "bad-key",
			});
		}
	}

	return {
		/** Starts a fresh conversation about capture and answers it. thumbnail: region only, for history. */
		start(capture: Capture, thumbnail?: string) {
			session = {
				id: deps.now(),
				capture,
				...(thumbnail && { thumbnail }),
				conversation: [],
				model: deps.getSettings().lookModel,
				fallback: false,
			};
			return answer();
		},
		/** Asks a follow-up in the open conversation, keeping its turns. */
		ask: (followUp: string) => answer(followUp),
		/** Asks the last question again: the same capture and follow-up. */
		retry: () => answer(lastFollowUp, true),
		/**
		 * Aborts the answer and drops the conversation. The returned signal aborts as soon as anything
		 * else happens to the conversation, so slow work before start (grabbing the selection,
		 * capturing a region) can tell it was overtaken.
		 */
		close() {
			session = null;
			return renew();
		},
	};
}
