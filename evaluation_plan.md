# Draft Evaluation Plan

## Problem Grounding

### What problem we want to solve?

- Communication between implementation teams and staffs requires significant time and effort, especially when teams need to repeatedly summarize and report project progress.

### Who specifically has the collaboration problem you are addressing?

- A team of engineers and PMs who collaborating on a project.

### What do they currently do instead of your tool?

- Engineer team proactively report to the manager.
- Someone who would like to follow the progress directly inspect the codebase.

### What would be observably different about their collaboration if your tool worked?

Traditionally, team members need to manually report project status, progress, and significant changes to staffs who want to stay informed.

With our tool, AI becomes a bridge between project maintainers and staffs. Instead of repeatedly preparing and presenting status updates, maintainers can focus on their work while the AI summarizes relevant project activity and prepares updates for review. As a result, communication shifts from repetitive status reporting to discussions about important changes, blockers, and decisions that require human attention.

## Evaluation Plan Draft

### Success definition:

AI can correctly detects the significant changes in the project which might lie in PR, issue or even commit messages. So, both engineer can reduce the time to trace code, manager can also reduce the time to understand the project status.

### Target users:

- Team collabrators

### Method:

- To evaluate this AI, we can directly use this in our processing [repo](https://github.com/cca814/ai-in-the-loop-final-project).
- Directly invite volunteers to try the project.

### Minimum evidence threshold:

- Test whether the AI can detect different types and levels of changes in a project. We can categorize project changes by significance, for example from Level 1 to Level 5, and evaluate whether the AI correctly identifies them. Missing some low-impact changes, such as Level 1 implementation details, may be acceptable because these changes do not necessarily need to be communicated to other team members. However, for highly significant changes, such as Level 5 changes involving project direction, architecture, requirements, or major dependencies, the AI should achieve a very high detection rate.
- Minimum daily or weekly report time. (ex: 60mins -> 10mins)
