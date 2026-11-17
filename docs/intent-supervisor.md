# Intent Supervisor

## 1. Purpose and Design Status

Intent Supervisor helps software teams recognize when a pull request (PR) has consequences beyond its immediate code changes. It connects implementation changes to the project's documented intent and gives reviewers and supervisors enough context to decide whether additional coordination is needed.

A PR can look small while changing a public contract, invalidating a design decision, or creating work for another team. These effects can be missed when both the author and the initial reviewer focus on local correctness. Intent Supervisor makes those effects explicit through a two-stage review pipeline.

The original two-stage pipeline was recorded in the [Decisions Log](../DECISIONS.md). This document incorporates author self-assessment, discrepancy alerts, and downstream team acknowledgment into the core workflow. Detailed schemas, scoring dimensions, thresholds, and operational rules are proposed defaults, not finalized implementation decisions or claims about existing functionality.

## 2. Goals and Scope

The core workflow should:

- Summarize what a PR changes and explain how it relates to existing specifications and decisions.
- Identify potentially significant changes with evidence that a reviewer can inspect.
- Assess broader impact after an initial reviewer approves the changes.
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

TBD

## 5. Integration with the Slide Generator

TBD
