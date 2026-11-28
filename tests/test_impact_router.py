import json
import subprocess
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
import impact_router  # noqa: E402

HEAD = "a" * 40
# Fictional project, independent of the real .github/intent-supervisor.json: two teams,
# a security owner and a fallback owner. Most tests use backend-b as the PR author.
CONFIG = {
    **impact_router.DEFAULT_CONFIG,
    "default_owners": ["fallback-owner"],
    "path_owners": {"frontend/*": ["frontend-a", "frontend-b"],
                    "backend/*": ["backend-a", "backend-b"]},
    "dimension_owners": {"security": ["security-owner"]},
}


def report(level_by_status, significant=True):
    """Build a Stage 1 report. level_by_status: list of (level, status, path, dimension)."""
    items, rows = [], []
    for i, (level, status, path, dimension) in enumerate(level_by_status, 1):
        items.append({"id": f"C{i}", "level": level, "dimension": dimension, "text": f"item {i}"})
        rows.append({"id": f"C{i}", "status": status, "reason": "r",
                     "evidence": [{"path": path, "quote": "q"}] if status == "matched" else []})
    matched = [lvl for lvl, status, _, _ in level_by_status if status == "matched"]
    return {"head": HEAD, "items": items, "assessment": {"assessments": rows},
            "metrics": {"max_level": max(matched, default=0), "significant": significant}}


def pr(author="backend-b", approvers=(), changed=("backend/x.py",)):
    return {"head_sha": HEAD, "author": author, "approvers": list(approvers),
            "changed_files": list(changed)}


class DecideTest(unittest.TestCase):
    def test_below_threshold_does_nothing(self):
        d = impact_router.decide(CONFIG, report([(3, "matched", "backend/x.py", "API")], False), pr())
        self.assertEqual(d["state"], "success")
        self.assertEqual(d["reviewers_to_request"], [])
        self.assertFalse(d["needs_review"])

    def test_level4_requests_owners_of_evidence_path_except_author(self):
        d = impact_router.decide(CONFIG, report([(4, "matched", "frontend/a.ts", "API")]), pr())
        self.assertEqual(d["reviewers_to_request"], ["frontend-a", "frontend-b"])
        self.assertEqual(d["state"], "success")

    def test_dimension_owners_added(self):
        d = impact_router.decide(CONFIG, report([(4, "matched", "backend/x.py", "Security / auth")]), pr())
        self.assertEqual(d["reviewers_to_request"], ["backend-a", "security-owner"])

    def test_level5_blocks_until_owner_approves(self):
        r = report([(5, "matched", "frontend/a.ts", "Architecture")])
        blocked = impact_router.decide(CONFIG, r, pr(approvers=["someone-else"]))
        self.assertEqual(blocked["state"], "failure")
        self.assertTrue(blocked["blocking"])
        approved = impact_router.decide(CONFIG, r, pr(approvers=["Frontend-B"]))
        self.assertEqual(approved["state"], "success")
        self.assertEqual(approved["owner_approvals"], ["frontend-b"])
        self.assertEqual(approved["reviewers_to_request"], ["frontend-a"])

    def test_author_only_owner_falls_back_to_default(self):
        cfg = {**CONFIG, "path_owners": {"backend/*": ["backend-b"]}}
        d = impact_router.decide(cfg, report([(5, "matched", "backend/x.py", "API")]), pr())
        self.assertEqual(d["owners"], ["fallback-owner"])
        self.assertTrue(d["blocking"])

    def test_inconclusive_requests_review_from_changed_path_owners(self):
        r = report([(5, "unknown", "", "API")], significant=None)
        d = impact_router.decide(CONFIG, r, pr(changed=["frontend/a.ts"]))
        self.assertTrue(d["needs_review"])
        self.assertFalse(d["blocking"])
        self.assertEqual(d["reviewers_to_request"], ["frontend-a", "frontend-b"])

    def test_missing_or_stale_report_blocks(self):
        self.assertEqual(impact_router.decide(CONFIG, None, pr())["state"], "failure")
        stale = {**report([]), "head": "b" * 40}
        self.assertEqual(impact_router.decide(CONFIG, stale, pr())["state"], "failure")


class DependentsTest(unittest.TestCase):
    def test_collect_keys_uses_ai_keys_then_module_names(self):
        files = [{"filename": "frontend/lib/state-store.ts"},
                 {"filename": "proto/user.proto", "previous_filename": "proto/account.proto"}]
        ai = [{"key": "GetUser", "kind": "route", "path": "proto/user.proto", "why": "gRPC clients"},
              {"key": "id", "kind": "schema_field", "path": "proto/user.proto", "why": ""}]
        cfg = {**CONFIG, "ignore_keys": ["Account"]}
        keys = impact_router.collect_keys(files, ai, cfg)
        self.assertEqual(list(keys), ["GetUser", "state-store", "user"])
        self.assertEqual(keys["GetUser"], "route changed in proto/user.proto: gRPC clients")

    def test_find_dependents_skips_changed_files_lock_files_and_common_names(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = Path(tmp)
            subprocess.run(["git", "init", "-q", str(repo)], check=True)
            (repo / "backend").mkdir()
            (repo / "frontend").mkdir()
            (repo / "backend/detector.py").write_text("def quantify(a):\n    return a\n")
            (repo / "frontend/use.ts").write_text("// calls quantify here\nquantifyAll()\n")
            (repo / "package-lock.json").write_text('"quantify": 1\n')
            for i in range(3):  # "config" appears in 3 files: too common with a limit of 2.
                (repo / f"c{i}.py").write_text("config = 1\n")
            subprocess.run(["git", "-C", str(repo), "add", "."], check=True)
            files = [{"filename": "backend/detector.py"}]
            ai = [{"key": "quantify", "kind": "function", "path": "backend/detector.py", "why": ""},
                  {"key": "config", "kind": "config", "path": "backend/detector.py", "why": ""}]
            hits, skipped, searched = impact_router.find_dependents(
                repo, files, ai, {**CONFIG, "max_files_per_key": 2})
        self.assertEqual([(h["key"], h["path"], h["line"]) for h in hits],
                         [("quantify", "frontend/use.ts", 1)])
        self.assertEqual(skipped, [{"key": "config", "files": 3}])
        self.assertEqual(searched, ["quantify", "config", "detector"])

    def test_comment_groups_matches_by_name_and_folds_details(self):
        r = report([(4, "matched", "backend/x.py", "API")])
        hits = [{"key": "parseState", "reason": "function changed", "path": f"frontend/r{i}.ts",
                 "line": i, "text": "t"} for i in range(5)]
        d = impact_router.decide(CONFIG, r, pr(), hits)
        d["searched_keys"] = ["parseState", "x.py-module", "config"]
        d["skipped_keys"] = [{"key": "config", "files": 40}]
        text = impact_router.markdown(d)
        self.assertIn("Searched 3 names: 1 with dependent code, 1 with no matches, 1 too common", text)
        visible, details = text.split("<details>")
        self.assertEqual(visible.count("parseState"), 1)  # one grouped row, not five
        self.assertIn("| 5 |", visible)
        self.assertEqual(details.count("parseState"), 5)
        self.assertIn("`config` (40 files)", details)

    def test_comment_without_matches_has_no_details_block(self):
        d = impact_router.decide(CONFIG, report([(4, "matched", "backend/x.py", "API")]), pr())
        d["searched_keys"], d["skipped_keys"] = ["detector"], []
        text = impact_router.markdown(d)
        self.assertIn("Searched 1 names: 0 with dependent code, 1 with no matches", text)
        self.assertNotIn("<details>", text)

    def test_dependent_owners_are_requested_and_can_unblock(self):
        r = report([(5, "matched", "backend/x.py", "API")])
        hits = [{"key": "quantify", "reason": "r", "path": "frontend/use.ts", "line": 1, "text": "t"}]
        d = impact_router.decide(CONFIG, r, pr(author="backend-b"), hits)
        self.assertEqual(d["direct_owners"], ["backend-a"])
        self.assertEqual(d["dependent_owners"], ["frontend-a", "frontend-b"])
        self.assertEqual(d["reviewers_to_request"], ["backend-a", "frontend-a", "frontend-b"])
        self.assertTrue(d["blocking"])
        self.assertEqual(d["dependencies"][0]["owners"], ["frontend-a", "frontend-b"])
        self.assertIn("depends on this change", impact_router.markdown(d))
        unblocked = impact_router.decide(CONFIG, r, pr(author="backend-b", approvers=["frontend-a"]), hits)
        self.assertFalse(unblocked["blocking"])

    def test_no_dependents_below_threshold(self):
        r = report([(2, "matched", "backend/x.py", "API")], False)
        hits = [{"key": "k", "reason": "r", "path": "frontend/a.ts", "line": 1, "text": "t"}]
        self.assertEqual(impact_router.decide(CONFIG, r, pr(), hits)["reviewers_to_request"], [])


class MainTest(unittest.TestCase):
    def test_cli_writes_decision(self):
        with tempfile.TemporaryDirectory() as tmp:
            tmp = Path(tmp)
            (tmp / "config.json").write_text(json.dumps(CONFIG))
            (tmp / "report.json").write_text(json.dumps(report([(5, "matched", "backend/x.py", "API")])))
            (tmp / "pr.json").write_text(json.dumps(pr(author="frontend-a")))
            code = impact_router.main(["--config", str(tmp / "config.json"),
                                       "--report", str(tmp / "report.json"),
                                       "--pr-context", str(tmp / "pr.json"),
                                       "--output", str(tmp / "out.json"),
                                       "--markdown-output", str(tmp / "out.md")])
            self.assertEqual(code, 0)
            decision = json.loads((tmp / "out.json").read_text())
            self.assertEqual(decision["reviewers_to_request"], ["backend-a", "backend-b"])
            self.assertIn("Blocked", (tmp / "out.md").read_text())

    def test_bad_config_level_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "config.json"
            path.write_text(json.dumps({"block_min_level": 9}))
            with self.assertRaises(ValueError):
                impact_router.load_config(path)

    def test_repo_config_is_valid(self):
        impact_router.load_config(Path(__file__).resolve().parents[1] / ".github/intent-supervisor.json")


if __name__ == "__main__":
    unittest.main()
