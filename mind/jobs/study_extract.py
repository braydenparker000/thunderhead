#!/usr/bin/env python3
"""Study's page reader (STUDY.md §3.3, §4), run by mind/jobs/study-ingest.mjs in the mind's own
session, never in GitHub Actions. It reads one PDF and writes one JSON line per page to a file:
{pdf_page, page_label, text, ocr, ocr_conf}. Text comes from pypdf (BSD-3-Clause); a page with
fewer than 50 characters that holds an image, or whose words are mostly not words, is read again
with OCR: rendered at 300 dpi by pypdfium2 (Apache-2.0/BSD-3-Clause) and recognised by Tesseract
through pytesseract (Apache-2.0). Not ocrmypdf (Ghostscript is AGPL), not PyMuPDF (AGPL).
Printed page numbers: the PDF's own /PageLabels; else a number alone in the top or bottom 8% of
the page, kept only where 5 or more pages in a row show the same offset from the PDF page; else
none. It prints counts only, one JSON line: never page text, a title or a file name.

  python3 study_extract.py BOOK.pdf --count
  python3 study_extract.py BOOK.pdf --out PAGES.jsonl [--from N] [--lang eng] [--no-ocr]

Exit: 0 done, 2 usage, 3 password-protected, 4 not a readable PDF.
"""
import argparse
import json
import re
import sys

MIN_CHARS = 50
WORDY = re.compile(r"[A-Za-zÀ-ɏ]{2,}")
NUMBER = re.compile(r"^\d{1,5}$")
EDGE = 0.08
RUN = 5


def fail(code, error):
    print(json.dumps({"error": error}))
    sys.exit(code)


def open_pdf(path):
    try:
        from pypdf import PdfReader
        from pypdf.errors import PdfReadError
    except ImportError:
        fail(2, "pypdf is not installed")
    try:
        reader = PdfReader(path)
        if reader.is_encrypted and not reader.decrypt(""):
            fail(3, "encrypted")
        _ = len(reader.pages)
        return reader
    except SystemExit:
        raise
    except Exception:  # noqa: BLE001 - any parse failure means the file isn't readable
        fail(4, "unreadable")


def own_labels(reader):
    """The PDF's /PageLabels, or None when it has none."""
    try:
        if "/PageLabels" not in reader.trailer["/Root"]:
            return None
        return [str(label) for label in reader.page_labels]
    except Exception:  # noqa: BLE001
        return None


def edge_number(page):
    """A number standing alone near the top or bottom edge of the page, else None."""
    height = float(page.mediabox.height) or 1.0
    found = []

    def visit(text, cm, tm, _font, _size):
        t = text.strip()
        if not NUMBER.match(t):
            return
        y = cm[1] * tm[4] + cm[3] * tm[5] + cm[5]
        if y < height * EDGE or y > height * (1 - EDGE):
            found.append(int(t))

    try:
        page.extract_text(visitor_text=visit)
    except Exception:  # noqa: BLE001
        return None
    return found[0] if len(set(found)) == 1 else None


def inferred_labels(reader):
    """Labels from printed numbers where 5+ pages in a row agree on the offset; None elsewhere."""
    numbers = [edge_number(p) for p in reader.pages]
    offsets = [None if n is None else n - (i + 1) for i, n in enumerate(numbers)]
    labels = [None] * len(numbers)
    i = 0
    while i < len(offsets):
        if offsets[i] is None:
            i += 1
            continue
        j = i
        while j + 1 < len(offsets) and offsets[j + 1] == offsets[i]:
            j += 1
        if j - i + 1 >= RUN:
            for k in range(i, j + 1):
                if k + 1 + offsets[i] >= 1:
                    labels[k] = str(k + 1 + offsets[i])
        i = j + 1
    return labels if any(labels) else None


def has_image(page):
    try:
        return len(page.images) > 0
    except Exception:  # noqa: BLE001
        return False


def mostly_not_words(text):
    tokens = text.split()
    if len(tokens) < 20:
        return False
    return sum(1 for t in tokens if not WORDY.search(t)) / len(tokens) > 0.4


class Ocr:
    """Tesseract through pytesseract, if this session has it; `ready` says so."""

    def __init__(self, path, lang, enabled):
        self.ready = False
        if not enabled:
            return
        try:
            import pypdfium2
            import pytesseract

            pytesseract.get_tesseract_version()
        except Exception:  # noqa: BLE001 - not installed here: the page keeps what text it has
            return
        self.pdf = pypdfium2.PdfDocument(path)
        self.tess = pytesseract
        self.lang = lang
        self.ready = True

    def read(self, index):
        image = self.pdf[index].render(scale=300 / 72).to_pil()
        data = self.tess.image_to_data(image, lang=self.lang, config="--psm 3", output_type=self.tess.Output.DICT)
        words = [(w, float(c)) for w, c in zip(data["text"], data["conf"]) if w.strip() and float(c) >= 0]
        text = self.tess.image_to_string(image, lang=self.lang, config="--psm 3")
        conf = round(sum(c for _, c in words) / len(words), 1) if words else 0.0
        return text, conf


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--count", action="store_true")
    ap.add_argument("--out")
    ap.add_argument("--from", dest="start", type=int, default=0)
    ap.add_argument("--lang", default="eng")
    ap.add_argument("--no-ocr", action="store_true")
    a = ap.parse_args()
    reader = open_pdf(a.pdf)
    total = len(reader.pages)
    if a.count:
        print(json.dumps({"pages": total}))
        return
    if not a.out:
        fail(2, "--out is needed")
    labels = own_labels(reader)
    source = "pdf" if labels else None
    if labels is None:
        labels = inferred_labels(reader)
        source = "inferred" if labels else "none"
    ocr = Ocr(a.pdf, a.lang, not a.no_ocr)
    counts = {"pages": total, "done": 0, "ocr": 0, "ocr_missing": 0, "labels": source}
    with open(a.out, "w", encoding="utf-8") as out:
        for i in range(a.start, total):
            page = reader.pages[i]
            try:
                text = page.extract_text() or ""
            except Exception:  # noqa: BLE001
                text = ""
            used_ocr, conf = False, None
            if (len(text.strip()) < MIN_CHARS and has_image(page)) or mostly_not_words(text):
                if ocr.ready:
                    text, conf = ocr.read(i)
                    used_ocr = True
                    counts["ocr"] += 1
                else:
                    counts["ocr_missing"] += 1
            label = labels[i] if labels and i < len(labels) else None
            line = {"pdf_page": i + 1, "page_label": label, "text": text[:60000], "ocr": used_ocr, "ocr_conf": conf}
            out.write(json.dumps(line, ensure_ascii=False) + "\n")
            counts["done"] += 1
    print(json.dumps(counts))


if __name__ == "__main__":
    main()
