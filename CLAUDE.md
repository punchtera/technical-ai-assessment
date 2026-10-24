# CLAUDE.md

## Environment
This project is developed with **Claude Cowork** (Claude running agentic, multi-step work in a cloud workspace linked to the developer's computer). Instructions in this file apply to every Cowork session on this repository.

## Project
**Feature Intelligence System** — an AI-first system that helps a product team turn unstructured feature requests into clear, actionable product decisions.

- Language: TypeScript
- Frontend: React
- Backend: Node.js
- Branching: Gitflow (`main` = releases, `dev` = integration; feature work in `feature/*` branches off `dev`)

# Project Rules
## Prompt Logging
Every time you receive a new instruction or prompt, append it to prompts.txt in the project root with a timestamp (ISO 8601) and a brief summary of what you did in response. Create the file if it doesn't exist. Keep this log updated throughout all sessions.
