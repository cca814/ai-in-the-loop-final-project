# AI Usage Guidelines

## Section 1 — What AI tools we plan to use, and what we will use each for

We use ChatGPT 6 Astra / Claude Opus 5.5 to draft architecture and code. Before merge, a non-author reviewer must explain the change, name one risk, and record a check in the PR. Setup or usage changes must include updated README steps verified by that reviewer. AI cannot push to the remote repository by itself.

---

## Section 2 — How we will document AI interactions

Every PR must name the AI tool, what it generated, whether it generated most of the change, and the author’s edits; write “none” if unused. AI-suggested architecture changes must be recorded in `DECISIONS.md` and agreed on by all teammates.

---

## Section 3 — How we will handle disagreements about AI output quality

AI-assisted behavior changes must include test files, commands, and results, and pass existing tests and lint checks. Prompt changes must show before/after results for normal and off-task inputs. If engineers disagree about AI-generated code quality, Aron has the final say and advises on revisions.
