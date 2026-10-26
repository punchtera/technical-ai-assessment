# Synthetic dataset: Tasklane feature requests

**Everything in this folder is synthetic.** The requests describe a fictional product (Tasklane) and were written for evaluation. They are not real customer feedback.

- `requests.jsonl`: runtime inputs only (no labels). This is the only file a matcher may read.
- `manifest.json`: version, seed, counts and SHA-256 of each generated file.
- `ground-truth/`: the authored catalog, labels, groups and splits. Evaluation harness only; application code is forbidden from reading it (lint rule + test).

Regenerate with `pnpm dataset:generate` and check with `pnpm dataset:validate`. Don't hand-edit generated files: edit `ground-truth/catalog.json` and regenerate. See [docs/evaluation.md](../../docs/evaluation.md) for the format, rules and metrics.
