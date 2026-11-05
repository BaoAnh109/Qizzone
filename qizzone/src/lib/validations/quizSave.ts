/**
 * Validation theo trạng thái lưu đề (bước 08, PLAN_MAIN).
 *
 * Vấn đề bước 08 giải quyết: trước đây mọi đường lưu đều dùng chung một
 * luật (CreateQuiz chặn cả lưu nháp khi thiếu đáp án, trong khi
 * BatchActionBar cho lưu nháp qua rồi chết ở DB), và đường lật trạng
 * thái draft → published (quizStore.togglePublishStatus, dùng ở QuizList
 * và JoinByLink) không kiểm tra gì nên vòng qua được guard bước 04.
 *
 * Luật ở đây là client/store layer, cố tình mirror đúng luật cứng của DB
 * (save_quiz: options 2–4, đáp án 1–4, đáp án phải nằm trong phương án,
 * câu không phải multiple_choice thì đúng 1 đáp án) để thông báo lỗi
 * rõ ràng trước khi gọi RPC — không nới lỏng chung cho cả publish.
 *
 * - status "published": mọi issue đều là blocker, chặn lưu.
 * - status "draft": cùng các issue nhưng chỉ là warning, không chặn ở
 *   tầng này. LƯU Ý TRUNG THỰC: DB hiện tại (save_quiz + CHECK
 *   correct_answers 1–4 ở bảng question_answer_keys) vẫn từ chối mọi
 *   trạng thái khi câu thiếu đáp án/phương án, nên nháp có câu chưa xác
 *   minh vẫn chưa lưu được xuống DB cho tới khi có migration nới riêng
 *   cho draft (ghi rõ trong PROGRESS bước 08, không tự sửa schema ở
 *   bước này). Tầng này chỉ đảm bảo: không bịa đáp án, không xuất bản
 *   lén, và lỗi DB (nếu có) được hiện đúng thông điệp thay vì toast
 *   chung chung.
 *
 * Manual draft (bước 05): tiêu chí "hoàn thiện" được chốt ở bước 08 là
 * theo tính hợp lệ của câu (đủ nội dung + đủ phương án + đáp án hợp
 * lệ), KHÔNG theo cờ isManualDraft. Lý do: cờ đó không có UI nào gỡ
 * (câu tạo tay được sửa ở CreateQuiz, nơi kiểu Question không mang cờ),
 * nên gate theo cờ sẽ chặn xuất bản vĩnh viễn cả câu đã sửa xong.
 * Cờ isManualDraft giữ vai trò marker staging cho UI (bước 24/25).
 */

export type QuizSaveIssueCode =
  | "no_questions"
  | "empty_content"
  | "insufficient_options"
  | "too_many_options"
  | "invalid_option"
  | "missing_answer"
  | "too_many_answers"
  | "answer_not_in_options";

export interface QuizSaveIssue {
  /** Index 0-based trong mảng câu hỏi; -1 khi issue ở cấp đề (vd không có câu nào). */
  questionIndex: number;
  /** Số thứ tự hiển thị (1-based); 0 khi issue ở cấp đề. */
  order: number;
  code: QuizSaveIssueCode;
  message: string;
}

export interface QuizSaveValidation {
  /** Chặn lưu khi status là "published". Rỗng khi status là "draft". */
  blockers: QuizSaveIssue[];
  /** Cùng các issue nhưng chỉ cảnh báo khi status là "draft". */
  warnings: QuizSaveIssue[];
}

/** Kiểu tối thiểu để validate, dùng chung cho Question và câu đã map. */
export interface SaveValidatableQuestion {
  content?: string;
  type?: string;
  options?: { id?: string; content?: string }[];
  correctAnswers?: string[];
}

const VALID_OPTION_IDS = new Set(["A", "B", "C", "D"]);

function validateOneQuestion(
  q: SaveValidatableQuestion,
  index: number
): QuizSaveIssue[] {
  const issues: QuizSaveIssue[] = [];
  const order = index + 1;
  const push = (code: QuizSaveIssueCode, message: string) =>
    issues.push({ questionIndex: index, order, code, message });

  if (!q.content || !q.content.trim()) {
    push("empty_content", `Câu ${order} chưa có nội dung.`);
  }

  const options = q.options || [];
  if (options.length < 2) {
    push(
      "insufficient_options",
      `Câu ${order} có dưới 2 phương án (${options.length}) — không đủ để xuất bản.`
    );
  } else if (options.length > 4) {
    push(
      "too_many_options",
      `Câu ${order} có quá 4 phương án (${options.length}) — vượt giới hạn của đề thi.`
    );
  }
  const seenIds = new Set<string>();
  for (const opt of options) {
    if (!opt.id || !VALID_OPTION_IDS.has(opt.id)) {
      push("invalid_option", `Câu ${order} có phương án với id không hợp lệ.`);
      break;
    }
    if (seenIds.has(opt.id)) {
      push("invalid_option", `Câu ${order} có phương án bị trùng id ${opt.id}.`);
      break;
    }
    seenIds.add(opt.id);
    if (!opt.content || !opt.content.trim()) {
      push("invalid_option", `Câu ${order} có phương án ${opt.id} để trống nội dung.`);
      break;
    }
  }

  const answers = q.correctAnswers || [];
  if (answers.length === 0) {
    push(
      "missing_answer",
      `Câu ${order} chưa có đáp án — cần giáo viên chọn hoặc giải bằng AI, không tự gán đáp án.`
    );
  } else {
    if (answers.length > 4) {
      push("too_many_answers", `Câu ${order} có quá 4 đáp án (${answers.length}).`);
    }
    if (q.type !== "multiple_choice" && answers.length !== 1) {
      push(
        "too_many_answers",
        `Câu ${order} là trắc nghiệm một đáp án nhưng có ${answers.length} đáp án — chỉ được 1 đáp án.`
      );
    }
    for (const answer of answers) {
      if (!seenIds.has(answer)) {
        push(
          "answer_not_in_options",
          `Câu ${order} có đáp án ${answer} không nằm trong các phương án — cần giáo viên sửa.`
        );
        break;
      }
    }
  }
  return issues;
}

/**
 * Validate theo trạng thái lưu. Draft: issues thành warnings, không
 * blocker. Published (và mọi trạng thái khác không phải draft): issues
 * thành blockers.
 */
export function validateQuestionsForSave(
  questions: SaveValidatableQuestion[],
  status: "draft" | "published" | string
): QuizSaveValidation {
  const issues: QuizSaveIssue[] = [];
  if (!questions || questions.length === 0) {
    issues.push({
      questionIndex: -1,
      order: 0,
      code: "no_questions",
      message: "Đề thi chưa có câu hỏi nào.",
    });
  } else {
    questions.forEach((q, idx) => {
      issues.push(...validateOneQuestion(q, idx));
    });
  }
  if (status === "draft") {
    return { blockers: [], warnings: issues };
  }
  return { blockers: issues, warnings: [] };
}

/** Chỉ dùng cho đường xuất bản: trả về các blocker, rỗng nghĩa là được xuất bản. */
export function validateQuestionsForPublish(
  questions: SaveValidatableQuestion[]
): QuizSaveIssue[] {
  return validateQuestionsForSave(questions, "published").blockers;
}

/** Gom issues thành một thông điệp liệt kê tối đa maxShown vấn đề. */
export function formatSaveIssues(issues: QuizSaveIssue[], maxShown = 5): string {
  if (issues.length === 0) return "";
  const shown = issues.slice(0, maxShown).map((i) => i.message).join(" ");
  const more =
    issues.length > maxShown ? ` Và ${issues.length - maxShown} vấn đề khác.` : "";
  return `${shown}${more}`;
}

/** Throw Error mô tả blocker khi câu hỏi chưa đủ điều kiện xuất bản. */
export function assertPublishable(questions: SaveValidatableQuestion[]): void {
  const blockers = validateQuestionsForPublish(questions);
  if (blockers.length > 0) {
    throw new Error(
      `Không thể xuất bản: ${blockers.length} vấn đề cần sửa. ${formatSaveIssues(blockers)}`
    );
  }
}
