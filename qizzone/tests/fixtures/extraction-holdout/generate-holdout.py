#!/usr/bin/env python3
"""Sinh fixtures HOLDOUT synthetic cho Qizzone AI Parser v2 (bước 27, PLAN_MAIN).

Chạy:  python3 generate-holdout.py h01 h02 h04   (cần python-docx)
        <venv có PyMuPDF> generate-holdout.py h03
Ghi:   <id>.<docx|pdf> + <id>.expected.json cho mỗi fixture, trong thư mục này.

QUY TẮC HOLDOUT (khóa ở bước 27, không được phá):
- Nội dung TỰ VIẾT, synthetic, KHÔNG copy từ file thật nào của user.
- Template của h01–h04 CHƯA TỪNG xuất hiện trong quá trình phát triển
  (không có trong f01–f22, không dùng để sửa code trước bước 27).
- Bước 27 CHỈ ĐO holdout, KHÔNG sửa code để xanh holdout. Sửa code theo
  holdout sẽ làm nó không còn unseen — phân tích + đề xuất sửa ghi vào
  PROGRESS.md, để bước sau quyết định.

Danh sách:
- h01 DOCX inline options: cả 4 phương án nằm chung 1 đoạn văn với stem,
  cách nhau bằng 1 space, KHÔNG có dấu câu cuối mỗi phương án.
  (Mọi fixture f01–f22 đều để mỗi phương án 1 đoạn riêng.)
- h02 DOCX bảng-mỗi-câu: mỗi hàng bảng = 1 câu (ô 1 = stem, ô 2 = 4 đoạn
  phương án, ô 3 = dòng đáp án). Parser AST flatten hàng bảng bằng tab
  giữa các ô và space giữa các đoạn trong ô, nên phương án trong ô 2
  thành inline sau khi flatten — nhưng mỗi phương án ở đây KẾT THÚC
  BẰNG DẤU CHẤM, khác h01. Cặp h01/h02 khoanh đúng điều kiện biên:
  inline option chỉ tách được khi trước nó là dấu câu + space.
- h03 PDF 2 cột + dòng toàn chiều rộng Ở GIỮA trang: dòng chú thích cấp
  trang nằm giữa khối cột trên và khối cột dưới. Kỳ vọng (quyết trước
  khi đo, xem README.md): thứ tự đọc = khối cột trên (trái rồi phải),
  rồi dòng chú thích đúng vị trí Y của nó, rồi khối cột dưới; về phân
  đoạn, dòng chú thích KHÔNG thuộc về bất kỳ câu nào (stem/options của
  câu ngay trước nó phải giữ nguyên).
- h04 DOCX nhãn La Mã: "Câu I.", "Câu II.", "Câu III." thay cho số
  Ả Rập. Header regex của parser chỉ nhận số Ả Rập nên đây là dạng
  nhãn chưa từng được hỗ trợ.
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"


def q(order, label, qtype, stem, options, correct, origin, evidence, page=1,
      has_image=False):
    return {
        "order": order,
        "label": label,
        "type": qtype,
        "stem": stem,
        "options": [{"key": k, "text": t} for k, t in options],
        "correctAnswers": correct,
        "answerOrigin": origin,
        "page": page,
        "evidence": evidence,
        "hasImage": has_image,
    }


def write_expected(fid, fname, fmt, questions, notes=""):
    data = {
        "id": fid,
        "file": fname,
        "format": fmt,
        "notes": notes,
        "questions": questions,
    }
    with open(os.path.join(HERE, fid + ".expected.json"), "w",
              encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return data


# ---------------------------------------------------------------- h01: inline options
def h01():
    from docx import Document
    doc = Document()
    qs = [
        ("Câu 1", "Thủ đô của nước Pháp là thành phố nào?",
         [("A", "Berlin"), ("B", "Paris"), ("C", "Madrid"), ("D", "Roma")],
         "B"),
        ("Câu 2", "Hành tinh nào gần Mặt Trời nhất?",
         [("A", "Kim tinh"), ("B", "Thủy tinh"), ("C", "Hỏa tinh"),
          ("D", "Mộc tinh")],
         "B"),
        ("Câu 3", "Số nào chia hết cho cả 2 và 3?",
         [("A", "14"), ("B", "21"), ("C", "24"), ("D", "35")],
         "C"),
    ]
    exp = []
    for i, (label, stem, options, key) in enumerate(qs, 1):
        inline = " ".join(f"{k}. {t}" for k, t in options)
        doc.add_paragraph(f"{label}. {stem} {inline}")
        doc.add_paragraph(f"Đáp án: {key}")
        exp.append(q(i, label, "single_choice", stem, options, [key],
                       "answer_line", "Phương án inline chung 1 đoạn, "
                       "đáp án bằng dòng 'Đáp án: X' cuối mỗi câu."))
    doc.save(os.path.join(HERE, "h01-docx-inline-options.docx"))
    write_expected("h01-docx-inline-options", "h01-docx-inline-options.docx",
                   "docx", exp,
                   "DOCX holdout: 4 phương án inline chung 1 đoạn với stem, "
                   "cách nhau 1 space, không dấu câu cuối phương án.")


# ---------------------------------------------------------------- h02: bảng-mỗi-câu
def h02():
    from docx import Document
    doc = Document()
    qs = [
        ("Câu 1", "Thủ đô của nước Ý là thành phố nào?",
         [("A", "Venice."), ("B", "Roma."), ("C", "Milan."), ("D", "Napoli.")],
         "B"),
        ("Câu 2", "Hành tinh nào gần Mặt Trời nhất?",
         [("A", "Thủy tinh."), ("B", "Kim tinh."), ("C", "Hỏa tinh."),
          ("D", "Mộc tinh.")],
         "A"),
        ("Câu 3", "Loài chim nào không biết bay?",
         [("A", "Bồ câu."), ("B", "Đại bàng."), ("C", "Chim sẻ."),
          ("D", "Chim cánh cụt.")],
         "D"),
    ]
    table = doc.add_table(rows=0, cols=3)
    exp = []
    for i, (label, stem, options, key) in enumerate(qs, 1):
        row = table.add_row().cells
        row[0].paragraphs[0].add_run(f"{label}. {stem}")
        for j, (k, t) in enumerate(options):
            p = row[1].paragraphs[0] if j == 0 else row[1].add_paragraph()
            p.add_run(f"{k}. {t}")
        row[2].paragraphs[0].add_run(f"Đáp án: {key}")
        plain = [(k, t.rstrip(".")) for k, t in options]
        exp.append(q(i, label, "single_choice", stem, plain, [key],
                       "answer_line", "Câu trong 1 hàng bảng: ô stem, ô "
                       "phương án (mỗi phương án 1 đoạn, kết thúc bằng dấu "
                       "chấm), ô đáp án."))
    doc.save(os.path.join(HERE, "h02-docx-table-questions.docx"))
    write_expected("h02-docx-table-questions", "h02-docx-table-questions.docx",
                   "docx", exp,
                   "DOCX holdout: mỗi câu là 1 hàng bảng 3 ô (stem, phương "
                   "án, đáp án).")


# ---------------------------------------------------------------- h03: PDF 2 cột + chú thích giữa trang
def h03():
    import fitz
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    # Cột trái x=40, cột phải x=360, leading 26. Khối trên y=80..210,
    # dòng chú thích toàn chiều rộng y=262, khối dưới y=314..444.
    left = [
        (80, "Câu 1. Thủ đô của nước Ý là thành phố nào?"),
        (106, "A. Venice"), (132, "B. Roma"), (158, "C. Milan"),
        (184, "D. Napoli"), (210, "Đáp án: B"),
        (314, "Câu 3. Kim loại nào dẫn điện tốt nhất?"),
        (340, "A. Sắt"), (366, "B. Nhôm"), (392, "C. Đồng"),
        (418, "D. Chì"), (444, "Đáp án: C"),
    ]
    # Stem cột phải phải ngắn (≤ ~36 ký tự ở cỡ 13pt) vì cột phải chỉ
    # rộng 235pt: stem dài hơn sẽ bị PyMuPDF cắt khi chèn (đã đo: stem
    # 40 ký tự mất đuôi "ngày?").
    right = [
        (80, "Câu 2. 7 nhân 6 bằng bao nhiêu?"),
        (106, "A. 36"), (132, "B. 42"), (158, "C. 48"), (184, "D. 54"),
        (210, "Đáp án: B"),
        (314, "Câu 4. Năm nhuận có mấy ngày?"),
        (340, "A. 365"), (366, "B. 366"), (392, "C. 364"), (418, "D. 360"),
        (444, "Đáp án: B"),
    ]
    for y, text in left:
        page.insert_text((40, y), text, fontsize=13, fontname="F0",
                         fontfile=FONT)
    for y, text in right:
        page.insert_text((360, y), text, fontsize=13, fontname="F0",
                         fontfile=FONT)
    # Dòng chú thích toàn chiều rộng ở GIỮA trang (61 ký tự, đủ chạm qua
    # x=360 để orderPageLines nhận diện là full-width).
    page.insert_text(
        (40, 262), "Chú ý: Thí sinh không được sử dụng tài liệu trong phòng thi.",
        fontsize=13, fontname="F0", fontfile=FONT)
    doc.save(os.path.join(HERE, "h03-pdf-mid-note.pdf"))
    qs = [
        q(1, "Câu 1", "single_choice", "Thủ đô của nước Ý là thành phố nào?",
          [("A", "Venice"), ("B", "Roma"), ("C", "Milan"), ("D", "Napoli")],
          ["B"], "answer_line", "Cột trái, khối trên.", page=1),
        q(2, "Câu 2", "single_choice", "7 nhân 6 bằng bao nhiêu?",
          [("A", "36"), ("B", "42"), ("C", "48"), ("D", "54")],
          ["B"], "answer_line", "Cột phải, khối trên.", page=1),
        q(3, "Câu 3", "single_choice", "Kim loại nào dẫn điện tốt nhất?",
          [("A", "Sắt"), ("B", "Nhôm"), ("C", "Đồng"), ("D", "Chì")],
          ["C"], "answer_line", "Cột trái, khối dưới.", page=1),
        q(4, "Câu 4", "single_choice", "Năm nhuận có mấy ngày?",
          [("A", "365"), ("B", "366"), ("C", "364"), ("D", "360")],
          ["B"], "answer_line", "Cột phải, khối dưới.", page=1),
    ]
    write_expected("h03-pdf-mid-note", "h03-pdf-mid-note.pdf", "pdf", qs,
                   "PDF holdout: 2 cột + dòng chú thích toàn chiều rộng ở "
                   "GIỮA trang (không thuộc về bất kỳ câu nào).")


# ---------------------------------------------------------------- h04: nhãn La Mã
def h04():
    from docx import Document
    doc = Document()
    qs = [
        ("Câu I", "Nước nào có diện tích lớn nhất thế giới?",
         [("A", "Canada"), ("B", "Trung Quốc"), ("C", "Nga"), ("D", "Hoa Kỳ")],
         "C"),
        ("Câu II", "Ngôn ngữ nào được nói nhiều nhất thế giới?",
         [("A", "Tiếng Trung"), ("B", "Tiếng Anh"), ("C", "Tiếng Hindi"),
          ("D", "Tiếng Tây Ban Nha")],
         "A"),
        ("Câu III", "Đại dương nào lớn nhất?",
         [("A", "Ấn Độ Dương"), ("B", "Đại Tây Dương"),
          ("C", "Bắc Băng Dương"), ("D", "Thái Bình Dương")],
         "D"),
    ]
    exp = []
    for i, (label, stem, options, key) in enumerate(qs, 1):
        p = doc.add_paragraph()
        p.add_run(f"{label}. {stem}")
        for k, t in options:
            doc.add_paragraph(f"{k}. {t}")
        doc.add_paragraph(f"Đáp án: {key}")
        exp.append(q(i, label, "single_choice", stem, options, [key],
                       "answer_line", "Nhãn câu bằng số La Mã, đáp án bằng "
                       "dòng 'Đáp án: X' cuối mỗi câu."))
    doc.save(os.path.join(HERE, "h04-docx-roman.docx"))
    write_expected("h04-docx-roman", "h04-docx-roman.docx", "docx", exp,
                   "DOCX holdout: nhãn câu bằng số La Mã (I, II, III).")


FUNCS = {"h01": h01, "h02": h02, "h03": h03, "h04": h04}


def main():
    names = sys.argv[1:] or list(FUNCS)
    for name in names:
        FUNCS[name]()
        print("ok", name)


if __name__ == "__main__":
    main()
