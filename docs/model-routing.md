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

Unknown routing modes and blank model overrides fail before making a model request.

Defaults are `claude-haiku-4-5-20251001` and `claude-sonnet-4-6`, models already used by this app. Override them with `AI_FAST_MODEL` and `AI_REASONING_MODEL` if your account needs different supported model IDs. This policy replaces the previous Opus defaults for whiteboard chat, syllabus parsing and schedule directives. It deliberately does not upgrade dependencies or choose the newest model automatically.

GoF uses deterministic signals: “Go deeper”, answers of at least 1,200 characters, or reasoning terms in the current topic title/summary or request (such as proof, derivation, algorithm, debug, critique or essay). These signals are heuristics, **not a quality guarantee**. Use `quality` to keep GoF on Sonnet if Haiku's tutoring is insufficient, or `balanced` for stronger plan/topic generation. Model changes can change answer quality; test on representative notes before a large study session.

## Bounded Goblet of Fire cascade

GoF now checks each answer after generation, rather than only choosing a model upfront. Routine turns start with Haiku; reasoning-heavy turns still start directly with Sonnet to avoid an unnecessary cheap attempt.

A local gate rejects empty or truncated responses, malformed progression directives, invalid stars, finishing the wrong topic, or awarding mastery on the initial turn. The tutor may also emit an internal `{"action":"escalate"}` signal when it cannot reason reliably from the notes. Rejected replies are never shown or added to conversation history. No paid judge/classifier call is added.

If a Haiku response fails, GoF regenerates once with Sonnet using the original notes, messages and question. There are **at most two model requests per turn**, including any premium attempt. If neither passes, the API returns an error without advancing the topic. Provider/API errors are not automatically retried or escalated.

- `AI_CASCADE_ENABLED=true` by default; `false` disables second attempts while retaining validation.
- `AI_ALLOW_OPUS_ESCALATION=false` by default. The backend/account owner may explicitly set it to `true` to allow a Sonnet-first turn that fails validation to retry once with `AI_PREMIUM_MODEL` (default `claude-opus-4-6`).
- A Haiku → Sonnet turn **never adds an Opus third call**, even when premium escalation is enabled. Identical configured model IDs are not retried.

These are structural checks and a fallible model-reported uncertainty signal, **not a factual correctness score or proof of an optimal answer**. A fluent but wrong answer may pass. A failed first attempt plus a second model costs more than a successful single call; cache prefixes are model-specific. Keep premium escalation off when credits are scarce. Other features, including notes chat, remain single-call routed requests.

## Repeated GoF costs

- Reopening a saved room reuses its existing PDF text and extracted topics. “Play again” now passes the room ID too, avoiding another extraction for cached rooms.
- The initial React effect is guarded against duplicate development-mode starts.
- The full existing notes context (up to the 100,000-character supported-text limit on main), topic map and tutor protocol form a stable system prefix. The current topic is a later block, so changing topics does not invalidate that prefix. Existing conversation history remains intact; no paid summarisation call or lossy topic retrieval is added.
- `AI_PROMPT_CACHING=true` (default) marks the stable prefix with Claude's five-minute ephemeral cache control. Set it to `false` to opt out.

Caching is provider-managed, model-specific, and depends on an identical prefix, sufficient prompt length and reuse within the TTL. Sonnet 4.6 requires at least 1,024 cacheable tokens; Haiku 4.5 requires 4,096. Below the minimum the breakpoint is ignored. Cache writes have a premium (1.25× ordinary input pricing); hits cost 0.1× for these models. A cold, expired, changed or different-model request may not save anything. There is **no guaranteed percentage saving** and no claim of measured live savings.

## Spend visibility and failures

Each successful model call emits an INFO log record containing only the task, selected model and numeric input/output/cache read/cache creation token counts when available. Enable INFO output for `app.core.model_router` in your server logging configuration to collect these records. No notes, answers, user IDs or credentials are logged by the router. These records are server logs, not a persistent billing dashboard; use Anthropic's usage console to measure real spend.

The SDK's automatic retries are disabled for these calls. Ordinary routed features make one request; GoF's validated cascade makes at most two as described above. There is no paid classifier/judge, and Opus requires explicit opt-in. Provider errors surface through existing feature error handling; OCR may continue its existing per-batch handling. A user retry, another OCR batch, or a separate extraction is still a separate billable request. This is not a hard monetary cap—set account/workspace spend limits in Anthropic as well.

## Rollout and rollback

The application/backend owner can deploy the backend with no configuration changes to enable economy routing. Deploy the frontend as well for the replay/duplicate-start fixes. Optional model/mode/cache environment changes belong to the backend Vercel project and take effect on its next deployment. No secrets are added to the frontend. Review the cascade and premium settings in the backend Vercel project before enabling premium spend; all are optional and defaults need no configuration changes.

To favour quality, set `AI_ROUTING_MODE=quality` (Sonnet by default). Set `AI_CASCADE_ENABLED=false` for single-attempt GoF, and leave `AI_ALLOW_OPUS_ESCALATION=false` to prohibit the premium escalation stage. To disable cache writes, set `AI_PROMPT_CACHING=false`. Revert this code change to restore the old hardcoded model selection; no data rollback is needed.

References: [Claude prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching), [Claude pricing](https://platform.claude.com/docs/en/about-claude/pricing).
