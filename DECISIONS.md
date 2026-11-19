# Decisions Log

## 2026-09-21 — Initial code steward

**What:** Aron is the initial code steward for the team.  
**Why:** Assigned by team agreement

## 2026-11-04 — Work assignment

**What:** The project is split into two parts: **Intent Supervisor** and **Slide Generator**. Aron and Brian are assigned to the Intent Supervisor, and Eddy and Ray are assigned to the Slide Generator.  
**Who:** All team members.  
**Why:** To speed up development by dividing the work into parts that pairs can own independently.

## 2026-11-07 — Intent Supervisor discussion

**What:** Decided to build the Intent Supervisor as a two-stage pipeline:
- **Stage 1 (PR summary):** Runs automatically when a PR is opened or updated. It reads the PR and the existing spec documents (AGENTS.md, DECISIONS.md, README.md, etc.) and produces a PR summary and a significance criteria checklist.
- **Stage 2 (Impact assessment):** Runs after the first reviewer approves the PR. It uses the Stage 1 summary and checklist, the PR, and the codebase to produce an impact score and decide whether to trigger an action: notify the supervisor, add a reviewer, or block the merge.

We also listed candidate features to consider after the core pipeline works:
- **Author self-assessment:** Authors rate the expected impact in the PR template, and the AI flags any dimension where its score differs by 2 or more.
- **Downstream acknowledgment:** When a dimension scores high enough (e.g. public API), the affected teams are tagged and must confirm with `/impact ack`.
- **Reviewer score adjustment (TBD):** Reviewers confirm or override the AI's score with a reason, and overrides are collected to refine the scoring criteria.
- **Review assignment by dimension (TBD):** With multiple reviewers, suggest who reviews which dimension (e.g. security, public API).

**Who:** Aron and Brian.  
**Why:** To agree on an implementation approach before development starts, so both members work from the same design and avoid conflicting changes later.

## 2026-11-08 — Implementation sync-up

**What:** Held an online meeting where the Intent Supervisor pair and the Slide Generator pair presented their implementation plans and reviewed each other's approach. We pointed out areas that need extra care and discussed where the two parts share an interface and what else should be defined together.  
**Outcome:** Both pairs agreed with each other's plans. The Slide Generator pair (Eddy and Ray) will define a data interface for the Intent Supervisor pair to follow. When a PR triggers the GitHub Action, the Intent Supervisor will upload the repository's data in this format to an online database, which the Slide Generator will use as its input.  
**Who:** All team members.  
**Why:** To make sure both parts fit together, catch design problems early through cross-review, and agree on shared definitions before each pair builds further.

## 2026-11-11 — Slide Generator architecture discussion

**What:** Discussed using a frontend and backend to provide a web interface for Stage 2, and using Slidev to generate presentations.  
**Outcome:** Decided to use Next.js deployed on Vercel and Firebase Firestore to store Project State, report drafts, and conversation history. Users will be able to review and manually edit the generated `report.md`, or request changes through an LLM conversation. Once confirmed, the report will be converted into Slidev-compatible `slide.md` and rendered into a presentation using the Slidev CLI.  
**Who:** Ray and Eddy.  
**Why:** To let users review and refine report content before generating presentations, while keeping project data and generated reports accessible through a shared web application.

## 2026-11-18 — Project State schema

**What:** Defined the Project State schema that the Intent Supervisor uses to submit project data to the Slide Generator.  
**Outcome:** The schema and example data are in `slide-generator/schemas/`.  
**Who:** Eddy, in discussion with all team members.  
**Why:** To keep both pairs working from the same data format, so the Intent Supervisor's output can be used directly by the Slide Generator.
