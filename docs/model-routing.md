# Cost-aware Claude routing

The backend uses one local policy for its Claude calls. It does not call another model to decide which model to use. All requests still use the existing `ANTHROPIC_API_KEY`; no new provider account or database migration is needed.

## Routing modes

`AI_ROUTING_MODE` defaults to `economy`:

| Work | Economy | Balanced | Quality |
| --- | --- | --- | --- |
| Routine Goblet of Fire turns | Haiku | Haiku | Sonnet |
| Go deeper, long answers, or locally detected reasoning-heavy topics/requests | Sonnet | Sonnet | Sonnet |
| PDF topic extraction, syllabus tasks, schedule directives | Haiku | Sonnet | Sonnet |
| OCR and flashcards | Haiku | Haiku | Sonnet |
| Whiteboard chat, question generation/extraction and grading | Sonnet | Sonnet | Sonnet |

Defaults are `claude-haiku-4-5-20251001` and `claude-sonnet-4-6`, models already used by this app. Override them with `AI_FAST_MODEL` and `AI_REASONING_MODEL` if your account needs different supported model IDs. This policy replaces the previous Opus defaults for whiteboard chat, syllabus parsing and schedule directives. It deliberately does not upgrade dependencies or choose the newest model automatically.

GoF uses deterministic signals: “Go deeper”, answers of at least 1,200 characters, or reasoning terms in the current topic title/summary or request (such as proof, derivation, algorithm, debug, critique or essay). These signals are heuristics, **not a quality guarantee**. Use `quality` to keep GoF on Sonnet if Haiku's tutoring is insufficient, or `balanced` for stronger plan/topic generation. Model changes can change answer quality; test on representative notes before a large study session.

## Repeated GoF costs

- Reopening a saved room reuses its existing PDF text and extracted topics. “Play again” now passes the room ID too, avoiding another extraction for cached rooms.
- The initial React effect is guarded against duplicate development-mode starts.
- The full existing notes context (up to the existing 30,000-character limit), topic map and tutor protocol form a stable system prefix. The current topic is a later block, so changing topics does not invalidate that prefix. Existing conversation history remains intact; no paid summarisation call or lossy topic retrieval is added.
- `AI_PROMPT_CACHING=true` (default) marks the stable prefix with Claude's five-minute ephemeral cache control. Set it to `false` to opt out.

Caching is provider-managed, model-specific, and depends on an identical prefix, sufficient prompt length and reuse within the TTL. Sonnet 4.6 requires at least 1,024 cacheable tokens; Haiku 4.5 requires 4,096. Below the minimum the breakpoint is ignored. Cache writes have a premium (1.25× ordinary input pricing); hits cost 0.1× for these models. A cold, expired, changed or different-model request may not save anything. There is **no guaranteed percentage saving** and no claim of measured live savings.

## Spend visibility and failures

Each successful model call logs only the task, selected model and numeric input/output/cache read/cache creation token counts when available. No notes, answers, user IDs or credentials are logged by the router. These records are server logs, not a persistent billing dashboard; use Anthropic's usage console to measure real spend.

The SDK's automatic retries are disabled for these calls. The router makes one model request per invocation, with no hidden classifier, quality re-run or expensive fallback. Provider errors surface through existing feature error handling; OCR may continue its existing per-batch handling. A user retry, another OCR batch, or a separate extraction is still a separate billable request. This is not a hard monetary cap—set account/workspace spend limits in Anthropic as well.

## Rollout and rollback

The application/backend owner can deploy the backend with no configuration changes to enable economy routing. Deploy the frontend as well for the replay/duplicate-start fixes. Optional model/mode/cache environment changes belong to the backend Vercel project and take effect on its next deployment. No secrets are added to the frontend.

To favour quality, set `AI_ROUTING_MODE=quality`. To disable cache writes, set `AI_PROMPT_CACHING=false`. Revert this code change to restore the old hardcoded model selection; no data rollback is needed.

References: [Claude prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing).
