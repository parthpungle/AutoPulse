"""Small, grounded document search for Ask AutoPulse: no language model, no training.

The project's own Markdown (README, docs/, PROJECT_PLAN) is split into sections by heading and
indexed with TF-IDF. A question returns the best section's title and the single sentence in it
that overlaps the question most, so the answer is always a quote from our docs.
"""
import re
from functools import lru_cache
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = [ROOT / "README.md", ROOT / "PROJECT_PLAN.md", *sorted((ROOT / "docs").glob("*.md"))]


def _clean(md):
    md = re.sub(r"```.*?```", " ", md, flags=re.S)                 # code blocks and diagrams
    md = re.sub(r"<[^>]+>", " ", md)
    md = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", md)
    md = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", md)                 # links -> their text
    md = re.sub(r"^\s*\|?[-:| ]+\|?\s*$", " ", md, flags=re.M)        # table rules
    md = md.replace("|", " . ").replace("**", "").replace("`", "")
    return re.sub(r"[ \t]+", " ", md)


@lru_cache(maxsize=1)
def _index():
    from sklearn.feature_extraction.text import TfidfVectorizer
    sections = []
    for path in DOCS:
        if not path.exists():
            continue
        text = path.read_text(encoding="utf-8", errors="ignore")
        parts = re.split(r"^(#{1,4} .+)$", text, flags=re.M)
        title = path.stem
        for chunk in parts:
            if re.match(r"^#{1,4} ", chunk):
                title = chunk.lstrip("#").strip()
                continue
            body = _clean(chunk).strip()
            if len(body) > 80:
                sections.append({"doc": path.relative_to(ROOT).as_posix(), "title": title, "body": body})
    vec = TfidfVectorizer(stop_words="english", ngram_range=(1, 2), sublinear_tf=True)
    mat = vec.fit_transform([f"{s['title']} {s['title']} {s['body']}" for s in sections])
    return sections, vec, mat


def search(question, min_score=0.08):
    sections, vec, mat = _index()
    q = vec.transform([question])
    scores = (mat @ q.T).toarray().ravel()
    best = int(scores.argmax())
    if scores[best] < min_score:
        return None
    sec = sections[best]
    words = {w for w in re.findall(r"[a-z0-9]+", question.lower()) if len(w) > 2}
    sentences = [s.strip(" .-") for s in re.split(r"(?<=[.!?])\s+|\n+", sec["body"]) if 25 < len(s.strip()) < 320]
    if not sentences:
        return None
    sentence = max(sentences, key=lambda s: len(words & set(re.findall(r"[a-z0-9]+", s.lower()))))
    return {"title": sec["title"], "doc": sec["doc"], "sentence": sentence.rstrip(".") + ".", "score": round(float(scores[best]), 3)}
