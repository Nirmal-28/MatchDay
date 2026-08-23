import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { Modal } from "./primitives";

// Every modal in the app renders through this component, so these assertions
// cover the accessibility of all of them at once. Before this rework a modal
// had no Escape key, no focus management and no dialog role.

const open = (props = {}) =>
  render(
    <Modal open onClose={vi.fn()} title="Confirm withdrawal" {...props}>
      <button>Withdraw</button>
      <button>Keep entry</button>
    </Modal>
  );

describe("Modal", () => {
  it("renders nothing when closed", () => {
    render(<Modal open={false} onClose={() => {}} title="Hidden">body</Modal>);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("is announced as a modal dialog with a name, not an anonymous div", () => {
    open();
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleName("Confirm withdrawal");
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    open({ onClose });
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("moves focus into the dialog so a keyboard user is not left behind it", () => {
    open();
    const dialog = screen.getByRole("dialog");
    expect(dialog.contains(document.activeElement)).toBe(true);

    // Specifically the close button, because it is first in DOM order. That is
    // the right default for this app: several of these dialogs confirm a
    // destructive action (withdraw an entry, delete a matchday), and landing
    // on Close means an accidental Enter dismisses rather than confirms.
    expect(document.activeElement).toBe(screen.getByRole("button", { name: /close dialog/i }));
  });

  it("gives its close button an accessible name — it is an icon with no text", () => {
    open();
    expect(screen.getByRole("button", { name: /close dialog/i })).toBeInTheDocument();
  });

  it("locks background scrolling while open and restores it after", () => {
    const { unmount } = open();
    expect(document.body.style.overflow).toBe("hidden");
    unmount();
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("returns focus to whatever opened it", () => {
    const opener = document.createElement("button");
    document.body.appendChild(opener);
    opener.focus();
    expect(document.activeElement).toBe(opener);

    const { unmount } = open();
    expect(document.activeElement).not.toBe(opener);

    unmount();
    expect(document.activeElement).toBe(opener);
    opener.remove();
  });

  // Focus order inside the dialog is: Close (header), then the body content.
  it("wraps Tab at the end instead of letting focus escape to the page behind", () => {
    open();
    const close = screen.getByRole("button", { name: /close dialog/i });
    const last = screen.getByRole("button", { name: "Keep entry" });

    last.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(close);
  });

  it("wraps Shift+Tab backwards from the first element", () => {
    open();
    const close = screen.getByRole("button", { name: /close dialog/i });
    const last = screen.getByRole("button", { name: "Keep entry" });

    close.focus();
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(last);
  });

  it("closes when the backdrop is clicked but not when the panel is", () => {
    const onClose = vi.fn();
    open({ onClose });

    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("dialog").parentElement);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
