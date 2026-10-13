import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { api } from "../lib/api";
import SiteConsole from "./SiteConsole";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), put: jest.fn(), delete: jest.fn() },
  assetUrl: (value) => value || "",
  uploadFile: jest.fn(),
  errMsg: () => "Request failed",
}));

const sites = [
  { id: "site-a", name: "Site A", code: "A", location: "", timezone: "Asia/Kolkata" },
  { id: "site-b", name: "Site B", code: "B", location: "", timezone: "Asia/Kolkata" },
];

describe("SiteConsole fetch cycles", () => {
  let container;
  let root;

  beforeEach(() => {
    localStorage.clear();
    api.post.mockImplementation((path) => path === "/sites"
      ? Promise.resolve({ data: { id: "site-new", name: "New Site", code: "NEW" } })
      : path === "/sites/site-new/manager"
        ? Promise.resolve({ data: {
          username: "mina manager", temporary_password: "Generated-temp-pass",
        } })
        : Promise.resolve({ data: { ok: true } }));
    api.get.mockImplementation((path) => {
      if (path === "/sites") return Promise.resolve({ data: sites });
      if (path === "/booking/receipt-controls") return Promise.resolve({ data: {} });
      if (path === "/sites/managers") return Promise.resolve({ data: [] });
      if (path === "/masters/team") return Promise.resolve({ data: [
        { id: "team-manager", name: "Mina Manager", role: "Manager", status: "Active" },
        { id: "team-staff", name: "Sam Staff", role: "Accountant", status: "Active" },
      ] });
      if (path === "/sites/system-dashboard") return Promise.resolve({ data: { sites: [] } });
      if (path.endsWith("/trips")) return Promise.resolve({ data: { rows: [], total: 0 } });
      if (path.endsWith("/trip-resources")) {
        return Promise.resolve({ data: { vehicles: [], drivers: [] } });
      }
      return Promise.resolve({ data: {} });
    });
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    jest.clearAllMocks();
  });

  it("does not refetch sites after initial selection or a site change", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <SiteConsole user={{ role: "site_manager", site_permissions: {} }} />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(localStorage.getItem("booking_site_id")).toBe("site-a");
    expect(api.get.mock.calls.filter(([path]) => path === "/sites")).toHaveLength(1);
    expect(container.querySelector('[data-testid="booking-access-management"]')).toBeNull();
    expect(container.textContent).not.toContain("Booking access management");

    const siteSelect = Array.from(container.querySelectorAll("select")).find((select) =>
      Array.from(select.options).some((option) => option.value === "site-b"),
    );
    await act(async () => {
      siteSelect.value = "site-b";
      siteSelect.dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(localStorage.getItem("booking_site_id")).toBe("site-b");
    expect(api.get.mock.calls.filter(([path]) => path === "/sites")).toHaveLength(1);
    expect(api.get.mock.calls.filter(([path]) => path === "/sites/site-b/trips")).toHaveLength(1);
    expect(api.get.mock.calls.filter(([path]) => path === "/sites/site-b/trip-resources")).toHaveLength(1);
  });

  it("shows saved party suggestion management only in owner Booking setup", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <SiteConsole user={{ role: "owner" }} adminOnly />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Saved sender and receiver suggestions");
    expect(api.get.mock.calls.some(([path]) => path === "/sites")).toBe(true);
    expect(api.get.mock.calls.some(([path]) => path === "/sites/site-a/party-names")).toBe(false);
  });

  it("shows shared vehicle and driver choices to a manager creating a booking", async () => {
    api.get.mockImplementation((path) => {
      if (path === "/sites") return Promise.resolve({ data: [sites[0]] });
      if (path === "/sites/site-a/trips") return Promise.reject(new Error("No trip read access"));
      if (path === "/sites/site-a/dashboard") return Promise.reject(new Error("No dashboard read access"));
      if (path === "/sites/site-a/trip-resources") return Promise.resolve({ data: {
        vehicles: [{ id: "vehicle-1", vehicle_no: "MH31AB1234", vehicle_type: "Truck", status: "Active" }],
        drivers: [{ id: "driver-1", name: "Driver One" }],
      } });
      return Promise.resolve({ data: {} });
    });

    await act(async () => {
      root.render(
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <SiteConsole user={{
            role: "site_manager",
            site_permissions: { "site-a": ["trips:create"] },
          }} />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    const selects = Array.from(container.querySelectorAll("#site-trip-create-form select"));
    expect(selects[0].textContent).toContain("MH31AB1234");
    expect(selects[1].textContent).toContain("Driver One");
    expect(container.textContent).toContain("Booking records: Request failed");
    expect(container.textContent).not.toContain("Vehicle and driver options: Request failed");
  });

  it("lets a site manager with daily-ledger permission download the selected site's ledger", async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    URL.createObjectURL = jest.fn(() => "blob:daily-ledger");
    URL.revokeObjectURL = jest.fn();

    await act(async () => {
      root.render(
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <SiteConsole user={{
            role: "site_manager",
            site_permissions: { "site-a": ["ledger:export"] },
          }} />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const downloadButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Download daily ledger"));
    expect(downloadButton).not.toBeUndefined();
    await act(async () => {
      downloadButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.get).toHaveBeenCalledWith("/sites/site-a/ledger/daily", expect.objectContaining({
      params: { operating_date: expect.any(String) },
      responseType: "blob",
    }));

    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  it("shows the owner-only access register and reveals a reset password only once", async () => {
    api.get.mockImplementation((path) => {
      if (path === "/sites") return Promise.resolve({ data: sites });
      if (path === "/sites/managers") return Promise.resolve({ data: [{
        username: "manager-one", name: "Manager One", active: true, site_ids: ["site-a"],
        team_member_id: "team-manager", site_permissions: { "site-a": ["trips:read"] },
      }] });
      if (path === "/masters/team") return Promise.resolve({ data: [
        { id: "team-manager", name: "Mina Manager", role: "Manager", status: "Active" },
        { id: "team-staff", name: "Sam Staff", role: "Accountant", status: "Active" },
      ] });
      if (path === "/sites/system-dashboard") return Promise.resolve({ data: { sites: [] } });
      if (path.endsWith("/trips")) return Promise.resolve({ data: { rows: [], total: 0 } });
      if (path.endsWith("/trip-resources")) {
        return Promise.resolve({ data: { vehicles: [], drivers: [] } });
      }
      return Promise.resolve({ data: {} });
    });
    const prompt = jest.spyOn(window, "prompt").mockReturnValue("Temp-password-123!");

    await act(async () => {
      root.render(
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <SiteConsole user={{ role: "owner" }} adminOnly />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    const managerDetails = container.querySelector('[data-testid="booking-access-management"]');
    expect(managerDetails).not.toBeNull();
    expect(managerDetails.textContent).toContain("Manager account register");
    expect(container.textContent).toContain("Booking categories");
    expect(container.querySelector('[aria-label="City"]').closest("label").textContent).toContain("City (optional)");
    await act(async () => { managerDetails.open = true; });
    expect(container.textContent).toContain("Manager ID: manager-one");
    expect(container.textContent).toContain("Assigned sites: Site A");

    const resetButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Reset password");
    await act(async () => {
      resetButton.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(api.post).toHaveBeenCalledWith(
      "/sites/managers/manager-one/reset-password",
      { password: "Temp-password-123!" },
    );
    expect(container.textContent).toContain("Temporary credential — copy it now");
    expect(container.textContent).toContain("Temporary password: Temp-password-123!");
    expect(prompt).toHaveBeenCalledTimes(1);
    prompt.mockRestore();
  });

  it("offers active Office Team managers when adding a site and creates a login for a selected profile", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <SiteConsole user={{ role: "owner" }} adminOnly />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const managerSelect = Array.from(container.querySelectorAll("select"))
      .find((select) => Array.from(select.options).some((option) => option.value === "team-manager"));
    expect(Array.from(managerSelect.options).map((option) => option.value)).toContain("__new__");
    expect(Array.from(managerSelect.options).map((option) => option.value)).not.toContain("team-staff");

    await act(async () => {
      managerSelect.value = "team-manager";
      managerSelect.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(container.querySelector('input[aria-label="Manager login ID"]')).not.toBeNull();
    expect(container.querySelector('input[aria-label="City"]')).not.toBeNull();

    const setInput = async (selector, value) => {
      const input = container.querySelector(selector);
      if (!input) throw new Error(`Missing test input: ${selector}`);
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    await setInput('input[placeholder="Site name"]', "New Site");
    await setInput('input[placeholder="e.g. NGP"]', "NEW");
    await setInput('input[aria-label="Manager login ID"]', "Mina Manager");
    expect(container.querySelector('input[type="password"]')).toBeNull();

    const createForm = container.querySelector('input[placeholder="Site name"]').closest("form");
    await act(async () => {
      createForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.post).toHaveBeenCalledWith("/sites", expect.objectContaining({ name: "New Site", code: "NEW" }));
    expect(api.post).toHaveBeenCalledWith("/sites/site-new/manager", expect.objectContaining({
      name: "Mina Manager", username: "mina manager", team_member_id: "team-manager",
    }));
    expect(container.textContent).toContain("Temporary password: Generated-temp-pass");
  });

  it("assigns a manager using an admin-chosen ID and generated password", async () => {
    api.post.mockImplementation((path) => path === "/sites/site-a/manager"
      ? Promise.resolve({ data: { username: "saoji ngp", temporary_password: "Generated-once" } })
      : Promise.resolve({ data: { ok: true } }));
    await act(async () => {
      root.render(
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <SiteConsole user={{ role: "owner" }} adminOnly />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    const accessDetails = container.querySelector('[data-testid="booking-access-management"]');
    await act(async () => { accessDetails.open = true; });
    const setInput = async (selector, value) => {
      const input = container.querySelector(selector);
      if (!input) throw new Error(`Missing test input: ${selector}`);
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    await setInput('input[placeholder="First and last name"]', "Saoji Naidu");
    await setInput('input[placeholder="Enter the ID to give this manager"]', "Saoji Ngp");
    const assignForm = container.querySelector('input[placeholder="Enter the ID to give this manager"]').closest("form");
    await act(async () => {
      assignForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(api.post).toHaveBeenCalledWith("/sites/site-a/manager", {
      name: "Saoji Naidu", username: "saoji ngp",
    });
    expect(container.textContent).toContain("Temporary password: Generated-once");
  });

  it("prevents duplicate site names and locations in the site setup form", async () => {
    api.get.mockImplementation((path) => {
      if (path === "/sites") return Promise.resolve({ data: [
        { ...sites[0], location: "Main Road" }, sites[1],
      ] });
      if (path === "/sites/managers") return Promise.resolve({ data: [] });
      if (path === "/masters/team") return Promise.resolve({ data: [] });
      if (path === "/sites/system-dashboard") return Promise.resolve({ data: { sites: [] } });
      return Promise.resolve({ data: {} });
    });
    await act(async () => {
      root.render(
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <SiteConsole user={{ role: "owner" }} adminOnly />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    const setInput = async (selector, value) => {
      const input = container.querySelector(selector);
      if (!input) throw new Error(`Missing test input: ${selector}`);
      await act(async () => {
        Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    };
    await setInput('input[placeholder="Site name"]', "  site   a ");
    expect(container.querySelector('input[placeholder="Site name"]').getAttribute("aria-invalid")).toBe("true");
    expect(container.textContent).toContain("A site with this name already exists.");

    await setInput('input[placeholder="Site name"]', "A new site");
    await setInput('input[placeholder="Street, area, or landmark"]', " main road ");
    expect(container.querySelector('input[placeholder="Street, area, or landmark"]').getAttribute("aria-invalid"))
      .toBe("true");
    expect(container.textContent).toContain("A site with this location already exists.");
    const createButton = Array.from(container.querySelectorAll("button"))
      .find((button) => button.textContent === "Create site");
    expect(createButton.disabled).toBe(true);
  });

  it("explains manager permissions with grouped action labels", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <SiteConsole user={{ role: "owner" }} adminOnly />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(container.textContent).toContain("Manager site access");
    expect(container.textContent).toContain("Lorry receipts (LRs)");
    expect(container.querySelector('[aria-label="Create trips"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Record payments"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Download daily ledger"]')).not.toBeNull();
    expect(container.textContent).toContain("Unticked actions are unavailable to this manager at this site.");
  });

  it("saves grouped receipt controls and keeps owner dashboard reminders off by default", async () => {
    await act(async () => {
      root.render(
        <MemoryRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
          <SiteConsole user={{ role: "owner" }} adminOnly />
        </MemoryRouter>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    const controls = Array.from(container.querySelectorAll("details"))
      .find((details) => details.querySelector("summary")?.textContent
        .startsWith("Booking settings"));
    await act(async () => { controls.open = true; });
    expect(controls.open).toBe(true);
    expect(controls.textContent).toContain("Receipt appearance");
    expect(controls.textContent).toContain("Receipt and name defaults");
    expect(controls.textContent).toContain("Optional receipt contact fields");
    expect(controls.textContent).toContain("Suggested goods");
    expect(controls.textContent).toContain("Packaging & Units");
    expect(controls.textContent).toContain("These switches apply to every site.");
    expect(controls.querySelectorAll('[aria-label^="Receipt branch name "]')).toHaveLength(3);
    const attentionEnabled = controls.querySelector('[aria-label="Show owner needs-attention reminders"]');
    expect(attentionEnabled.checked).toBe(false);
    await act(async () => { attentionEnabled.click(); });
    expect(attentionEnabled.checked).toBe(true);
    const hindiPartyNames = controls.querySelector('[aria-label="Show Hindi party-name fields on receipts"]');
    expect(hindiPartyNames.checked).toBe(true);
    await act(async () => { hindiPartyNames.click(); });
    expect(hindiPartyNames.checked).toBe(false);
    const printSize = controls.querySelector('[aria-label="Receipt printer paper size"]');
    expect(printSize.value).toBe("default");
    printSize.value = "58mm";
    await act(async () => {
      printSize.dispatchEvent(new Event("change", { bubbles: true }));
    });

    const companyName = controls.querySelector('[aria-label="Receipt company name"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")
        .set.call(companyName, "नायडू गुड्स ट्रांसपोर्ट");
      companyName.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const branchName = controls.querySelector('[aria-label="Receipt branch name 1"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")
        .set.call(branchName, "Nagpur");
      branchName.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const branchPhone = controls.querySelector('[aria-label="Receipt branch phone 1"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")
        .set.call(branchPhone, "0000000000");
      branchPhone.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const branchPhoneLabel = controls.querySelector('[aria-label="Receipt branch phone label 1"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")
        .set.call(branchPhoneLabel, "(O)");
      branchPhoneLabel.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const feeInput = Array.from(controls.querySelectorAll('input[type="number"]'))
      .find((input) => input.closest("label").textContent.includes("Receipt fee"));
    expect(feeInput.value).toBe("2.00");
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(feeInput, "5.00");
      feeInput.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const printLanguage = Array.from(controls.querySelectorAll("select"))
      .find((select) => Array.from(select.options).some((option) => option.value === "english"));
    printLanguage.value = "english";
    await act(async () => {
      printLanguage.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const senderAddress = Array.from(controls.querySelectorAll('input[type="checkbox"]'))
      .find((input) => input.getAttribute("aria-label") === "Include sender address in receipt");
    await act(async () => {     senderAddress.click();
    });
    const receiverPhone = controls.querySelector('[aria-label="Include receiver phone in receipt"]');
    await act(async () => { receiverPhone.click(); });
    const receiverAddress = controls.querySelector('[aria-label="Include receiver address in receipt"]');
    await act(async () => { receiverAddress.click(); });
    const overdueDaysInput = Array.from(controls.querySelectorAll('input[type="number"]'))
    .find((input) => input.closest("label").textContent.includes("Overdue after"));
    expect(overdueDaysInput.value).toBe("30");
    await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")
      .set.call(overdueDaysInput, "5");
    overdueDaysInput.dispatchEvent(new Event("input", { bubbles: true })); });
    const goodsInput = controls.querySelector('[aria-label="New goods suggestion"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")
        .set.call(goodsInput, "स्थानीय अनाज");
      goodsInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await act(async () => {
      controls.querySelector('[aria-label="New goods suggestion"]')
        .parentElement.querySelector("button").click();
    });
    expect(controls.textContent).toContain("स्थानीय अनाज");
    await act(async () => {
      controls.querySelector('[aria-label="Remove goods suggestion अनाज"]').click();
    });
    expect(controls.querySelector('[aria-label="Remove goods suggestion अनाज"]')).toBeNull();
    const englishWord = controls.querySelector('[aria-label="English word to translate"]');
    const hindiTranslation = controls.querySelector('[aria-label="Hindi translation"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")
        .set.call(englishWord, "bucket");
      englishWord.dispatchEvent(new Event("input", { bubbles: true }));
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")
        .set.call(hindiTranslation, "बाल्टी");
      hindiTranslation.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      Array.from(controls.querySelectorAll("button"))
        .find((button) => button.textContent.includes("Add translation")).click();
    });
    expect(controls.textContent).toContain("bucket");
    expect(controls.textContent).toContain("बाल्टी");
    const packagingCategory = Array.from(
      controls.querySelectorAll('[data-testid="transport-hindi-dictionary"] details'),
    ).find((details) => details.querySelector("summary").textContent.includes("Packaging & Units"));
    await act(async () => {
      packagingCategory.querySelector("summary").click();
    });
    const bagHindi = controls.querySelector('[aria-label="Hindi dictionary term Bag"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")
        .set.call(bagHindi, "थैला");
      bagHindi.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const bagAliases = controls.querySelector('[aria-label="Aliases for dictionary term Bag"]');
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")
        .set.call(bagAliases, "thaila; jhola");
      bagAliases.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const saveButton = Array.from(controls.querySelectorAll("button"))
      .find((button) => button.textContent.includes("Save booking settings"));
    await act(async () => {
      saveButton.click();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(api.put).toHaveBeenCalledWith("/sites/site-a", expect.objectContaining({
      config: expect.objectContaining({
        receipt_branding: expect.objectContaining({
          company_name: "नायडू गुड्स ट्रांसपोर्ट",
          contacts: [
            expect.objectContaining({
              label: "Nagpur", phone: "0000000000", phone_label: "(O)",
            }),
            expect.objectContaining({ label: "", phone: "", alternate_phone: "" }),
            expect.objectContaining({ label: "", phone: "", alternate_phone: "" }),
          ],
        }),
        goods_suggestions: expect.arrayContaining(["स्थानीय अनाज"]),
        hindi_dictionary: [{ english: "bucket", hindi: "बाल्टी" }],
        transport_hindi_dictionary_overrides: [expect.objectContaining({
          key: "Bag",
          english_name: "Bag",
          hindi_name: "थैला",
          aliases: expect.arrayContaining(["thaila", "jhola"]),
        })],
        receipt_controls: expect.objectContaining({
          party_name_hindi_enabled: false,
          owner_attention_enabled: true,
          receipt_language: "english",
          receipt_print_size: "58mm",
          receipt_fee: "5.00",
          overdue_after_days: 5,
        }),
      }),
    }));
    expect(api.put).toHaveBeenCalledWith("/booking/receipt-controls", {
      sender_address_enabled: false,
      receiver_address_enabled: false,
      receiver_phone_enabled: false,
    });
    const siteSettingsSave = api.put.mock.calls.find(([path]) => path === "/sites/site-a");
    expect(siteSettingsSave[1].config.goods_suggestions).not.toContain("अनाज");
  });
});
