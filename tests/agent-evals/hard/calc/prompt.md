Build calc.py, a small calculator language, in Python (standard library only, no eval/exec). test_calc.py in this folder is the spec: make every test in it pass (`python3 -m unittest`), without changing the tests.

The language:
- Numbers (integers and decimals), + - * / and ^ (power, right-associative: 2^3^2 is 512), unary minus (-2^2 is -4), and parentheses.
- Variables: `let name = expression` stores a value and returns it; names are letters, digits and underscores, not starting with a digit.
- Functions: min(a, b, ...), max(a, b, ...), sqrt(x), abs(x).
- Several statements separated by `;` or new lines in one program; the result is the last statement's value.
- Errors raise CalcError (defined in calc.py) with these messages: "division by zero", "unknown variable: NAME", "unknown function: NAME", "syntax error at position N" (N is the 0-based character index in the whole program where the unexpected character or end of input is), and "sqrt of negative number".
- run(program) returns the result as an int when it's a whole number, otherwise a float.
