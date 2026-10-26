# Product Design — Feature Intelligence System

| | |
|---|---|
| Status | Draft v0.1 — for review |
| Date | 2026-10-25 |
| Scope | Initial use case selection, AI-first workflow, architecture, MVP scope, metrics |
| Stack (from CLAUDE.md) | TypeScript · React · Node.js · Gitflow |

> **Evidence note.** No customer research, production data, or measurements exist for this project yet. Every target, baseline and user pain point below is a **provisional assumption** unless explicitly labelled as a confirmed requirement (sourced from the assessment brief in `CLAUDE.md`).

---

## 1. Executive summary

Feature requests arrive as unstructured text, written by different people, in different words, about overlapping problems. A product manager (PM) has to read each one, decide whether it is new or already known, and attach it to the right place, otherwise support signals fragment across near-duplicates and prioritization is done on a distorted picture.

**The first problem we solve is intake triage:** for every new request, the system extracts the *underlying need* behind the proposed feature, finds existing requests that express the same need, and proposes a concrete triage action — *link to existing need cluster*, or *create a new cluster* — with quoted evidence. The PM accepts, edits or rejects the proposal in one step. Requesters see where their request went and why.

AI changes the workflow from **"PM reads everything and searches by memory/keyword"** to **"system proposes a grounded consolidation decision, PM reviews exceptions."** The architecture is deliberately simple: a deterministic pipeline using **embeddings for candidate retrieval** and **one LLM call with schema-constrained output** for need extraction and match adjudication. No autonomous agents.

## 2. Problem statement and target user

### 2.1 Problem
*(Provisional assumptions — to validate with real PMs.)*

1. **Fragmented demand.** The same need is submitted as many differently worded requests ("export to Excel", "download my data as CSV", "need reports in a spreadsheet"). Votes and customer context split across them, so the true size of a need is under-counted and visible rankings are wrong.
2. **Solution-shaped requests.** Requesters describe *a solution* ("add a dark mode toggle") rather than *the need* ("I work late and the bright UI strains my eyes"). Matching on the literal solution misses related requests; deciding on it locks the team into one solution prematurely.
3. **Triage is slow and inconsistent.** Keyword search does not find paraphrases, and triage quality depends on which PM remembers which past request.
4. **Opaque outcomes.** Requesters cannot see how their submission was grouped or evaluated, which reduces trust and increases "any update?" follow-ups.

### 2.2 Users

| Role | Goal | Relationship to MVP |
|---|---|---|
| **Product Manager / Triager** (primary) | Keep the request backlog accurate and consolidated with minimal reading time | Reviews AI triage proposals; owns all consolidation decisions |
| **Requester** (customer, CSM, sales, support, internal staff) | Submit a need, support existing ones, see what happened to it | Submits, discovers, supports; sees grouping explanations |
| **Product leader** (secondary beneficiary) | Trust that demand counts reflect real, deduplicated needs | Consumes the consolidated view; no dedicated MVP feature |

### 2.3 Business value (hypothesis)
- Less PM time spent on reading and searching during triage.
- More accurate demand signals per need (supporters are aggregated, not split), which is the precondition for every later capability: prioritization, briefs, trend detection.
- Transparent grouping for requesters, satisfying the confirmed requirement to "understand how requests are being grouped, evaluated, or prioritized".

## 3. Candidate use cases

Five candidates from the lifecycle were evaluated. Ratings are qualitative judgements (H = favourable, M = mixed, L = unfavourable), not measured facts. For *Risk*, H means risk is **low/manageable**.

| # | Candidate | Business value | AI suitability | Workflow impact | Feasibility (MVP) | Measurability | Risk & oversight |
|---|---|---|---|---|---|---|---|
| A | **Intake triage: need extraction + duplicate consolidation** | H | H | H | H | H | H |
| B | Batch thematic grouping of the backlog | M | H | M | M | M | M |
| C | AI priority recommendation against business criteria | H | M | H | L | L | L |
| D | Decision-brief generation for product leaders | M | H | L | H | L | M |
| E | Emerging-need / trend detection | M | M | M | L | L | M |

### Key tradeoffs
- **A vs B (thematic grouping).** Both rely on semantic similarity. B produces fuzzy, many-to-many themes whose correctness is subjective and hard to label; A makes a crisp, per-request decision (same need / not) that a PM can confirm in seconds and that can be scored with precision/recall. A also intervenes *at intake*, preventing fragmentation rather than cleaning it up later. Themes can be built on top of A's clusters later.
- **C (prioritization)** has the highest strategic value but depends on business signals we do not have (revenue, segment, strategy weights), and an AI-generated score risks being treated as a decision. It is also only as good as the demand data — which A fixes first.
- **D (decision briefs)** is easy to demo but mostly generated text; it does not change an operational decision and its quality is hard to measure objectively. Without clean clusters, briefs summarize noise.
- **E (trends)** needs request volume over time to be meaningful; a synthetic demo would be unconvincing.

## 4. Selected use case and rationale

**Selected: A — AI-assisted intake triage that extracts the underlying need of each new request and proposes consolidation into an existing *need cluster* (or a new one), with PM approval.**

**Why it is the best starting point**
- It addresses a concrete, frequent operation (one decision per incoming request) performed by an identifiable user (the triaging PM).
- It requires real semantic understanding — paraphrase detection and solution-to-need abstraction — which keyword rules cannot do reliably.
- It changes *who does what*: the system proposes, the PM disposes. The PM stops searching and starts reviewing.
- Its quality is directly measurable against a labelled dataset, and its business effect (triage time, acceptance rate) is observable in the review UI.
- It is foundational: accurate clusters make support counts, prioritization (C), briefs (D) and trends (E) trustworthy later.
- It naturally satisfies all four confirmed Core Requirements (submit, discover, support, understand grouping).

**Deferred**
- C: needs business data and an approval policy; revisit once cluster quality is measured.
- B, D, E: build on clusters; deferred until A's data model is stable.

**Assumptions underpinning the selection** *(provisional, need validation)*
- S1. Duplicate/near-duplicate requests are common enough in real backlogs to matter (validate with a sample from a real tool).
- S2. PMs currently triage manually and would accept an AI proposal they can override.
- S3. Requests are mostly short text (title + description, < ~2,000 words), in one primary language (English) for the MVP.
- S4. Volume is moderate: hundreds to low thousands of requests per workspace, tens per day.

## 5. AI-first workflow

### 5.1 Before (assumed manual process)
Request submitted → lands in an untriaged list → PM reads it → PM searches by keyword / memory for similar items → PM merges, tags or leaves it → supporters remain split if a match is missed. Limitations: paraphrases missed, inconsistent between PMs, no record of *why* items were merged, requester gets no explanation.

### 5.2 After (MVP workflow)

| Step | What happens | Performed by |
|---|---|---|
| 1. Submit | Requester enters title + description (+ optional "why do you need this?"). Request stored immediately with status `pending_triage`; request is visible and supportable at once. | Deterministic |
| 2. Validate & normalise | Required fields, length limits, whitespace/HTML stripping, exact-duplicate check (normalised text hash) against the same requester. | Deterministic |
| 3. Redact | Mask obvious PII (emails, phone numbers) before any provider call; originals stay in our DB. | Deterministic (regex) |
| 4. Extract need | LLM returns structured fields: `need_statement` (problem, not solution), `proposed_solution`, `affected_user_type`, `evidence_quotes[]` (verbatim spans), `clarity` (`clear` / `vague` / `multiple_needs`). | **AI (LLM)** |
| 5. Retrieve candidates | Embed `need_statement`; retrieve top-k (k≈5) existing clusters by cosine similarity above a recall-oriented floor. | **AI (embeddings)** + deterministic ranking |
| 6. Adjudicate | LLM compares the new need with each candidate cluster and returns per-candidate `relation` (`same_need` / `related` / `different`), `confidence` (`high` / `medium` / `low`), `rationale`, and quoted evidence from both sides. | **AI (LLM)** |
| 7. Build proposal | Rules convert adjudication into one proposal: *link to cluster X* (best `same_need`), *create new cluster*, or *needs human attention* (vague, multiple needs, conflicting candidates, low confidence, AI failure). | Deterministic |
| 8. Grounding check | Every `evidence_quote` must be an exact substring of the source text; otherwise the proposal is downgraded to `low` confidence and flagged. | Deterministic |
| 9. **PM review** | PM sees the request, extracted need, proposal, evidence and alternatives. Actions: **Accept**, **Choose another cluster**, **Create new cluster**, **Edit need statement**, **Split** (multiple needs), **Reject / mark spam**. | **Human** |
| 10. Apply | Request linked to the cluster; cluster supporter count recomputed as the distinct union of supporters across linked requests; audit event written. | Deterministic |
| 11. Inform requester | Request page shows "Linked to: *<need cluster>*" with the reviewed rationale. No message is sent without PM approval. | Deterministic (template) |

**How AI changes the workflow:** the PM's task shifts from *finding* matches (open-ended search) to *verifying* a single proposed decision with evidence. The consolidation decision becomes explicit, explained and recorded, and support signals are merged at intake rather than in occasional clean-ups.

### 5.3 Uncertainty, conflict and error handling
- **Vague requests** (`clarity = vague`): proposal is *needs human attention*; PM can add a clarification note or ask the requester (out-of-band in MVP).
- **Multiple needs in one request**: flagged; PM uses *Split* to create child requests that are triaged independently.
- **Conflicting candidates** (two clusters both `same_need`): surfaced as a possible cluster-level duplicate; PM decides; cluster merge is out of scope for automation.
- **Conflicting feedback** (requests that want opposite things for the same need, e.g. "more notifications" vs "fewer notifications"): treated as the *same need* (notification control) with differing proposed solutions; both solutions remain visible in the cluster. The model is instructed not to collapse opposing solutions into one.
- **AI failure** (timeout, invalid output, refusal): request stays `pending_triage` with `ai_status = failed`; PM can triage manually with plain keyword search. The product works without AI.
- **Nothing is auto-applied in the MVP.** Every link is a PM decision.

### 5.4 Audit trail and traceability
- Requests are never deleted or rewritten by consolidation; linking is a reversible relation.
- Every AI run stores: input hash, prompt version, model ID, embedding model ID, raw structured output, latency, token usage, and validation outcome.
- Every review stores: reviewer, timestamp, the proposal shown, the action taken, and any edits (diff against the AI output).
- Each cluster shows the list of linked requests and the reviewed rationale for each link.

## 6. AI architecture

### 6.1 Options evaluated

| Option | Verdict | Reason |
|---|---|---|
| Direct LLM call only (send all clusters in the prompt) | Rejected | Cost and latency grow with the backlog; context limits; harder to evaluate retrieval separately |
| Embeddings only (similarity threshold decides) | Rejected as sole mechanism | Cannot distinguish "same words, different need" (e.g. *export invoices* vs *export audit logs*) or extract the need from a solution; no rationale for the PM |
| Classification / fine-tuned model | Deferred | No labelled data yet; becomes viable later using PM review decisions as labels |
| Tool-using agent | Rejected | Workflow steps are fixed and known; an agent adds nondeterminism, cost and harder evaluation with no requirement driving it |
| Multi-agent workflow | Rejected | No sub-task needs independent planning |
| **Hybrid: deterministic pipeline + embeddings retrieval + LLM with structured output** | **Selected** | Embeddings give cheap, scalable recall; the LLM provides precision, need abstraction and explanation; deterministic code owns state, rules and validation |

### 6.2 Components and justification

| Component | Requirement it serves | Choice (provisional where noted) |
|---|---|---|
| LLM — need extraction + adjudication | Semantic abstraction, comparison, short rationale; must return machine-verifiable JSON | **Anthropic Claude via the Messages API with structured outputs** (`output_config.format` JSON Schema, now GA). Start with **Claude Haiku 5.5** for both steps; evaluate **Claude Sonnet 5.5** for adjudication if precision targets are not met. Final choice decided by the eval set (§8), not by assumption. |
| Embeddings | Candidate retrieval over need statements | **Voyage AI `voyage-4-lite`** (latency/cost-optimised; `voyage-4` as quality fallback). Use `input_type: "document"` for stored needs, `"query"` for the new need. Provisional — compare against one alternative provider on the eval set. |
| Vector search | Top-k cosine over ≤ low thousands of vectors | **PostgreSQL + `pgvector`** in the same database as relational data. Justification: we already need a relational DB; the extension avoids a second datastore. A dedicated vector DB is not justified at this scale. Exact (non-indexed) search is sufficient initially. |
| Orchestration | Fixed, linear pipeline with retries | Plain TypeScript service code + a lightweight job queue (DB-backed). No agent framework. |
| Schema validation | Defence in depth beyond provider guarantees | Zod schemas shared between prompt definition and runtime validation. |
| Provider abstraction | Future model replacement | Narrow internal interfaces: `NeedExtractor`, `Embedder`, `MatchAdjudicator`. Prompts versioned in the repo. |

Framework note: the official `@anthropic-ai/sdk` (TypeScript) is sufficient. A multi-provider SDK (e.g. Vercel AI SDK) is an acceptable alternative if provider switching becomes a near-term requirement; this is a reversible decision.

### 6.3 Required model capabilities
Paraphrase and intent understanding; distinguishing a need from a proposed solution; pairwise comparison with justification; reliable JSON schema adherence; short context (< ~4k tokens per call). No long-context, tool use, vision or multi-step reasoning is required.

### 6.4 Validation and grounding
1. Provider-side schema-constrained decoding (structured outputs).
2. Runtime Zod validation; enums compared case-insensitively (documented provider caveat).
3. `evidence_quotes` must be exact substrings of the redacted source text; candidate IDs must exist in the retrieved set. Violations → downgrade and flag.
4. Categorical confidence (`high/medium/low`) instead of numeric probabilities, because LLM numeric scores are not calibrated; the mapping from categories to proposal rules is deterministic and tuned on the eval set.

### 6.5 Failure handling
- Timeouts per call (e.g. 20 s) and bounded retries (2) with exponential backoff + jitter on 429/5xx/timeouts.
- `stop_reason` of `max_tokens` → one retry with a higher limit; `refusal` → no retry, flag for human.
- Idempotent jobs keyed by request ID + prompt version; reprocessing is safe.
- Provider outage → requests queue as `pending_triage`; manual triage path remains available.

### 6.6 Evaluation, observability, model replacement
- Offline eval harness runs the pipeline against the labelled set and reports metrics per prompt/model version (§8). Any model or prompt change must be compared on this set before rollout.
- Per-run logs (see §5.4) plus aggregate dashboards: latency p50/p95, failure rate, cost per request, acceptance/edit/reject rates.

### 6.7 Cost, latency, privacy, reliability tradeoffs
- **Cost:** two short LLM calls + one embedding per request. Expected to be small at tens of requests/day, but **not estimated here** — verify current provider pricing before committing to a budget.
- **Latency:** triage is asynchronous (seconds are acceptable); submission is never blocked on AI.
- **Privacy:** PII redaction before provider calls; only request text is sent (no account or revenue data in the MVP); review provider data-retention terms before handling real customer data.
- **Reliability:** AI is advisory; the system remains fully usable when AI is unavailable.

## 7. Human oversight and responsible behaviour

- **Recommendation ≠ decision.** AI output is stored as a *proposal*; only a PM action creates a link. The UI labels AI content as "Suggested".
- **Inspectable evidence.** Every proposal shows the quoted spans from the new request and from the candidate cluster's requests, with links to originals.
- **Correction.** PM can choose another cluster, create a new one, edit the need statement, split, or reject. Links can be undone; history is retained.
- **Uncertainty.** Confidence category and reason ("vague request", "two possible matches") are shown; low-confidence proposals are visually de-emphasised and never pre-selected.
- **Conflicts.** Opposing solutions to the same need are kept side by side; the system does not decide between them.
- **Prioritization.** The MVP shows only **transparent, deterministic signals** per cluster (distinct supporters, linked requests, most recent activity). No AI priority score is produced. Any future AI prioritization requires an explicit, documented approval policy and criteria defined by product leadership.
- **Sensitive data.** PII redaction pre-provider; role-based visibility (requesters see public fields only; internal notes are PM-only).
- **Learning from corrections.** Corrections are logged as labelled examples that extend the eval set and inform prompt/threshold changes. No automatic model training or fine-tuning is assumed.
- **Requester communication.** Requesters see the reviewed cluster link and rationale; nothing generated is shown to them before PM approval.

## 8. Success metrics and evaluation

| | M1 — Median triage time per request | M2 — Consolidation match quality | M3 — Proposal acceptance without substantial correction |
|---|---|---|---|
| Type | Business / workflow impact | Model quality | Workflow trust / usefulness |
| Definition | Time from a PM opening an untriaged request to recording a triage decision | Precision and recall of `same_need` links vs. ground truth, plus top-1 cluster accuracy | Share of proposals accepted as-is or with only minor edits (edit to need statement wording, same cluster) |
| Method | Instrumented timestamps in the review UI; compare manual mode (AI hidden) vs. assisted mode | Offline eval harness on labelled dataset; online: PM decisions as labels | Review actions logged per proposal; "substantial" = different cluster, split, or reject |
| Baseline | **Not available.** Plan: measure with AI-hidden mode on the same request set with the same reviewers | Plan: compute embeddings-only threshold baseline on the same dataset | Not applicable before launch; establish in first evaluation round |
| Target (hypothesis, unvalidated) | ≥ 50 % reduction vs. manual baseline | Precision ≥ 0.90 (merging wrongly is costlier), recall ≥ 0.80 | ≥ 70 % |
| Conditions | ≥ 2 reviewers, ≥ 50 requests each mode, counterbalanced order | Fixed dataset + prompt/model version; re-run on every change | First 100 proposals in a pilot / demo session |
| Limitations / incentives | Speed can be gamed by rubber-stamping — monitor M3 and spot-audit accepted proposals | High precision on a synthetic set does not prove triage improved (that is M1) | High acceptance may indicate over-reliance; audit a random 10 % of accepted links |

### Evaluation dataset (initial)
- **Synthetic, documented dataset** (no real customer data available): a fictional B2B SaaS product, ~200 requests mapped to ~40 ground-truth need clusters, including:
  - paraphrases with no shared keywords (positives),
  - same keywords, different needs (hard negatives),
  - solution-shaped vs. need-shaped phrasings of the same need,
  - vague requests, multi-need requests, opposing solutions to one need,
  - noise (spam, very short text) and PII examples.
- Labels produced by the author and independently reviewed by a second person where possible; disagreements recorded, not hidden.
- **Error analysis:** false positives (wrong merges) reviewed individually — they are the more harmful error because they hide a distinct need; false negatives tracked as missed consolidation; every PM correction in pilot use is added to the set.
- Clearly label the dataset as synthetic in all demos and results.

## 9. Initial product scope (MVP)

**Primary user and goal:** a PM wants every incoming request attached to the right need with minimal reading and searching.

**Initial user journey**
1. Requester submits a request → sees it listed immediately as "Awaiting triage".
2. Requester browses/searches existing needs and requests and supports one (one support per user per cluster).
3. PM opens the triage queue → sees the AI proposal with evidence → accepts or corrects.
4. Requester sees the request "Linked to *<need>*" with the rationale; cluster shows aggregated supporters.
5. Before/after demo: the same seeded backlog shown fragmented (raw requests with split votes) vs. consolidated (clusters with aggregated support).

**Minimum domain concepts**
- *FeatureRequest* — original text from a requester; belongs to 0..1 NeedCluster.
- *NeedCluster* — a reviewed underlying need with a canonical statement; has many requests.
- *Support* — a user's expression of interest, attached to a request; counted distinctly at cluster level.
- *TriageProposal* — AI output for a request (versioned, immutable).
- *ReviewDecision* — PM action on a proposal.
- *AuditEvent* — append-only record of state changes.

**Essential backend capabilities:** request CRUD (create/read), support, cluster read, async triage job, AI pipeline with validation, review actions, audit log, simple role model (requester / PM), seed + eval scripts.

**Essential frontend capabilities:** submit form; browse/search list of needs and requests; support action; request detail with grouping explanation; PM triage queue and review panel with evidence and alternatives.

**AI processing and evaluation:** need extraction, embedding retrieval, adjudication, grounding checks, offline eval harness with metric report.

**Human review and feedback:** accept / reassign / create / edit / split / reject; corrections exported to the eval set.

**Minimum observability:** per-run AI log; small admin view or report with M1–M3, failure rate, latency, and cost per request.

**Explicitly out of scope:** AI prioritization or scoring; decision briefs; trend detection; batch re-clustering of the historical backlog; automated cluster merging; automatic notifications/emails; integrations (Jira, Intercom, Zendesk, Slack); CRM/revenue enrichment; SSO and multi-tenant billing; non-English support; fine-tuning.

## 10. Risks, assumptions and tradeoffs

### 10.1 Risk register

| Risk | Impact | Mitigation / evaluation |
|---|---|---|
| Incorrectly merging different needs | Hides a real need; distorted demand | No auto-apply; precision-weighted target; hard negatives in eval set; reversible links |
| Missing true duplicates | Fragmentation persists | Recall-oriented retrieval floor; recall metric; PM can search manually |
| Poor-quality / vague input | Bad extraction | `clarity` flag; optional "why do you need this" field; human path |
| Hallucinated rationale or evidence | Misleading PM | Exact-substring evidence check; candidate-ID validation; show originals |
| Biased signals (loud customers, internal staff over-represented) | Skewed perceived demand | MVP avoids priority scores; show supporter breakdown by role; deferred to C with explicit criteria |
| Over-reliance on proposals | Rubber-stamping errors | Low-confidence not pre-selected; audit sample of accepted links; monitor M1 vs M3 together |
| Latency / cost spikes | Slow triage, budget overrun | Async jobs, small models first, per-request cost logging, verify pricing before launch |
| Privacy / retention | Customer data exposure | PII redaction; minimal data to provider; review provider retention terms; no real data in demo |
| Provider outage or model deprecation | Triage blocked | Manual fallback; provider interfaces; eval set gates model swaps |
| Unprovable impact with little data | Weak business case | Controlled A/B (manual vs assisted) on same set; report honestly as synthetic |

### 10.2 Confirmed requirements (from the brief in `CLAUDE.md`)
- Users can submit a request with title and description; view and discover requests; express support; understand grouping/evaluation/prioritization.
- The solution is AI-first, targets a high-value point in the lifecycle, explains the AI technology and why, keeps human judgment where needed, and defines 2–3 success metrics.
- Stack: TypeScript, React, Node.js. Branching: Gitflow.

### 10.3 Provisional assumptions
S1–S4 (§4); English-only; single workspace; PMs are the only triagers; requests are text-only; seconds of triage latency are acceptable; Claude Haiku 5.5 / voyage-4-lite are adequate (to be confirmed by eval).

### 10.4 Key tradeoffs accepted
- Precision over recall (wrong merges are costlier than missed ones).
- Human approval on every link (slower than auto-merge, but safe and measurable).
- Pipeline over agent (less flexible, but predictable, cheaper and evaluable).
- Synthetic data (demonstrable now, but cannot prove real-world impact).

## 11. Acceptance criteria (MVP)

1. A requester can submit a request (title required, description required) and it appears in the list without waiting for AI processing.
2. A requester can search/browse needs and requests and add one support per cluster; cluster support equals the distinct supporters across its linked requests.
3. Within 60 s of submission under normal provider conditions, a triage proposal exists with: need statement, proposed action, confidence category, rationale, and ≥ 1 evidence quote.
4. Every stored evidence quote is an exact substring of its source text; proposals failing this are flagged and never shown as `high` confidence.
5. Structured outputs that fail schema validation are retried per policy and, if still invalid, the request is marked `ai_status = failed` and remains manually triageable.
6. No request is linked to a cluster without a PM review action; the audit log records the proposal, the action, the actor and the time.
7. A PM can accept, reassign, create new cluster, edit need statement, split, and reject; links can be undone without data loss.
8. A requester can see which need their request is linked to and the reviewed rationale.
9. PII patterns (emails, phone numbers) are redacted from text sent to AI providers, verified by test fixtures.
10. The eval harness runs on the documented synthetic dataset and outputs precision, recall, top-1 accuracy and an embeddings-only baseline for comparison.
11. The metrics report shows M1–M3, AI failure rate, p50/p95 latency and cost per request.
12. Prompt version and model IDs are recorded for every AI run.

## 12. Open questions

1. **Is duplicate fragmentation actually the top pain?** Validate with at least one real backlog sample or PM interviews; if not, revisit candidate B or C.
2. **Who are the requesters** — external customers via a portal, or internal staff on behalf of customers? Changes visibility rules and supporter weighting.
3. **What business context is available** (account tier, ARR, segment)? Determines when prioritization (C) becomes viable.
4. **Data residency / retention constraints** for sending customer text to third-party model providers.
5. **Final model and embedding provider** — decided by the eval results and current pricing; is a single-vendor stack acceptable?
6. **Cluster-level operations** (merging two clusters, renaming needs) — manual-only for MVP; is that sufficient for the demo?
7. **Should high-confidence proposals ever auto-apply?** Only after measured precision justifies it and an approval policy is agreed.

---

### References
- Anthropic — Structured outputs: https://platform.claude.com/docs/en/build-with-claude/structured-outputs
- Voyage AI — Text embeddings: https://docs.voyageai.com/embeddings/
