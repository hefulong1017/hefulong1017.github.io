import json, os, re

base = r"C:\Users\Administrator\Documents\deepseek-harness\default-workspace\site\math"
texdir = os.path.join(base, "parts", "tex")
out = os.path.join(base, "parts", "latex-30-34.json")

ids = ["s%d" % n for n in range(30, 35)]
CJK = re.compile(r"[\u3000-\u303f\u4e00-\u9fff\uff00-\uffef]")

sections = []
report = []
for sid in ids:
    with open(os.path.join(texdir, sid + ".tex"), encoding="utf-8") as f:
        latex = f.read().strip() + "\n"
    sections.append({"id": sid, "latex": latex})

    inl = (latex.count(r"\("), latex.count(r"\)"))
    dsp = (latex.count(r"\["), latex.count(r"\]"))
    chk = {
        "len": len(latex),
        "dollar": latex.count("$"),
        "inl": inl,
        "dsp": dsp,
        "brace": latex.count("{") - latex.count("}"),
        "env": (len(re.findall(r"\\begin\{", latex)), len(re.findall(r"\\end\{", latex))),
        "sec": latex.count(r"\section*"),
        "text": latex.count(r"\text{"),
    }
    # Chinese inside math delimiters
    bad_math = []
    for m in re.finditer(r"\\\((.*?)\\\)", latex, re.S):
        if CJK.search(m.group(1)):
            bad_math.append(m.group(0)[:60])
    for m in re.finditer(r"\\\[(.*?)\\\]", latex, re.S):
        if CJK.search(m.group(1)):
            bad_math.append(m.group(0)[:60])

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
    if bad_math:
        bad.append("cjk-in-math:%d" % len(bad_math))
    report.append((sid, chk, "OK" if not bad else ",".join(bad), bad_math))

with open(out, "w", encoding="utf-8") as f:
    json.dump({"sections": sections}, f, ensure_ascii=False, indent=1)
    f.write("\n")

print("written", out, os.path.getsize(out))
for sid, chk, status, bad_math in report:
    print("%s len=%d inl=%s dsp=%s brace=%d env=%s sec=%d text=%d -> %s"
          % (sid, chk["len"], chk["inl"], chk["dsp"], chk["brace"], chk["env"], chk["sec"], chk["text"], status))
    for b in bad_math:
        print("   CJK-in-math:", b)
