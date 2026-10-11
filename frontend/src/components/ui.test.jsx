import React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { render, screen } from "@testing-library/react";
import { Modal, scheduleMutationSuccess, toast, ToastHost } from "./ui";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("global toast host", () => {
  let container;
  let root;

  beforeEach(() => {
    jest.useFakeTimers();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root.render(<ToastHost />));
  });

  describe("modal layout", () => {
    it("renders outside transformed page containers and exposes a scrollable dialog", () => {
      render(
        <main className="page-enter">
          <Modal open onClose={jest.fn()} title="Edit subscription" footer={<button>Save</button>}>
            <div>Subscription form</div>
          </Modal>
        </main>,
      );

      const dialog = screen.getByRole("dialog", { name: "Edit subscription" });
      const overlay = screen.getByTestId("modal-overlay");
      const content = screen.getByTestId("modal-content");
      expect(overlay.parentElement).toBe(document.body);
      expect(dialog.closest("main")).toBeNull();
      expect(content.className).toContain("overflow-y-auto");
      expect(screen.getByRole("button", { name: "Close dialog" })).not.toBeNull();
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    jest.clearAllTimers();
    jest.useRealTimers();
    container.remove();
  });

  it("replaces a mutation success fallback when the page already announces success", () => {
    act(() => {
      scheduleMutationSuccess();
      toast("Trip updated");
      jest.advanceTimersByTime(700);
    });

    expect(container.querySelectorAll('[data-testid="toast"]')).toHaveLength(1);
    expect(container.querySelector('[data-testid="toast"] span').textContent).toBe("Trip updated");
  });

  it("deduplicates the matching page error without hiding separate failed writes", () => {
    act(() => {
      toast("Trip date is required", "err", { apiError: true });
      toast("Trip date is required", "err");
      toast("Trip date is required", "err", { apiError: true });
    });

    expect(container.querySelectorAll('[data-testid="toast"]')).toHaveLength(2);
  });

  it("keeps save failure reasons visible until dismissed or the same save succeeds", () => {
    act(() => {
      window.dispatchEvent(new CustomEvent("fms:mutation-status", { detail: {
        state: "failed", key: "put:/settings", title: "Save failed · Settings updated",
        reason: "Company name is required",
      } }));
    });
    expect(container.querySelector('[data-testid="persistent-save-error"]').textContent)
      .toContain("Company name is required");

    act(() => {
      window.dispatchEvent(new CustomEvent("fms:mutation-status", { detail: {
        state: "saved", key: "put:/settings",
      } }));
    });
    expect(container.querySelector('[data-testid="persistent-save-error"]')).toBeNull();
  });

  it("lets users dismiss persistent save failures", () => {
    act(() => {
      window.dispatchEvent(new CustomEvent("fms:mutation-status", { detail: {
        state: "failed", key: "post:/sites", title: "Save failed · Site created",
        reason: "The server could not save this site.",
      } }));
    });
    act(() => container.querySelector('[aria-label="Dismiss save error"]').click());
    expect(container.querySelector('[data-testid="persistent-save-error"]')).toBeNull();
  });
});
