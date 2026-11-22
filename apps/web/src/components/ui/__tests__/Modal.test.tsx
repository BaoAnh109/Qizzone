import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Modal } from "@/components/ui/Modal";

describe("Modal accessible dialog focus management", () => {
  it("moves focus to first focusable element on open, traps Tab/Shift+Tab, closes on Escape, and restores focus on close", () => {
    function ControlledHarness() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button type="button" onClick={() => setOpen(true)}>
            Mở hộp thoại
          </button>
          <Modal
            isOpen={open}
            onClose={() => setOpen(false)}
            title="Tiêu đề"
            description="Mô tả hộp thoại"
          >
            <input aria-label="Ô nhập 1" />
            <button type="button">Nút cuối</button>
          </Modal>
        </div>
      );
    }

    render(<ControlledHarness />);
    const opener = screen.getByRole("button", { name: "Mở hộp thoại" });
    opener.focus();
    expect(opener).toHaveFocus();

    fireEvent.click(opener);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby");
    expect(dialog).toHaveAttribute("aria-describedby");

    const closeBtn = screen.getByRole("button", { name: "Đóng" });
    const lastBtn = screen.getByRole("button", { name: "Nút cuối" });
    expect(closeBtn).toHaveFocus();

    // Shift+Tab from first focusable wraps to last
    fireEvent.keyDown(document, { key: "Shift", shiftKey: true });
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(lastBtn).toHaveFocus();

    // Tab from last focusable wraps to first
    fireEvent.keyDown(document, { key: "Tab" });
    expect(closeBtn).toHaveFocus();

    // Escape closes modal and restores focus to opener
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
  });

  it("falls back to dialog panel focus when there are no focusable children", () => {
    const onClose = vi.fn();
    render(
      <Modal isOpen={true} onClose={onClose} showCloseButton={false} title="Chỉ đọc">
        <p>Nội dung thông báo</p>
      </Modal>,
    );

    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveFocus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(dialog).toHaveFocus();
  });

  it("preserves autoFocus on child input and does not steal focus when parent re-renders with inline onClose", () => {
    function TypingHarness() {
      const [value, setValue] = useState("");
      return (
        <Modal isOpen={true} onClose={() => undefined} title="Nhập liệu">
          <input
            aria-label="Tên lớp"
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </Modal>
      );
    }

    render(<TypingHarness />);
    const input = screen.getByLabelText("Tên lớp");
    expect(input).toHaveFocus();

    fireEvent.change(input, { target: { value: "12A1" } });
    expect(input).toHaveValue("12A1");
    expect(input).toHaveFocus();
  });

  it("restores focus to opener when modal unmounts directly on close and stops Escape propagation", () => {
    const parentKeyDown = vi.fn();

    function UnmountHarness() {
      const [mounted, setMounted] = useState(false);
      return (
        <div onKeyDown={parentKeyDown}>
          <button type="button" onClick={() => setMounted(true)}>
            Mở modal mount
          </button>
          {mounted && (
            <Modal isOpen={true} onClose={() => setMounted(false)} title="Mount modal">
              <button type="button">Hành động</button>
            </Modal>
          )}
        </div>
      );
    }

    render(<UnmountHarness />);
    const opener = screen.getByRole("button", { name: "Mở modal mount" });
    opener.focus();
    fireEvent.click(opener);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(opener).toHaveFocus();
    expect(parentKeyDown).not.toHaveBeenCalled();
  });

  it("generates distinct aria-labelledby IDs across concurrent modals", () => {
    render(
      <>
        <Modal isOpen={true} onClose={() => undefined} title="Modal A">
          <span>A</span>
        </Modal>
        <Modal isOpen={true} onClose={() => undefined} title="Modal B">
          <span>B</span>
        </Modal>
      </>,
    );

    const dialogs = screen.getAllByRole("dialog");
    expect(dialogs).toHaveLength(2);
    expect(dialogs[0].getAttribute("aria-labelledby")).not.toBe(
      dialogs[1].getAttribute("aria-labelledby"),
    );
  });
});
