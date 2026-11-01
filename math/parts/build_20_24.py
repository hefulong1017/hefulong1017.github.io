import json, os, re

base = r"C:\Users\Administrator\Documents\deepseek-harness\default-workspace\site\math"
texdir = os.path.join(base, "parts", "tex")
out = os.path.join(base, "parts", "latex-20-24.json")

ids = ["s20", "s21", "s22", "s23", "s24"]
sections = []
report = []
for sid in ids:
    with open(os.path.join(texdir, sid + ".tex"), encoding="utf-8") as f:
        latex = f.read().strip() + "\n"
    sections.append({"id": sid, "latex": latex})
    chk = {
        "len": len(latex),
        "dollar": latex.count("$"),
        "inl": (latex.count(r"\("), latex.count(r"\)")),
        "dsp": (latex.count(r"\["), latex.count(r"\]")),
        "brace": latex.count("{") - latex.count("}"),
        "env": (len(re.findall(r"\\begin\{", latex)), len(re.findall(r"\\end\{", latex))),
        "sec": latex.count(r"\section*"),
    }
    bad = []
    if chk["dollar"]:
        bad.append("dollar")
    if chk["inl"][0] != chk["inl"][1]:
        bad.append("inline-unbalanced")
    if chk["dsp"][0] != chk["dsp"][1]:
        bad.append("display-unbalanced")
    if chk["brace"] != 0:
        bad.append("brace-unbalanced")
    if chk["env"][0] != chk["env"][1]:
        bad.append("env-mismatch")
    if chk["sec"] != 1:
        bad.append("section-count")
    if chk["len"] <= 500:
        bad.append("short")
    report.append((sid, chk["len"], "OK" if not bad else ",".join(bad)))

with open(out, "w", encoding="utf-8") as f:
    json.dump({"sections": sections}, f, ensure_ascii=False, indent=1)
    f.write("\n")

print("written", out, os.path.getsize(out))
for r in report:
    print("%s len=%d %s" % r)
