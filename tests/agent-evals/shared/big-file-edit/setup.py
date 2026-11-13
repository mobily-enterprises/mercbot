import sys
ws, judge = sys.argv[1], sys.argv[2]
parts = ['"""A large utility module (generated)."""', ""]
for i in range(300):
    parts += [f"def helper_{i}(x):", f'    """Helper {i}: returns x plus {i}."""', f"    return x + {i}", ""]
parts[parts.index("def helper_217(x):") + 2] = "    return x + 217  # NOTE: should multiply when x is negative"
open(f"{ws}/utils.py", "w").write("\n".join(parts) + "\n")
