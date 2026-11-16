"""Qizzone AIV3 CPU-native document extraction prototype.

No model keys, answer guessing, or generated options. Intended for isolated
internal use until authentication, rate limiting and job queue are integrated.
"""
from __future__ import annotations

import hashlib
import io
import re
from typing import Any

import fitz
from docx import Document
from fastapi import FastAPI, File, HTTPException, UploadFile

app = FastAPI(title="Qizzone extraction worker", version="0.1.0")
MAX_BYTES = 15 * 1024 * 1024
QUESTION = re.compile(r"^\s*(?:(?:Câu|Question|Q)\s*)?(\d{1,3})\s*[.):\-]\s*(.*)$", re.I)
OPTION = re.compile(r"^\s*([*✓]?\s*)[([]?([A-Da-d])[).:\]\-]\s*(.*)$")
ANSWER = re.compile(r"^\s*(?:Đáp\s*án|Answer)\s*[:：\-]\s*([A-Da-d])\s*$", re.I)


def docx_blocks(data: bytes) -> list[dict[str, Any]]:
    doc = Document(io.BytesIO(data))
    blocks: list[dict[str, Any]] = []
    # Document.iter_inner_content retains paragraph/table order.
    for node in doc.iter_inner_content():
        if hasattr(node, "rows"):
            for row in node.rows:
                for cell in row.cells:
                    for paragraph in cell.paragraphs:
                        if paragraph.text.strip():
                            blocks.append(_paragraph(paragraph, len(blocks), "table_cell"))
        elif node.text.strip():
            blocks.append(_paragraph(node, len(blocks), "paragraph"))
    return blocks


def _paragraph(paragraph: Any, index: int, kind: str) -> dict[str, Any]:
    return {
        "id": f"b_{index:05d}",
        "type": kind,
        "text": paragraph.text,
        "sourceRef": {"paragraph": index},
        "runs": [
            {
                "text": run.text,
                "bold": bool(run.bold) if run.bold is not None else None,
                "underline": bool(run.underline) if run.underline is not None else None,
                "highlight": str(run.font.highlight_color) if run.font.highlight_color else None,
            }
            for run in paragraph.runs
        ],
    }


def pdf_blocks(data: bytes) -> list[dict[str, Any]]:
    blocks: list[dict[str, Any]] = []
    with fitz.open(stream=data, filetype="pdf") as pdf:
        if len(pdf) > 100:
            raise ValueError("PDF exceeds page limit")
        for page_no, page in enumerate(pdf, 1):
            for item in page.get_text("dict", sort=True)["blocks"]:
                if "lines" not in item:
                    continue
                for line in item["lines"]:
                    text = "".join(span["text"] for span in line["spans"])
                    if text.strip():
                        blocks.append({
                            "id": f"b_{len(blocks):05d}",
                            "type": "text_span",
                            "text": text,
                            "bbox": list(line["bbox"]),
                            "sourceRef": {"page": page_no},
                            "runs": [{
                                "text": span["text"],
                                "font": span.get("font"),
                                "color": span.get("color"),
                                "flags": span.get("flags"),
                            } for span in line["spans"]],
                        })
    return blocks


def segment(blocks: list[dict[str, Any]]) -> dict[str, Any]:
    questions: list[dict[str, Any]] = []
    current: dict[str, Any] | None = None
    option: dict[str, Any] | None = None
    ignored: list[str] = []
    for block in blocks:
        text = block["text"].strip()
        question_match = QUESTION.match(text)
        option_match = OPTION.match(text)
        answer_match = ANSWER.match(text)
        if question_match and (not current or int(question_match[1]) != current["questionNumber"]):
            current = {
                "questionNumber": int(question_match[1]),
                "stem": question_match[2],
                "options": [],
                "correctAnswers": [],
                "answerStatus": "unknown",
                "answerEvidence": [],
                "qualityFlags": [],
                "reviewStatus": "pending",
                "sourceBlockIds": [block["id"]],
            }
            questions.append(current)
            option = None
        elif current and answer_match:
            key = answer_match[1].upper()
            if any(o["key"] == key for o in current["options"]):
                current["correctAnswers"] = [key]
                current["answerStatus"] = "evidence_supported"
                current["answerEvidence"].append({
                    "kind": "explicit_answer_line",
                    "sourceBlockId": block["id"],
                    "optionKey": key,
                })
            else:
                current["qualityFlags"].append("answer_outside_options")
            current["sourceBlockIds"].append(block["id"])
        elif current and option_match:
            key = option_match[2].upper()
            option = {
                "key": key,
                "rawMarker": text[:option_match.start(3)],
                "content": option_match[3],
                "sourceBlockIds": [block["id"]],
            }
            current["options"].append(option)
            current["sourceBlockIds"].append(block["id"])
        elif current:
            if option:
                option["content"] += "\n" + text
            else:
                current["stem"] += "\n" + text
            current["sourceBlockIds"].append(block["id"])
        else:
            ignored.append(block["id"])
    for index, question in enumerate(questions):
        keys = [o["key"] for o in question["options"]]
        if len(keys) not in (2, 3, 4) or len(keys) != len(set(keys)):
            question["qualityFlags"].append("invalid_option_structure")
        if index and question["questionNumber"] != questions[index - 1]["questionNumber"] + 1:
            question["qualityFlags"].append("number_gap_or_duplicate")
    return {"questions": questions, "unassignedBlockIds": ignored}


@app.post("/extract")
async def extract(file: UploadFile = File(...)) -> dict[str, Any]:
    data = await file.read(MAX_BYTES + 1)
    if len(data) > MAX_BYTES:
        raise HTTPException(413, "Document exceeds 15 MB")
    fmt = (file.filename or "").lower().rsplit(".", 1)[-1]
    if fmt not in {"docx", "pdf"}:
        raise HTTPException(415, "Only DOCX/PDF native extraction supported")
    if fmt == "pdf" and not data.startswith(b"%PDF"):
        raise HTTPException(415, "Invalid PDF signature")
    if fmt == "docx" and not data.startswith(b"PK"):
        raise HTTPException(415, "Invalid DOCX signature")
    try:
        blocks = docx_blocks(data) if fmt == "docx" else pdf_blocks(data)
        parsed = segment(blocks)
    except Exception as exc:
        raise HTTPException(422, "Document cannot be parsed") from exc
    return {
        "schemaVersion": "2.0",
        "sourceFormat": fmt,
        "sourceHash": hashlib.sha256(data).hexdigest(),
        "blocks": blocks,
        **parsed,
        "requiresReview": True,
        "needsAiFallback": not parsed["questions"] or bool(parsed["unassignedBlockIds"]) or
            any(q["qualityFlags"] for q in parsed["questions"]),
    }
