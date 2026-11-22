import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Textarea } from "@/components/ui/Textarea";

describe("Textarea UI & a11y tokens", () => {
  it("generates fallback aria-describedby ID when id and label are omitted and uses semantic error tokens", () => {
    render(
      <Textarea
        aria-label="Ghi chú"
        error="Vui lòng nhập nội dung hợp lệ"
      />,
    );

    const textarea = screen.getByLabelText("Ghi chú");
    expect(textarea).toHaveAttribute("aria-invalid", "true");
    const describedBy = textarea.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(describedBy).not.toContain("undefined");

    const errorMsg = document.getElementById(describedBy!);
    expect(errorMsg).toHaveTextContent("Vui lòng nhập nội dung hợp lệ");
    expect(errorMsg?.className).toContain("text-status-danger");
    expect(textarea.className).toContain("border-[var(--status-danger-border)]");
    expect(textarea.className).not.toMatch(/\brose-|\bblue-/);
  });

  it("connects helperText via aria-describedby and uses semantic focus tokens in default state", () => {
    render(
      <Textarea
        label="Mô tả"
        helperText="Tối đa 500 ký tự"
      />,
    );

    const textarea = screen.getByLabelText("Mô tả");
    expect(textarea).toHaveAttribute("aria-invalid", "false");
    const describedBy = textarea.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    expect(document.getElementById(describedBy!)).toHaveTextContent("Tối đa 500 ký tự");
    expect(textarea.className).toContain("focus-visible:border-focus");
    expect(textarea.className).not.toMatch(/\brose-|\bblue-/);
  });
});
