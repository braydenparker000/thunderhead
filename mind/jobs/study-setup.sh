#!/usr/bin/env bash
# What mind/jobs/study-ingest.mjs needs in the mind's session (STUDY.md §3.3), installed only when
# missing: one Python environment of its own, a venv at a known path ($TH_STUDY_VENV, else
# ~/.cache/thunderhead/study-venv), which the ingest finds by that path (never the user site, which
# the ingest's isolated Python ignores, and never the system's packages: on 2026-11-21 the system
# `cryptography` panicked on import and the user-site pypdf the old setup put in was invisible).
# In it, pinned: pypdf (BSD-3-Clause) for text, cryptography (Apache-2.0/BSD-3-Clause) for encrypted
# PDFs, pypdfium2 (Apache-2.0/BSD-3-Clause) and pytesseract (Apache-2.0) with Tesseract
# (Apache-2.0) and its English and Spanish data for scanned pages (a book's language picks one:
# study_extract.py --lang). Without Tesseract the run still reads every page that has text.
set -u
PY="${PYTHON:-python3}"
VENV="${TH_STUDY_VENV:-${HOME:-/root}/.cache/thunderhead/study-venv}"
PINS=('pypdf==6.21.4' 'cryptography==44.0.2' 'pypdfium2==5.14.0' 'pytesseract==0.3.13')
CHECK='import pypdf, cryptography, pypdfium2, pytesseract'
if ! "$VENV/bin/python" -I -c "$CHECK" 2>/dev/null; then
  if [ ! -x "$VENV/bin/python" ]; then
    mkdir -p "$(dirname "$VENV")"
    "$PY" -m venv "$VENV" 2>/dev/null || {
      # Debian and Ubuntu keep venv in its own package.
      (apt-get install -y -q python3-venv >/dev/null 2>&1 || sudo -n apt-get install -y -q python3-venv >/dev/null 2>&1) \
        && "$PY" -m venv "$VENV"
    } || echo '{"setup":"no venv: python3 -m venv failed"}'
  fi
  [ -x "$VENV/bin/python" ] && { "$VENV/bin/python" -I -m pip install --quiet --disable-pip-version-check "${PINS[@]}" \
    || echo '{"setup":"pip failed in the venv"}'; }
fi
if ! command -v tesseract >/dev/null 2>&1 || ! tesseract --list-langs 2>/dev/null | grep -qx spa; then
  if command -v apt-get >/dev/null 2>&1; then
    (apt-get install -y -q tesseract-ocr tesseract-ocr-eng tesseract-ocr-spa >/dev/null 2>&1 \
      || sudo -n apt-get install -y -q tesseract-ocr tesseract-ocr-eng tesseract-ocr-spa >/dev/null 2>&1) \
      || echo '{"setup":"no Tesseract: scanned pages wait for a session that has it"}'
  fi
fi
# The same check the ingest makes before it claims a book, with the same isolated Python.
"$VENV/bin/python" -I -c 'import pypdf, cryptography' 2>/dev/null && echo '{"setup":"ready"}' || echo '{"setup":"pypdf missing"}'
