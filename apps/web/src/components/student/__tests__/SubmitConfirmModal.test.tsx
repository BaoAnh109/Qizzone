import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SubmitConfirmModal } from "@/components/student/SubmitConfirmModal";

describe("SubmitConfirmModal", () => {
  it("renders second-confirm warning without emoji icon when unanswered questions remain", () => {
    const onConfirm = vi.fn();
    const onClose = vi.fn();

    render(
      <SubmitConfirmModal
        isOpen={true}
        onClose={onClose}
        onConfirm={onConfirm}
        totalQuestions={10}
        answeredCount={7}
        flaggedCount={1}
      />,
    );

    expect(screen.getByText("Xác nhận nộp bài thi")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Nộp bài ngay" }));

    expect(onConfirm).not.toHaveBeenCalled();
    const heading = screen.getByRole("heading", {
      name: "Cảnh báo xác nhận nộp bài lần 2",
    });
    expect(heading).toBeInTheDocument();
    expect(heading.textContent).not.toContain("⚠️");

    fireEvent.click(
      screen.getByRole("button", { name: "Vẫn muốn nộp bài (0đ câu trống)" }),
    );
    expect(onConfirm).toHaveBeenCalledOnce();
  });

  it("submits directly on first confirm when all questions are answered", () => {
    const onConfirm = vi.fn();

    render(
      <SubmitConfirmModal
        isOpen={true}
        onClose={vi.fn()}
        onConfirm={onConfirm}
        totalQuestions={5}
        answeredCount={5}
        flaggedCount={0}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Nộp bài ngay" }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});
