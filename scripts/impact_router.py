"""Stage 2 routing: decide which reviewers to add and whether to block the merge.

Reads the Stage 1 report (report.json from significant_change_detector.py), the
current PR state and the routing config, then writes a JSON decision. It also
searches the base codebase for code that depends on what the PR changed, so the
owners of that code can be requested too. It makes no API calls; the workflow
applies the decision.
"""
import argparse
from fnmatch import fnmatchcase
import json
from pathlib import Path, PurePosixPath
import subprocess
import sys

STATUS_CONTEXT = "intent-supervisor/impact"
MIN_KEY_CHARS = 3
MAX_HITS_PER_KEY = 20
MAX_HITS = 200
MAX_SUMMARY_ROWS = 10
MAX_DETAIL_ROWS = 30
GREP_EXCLUDES = [":(exclude,glob)**/*.lock", ":(exclude,glob)**/package-lock.json",
                 ":(exclude,glob)checklists/**"]
DEFAULT_CONFIG = {
    "reviewer_min_level": 4,
    "block_min_level": 5,
    "review_inconclusive": True,
    "block_inconclusive": False,
    "default_owners": [],
    "path_owners": {},
    "dimension_owners": {},
    "max_files_per_key": 10,
    "ignore_keys": [],
}


def load_config(path):
    config = {**DEFAULT_CONFIG, **json.loads(Path(path).read_text(encoding="utf-8"))}
    for key in ("reviewer_min_level", "block_min_level"):
        if config[key] not in range(1, 6):
            raise ValueError(f"{key} must be an integer from 1 to 5.")
    owner_lists = [config["default_owners"], *config["path_owners"].values(),
                   *config["dimension_owners"].values()]
    if not all(isinstance(o, list) and all(isinstance(x, str) and x for x in o) for o in owner_lists):
        raise ValueError("Owners must be lists of GitHub logins.")
    if not isinstance(config["max_files_per_key"], int) or config["max_files_per_key"] < 1:
        raise ValueError("max_files_per_key must be a positive integer.")
    if not all(isinstance(x, str) for x in config["ignore_keys"]):
        raise ValueError("ignore_keys must be a list of strings.")
    return config


def unique(logins, exclude=()):
    """Deduplicate logins case-insensitively, keeping first spelling and order."""
    seen = {x.lower() for x in exclude}
    result = []
    for login in logins:
        if login.lower() not in seen:
            seen.add(login.lower())
            result.append(login)
    return result


def path_owners(config, paths):
    return [owner for path in paths for pattern, owners in config["path_owners"].items()
            if fnmatchcase(path, pattern) for owner in owners]


def dimension_owners(config, dimensions):
    return [owner for dimension in dimensions for key, owners in config["dimension_owners"].items()
            if key.lower() in dimension.lower() for owner in owners]


def collect_keys(files, report_keys, config):
    """Names other code could use to depend on the change, as {key: reason}.

    report_keys are the diff-verified names the Stage 1 AI extracted. The module
    names of changed files are added as a language-independent baseline, which
    still works when the AI returns nothing or the diff was truncated.
    """
    ignored = {k.lower() for k in config["ignore_keys"]}
    keys = {}

    def add(key, reason):
        if len(key) >= MIN_KEY_CHARS and key.lower() not in ignored and key not in keys:
            keys[key] = reason[:300]

    for entry in report_keys:
        why = f": {entry['why']}" if entry.get("why") else ""
        add(entry["key"], f"{entry['kind']} changed in {entry['path']}{why}")
    for f in files:
        for name in filter(None, (f["filename"], f.get("previous_filename"))):
            add(PurePosixPath(name).stem, f"module name of {name}")
    return keys


def find_dependents(repo_path, files, report_keys, config):
    """Search the base codebase for files that reference the changed names.

    Returns (hits, skipped, searched). Files changed by the PR are not dependents of
    themselves. A name found in more than max_files_per_key files is too common
    to point at real dependents, so it is skipped; this adapts to each project
    instead of relying on a fixed stopword list.
    """
    changed = {name for f in files for name in (f["filename"], f.get("previous_filename")) if name}
    hits, skipped = [], []
    keys = collect_keys(files, report_keys, config)
    for key, reason in keys.items():
        result = subprocess.run(
            ["git", "-C", str(repo_path), "grep", "-n", "-I", "-F", "-w", "-e", key, "--", ".",
             *GREP_EXCLUDES],
            capture_output=True, text=True, encoding="utf-8", errors="replace", check=False)
        if result.returncode not in (0, 1):  # 1 means no match.
            raise ValueError(f"git grep failed: {result.stderr.strip()}")
        matches = []
        for line in result.stdout.splitlines():
            path, number, text = line.split(":", 2)
            if path not in changed:
                matches.append({"key": key, "reason": reason, "path": path, "line": int(number),
                                "text": text.strip()[:200]})
        file_count = len({m["path"] for m in matches})
        if file_count > config["max_files_per_key"]:
            skipped.append({"key": key, "files": file_count})
            continue
        hits.extend(matches[:min(MAX_HITS_PER_KEY, MAX_HITS - len(hits))])
        if len(hits) >= MAX_HITS:
            break
    return hits, skipped, list(keys)


def decide(config, report, pr, dependency_hits=()):
    """Return the routing decision for one PR head revision."""
    head = pr["head_sha"]
    if report is None:
        return blocked(f"Stage 1 report not found for {head[:7]}; re-run this job after Stage 1 finishes.")
    if report.get("head") != head:
        return blocked(f"Stage 1 report is for {str(report.get('head'))[:7]}, not head {head[:7]}.")

    metrics = report["metrics"]
    level = metrics["max_level"]
    inconclusive = metrics["significant"] is None
    needs_review = level >= config["reviewer_min_level"] or (inconclusive and config["review_inconclusive"])
    needs_block = level >= config["block_min_level"] or (inconclusive and config["block_inconclusive"])

    items = {item["id"]: item for item in report["items"]}
    triggers = [row for row in report["assessment"]["assessments"]
                if row["status"] == "matched" and items[row["id"]]["level"] >= config["reviewer_min_level"]]
    evidence_paths = [e["path"] for row in triggers for e in row["evidence"]]
    owners = unique(path_owners(config, evidence_paths)
                    + dimension_owners(config, [items[row["id"]]["dimension"] for row in triggers]))
    if not owners:
        owners = unique(path_owners(config, pr["changed_files"]))
    direct = unique(owners, exclude=[pr["author"]])
    if not direct:
        direct = unique(config["default_owners"], exclude=[pr["author"]])
    # Step 3: owners of code that depends on the change, besides the direct owners.
    dependent = unique(path_owners(config, [hit["path"] for hit in dependency_hits]),
                       exclude=[pr["author"], *direct])
    eligible = direct + dependent

    approvers = {a.lower() for a in pr["approvers"]}
    owner_approved = [o for o in eligible if o.lower() in approvers]
    reviewers = [o for o in eligible if o.lower() not in approvers] if needs_review else []
    blocking = needs_block and not owner_approved

    label = "Inconclusive" if inconclusive else f"Level {level}"
    if blocking and not eligible:
        description = f"{label}: blocked; no eligible owner is configured."
    elif blocking:
        description = f"{label}: blocked until an owner approves ({', '.join(eligible)})."
    elif needs_block:
        description = f"{label}: unblocked by owner approval ({', '.join(owner_approved)})."
    elif needs_review:
        description = f"{label}: owner review requested; merge not blocked."
    else:
        description = f"{label}: below routing thresholds."
    return {"state": "failure" if blocking else "success", "description": description[:140],
            "context": STATUS_CONTEXT, "level": level, "inconclusive": inconclusive,
            "needs_review": needs_review, "needs_block": needs_block, "blocking": blocking,
            "owners": eligible, "direct_owners": direct, "dependent_owners": dependent,
            "owner_approvals": owner_approved, "reviewers_to_request": reviewers,
            "dependencies": [{**hit, "owners": unique(path_owners(config, [hit["path"]]),
                                                       exclude=[pr["author"]])}
                             for hit in dependency_hits],
            "triggers": [{"id": row["id"], "level": items[row["id"]]["level"],
                          "dimension": items[row["id"]]["dimension"],
                          "text": items[row["id"]]["text"]} for row in triggers]}


def blocked(description):
    return {"state": "failure", "description": description[:140], "context": STATUS_CONTEXT,
            "level": None, "inconclusive": True, "needs_review": False, "needs_block": True,
            "blocking": True, "owners": [], "direct_owners": [], "dependent_owners": [],
            "owner_approvals": [], "reviewers_to_request": [], "dependencies": [], "triggers": []}


def dependency_markdown(decision, logins, cell):
    """Short visible summary grouped by name; every match goes in a collapsed block."""
    deps, skipped = decision["dependencies"], decision.get("skipped_keys") or []
    searched = decision.get("searched_keys") or []
    if not searched and not deps:
        return []
    by_key = {}
    for dep in deps:
        by_key.setdefault(dep["key"], []).append(dep)
    no_match = len(searched) - len(by_key) - len(skipped)
    lines = ["", "### Code that depends on this change", "",
             f"Searched {len(searched)} names: {len(by_key)} with dependent code, "
             f"{max(no_match, 0)} with no matches, {len(skipped)} too common to use.", ""]
    if by_key:
        lines += ["| Name | Why | Dependent files | Owners |", "| --- | --- | --- | --- |"]
        for key, group in list(by_key.items())[:MAX_SUMMARY_ROWS]:
            files = list(dict.fromkeys(d["path"] for d in group))
            owners = unique(o for d in group for o in d["owners"])
            lines.append(f"| `{cell(key)}` | {cell(group[0]['reason'])} | {len(files)} | "
                         f"{logins(owners) if owners else 'no owner configured'} |")
        if len(by_key) > MAX_SUMMARY_ROWS:
            lines.append(f"\n_{len(by_key) - MAX_SUMMARY_ROWS} more names in the details below._")
        lines += ["", "A match is a lead, not proof of impact.", ""]
    if not deps and not skipped:
        return lines
    lines += ["<details>", f"<summary>All matches ({len(deps)})</summary>", ""]
    lines += [f"- `{cell(d['key'])}` in `{cell(d['path'])}:{d['line']}`" for d in deps[:MAX_DETAIL_ROWS]]
    if len(deps) > MAX_DETAIL_ROWS:
        lines.append(f"- _{len(deps) - MAX_DETAIL_ROWS} more in the workflow artifact._")
    if skipped:
        lines += ["", "Too common to identify dependents: "
                  + ", ".join(f"`{cell(k['key'])}` ({k['files']} files)" for k in skipped)]
    lines += ["", "</details>"]
    return lines


def markdown(decision):
    lines = ["## Intent Supervisor: Stage 2 routing", "",
             f"**Merge status:** {'Blocked' if decision['blocking'] else 'Not blocked'}"
             f" (`{decision['context']}` = `{decision['state']}`)", "", decision["description"], ""]
    def logins(values):
        return ", ".join(f"`{o}`" for o in values) or "none"

    def cell(value):  # AI-written text: keep it inside one table cell.
        return " ".join(str(value).split()).replace("|", "\\|").replace("`", "'")

    if decision["owners"]:
        lines += [f"- Owners of the changed code: {logins(decision['direct_owners'])}",
                  f"- Owners of code that depends on the change: {logins(decision['dependent_owners'])}"]
    if decision["reviewers_to_request"]:
        lines.append(f"- Review requested from: {logins(decision['reviewers_to_request'])}")
    if decision["triggers"]:
        lines += ["", "Checklist items that triggered routing:", ""]
        lines += [f"- {t['id']} [Level {t['level']} | {t['dimension']}] {t['text']}" for t in decision["triggers"]]
    lines += dependency_markdown(decision, logins, cell)
    return "\n".join(lines) + "\n"


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--report", required=True, help="Stage 1 report.json (may be missing)")
    parser.add_argument("--pr-context", required=True,
                        help="JSON: head_sha, author, changed_files, approvers, files")
    parser.add_argument("--repo-path", default=".", help="Base-branch checkout to search for dependents")
    parser.add_argument("--output", required=True)
    parser.add_argument("--markdown-output")
    args = parser.parse_args(argv)
    try:
        config = load_config(args.config)
        pr = json.loads(Path(args.pr_context).read_text(encoding="utf-8"))
        report_path = Path(args.report)
        report = json.loads(report_path.read_text(encoding="utf-8")) if report_path.is_file() else None
        hits, skipped, searched = [], [], []
        if report:
            hits, skipped, searched = find_dependents(args.repo_path, pr.get("files", []),
                                                      report.get("dependency_keys", []), config)
        decision = decide(config, report, pr, hits)
        decision["skipped_keys"] = skipped
        decision["searched_keys"] = searched
        Path(args.output).write_text(json.dumps(decision, indent=2) + "\n", encoding="utf-8")
        if args.markdown_output:
            Path(args.markdown_output).write_text(markdown(decision), encoding="utf-8")
        print(json.dumps(decision))
        return 0
    except (ValueError, KeyError, TypeError, OSError) as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
