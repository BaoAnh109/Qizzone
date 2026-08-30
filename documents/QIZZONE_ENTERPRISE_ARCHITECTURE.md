# TÀI LIỆU ĐỀ XUẤT KIẾN TRÚC & KẾ HOẠCH CÔNG NGHỆ DỰ ÁN QIZZONE
> **Nền Tảng Tạo Đề & Thi Trắc Nghiệm Trực Tuyến Thế Hệ Mới Hỗ Trợ AI**  
> *Định hướng: Chuẩn Doanh Nghiệp (Enterprise-Grade) - Dễ bảo trì, nâng cấp trong tương lai*

---

## 1. TỔNG QUAN DỰ ÁN & MỤC TIÊU TRIỂN KHAI (EXECUTIVE SUMMARY)

### 1.1. Bối cảnh & Tầm nhìn
**Qizzone** là nền tảng công nghệ giáo dục (EdTech SaaS) hỗ trợ giáo viên, giảng viên và tổ chức giáo dục tạo, quản lý và tổ chức các kỳ thi trực tuyến từ các tệp tài liệu có sẵn (Word `.docx`, PDF, hình ảnh đề thi). Mô hình hoạt động tương tự như **Azota**, nhưng được tối ưu hóa toàn diện về:
- **Trải nghiệm người dùng (Modern UI/UX):** Tối ưu hóa tốc độ, giao diện trực quan, hỗ trợ tốt trên mọi thiết bị (Desktop, Tablet, Mobile).
- **Hỗ trợ công thức khoa học (LaTeX/MathJax):** Xử lý mượt mà đề thi Toán, Lý, Hóa, Sinh có công thức phức tạp và hình ảnh minh họa.
- **Tự động hóa thông minh (AI-Powered Question Extraction):** Bóc tách đề thi tự động từ file thô với độ chính xác cao bằng mô hình kết hợp (Hybrid Rule-based + Multimodal OCR + LLM).
- **Kiến trúc Vercel-Ready:** Dễ dàng triển khai (1-Click Deploy) lên **Vercel**, tận dụng mạng lưới Edge Network toàn cầu, chi phí khởi tạo 0đ, tự động scale khi có lượng lớn học sinh làm bài cùng lúc.

```mermaid
graph TD
    A[Giáo viên tải lên File Đề thi<br/>Word / PDF / Ảnh] --> B[AI & Parser Engine<br/>Vercel AI SDK + Gemini Flash]
    B --> C[Bóc tách Câu hỏi, Đáp án,<br/>Công thức LaTeX, Hình ảnh]
    C --> D[Giao diện Trình sửa đề Split-View<br/>React 19 + Tailwind CSS]
    D --> E[Lưu trữ Đề thi vào Serverless Database<br/>Neon Postgres / Supabase]
    E --> F[Học sinh nhận Link / Mã đề]
    F --> G[Giao diện Làm bài Thi Trực tuyến<br/>Anti-cheat, Auto-save trên Vercel Edge]
    G --> H[Chấm điểm Tự động & Báo cáo Phổ điểm]
```

---

## 2. PHÂN TÍCH YÊU CẦU NGHIỆP VỤ (BUSINESS CAPABILITIES)

### 2.1. Phân hệ Giáo viên / Quản trị viên (Teacher & Admin Portal)
1. **Quản lý Đề thi (Exam Management):**
   - Tải file đề thi lên hệ thống (hỗ trợ kéo thả đa định dạng: `.docx`, `.pdf`, `.png`, `.jpg`).
   - Trình chỉnh sửa đề thi thông minh (WYSIWYG Editor hỗ trợ công thức toán KaTeX, chèn ảnh, bảng biểu).
   - Tùy chọn cấu hình thi: Đảo câu hỏi, đảo đáp án, hẹn giờ làm bài, giới hạn số lần làm, mật khẩu phòng thi, phân quyền theo lớp.
2. **Quản lý Lớp học & Học sinh (Classroom & Students):**
   - Quản lý danh sách lớp, import danh sách học sinh qua Excel.
   - Giao bài tập / bài thi theo lớp, nhóm hoặc cá nhân.
3. **Chấm thi & Thống kê (Grading & Analytics):**
   - Tự động chấm điểm trắc nghiệm tức thì ngay khi học sinh nộp bài.
   - Hỗ trợ chấm tự luận bằng tay hoặc gợi ý điểm bằng AI.
   - Báo cáo phổ điểm, thống kê tỉ lệ đúng/sai theo từng câu để giáo viên nắm được lỗ hổng kiến thức của học sinh.

### 2.2. Phân hệ Học sinh (Student Portal)
1. **Làm bài thi (Exam Taking Experience):**
   - Vào thi nhanh bằng mã QR / Link / Mã phòng thi mà không bắt buộc tạo tài khoản phức tạp.
   - Cơ chế tự động lưu câu trả lời (Auto-save) phòng ngừa mất kết nối mạng.
   - Giám sát gian lận cơ bản & nâng cao (Phát hiện chuyển tab, cảnh báo rời màn hình, chặn chuột phải/copy).
2. **Xem kết quả & Lời giải (Review & Feedback):**
   - Xem điểm số, đáp án đúng/sai, lời giải chi tiết và hướng dẫn giải (tùy cấu hình giáo viên cho phép).

---

## 3. LỰA CHỌN CÔNG NGHỆ TỐI ƯU CHO VERCEL (TECH STACK JUSTIFICATION)

Để đảm bảo vừa đạt tiêu chuẩn doanh nghiệp, vừa **dễ dàng deploy lên Vercel** với hiệu năng cao nhất và chi phí tối ưu, kiến trúc công nghệ được tuyển chọn như sau:

```mermaid
flowchart LR
    subgraph Vercel_Platform [Triển khai toàn diện trên Vercel Ecosystem]
        UI[React 19 + TypeScript + Vite<br/>Vercel Global Edge CDN]
        Serverless[Vercel Serverless / Edge Functions<br/>API Routes / Hono / Express]
        AISDK[Vercel AI SDK<br/>Google Gemini 1.5 Flash API]
        BlobStore[Vercel Blob / Cloudflare R2<br/>Lưu trữ File & Ảnh câu hỏi]
    end

    subgraph Serverless_Database [Cơ sở Dữ liệu Serverless Tối ưu]
        NeonDB[(Neon Serverless PostgreSQL<br/>Connection Pooling + Prisma)]
        UpstashRedis[(Upstash Redis Serverless<br/>Rate limit & Session Cache)]
    end

    UI <-->|HTTPS / REST API| Serverless
    Serverless <--> AISDK
    Serverless <--> BlobStore
    Serverless <--> NeonDB
    Serverless <--> UpstashRedis
```

### 3.1. Frontend: React 19 + TypeScript + Vite (Trọng tâm)
* **Lý do chọn React trên Vercel:**
  - **Tối ưu tốc độ tải trang:** Vercel tự động phân phối các asset tĩnh của React/Vite qua mạng lưới Edge Network toàn cầu với độ trễ thấp (< 50ms).
  - **Hệ sinh thái EdTech mạnh nhất:** Các thư viện render toán học (`katex`, `better-react-mathjax`), canvas vẽ hình, trình soạn thảo text phong phú (`tiptap`, `lexical`, `prosemirror`) đều hỗ trợ tốt nhất trên React.
  - **Virtual DOM & React 19 tối ưu hóa hiệu năng:** Xử lý hiển thị đề thi lớn (hàng trăm câu hỏi kèm đồ thị/hình vẽ) mượt mà với kỹ thuật Virtual Scrolling (`@tanstack/react-virtual`).
  - **Tái sử dụng code sang Mobile:** Có thể chuyển đổi các module nghiệp vụ sang **React Native** (iOS/Android App) trong các phase tương lai mà không cần viết lại logic.

* **Bộ công cụ Frontend bổ trợ:**
  | Thành phần | Công nghệ lựa chọn | Lý do sử dụng |
  | :--- | :--- | :--- |
  | **Build Tool** | Vite 6+ | Tốc độ build siêu nhanh, tích hợp sẵn trên Vercel. |
  | **UI & Styling** | Tailwind CSS v4 + Radix UI / Lucide Icons | Giao diện hiện đại, nhẹ, compile trực tiếp lúc build. |
  | **State Management** | **Zustand** (Client) + **TanStack Query** (Server) | Phân tách rõ ràng giữa trạng thái UI và dữ liệu server, tránh phình to Redux boilerplate. |
  | **Form & Validation** | React Hook Form + Zod | Xử lý các form tạo đề nhiều trường dữ liệu với hiệu năng cao, validate chặt chẽ từ schema. |
  | **Math Rendering** | KaTeX / MathLive | Render công thức Toán/Lý/Hóa tốc độ siêu nhanh (nhanh hơn MathJax truyền thống 10x). |
  | **Routing** | React Router v7 | Hỗ trợ SPA Routing, kết hợp cấu hình `vercel.json` để không bao giờ bị lỗi 404 khi F5. |

---

### 3.2. Backend & Serverless API Architecture
Để deploy dễ dàng nhất lên Vercel mà không cần thuê VPS riêng:
- **Vercel Serverless Functions / Node.js API (TypeScript):** Xử lý xác thực, quản lý đề thi, giao bài và nộp bài trực tiếp dưới dạng các Serverless Handlers (thời gian khởi động < 100ms, tự động scale khi hàng nghìn học sinh nộp bài cùng lúc).
- **Prisma ORM with Driver Adapters:** Kết nối an toàn đến database qua cơ chế Connection Pooling (tránh cạn kiệt connection trong môi trường serverless).
- **Lựa chọn Backend linh hoạt:** 
  - *Phương án 1 (Full Serverless trên Vercel):* Sử dụng Vercel Serverless API (`/api/*`) hoặc Hono/Express chạy trên Vercel Node Runtime.
  - *Phương án 2 (Decoupled Enterprise Backend):* Frontend React SPA trên Vercel kết nối đến NestJS Backend trên Render/Railway/AWS.

---

### 3.3. Serverless Database & Storage (Tương thích 100% với Vercel)
- **Neon PostgreSQL (Serverless Postgres):**
  - Database Postgres chuẩn doanh nghiệp với khả năng Auto-suspend và Instant Branching.
  - Tích hợp Connection Pooling sẵn sàng cho hàng ngàn serverless function kết nối đồng thời.
- **Upstash Redis (Serverless Redis):**
  - Quản lý phiên làm bài thi realtime (Auto-save buffer), chống gian lận và Rate limiting qua REST API mà không lo nghẽn kết nối TCP.
- **Vercel Blob / Cloudflare R2 / AWS S3 (Presigned URLs):**
  - Người dùng tải trực tiếp file đề thi (Word/PDF/Ảnh) lên Storage qua **Presigned URL**, giúp tránh giới hạn kích thước payload (4.5MB) của Serverless Function.

---

## 4. HƯỚNG DẪN CẤU HÌNH DEPLOY 1-CLICK LÊN VERCEL (VERCEL DEPLOYMENT GUIDE)

### 4.1. File Cấu Hình `vercel.json` Chuẩn SPA
Để giải quyết triệt để vấn đề **lỗi 404 khi reload trang** trên React Router (Client-side routing) và tối ưu hóa bộ nhớ đệm (Caching):

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "rewrites": [
    {
      "source": "/(.*)",
      "destination": "/index.html"
    }
  ],
  "headers": [
    {
      "source": "/assets/(.*)",
      "headers": [
        {
          "key": "Cache-Control",
          "value": "public, max-age=31536000, immutable"
        }
      ]
    }
  ]
}
```

### 4.2. Cấu hình Vercel Project Settings
Khi import repository từ GitHub vào Vercel:
- **Framework Preset:** `Vite`
- **Root Directory:** `qizzone` (hoặc `./` tùy theo cấu trúc repo)
- **Build Command:** `npm run build`
- **Output Directory:** `dist`
- **Install Command:** `npm install`

### 4.3. Các Biến Môi Trường Cần Thiết (Environment Variables)
Cấu hình trong mục **Settings > Environment Variables** trên Vercel:
```env
# Frontend API URL
VITE_API_BASE_URL=https://your-api-domain.com/api

# AI Service (Nếu gọi qua Vercel Serverless Function)
GEMINI_API_KEY=AIzaSy...
OPENAI_API_KEY=sk-...

# Database & Storage
DATABASE_URL=postgresql://user:pass@ep-cool-db.neon.tech/qizzone?sslmode=require
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
UPSTASH_REDIS_REST_URL=https://...upstash.io
UPSTASH_REDIS_REST_TOKEN=...
```

---

## 5. GIẢI PHÁP AI BÓC TÁCH ĐỀ THI TRÊN NỀN TẢNG VERCEL & SERVERLESS

### 5.1. Thách thức thực tế của tài liệu đề thi tại Việt Nam
- Đề thi Word (`.docx`) có bảng biểu, đáp án ở cuối đề, công thức MathType/Equation.
- Đề thi PDF scan hoặc hình ảnh chụp điện thoại bị nghiêng, mờ.
- Chứa các công thức Toán - Lý - Hóa, đồ thị, hình vẽ hình học.

### 5.2. Pipeline Bóc Tách Đề Thi Tối Ưu Cho Serverless & Vercel AI SDK

```mermaid
flowchart TD
    A[Giáo viên tải File lên] --> B[Client upload trực tiếp lên Storage qua Presigned URL<br/>Vercel Blob / Cloudflare R2]
    B --> C[Gọi Vercel Serverless Function /api/parse-quiz]
    
    C --> TypeCheck{Định dạng file?}
    
    TypeCheck -->|File Word .docx| DOCX_Parser[Tầng 1: Client/Server Docx Parser<br/>mammoth / docx-wasm trích xuất text & MathML]
    TypeCheck -->|File PDF / Ảnh| AI_Vision[Tầng 2: Multimodal AI Processing<br/>Vercel AI SDK + Google Gemini 1.5 Flash / Pro]
    
    DOCX_Parser --> Structure_AI[Tầng 3: LLM Structure & Validation<br/>Chuyển đổi thành JSON chuẩn + LaTeX]
    AI_Vision --> Structure_AI
    
    Structure_AI --> SplitEditor[Tầng 4: Human-in-the-loop<br/>Giao diện Split-Screen Editor để Giáo viên duyệt & sửa]
```

#### Chi tiết 3 tầng xử lý AI trên Vercel:

| Tầng | Công nghệ / Thư viện | Cơ chế & Tối ưu chi phí |
| :--- | :--- | :--- |
| **Tầng 1: Fast Rule-based & Client Parser** | `mammoth.js`, `docx-templates`, Regex | Bóc tách trực tiếp các file Word có định dạng mẫu ("Câu 1:", "A.", "B.", "C.", "D."). Xử lý tức thì trong vài trăm mili-giây, chi phí 0đ. |
| **Tầng 2: Vercel AI SDK + Multimodal Vision** | `@ai-sdk/google` (Gemini 1.5 Flash / Pro) | Gemini 1.5 Flash hỗ trợ nhận diện file PDF và hình ảnh trực tiếp (Native Multimodal), đọc được cả chữ viết tay, bảng số liệu và hình vẽ đồ thị mà không cần dựng cụm server OCR cồng kềnh. |
| **Tầng 3: Structured Outputs (Zod Schema)** | `generateObject` từ Vercel AI SDK | Ép buộc AI trả về chính xác 100% dữ liệu theo chuẩn JSON định nghĩa bằng Zod Schema (gồm câu hỏi, mảng options A/B/C/D, đáp án đúng, công thức chuẩn LaTeX `$...$`, lời giải). |
| **Tầng 4: Human-in-the-loop Split Editor** | React Split-Screen View | Hiển thị song song bản gốc và câu hỏi AI đã bóc tách. Giáo viên có thể nhấp chuột sửa nhanh bất kỳ câu nào trước khi lưu vào database. |

### 5.3. Mã Mẫu Bóc Tách Đề Thi Bằng Vercel AI SDK (Serverless Route)
```typescript
// api/parse-exam.ts (Vercel Serverless Function)
import { google } from '@ai-sdk/google';
import { generateObject } from 'ai';
import { z } from 'zod';

const ExamSchema = z.object({
  examTitle: z.string().describe('Tiêu đề bài thi hoặc môn học'),
  totalQuestions: z.number(),
  questions: z.array(
    z.object({
      order: z.number(),
      content: z.string().describe('Nội dung câu hỏi, công thức toán viết dạng LaTeX $...$'),
      options: z.array(
        z.object({
          id: z.enum(['A', 'B', 'C', 'D']),
          content: z.string().describe('Nội dung đáp án, công thức dạng $...$')
        })
      ),
      correctAnswer: z.enum(['A', 'B', 'C', 'D']).optional().describe('Đáp án đúng nếu có trong đề hoặc bảng đáp án'),
      explanation: z.string().optional().describe('Lời giải chi tiết nếu có'),
      hasImage: z.boolean().describe('Câu hỏi có chứa hình vẽ/đồ thị không')
    })
  )
});

export async function POST(req: Request) {
  const { fileUrl, mimeType } = await req.json();

  const result = await generateObject({
    model: google('gemini-1.5-flash'),
    schema: ExamSchema,
    messages: [
      {
        role: 'user',
        content: [
          { type: 'text', text: 'Hãy bóc tách toàn bộ câu hỏi trắc nghiệm, đáp án và lời giải từ tài liệu đề thi này. Đảm bảo toàn bộ công thức toán được chuẩn hóa sang định dạng LaTeX đặt trong cặp dấu $...$.' },
          { type: 'file', data: new URL(fileUrl), mimeType: mimeType }
        ]
      }
    ]
  });

  return Response.json(result.object);
}
```

---

## 6. CHIẾN LƯỢC THIẾT KẾ CHO BẢO TRÌ & NÂNG CẤP DÀI HẠN (ENTERPRISE MAINTAINABILITY)

### 6.1. Kiến trúc Thư mục Frontend (Feature-Sliced Architecture)
```text
qizzone/
├── public/                       # Favicon, static assets
├── vercel.json                   # Cấu hình routing & caching Vercel
├── src/
│   ├── app/                      # Providers, Router, QueryClient setup
│   ├── assets/                   # SVG icons, global images
│   ├── components/               # UI components dùng chung (Button, Modal, Input)
│   │   └── ui/                   # Primitive components (Shadcn / Radix UI)
│   ├── features/                 # MODULES THEO NGHIỆP VỤ (Clean Architecture)
│   │   ├── auth/                 # Đăng nhập, đăng ký, phân quyền Role
│   │   ├── exam-creation/        # Nghiệp vụ Tải lên, AI Bóc tách & Sửa đề
│   │   │   ├── api/              # Gọi API /parse-exam, /save-exam
│   │   │   ├── components/       # UploadDropzone, SplitEditor, LaTeXPreview
│   │   │   ├── hooks/            # useExamDraft, useAIExtractor
│   │   │   └── store/            # examDraftStore (Zustand)
│   │   ├── exam-taking/          # Nghiệp vụ Học sinh làm bài thi
│   │   │   ├── components/       # ExamHeader, QuestionCard, TimerCountdown, AntiCheatGuard
│   │   │   ├── hooks/            # useExamTimer, useAutoSave, useTabTracker
│   │   │   └── store/            # examSessionStore
│   │   └── classroom/            # Quản lý lớp, học sinh, giao bài
│   ├── hooks/                    # Custom hooks chung (useDebounce, useMediaQuery)
│   ├── layouts/                  # AuthLayout, DashboardLayout, ExamLayout
│   ├── lib/                      # Cấu hình axios, queryClient, katexHelper
│   ├── routes/                   # AppRoutes.tsx (Protected routes)
│   ├── types/                    # Common DTOs & TypeScript schemas
│   └── utils/                    # Helper functions (formatTime, shuffleArray)
```

### 6.2. Phân Tách Trạng Thái Rõ Ràng (State Segregation)
1. **Server State (TanStack Query):** Quản lý caching danh sách đề thi, kết quả thi, tránh gọi API lặp lại.
2. **Client State (Zustand):** Quản lý phiên nháp câu hỏi đang chỉnh sửa, giỏ câu hỏi.
3. **Local State (`useState`):** Trạng thái mở/đóng modal, tab UI.

---

## 7. AN NINH BẢO MẬT & CHỐNG GIAN LẬN THI CỬ (ANTI-CHEAT & SECURITY)

### 7.1. Chống gian lận trong phòng thi (Exam Guard)
1. **Phát hiện Chuyển Tab / Rời Màn Hình:** Bắt sự kiện `document.addEventListener('visibilitychange')` và `window.addEventListener('blur')` để ghi log cảnh báo và trừ điểm chuyên cần hoặc tự động nộp bài nếu vi phạm quá số lần quy định.
2. **Chặn Phím tắt & Sao chép:** Vô hiệu hóa chuột phải (`contextmenu`), chặn `Ctrl+C`, `Ctrl+V`, `F12`.
3. **Cơ chế Toàn màn hình (Fullscreen API):** Yêu cầu học sinh mở toàn màn hình trong suốt thời gian thi.
4. **Auto-save Buffer:** Mỗi khi học sinh tick chọn đáp án, hệ thống lưu ngay vào `LocalStorage/IndexedDB` và đồng bộ ngầm (Background Sync) lên Upstash Redis/Serverless API.

### 7.2. Bảo mật chuẩn Doanh nghiệp
- **Chống XSS với LaTeX/HTML:** Mọi nội dung render đều được lọc qua `DOMPurify`.
- **Phân quyền RBAC:** Phân tách rõ quyền giữa `TEACHER`, `STUDENT`, `ADMIN`.
- **Rate Limiting:** Sử dụng Upstash Redis Rate Limiter để chống brute-force mật khẩu phòng thi và spam nộp bài.

---

## 8. LỘ TRÌNH TRIỂN KHAI THEO GIAI ĐOẠN (PROJECT ROADMAP)

```mermaid
gantt
    title Lộ trình Phát triển & Triển khai Qizzone lên Vercel
    dateFormat  YYYY-MM-DD
    section Giai đoạn 1: Core MVP & Vercel Deploy
    Cấu hình React 19 + Tailwind + vercel.json :2026-09-01, 10d
    Deploy bản Demo lên Vercel App với CI/CD GitHub :2026-09-11, 5d
    Giao diện Làm bài & Chấm điểm Trắc nghiệm :2026-09-16, 20d
    section Giai đoạn 2: Nâng cấp AI Bóc Tách
    Tích hợp Vercel AI SDK + Gemini 1.5 Flash :2026-10-06, 15d
    Xây dựng Split-Screen Editor chỉnh sửa đề thông minh :2026-10-21, 15d
    Hỗ trợ công thức Toán LaTeX & Cắt ảnh tự động :2026-11-05, 15d
    section Giai đoạn 3: Enterprise & Anti-Cheat
    Hệ thống Giám sát gian lận (Tab switch, Fullscreen) :2026-11-20, 15d
    Báo cáo phân tích phổ điểm & Xuất kết quả Excel :2026-12-05, 15d
    Tối ưu hóa Performance & Production Launch :2026-12-20, 15d
```

---

## 9. KẾT LUẬN & HƯỚNG DẪN THỰC THI NGAY

Kiến trúc này mang lại lợi thế vượt trội cho Qizzone:
1. **Deploy cực nhanh lên Vercel:** File `vercel.json` đã sẵn sàng, cấu hình build chuẩn Vite, không lo lỗi reload SPA.
2. **Khởi đầu với chi phí 0đ:** Tận dụng gói Free của Vercel, Neon Postgres, Upstash Redis và Google AI Studio (Gemini Flash).
3. **Sẵn sàng mở rộng chuẩn Enterprise:** Dễ dàng nâng cấp AI bóc tách file phức tạp, tích hợp thanh toán và mở rộng sang Mobile App (React Native) trong tương lai.

---
*Tài liệu được soạn thảo cho dự án Qizzone. Bản quyền thiết kế thuộc về đội ngũ phát triển.*
