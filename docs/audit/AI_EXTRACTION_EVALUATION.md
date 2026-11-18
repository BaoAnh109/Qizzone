# AI document extraction evaluation

**Status:** one local PDF sample passed; this is not a representative accuracy or cost benchmark.
**Implementation branch:** `feat/qizzone-v2-backend-aiv3` (isolated worktree; not pushed)
**Reviewed source revision:** `3c5199581f72046e2595d865be18cc9567785657` plus uncommitted working-tree changes; no release SHA is frozen.

## Current pipeline

1. The frontend runs deterministic PDF/DOCX/image parsers and shows an editable review draft.
2. It requests the AI fallback only when parsing returns no questions, detects question-count/numbering gaps, or produces an invalid structure for which the source contains recoverable option markers.
3. When the V2 API is configured, the frontend enqueues a durable job for the PostgreSQL-backed worker; otherwise the legacy Supabase Edge Function remains the fallback.
4. The extraction prompt treats file text as untrusted. Gemini is asked to copy grounded question text/options only, return no answer key or explanation, and follow a JSON schema. The client verifies normalized text and option labels against the source and leaves all AI-extracted answers unknown for teacher review.
5. Drafts require human review before they can be saved/published. AI output is not authoritative answer-key data.

## Available accuracy evidence

| Input | Fixture evidence | Result | Confidence/limitation |
|---|---|---|---|
| Four-page text PDF | A local replay of the supplied exam PDF through the current parser | 40/40 questions extracted, four options present on each, 40/40 detected answers matched the printed key, no parser quality flags | A one-file probe. It used temporary Node compatibility polyfills for newer PDF.js runtime APIs; the probe and source PDF are not committed, so the result is not yet reproducible from CI. |
| Scanned PDF | No scored fixture set | Not measured | OCR accuracy by scan quality, rotation, language and page layout is unknown. |
| DOCX | No scored fixture set | Not measured | Table, image, underline/bold answer markers, and unusual list formatting are not covered by a committed benchmark. |
| Standalone image | No scored fixture set | Not measured | No per-language or resolution benchmark. |
| Gemini fallback | No real provider request in the release review | Not measured | Mocked client/worker tests validate transport, validation and cancellation behavior, not extraction accuracy, latency, or real provider cost. |
| Answer-key tables and end-of-document keys | No scored corpus | Not measured | Must be evaluated separately from question text extraction; AI fallback must not infer the correct answer. |

## Safety and operational controls in code

- The fallback is conditional, has source/request limits, uses durable jobs when the V2 API is configured, and subjects AI output to source-grounding checks.
- The worker holds the Gemini key server-side, bounds retries and quota, validates image signatures, supports cancellation/lease loss, and clears prompt/image payloads on terminal job state.
- The current frontend handles `cancelled` as terminal and exposes an authenticated cancel action while using the V2 durable-job API. Focused mocked-API unit coverage verifies that cancellation reaches the server. Browser/staging behavior, canceled-job race outcomes, and the labeled corpus accuracy/latency/cost measurements remain unverified.
- The worker test suite uses mocked Gemini HTTP. No live Gemini call or usage/cost measurement was made; do not describe that as provider verification.

## Required benchmark before acceptance

Build a versioned, non-sensitive corpus with at least one independently labeled fixture for each required format/layout: text PDF, scanned PDF, DOCX, image, answer key at end, highlighted/underlined/bold answer markers, A/a/(A) variants, true/false, multi-select, formulas and embedded images. Record per-fixture question precision/recall, option completeness, answer-key precision/recall, unsupported/ambiguous count, runtime, Gemini calls, token usage and estimated cost. Keep deterministic parser success and Gemini fallback results separate. Add browser review-flow evidence proving no AI answer is silently published.

Do not call this evaluation complete until the corpus is reproducible in CI, errors are manually adjudicated, and acceptance thresholds are agreed and met. The 40-question PDF result is useful regression evidence for that file only.
