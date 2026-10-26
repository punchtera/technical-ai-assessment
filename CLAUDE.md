# CLAUDE.md

## Environment
This project is developed with **Claude Cowork** (Claude running agentic, multi-step work in a cloud workspace linked to the developer's computer). Instructions in this file apply to every Cowork session on this repository.

## Project
**Feature Intelligence System** — an AI-first system that helps a product team turn unstructured feature requests into clear, actionable product decisions.

- Language: TypeScript
- Frontend: React
- Backend: Node.js
- Branching: Gitflow (`main` = releases, `dev` = integration; feature work in `feature/*` branches off `dev`)

## Assessment Requirements

### Core Requirements
At a minimum, users should be able to:

* Submit a feature request with a title and description
* View and discover existing requests
* Express interest in or support for a request
* Understand how requests are being grouped, evaluated, or prioritized

You may modify or extend the traditional feature-voting experience if you believe another approach better addresses the business problem.

### AI First Solution
Identify a high-value point in the feature-request lifecycle and design an AI-powered solution around it.
Your solution might:

* Detect and consolidate duplicate requests
* Identify the underlying need behind a proposed feature
* Group feedback into themes
* Enrich requests with customer or business context
* Recommend priorities using defined business criteria
* Automate triage and routing
* Surface emerging customer needs
* Generate decision briefs for product leaders
* Help communicate decisions back to stakeholders

The specific implementation is up to you. Be prepared to explain in your Loom:

* Which business problem you prioritized and why
* Who benefits from your solution
* Why AI is appropriate for the problem
* How AI changes the workflow rather than simply enhancing the interface
* Which agent, model, framework, or AI architecture you selected and why
* Where human judgment remains necessary
* How you would measure business impact
* What assumptions, risks, and tradeoffs you made

Include two or three success metrics, such as reduced triage time, fewer duplicate requests, faster prioritization, improved stakeholder response time, or higher-quality product decisions.

We are less interested in the specific feature and more interested in how thoughtfully AI is incorporated into the product or operational workflow. Your solution should clearly explain the agent or AI technology you selected and why.

# Project Rules
## Prompt Logging
Every time you receive a new instruction or prompt, append it to prompts.txt in the project root with a timestamp (ISO 8601) and a brief summary of what you did in response. Create the file if it doesn't exist. Keep this log updated throughout all sessions.
