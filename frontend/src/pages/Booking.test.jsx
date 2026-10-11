import { act } from "react";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { api } from "../lib/api";
import { registerBookingTestHarness } from "./Booking.testUtils";
import { matchingGoodsEntries, matchingGoodsSuggestions, romanHindi } from "./Booking";
jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  assetUrl: (value) => value || "",
  errMsg: (error) => error?.response?.data?.detail || "Request failed",
}));

describe("simple booking workflow", () => {
  const { container, site, trip, flushMicrotasks, getByLabelText, getByRole, clickButton,
    createLedgerRow, mockBookingApi, renderBooking, setInput } = registerBookingTestHarness();

  it("applies dictionary terms while preserving names, codes, and Hindi input", () => {
    expect(romanHindi("Ramesh")).toBe("Ramesh");
    expect(romanHindi("bucket", [{ english: "Bucket", hindi: "बाल्टी" }])).toBe("बाल्टी");
    expect(romanHindi("plastic bucket", [{ english: "bucket", hindi: "बाल्टी" }]))
      .toBe("प्लास्टिक बाल्टी");
    expect(romanHindi("plastic bucket", [
      { english: "plastic", hindi: "प्लास्टिक" },
      { english: "bucket", hindi: "बाल्टी" },
      { english: "plastic bucket", hindi: "विशेष अनुवाद" },
    ])).toBe("विशेष अनुवाद");
    expect(romanHindi("crate of plastic bucket", [
      { english: "plastic bucket", hindi: "प्लास्टिक बाल्टी" },
    ])).toContain("प्लास्टिक बाल्टी");
    expect(romanHindi("AB1234")).toBe("AB1234");
    expect(romanHindi("GPS")).toBe("GPS");
    expect(romanHindi("Samsung")).toBe("Samsung");
    expect(romanHindi("Suresh")).toBe("Suresh");
    expect(romanHindi("car")).toBe("कार");
    expect(romanHindi("HARDWARE")).toBe("हार्डवेयर");
    expect(romanHindi("Cement")).toBe("सीमेंट");
    expect(romanHindi("Food Grains")).toBe("अनाज");
    expect(romanHindi("AUTO")).toBe("ऑटो");
    expect(romanHindi("gadi bhada")).toBe("गाड़ी भाड़ा");
    expect(romanHindi("gaadi bhaada")).toBe("गाड़ी भाड़ा");
    expect(romanHindi("गाड़ी bhada")).toBe("गाड़ी भाड़ा");
    expect(romanHindi("vehicle rent")).toBe("गाड़ी भाड़ा");
    expect(romanHindi("hamali")).toBe("हमाली");
    expect(romanHindi("कपड़ा")).toBe("कपड़ा");
    expect(matchingGoodsSuggestions("s", ["सामान"])).toContain("सामान");
    expect(matchingGoodsSuggestions("sa", ["सामान"])).toContain("सामान");
    expect(matchingGoodsSuggestions("sam", ["सामान"])).toContain("सामान");
    expect(matchingGoodsSuggestions("cem", ["सीमेंट"])).toContain("सीमेंट");
    expect(matchingGoodsSuggestions("buck", [], [{ english: "bucket", hindi: "बाल्टी" }]))
      .toContain("बाल्टी");
    expect(matchingGoodsEntries("thaila").some((entry) =>
      entry.english === "Bag" && entry.hindi === "बोरा")).toBe(true);
    expect(matchingGoodsEntries("Bardana").some((entry) =>
      entry.english === "Gunny Bag" && entry.hindi === "बरदाना")).toBe(true);
    expect(matchingGoodsEntries("jhola", [], [], [{
      key: "Bag",
      english_name: "Bag",
      hindi_name: "थैला",
      hinglish_name: "Bora",
      aliases: ["thaila", "jhola"],
    }])).toEqual([expect.objectContaining({ english: "Bag", hindi: "थैला" })]);
    expect(matchingGoodsEntries("plastic bu", [], [
      { english: "plastic bucket", hindi: "विशेष अनुवाद" },
    ])).toEqual([expect.objectContaining({
      english: "plastic bucket", hindi: "विशेष अनुवाद",
    })]);
  });

  it("places the site selector between the page title and language controls", async () => {
    localStorage.setItem("booking_trip_id", trip.id);
    mockBookingApi({ trips: [trip] });
    await renderBooking("receipts", "owner");

    const header = container.querySelector(".booking-page-header");
    expect(header.children).toHaveLength(3);
    expect(header.children[0].textContent).toContain("Receipts");
    expect(header.children[1].classList.contains("booking-trip-ref")).toBe(true);
    expect(header.children[1].textContent).toContain(trip.trip_ref);
    expect(header.children[0].textContent).not.toContain(site.name);
    expect(header.children[2].querySelector(".booking-header-site label").textContent)
      .toContain("Site / Garage");
    expect(header.children[2].querySelector('[role="group"]').getAttribute("aria-label"))
      .toBe("Display language");
    expect(container.querySelectorAll(".booking-trip-ref")).toHaveLength(1);
    expect(container.querySelector(".booking-trip-ref").parentElement).toBe(header);
  });

  it("resizes ledger columns and keeps the date and receipt number on one line", async () => {
    localStorage.setItem("booking_site_id", site.id);
    mockBookingApi({
      trips: [trip],
      ledgerRows: [createLedgerRow({
        goods_rows: [{ type: "Tiles", quantity: 123, description: "Large order" }],
      })],
    });
    await renderBooking("ledger");
    const table = await screen.findByRole("table", { name: "Selected ledger totals" });
    await waitFor(() => expect(table.querySelector('[data-ledger-column="date"]')).not.toBeNull());
    const receiptColumn = table.querySelector("colgroup col:nth-child(2)");
    const resizeHandle = screen.getByRole("separator", { name: "Resize Receipt no. column" });

    expect(receiptColumn.style.width).toBe("170px");
    expect(table.querySelector('[data-ledger-column="date"]').className).toContain("whitespace-nowrap");
    expect(table.querySelector('[data-ledger-column="receipt"]').className).toContain("whitespace-nowrap");
    expect(table.querySelector('[data-ledger-column="goods"]').className).toContain("break-words");

    await act(async () => {
      resizeHandle.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, clientX: 100 }));
      window.dispatchEvent(new MouseEvent("pointermove", { bubbles: true, clientX: 160 }));
      window.dispatchEvent(new MouseEvent("pointerup", { bubbles: true }));
      await flushMicrotasks();
    });

    expect(Number.parseFloat(receiptColumn.style.width)).toBeGreaterThan(170);
    await waitFor(() => expect(JSON.parse(
      localStorage.getItem(`booking_ledger_column_widths:${encodeURIComponent(site.id)}`),
    ).receipt).toBe(230));
  });

  it("uses available ledger width to give long goods details room instead of leaving a blank edge", async () => {
    localStorage.setItem("booking_site_id", site.id);
    mockBookingApi({ trips: [trip], ledgerRows: [createLedgerRow()] });
    await renderBooking("ledger");
    const table = await screen.findByRole("table", { name: "Selected ledger totals" });
    await waitFor(() => expect(table.querySelector('[data-ledger-column="goods"]')).not.toBeNull());
    const wrapper = table.parentElement;
    Object.defineProperty(wrapper, "clientWidth", { configurable: true, value: 1600 });

    await act(async () => {
      window.dispatchEvent(new Event("resize"));
      await flushMicrotasks();
    });

    const columns = Array.from(table.querySelectorAll("colgroup col"));
    const tableWidth = columns.reduce((total, column) => total + Number.parseFloat(column.style.width), 0);
    const goodsColumnIndex = Array.from(table.querySelectorAll("thead th"))
      .findIndex((header) => header.textContent.includes("Goods & quantity"));
    expect(tableWidth).toBe(1600);
    expect(table.style.width).toBe("1600px");
    expect(Number.parseFloat(columns[goodsColumnIndex].style.width)).toBeGreaterThan(440);
  });

  describe("trip and receipt entry", () => {
  it("switches receipt entry to Hindi, remembers the choice, and keeps saved fields unchanged", async () => {
    api.post.mockImplementation((path, body) => Promise.resolve({
      data: path.endsWith("/lrs") ? { ...body, id: "lr-hi", lr_ref: "NGP-LR-HI" } : trip,
    }));
    await renderBooking();
    await clickButton("हिंदी");

    expect(localStorage.getItem("booking_language")).toBe("hi");
    expect(screen.getByRole("button", { name: "हिंदी" }).getAttribute("aria-pressed")).toBe("true");
    const dailySummary = screen.getByRole("region", { name: "आज के काम का सारांश" });
    expect(dailySummary.textContent).toContain("बाकी यात्राएँ");
    expect(dailySummary.textContent).toContain("बनी हुई रसीदें");
    expect(dailySummary.textContent).toContain("अभी लेना बाकी");
    expect(dailySummary.querySelector(".booking-today-summary-metrics")).not.toBeNull();
    expect(dailySummary.textContent).not.toContain("अब यह करें");
    await clickButton("यात्रा बनाएँ");
    await act(async () => {
      container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });

    expect(getByLabelText("प्राप्तकर्ता का नाम")).not.toBeNull();
    expect(getByLabelText("सामान का नाम · 1").placeholder).toBe("सामान का नाम");
    expect(getByLabelText("मात्रा · 1").placeholder).toBe("मात्रा");
    expect(container.textContent).toContain("कुल रकम");

    await act(async () => {
      setInput("प्राप्तकर्ता का नाम", "Suresh");
      setInput("Receiver name in Hindi", "सुरेश");
      setInput("सामान का नाम · 1", "Cement");
      setInput("मात्रा · 1", "3");
    });
    await act(async () => {
      screen.getByRole("button", { name: "रसीद सेव करें", exact: true }).click();
      await flushMicrotasks();
    });
    await waitFor(() => expect(api.post.mock.calls.some(([path]) => path.endsWith("/lrs"))).toBe(true));

    const [, submittedReceipt] = api.post.mock.calls.find(([path]) => path.endsWith("/lrs"));
    expect(submittedReceipt.receiver_name).toBe("Suresh");
    expect(submittedReceipt.receiver_name_hindi).toBe("सुरेश");
    expect(submittedReceipt.receipt_date).toBe(trip.operating_date);
    expect(submittedReceipt.goods_rows).toEqual([{ type: "Cement", type_hindi: "सीमेंट", description: "", description_hindi: "", quantity: 3 }]);
  });

  it("creates a trip without vehicle or driver, then starts with one goods row", async () => {
    api.get.mockImplementation((path) => {
      if (path === "/sites") return Promise.resolve({ data: [{
        ...site, config: { goods_suggestions: ["स्थानीय अनाज", "सीमेंट"] },
      }] });
      if (path === `/sites/${site.id}/trips`) return Promise.resolve({ data: { rows: [], total: 0 } });
      if (path === `/sites/${site.id}/trips/${trip.id}/lrs`) return Promise.resolve({ data: { rows: [], total: 0 } });
      return Promise.resolve({ data: trip });
    });
    await renderBooking();
    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent.includes("Create Trip")).click();
    });
    expect(container.querySelector("form .sticky.bottom-0")).not.toBeNull();
    await act(async () => {
      container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });

    expect(api.post).toHaveBeenCalledWith(`/sites/${site.id}/trips`, {
      operating_date: expect.any(String), truck_no: "", driver_name: "",
    });
    expect(container.textContent).toContain("New receipt");
    expect(container.querySelector(".receipt-form-title").textContent).toContain("New receipt");
    const receiptActions = container.querySelector("#receipt-entry-form .receipt-form-actions");
    expect(Array.from(receiptActions.children,
      (button) => button.getAttribute("aria-label"))).toEqual([
      "Save receipt", "Print paper (saves receipt first)", "Cancel receipt",
    ]);
    expect(Array.from(receiptActions.querySelectorAll(".receipt-action-label-mobile"),
      (label) => label.textContent)).toEqual(["Save", "Print", "Cancel"]);
    const printButton = container.querySelector(".receipt-print-action");
    expect(printButton.getAttribute("aria-label")).toBe("Print paper (saves receipt first)");
    expect(container.querySelector(".receipt-form-heading-line").textContent).toContain(trip.trip_ref);
    expect(container.querySelector(".receipt-form-heading-line").nextElementSibling.textContent)
      .toBe("29-09-2026");
    expect(getByLabelText("Receipt date").value).toBe(trip.operating_date);
    expect(getByLabelText("Receipt date").disabled).toBe(true);
    expect(container.querySelectorAll(".receipt-form-trip")).toHaveLength(1);
    expect(container.querySelector(".receipt-form-card .receipt-total-heading")).not.toBeNull();
    const senderDateCityRow = container.querySelector('[aria-label="Sender name in English"]').closest(".grid");
    expect(Array.from(senderDateCityRow.querySelectorAll("label .lbl"), (label) => label.textContent.trim()))
      .toEqual(["Sender (optional)", "Receipt date", "Receiver city"]);
    expect(senderDateCityRow.className).toContain("md:grid-cols-3");
    const receiverAndPhoneRow = container.querySelector('[aria-label="Receiver name in English"]').closest(".grid");
    expect(Array.from(receiverAndPhoneRow.querySelectorAll("label .lbl"), (label) => label.textContent.trim()))
      .toEqual(["Receiver *", "Receiver phone (10 digits, optional)"]);
    expect(receiverAndPhoneRow.className).toContain("md:grid-cols-2");
    expect(container.querySelector('[aria-label="Trip number"]')).toBeNull();
    expect(container.querySelectorAll('[aria-label^="Goods and description row "]')).toHaveLength(3);
    expect(container.querySelectorAll('[aria-label^="Quantity row "]')).toHaveLength(3);
    expect(container.querySelector('[aria-label="Goods and description row 1"]').parentElement.parentElement.parentElement.className)
      .toContain("grid-cols-[8.5rem_minmax(0,1fr)_2.25rem]");
    expect(container.querySelector('[aria-label="Goods and description row 1"]').placeholder)
      .toBe("Goods and description");
    expect(container.querySelector('[aria-label="Quantity row 1"]').placeholder).toBe("Quantity");
    const quantityInput = container.querySelector('[aria-label="Quantity row 1"]');
    const goodsInput = container.querySelector('[aria-label="Goods and description row 1"]');
    expect(quantityInput.compareDocumentPosition(goodsInput)
      & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(container.querySelector('[aria-label="Goods and description row 1"]').parentElement.className)
      .toContain("relative block");
    expect(container.querySelector('[aria-label="Quantity row 1"]').parentElement.querySelector("svg").className.baseVal)
      .toContain("top-1/2");
    expect(container.querySelector("#receipt-entry-form .sticky.bottom-0")).not.toBeNull();
    expect(container.querySelector("#receipt-entry-form .receipt-form-actions")).not.toBeNull();
    expect(container.querySelector('[aria-label="Receipt Bhada"]').value).toBe("0");
    expect(container.querySelector('[aria-label="Receipt Hamali"]').value).toBe("0");
    expect(container.textContent).toContain("Bhada (₹)");
    expect(container.textContent).toContain("Hamali (₹)");
    const receiptTotal = container.querySelector(".receipt-total-summary");
    expect(receiptTotal.querySelector(".receipt-total-heading")).not.toBeNull();
    expect(receiptTotal.querySelector(".receipt-total-breakdown").children).toHaveLength(3);
    expect(receiptTotal.querySelector(".receipt-grand-total").textContent).toContain("₹2");
    const receiverAddress = container.querySelector('[aria-label="Receiver address (optional)"]');
    const receiverPhone = container.querySelector('[aria-label="Receiver phone (10 digits, optional)"]');
    expect(receiverAndPhoneRow.contains(receiverPhone)).toBe(true);
    expect(receiverAndPhoneRow.contains(receiverAddress)).toBe(false);
    expect(receiverAddress.parentElement.parentElement.className).toBe("grid gap-3");
    fireEvent.focus(getByLabelText("Goods and description row 1"));
    fireEvent.change(getByLabelText("Goods and description row 1"), { target: { value: "सीमेंट" } });
    const goodsSuggestions = screen.getByRole("listbox", { name: "Suggestions for goods row 1" });
    expect(goodsSuggestions.className).toContain("w-full");
    expect(goodsSuggestions.className).toContain("bg-white");
    expect(goodsSuggestions.textContent).toContain("सीमेंट");
  });

  it("selects the canonical English and Hindi terms from the goods dictionary", async () => {
    const existingReceipt = createLedgerRow({
      sender_name: "Sender", receiver_name: "Receiver",
      goods_rows: [{ type: "s", type_hindi: "चीनी", quantity: 2 }],
    });
    let persistedReceipt = existingReceipt;
    api.get.mockImplementation((path) => {
      if (path === "/sites") return Promise.resolve({ data: [site] });
      if (path === `/sites/${site.id}/trips`) return Promise.resolve({ data: { rows: [trip], total: 1 } });
      if (path === `/sites/${site.id}/trips/${trip.id}/lrs`) {
        return Promise.resolve({ data: { rows: [persistedReceipt], total: 1 } });
      }
      return Promise.resolve({ data: trip });
    });
    api.patch.mockImplementation((_path, body) => Promise.resolve({
      data: (persistedReceipt = { ...existingReceipt, ...body, updated_at: "version-2" }),
    }));
    localStorage.setItem("booking_trip_id", trip.id);
    await renderBooking("receipts");
    await waitFor(() => expect(Array.from(container.querySelectorAll("button"))
      .some((button) => button.textContent === "Edit")).toBe(true));
    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent === "Edit").click();
    });

    const goodsInput = getByLabelText("Goods and description row 1");
    expect(goodsInput.value).toBe("s");
    fireEvent.focus(goodsInput);
    fireEvent.change(goodsInput, { target: { value: "s" } });
    const listbox = screen.getByRole("listbox", { name: "Suggestions for goods row 1" });
    expect(within(listbox).getByRole("option", { name: "चीनी" })).not.toBeNull();
    await act(async () => {
      fireEvent.click(within(listbox).getByRole("option", { name: "चीनी" }));
    });
    expect(goodsInput.value).toBe("Sugar");
    expect(getByLabelText("Goods in Hindi row 1").value).toBe("चीनी");
    expect(screen.queryByRole("listbox", { name: "Suggestions for goods row 1" })).toBeNull();

    await act(async () => {
      screen.getByRole("button", { name: "Save changes", exact: true }).click();
      await flushMicrotasks();
    });
    expect(api.patch).toHaveBeenCalledWith(
      `/sites/${site.id}/trips/${trip.id}/lrs/${existingReceipt.id}`,
      expect.objectContaining({
        goods_rows: [expect.objectContaining({
          type: "Sugar", type_hindi: "चीनी", quantity: 2,
        })],
      }),
    );
    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent === "Edit").click();
    });
    expect(getByLabelText("Goods and description row 1").value).toBe("Sugar");
  });

  it("supports arrow-key and Enter selection for goods suggestions", async () => {
    await renderBooking();
    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent.includes("Create Trip")).click();
    });
    await act(async () => {
      container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });

    const goodsInput = getByLabelText("Goods and description row 1");
    await act(async () => {
      fireEvent.focus(goodsInput);
      fireEvent.change(goodsInput, { target: { value: "sam" } });
    });
    await act(async () => fireEvent.keyDown(goodsInput, { key: "ArrowDown" }));
    expect(screen.getByRole("option", { name: "सामान" }).getAttribute("aria-selected")).toBe("true");
    await act(async () => fireEvent.keyDown(goodsInput, { key: "Enter" }));
    expect(goodsInput.value).toBe("saman");
    expect(getByLabelText("Goods in Hindi row 1").value).toBe("सामान");
  });

  it("finds Hinglish dictionary aliases and selects the canonical English and Hindi terms", async () => {
    const customizedSite = {
      ...site,
      config: {
        transport_hindi_dictionary_overrides: [{
          key: "Bag",
          english_name: "Bag",
          hindi_name: "थैला",
          hinglish_name: "Bora",
          aliases: ["thaila", "jhola"],
        }],
      },
    };
    mockBookingApi({ sites: [customizedSite] });
    await renderBooking();
    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent.includes("Create Trip")).click();
    });
    await act(async () => {
      container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });

    const goodsInput = getByLabelText("Goods and description row 1");
    await act(async () => {
      fireEvent.focus(goodsInput);
      fireEvent.change(goodsInput, { target: { value: "thaila" } });
    });
    const listbox = screen.getByRole("listbox", { name: "Suggestions for goods row 1" });
    await act(async () => {
      fireEvent.click(within(listbox).getByRole("option", { name: "थैला" }));
    });
    expect(goodsInput.value).toBe("Bag");
    expect(getByLabelText("Goods in Hindi row 1").value).toBe("थैला");
  });

  it("removes goods rows with the X button and restores three blank rows", async () => {
    await renderBooking();
    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent.includes("Create Trip")).click();
    });
    await act(async () => {
      container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });
    expect(container.querySelectorAll('[aria-label^="Goods and description row "]')).toHaveLength(3);
    await act(async () => {
      container.querySelector('[aria-label="Remove goods row 2"]').click();
    });
    expect(container.querySelectorAll('[aria-label^="Goods and description row "]')).toHaveLength(2);
    await act(async () => {
      container.querySelector('[aria-label="Remove goods row 1"]').click();
    });
    expect(container.querySelectorAll('[aria-label^="Goods and description row "]')).toHaveLength(1);
    await act(async () => {
      container.querySelector('[aria-label="Remove goods row 1"]').click();
    });
    expect(container.querySelectorAll('[aria-label^="Goods and description row "]')).toHaveLength(3);
  });

  it("rejects missing or fractional receipt goods without sending a request", async () => {
    await renderBooking();
    await clickButton("Create Trip");
    await act(async () => {
      container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });
    await waitFor(() => expect(getByLabelText("Receiver name in English")).not.toBeNull());

    await clickButton("Save receipt");
    expect(screen.getByRole("alert").textContent)
      .toContain("Enter the receiver and at least one goods row.");
    expect(api.post.mock.calls.some(([path]) => path.endsWith("/lrs"))).toBe(false);

    await act(async () => {
      setInput("Receiver name in English", "Suresh");
      setInput("Goods and description row 1", "Cement");
      setInput("Quantity row 1", "1.5");
    });
    await clickButton("Save receipt");
    expect(screen.getByRole("alert").textContent)
      .toContain("Goods quantity must be a whole number greater than zero.");
    expect(api.post.mock.calls.some(([path]) => path.endsWith("/lrs"))).toBe(false);
  });

  it("recovers a locally saved receipt draft after closing and reopening the form", async () => {
    localStorage.setItem("booking_site_id", site.id);
    localStorage.setItem("booking_trip_id", trip.id);
    mockBookingApi({ trips: [trip] });
    await renderBooking("receipts");
    await waitFor(() => expect(getByLabelText("Receiver name in English")).not.toBeNull());
    await act(async () => {
      setInput("Receiver name in English", "Suresh");
      setInput("Goods and description row 1", "Cement");
      setInput("Quantity row 1", "3");
    });

    const draftKey = `booking_receipt_draft:${encodeURIComponent(site.id)}:${encodeURIComponent(trip.id)}:Manager%20Name`;
    await waitFor(() => expect(JSON.parse(localStorage.getItem(draftKey)).form.receiver_name).toBe("Suresh"));
    expect(screen.getByText("Draft saved locally on this device.")).not.toBeNull();

    await clickButton("Cancel receipt");
    await clickButton("New receipt");
    await waitFor(() => expect(screen.getByText(/A saved receipt draft is available/)).not.toBeNull());
    await clickButton("Resume draft");
    expect(getByLabelText("Receiver name in English").value).toBe("Suresh");
    expect(getByLabelText("Goods and description row 1").value).toBe("Cement");
    expect(getByLabelText("Quantity row 1").value).toBe("3");
    expect(api.post.mock.calls.some(([path]) => path.endsWith("/lrs"))).toBe(false);
  });

  it("lets the user discard an unreadable local receipt draft", async () => {
    localStorage.setItem("booking_site_id", site.id);
    localStorage.setItem("booking_trip_id", trip.id);
    const draftKey = `booking_receipt_draft:${encodeURIComponent(site.id)}:${encodeURIComponent(trip.id)}:Manager%20Name`;
    localStorage.setItem(draftKey, "{malformed");
    mockBookingApi({ trips: [trip] });
    await renderBooking("receipts");

    await waitFor(() => expect(screen.getByRole("button", { name: "Discard unreadable draft" })).not.toBeNull());
    expect(screen.queryAllByText(/A saved receipt draft could not be read/).length).toBeGreaterThan(0);
    await clickButton("Discard unreadable draft");
    expect(localStorage.getItem(draftKey)).toBeNull();
    expect(screen.queryAllByText(/A saved receipt draft could not be read/)).toHaveLength(0);
    expect(getByLabelText("Receiver name in English").value).toBe("");
  });

  it("does not offer a saved draft belonging to a different trip or user", async () => {
    localStorage.setItem("booking_site_id", site.id);
    localStorage.setItem("booking_trip_id", trip.id);
    const otherTripDraftKey =
      `booking_receipt_draft:${encodeURIComponent(site.id)}:trip-2:Manager%20Name`;
    const otherUserDraftKey =
      `booking_receipt_draft:${encodeURIComponent(site.id)}:${encodeURIComponent(trip.id)}:Owner%20Name`;
    const savedForm = {
      receipt_date: trip.operating_date, sender_name: "", sender_address: "",
      receiver_name: "Other person", receiver_address: "", receiver_phone: "",
      rent: "0", hamali: "0",
      goods_rows: [{ type: "", type_hindi: "", description: "", description_hindi: "", quantity: "" }],
    };
    localStorage.setItem(otherTripDraftKey, JSON.stringify({ version: 1, form: savedForm }));
    localStorage.setItem(otherUserDraftKey, JSON.stringify({ version: 1, form: savedForm }));
    mockBookingApi({ trips: [trip] });
    await renderBooking("receipts");

    await waitFor(() => expect(getByLabelText("Receiver name in English")).not.toBeNull());
    expect(screen.queryByText(/A saved receipt draft is available/)).toBeNull();
    expect(getByLabelText("Receiver name in English").value).toBe("");
    expect(localStorage.getItem(otherTripDraftKey)).not.toBeNull();
    expect(localStorage.getItem(otherUserDraftKey)).not.toBeNull();
  });

  it("suggests past receivers and fills their saved phone number without a copy-receipt action", async () => {
    const previousReceipt = {
      id: "lr-previous", lr_ref: "NGP-LR-01", receiver_name: "Suresh",
      receiver_phone: "9876543210", sender_name: "Ramesh", rent: "500",
      hamali: "25", goods_rows: [{ type: "Cement", type_hindi: "सीमेंट", quantity: 4 }],
    };
    localStorage.setItem("booking_site_id", site.id);
    localStorage.setItem("booking_trip_id", trip.id);
    mockBookingApi({ trips: [trip], receipts: [previousReceipt] });
    await renderBooking("receipts");
    const receiverInput = getByLabelText("Receiver name in English");
    await waitFor(() => expect(receiverInput.getAttribute("list")).toBe("previous-receiver-options"));
    expect(Array.from(container.querySelectorAll("#previous-receiver-options option"))
      .map((option) => option.value)).toContain("Suresh");
    fireEvent.change(receiverInput, { target: { value: "Suresh" } });
    expect(getByLabelText("Receiver name in English").value).toBe("Suresh");
    expect(getByLabelText("Receiver phone (10 digits, optional)").value).toBe("9876543210");

    expect(screen.queryByRole("button", { name: /Copy previous receipt/i })).toBeNull();
    expect(getByLabelText("Sender name in English").value).toBe("");
    expect(getByLabelText("Receiver name in English").value).toBe("Suresh");
    expect(getByLabelText("Goods and description row 1").value).toBe("");
    expect(getByLabelText("Quantity row 1").value).toBe("");
    expect(getByLabelText("Receipt Bhada").value).toBe("0");
    expect(getByLabelText("Receipt Hamali").value).toBe("0");
    expect(api.post.mock.calls.some(([path]) => path.endsWith("/lrs"))).toBe(false);
  });

  it("reloads booking receipt controls and hides saved addresses and phone on older receipts", async () => {
    let globalReceiptControls = {
      sender_address_enabled: true, receiver_address_enabled: true, receiver_phone_enabled: true,
    };
    let configuredSite = {
      ...site,
      config: { receipt_controls: {
        receipt_print_size: "80mm",
        sender_address_enabled: true, receiver_address_enabled: true, receiver_phone_enabled: true,
      }, receipt_branding: {
        contacts: [
          { label: "Nagpur", phone: "2767741", phone_label: "(O)" },
          { label: "Wadi", phone: "9420681470" },
          { label: "Hinganghat", phone: "244240", phone_label: "(O)", alternate_phone: "9764424190", alternate_phone_label: "(G)" },
        ],
      } },
    };
    const savedReceipt = {
      id: "lr-existing", lr_ref: "NGP-LR-OLD", sender_name: "Ramesh",
      sender_address: "Sender Road", receiver_name: "Suresh",
      receiver_address: "Receiver Road", receiver_phone: "9876543210",
      goods_rows: [{ type: "Rice", quantity: 2 }],
    };
    localStorage.setItem("booking_site_id", site.id);
    localStorage.setItem("booking_trip_id", trip.id);
    api.get.mockImplementation((path) => {
      if (path === "/booking/receipt-controls") return Promise.resolve({ data: globalReceiptControls });
      if (path === "/sites") return Promise.resolve({ data: [configuredSite] });
      if (path === `/sites/${site.id}/trips`) {
        return Promise.resolve({ data: { rows: [trip], total: 1 } });
      }
      if (path === `/sites/${site.id}/trips/${trip.id}/lrs`) {
        return Promise.resolve({ data: { rows: [savedReceipt], total: 1 } });
      }
      return Promise.resolve({ data: trip });
    });
    const printSpy = jest.spyOn(window, "print").mockImplementation(() => {});
    const receiptHeightSpy = jest.spyOn(Element.prototype, "getBoundingClientRect")
      .mockReturnValue({ height: 480 });
    const popupSpy = jest.spyOn(window, "open");

    await renderBooking("receipts");
    await waitFor(() => expect(container.textContent).toContain("9876543210"));
    globalReceiptControls = {
      sender_address_enabled: false, receiver_address_enabled: false, receiver_phone_enabled: false,
    };
    configuredSite = {
      ...site,
      config: { receipt_controls: {
        receipt_print_size: "80mm",
        sender_address_enabled: true, receiver_address_enabled: true, receiver_phone_enabled: true,
      }, receipt_branding: {
        contacts: [
          { label: "Nagpur", phone: "2767741", phone_label: "(O)" },
          { label: "Wadi", phone: "9420681470" },
          { label: "Hinganghat", phone: "244240", phone_label: "(O)", alternate_phone: "9764424190", alternate_phone_label: "(G)" },
        ],
      } },
    };
    await act(async () => {
      window.dispatchEvent(new Event("fms:refresh"));
      await flushMicrotasks();
    });

    await waitFor(() => expect(container.textContent).not.toContain("9876543210"));
    expect(container.querySelector('[aria-label="Sender address (optional)"]')).toBeNull();
    expect(container.querySelector('[aria-label="Receiver address (optional)"]')).toBeNull();
    expect(container.querySelector('[aria-label="Receiver phone (10 digits, optional)"]')).toBeNull();
    expect(api.get.mock.calls.filter(([path]) => path === "/sites")).toHaveLength(2);
    expect(api.get.mock.calls.filter(([path]) => path === "/booking/receipt-controls")).toHaveLength(2);
    await act(async () => {
      screen.getByRole("button", { name: "Print", exact: true }).click();
      await flushMicrotasks();
    });
    await waitFor(() => expect(document.querySelector(".booking-print-portal img")).not.toBeNull());
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 400)));
    await act(async () => fireEvent.load(document.querySelector(".booking-print-portal img")));
    const printReceipt = document.querySelector(".booking-print-portal .transport-lr");
    expect(receiptHeightSpy).toHaveBeenCalled();
    await waitFor(() => expect(printSpy).toHaveBeenCalled());
    expect(printReceipt.getAttribute("data-print-size")).toBe("80mm");
    expect(printReceipt.classList.contains("transport-lr--thermal-80")).toBe(true);
    const thermalPrintPageRule = Array.from(container.querySelectorAll("style"))
      .find((style) => style.textContent.includes("@page { size: 80mm "));
    expect(thermalPrintPageRule.textContent).toContain("@page { size: 80mm 129mm; margin: 0; }");
    expect(document.querySelector(".booking-print-portal").style.position).toBe("fixed");
    expect(printReceipt.textContent).toContain("NGP-LR-OLD");
    expect(printReceipt.textContent).not.toContain("Sender Road");
    expect(printReceipt.textContent).not.toContain("Receiver Road");
    expect(printReceipt.textContent).not.toContain("9876543210");
    expect(printReceipt.querySelector(".transport-lr-contacts").textContent)
      .toContain("Nagpur: (O) 2767741");
    expect(printReceipt.querySelector(".transport-lr-contacts").textContent)
      .toContain("Hinganghat: (O) 244240 · (G) 9764424190");
    expect(Array.from(container.querySelectorAll("style")).some((style) =>
      style.textContent.includes(".booking-print-target .transport-lr-header { display:flex !important; }")))
      .toBe(true);
    expect(popupSpy).not.toHaveBeenCalled();

    await act(async () => window.dispatchEvent(new Event("afterprint")));
    receiptHeightSpy.mockRestore();
    printSpy.mockRestore();
    popupSpy.mockRestore();
  });

  it("searches receipts and filters payment and void status", async () => {
    const receiptRows = [
      { id: "lr-paid", lr_ref: "NGP-LR-PAID", receiver_name: "Geeta",
        rent: "100", hamali: "0", receipt_fee: "2", paid_total: "102", outstanding: "0",
        payment_status: "paid", goods_rows: [{ type: "Rice", quantity: 1 }] },
      { id: "lr-unpaid", lr_ref: "NGP-LR-UNPAID", receiver_name: "Asha", receiver_phone: "1111111111",
        rent: "100", hamali: "0", receipt_fee: "2", paid_total: "0", outstanding: "102",
        payment_status: "unpaid", goods_rows: [{ type: "Cement", quantity: 1 }] },
      { id: "lr-partial", lr_ref: "NGP-LR-PARTIAL", sender_name_hindi: "अनीकेत",
        receiver_name_hindi: "सुरेश", receiver_phone: "2222222222",
        rent: "100", hamali: "0", receipt_fee: "2", paid_total: "40", outstanding: "62",
        payment_status: "partial", goods_rows: [{ type: "Grain", type_hindi: "अनाज", quantity: 2 }] },
      { id: "lr-unpriced", lr_ref: "NGP-LR-UNPRICED", receiver_name: "Mohan",
        payment_status: "unpriced", goods_rows: [{ type: "Steel", quantity: 3 }] },
      { id: "lr-voided", lr_ref: "NGP-LR-VOID", receiver_name: "Ramesh", voided: true,
        rent: "100", hamali: "0", receipt_fee: "2", paid_total: "0", outstanding: "102",
        payment_status: "unpaid", goods_rows: [{ type: "Steel", quantity: 3 }] },
    ];
    localStorage.setItem("booking_site_id", site.id);
    localStorage.setItem("booking_trip_id", trip.id);
    mockBookingApi({ trips: [trip], receipts: receiptRows });
    await renderBooking("receipts");
    await waitFor(() => expect(container.textContent).toContain("NGP-LR-PARTIAL"));
    const paymentSummary = Array.from(container.querySelectorAll(".receipt-payment-summary"))
      .find((summary) => summary.textContent.includes("₹40") && summary.textContent.includes("₹62"));
    expect(paymentSummary.children).toHaveLength(3);
    expect(Array.from(paymentSummary.querySelectorAll(".receipt-payment-metric"), (metric) =>
      metric.querySelector("strong").textContent)).toEqual(["₹102", "₹40", "₹62"]);
    expect(paymentSummary.textContent).toContain("Due:");
    expect(container.textContent).toContain("Pending payment");
    expect(container.textContent).toContain("Partially paid");
    expect(container.textContent).toContain("Paid");
    expect(container.textContent).toContain("Unpriced");
    const partialCard = Array.from(container.querySelectorAll(".receipt-list-card"))
      .find((card) => card.textContent.includes("NGP-LR-PARTIAL"));
    expect(partialCard.querySelector(".receipt-list-primary").textContent)
      .toContain("NGP-LR-PARTIALअनीकेत → सुरेश");
    expect(partialCard.querySelector(".receipt-list-primary").textContent).toContain("2222222222");
    expect(partialCard.querySelector(".receipt-list-parties").textContent).toBe("अनीकेत → सुरेश");
    expect(partialCard.querySelector(".receipt-list-goods").textContent).toContain("२ - अनाज");
    expect(partialCard.querySelector(".receipt-list-print-group .receipt-payment-status"))
      .toBeTruthy();
    expect(partialCard.querySelector(".receipt-list-print-group .receipt-payment-status").nextElementSibling.textContent)
      .toContain("Print");
    expect(paymentSummary.parentElement).toBe(partialCard.querySelector(".receipt-list-content"));
    expect(partialCard.querySelector(".receipt-list-secondary").nextElementSibling).toBe(paymentSummary);
    expect(partialCard.querySelector(".receipt-list-actions")).not.toBeNull();
    expect(container.textContent).toContain("VOID");
    expect(container.querySelector("svg.lucide-circle-check")).not.toBeNull();
    expect(Array.from(container.querySelectorAll("svg"), (icon) => icon.getAttribute("class")))
      .toEqual(expect.arrayContaining([expect.stringContaining("clock")]));
    expect(container.querySelector("svg.lucide-circle-help")).not.toBeNull();
    expect(container.querySelector("svg.lucide-ban")).not.toBeNull();

    fireEvent.change(screen.getByLabelText("Filter receipts by payment status"), {
      target: { value: "partial" },
    });
    expect(container.textContent).toContain("NGP-LR-PARTIAL");
    expect(container.textContent).not.toContain("NGP-LR-UNPAID");
    expect(container.textContent).not.toContain("NGP-LR-UNPRICED");

    fireEvent.change(screen.getByLabelText("Filter receipts by payment status"), {
      target: { value: "all" },
    });
    expect(container.textContent).toContain("Unpriced");
    fireEvent.change(screen.getByLabelText("Filter receipts by payment status"), {
      target: { value: "unpriced" },
    });
    expect(container.textContent).toContain("NGP-LR-UNPRICED");
    expect(container.textContent).not.toContain("NGP-LR-PARTIAL");
    fireEvent.change(screen.getByLabelText("Filter receipts by payment status"), {
      target: { value: "all" },
    });
    fireEvent.change(screen.getByLabelText("Search receipts"), { target: { value: "2222222222" } });
    expect(container.textContent).toContain("NGP-LR-PARTIAL");
    expect(container.textContent).not.toContain("NGP-LR-UNPAID");

    fireEvent.change(screen.getByLabelText("Search receipts"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Filter receipts by receipt status"), {
      target: { value: "voided" },
    });
    expect(container.textContent).toContain("NGP-LR-VOID");
    expect(container.textContent).not.toContain("NGP-LR-PARTIAL");

    fireEvent.change(screen.getByLabelText("Filter receipts by payment status"), {
      target: { value: "partial" },
    });
    expect(container.textContent).toContain("No receipts match these filters.");
  });

  it("keeps an unsaved receipt available for retry after reconnecting", async () => {
    api.post.mockImplementation((path) => Promise.resolve({
      data: path.endsWith("/lrs")
        ? { id: "lr-1", lr_ref: "NGP-LR-01", receipt_fee: "2.00" }
        : trip,
    }));

    await renderBooking();
    await clickButton("Create Trip");
    await act(async () => {
      container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });
    await waitFor(() => expect(getByLabelText("Receiver name in English")).not.toBeNull());
    await act(async () => {
      setInput("Receiver name in English", "Suresh");
      setInput("Goods and description row 1", "Cement");
      setInput("Quantity row 1", "3");
      Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
    });

    await clickButton("Save receipt");
    expect(container.querySelector('[role="alert"]').textContent)
      .toContain("Offline — receipt not saved.");
    expect(api.post.mock.calls.some(([path]) => path.endsWith("/lrs"))).toBe(false);

    Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
    await clickButton("Save receipt");
    await waitFor(() => expect(api.post.mock.calls.some(([path]) => path.endsWith("/lrs"))).toBe(true));
    await waitFor(() => expect(container.textContent).toContain("Saved"));
  });

  it("saves English receipt data and resets the form after a successful save", async () => {
    const printSpy = jest.spyOn(window, "print").mockImplementation(() => {});
    const popupSpy = jest.spyOn(window, "open");
    const pendingReceiptRefreshes = [];
    api.get.mockImplementation((path) => {
      if (path === "/sites") return Promise.resolve({ data: [{
        ...site,
        config: { receipt_controls: {
          sender_address_enabled: false, receiver_address_enabled: false,
        } },
      }] });
      if (path === `/sites/${site.id}/trips`) return Promise.resolve({ data: { rows: [], total: 0 } });
      if (path.endsWith("/lrs")) {
        return new Promise((resolve) => pendingReceiptRefreshes.push(resolve));
      }
      return Promise.resolve({ data: trip });
    });
    const createdAt = "2026-09-29T07:04:05+00:00";
    api.post.mockImplementation((path, body) => Promise.resolve({
      data: path.endsWith("/lrs")
        ? {
          ...body, id: "lr-1", lr_ref: "NGP-LR-01", receipt_fee: "2.00",
          total_rent: "37.00", receipt_created_at: createdAt,
          sender_address: "Old Sender Road", sender_address_hindi: "पुराना प्रेषक पता",
          receiver_address: "Old Receiver Road", receiver_address_hindi: "पुराना प्राप्तकर्ता पता",
        }
        : trip,
    }));
    await renderBooking();
    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent.includes("Create Trip")).click();
    });
    await act(async () => {
      container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });
    expect(container.querySelector('[aria-label="Sender address (optional)"]')).toBeNull();
    expect(container.querySelector('[aria-label="Receiver address (optional)"]')).toBeNull();
    await act(async () => {
      setInput('[aria-label="Receiver name in English"]', "Suresh");
      setInput('[aria-label="Goods and description row 1"]', "Cement");
      setInput('[aria-label="Goods in Hindi row 1"]', "सीमेंट की बोरी");
      setInput('[aria-label="Quantity row 1"]', "3");
      setInput('[aria-label="Receipt Bhada"]', "30.00");
      setInput('[aria-label="Receipt Hamali"]', "5.00");
      setInput('[aria-label="Receiver phone (10 digits, optional)"]', "98765432109");
    });
    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent.includes("Print paper")).click();
    });
    expect(container.querySelector('[role="dialog"][aria-label="Lorry receipt preview"]')).toBeNull();
    await waitFor(() => expect(document.querySelector(".booking-print-portal img")).not.toBeNull());
    await act(async () => new Promise((resolve) => window.setTimeout(resolve, 400)));
    await act(async () => fireEvent.load(document.querySelector(".booking-print-portal img")));
    await waitFor(() => expect(printSpy).toHaveBeenCalled());
    expect(popupSpy).not.toHaveBeenCalled();

    const receiptRequest = api.post.mock.calls.find(([path]) => path.endsWith("/lrs"));
    expect(receiptRequest[1]).toMatchObject({
      sender_name: "",
      receiver_name: "Suresh",
      receiver_name_hindi: "",
      receiver_phone: "9876543210",
      city: "Hinganghat",
      goods_rows: [{
        type: "Cement", type_hindi: "सीमेंट की बोरी", description: "",
        description_hindi: "", quantity: 3,
      }],
      rent: "30.00",
      hamali: "5.00",
    });
    expect(receiptRequest[1]).not.toHaveProperty("sender_phone");
    expect(receiptRequest[1]).not.toHaveProperty("sender_address");
    expect(receiptRequest[1]).not.toHaveProperty("receiver_address");
    expect(receiptRequest[1]).not.toHaveProperty("receipt_created_at");
    const printedReceipt = document.querySelector(".booking-print-portal .transport-lr");
    expect(printedReceipt.textContent).not.toContain("Roof repair bags");
    expect(printedReceipt.textContent).toContain("३");
    expect(printedReceipt.textContent).toContain("सीमेंट");
    expect(printedReceipt.textContent).toContain("9876543210");
    expect(printedReceipt.textContent).not.toContain("Old Sender Road");
    expect(printedReceipt.textContent).not.toContain("Old Receiver Road");
    expect(printedReceipt.textContent).toContain("Suresh");
    expect(printedReceipt.textContent).toContain("Mama Garage");
    expect(container.querySelector('[aria-label="Receiver name in English"]').value).toBe("");
    expect(container.querySelector('[aria-label="Goods and description row 1"]').value).toBe("");
    expect(printedReceipt.textContent).toContain("30");
    expect(printedReceipt.textContent).toContain("5");
    expect(printedReceipt.textContent).toContain("37");
    await act(async () => window.dispatchEvent(new Event("afterprint")));
    await act(async () => {
      pendingReceiptRefreshes.forEach((resolve) => resolve({ data: { rows: [], total: 0 } }));
      await flushMicrotasks();
    });
    printSpy.mockRestore();
    popupSpy.mockRestore();
  });

  it("lets the user cancel receipt edits without submitting them", async () => {
    const existingReceipt = {
      id: "lr-1", lr_ref: "NGPLR29092026-01", receipt_date: trip.operating_date,
      sender_name: "Sender", receiver_name: "Receiver", receiver_phone: "9876543210",
      rent: "100", hamali: "0", updated_at: "version-1",
      goods_rows: [{
        type: "Cement", type_hindi: "सीमेंट", description: "Sacks",
        description_hindi: "बोरियाँ", quantity: 4,
      }],
    };
    api.get.mockImplementation((path) => {
      if (path === "/sites") return Promise.resolve({ data: [site] });
      if (path === `/sites/${site.id}/trips`) return Promise.resolve({ data: { rows: [trip], total: 1 } });
      if (path === `/sites/${site.id}/trips/${trip.id}/lrs`) {
        return Promise.resolve({ data: { rows: [existingReceipt], total: 1 } });
      }
      return Promise.resolve({ data: trip });
    });
    localStorage.setItem("booking_trip_id", trip.id);
    await renderBooking("receipts");
    await waitFor(() => expect(container.querySelector('[aria-label="Goods and description row 1"]')).not.toBeNull());
    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Edit").click();
    });
    expect(container.querySelector('[aria-label="Goods and description row 1"]').value).toBe("Cement Sacks");
    expect(document.activeElement).toBe(container.querySelector('[aria-label="Sender name in English"]'));
    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent.includes("Cancel editing")).click();
    });

    expect(api.patch).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain("Edit receipt");
    expect(container.textContent).toContain("New receipt");
  });

  it("sends one update when saving an existing receipt, even if save is clicked again while pending", async () => {
    const existingReceipt = {
      id: "lr-1", lr_ref: "NGPLR29092026-01", receipt_date: trip.operating_date,
      sender_name: "Sender", receiver_name: "Receiver", receiver_phone: "9876543210",
      rent: "100", hamali: "0", receipt_fee: "2", updated_at: "version-1",
      goods_rows: [{
        type: "Cement", type_hindi: "सीमेंट", description: "Bags",
        description_hindi: "बोरियाँ", quantity: 4,
      }],
    };
    api.get.mockImplementation((path) => {
      if (path === "/sites") return Promise.resolve({ data: [site] });
      if (path === `/sites/${site.id}/trips`) return Promise.resolve({ data: { rows: [trip], total: 1 } });
      if (path === `/sites/${site.id}/trips/${trip.id}/lrs`) {
        return Promise.resolve({ data: { rows: [existingReceipt], total: 1 } });
      }
      return Promise.resolve({ data: trip });
    });
    let finishPatch;
    api.patch.mockImplementation((_path, body) => new Promise((resolve) => {
      finishPatch = () => resolve({
        data: { ...existingReceipt, ...body, updated_at: "version-2" },
      });
    }));
    localStorage.setItem("booking_site_id", site.id);
    localStorage.setItem("booking_trip_id", trip.id);
    await renderBooking("receipts");
    await waitFor(() => expect(Array.from(container.querySelectorAll("button"))
      .some((button) => button.textContent === "Edit")).toBe(true));
    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent === "Edit").click();
    });
    await act(async () => {
      setInput('[aria-label="Goods and description row 1"]', "Cement rolls");
      const saveButton = Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent.includes("Save changes"));
      saveButton.click();
      saveButton.click();
    });

    expect(api.patch).toHaveBeenCalledTimes(1);
    expect(api.patch).toHaveBeenCalledWith(
      `/sites/${site.id}/trips/${trip.id}/lrs/${existingReceipt.id}`,
      expect.objectContaining({
        goods_rows: [expect.objectContaining({ type: "Cement rolls", quantity: 4 })],
        expected_updated_at: "version-1",
      }),
    );
    await act(async () => {
      finishPatch();
      await flushMicrotasks();
    });
    expect(container.textContent).toContain("Saved NGPLR29092026-01 successfully.");
    expect(api.patch).toHaveBeenCalledTimes(1);
  });

  it("lets an owner edit a receipt for a closed trip without a correction reason", async () => {
    const closedTrip = { ...trip, status: "closed" };
    const receipt = {
      id: "lr-1", lr_ref: "NGPLR29092026-01", receipt_date: trip.operating_date,
      sender_name: "Sender", receiver_name: "Receiver", rent: "100", hamali: "0",
      updated_at: "version-1",
      goods_rows: [{ type: "Cement", type_hindi: "सीमेंट", quantity: 4 }],
    };
    api.get.mockImplementation((path) => {
      if (path === "/sites") return Promise.resolve({ data: [site] });
      if (path === `/sites/${site.id}/trips`) return Promise.resolve({ data: { rows: [closedTrip], total: 1 } });
      if (path === `/sites/${site.id}/trips/${trip.id}/lrs`) {
        return Promise.resolve({ data: { rows: [receipt], total: 1 } });
      }
      if (path === `/sites/${site.id}/trips/${trip.id}`) return Promise.resolve({ data: closedTrip });
      return Promise.resolve({ data: trip });
    });
    localStorage.setItem("booking_site_id", site.id);
    localStorage.setItem("booking_trip_id", trip.id);
    api.patch.mockResolvedValue({ data: receipt });
    await renderBooking("receipts", "owner");
    await waitFor(() => expect(Array.from(container.querySelectorAll("button"))
      .some((button) => button.textContent === "Edit")).toBe(true));
    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent === "Edit").click();
    });

    expect(container.textContent).toContain("Edit receipt");
    expect(container.textContent).not.toContain("Owner correction reason");
    await act(async () => {
      setInput('[aria-label="Goods and description row 1"]', "Cement");
      Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent.includes("Save changes")).click();
      await flushMicrotasks();
    });
    expect(api.patch).toHaveBeenCalledWith(
      `/sites/${site.id}/trips/${trip.id}/lrs/lr-1`,
      expect.objectContaining({ expected_updated_at: "version-1" }),
    );
  });

  it("saves an edited good and description in one combined field", async () => {
    const existingReceipt = {
      id: "lr-1", lr_ref: "NGPLR29092026-01", receipt_date: trip.operating_date,
      sender_name: "", receiver_name: "Receiver", receiver_phone: "9876543210",
      rent: "100", hamali: "0", updated_at: "version-1",
      goods_rows: [{
        type: "Cement", type_hindi: "सीमेंट", description: "Bags",
        description_hindi: "बोरियाँ", quantity: 4,
      }],
    };
    api.get.mockImplementation((path) => {
      if (path === "/sites") return Promise.resolve({ data: [site] });
      if (path === `/sites/${site.id}/trips`) return Promise.resolve({ data: { rows: [trip], total: 1 } });
      if (path === `/sites/${site.id}/trips/${trip.id}/lrs`) {
        return Promise.resolve({ data: { rows: [existingReceipt], total: 1 } });
      }
      return Promise.resolve({ data: trip });
    });
    api.patch.mockResolvedValue({ data: existingReceipt });
    localStorage.setItem("booking_trip_id", trip.id);
    await renderBooking("receipts");
    await waitFor(() => expect(Array.from(container.querySelectorAll("button"))
      .some((button) => button.textContent === "Edit")).toBe(true));
    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "Edit").click();
    });
    await act(async () => {
      setInput('[aria-label="Goods and description row 1"]', "Cement");
      Array.from(container.querySelectorAll("button")).find((button) =>
        button.textContent.includes("Save changes")).click();
      await flushMicrotasks();
    });

    expect(api.patch).toHaveBeenCalledWith(
      `/sites/${site.id}/trips/${trip.id}/lrs/lr-1`,
      expect.objectContaining({
        receiver_phone: "9876543210",
        goods_rows: [expect.objectContaining({
          type: "Cement", type_hindi: "सीमेंट बोरियाँ", description: "", description_hindi: "", quantity: 4,
        })],
        expected_updated_at: "version-1",
        idempotency_key: expect.any(String),
      }),
    );
  });

  it("explains a possible duplicate receiver and retries with the selected identity", async () => {
    let receiptAttempts = 0;
    api.post.mockImplementation((path) => {
      if (!path.endsWith("/lrs")) return Promise.resolve({ data: trip });
      receiptAttempts += 1;
      if (receiptAttempts === 1) {
        return Promise.reject({ response: { status: 409, data: { detail: {
          code: "receiver_match_confirmation_required",
          message: "A similar receiver was used at this site on this operating date.",
          matches: [{ id: "receiver-1", name: "Suresh", label: "Suresh" }],
        } } } });
      }
      return Promise.resolve({ data: { id: "lr-1", lr_ref: "NGP-LR-01" } });
    });
    await renderBooking();
    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent.includes("Create Trip")).click();
    });
    await act(async () => {
      container.querySelector("form").dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flushMicrotasks();
    });
    expect(container.querySelectorAll('[aria-label^="Goods and description row "]')).toHaveLength(3);
    expect(container.querySelector('[aria-label="Quantity row 1"]').parentElement.parentElement.parentElement.className)
      .toContain("grid-cols-[8.5rem_minmax(0,1fr)_2.25rem]");
    await act(async () => {
      setInput('[aria-label="Receiver name in English"]', "Suresh");
      setInput('[aria-label="Goods and description row 1"]', "Cement");
      setInput('[aria-label="Quantity row 1"]', "3");
    });
    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent.includes("Save receipt")).click();
      await flushMicrotasks();
    });
    expect(container.textContent).toContain("Check the receiver before saving");
    expect(container.textContent).toContain("Same receiver: Suresh");
    await act(async () => {
      Array.from(container.querySelectorAll("button")).find((button) => button.textContent.includes("Same receiver: Suresh")).click();
      await flushMicrotasks();
    });
    const receiptRequests = api.post.mock.calls.filter(([path]) => path.endsWith("/lrs"));
    expect(receiptAttempts).toBe(2);
    expect(receiptRequests[1][1]).toMatchObject({
      receiver_match_action: "same",
      receiver_identity_id: "receiver-1",
    });
  });

  it("still asks for duplicate-receiver confirmation when a saved receiver is selected", async () => {
    const previousReceipt = {
      id: "lr-previous", lr_ref: "NGP-LR-01", sender_name: "Ramesh",
      receiver_name: "Suresh", receiver_phone: "9876543210", rent: "500",
      hamali: "25", goods_rows: [{ type: "Cement", quantity: 4 }],
    };
    let receiptAttempts = 0;
    localStorage.setItem("booking_site_id", site.id);
    localStorage.setItem("booking_trip_id", trip.id);
    mockBookingApi({ trips: [trip], receipts: [previousReceipt] });
    api.post.mockImplementation((path) => {
      if (!path.endsWith("/lrs")) return Promise.resolve({ data: trip });
      receiptAttempts += 1;
      if (receiptAttempts === 1) {
        return Promise.reject({ response: { status: 409, data: { detail: {
          code: "receiver_match_confirmation_required",
          message: "A similar receiver was used at this site on this operating date.",
          matches: [{ id: "receiver-1", name: "Suresh", label: "Suresh" }],
        } } } });
      }
      return Promise.resolve({ data: { id: "lr-new", lr_ref: "NGP-LR-02" } });
    });
    await renderBooking("receipts");
    await waitFor(() => expect(getByLabelText("Receiver name in English")
      .getAttribute("list")).toBe("previous-receiver-options"));
    await act(async () => {
      setInput("Receiver name in English", "Suresh");
      setInput("Goods and description row 1", "Cement");
      setInput("Quantity row 1", "4");
    });
    await clickButton("Save receipt");

    expect(screen.getByText("Check the receiver before saving")).not.toBeNull();
    expect(screen.getByText("Same receiver: Suresh")).not.toBeNull();
    const firstAttempt = api.post.mock.calls.filter(([path]) => path.endsWith("/lrs"))[0][1];
    expect(firstAttempt).toMatchObject({
      receiver_name: "Suresh",
      receiver_phone: "9876543210",
      rent: "0",
      hamali: "0",
    });
    expect(api.post.mock.calls.filter(([path]) => path.endsWith("/lrs"))).toHaveLength(1);
  });
  });
});
