# Qizzone AIV3 — CPU extraction prototype

Run locally:

```bash
python -m venv .venv
pip install -r services/extraction/requirements.txt
uvicorn services.extraction.app:app --reload --port 8001
```

POST a DOCX/PDF as multipart `file` to `/extract`.

**Security:** This is an internal prototype only. Do not expose to the Internet:
it has no Firebase token validation, job queue, tenant isolation, billing quota,
antivirus, OCR or Gemini fallback yet. `needsAiFallback` is a diagnostic flag,
not an automatic API call. All output requires human review.

**Known limitations:** DOCX nested tables, list numbering, inherited styles,
images/formulas, PDF annotations/highlights, multi-column reading order,
page-spanning questions and full coverage are not yet supported. The segmentation
algorithm intentionally leaves unsupported cases for review instead of inventing
missing answers or choices. This is not a production-ready implementation of
the master plan.
