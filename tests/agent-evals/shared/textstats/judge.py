import unittest, textstats
class Judge(unittest.TestCase):
    def test_count(self):
        self.assertEqual(textstats.word_count("Hello, hello! It's a test-case."), 6)
        self.assertEqual(textstats.word_count(""), 0)
    def test_top(self):
        self.assertEqual(textstats.top_words("b a b c a b", 2), [("b", 3), ("a", 2)])
        self.assertEqual(textstats.top_words("Zed apple zed Apple", 2), [("apple", 2), ("zed", 2)])
if __name__ == "__main__": unittest.main()
