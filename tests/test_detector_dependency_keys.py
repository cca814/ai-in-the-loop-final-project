from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import significant_change_detector as detector  # noqa: E402



def git_diff(path, body):
    return (f"diff --git a/{path} b/{path}\nindex 1..2 100644\n--- a/{path}\n+++ b/{path}\n"
            f"@@ -1,3 +1,4 @@\n{body}")


CONTEXT = {"changed_files": ["api/user.go"],
           "diff": git_diff("api/user.go", "+func GetUser(id string) (*User, error) {\n+type User struct {\n")}


def key(**overrides):
    entry = {"key": "GetUser", "kind": "function", "path": "api/user.go",
             "quote": "func GetUser(id string)", "why": "HTTP handlers call it"}
    return {**entry, **overrides}


class EvidenceTest(unittest.TestCase):
    DIFF = (git_diff("docs/design.md", " ## Stage 2\n \n-TBD\n+The router adds reviewers.\n"
                     "-- Old bullet text here\n+- New bullet text here\n")
            + git_diff("ci.yaml", "+  route:\n+    needs: detect\n+    permissions: write\n"))

    def context(self):
        return {"changed_files": ["docs/design.md", "ci.yaml"], "diff": self.DIFF,
                "items": [{"id": "C1"}, {"id": "C2"}]}

    def assess(self, quote, path="docs/design.md", status="matched"):
        data = {"summary": "s", "unknowns": [], "assessments": [
            {"id": "C1", "status": status, "reason": "r",
             "evidence": [{"path": path, "quote": quote}]},
            {"id": "C2", "status": "not_matched", "reason": "r", "evidence": []}]}
        return detector.validate_assessment(data, self.context())

    def test_accepts_multiline_quote_without_markers_and_skipped_removed_line(self):
        for path, quote in (
                ("ci.yaml", "  route:\n    needs: detect\n    permissions: write"),  # no + markers
                ("docs/design.md", "## Stage 2\n\nThe router adds reviewers."),  # skips -TBD
                ("docs/design.md", "- Old bullet text here\n+ New bullet text here")):
            row = self.assess(quote, path)["assessments"][0]
            self.assertEqual(row["status"], "matched", quote)
            self.assertEqual(len(row["evidence"]), 1)

    def test_invented_or_shortened_quote_downgrades_match_to_unknown(self):
        for quote in ("The router adds owners.", "The router adds...", "}"):
            result = self.assess(quote)
            row = result["assessments"][0]
            self.assertEqual(row["status"], "unknown", quote)
            self.assertEqual(row["evidence"], [])
            self.assertIn("C1: dropped 1 evidence", result["unknowns"][0])

    def test_quote_must_come_from_cited_file(self):
        self.assertEqual(self.assess("needs: detect", path="docs/design.md")
                         ["assessments"][0]["status"], "unknown")

    def test_structural_errors_still_fail(self):
        with self.assertRaises(ValueError):
            detector.validate_assessment({"summary": "s", "unknowns": [], "assessments": []},
                                         self.context())


class ValidateDependencyKeysTest(unittest.TestCase):
    def test_keeps_verified_key(self):
        keys, notes = detector.validate_dependency_keys({"dependency_keys": [key()]}, CONTEXT)
        self.assertEqual(keys, [{"key": "GetUser", "kind": "function", "path": "api/user.go",
                                 "why": "HTTP handlers call it"}])
        self.assertEqual(notes, [])

    def test_drops_unverified_keys_without_failing(self):
        raw = {"dependency_keys": [
            key(key="DeleteUser"),                      # key not in quote
            key(quote="func Invented()", key="Invented"),  # quote not in diff
            key(path="other.go"),                       # path not changed
            key(key=""),                                # empty
            "not an object",
        ]}
        keys, notes = detector.validate_dependency_keys(raw, CONTEXT)
        self.assertEqual(keys, [])
        self.assertEqual(len(notes), 5)

    def test_dedupes_and_normalizes_kind(self):
        many = [key(key="User", quote="type User struct", kind="weird")] * 2
        many += [key()] * 30
        keys, _ = detector.validate_dependency_keys({"dependency_keys": many}, CONTEXT)
        self.assertEqual([k["key"] for k in keys], ["User", "GetUser"])
        self.assertEqual(keys[0]["kind"], "other")

    def test_caps_number_of_keys(self):
        names = [f"Func{i}" for i in range(25)]
        context = {"changed_files": ["a.go"],
                   "diff": git_diff("a.go", "\n".join(f"+func {n}()" for n in names))}
        raw = {"dependency_keys": [{"key": n, "kind": "function", "path": "a.go",
                                    "quote": f"func {n}()"} for n in names]}
        keys, notes = detector.validate_dependency_keys(raw, context)
        self.assertEqual(len(keys), detector.MAX_DEPENDENCY_KEYS)
        self.assertEqual(len(notes), 1)

    def test_missing_or_malformed_list(self):
        self.assertEqual(detector.validate_dependency_keys({}, CONTEXT), ([], []))
        self.assertEqual(detector.validate_dependency_keys({"dependency_keys": "x"}, CONTEXT)[0], [])

    def test_markdown_lists_keys(self):
        context = {"pr": {"title": "t"}, "base": "b", "head": "h", "merge_base": "m",
                   "checklist_path": "c.md", "items": [], "limitations": []}
        assessment = {"summary": "s", "assessments": [], "unknowns": []}
        metrics = {"significant": False, "significance_score": 0, "threshold_level": 4,
                   "matched_count": 0, "total_count": 0, "weighted_match_percent": 0,
                   "unknown_count": 0}
        keys, _ = detector.validate_dependency_keys({"dependency_keys": [key()]}, CONTEXT)
        notes = ["Dependency key 'Invented' ignored: not found in a quoted diff excerpt."]
        text = detector.markdown(context, assessment, metrics, keys, notes)
        self.assertIn("<summary>Dependency names (1 used, 1 dropped)</summary>", text)
        details = text.split("<details>")[1].split("</details>")[0]
        self.assertIn("GetUser", details)
        self.assertIn("Invented", details)
        self.assertNotIn("<details>", detector.markdown(context, assessment, metrics))


if __name__ == "__main__":
    unittest.main()
