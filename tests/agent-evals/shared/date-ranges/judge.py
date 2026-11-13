import unittest
from ranges import merge_bookings as m
class J(unittest.TestCase):
    def test(self):
        self.assertEqual([tuple(x) for x in m([])], [])
        self.assertEqual([tuple(x) for x in m([("2026-01-05","2026-01-07"),("2026-01-01","2026-01-04")])], [("2026-01-01","2026-01-07")])
        self.assertEqual([tuple(x) for x in m([("2026-02-01","2026-02-03"),("2026-02-05","2026-02-06")])], [("2026-02-01","2026-02-03"),("2026-02-05","2026-02-06")])
        self.assertEqual([tuple(x) for x in m([("2026-03-01","2026-03-10"),("2026-03-02","2026-03-03")])], [("2026-03-01","2026-03-10")])
        with self.assertRaises(ValueError): m([("2026-01-05","2026-01-01")])
        with self.assertRaises(ValueError): m([("2026-13-01","2026-13-02")])
if __name__ == "__main__": unittest.main()
