#!/usr/bin/env python3
"""Sinh fixtures synthetic cho Qizzone AI Parser v2 (bước 02, PLAN_MAIN).

Chạy:  <venv python> generate-fixtures.py   (thư mục hiện tại = thư mục này)
Ghi:   <id>.<docx|pdf|txt> + <id>.expected.json cho mỗi fixture.

Quy tắc:
- Nội dung câu hỏi TỰ VIẾT, synthetic, KHÔNG copy từ file thật nào của user.
- Mỗi fixture có expected.json ground truth: order/label/type/stem/options/
  correctAnswers/answerOrigin/page/evidence. correctAnswers=[] khi nguồn
  thực sự không có đáp án (không bịa đáp án).
- answerOrigin: highlight | bold | underline | answer_line | answer_table
  | none (không có bằng chứng đáp án trong nguồn).
"""
import json
import os
import zipfile
from copy import deepcopy

from docx import Document
from docx.enum.text import WD_COLOR_INDEX
from docx.oxml import parse_xml
from docx.oxml.ns import nsdecls
from docx.shared import Inches

HERE = os.path.dirname(os.path.abspath(__file__))
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"

# ---------------------------------------------------------------- DOCX helpers
def new_doc():
    return Document()


def add_q(doc, label, stem, options):
    """options: list[(key, text, style)] với style trong
    {None, 'highlight', 'bold', 'underline'} áp cho toàn bộ dòng option."""
    p = doc.add_paragraph()
    p.add_run(f"{label}. {stem}")
    for key, text, style in options:
        po = doc.add_paragraph()
        r = po.add_run(f"{key}. {text}")
        if style == "highlight":
            r.font.highlight_color = WD_COLOR_INDEX.YELLOW
        elif style == "bold":
            r.bold = True
        elif style == "underline":
            r.underline = True


def add_answer_line(doc, key):
    doc.add_paragraph(f"Đáp án: {key}")


def save_docx(doc, name):
    path = os.path.join(HERE, name)
    doc.save(path)
    return path


def add_omath_fraction(paragraph, num, den):
    """Chèn một phân số OMML (m:f) vào cuối paragraph, qua run rỗng."""
    run = paragraph.add_run()
    xml = (
        f'<m:oMath {nsdecls("m")}><m:f>'
        f"<m:num><m:r><m:t>{num}</m:t></m:r></m:num>"
        f"<m:den><m:r><m:t>{den}</m:t></m:r></m:den>"
        f"</m:f></m:oMath>"
    )
    run._r.append(parse_xml(xml))


# ---------------------------------------------------------------- expected helpers
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
    with open(os.path.join(HERE, fid + ".expected.json"), "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    return data


# ---------------------------------------------------------------- f01: highlight
def f01():
    doc = new_doc()
    doc.add_paragraph("ĐỀ ÔN TẬP — PHẦN TRẮC NGHIỆM")
    qs = []
    data = [
        ("Thủ đô của nước Pháp là thành phố nào?",
         [("A", "Berlin"), ("B", "Paris"), ("C", "Madrid"), ("D", "Roma")], "B"),
        ("7 × 8 bằng bao nhiêu?",
         [("A", "54"), ("B", "56"), ("C", "64"), ("D", "48")], "B"),
        ("Hành tinh nào gần Mặt Trời nhất?",
         [("A", "Sao Kim"), ("B", "Trái Đất"), ("C", "Sao Thủy"), ("D", "Sao Hỏa")], "C"),
        ("Nước nào có diện tích lớn nhất thế giới?",
         [("A", "Canada"), ("B", "Trung Quốc"), ("C", "Hoa Kỳ"), ("D", "Nga")], "D"),
    ]
    for i, (stem, opts, ans) in enumerate(data, 1):
        styled = [(k, t, "highlight" if k == ans else None) for k, t in opts]
        add_q(doc, f"Câu {i}", stem, styled)
        qs.append(q(i, f"Câu {i}", "single_choice", stem, opts, [ans],
                    "highlight", f"Đáp án {ans} được tô vàng toàn bộ dòng lựa chọn."))
    save_docx(doc, "f01-docx-highlight.docx")
    write_expected("f01-docx-highlight", "f01-docx-highlight.docx", "docx", qs,
                   "Đáp án chỉ có bằng chứng tô vàng, không có dòng đáp án riêng.")


# ---------------------------------------------------------------- f02: bold
def f02():
    doc = new_doc()
    data = [
        ("Ai là tác giả của Truyện Kiều?",
         [("A", "Nguyễn Du"), ("B", "Hồ Xuân Hương"), ("C", "Nguyễn Trãi"),
          ("D", "Bà Huyện Thanh Quan")], "A"),
        ("Số nguyên tố nhỏ nhất là số nào?",
         [("A", "0"), ("B", "1"), ("C", "2"), ("D", "3")], "C"),
        ("Kim loại nào dẫn điện tốt nhất trong các kim loại sau?",
         [("A", "Sắt"), ("B", "Nhôm"), ("C", "Đồng"), ("D", "Bạc")], "D"),
        ("1 giờ có bao nhiêu giây?",
         [("A", "60"), ("B", "360"), ("C", "3600"), ("D", "600")], "C"),
    ]
    qs = []
    for i, (stem, opts, ans) in enumerate(data, 1):
        styled = [(k, t, "bold" if k == ans else None) for k, t in opts]
        add_q(doc, f"Câu {i}", stem, styled)
        qs.append(q(i, f"Câu {i}", "single_choice", stem, opts, [ans],
                    "bold", f"Chỉ đáp án {ans} được in đậm."))
    save_docx(doc, "f02-docx-bold.docx")
    write_expected("f02-docx-bold", "f02-docx-bold.docx", "docx", qs,
                   "Đáp án chỉ có bằng chứng in đậm duy nhất.")


# ---------------------------------------------------------------- f03: underline
def f03():
    doc = new_doc()
    data = [
        ("Đại dương lớn nhất trên Trái Đất là đại dương nào?",
         [("A", "Đại Tây Dương"), ("B", "Ấn Độ Dương"), ("C", "Thái Bình Dương"),
          ("D", "Bắc Băng Dương")], "C"),
        ("Căn bậc hai của 144 là bao nhiêu?",
         [("A", "11"), ("B", "12"), ("C", "13"), ("D", "14")], "B"),
        ("Chất khí nào chiếm tỉ lệ lớn nhất trong không khí?",
         [("A", "Oxi"), ("B", "Nitơ"), ("C", "Cacbon đioxit"), ("D", "Heli")], "B"),
        ("Năm nào con người lần đầu đặt chân lên Mặt Trăng?",
         [("A", "1959"), ("B", "1969"), ("C", "1975"), ("D", "1981")], "B"),
    ]
    qs = []
    for i, (stem, opts, ans) in enumerate(data, 1):
        styled = [(k, t, "underline" if k == ans else None) for k, t in opts]
        add_q(doc, f"Câu {i}", stem, styled)
        qs.append(q(i, f"Câu {i}", "single_choice", stem, opts, [ans],
                    "underline", f"Chỉ đáp án {ans} được gạch chân."))
    save_docx(doc, "f03-docx-underline.docx")
    write_expected("f03-docx-underline", "f03-docx-underline.docx", "docx", qs,
                   "Đáp án chỉ có bằng chứng gạch chân.")


# ---------------------------------------------------------------- f04: answer line
def f04():
    doc = new_doc()
    data = [
        ("Tổng của 15 và 27 là bao nhiêu?",
         [("A", "32"), ("B", "42"), ("C", "52"), ("D", "40")], "B"),
        ("Sông Hồng chảy qua thủ đô nào?",
         [("A", "Hà Nội"), ("B", "Huế"), ("C", "Đà Nẵng"), ("D", "Cần Thơ")], "A"),
        ("Tam giác có tổng ba góc trong bằng bao nhiêu độ?",
         [("A", "90"), ("B", "180"), ("C", "270"), ("D", "360")], "B"),
        ("Ngôn ngữ chính thức của Brazil là tiếng gì?",
         [("A", "Tây Ban Nha"), ("B", "Bồ Đào Nha"), ("C", "Pháp"), ("D", "Anh")], "B"),
    ]
    qs = []
    for i, (stem, opts, ans) in enumerate(data, 1):
        add_q(doc, f"Câu {i}", stem, [(k, t, None) for k, t in opts])
        add_answer_line(doc, ans)
        qs.append(q(i, f"Câu {i}", "single_choice", stem, opts, [ans],
                    "answer_line", f"Dòng 'Đáp án: {ans}' ở cuối câu."))
    save_docx(doc, "f04-docx-answer-line.docx")
    write_expected("f04-docx-answer-line", "f04-docx-answer-line.docx", "docx", qs,
                   "Đáp án nằm ở dòng cuối mỗi câu, không tô màu/in đậm/gạch chân.")


# ---------------------------------------------------------------- f05: answer table
def f05():
    doc = new_doc()
    data = [
        ("5 × 9 bằng bao nhiêu?",
         [("A", "40"), ("B", "45"), ("C", "54"), ("D", "35")], "B"),
        ("Thủ đô của Nhật Bản là thành phố nào?",
         [("A", "Seoul"), ("B", "Bắc Kinh"), ("C", "Tokyo"), ("D", "Bangkok")], "C"),
        ("Nước sôi ở nhiệt độ bao nhiêu trong điều kiện áp suất thường?",
         [("A", "90 độ C"), ("B", "95 độ C"), ("C", "100 độ C"), ("D", "110 độ C")], "C"),
        ("Ai vẽ bức Mona Lisa?",
         [("A", "Van Gogh"), ("B", "Picasso"), ("C", "Da Vinci"), ("D", "Monet")], "C"),
    ]
    qs = []
    for i, (stem, opts, ans) in enumerate(data, 1):
        add_q(doc, f"Câu {i}", stem, [(k, t, None) for k, t in opts])
        qs.append(q(i, f"Câu {i}", "single_choice", stem, opts, [ans],
                    "answer_table", f"Bảng đáp án cuối file: Câu {i} = {ans}."))
    doc.add_paragraph("BẢNG ĐÁP ÁN")
    table = doc.add_table(rows=0, cols=2)
    for i, (_, _, ans) in enumerate(data, 1):
        row = table.add_row().cells
        row[0].text = f"Câu {i}"
        row[1].text = ans
    save_docx(doc, "f05-docx-answer-table.docx")
    write_expected("f05-docx-answer-table", "f05-docx-answer-table.docx", "docx", qs,
                   "Đáp án chỉ nằm trong bảng cuối file, thân câu không có dấu hiệu.")


# ---------------------------------------------------------------- f06: true/false
def f06():
    doc = new_doc()
    data = [
        ("Trái Đất quay quanh Mặt Trời.", "Đúng"),
        ("Nước sôi ở 90 độ C trong điều kiện áp suất thường.", "Sai"),
        ("Âm thanh truyền được trong chân không.", "Sai"),
        ("Quang hợp xảy ra chủ yếu ở lá cây.", "Đúng"),
    ]
    qs = []
    for i, (stem, ans) in enumerate(data, 1):
        p = doc.add_paragraph()
        p.add_run(f"Câu {i}. {stem}")
        for label in ("Đúng", "Sai"):
            po = doc.add_paragraph()
            r = po.add_run(label)
            if label == ans:
                r.font.highlight_color = WD_COLOR_INDEX.YELLOW
        opts = [("A", "Đúng"), ("B", "Sai")]
        key = "A" if ans == "Đúng" else "B"
        qs.append(q(i, f"Câu {i}", "true_false", stem, opts, [key],
                    "highlight",
                    f"Phương án '{ans}' được tô vàng; map Đúng=A, Sai=B cho schema."))
    save_docx(doc, "f06-docx-true-false.docx")
    write_expected("f06-docx-true-false", "f06-docx-true-false.docx", "docx", qs,
                   "Dạng đúng/sai: mỗi câu là một mệnh đề, 2 lựa chọn Đúng/Sai. "
                   "Pipeline hiện tại chỉ biết A-D nên đây là gap đo được, "
                   "không phải lỗi fixture.")


# ---------------------------------------------------------------- f07: multi answer
def f07():
    doc = new_doc()
    data = [
        ("Những số nào sau đây là số chẵn?",
         [("A", "2"), ("B", "3"), ("C", "4"), ("D", "5")], ["A", "C"]),
        ("Những hành tinh nào sau đây là hành tinh đất đá?",
         [("A", "Sao Thủy"), ("B", "Sao Mộc"), ("C", "Sao Kim"), ("D", "Sao Thổ")],
         ["A", "C"]),
        ("Những chất nào sau đây tan trong nước?",
         [("A", "Muối ăn"), ("B", "Dầu ăn"), ("C", "Đường"), ("D", "Cát")],
         ["A", "C"]),
    ]
    qs = []
    for i, (stem, opts, ans) in enumerate(data, 1):
        styled = [(k, t, "highlight" if k in ans else None) for k, t in opts]
        add_q(doc, f"Câu {i}", stem, styled)
        qs.append(q(i, f"Câu {i}", "multiple_choice", stem, opts, ans,
                    "highlight", f"Hai đáp án {', '.join(ans)} cùng được tô vàng."))
    save_docx(doc, "f07-docx-multi-answer.docx")
    write_expected("f07-docx-multi-answer", "f07-docx-multi-answer.docx", "docx", qs,
                   "Dạng nhiều đáp án đúng; parser hiện tại có thể chỉ lấy 1.")


# ---------------------------------------------------------------- f08: image + formula
def f08():
    from PIL import Image, ImageDraw, ImageFont
    img_path = os.path.join(HERE, "_f08_diagram.png")
    img = Image.new("RGB", (600, 260), "white")
    dr = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype(FONT, 30)
    except OSError:
        font = ImageFont.load_default()
    dr.polygon([(100, 200), (300, 40), (500, 200)], outline="black", width=3)
    dr.text((250, 210), "Hình: tam giác ABC", fill="black", font=font)
    img.save(img_path)

    doc = new_doc()
    # Q1: kèm ảnh minh họa, đáp án tô vàng
    p = doc.add_paragraph()
    p.add_run("Câu 1. Nhìn hình, tam giác ABC có bao nhiêu cạnh?")
    doc.add_picture(img_path, width=Inches(3.0))
    opts1 = [("A", "2"), ("B", "3"), ("C", "4"), ("D", "5")]
    for k, t in opts1:
        po = doc.add_paragraph()
        r = po.add_run(f"{k}. {t}")
        if k == "B":
            r.font.highlight_color = WD_COLOR_INDEX.YELLOW
    # Q2: công thức OMML phân số trong stem, đáp án cuối câu
    p2 = doc.add_paragraph()
    p2.add_run("Câu 2. Tính giá trị của phân số ")
    add_omath_fraction(p2, "1", "2")
    p2.add_run(" cộng ")
    add_omath_fraction(p2, "1", "4")
    p2.add_run("?")
    for k, t in [("A", "1/4"), ("B", "1/2"), ("C", "3/4"), ("D", "1")]:
        doc.add_paragraph(f"{k}. {t}")
    add_answer_line(doc, "C")
    qs = [
        q(1, "Câu 1", "single_choice", "Nhìn hình, tam giác ABC có bao nhiêu cạnh?",
          opts1, ["B"], "highlight",
          "Đáp án B tô vàng; câu có ảnh đính kèm (tam giác ABC).",
          has_image=True),
        q(2, "Câu 2", "single_choice",
          "Tính giá trị của phân số $\\frac{1}{2}$ cộng $\\frac{1}{4}$?",
          [("A", "1/4"), ("B", "1/2"), ("C", "3/4"), ("D", "1")], ["C"],
          "answer_line",
          "Stem chứa 2 phân số OMML; đáp án ở dòng 'Đáp án: C' cuối câu."),
    ]
    save_docx(doc, "f08-docx-image-formula.docx")
    write_expected("f08-docx-image-formula", "f08-docx-image-formula.docx", "docx", qs,
                   "Câu 1 có ảnh đính kèm; câu 2 có công thức OMML (phân số). "
                   "Ảnh PNG tạm _f08_diagram.png chỉ là nguyên liệu sinh, "
                   "không phải fixture độc lập.")
    os.remove(img_path)


# ---------------------------------------------------------------- f09/f10/f15: PDF via PyMuPDF
def _pdf_text_page(page, lines, x0, fontname="F0", fontsize=13, leading=26,
                    y0=60):
    y = y0
    for text in lines:
        page.insert_text((x0, y), text, fontsize=fontsize,
                         fontname=fontname, fontfile=FONT)
        y += leading


def f09():
    import fitz
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    left = [
        "Câu 1. Thủ đô của Úc là thành phố nào?",
        "A. Sydney", "B. Canberra", "C. Melbourne", "D. Perth",
        "Đáp án: B", "",
        "Câu 2. 12 x 6 bằng bao nhiêu?",
        "A. 60", "B. 66", "C. 72", "D. 84",
        "Đáp án: C",
    ]
    right = [
        # Stem ngắn: cột phải chỉ rộng ~275pt, stem dài sẽ bị cắt ở mép trang.
        "Câu 3. Nguyên tố nào nhẹ nhất?",
        "A. Heli", "B. Hiđrô", "C. Oxi", "D. Nitơ",
        "Đáp án: B", "",
        "Câu 4. Một tá bằng bao nhiêu?",
        "A. 10", "B. 12", "C. 20", "D. 24",
        "Đáp án: B",
    ]
    _pdf_text_page(page, left, 40)
    _pdf_text_page(page, right, 320)
    doc.save(os.path.join(HERE, "f09-pdf-two-column.pdf"))
    qs = [
        q(1, "Câu 1", "single_choice", "Thủ đô của Úc là thành phố nào?",
          [("A", "Sydney"), ("B", "Canberra"), ("C", "Melbourne"), ("D", "Perth")],
          ["B"], "answer_line", "Cột trái, dòng 'Đáp án: B' cuối câu."),
        q(2, "Câu 2", "single_choice", "12 x 6 bằng bao nhiêu?",
          [("A", "60"), ("B", "66"), ("C", "72"), ("D", "84")],
          ["C"], "answer_line", "Cột trái, dòng 'Đáp án: C' cuối câu."),
        q(3, "Câu 3", "single_choice", "Nguyên tố nào nhẹ nhất?",
          [("A", "Heli"), ("B", "Hiđrô"), ("C", "Oxi"), ("D", "Nitơ")],
          ["B"], "answer_line", "Cột phải, dòng 'Đáp án: B' cuối câu."),
        q(4, "Câu 4", "single_choice", "Một tá bằng bao nhiêu?",
          [("A", "10"), ("B", "12"), ("C", "20"), ("D", "24")],
          ["B"], "answer_line", "Cột phải, dòng 'Đáp án: B' cuối câu."),
    ]
    write_expected("f09-pdf-two-column", "f09-pdf-two-column.pdf", "pdf", qs,
                   "PDF 1 trang, 2 cột: thứ tự đọc đúng là theo cột (1,2 rồi 3,4). "
                   "Parser hiện tại gom dòng theo tọa độ Y nên có thể trộn cột.")


def f10():
    import fitz
    from PIL import Image, ImageDraw, ImageFont
    img_path = os.path.join(HERE, "_f10_scan.png")
    img = Image.new("RGB", (1240, 1754), "white")
    dr = ImageDraw.Draw(img)
    try:
        font = ImageFont.truetype(FONT, 30)
    except OSError:
        font = ImageFont.load_default()
    lines = [
        "Câu 1. Thủ đô của Thái Lan là thành phố nào?",
        "A. Hà Nội    B. Bangkok    C. Jakarta    D. Manila",
        "Đáp án: B", "",
        "Câu 2. 9 + 6 bằng bao nhiêu?",
        "A. 13    B. 14    C. 15    D. 16",
        "Đáp án: C", "",
        "Câu 3. Nước nào sau đây nằm ở châu Phi?",
        "A. Ai Cập    B. Ấn Độ    C. Peru    D. Fiji",
        "Đáp án: A", "",
        "Câu 4. Một năm thường có bao nhiêu tháng?",
        "A. 10    B. 11    C. 12    D. 13",
        "Đáp án: C",
    ]
    y = 80
    for line in lines:
        dr.text((80, y), line, fill="black", font=font)
        y += 55
    img.save(img_path)
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    page.insert_image(page.rect, filename=img_path)
    doc.save(os.path.join(HERE, "f10-pdf-scan.pdf"))
    os.remove(img_path)
    qs = [
        q(1, "Câu 1", "single_choice", "Thủ đô của Thái Lan là thành phố nào?",
          [("A", "Hà Nội"), ("B", "Bangkok"), ("C", "Jakarta"), ("D", "Manila")],
          ["B"], "answer_line", "Chỉ có trong ảnh scan, không có text layer."),
        q(2, "Câu 2", "single_choice", "9 + 6 bằng bao nhiêu?",
          [("A", "13"), ("B", "14"), ("C", "15"), ("D", "16")],
          ["C"], "answer_line", "Chỉ có trong ảnh scan, không có text layer."),
        q(3, "Câu 3", "single_choice", "Nước nào sau đây nằm ở châu Phi?",
          [("A", "Ai Cập"), ("B", "Ấn Độ"), ("C", "Peru"), ("D", "Fiji")],
          ["A"], "answer_line", "Chỉ có trong ảnh scan, không có text layer."),
        q(4, "Câu 4", "single_choice", "Một năm thường có bao nhiêu tháng?",
          [("A", "10"), ("B", "11"), ("C", "12"), ("D", "13")],
          ["C"], "answer_line", "Chỉ có trong ảnh scan, không có text layer."),
    ]
    write_expected("f10-pdf-scan", "f10-pdf-scan.pdf", "pdf", qs,
                   "PDF chỉ có ảnh (không text layer): parser hiện tại không có OCR "
                   "nên kỳ vọng đo được gap này (0 câu), không phải lỗi fixture.")


def f15():
    import fitz
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    lines = [
        "Câu 1. Thủ đô của Hàn Quốc là thành phố nào?",
        "A. Busan", "B. Seoul", "C. Incheon", "D. Daegu",
        "Đáp án: B", "",
        "Câu 2. 3 mũ 2 bằng bao nhiêu?",
        "A. 6", "B. 9", "C. 12", "D. 3",
        "Đáp án: B", "",
        "Câu 3. Loài vật nào sau đây là động vật có vú?",
        "A. Cá mập", "B. Cá heo", "C. Cá sấu", "D. Ếch",
        "Đáp án: B", "",
        "Câu 4. Một tuần có bao nhiêu ngày?",
        "A. 5", "B. 6", "C. 7", "D. 8",
        "Đáp án: C",
    ]
    _pdf_text_page(page, lines, 40)
    doc.save(os.path.join(HERE, "f15-pdf-text.pdf"))
    qs = [
        q(1, "Câu 1", "single_choice", "Thủ đô của Hàn Quốc là thành phố nào?",
          [("A", "Busan"), ("B", "Seoul"), ("C", "Incheon"), ("D", "Daegu")],
          ["B"], "answer_line", "PDF text layer 1 cột, dòng 'Đáp án: B'."),
        q(2, "Câu 2", "single_choice", "3 mũ 2 bằng bao nhiêu?",
          [("A", "6"), ("B", "9"), ("C", "12"), ("D", "3")],
          ["B"], "answer_line", "PDF text layer 1 cột, dòng 'Đáp án: B'."),
        q(3, "Câu 3", "single_choice", "Loài vật nào sau đây là động vật có vú?",
          [("A", "Cá mập"), ("B", "Cá heo"), ("C", "Cá sấu"), ("D", "Ếch")],
          ["B"], "answer_line", "PDF text layer 1 cột, dòng 'Đáp án: B'."),
        q(4, "Câu 4", "single_choice", "Một tuần có bao nhiêu ngày?",
          [("A", "5"), ("B", "6"), ("C", "7"), ("D", "8")],
          ["C"], "answer_line", "PDF text layer 1 cột, dòng 'Đáp án: C'."),
    ]
    write_expected("f15-pdf-text", "f15-pdf-text.pdf", "pdf", qs,
                   "PDF text layer 1 cột, trường hợp PDF cơ bản kỳ vọng parser làm được.")


# ---------------------------------------------------------------- f11: repeated header
def f11():
    doc = new_doc()
    header = "ĐỀ ÔN TẬP — MÔN KHOA HỌC TỰ NHIÊN"
    data = [
        ("Lực nào giữ các hành tinh quay quanh Mặt Trời?",
         [("A", "Lực ma sát"), ("B", "Lực hấp dẫn"), ("C", "Lực đẩy"), ("D", "Lực kéo")],
         "B"),
        ("Đơn vị đo cường độ dòng điện là gì?",
         [("A", "Vôn"), ("B", "Oát"), ("C", "Ampe"), ("D", "Ôm")], "C"),
        ("Quá trình cây xanh tạo ra oxi gọi là gì?",
         [("A", "Hô hấp"), ("B", "Quang hợp"), ("C", "Thoát hơi nước"), ("D", "Thụ phấn")],
         "B"),
        ("Nhiệt độ sôi của nước ở áp suất thường là bao nhiêu?",
         [("A", "80 độ C"), ("B", "90 độ C"), ("C", "100 độ C"), ("D", "120 độ C")],
         "C"),
    ]
    qs = []
    for i, (stem, opts, ans) in enumerate(data, 1):
        doc.add_paragraph(header)
        styled = [(k, t, "highlight" if k == ans else None) for k, t in opts]
        add_q(doc, f"Câu {i}", stem, styled)
        qs.append(q(i, f"Câu {i}", "single_choice", stem, opts, [ans],
                    "highlight",
                    f"Đáp án {ans} tô vàng; dòng header lặp đứng trước mỗi câu."))
    save_docx(doc, "f11-docx-repeated-header.docx")
    write_expected("f11-docx-repeated-header", "f11-docx-repeated-header.docx",
                   "docx", qs,
                   "Header lặp giữa các câu: parser phải bỏ qua, không trộn "
                   "header vào stem/option của câu trước.")


# ---------------------------------------------------------------- f12: non-continuous numbers
def f12():
    doc = new_doc()
    data = [
        ("Câu 2", "Số nào sau đây chia hết cho 3?",
         [("A", "10"), ("B", "11"), ("C", "12"), ("D", "14")], "C"),
        ("Câu 5", "Thủ đô của Lào là thành phố nào?",
         [("A", "Viêng Chăn"), ("B", "Phnom Penh"), ("C", "Yangon"), ("D", "Bangkok")],
         "A"),
        ("Câu 9", "Âm 'a' trong tiếng Việt là nguyên âm hay phụ âm?",
         [("A", "Phụ âm"), ("B", "Nguyên âm"), ("C", "Thanh điệu"), ("D", "Dấu câu")],
         "B"),
        ("Câu 14", "Một hình vuông có cạnh 5 cm thì chu vi bằng bao nhiêu?",
         [("A", "10 cm"), ("B", "15 cm"), ("C", "20 cm"), ("D", "25 cm")], "C"),
    ]
    qs = []
    for i, (label, stem, opts, ans) in enumerate(data, 1):
        styled = [(k, t, "highlight" if k == ans else None) for k, t in opts]
        add_q(doc, label, stem, styled)
        qs.append(q(i, label, "single_choice", stem, opts, [ans],
                    "highlight",
                    f"Nhãn gốc {label} (thứ tự xuất hiện {i}); đáp án {ans} tô vàng."))
    save_docx(doc, "f12-docx-noncontinuous.docx")
    write_expected("f12-docx-noncontinuous", "f12-docx-noncontinuous.docx",
                   "docx", qs,
                   "Số câu không liên tục (2, 5, 9, 14): ground truth giữ cả "
                   "label gốc và order theo thứ tự xuất hiện; runner so theo order.")


# ---------------------------------------------------------------- f13: docx, no evidence
def f13():
    doc = new_doc()
    data = [
        ("Thủ đô của Canada là thành phố nào?",
         [("A", "Toronto"), ("B", "Vancouver"), ("C", "Ottawa"), ("D", "Montreal")]),
        ("9 × 7 bằng bao nhiêu?",
         [("A", "56"), ("B", "63"), ("C", "72"), ("D", "81")]),
        ("Đại dương nhỏ nhất là đại dương nào?",
         [("A", "Ấn Độ Dương"), ("B", "Bắc Băng Dương"), ("C", "Đại Tây Dương"),
          ("D", "Nam Đại Dương")]),
    ]
    qs = []
    for i, (stem, opts) in enumerate(data, 1):
        add_q(doc, f"Câu {i}", stem, [(k, t, None) for k, t in opts])
        qs.append(q(i, f"Câu {i}", "single_choice", stem, opts, [],
                    "none", "Không có dấu hiệu đáp án nào trong nguồn."))
    save_docx(doc, "f13-docx-no-answer.docx")
    write_expected("f13-docx-no-answer", "f13-docx-no-answer.docx", "docx", qs,
                   "Trường hợp không đáp án: kỳ vọng correctAnswers=[] "
                   "(cấm fallback ['A'] — bước 04 của PLAN_MAIN).")


# ---------------------------------------------------------------- f14: txt, no evidence
def f14():
    lines = [
        "Câu 1. Năm nhuận có bao nhiêu ngày?",
        "A. 365", "B. 366", "C. 364", "D. 360", "",
        "Câu 2. Người đầu tiên bay vào vũ trụ là ai?",
        "A. Neil Armstrong", "B. Yuri Gagarin", "C. Buzz Aldrin",
        "D. Valentina Tereshkova", "",
        "Câu 3. Số liền sau của 99 là bao nhiêu?",
        "A. 98", "B. 100", "C. 101", "D. 90",
    ]
    with open(os.path.join(HERE, "f14-txt-plain.txt"), "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")
    qs = [
        q(1, "Câu 1", "single_choice", "Năm nhuận có bao nhiêu ngày?",
          [("A", "365"), ("B", "366"), ("C", "364"), ("D", "360")], [],
          "none", "Text thuần, không dấu hiệu đáp án."),
        q(2, "Câu 2", "single_choice", "Người đầu tiên bay vào vũ trụ là ai?",
          [("A", "Neil Armstrong"), ("B", "Yuri Gagarin"), ("C", "Buzz Aldrin"),
           ("D", "Valentina Tereshkova")], [],
          "none", "Text thuần, không dấu hiệu đáp án."),
        q(3, "Câu 3", "single_choice", "Số liền sau của 99 là bao nhiêu?",
          [("A", "98"), ("B", "100"), ("C", "101"), ("D", "90")], [],
          "none", "Text thuần, không dấu hiệu đáp án."),
    ]
    write_expected("f14-txt-plain", "f14-txt-plain.txt", "txt", qs,
                   "Text thuần không đáp án: kỳ vọng correctAnswers=[].")


# ---------------------------------------------------------------- f16: shared premise
def add_q_split(doc, label, premise, question, options):
    """Câu có tiền đề chung là đoạn riêng: đoạn 'Câu N.' đứng một mình,
    rồi đoạn tiền đề, rồi đoạn câu hỏi, rồi các lựa chọn. Tiền đề lặp
    nguyên văn ở đầu thân của nhiều câu — đúng trường hợp heuristic strip
    header lặp bước 13 có nguy cơ strip nhầm (ghi chú bước 13)."""
    doc.add_paragraph(f"{label}.")
    doc.add_paragraph(premise)
    doc.add_paragraph(question)
    for key, text, style in options:
        po = doc.add_paragraph()
        r = po.add_run(f"{key}. {text}")
        if style == "highlight":
            r.font.highlight_color = WD_COLOR_INDEX.YELLOW
        elif style == "bold":
            r.bold = True
        elif style == "underline":
            r.underline = True


def f16():
    doc = new_doc()
    premise = "Một hình chữ nhật có chiều dài 12 cm và chiều rộng 8 cm."
    data = [
        ("Chu vi của hình chữ nhật là bao nhiêu?",
         [("A", "20 cm"), ("B", "40 cm"), ("C", "32 cm"), ("D", "48 cm")], "B"),
        ("Diện tích của hình chữ nhật là bao nhiêu?",
         [("A", "96 cm vuông"), ("B", "20 cm vuông"), ("C", "32 cm vuông"),
          ("D", "48 cm vuông")], "A"),
        ("Chiều dài hơn chiều rộng bao nhiêu xăng-ti-mét?",
         [("A", "2"), ("B", "4"), ("C", "6"), ("D", "8")], "B"),
    ]
    qs = []
    for i, (question, opts, ans) in enumerate(data, 1):
        styled = [(k, t, "highlight" if k == ans else None) for k, t in opts]
        add_q_split(doc, f"Câu {i}", premise, question, styled)
        qs.append(q(i, f"Câu {i}", "single_choice", premise + " " + question,
                    opts, [ans], "highlight",
                    f"Đáp án {ans} tô vàng; tiền đề chung lặp ở đầu thân câu."))
    save_docx(doc, "f16-docx-shared-premise.docx")
    write_expected("f16-docx-shared-premise", "f16-docx-shared-premise.docx",
                   "docx", qs,
                   "Nhóm câu dùng chung dữ kiện: tiền đề là đoạn riêng lặp "
                   "nguyên văn ở đầu thân 3 câu — stem kỳ vọng GIỮ tiền đề. "
                   "Nếu heuristic strip header lặp xóa tiền đề thì fixture "
                   "này lệch stem cả 3 câu (hồi quy bước 13 đã cảnh báo).")


# ---------------------------------------------------------------- f17: table in stem
def add_q_table(doc, label, intro, table, question, options):
    p = doc.add_paragraph()
    p.add_run(f"{label}. {intro}")
    t = doc.add_table(rows=0, cols=len(table[0]))
    for row in table:
        cells = t.add_row().cells
        for j, val in enumerate(row):
            cells[j].text = val
    doc.add_paragraph(question)
    for key, text, style in options:
        po = doc.add_paragraph()
        r = po.add_run(f"{key}. {text}")
        if style == "highlight":
            r.font.highlight_color = WD_COLOR_INDEX.YELLOW
        elif style == "bold":
            r.bold = True
        elif style == "underline":
            r.underline = True


def f17():
    doc = new_doc()
    data = [
        ("Bảng sau ghi số sản phẩm bán được trong ba tháng đầu năm.",
         [["Tháng", "Số sản phẩm"], ["Tháng 1", "120"], ["Tháng 2", "150"],
          ["Tháng 3", "90"]],
         "Tháng nào bán được nhiều sản phẩm nhất?",
         [("A", "Tháng 1"), ("B", "Tháng 2"), ("C", "Tháng 3"), ("D", "Tháng 4")],
         "B"),
        ("Bảng sau ghi điểm kiểm tra của ba bạn.",
         [["Bạn", "Điểm"], ["An", "8"], ["Bình", "9"], ["Chi", "7"]],
         "Bạn nào có điểm kiểm tra cao nhất?",
         [("A", "An"), ("B", "Bình"), ("C", "Chi"), ("D", "Dũng")], "B"),
        ("Bảng sau ghi số tiết học mỗi tuần của ba môn học.",
         [["Môn học", "Số tiết"], ["Toán", "4"], ["Văn", "3"], ["Tiếng Anh", "3"]],
         "Môn học nào có số tiết nhiều nhất trong một tuần?",
         [("A", "Toán"), ("B", "Văn"), ("C", "Tiếng Anh"), ("D", "Lịch sử")],
         "A"),
    ]
    qs = []
    for i, (intro, table, question, opts, ans) in enumerate(data, 1):
        styled = [(k, t, "highlight" if k == ans else None) for k, t in opts]
        add_q_table(doc, f"Câu {i}", intro, table, question, styled)
        stem = intro + " " + " ".join(
            " ".join(row) for row in table) + " " + question
        qs.append(q(i, f"Câu {i}", "single_choice", stem, opts, [ans],
                    "highlight",
                    f"Đáp án {ans} tô vàng; thân câu chứa bảng dữ liệu."))
    save_docx(doc, "f17-docx-table-in-stem.docx")
    write_expected("f17-docx-table-in-stem", "f17-docx-table-in-stem.docx",
                   "docx", qs,
                   "Bảng dữ liệu nằm TRONG thân câu (không phải bảng đáp "
                   "án cuối file): parser phải giữ nội dung bảng trong stem "
                   "và không nhận nhầm bảng này thành bảng đáp án.")


# ---------------------------------------------------------------- f18: long multi-paragraph stem
def add_q_multi(doc, label, paras, options, answer_key=None):
    p = doc.add_paragraph()
    p.add_run(f"{label}. {paras[0]}")
    for para in paras[1:]:
        doc.add_paragraph(para)
    for key, text, style in options:
        po = doc.add_paragraph()
        r = po.add_run(f"{key}. {text}")
        if style == "highlight":
            r.font.highlight_color = WD_COLOR_INDEX.YELLOW
        elif style == "bold":
            r.bold = True
        elif style == "underline":
            r.underline = True
    if answer_key:
        add_answer_line(doc, answer_key)


def f18():
    doc = new_doc()
    data = [
        (["Một người đi xe đạp từ nhà đến trường với vận tốc 12 km mỗi giờ.",
          "Quãng đường từ nhà đến trường dài 6 km.",
          "Hỏi người đó đi hết bao nhiêu phút để đến trường?"],
         [("A", "20 phút"), ("B", "30 phút"), ("C", "40 phút"), ("D", "60 phút")],
         "B"),
        (["Cho hai số tự nhiên a và b.",
          "Biết a lớn hơn b 5 đơn vị và tổng của hai số bằng 25.",
          "Hỏi số bé trong hai số đó bằng bao nhiêu?"],
         [("A", "8"), ("B", "10"), ("C", "12"), ("D", "15")], "B"),
        (["Một lớp học có 40 học sinh.",
          "Trong đó số học sinh nữ chiếm một nửa số học sinh của lớp.",
          "Hỏi lớp học có bao nhiêu học sinh nam?"],
         [("A", "10"), ("B", "20"), ("C", "25"), ("D", "30")], "B"),
    ]
    qs = []
    for i, (paras, opts, ans) in enumerate(data, 1):
        add_q_multi(doc, f"Câu {i}", paras,
                    [(k, t, None) for k, t in opts], ans)
        qs.append(q(i, f"Câu {i}", "single_choice", " ".join(paras), opts,
                    [ans], "answer_line",
                    f"Dòng 'Đáp án: {ans}' cuối câu; stem dài 3 đoạn."))
    save_docx(doc, "f18-docx-long-stem.docx")
    write_expected("f18-docx-long-stem", "f18-docx-long-stem.docx", "docx", qs,
                   "Stem dài nhiều đoạn văn: parser phải nối đủ các đoạn "
                   "trước lựa chọn đầu tiên thành stem, không cắt mất đoạn.")


# ---------------------------------------------------------------- f19: LaTeX / special / bilingual
def f19():
    doc = new_doc()
    data = [
        ("Giải phương trình x^2 + 2x + 1 = 0, nghiệm của phương trình là bao nhiêu?",
         [("A", "x = 1"), ("B", "x = -1"), ("C", "x = 0"), ("D", "x = 2")], "B"),
        ("Nhiệt độ sôi của nước là 100 ℃, nhiệt độ đóng băng là 0 ℃. Hỏi chênh lệch nhiệt độ giữa hai mốc này là bao nhiêu độ?",
         [("A", "90 độ"), ("B", "100 độ"), ("C", "110 độ"), ("D", "0 độ")], "B"),
        ("Cho a ≥ 5 và b ≤ 3. Hỏi khẳng định nào sau đây có thể sai?",
         [("A", "a > b"), ("B", "a ≥ b"), ("C", "a = b"), ("D", "a ≠ b")], "C"),
        ("What is the capital of Japan? (Thủ đô của Nhật Bản là thành phố nào?)",
         [("A", "Seoul"), ("B", "Tokyo"), ("C", "Bangkok"), ("D", "Beijing")], "B"),
    ]
    qs = []
    for i, (stem, opts, ans) in enumerate(data, 1):
        styled = [(k, t, "highlight" if k == ans else None) for k, t in opts]
        add_q(doc, f"Câu {i}", stem, styled)
        qs.append(q(i, f"Câu {i}", "single_choice", stem, opts, [ans],
                    "highlight", f"Đáp án {ans} tô vàng."))
    save_docx(doc, "f19-docx-latex-special.docx")
    write_expected("f19-docx-latex-special", "f19-docx-latex-special.docx",
                   "docx", qs,
                   "Ký tự đặc biệt dạng text thuần (x^2, ℃, ≥, ≤, ≠) và câu "
                   "song ngữ Anh–Việt: parser phải giữ nguyên ký tự, không "
                   "mất dấu hay cắt stem ở ký tự lạ.")


# ---------------------------------------------------------------- f20: sections
def f20():
    from docx.enum.section import WD_SECTION
    doc = new_doc()
    s0 = doc.sections[0]
    s0.header.is_linked_to_previous = False
    s0.header.paragraphs[0].text = "ĐỀ SỐ 1 — PHẦN A"
    s0.footer.is_linked_to_previous = False
    s0.footer.paragraphs[0].text = "Trang 1"
    data1 = [
        ("Sông dài nhất Việt Nam là sông nào?",
         [("A", "Sông Hồng"), ("B", "Sông Cửu Long"), ("C", "Sông Đồng Nai"),
          ("D", "Sông Mã")], "B"),
        ("Tỉnh nào có diện tích lớn nhất Việt Nam?",
         [("A", "Nghệ An"), ("B", "Gia Lai"), ("C", "Sơn La"), ("D", "Thanh Hóa")],
         "A"),
    ]
    qs = []
    for i, (stem, opts, ans) in enumerate(data1, 1):
        styled = [(k, t, "highlight" if k == ans else None) for k, t in opts]
        add_q(doc, f"Câu {i}", stem, styled)
        qs.append(q(i, f"Câu {i}", "single_choice", stem, opts, [ans],
                    "highlight", f"Đáp án {ans} tô vàng; thuộc section 1."))
    s1 = doc.add_section(WD_SECTION.NEW_PAGE)
    s1.header.is_linked_to_previous = False
    s1.header.paragraphs[0].text = "ĐỀ SỐ 1 — PHẦN B"
    s1.footer.is_linked_to_previous = False
    s1.footer.paragraphs[0].text = "Trang 2"
    data2 = [
        ("Đơn vị đo khối lượng trong hệ SI là gì?",
         [("A", "Gam"), ("B", "Kilôgam"), ("C", "Tấn"), ("D", "Tạ")], "B"),
        ("Tốc độ ánh sáng trong chân không xấp xỉ bao nhiêu?",
         [("A", "300 km/giây"), ("B", "3000 km/giây"), ("C", "300000 km/giây"),
          ("D", "30000 km/giây")], "C"),
    ]
    for j, (stem, opts, ans) in enumerate(data2, 3):
        styled = [(k, t, "highlight" if k == ans else None) for k, t in opts]
        add_q(doc, f"Câu {j}", stem, styled)
        qs.append(q(j, f"Câu {j}", "single_choice", stem, opts, [ans],
                    "highlight", f"Đáp án {ans} tô vàng; thuộc section 2."))
    save_docx(doc, "f20-docx-sections.docx")
    write_expected("f20-docx-sections", "f20-docx-sections.docx", "docx", qs,
                   "DOCX 2 section với header/footer khác nhau: header/footer "
                   "nằm ở part riêng, parser chỉ đọc body nên không được để "
                   "chúng lọt vào stem hay option.")


# ---------------------------------------------------------------- f21/f22: PDF
def f21():
    import fitz
    doc = fitz.open()
    page = doc.new_page(width=595, height=842)
    title = "ĐỀ KIỂM TRA TRẮC NGHIỆM — MÔN KHOA HỌC TỰ NHIÊN — PHẦN 1"
    page.insert_text((40, 40), title, fontsize=13, fontname="F0",
                     fontfile=FONT)
    left = [
        "Câu 1. Thủ đô của nước Úc là thành phố nào?",
        "A. Sydney", "B. Canberra", "C. Melbourne", "D. Perth",
        "Đáp án: B", "",
        "Câu 2. 12 nhân với 8 bằng bao nhiêu?",
        "A. 84", "B. 96", "C. 108", "D. 72",
        "Đáp án: B",
    ]
    right = [
        "Câu 3. Số nào là số nguyên tố?",
        "A. 4", "B. 6", "C. 7", "D. 9",
        "Đáp án: C", "",
        "Câu 4. Một tá bằng bao nhiêu?",
        "A. 10", "B. 12", "C. 20", "D. 24",
        "Đáp án: B",
    ]
    _pdf_text_page(page, left, 40, y0=80)
    _pdf_text_page(page, right, 360, y0=80)
    doc.save(os.path.join(HERE, "f21-pdf-uneven-columns.pdf"))
    qs = [
        q(1, "Câu 1", "single_choice", "Thủ đô của nước Úc là thành phố nào?",
          [("A", "Sydney"), ("B", "Canberra"), ("C", "Melbourne"), ("D", "Perth")],
          ["B"], "answer_line", "Cột trái (rộng), dòng 'Đáp án: B'."),
        q(2, "Câu 2", "single_choice", "12 nhân với 8 bằng bao nhiêu?",
          [("A", "84"), ("B", "96"), ("C", "108"), ("D", "72")],
          ["B"], "answer_line", "Cột trái (rộng), dòng 'Đáp án: B'."),
        q(3, "Câu 3", "single_choice", "Số nào là số nguyên tố?",
          [("A", "4"), ("B", "6"), ("C", "7"), ("D", "9")],
          ["C"], "answer_line", "Cột phải (hẹp), dòng 'Đáp án: C'."),
        q(4, "Câu 4", "single_choice", "Một tá bằng bao nhiêu?",
          [("A", "10"), ("B", "12"), ("C", "20"), ("D", "24")],
          ["B"], "answer_line", "Cột phải (hẹp), dòng 'Đáp án: B'."),
    ]
    write_expected("f21-pdf-uneven-columns", "f21-pdf-uneven-columns.pdf",
                   "pdf", qs,
                   "PDF 1 trang, 2 cột KHÔNG đều (trái x=40 rộng, phải x=360 "
                   "hẹp) + tiêu đề dài toàn chiều rộng ở đầu trang: thứ tự "
                   "đọc đúng là theo cột (1,2 rồi 3,4), tiêu đề đứng trước.")


def f22():
    import fitz
    doc = fitz.open()
    p1 = doc.new_page(width=595, height=842)
    _pdf_text_page(p1, [
        "Câu 1. Thành phố nào là thủ đô của Hàn Quốc?",
        "A. Busan", "B. Seoul", "C. Incheon", "D. Daegu",
        "Đáp án: B", "",
        "Câu 2. 5 mũ 2 bằng bao nhiêu?",
        "A. 10", "B. 25", "C. 15", "D. 20",
        "Đáp án: B",
    ], 40)
    p2 = doc.new_page(width=595, height=842)
    _pdf_text_page(p2, [
        "Câu 3. Con vật nào sau đây đẻ con và nuôi con bằng sữa?",
        "A. Cá mập", "B. Cá heo", "C. Rùa", "D. Ếch",
        "Đáp án: B", "",
        "Câu 4. Một tháng thường có khoảng bao nhiêu ngày?",
        "A. 7", "B. 14", "C. 30", "D. 365",
        "Đáp án: C",
    ], 40)
    doc.save(os.path.join(HERE, "f22-pdf-two-pages.pdf"))
    qs = [
        q(1, "Câu 1", "single_choice", "Thành phố nào là thủ đô của Hàn Quốc?",
          [("A", "Busan"), ("B", "Seoul"), ("C", "Incheon"), ("D", "Daegu")],
          ["B"], "answer_line", "Trang 1.", page=1),
        q(2, "Câu 2", "single_choice", "5 mũ 2 bằng bao nhiêu?",
          [("A", "10"), ("B", "25"), ("C", "15"), ("D", "20")],
          ["B"], "answer_line", "Trang 1.", page=1),
        q(3, "Câu 3", "single_choice",
          "Con vật nào sau đây đẻ con và nuôi con bằng sữa?",
          [("A", "Cá mập"), ("B", "Cá heo"), ("C", "Rùa"), ("D", "Ếch")],
          ["B"], "answer_line", "Trang 2.", page=2),
        q(4, "Câu 4", "single_choice",
          "Một tháng thường có khoảng bao nhiêu ngày?",
          [("A", "7"), ("B", "14"), ("C", "30"), ("D", "365")],
          ["C"], "answer_line", "Trang 2.", page=2),
    ]
    write_expected("f22-pdf-two-pages", "f22-pdf-two-pages.pdf", "pdf", qs,
                   "PDF 2 trang, mỗi trang 2 câu: kiểm tra gắn page đúng "
                   "trang cho câu ở trang 2 (không dồn hết về trang 1).")


# ---------------------------------------------------------------- main
def main():
    for fn in (f01, f02, f03, f04, f05, f06, f07, f08, f09, f10, f11, f12,
               f13, f14, f15, f16, f17, f18, f19, f20, f21, f22):
        fn()
        print("ok", fn.__name__)


if __name__ == "__main__":
    main()
