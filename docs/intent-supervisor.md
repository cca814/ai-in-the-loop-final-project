# Intent Supervisor

## 1. Purpose and Design Status

Intent Supervisor helps software teams recognize when a pull request (PR) has consequences beyond its immediate code changes. It connects implementation changes to the project's documented intent and gives reviewers and supervisors enough context to decide whether additional coordination is needed.

A PR can look small while changing a public contract, invalidating a design decision, or creating work for another team. These effects can be missed when both the author and the initial reviewer focus on local correctness. Intent Supervisor makes those effects explicit through a two-stage review pipeline.

The original two-stage pipeline was recorded in the [Decisions Log](../DECISIONS.md). This document incorporates author self-assessment, discrepancy alerts, and downstream team acknowledgment into the core workflow. Detailed schemas, scoring dimensions, thresholds, and operational rules are proposed defaults, not finalized implementation decisions or claims about existing functionality.

## 2. Goals and Scope

The core workflow should:

- Summarize what a PR changes and explain how it relates to existing specifications and decisions.
- Identify potentially significant changes with evidence that a reviewer can inspect.
- Assess broader codebase impact before the PR is merged.
- Compare AI impact scores with author self-assessments and flag meaningful discrepancies.
- Obtain acknowledgment from affected downstream teams when configured thresholds are met.
- Route significant changes to the appropriate people through notifications, additional review, or a merge block.
- Preserve the reasoning behind assessments so humans can question and correct them.

The initial scope is PR-based analysis. Issue analysis, commit-only workflows, automatic code repair, and automatic merging are outside this document's core workflow.

AI provides summaries and assessments. Humans remain responsible for reviewing implementation correctness, resolving ambiguous intent, and accepting changes to project direction.

## 3. Stage 1: PR Summary and Checklist Completion

### 3.0 Prerequisite: Checklist Generation

The Significant Criteria Checklist is generated in advance, before Stage 1 analyzes an individual PR. It defines the criteria used to identify significant changes across PRs. Stage 1 consumes this existing checklist, summarizes the PR, and checks the items that apply to the change.

Checklist generation uses the project's specifications and agreed significance criteria to define reusable items. Each item should have a stable identifier, an impact dimension, and a clear question or condition. The generation mechanism and update policy remain to be defined.

The following dimensions illustrate possible checklist content to define during preparation:

| Dimension        | Checklist question                                                                        | Example evidence                                                   |
| ---------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `public_api`     | Does the change alter a contract used by external consumers?                              | Routes, request and response schemas, exported interfaces.         |
| `security`       | Does it change authentication, authorization, or handling of sensitive data?              | Permission checks, credential handling, access policies.           |
| `data`           | Does it change stored data, schema compatibility, or migration requirements?              | Schema definitions, migrations, persistence logic.                 |
| `architecture`   | Does it change component boundaries, major dependencies, or established design decisions? | Dependency configuration, service interactions, decision records.  |
| `operations`     | Does it affect deployment, configuration, reliability, or runtime cost?                   | Deployment files, configuration defaults, resource usage.          |
| `product_intent` | Does it change requirements, supported workflows, or project scope?                       | Acceptance criteria, user-facing behavior, documented commitments. |

These dimensions are a starting point for team discussion, not a finalized scoring rubric. The generated checklist should be versioned so each PR assessment records which criteria were applied.

### 3.1 Trigger

Stage 1 runs automatically when a PR is opened or updated. Changes to the diff or the author's description may affect the analysis, so both should be considered when defining update triggers.

### 3.2 Inputs

| Input                   | Information used                                                                                                                                            |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-generated checklist | The existing significance criteria, item identifiers, and checklist version to apply to the PR.                                                             |
| PR metadata             | Title, description, author, base revision, and head revision.                                                                                               |
| Author self-assessment  | Expected impact score for each dimension, with any explanation supplied in the PR template.                                                                 |
| PR changes              | Changed files and diff, including additions, modifications, and deletions.                                                                                  |
| Existing specifications | Relevant instructions, requirements, architectural decisions, and public behavior documented in files such as `AGENTS.md`, `DECISIONS.md`, and `README.md`. |

Existing intent should normally be read from the base revision. Proposed documentation changes in the PR should be analyzed as changes to that intent, so a PR cannot silently redefine the baseline against which it is assessed.

Missing, outdated, or contradictory documentation should be reported as a limitation. The system should not invent a requirement to fill the gap.

### 3.3 Processing

1. Load the pre-generated checklist and record its version.
2. Identify the behavior, interfaces, and documentation changed by the PR.
3. Locate the existing specifications and decisions relevant to those changes.
4. Summarize the author's stated purpose separately from the behavior observed in the diff, including any discrepancy with documented intent.
5. Evaluate each existing checklist item against the PR and relevant specifications. Check applicable items, leave non-applicable items unchecked, and explicitly mark unresolved items as `unknown`.
6. Attach evidence and a brief explanation to each finding, capturing author self-assessment scores and marking missing responses explicitly.
7. Return the PR Summary and the completed checklist for Stage 2, carrying unresolved questions and author scores forward for further investigation and comparison.

Stage 1 is an initial assessment. It should distinguish observed facts from hypotheses that require broader codebase inspection. It does not generate or rewrite checklist criteria for each PR. If the checklist is missing, report the prerequisite as unavailable rather than silently generating replacement criteria during Stage 1.

### 3.4 Output: PR Summary

The summary should be concise enough to read during review while retaining the evidence needed to investigate important claims.

Suggested fields:

- **Revision:** PR identifier and analyzed head commit.
- **Author self-assessment:** Expected impact by dimension, including explanations and missing responses.
- **Stated intent:** What the author says the change is intended to accomplish.
- **Observed changes:** What behavior or structure changes in the diff.
- **Affected areas:** Relevant modules, interfaces, or workflows.
- **Alignment with specifications:** Whether the change appears consistent with existing requirements and decisions.
- **Potential concerns:** Possible downstream effects or unresolved discrepancies.
- **Evidence and limitations:** File references, supporting excerpts where useful, and unavailable context.
- **Dependency names:** Diff-verified names other code may reference, used by Stage 2 to find dependent code (§4.3).

### 3.5 Output: Completed Significant Criteria Checklist

The output is a PR-specific completion of the pre-generated checklist. It preserves the original item identifiers and questions while adding findings for the analyzed revision.

Suggested fields:

- **Assessment context:** PR identifier, analyzed head commit, and checklist version.
- **Criterion:** Original item identifier, dimension, and question.
- **Selection status:** `checked`, `unchecked`, or `unknown`.
- **Rationale and evidence:** Why the criterion applies or does not apply, with relevant file references.
- **Author self-assessment:** The expected impact score for the corresponding dimension, if provided.
- **Unresolved questions:** Missing context or concerns requiring further investigation in Stage 2.

Selection semantics:

| Status      | Meaning                                                                                     |
| ----------- | ------------------------------------------------------------------------------------------- |
| `checked`   | The PR meets the criterion or shows a potential impact that Stage 2 should investigate.     |
| `unchecked` | The item was evaluated and no applicable impact was identified from the available evidence. |
| `unknown`   | There is insufficient or conflicting evidence to determine whether the item applies.        |

A checked item indicates an applicable significance criterion, not a completed review or approval. An unknown item must remain visibly unresolved rather than appearing as an ordinary unchecked item. Stage 2 receives the full checklist, including unchecked and unknown items, together with the PR Summary.

### 3.6 Author Self-Assessment

TBD

## 4. Stage 2: Impact Assessment and Routing

The first version of Stage 2 adds reviewers and blocks the merge. It reuses the Stage 1 impact score and inspects the codebase on `main`: it searches for code that references the names Stage 1 extracted from the diff, so the owners of that dependent code are requested too (§4.3). It does not yet send that code to the AI to refine the score, and it does not notify a supervisor outside GitHub.

### 4.1 Trigger

Routing does not wait for the first approval. The information it needs is available as soon as Stage 1 finishes, and requesting owners late wastes a review round. Each routing action therefore has its own trigger:

| Action                          | Trigger                                                                                              |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Add reviewer                    | After Stage 1 on every PR open or update, as a job in the Stage 1 pipeline.                          |
| Codebase search for dependents  | With "Add reviewer", on every PR open or update. Names come from the Stage 1 AI call; the search uses `git grep` only (§4.3). |
| Block merge                     | Re-evaluated after every Stage 1 run and on every review submitted (except comments) or dismissed.  |
| AI review of dependent code     | Not implemented. Planned for `ready_for_review` or the first approval, because it costs AI tokens.   |

Routing reads the Stage 1 `report.json` for the PR's current head commit. Only approvals of the current head commit count, so every push re-evaluates the gate without needing stale approvals to be dismissed. Reviewers are requested only after pushes; review events only re-check the gate, so an owner who requests changes is not immediately re-requested.

### 4.2 Routing Rules

Routing is configured in `.github/intent-supervisor.json`, read from `main` so a PR cannot change its own routing.

| Setting              | Default | Meaning                                                              |
| -------------------- | ------- | -------------------------------------------------------------------- |
| `reviewer_min_level` | 4       | Highest matched level at which owners are requested as reviewers.    |
| `block_min_level`    | 5       | Highest matched level at which the merge is blocked.                 |
| `review_inconclusive`| true    | Request owner review when the Stage 1 result is inconclusive.        |
| `block_inconclusive` | false   | Block the merge when the Stage 1 result is inconclusive.             |
| `path_owners`        |         | Glob pattern to GitHub logins.                                       |
| `dimension_owners`   |         | Dimension keyword (case-insensitive substring) to GitHub logins.     |
| `default_owners`     |         | Fallback owners, normally the current code steward.                  |

Direct owners are resolved in this order: owners of the evidence paths and dimensions of matched items at or above `reviewer_min_level`; otherwise owners of all changed files; otherwise `default_owners`. The PR author is never an owner.

### 4.3 Dependent Owners

The router also requests the owners of code that depends on the change, which the diff alone cannot show. Only the first step uses AI, and it runs inside the existing Stage 1 call; the rest is deterministic code. The code contains no language- or framework-specific rules, so the same flow works in other projects.

1. **Extract names (Stage 1, AI).** In the same call that completes the checklist, the AI returns up to 20 `dependency_keys`: names, strings, or contracts changed by the diff that other files may reference, such as functions, types, API routes, schema fields, config keys, or events. Each key must appear in a quoted diff excerpt from a changed file. Keys that fail this check are dropped and recorded in `dependency_key_notes`; they never fail the Stage 1 report or change its score. The verified keys are listed in the Stage 1 report and stored in `report.json`.
2. **Add a baseline and filter (Stage 2).** The module names of changed files, including the old names of renamed files, are added so the search still works when the AI returns nothing or the diff was truncated. Names in `ignore_keys` or shorter than 3 characters are dropped.
3. **Search (Stage 2).** Each name is searched in the `main` checkout with `git grep -w`, skipping files the PR changes, lock files, and `checklists/`. A name found in more than `max_files_per_key` files (default 10) is skipped as too common; this adapts to each project instead of relying on a fixed stopword list.
4. **Map and report (Stage 2).** Matching files are mapped to owners with `path_owners`, excluding the PR author and the direct owners. The Stage 2 PR comment lists dependent owners separately from direct owners, with the name, reason, and file and line of each match, and the names skipped as too common.

Dependent owners are requested together with direct owners when the review threshold is met, and their approval also unblocks the merge. A match is a lead, not proof of impact: names can collide, and dynamic references are missed. Because the names come from AI, they can differ between runs; the module-name baseline keeps the result stable for every changed file.

A blocked PR is unblocked when any direct or dependent owner approves the current head commit. Blocking is enforced by the `intent-supervisor/impact` commit status, which must be marked as a required status check in branch protection for `main`. A missing or outdated Stage 1 report also sets a failing status; rerun the job after Stage 1 finishes.

### 4.4 Not Yet Implemented

- Sending the dependent code found in §4.3 to the AI to refine the Stage 1 score.
- Supervisor notification by email or other channels outside GitHub.
- Author self-assessment comparison and downstream `/impact ack`.

## 5. Integration with the Slide Generator

TBD
