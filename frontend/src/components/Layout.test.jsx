import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import Layout from "./Layout";
import { api } from "../lib/api";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../lib/api", () => ({ api: { get: jest.fn(), post: jest.fn() }, errMsg: () => "Request failed" }));

describe("owner quick actions", () => {
  let container;
  let root;

  beforeEach(() => {
    api.get.mockReset();
    api.post.mockReset();
    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    sessionStorage.removeItem("fms_support_token");
  });

  const renderAt = async (path, syncStatus = "connected", branding = undefined, user = undefined) => {
    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={[path]}>
          <Layout user={user || { role: "owner", name: "Owner", features: {}, branding }} syncStatus={syncStatus}>
            <div>Page content</div>
          </Layout>
        </MemoryRouter>,
      );
    });
  };

  it("hides industrial quick-entry actions in site booking routes", async () => {
    await renderAt("/sites");

    expect(container.querySelector('[data-testid="global-search"]')).toBeNull();
    expect(container.querySelector('[data-testid="quick-action-btn"]')).toBeNull();
    expect(container.querySelector('[data-testid="mobile-quick-btn"]')).toBeNull();
    expect(container.querySelector('time[aria-label="Current India Standard Time"]')?.textContent).toContain("IST");
  });

  it("keeps quick-entry actions on industrial routes", async () => {
    await renderAt("/trips?tab=trips");

    expect(container.querySelector('[data-testid="global-search"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="quick-action-btn"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="mobile-quick-btn"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid^="mnav-"]')).toHaveLength(5);
    expect(container.querySelector('[data-testid="mnav-industrial-dashboard"]')).not.toBeNull();
  });

  it("shows only the sections granted to a business admin", async () => {
    await renderAt("/trips?tab=trips", "connected", undefined, {
      role: "owner",
      name: "Admin",
      features: { trips: true },
      admin_access: { industrial_trips: true },
    });

    expect(container.querySelector('[data-testid="nav-industrial-trips"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="nav-vehicles"]')).toBeNull();
    expect(container.querySelector('[data-testid="nav-dashboard"]')).toBeNull();
    const quickButton = container.querySelector('[data-testid="quick-action-btn"]');
    expect(quickButton).not.toBeNull();
    await act(async () => quickButton.click());
    expect(container.querySelector('[data-testid="quick-lr"]')).toBeNull();
    expect(container.querySelector('[data-testid="quick-trip"]')).not.toBeNull();
  });

  it("shows live-update and offline status in the header", async () => {
    await renderAt("/booking/dashboard");
    const status = container.querySelector('[data-testid="sync-status"]');
    expect(status.textContent).toContain("Live updates on");

    await act(async () => {
      Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
      window.dispatchEvent(new Event("offline"));
    });
    expect(status.textContent).toContain("Offline · not synced");

    await act(async () => {
      Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
      window.dispatchEvent(new Event("online"));
    });
    expect(status.textContent).toContain("Live updates on");
  });

  it("clearly marks the full client support session", async () => {
    sessionStorage.setItem("fms_support_token", "support-token");
    api.post.mockResolvedValue({ data: { ok: true } });
    await renderAt("/booking/dashboard", "connected", undefined, {
      role: "owner",
      name: "Platform Owner",
      tenant_name: "Fleet One",
      platform_support: true,
      features: { trips: true },
    });

    expect(container.textContent).toContain("Support mode · Fleet One");
    const exit = container.querySelector('[data-testid="exit-platform-support"]');
    expect(exit?.textContent).toContain("Exit client");
    await act(async () => exit.click());
    expect(api.post).toHaveBeenCalledWith("/platform/support-session/end");
    expect(sessionStorage.getItem("fms_support_token")).toBeNull();
  });

  it("falls back when a business logo cannot load", async () => {
    await renderAt("/trips?tab=trips", "connected", { name: "Owner", logo: "https://example.test/business-logo.png" });

    const logo = container.querySelector('[data-testid="brand-logo"]');
    expect(logo.getAttribute("src")).toBe("https://example.test/business-logo.png");
    expect(logo.className).toContain("h-14");

    await act(async () => {
      logo.dispatchEvent(new Event("error"));
    });

    expect(container.querySelector('[data-testid="brand-logo"]').getAttribute("src")).toBe("/app-icon.png");

    await act(async () => {
      container.querySelector('[data-testid="brand-logo"]').dispatchEvent(new Event("error"));
    });

    expect(container.querySelector('[aria-label="Owner logo unavailable"]')).not.toBeNull();
  });

  it("groups owner navigation into booking and industrial workspaces", async () => {
    await renderAt("/booking/dashboard");

    expect(container.querySelector('nav[aria-label="Main navigation"] section[aria-label="Site booking"]')).not.toBeNull();
    expect(container.querySelector('nav[aria-label="Main navigation"] section[aria-label="Industrial operations"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-testid^="mnav-"]')).toHaveLength(4);
  });

  it("shows a visible error instead of an empty-search result when search fails", async () => {
    api.get.mockRejectedValue(new Error("Network unavailable"));
    await renderAt("/trips");
    const search = container.querySelector('[data-testid="global-search"]');

    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(search, "van");
      search.dispatchEvent(new Event("change", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 300));
    });

    expect(container.querySelector('[role="alert"]')?.textContent)
      .toContain("Search is temporarily unavailable");
    expect(container.textContent).not.toContain("No match found");
  });

  it("shows owner-only Finance and Audit alongside the primary booking navigation", async () => {
    await renderAt("/booking/dashboard");
    expect(container.querySelector('[aria-label="Booking sections"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="booking-section-dashboard"]')?.getAttribute("aria-current"))
      .toBe("page");
    for (const label of ["receipts", "ledger", "finance", "audit", "settings"]) {
      expect(container.querySelector(`[data-testid="booking-section-${label}"]`)).not.toBeNull();
    }
    for (const label of ["dashboard", "receipts", "ledger"]) {
      expect(container.querySelector(`[data-testid="nav-${label}"]`)).not.toBeNull();
    }
    expect(container.querySelector('[data-testid="nav-booking-finance"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="nav-booking-audit"]')).not.toBeNull();
    expect(container.querySelector('[data-testid="nav-booking-reports"]')).toBeNull();

    await act(async () => {
      root.render(
        <MemoryRouter key="manager" initialEntries={["/booking/ledger"]}>
          <Layout user={{ role: "site_manager", name: "Manager", features: {} }}>
            <div>Site page</div>
          </Layout>
        </MemoryRouter>,
      );
    });
    expect(container.querySelector('[data-testid="booking-section-ledger"]')?.getAttribute("aria-current"))
      .toBe("page");
    for (const label of ["finance", "audit", "settings"]) {
      expect(container.querySelector(`[data-testid="booking-section-${label}"]`)).toBeNull();
    }
    for (const label of ["dashboard", "receipts", "ledger"]) {
      expect(container.querySelector(`[data-testid="nav-${label}"]`)).not.toBeNull();
    }
    expect(container.querySelector('[data-testid="nav-booking-finance"]')).toBeNull();
    expect(container.querySelector('[data-testid="nav-booking-audit"]')).toBeNull();
    expect(container.querySelector('[data-testid="nav-booking-reports"]')).toBeNull();
  });

  it("does not show industrial search or Quick Add on booking finance routes", async () => {
    await renderAt("/booking/ledger");

    expect(container.querySelector('[data-testid="global-search"]')).toBeNull();
    expect(container.querySelector('[data-testid="quick-action-btn"]')).toBeNull();
    expect(container.querySelector('[data-testid="mobile-quick-btn"]')).toBeNull();
  });

  it("shows booking settings only to the owner", async () => {
    await renderAt("/booking-setup");
    expect(container.querySelector('[data-testid="nav-booking-settings"]')).not.toBeNull();

    await act(async () => {
      root.render(
        <MemoryRouter initialEntries={["/booking/dashboard"]}>
          <Layout user={{ role: "site_manager", name: "Manager", features: {} }}>
            <div>Site page</div>
          </Layout>
        </MemoryRouter>,
      );
    });
    expect(container.querySelector('[data-testid="nav-booking-settings"]')).toBeNull();
  });
});
