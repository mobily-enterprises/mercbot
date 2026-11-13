# Hidden checks beyond the visible spec: the same rules on new programs.
import unittest
from calc import run, CalcError


def error(program):
    try:
        run(program)
    except CalcError as caught:
        return str(caught)
    return None


class Judge(unittest.TestCase):
    def test_spec_still_passes(self):
        import subprocess, sys
        self.assertEqual(subprocess.run([sys.executable, "-m", "unittest", "-q", "test_calc"], capture_output=True).returncode, 0)

    def test_more(self):
        self.assertEqual(run("let w = 3\nlet h = 4; sqrt(w^2 + h^2)"), 5)
        self.assertEqual(run("2^-1"), 0.5)
        self.assertEqual(run("max(min(4, 9), 2) * -(1 + 1)"), -8)
        self.assertEqual(run("let n = 10; let n = n - 1; n"), 9)
        self.assertEqual(run("1.5 * 2"), 3)
        self.assertIsInstance(run("1.5 * 2"), int)

    def test_errors(self):
        self.assertEqual(error("let 2x = 1"), "syntax error at position 4")
        self.assertEqual(error("max(1,"), "syntax error at position 6")
        self.assertEqual(error("bar(2)"), "unknown function: bar")
        self.assertEqual(error("let a = 1; b"), "unknown variable: b")
        self.assertEqual(error("4 / 0"), "division by zero")
        self.assertEqual(error("abs(1))"), "syntax error at position 6")


if __name__ == "__main__":
    unittest.main()
