# Part 2 — Draft AI Usage Guidelines

---

## section 1 — What AI tools we plan to use, and what we will use each for

We decided to use ChatGPT 5.6 / Claude Opus 4.5 to create the initial architecture, and a human always reviews and edits it before it is merged. It cannot git push to the remote repository by itself.

---

## Section 2 — How we will document AI interactions

In the PR message, we should write "AI was involved" so that we can know which PRs used AI assistance. If AI suggests changing the architecture, we should document it in `DECISION.md`, and all teammates should agree before changing the architecture.

---

## Section 3 — How we will handle disagreements about AI output quality

Anyone who wants to use AI to generate code should make sure it passes all existing tests, and we should follow the linter configuration. If engineers disagree about AI-generated code quality, Aron has the final say and can give advice on how to modify the changes.
