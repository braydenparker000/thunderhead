#!/usr/bin/env bash
# What mind/jobs/study-ingest.mjs needs in the mind's session (STUDY.md §3.3), installed only when
# missing: pypdf (BSD-3-Clause) for text, pypdfium2 (Apache-2.0/BSD-3-Clause) and pytesseract
# (Apache-2.0) with Tesseract (Apache-2.0) for scanned pages. Pinned versions. Without Tesseract
# the run still reads every page that has text; it counts the pages left for OCR.
set -u
PY="${PYTHON:-python3}"
if ! "$PY" -c 'import pypdf, pypdfium2, pytesseract' 2>/dev/null; then
  "$PY" -m pip install --quiet --user 'pypdf==6.21.4' 'pypdfium2==5.14.0' 'pytesseract==0.3.13' \
    || "$PY" -m pip install --quiet --user --break-system-packages 'pypdf==6.21.4' 'pypdfium2==5.14.0' 'pytesseract==0.3.13' \
    || echo '{"setup":"pip failed: books with text are read when pypdf is there"}'
fi
if ! command -v tesseract >/dev/null 2>&1; then
  if command -v apt-get >/dev/null 2>&1; then
    (apt-get install -y -q tesseract-ocr tesseract-ocr-eng >/dev/null 2>&1 \
      || sudo -n apt-get install -y -q tesseract-ocr tesseract-ocr-eng >/dev/null 2>&1) \
      || echo '{"setup":"no Tesseract: scanned pages wait for a session that has it"}'
  fi
fi
"$PY" -c 'import pypdf' 2>/dev/null && echo '{"setup":"ready"}' || echo '{"setup":"pypdf missing"}'
