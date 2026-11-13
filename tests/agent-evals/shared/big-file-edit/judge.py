import utils, hashlib
assert utils.helper_217(-2) == -434 and utils.helper_217(3) == 220 and utils.helper_217(0) == 217
for i in (0, 1, 216, 218, 299): assert getattr(utils, f"helper_{i}")(5) == 5 + i
assert len([n for n in dir(utils) if n.startswith("helper_")]) == 300
print("ok")
