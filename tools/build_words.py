"""Build Wordfront's built-in word list (src/words.txt).

Words are ranked by real-world frequency (wordfreq), kept only if they are
lowercase dictionary words (Hunspell en_US, with its suffix/prefix rules expanded,
so names and abbreviations drop out), and filtered against an offensive-word
blocklist (LDNOOBW "en") plus a few extra terms that don't suit a cartoon game.
The most frequent words of each length are kept, with per-length quotas so the
long words Destroyers and Oppressors need are plentiful.

Build-time only; nothing here ships with the game. Run with an environment that
has wordfreq installed:

    python -I tools/build_words.py --dic en_US.dic --aff en_US.aff \
        --blocklist ldnoobw-en.txt --out src/words.txt
"""

from __future__ import annotations

import argparse
import re
from collections import Counter
from pathlib import Path

from wordfreq import top_n_list, zipf_frequency

# words kept per length (length 1 is the alphabet, added by the game)
QUOTAS = {
    2: 60,
    3: 380,
    4: 700,
    5: 700,
    6: 650,
    7: 600,
    8: 500,
    9: 450,
    10: 350,
    11: 250,
    12: 200,
}

# Real two-letter words; Hunspell's lowercase two-letter entries include
# abbreviations and interjections we don't want.
TWO_LETTER = set(
    "am an as at ax be by do go he hi if in is it me my no of oh ok on or ox "
    "so to up us we yo ah".split()
)

# Not offensive enough for LDNOOBW, but wrong for a light cartoon game, or
# abbreviations / fragments that slip through the dictionary.
EXTRA_BLOCK = set(
    """
    suicide suicidal genocide holocaust terrorism terrorist terrorists nazi nazis
    rape raped rapes raping rapist rapists molest molested molesting molestation
    pedophile pedophiles pedophilia incest slave slaves slavery enslaved
    abortion abortions cocaine heroin meth overdose lynch lynching massacre
    torture tortured hitler jihad isis kkk porn porno pornography sexy sexual
    sexually sex nude nudity naked erotic fetish
    """.split()
    # abbreviations, roman numerals and word fragments the dictionary accepts
    + """
    etc vs ie eg aka ext misc inc ltd iii vii xii xiv xvi tho vol sec gen com est
    cos mph til cal gov sen chi col cox jun sci ins tel med alt int res quo eds
    lib mil dis val dos sol uni reg exp hrs var dub sic cis ind lea tor sup esp
    meg org phi mas nos yrs wen aux lam psi mos pol hoc std cad cps aft eff avg
    div eta ems git ids yer ave rev rep corp prof doc def sim mic min max non
    thy obi pip tat vie bis foo dun lux nil cor dab fro nip soc ans bey hex lac
    fay tau hwy pap rem tam rpm fps rec pas hon mar con ups ole gal wan sac din
    rue nay pew bop sis fol moi
    """.split()
    # interjections and filler
    + "nah yep huh ugh hmm yup duh aha yea meh ooh woo wee boo gee".split()
    # crude or bodily
    + "crap piss pee poo bra bum babe oral".split()
    # first names and surnames that pass as words
    + """
    tom bob don ted ken lee jay mac john mike tony rick josh brad khan peter
    smith harry jimmy roger maria billy johnny charlie martin carter miller
    """.split()
    # places and brands
    + "china japan wales dutch soviet oxford mars google twitter amazon android trump".split()
    # religion and politics
    + """
    god gods pray prayer prayers pope bible church churches catholic christian
    religion religious priest priests resurrection congregation democrat
    democrats democratic republican republicans politics political politically
    politician politicians communist nationalist immigration immigrants refugees
    racist racism ethnic gay transgender
    """.split()
    # sex and reproduction, drugs and alcohol, crime and disease
    + """
    virgin breast breasts pregnant pregnancy reproductive reproduction prostitution
    drug drugs weed marijuana alcohol drunk beer wine gin rum ale coke cult
    abuse abused assault murder murdered victim victims cancer disease diseases
    prison prisoners imprisonment criminal criminals crime crimes guilty arrest
    arrested police cops jail hate hell damn allegations prosecution surveillance aids
    """.split()
)

WORD_RE = re.compile(r"^[a-z]+$")


def load_hunspell(dic: Path, aff: Path) -> set[str]:
    """All lowercase a-z forms the dictionary accepts (affix rules expanded)."""
    sfx: dict[str, list[tuple[str, str, re.Pattern[str]]]] = {}
    pfx: dict[str, list[tuple[str, str, re.Pattern[str]]]] = {}
    cross: dict[str, bool] = {}
    for line in aff.read_text(encoding="utf-8", errors="replace").splitlines():
        parts = line.split()
        if len(parts) >= 4 and parts[0] in ("SFX", "PFX") and parts[3] in ("Y", "N") and len(parts) == 4:
            cross[parts[1]] = parts[2] == "Y"
            continue
        if len(parts) >= 5 and parts[0] in ("SFX", "PFX"):
            kind, flag, strip, add, cond = parts[:5]
            strip = "" if strip == "0" else strip
            add = "" if add == "0" else add.split("/")[0]
            pat = re.compile((cond + "$") if kind == "SFX" else ("^" + cond)) if cond != "." else re.compile("")
            (sfx if kind == "SFX" else pfx).setdefault(flag, []).append((strip, add, pat))

    words: set[str] = set()
    lines = dic.read_text(encoding="utf-8", errors="replace").splitlines()
    for line in lines[1:]:
        if not line:
            continue
        base, _, flags = line.partition("/")
        if not WORD_RE.match(base):
            continue  # capitalised (names), apostrophes, etc.
        forms = {base}
        for f in flags:
            for strip, add, pat in sfx.get(f, []):
                if pat.search(base) and base.endswith(strip):
                    forms.add(base[: len(base) - len(strip)] + add)
            for strip, add, pat in pfx.get(f, []):
                if pat.search(base) and base.startswith(strip):
                    forms.add(add + base[len(strip):])
        words.update(w for w in forms if WORD_RE.match(w))
    return words


def load_blocklist(path: Path) -> set[str]:
    out = set()
    for line in path.read_text(encoding="utf-8", errors="replace").splitlines():
        w = line.strip().lower()
        if w and " " not in w:
            out.add(w)
    return out


def blocked(w: str, block: set[str]) -> bool:
    if w in block:
        return True
    # simple inflections of a blocked word
    for suf in ("s", "es", "ed", "ing", "er", "ers", "y"):
        if w.endswith(suf) and w[: -len(suf)] in block:
            return True
    return False


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dic", type=Path, required=True)
    ap.add_argument("--aff", type=Path, required=True)
    ap.add_argument("--blocklist", type=Path, required=True)
    ap.add_argument("--out", type=Path, required=True)
    ap.add_argument("--pool", type=int, default=300_000, help="how many frequent words to consider")
    args = ap.parse_args()

    dictionary = load_hunspell(args.dic, args.aff)
    block = load_blocklist(args.blocklist) | EXTRA_BLOCK

    picked: dict[int, list[str]] = {n: [] for n in QUOTAS}
    for w in top_n_list("en", args.pool):
        n = len(w)
        if n not in QUOTAS or len(picked[n]) >= QUOTAS[n]:
            continue
        if not WORD_RE.match(w) or w not in dictionary or blocked(w, block):
            continue
        if n == 2 and w not in TWO_LETTER:
            continue
        picked[n].append(w)

    lines = [w for n in sorted(picked) for w in picked[n]]
    args.out.write_text("\n".join(lines) + "\n", encoding="utf-8", newline="\n")

    counts = Counter(len(w) for w in lines)
    print(f"dictionary forms: {len(dictionary):,}; blocklist: {len(block):,}")
    print(f"wrote {len(lines):,} words to {args.out}")
    for n in sorted(counts):
        last = picked[n][-1]
        print(f"  len {n:2}: {counts[n]:4}  (rarest kept: {last!r}, zipf {zipf_frequency(last, 'en'):.2f})")


if __name__ == "__main__":
    main()
