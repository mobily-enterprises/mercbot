import unittest
from money import split_bill, parse_amount
class T(unittest.TestCase):
    def test_split(self):
        self.assertEqual(split_bill(100, 3), 33.34)
        self.assertEqual(split_bill(90, 3, 10), 33.0)
    def test_parse(self):
        self.assertEqual(parse_amount("$1,234.50"), 1234.5)
        self.assertEqual(parse_amount("-3.10"), -3.1)
