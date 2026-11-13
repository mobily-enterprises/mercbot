import unittest
from money import split_bill, parse_amount
class J(unittest.TestCase):
    def test(self):
        self.assertEqual(split_bill(10, 3), 3.34)
        self.assertEqual(split_bill(100, 4, 5), 26.25)
        self.assertEqual(parse_amount("$12,000"), 12000.0)
        self.assertEqual(parse_amount("7"), 7.0)
if __name__ == "__main__": unittest.main()
