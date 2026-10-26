# Evaluation

Status: step 1. The dataset, metrics and harness exist, and so far only a **non-AI lexical baseline** has been evaluated. The AI pipeline (embeddings + LLM assessment) plugs into the same harness in step 2.

## Synthetic dataset

|             |                                                                                                                               |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Product     | _Tasklane_, a fictional B2B work-management SaaS (projects, tasks, time tracking, invoicing)                                  |
| Size        | **201 requests in 40 need groups** across 15 families of related groups                                                       |
| Group sizes | 1–10 requests (2 single-request groups, 3 with 2 requests, … 2 with 10)                                                       |
| Seed        | `20261025`                                                                                                                    |
| Origin      | Written for this project by the AI assistant during development. **Not real customer feedback**; no real people or companies. |

### Files

| File                                       | Contents                                                                                                        | Who may read it                                                   |
| ------------------------------------------ | --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `data/synthetic/requests.jsonl`            | Runtime inputs: `id`, `arrivalIndex`, `submittedAt`, `sourceChannel`, `title`, `description`, `synthetic: true` | Anything, including matchers. Strict schema: **no label fields**. |
| `data/synthetic/manifest.json`             | Version, seed, counts, SHA-256 of every generated file                                                          | Anything                                                          |
| `data/synthetic/ground-truth/catalog.json` | Hand-authored source: groups (key, family, need statement) and their requests with tags                         | Evaluation harness only                                           |
| `data/synthetic/ground-truth/labels.jsonl` | `requestId → groupKey, family, acceptableGroupKeys, tags`                                                       | Evaluation harness only                                           |
| `data/synthetic/ground-truth/groups.json`  | Group key, family, need statement, size                                                                         | Evaluation harness only                                           |
| `data/synthetic/ground-truth/splits.json`  | Family-level dev/test split                                                                                     | Evaluation harness only                                           |

How labels stay isolated:

1. Labels live in a separate directory from the inputs.
2. Ids are one-way hashes (`syn-<12 hex>`) that don't reveal the group.
3. The matcher interface receives only `{id, title, description}` plus **opaque** group ids (`G001`…) for past requests (asserted in `simulate.test.ts`).
4. ESLint `no-restricted-imports` forbids apps from importing `**/ground-truth/**`, `**/data/synthetic/**` or `@fis/evaluation`.
5. `isolation.test.ts` scans `apps/*/src` for references to them.

### What makes it hard

- **Hard negatives.** Every family has two to four groups about the same product area but different needs. Examples: _invoice → accounting sync_ vs _admin audit trail_ vs _scheduled report delivery_ (all "export"); _notification digest_ vs _instant mention alerts_ vs _quiet hours_; _dark mode_ vs _low-vision accessibility_ vs _keyboard power use_; _online payment_ vs _overdue reminders_.
- **Wording variety** (tag counts): paraphrases with little shared vocabulary (45), solution-shaped requests ("add a Stripe button") (61), problem-framed requests (27), terse one-liners (26), near-duplicates (9), ambiguous requests (4), a multi-need request, a Spanish request, and requests whose wording points at the wrong group (`hard_wording`, 3).
- **No-match cases.** The first request of each group in arrival order is a create-new-group case (40 of them, including two groups that only ever have one request).
- **Synthetic personal data.** Three requests contain a fake email on an `example.*` domain or a fictional `555-01xx` phone number, to exercise the privacy handling in step 2. The validator rejects any other email domain or phone pattern.

### Commands

```bash
pnpm dataset:generate [--seed N]   # deterministic: same catalog + seed → byte-identical files
pnpm dataset:validate              # exits non-zero on any error
```

The validator checks:

- catalog schema
- unique group keys and texts (no exact duplicates)
- valid `alsoAcceptable` references
- dataset-shape targets (180–220 requests, 35–45 groups, varied sizes, ≥ 1 singleton, ≥ 10 families with related groups, minimum tag counts)
- that no text contains its own group key
- the PII rules
- that the strict runtime schema holds (no extra fields)
- every request labelled exactly once
- splits disjoint, covering, and with no family in both
- that the generated files and manifest match a fresh regeneration byte for byte

## Evaluation design

### Unit and simulation

The **evaluation unit is one incoming request**. Requests in a split are replayed in arrival order. Each one is matched against the requests that arrived **before** it in the same split, and those earlier requests are assumed to have been grouped correctly by a reviewer (oracle review). The matcher can therefore only link to groups that already exist, just like in production.

### Ground-truth rules

| Situation                                                           | Correct action                                                   |
| ------------------------------------------------------------------- | ---------------------------------------------------------------- |
| An earlier request has the same ground-truth group                  | **link** (gold link)                                             |
| No earlier request has the same group                               | **create new group** (gold new group)                            |
| The request lists `alsoAcceptable` groups (ambiguous or multi-need) | A link to any of them that already exists also counts as correct |

### Metrics

Retrieval quality (stage C) and decision quality (stage D) are reported **separately**.

| Metric                   | Definition                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| recall@k (retrieval)     | Share of gold-link requests where an acceptable group is in the top-k candidates (k = 1, 3, 5, 10)                                    |
| MRR (retrieval)          | Mean reciprocal rank of the first acceptable group (0 if absent)                                                                      |
| **precision** (decision) | correct links ÷ predicted links                                                                                                       |
| **recall** (decision)    | gold-link requests linked to an acceptable group ÷ gold-link requests                                                                 |
| false positives          | Links to a wrong group, split into **within-family** (hard negative) and cross-family                                                 |
| false negatives          | Gold-link requests that were not linked to an acceptable group                                                                        |
| new-group accuracy       | Gold new-group requests for which the matcher proposed a new group                                                                    |
| abstentions              | "Needs human attention" results. They count against recall but not precision, and are reported separately (always 0 for the baseline) |
| hard-negative subset     | The same metrics restricted to requests that arrived when a related, different group from the same family already existed             |
| per-tag                  | The same metrics for each tag (ambiguous, terse, paraphrase, …)                                                                       |

### Split and tuning

The split is at **family** level (dev: 9 families, 104 requests; test: 6 families, 97 requests). Related groups never straddle the split, so tuning on dev never sees paraphrases or hard negatives of test groups. Thresholds, and in step 2 prompts, are tuned **only on dev** and reported unchanged on test.

Operating point rule: highest dev recall subject to dev precision ≥ 0.90 (the design's precision-first hypothesis). If that's unreachable, the harness uses the max-F1 threshold and reports that the floor was not met.

## Results so far (2026-10-25)

**Matcher:** TF-IDF bag-of-words cosine over earlier requests, aggregated to groups by best score, linking the top candidate when its score ≥ threshold. No AI. It exists as a reference point.

`pnpm eval` (threshold 0.28, selected on dev):

|                                         | dev (104)             | test (97)             |
| --------------------------------------- | --------------------- | --------------------- |
| gold links / gold new groups            | 82 / 22               | 79 / 18               |
| retrieval recall@1 / @5 / @10           | 45.1% / 76.8% / 89.0% | 68.4% / 91.1% / 92.4% |
| retrieval MRR                           | 0.598                 | 0.772                 |
| decision precision                      | 90.0%                 | 100.0%                |
| decision recall                         | 11.0%                 | 26.6%                 |
| false positives (within / cross family) | 1 (0 / 1)             | 0                     |
| false negatives                         | 73                    | 58                    |

Lower thresholds, for the precision/recall tradeoff (`pnpm eval --threshold <t>`):

| threshold | dev P / R     | test P / R    | test false positives (within / cross family) |
| --------- | ------------- | ------------- | -------------------------------------------- |
| 0.20      | 63.6% / 25.6% | 86.5% / 40.5% | 5 (1 / 4)                                    |
| 0.15      | 53.3% / 39.0% | 74.2% / 58.2% | 16 (7 / 9)                                   |
| 0.10      | 43.2% / 42.7% | 66.7% / 65.8% | 26 (10 / 16)                                 |

**What these numbers say:**

- Word overlap can only reach ~90% precision by giving up almost all recall (11–27%). The dataset can't be solved by shared wording, which is the point of its design.
- Retrieval is more promising than deciding: an acceptable group is in the lexical top 10 for ~89–92% of gold-link requests. The step-2 question is whether embeddings raise recall@k and an LLM assessment can separate true matches from hard negatives.
- Dev and test differ by 15+ points. Because the split is by family, the two splits contain different product areas with different difficulty, so neither number should be read alone. With ~100 requests per split, one request moves precision or recall by about one point.

**None of the design's targets (precision ≥ 0.90 _and_ recall ≥ 0.80) are met by this baseline**, and they are not expected to be. The targets remain hypotheses for the AI pipeline. Triage time and suggestion acceptance can't be measured offline at all: they need a human review workflow or user study (step 3 onward).

## Limitations

- Synthetic text written by one author (an AI assistant) is more uniform than real feedback and may share that author's phrasing habits.
- Oracle review means errors don't compound: a wrong merge in production would contaminate later matches.
- The splits are small, and the dev/test difference comes partly from which families landed in which split.
- `alsoAcceptable` covers only the ambiguities the author anticipated; reviewers might accept other links.
- The TF-IDF index is fitted on all texts of the split being evaluated (unsupervised, no labels). Real intake would only know past texts.
