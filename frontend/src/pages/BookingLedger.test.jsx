import { act } from "react";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import { api } from "../lib/api";
import { registerBookingTestHarness } from "./Booking.testUtils";

jest.mock("../lib/api", () => ({
  api: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
  errMsg: (error) => error?.response?.data?.detail || "Request failed",
}));

describe("simple booking workflow", () => {
  const { container, site, trip, flushMicrotasks, getByLabelText, getByRole, clickButton,
    createLedgerRow, mockBookingApi, renderBooking, clearBooking, setInput } = registerBookingTestHarness();

  describe("ledger charge editing", () => {
  it("keeps confirmed same-receiver receipts together and marks the names inline", async () => {
    const rows = [
      createLedgerRow({
        id: "lr-one", lr_ref: "NGP-LR-01", sequence: 1,
        receiver_name: "Ramesh", receiver_identity_id: "receiver-ramesh",
      }),
      createLedgerRow({
        id: "lr-other", lr_ref: "NGP-LR-02", sequence: 2,
        receiver_name: "Suresh", receiver_identity_id: "receiver-suresh",
      }),
      createLedgerRow({
        id: "lr-two", lr_ref: "NGP-LR-03", sequence: 3,
        receiver_name: "Ramesh", receiver_identity_id: "receiver-ramesh",
      }),
    ];
    mockBookingApi({ trips: [trip], ledgerRows: rows });
    await renderBooking("ledger", "owner");

    const table = await screen.findByRole("table", { name: "Selected ledger totals" });
    await waitFor(() => expect(container.querySelectorAll(".booking-ledger-table tbody tr"))
      .toHaveLength(3));
    const receiptRows = [...table.querySelectorAll("tbody tr")];
    expect(receiptRows.map((row) =>
      row.querySelector('[data-ledger-column="receipt"]').textContent)).toEqual([
      "NGP-LR-01", "NGP-LR-03", "NGP-LR-02",
    ]);
    const receiverCells = receiptRows.map((row) => row.querySelector('[data-ledger-column="receiver"]'));
    expect(receiverCells[0].textContent).toContain("रमेश");
    expect(receiverCells[0].querySelector('[title="Ramesh"]')).not.toBeNull();
    expect(receiverCells[0].querySelector('[aria-label="Confirmed same receiver"]')).not.toBeNull();
    expect(receiverCells[1].querySelector('[aria-label="Confirmed same receiver"]')).not.toBeNull();
    expect(receiverCells[2].textContent).toBe("सुरेश");
    expect(receiverCells[2].querySelector('[title="Suresh"]')).not.toBeNull();
    expect(receiverCells[2].querySelector('[aria-label="Confirmed same receiver"]')).toBeNull();

    await act(async () => {
      screen.getByRole("button", { name: "Print" }).click();
      await flushMicrotasks();
    });
    const printRows = [...document.querySelectorAll(".booking-ledger-print tbody tr")];
    expect(printRows.map((row) => row.children[1].textContent)).toEqual([
      "NGP-LR-01", "NGP-LR-03", "NGP-LR-02",
    ]);
    const printReceiverCells = printRows.slice(0, 2).map((row) =>
      [...row.children].find((cell) => cell.querySelector('[title="Ramesh"]')));
    expect(printReceiverCells[0].textContent).toContain("रमेश");
    expect(printReceiverCells[1].textContent).toContain("रमेश");
    expect(printReceiverCells[0].querySelector('[aria-label="Confirmed same receiver"]')).not.toBeNull();
    expect(printReceiverCells[1].querySelector('[aria-label="Confirmed same receiver"]')).not.toBeNull();
    await act(async () => window.dispatchEvent(new Event("afterprint")));
  });

  it("shows Hindi party names in the ledger while keeping original spellings available", async () => {
    const row = createLedgerRow({
      sender_name: "Deepak Jadhav",
      receiver_name: "Kasva General",
    });
    mockBookingApi({ trips: [trip], ledgerRows: [row] });
    await renderBooking("ledger");

    const table = await screen.findByRole("table", { name: "Selected ledger totals" });
    await waitFor(() => expect(table.querySelector("tbody tr")).not.toBeNull());
    const sender = table.querySelector('[data-ledger-column="sender"] span');
    const receiver = table.querySelector('[data-ledger-column="receiver"] span');
    expect(sender.textContent).toBe("दीपक जधव");
    expect(sender.title).toBe("Deepak Jadhav");
    expect(receiver.textContent).toBe("कस्वा जनरल");
    expect(receiver.title).toBe("Kasva General");
  });

  it("uses the selected site's verified word and phrase dictionary in ledger names", async () => {
    const siteWithDictionary = {
      ...site,
      config: {
        hindi_dictionary: [
          { english: "Traders", hindi: "व्यापारी" },
          { english: "Kasva Traders", hindi: "कस्वा ट्रेडिंग कंपनी" },
        ],
      },
    };
    const row = createLedgerRow({
      sender_name: "Kasva Traders",
      receiver_name: "Patil Traders",
    });
    mockBookingApi({ sites: [siteWithDictionary], trips: [trip], ledgerRows: [row] });
    await renderBooking("ledger");

    const table = await screen.findByRole("table", { name: "Selected ledger totals" });
    await waitFor(() => expect(table.querySelector("tbody tr")).not.toBeNull());
    expect(table.querySelector('[data-ledger-column="sender"]').textContent)
      .toBe("कस्वा ट्रेडिंग कंपनी");
    expect(table.querySelector('[data-ledger-column="receiver"]').textContent)
      .toBe("पाटिल व्यापारी");
  });

  it("lets an owner switch ledger party names to English for screen, print, and export", async () => {
    const row = createLedgerRow({
      sender_name: "Deepak Jadhav",
      sender_name_hindi_verified: "दीपक जाधव",
      receiver_name: "Kasva General",
      receiver_name_hindi_verified: "कस्वा जनरल",
    });
    mockBookingApi({ trips: [trip], ledgerRows: [row] });
    await renderBooking("ledger", "owner");

    const table = await screen.findByRole("table", { name: "Selected ledger totals" });
    await waitFor(() => expect(table.querySelector("tbody tr")).not.toBeNull());
    const nameToggle = screen.getByRole("switch", { name: "Show English party names" });
    const tableColumnsButton = screen.getByText("Table columns");
    expect(Array.from(tableColumnsButton.parentElement.parentElement.children)).toContain(nameToggle);
    expect(nameToggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(nameToggle);

    await waitFor(() => {
      expect(table.querySelector('[data-ledger-column="sender"]').textContent).toBe("Deepak Jadhav");
      expect(table.querySelector('[data-ledger-column="receiver"]').textContent).toContain("Kasva General");
    });
    expect(nameToggle.getAttribute("aria-checked")).toBe("true");
    expect(localStorage.getItem("booking_ledger_party_name_language:site-1:owner")).toBe("en");

    await act(async () => {
      screen.getByRole("button", { name: "Print" }).click();
      await flushMicrotasks();
    });
    const printRow = document.querySelector(".booking-ledger-print tbody tr");
    expect(printRow.textContent).toContain("Deepak Jadhav");
    expect(printRow.textContent).toContain("Kasva General");
    await act(async () => window.dispatchEvent(new Event("afterprint")));

    await act(async () => {
      screen.getByRole("button", { name: "Excel" }).click();
      await flushMicrotasks();
    });
    const exportRequest = api.get.mock.calls.find(([path]) =>
      path === `/sites/${site.id}/ledger/export.xlsx`);
    expect(exportRequest[1].params.party_name_language).toBe("en");
  });

  it("uses the server's latest row version for queued ledger edits", async () => {
    const row = createLedgerRow({
      sender_name: "Old sender", receiver_name: "Old receiver",
      sender_name_hindi: "पुराना भेजने वाला", receiver_name_hindi: "पुराना प्राप्तकर्ता", sender_address: "",
      receiver_address: "",
      entry_by: "A-Owner",
      charge_editor_marker: "M",
      goods_rows: [
        { type: "Cement", type_hindi: "सीमेंट", description: "", quantity: 1, rent: "100.00", hamali: "0.00" },
        { type: "Grain", type_hindi: "अनाज", description: "", quantity: 3, rent: "0.00", hamali: "0.00" },
      ],
    });
    mockBookingApi({ trips: [trip], ledgerRows: [row] });
    let resolveFirst;
    const patches = [];
    api.patch.mockImplementation((path, body) => {
      patches.push(body);
      if (patches.length === 1) {
        return new Promise((resolve) => { resolveFirst = resolve; });
      }
      return Promise.resolve({ data: { ...row, ...body, updated_at: "version-3" } });
    });

    await renderBooking("ledger");
    await waitFor(() => expect(getByLabelText("NGP-LR-01 Bhada").value).toBe("100"));
    const ledgerTable = container.querySelector("table");
    expect(ledgerTable).not.toBeNull();
    expect(container.querySelector('[aria-label="NGP-LR-01 sender address"]')).toBeNull();
    expect(container.querySelector('[aria-label="NGP-LR-01 receiver address"]')).toBeNull();
    const ledgerBhada = container.querySelector('[aria-label="NGP-LR-01 Bhada"]');
    expect(ledgerBhada.disabled).toBe(false);
    expect(ledgerBhada.value).toBe("100");
    expect(container.querySelector('[aria-label="NGP-LR-01 Bhada row 1"]')).toBeNull();
    expect(within(ledgerTable).getByRole("columnheader", { name: "Bhada" })).not.toBeNull();
    expect(within(ledgerTable).getByRole("columnheader", { name: "Hamali" })).not.toBeNull();
    expect(ledgerTable.querySelectorAll("input")).toHaveLength(2);
    expect(container.querySelector('[aria-label="NGP-LR-01 sender"]')).toBeNull();
    const senderName = ledgerTable.querySelector('[data-ledger-column="sender"] span');
    const receiverName = ledgerTable.querySelector('[data-ledger-column="receiver"] span');
    expect(senderName.title).toBe("Old sender");
    expect(senderName.textContent).toMatch(/[\u0900-\u097f]/);
    expect(receiverName.title).toBe("Old receiver");
    expect(receiverName.textContent).toMatch(/[\u0900-\u097f]/);
    expect(container.textContent).not.toContain("पुराना भेजने वाला");
    expect(ledgerTable.querySelector("tbody tr td:first-child").textContent).toBe("29-09-2026");
    expect(ledgerTable.querySelector("tbody tr td:nth-child(5)").textContent).toBe("१ - सीमेंट, ३ - अनाज");
    expect(ledgerTable.textContent).toContain("A-Owner");
    expect(ledgerTable.querySelector("tbody tr td:nth-child(9)").textContent).toContain("₹2");
    expect(container.querySelector('select option[value=""]')?.textContent).toBe("Select trip");
    expect(container.textContent).toContain(`Selected trip${trip.trip_ref}`);
    expect(api.get).toHaveBeenCalledWith(
      `/sites/${site.id}/ledger/entries`,
      expect.objectContaining({ params: expect.objectContaining({ trip_id: trip.id }) }),
    );
    jest.useFakeTimers();
    await act(async () => {
      setInput('[aria-label="NGP-LR-01 Bhada"]', "125");
      jest.advanceTimersByTime(650);
      await flushMicrotasks();
    });
    expect(patches).toHaveLength(1);
    expect(patches[0].expected_updated_at).toBe("version-1");

    await act(async () => {
      setInput('[aria-label="NGP-LR-01 Hamali"]', "10");
      jest.advanceTimersByTime(650);
      await flushMicrotasks();
    });
    expect(patches).toHaveLength(1);

    await act(async () => {
      resolveFirst({ data: { ...row, rent: "125", updated_at: "version-2" } });
      await flushMicrotasks();
    });
    expect(patches).toHaveLength(2);
    expect(patches[1]).toMatchObject({
      hamali: "10",
      expected_updated_at: "version-2",
    });
    jest.useRealTimers();
  });

  it("keeps ledger edits pending offline and saves them after reconnection", async () => {
    const row = {
      id: "lr-1", site_id: site.id, trip_id: trip.id, trip_ref: trip.trip_ref,
      trip_status: "open", lr_ref: "NGP-LR-01", receipt_date: trip.operating_date,
      sender_name: "Sender", receiver_name: "Receiver", rent: "100.00", hamali: "0.00",
      total_rent: "100.00", updated_at: "version-1", goods_rows: [{
        type: "Cement", type_hindi: "सीमेंट", description: "", quantity: 1,
      }],
    };
    api.get.mockImplementation((path) => {
      if (path === "/sites") return Promise.resolve({ data: [site] });
      if (path === `/sites/${site.id}/trips`) return Promise.resolve({ data: { rows: [trip], total: 1 } });
      if (path === `/sites/${site.id}/ledger/entries`) return Promise.resolve({ data: { rows: [row], total: 1 } });
      return Promise.resolve({ data: trip });
    });
    api.patch.mockResolvedValue({ data: { ...row, rent: "125.00", updated_at: "version-2" } });
    await renderBooking("ledger");
    await waitFor(() => expect(container.querySelector('[aria-label="NGP-LR-01 Bhada"]')).not.toBeNull());

    await act(async () => {
      Object.defineProperty(window.navigator, "onLine", { configurable: true, value: false });
      setInput('[aria-label="NGP-LR-01 Bhada"]', "125");
    });
    expect(container.textContent).toContain("Waiting to sync · keep this page open");
    expect(api.patch).not.toHaveBeenCalled();

    await act(async () => {
      Object.defineProperty(window.navigator, "onLine", { configurable: true, value: true });
      window.dispatchEvent(new Event("online"));
      await flushMicrotasks();
    });
    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(container.querySelector('[aria-label="NGP-LR-01 Bhada"]').value).toBe("125"));
    expect(container.textContent).not.toContain("Saved");
  });

  it("lets users add receipt data columns to the trip ledger", async () => {
    const row = createLedgerRow({
      sender_address: "Main Street",
      sender_address_hindi: "मुख्य सड़क",
      receiver_phone: "9876543210",
      city: "Nagpur",
    });
    mockBookingApi({ trips: [trip], ledgerRows: [row] });
    await renderBooking("ledger", "owner");
    await waitFor(() => expect(container.textContent).toContain("NGP-LR-01"));
    const ledgerTable = container.querySelector("table[aria-label='Selected ledger totals']");
    expect(ledgerTable.querySelector("thead tr th:last-child").textContent).toBe("Mark money received");

    const columnsControl = container.querySelector(".ledger-table-column-picker summary");
    await act(async () => columnsControl.click());
    const senderAddressToggle = getByLabelText("Show Sender address column");
    await act(async () => senderAddressToggle.click());

    expect(within(ledgerTable).getByRole("columnheader", { name: "Sender address" })).not.toBeNull();
    expect(within(ledgerTable).queryByRole("columnheader", { name: "Receiver phone" })).toBeNull();

    const receiverPhoneToggle = getByLabelText("Show Receiver phone column");
    await act(async () => receiverPhoneToggle.click());
    expect(within(ledgerTable).getByRole("columnheader", { name: "Receiver phone" })).not.toBeNull();
    expect(ledgerTable.textContent).toContain("9876543210");
    expect(columnsControl).not.toBeNull();

    const bhadaToggle = getByLabelText("Show Bhada column");
    await act(async () => bhadaToggle.click());
    expect(within(ledgerTable).queryByRole("columnheader", { name: "Bhada" })).toBeNull();
    expect(within(ledgerTable).getByRole("columnheader", { name: "Hamali" })).not.toBeNull();
    expect(within(ledgerTable).getByRole("columnheader", { name: "Receipt fee" })).not.toBeNull();
    await act(async () => bhadaToggle.click());
    expect(within(ledgerTable).getByRole("columnheader", { name: "Bhada" })).not.toBeNull();

    const receiverPhoneHeader = within(ledgerTable).getByRole("columnheader", { name: "Receiver phone" });
    const dateHeader = within(ledgerTable).getByRole("columnheader", { name: "Date" });
    const dataTransfer = { setData: jest.fn(), getData: () => "receiverPhone", effectAllowed: "" };
    fireEvent.dragStart(receiverPhoneHeader, { dataTransfer });
    fireEvent.dragOver(dateHeader, { dataTransfer });
    fireEvent.drop(dateHeader, { dataTransfer });
    expect(ledgerTable.querySelector("thead th").textContent).toBe("Receiver phone");
    expect(ledgerTable.querySelector("thead th:last-child").textContent).toBe("Mark money received");
    expect(localStorage.getItem(`booking_ledger_columns:${encodeURIComponent(site.id)}`))
      .toContain('"receiverPhone"');

    const hamaliHeader = within(ledgerTable).getByRole("columnheader", { name: "Hamali" });
    const firstHeader = ledgerTable.querySelector("thead th");
    const chargeTransfer = { setData: jest.fn(), getData: () => "hamali", effectAllowed: "" };
    fireEvent.dragStart(hamaliHeader, { dataTransfer: chargeTransfer });
    fireEvent.dragOver(firstHeader, { dataTransfer: chargeTransfer });
    fireEvent.drop(firstHeader, { dataTransfer: chargeTransfer });
    const reorderedHeaders = Array.from(ledgerTable.querySelectorAll("thead th"), (header) => header.textContent);
    expect(reorderedHeaders.slice(0, 2)).toEqual(["Hamali", "Receiver phone"]);
    expect(reorderedHeaders[reorderedHeaders.indexOf("Bhada") + 1]).not.toBe("Hamali");
    expect(reorderedHeaders[reorderedHeaders.indexOf("Receipt fee") + 1]).not.toBe("Hamali");
    expect(reorderedHeaders[reorderedHeaders.length - 1]).toBe("Mark money received");

    await act(async () => {
      screen.getByRole("button", { name: "Print" }).click();
      await flushMicrotasks();
    });
    const printTable = document.querySelector(".booking-ledger-print table");
    expect(printTable.querySelector("thead th").textContent).toBe("हमाली");
    expect(printTable.querySelector("thead th:last-child").textContent).toBe("पैसे मिलने पर निशान लगाएँ");
    expect(printTable.textContent).not.toContain("किसने भरा");
    await act(async () => window.dispatchEvent(new Event("afterprint")));

    await act(async () => {
      document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    });
    expect(container.querySelector(".ledger-table-column-picker").open).toBe(false);

    await clearBooking();
    await renderBooking("ledger", "owner");
    await waitFor(() => expect(container.querySelector("table[aria-label='Selected ledger totals']")
      .querySelector("thead th").textContent).toBe("Hamali"));
    const restoredHeaders = Array.from(container.querySelectorAll("table[aria-label='Selected ledger totals'] thead th"),
      (header) => header.textContent);
    expect(restoredHeaders[restoredHeaders.length - 1]).toBe("Mark money received");
  });

  it("keeps a conflicting ledger charge visible and reports the server version conflict", async () => {
    const row = createLedgerRow();
    mockBookingApi({ trips: [trip], ledgerRows: [row] });
    api.patch.mockRejectedValue({
      response: { status: 409, data: { detail: "This receipt changed. Reload and retry." } },
    });

    await renderBooking("ledger");
    await waitFor(() => expect(getByLabelText("NGP-LR-01 Bhada").value).toBe("100"));
    await act(async () => {
      setInput("NGP-LR-01 Bhada", "125");
    });

    await waitFor(() => expect(container.textContent)
      .toContain("Failed to save: This receipt changed. Reload and retry."));
    expect(getByLabelText("NGP-LR-01 Bhada").value).toBe("125");
    expect(api.patch).toHaveBeenCalledWith(
      `/sites/${site.id}/trips/${trip.id}/lrs/${row.id}`,
      expect.objectContaining({ rent: "125", expected_updated_at: row.updated_at }),
    );
  });

  it("lets site managers edit only ledger charges and shows receipt creator attribution", async () => {
    const row = {
      id: "lr-1", site_id: site.id, trip_id: trip.id, trip_ref: trip.trip_ref,
      trip_status: "open", lr_ref: "NGP-LR-01", receipt_date: trip.operating_date,
      sender_name: "Sender", receiver_name: "Receiver", sender_name_hindi: "",
      receiver_name_hindi: "", rent: "100.00", hamali: "10.00", total_rent: "110.00",
      charge_editor_marker: "A", entry_by: "M-Saoji", goods_rows: [{
        type: "Cement", type_hindi: "सीमेंट", description: "", quantity: 1,
        rent: "100.00", hamali: "10.00",
      }], updated_at: "version-1",
    };
    api.get.mockImplementation((path) => {
      if (path === "/sites") return Promise.resolve({ data: [site] });
      if (path === `/sites/${site.id}/ledger/entries`) {
        return Promise.resolve({ data: { rows: [row], total: 1 } });
      }
      if (path === `/sites/${site.id}/trips`) return Promise.resolve({ data: { rows: [trip], total: 1 } });
      return Promise.resolve({ data: trip });
    });
    api.patch.mockResolvedValue({
      data: { ...row, rent: "125.00", total_rent: "135.00", charge_editor_marker: "M", updated_at: "version-2" },
    });

    await renderBooking("ledger");
    await waitFor(() => expect(container.querySelector('[aria-label="NGP-LR-01 Bhada"]')).not.toBeNull());
    const rentField = container.querySelector('[aria-label="NGP-LR-01 Bhada"]');
    expect(rentField.disabled).toBe(false);
    expect(container.querySelector('table [aria-label="NGP-LR-01 quantity 1"]')).toBeNull();
    expect(container.querySelector('table [aria-label="NGP-LR-01 goods description 1"]')).toBeNull();
    expect(container.querySelector("table").textContent).toContain("सीमेंट");
    expect(container.querySelector("table").textContent).toContain("M-Saoji");
    expect(container.querySelector("table td:nth-child(2)").textContent).toContain("NGP-LR-01");
    expect(container.querySelector("table td:nth-child(2)").querySelector("input")).toBeNull();
    expect(container.querySelector('[aria-label="NGP-LR-01 Mark money received"]')).toBeNull();
    expect(Array.from(container.querySelectorAll("button")).some((button) =>
      button.textContent.includes("ट्रिप बही पूरी करें"))).toBe(false);

    await act(async () => {
      setInput('[aria-label="NGP-LR-01 Bhada"]', "125.00");
      rentField.dispatchEvent(new Event("blur", { bubbles: true }));
    });

    await waitFor(() => expect(api.patch).toHaveBeenCalledTimes(1));
    expect(api.patch).toHaveBeenCalledWith(
      `/sites/${site.id}/trips/${trip.id}/lrs/lr-1`,
      expect.objectContaining({ rent: "125.00", expected_updated_at: "version-1" }),
    );
    expect(container.querySelector("table").textContent).toContain("M-Saoji");

    expect(api.patch).toHaveBeenCalledTimes(1);
  });
  });

  describe("ledger permissions and completion", () => {
  it("keeps receipt data read-only in the ledger except for Bhada and Hamali", async () => {
    const row = {
      id: "lr-1", site_id: site.id, trip_id: trip.id, trip_ref: trip.trip_ref,
      trip_status: "open", lr_ref: "NGP-LR-01", receipt_date: trip.operating_date,
      sender_name: "Sender", receiver_name: "Receiver", rent: "100.00", hamali: "10.00",
      total_rent: "110.00", receipt_fee: "2.00", paid_total: "20.00", outstanding: "80.00",
      payment_status: "partial", amount_paid: true, ledger_settlement_created: false,
      goods_rows: [{
        type: "Cement", type_hindi: "सीमेंट", description: "Bags",
        description_hindi: "बोरे", quantity: 1, rent: "100.00", hamali: "10.00",
      }],
      updated_at: "version-1",
    };
    api.get.mockImplementation((path) => {
      if (path === "/sites") return Promise.resolve({ data: [site] });
      if (path === `/sites/${site.id}/ledger/entries`) return Promise.resolve({ data: { rows: [row], total: 1 } });
      if (path === `/sites/${site.id}/trips`) return Promise.resolve({ data: { rows: [trip], total: 1 } });
      return Promise.resolve({ data: trip });
    });
    await renderBooking("ledger", "owner");
    await waitFor(() => expect(container.querySelector('[aria-label="NGP-LR-01 Bhada"]')).not.toBeNull());
    expect(container.querySelector('[aria-label="NGP-LR-01 Bhada"]').disabled).toBe(true);
    expect(container.querySelector('[aria-label="NGP-LR-01 Hamali"]').disabled).toBe(true);
    const table = container.querySelector("table");
    expect(table.querySelectorAll("input")).toHaveLength(3);
    expect(table.querySelector('[aria-label="NGP-LR-01 Mark money received"]')).not.toBeNull();
    expect(table.querySelector("tbody tr td:nth-child(5)").textContent).toBe("१ - सीमेंट/बोरे");
    expect(table.querySelector("tbody tr td:nth-child(6)").textContent).toBe("1");
    const totals = container.querySelector('[aria-label="Selected ledger totals"]');
    const totalCells = totals.querySelectorAll("tfoot td");
    expect(totalCells).toHaveLength(1);
    expect(totalCells[0].colSpan).toBe(table.querySelectorAll("thead th").length);
    expect(totalCells[0].textContent).toContain("Bhada total: ₹100");
    expect(totalCells[0].textContent).toContain("Hamali total: ₹10");
    expect(totalCells[0].textContent).toContain("Receipt fee total: ₹2");
    expect(totalCells[0].textContent).toContain("Grand total: ₹112");
    const mobileRow = container.querySelector('article[aria-label="NGP-LR-01 mobile ledger receipt"]');
    expect(mobileRow).not.toBeNull();
    expect(mobileRow.textContent).toContain("१ - सीमेंट/बोरे");
    expect(mobileRow.textContent).toContain("Mark money received");
    expect(mobileRow.querySelector('[aria-label="NGP-LR-01 Mark money received"]')).not.toBeNull();
    expect(mobileRow.querySelector('[aria-label="NGP-LR-01 mobile Bhada"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="Mobile selected ledger totals"]').textContent)
      .toContain("Total amount");
    expect(Array.from(container.querySelectorAll("button")).some((button) =>
      button.textContent.includes("Complete trip ledger"))).toBe(true);
    expect(table.querySelector('[aria-label="NGP-LR-01 date"]')).toBeNull();
    expect(table.querySelector('[aria-label="NGP-LR-01 sender"]')).toBeNull();
    expect(table.querySelector('[aria-label="NGP-LR-01 receiver"]')).toBeNull();
    expect(table.querySelector('[aria-label="NGP-LR-01 payment received"]')).toBeNull();
  });

  it("saves paid ticks immediately and restores them with an error if the save fails", async () => {
    const row = {
      id: "lr-1", site_id: site.id, trip_id: trip.id, trip_ref: trip.trip_ref,
      trip_status: "open", lr_ref: "NGP-LR-01", receipt_date: trip.operating_date,
      sender_name: "Sender", receiver_name: "Receiver", rent: "100.00", hamali: "0.00",
      total_rent: "100.00", paid_total: "100.00", outstanding: "0.00",
      amount_paid: true, goods_rows: [], updated_at: "version-1",
    };
    api.get.mockImplementation((path) => {
      if (path === "/sites") return Promise.resolve({ data: [site] });
      if (path === `/sites/${site.id}/ledger/entries`) return Promise.resolve({ data: { rows: [row], total: 1 } });
      if (path === `/sites/${site.id}/trips`) return Promise.resolve({ data: { rows: [trip], total: 1 } });
      return Promise.resolve({ data: trip });
    });
    api.post.mockResolvedValueOnce({
      data: { received: false, paid_total: "0.00", outstanding: "102.00" },
    }).mockRejectedValueOnce({
      response: { status: 409, data: { detail: "The trip ledger is locked" } },
    });
    const prompt = jest.spyOn(window, "prompt").mockImplementation(() => null);
    await renderBooking("ledger", "owner");
    await waitFor(() => expect(container.querySelector('[aria-label="NGP-LR-01 Mark money received"]')).not.toBeNull());

    await act(async () => {
      container.querySelector('[aria-label="NGP-LR-01 Mark money received"]').click();
      await flushMicrotasks();
    });

    expect(prompt).not.toHaveBeenCalled();
    expect(api.post).toHaveBeenCalledWith(
      `/sites/${site.id}/trips/${trip.id}/lrs/lr-1/settlement`,
      expect.objectContaining({ received: false, idempotency_key: expect.any(String) }),
    );
    expect(container.querySelector('[aria-label="NGP-LR-01 Mark money received"]').checked).toBe(false);
    await act(async () => {
      container.querySelector('[aria-label="NGP-LR-01 Mark money received"]').click();
      await flushMicrotasks();
    });
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(container.querySelector('[aria-label="NGP-LR-01 Mark money received"]').checked).toBe(false);
    expect(container.querySelector('[role="alert"]').textContent)
      .toContain("NGP-LR-01: Paid status was not saved. The trip ledger is locked");
    prompt.mockRestore();
  });

  it("shows English trip ledger heading and actions", async () => {
    api.get.mockImplementation((path) => {
      if (path === "/sites") return Promise.resolve({ data: [site] });
      if (path === `/sites/${site.id}/ledger/entries`) return Promise.resolve({ data: { rows: [], total: 0 } });
      if (path === `/sites/${site.id}/trips`) return Promise.resolve({ data: { rows: [trip], total: 1 } });
      return Promise.resolve({ data: trip });
    });
    await renderBooking("ledger", "owner");
    await waitFor(() => expect(container.textContent).toContain(`Selected trip${trip.trip_ref}`));
    expect(container.textContent).toContain(`Selected trip${trip.trip_ref}`);
    expect(container.textContent).toContain("Print");
    expect(container.textContent).toContain("Excel");
    expect(container.textContent).toContain("Complete trip ledger");
  });

  it("omits receipt creator from the printed ledger", async () => {
    const row = createLedgerRow({ entry_by: "A-Owner" });
    mockBookingApi({ trips: [trip], ledgerRows: [row] });
    const printSpy = jest.spyOn(window, "print").mockImplementation(() => {});

    await renderBooking("ledger", "owner");
    await waitFor(() => expect(container.textContent).toContain(`Selected trip${trip.trip_ref}`));
    await act(async () => {
      screen.getByRole("button", { name: "Print" }).click();
      await flushMicrotasks();
    });

    const printTable = await waitFor(() => {
      const table = document.querySelector(".booking-ledger-print table");
      expect(table).not.toBeNull();
      return table;
    });
    expect(printTable.textContent).not.toContain("प्रविष्टि करने वाला");
    expect(printTable.textContent).not.toContain("A-Owner");
    expect(container.querySelector("table[aria-label='Selected ledger totals']").textContent)
      .toContain("Entered by");

    await act(async () => window.dispatchEvent(new Event("afterprint")));
    printSpy.mockRestore();
  });

  it("downloads the Excel ledger using the selected trip name", async () => {
    mockBookingApi({ trips: [{ ...trip, trip_ref: "NGP/LR:Trip-01" }], ledgerRows: [] });
    api.get.mockImplementation((path) => {
      if (path === "/sites") return Promise.resolve({ data: [site] });
      if (path === `/sites/${site.id}/trips`) {
        return Promise.resolve({ data: { rows: [{ ...trip, trip_ref: "NGP/LR:Trip-01" }], total: 1 } });
      }
      if (path === `/sites/${site.id}/ledger/entries`) {
        return Promise.resolve({ data: { rows: [], total: 0 } });
      }
      if (path === `/sites/${site.id}/ledger/export.xlsx`) {
        return Promise.resolve({ data: new Blob(["ledger"]) });
      }
      return Promise.resolve({ data: trip });
    });
    const originalCreateObjectURL = Object.getOwnPropertyDescriptor(URL, "createObjectURL");
    const originalRevokeObjectURL = Object.getOwnPropertyDescriptor(URL, "revokeObjectURL");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true, value: jest.fn(() => "blob:ledger"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true, value: jest.fn(),
    });
    let downloadedFilename = "";
    const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function () {
      downloadedFilename = this.download;
    });

    await renderBooking("ledger", "owner");
    await waitFor(() => expect(container.textContent).toContain("NGP/LR:Trip-01"));
    const ledgerTable = container.querySelector("table[aria-label='Selected ledger totals']");
    const dataTransfer = { setData: jest.fn(), getData: () => "amountPaid", effectAllowed: "" };
    fireEvent.dragStart(within(ledgerTable).getByRole("columnheader", { name: "Mark money received" }), { dataTransfer });
    fireEvent.dragOver(within(ledgerTable).getByRole("columnheader", { name: "Date" }), { dataTransfer });
    fireEvent.drop(within(ledgerTable).getByRole("columnheader", { name: "Date" }), { dataTransfer });
    expect(ledgerTable.querySelector("thead th").textContent).toBe("Date");
    expect(ledgerTable.querySelector("thead th:last-child").textContent).toBe("Mark money received");
    const columnPicker = container.querySelector(".ledger-table-column-picker");
    await act(async () => columnPicker.querySelector("summary").click());
    await act(async () => getByLabelText("Show Sender address column").click());
    await act(async () => getByLabelText("Show Receiver phone column").click());
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent.includes("Excel")).click();
      await flushMicrotasks();
    });

    expect(click).toHaveBeenCalled();
    expect(downloadedFilename).toBe("NGP-LR-Trip-01-ledger.xlsx");
    const exportCall = api.get.mock.calls.find(([path]) =>
      path === `/sites/${site.id}/ledger/export.xlsx`);
    expect(exportCall[1].params).toEqual(expect.objectContaining({
      trip_id: trip.id,
      columns: "date,receipt,sender,receiver,goods,quantity,bhada,hamali,receiptFee,senderAddress,receiverPhone,amountPaid",
    }));
    click.mockRestore();
    if (originalCreateObjectURL) Object.defineProperty(URL, "createObjectURL", originalCreateObjectURL);
    else delete URL.createObjectURL;
    if (originalRevokeObjectURL) Object.defineProperty(URL, "revokeObjectURL", originalRevokeObjectURL);
    else delete URL.revokeObjectURL;
  });

  it("lets an owner undo a completed ledger while retaining its paid state", async () => {
    const completedTrip = {
      ...trip,
      ledger_completed_at: "2026-09-29T12:00:00+00:00",
      ledger_completed_by: "owner",
      ledger_completion_started_at: "2026-09-29T12:00:00+00:00",
    };
    const paidRow = {
      id: "lr-1", site_id: site.id, trip_id: trip.id, trip_ref: trip.trip_ref,
      trip_status: "closed", lr_ref: "NGP-LR-01", receipt_date: trip.operating_date,
      receiver_name: "Receiver", rent: "100.00", hamali: "0.00",
      total_rent: "100.00", paid_total: "102.00", outstanding: "0.00",
      amount_paid: true, goods_rows: [],
    };
    api.get.mockImplementation((path) => {
      if (path === "/sites") return Promise.resolve({ data: [site] });
      if (path === `/sites/${site.id}/ledger/entries`) {
        return Promise.resolve({ data: { rows: [paidRow], total: 1 } });
      }
      if (path === `/sites/${site.id}/trips`) {
        return Promise.resolve({ data: { rows: [completedTrip], total: 1 } });
      }
      return Promise.resolve({ data: completedTrip });
    });
    api.post.mockResolvedValue({ data: { id: trip.id, ledger_completed: false } });
    const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);

    await renderBooking("ledger", "owner");
    await waitFor(() => expect(container.textContent).toContain("Ledger completed and locked"));
    expect(container.textContent).toContain("Ledger completed and locked");
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent.includes("Undo ledger completion")).click();
      await flushMicrotasks();
    });

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining("will remain unchanged"));
    expect(api.post).toHaveBeenCalledWith(
      `/sites/${site.id}/trips/${trip.id}/ledger/uncomplete`,
    );
    expect(container.textContent).not.toContain("Ledger completed and locked");
    expect(container.querySelector('[aria-label="NGP-LR-01 Mark money received"]').checked).toBe(true);
    expect(container.querySelector('[aria-label="NGP-LR-01 Mark money received"]').disabled).toBe(false);
    expect(Array.from(container.querySelectorAll("button")).some((button) =>
      button.textContent.includes("Complete trip ledger"))).toBe(true);
    confirm.mockRestore();
  });

  it("does not offer completed-ledger undo to a manager", async () => {
    const completedTrip = { ...trip, ledger_completed_at: "2026-09-29T12:00:00+00:00" };
    api.get.mockImplementation((path) => {
      if (path === "/sites") return Promise.resolve({ data: [site] });
      if (path === `/sites/${site.id}/ledger/entries`) {
        return Promise.resolve({ data: { rows: [], total: 0 } });
      }
      if (path === `/sites/${site.id}/trips`) {
        return Promise.resolve({ data: { rows: [completedTrip], total: 1 } });
      }
      return Promise.resolve({ data: completedTrip });
    });

    await renderBooking("ledger", "site_manager");
    await waitFor(() => expect(container.textContent).toContain(`Selected trip${trip.trip_ref}`));

    expect(container.textContent).not.toContain("Undo ledger completion");
  });

  it("keeps the ledger locked and shows the server error when undo fails", async () => {
    const completedTrip = { ...trip, ledger_completed_at: "2026-09-29T12:00:00+00:00" };
    api.get.mockImplementation((path) => {
      if (path === "/sites") return Promise.resolve({ data: [site] });
      if (path === `/sites/${site.id}/ledger/entries`) {
        return Promise.resolve({ data: { rows: [], total: 0 } });
      }
      if (path === `/sites/${site.id}/trips`) {
        return Promise.resolve({ data: { rows: [completedTrip], total: 1 } });
      }
      return Promise.resolve({ data: completedTrip });
    });
    api.post.mockRejectedValue({
      response: { status: 409, data: { detail: "This trip ledger changed. Reload and retry." } },
    });
    const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);

    await renderBooking("ledger", "owner");
    await waitFor(() => expect(container.textContent).toContain("Ledger completed and locked"));
    await act(async () => {
      Array.from(container.querySelectorAll("button"))
        .find((button) => button.textContent.includes("Undo ledger completion")).click();
      await flushMicrotasks();
    });

    expect(container.querySelector('[role="alert"]').textContent)
      .toContain("This trip ledger changed. Reload and retry.");
    expect(container.textContent).toContain("Ledger completed and locked");
    expect(Array.from(container.querySelectorAll("button")).some((button) =>
      button.textContent.includes("Undo ledger completion"))).toBe(true);
    confirm.mockRestore();
  });

  it("keeps voided ledger row fields read-only", async () => {
    const row = {
      id: "lr-1", site_id: site.id, trip_id: trip.id, trip_ref: trip.trip_ref,
      trip_status: "closed", lr_ref: "NGP-LR-01", receipt_date: trip.operating_date,
      receiver_name: "Receiver", rent: "100.00", hamali: "0.00",
      total_rent: "100.00", paid_total: "0.00", outstanding: "0.00",
      payment_status: "unpaid", voided: true, goods_rows: [],
    };
    api.get.mockImplementation((path) => {
      if (path === "/sites") return Promise.resolve({ data: [site] });
      if (path === `/sites/${site.id}/ledger/entries`) return Promise.resolve({ data: { rows: [row], total: 1 } });
      if (path === `/sites/${site.id}/trips`) return Promise.resolve({ data: { rows: [trip], total: 1 } });
      return Promise.resolve({ data: trip });
    });

    await renderBooking("ledger", "owner");
    await waitFor(() => expect(container.querySelector('[aria-label="NGP-LR-01 Bhada"]')).not.toBeNull());
    expect(container.querySelector('[aria-label="NGP-LR-01 Bhada"]').disabled).toBe(true);
    expect(container.querySelector('[aria-label="NGP-LR-01 Hamali"]').disabled).toBe(true);
    expect(container.textContent).toContain("VOID");
  });

  it("searches ledger receipts and filters by payment and void state", async () => {
    const ledgerRows = [
      createLedgerRow({ lr_ref: "NGP-LR-UNPAID", receiver_name: "Asha", receiver_phone: "1111111111",
        rent: "100", receipt_fee: "2", paid_total: "0", outstanding: "102", payment_status: "unpaid",
        goods_rows: [{ type: "Cement", quantity: 1 }] }),
      createLedgerRow({ id: "lr-partial", lr_ref: "NGP-LR-PARTIAL", receiver_name: "Suresh",
        receiver_phone: "2222222222", rent: "100", receipt_fee: "2", paid_total: "40",
        outstanding: "62", payment_status: "partial", goods_rows: [{ type: "Grain", quantity: 2 }] }),
      createLedgerRow({ id: "lr-voided", lr_ref: "NGP-LR-VOID", receiver_name: "Ramesh",
        voided: true, rent: "100", receipt_fee: "2", paid_total: "0", outstanding: "102",
        payment_status: "unpaid", goods_rows: [{ type: "Steel", quantity: 3 }] }),
    ];
    mockBookingApi({ trips: [trip], ledgerRows });
    await renderBooking("ledger", "owner");
    await waitFor(() => expect(container.textContent).toContain("NGP-LR-PARTIAL"));
    expect(screen.queryByRole("region", { name: "Selected trip payment summary" })).toBeNull();

    fireEvent.change(screen.getByLabelText("Filter ledger by payment status"), {
      target: { value: "partial" },
    });
    expect(container.textContent).toContain("NGP-LR-PARTIAL");
    expect(container.textContent).not.toContain("NGP-LR-UNPAID");

    fireEvent.change(screen.getByLabelText("Filter ledger by payment status"), {
      target: { value: "all" },
    });
    fireEvent.change(screen.getByLabelText("Search trip ledger"), { target: { value: "2222222222" } });
    expect(container.textContent).toContain("NGP-LR-PARTIAL");
    expect(container.textContent).not.toContain("NGP-LR-UNPAID");

    fireEvent.change(screen.getByLabelText("Search trip ledger"), { target: { value: "" } });
    fireEvent.change(screen.getByLabelText("Filter ledger by receipt status"), {
      target: { value: "voided" },
    });
    expect(container.textContent).toContain("NGP-LR-VOID");
    expect(container.textContent).not.toContain("NGP-LR-PARTIAL");

    fireEvent.change(screen.getByLabelText("Filter ledger by payment status"), {
      target: { value: "partial" },
    });
    expect(container.textContent).toContain("No receipts match these filters.");
  });

  it("keeps the ledger compact on mobile and shows each receipt's total quantity", async () => {
    const row = createLedgerRow({
      rent: "100", hamali: "10", receipt_fee: "2", paid_total: "40",
      outstanding: "62", payment_status: "partial",
      goods_rows: [{ type: "Rice", quantity: 2 }, { type: "Bottle", quantity: 4 }],
    });
    mockBookingApi({ trips: [trip], ledgerRows: [row] });
    await renderBooking("ledger", "owner");
    await waitFor(() => expect(container.textContent).toContain("NGP-LR-01"));

    const datePicker = screen.getByLabelText("Date", { selector: 'input[type="date"]' });
    expect(datePicker.parentElement.parentElement.className).toContain("sticky");
    expect(screen.queryByRole("region", { name: "Selected trip payment summary" })).toBeNull();
    const mobileReceipt = screen.getByLabelText("NGP-LR-01 mobile ledger receipt");
    expect(mobileReceipt.textContent).toContain("Total quantity: 6");
    expect(mobileReceipt.textContent).not.toContain("Partially paid");
    expect(mobileReceipt.textContent).not.toContain("Still to collect");
    expect(mobileReceipt.textContent).not.toContain("Saved");
  });

  it("keeps ledger completion disabled until ledger data is fully loaded", async () => {
    let resolveLedger;
    const row = createLedgerRow({
      rent: "100", hamali: "10", receipt_fee: "2", paid_total: "40",
      outstanding: "62", payment_status: "partial",
    });
    api.get.mockImplementation((path) => {
      if (path === "/sites") return Promise.resolve({ data: [site] });
      if (path === `/sites/${site.id}/trips`) {
        return Promise.resolve({ data: { rows: [trip], total: 1 } });
      }
      if (path === `/sites/${site.id}/ledger/entries`) {
        return new Promise((resolve) => { resolveLedger = resolve; });
      }
      return Promise.resolve({ data: trip });
    });

    await renderBooking("ledger", "owner");
    await waitFor(() => expect(resolveLedger).toBeDefined());
    expect(screen.queryByRole("region", { name: "Selected trip payment summary" })).toBeNull();
    expect(screen.getByText("Loading complete trip totals…")).toBeTruthy();
    expect(screen.getByRole("button", { name: /Complete trip ledger/ }).disabled).toBe(true);

    await act(async () => {
      resolveLedger({ data: { rows: [row], total: 1 } });
      await flushMicrotasks();
    });
    await waitFor(() => expect(screen.queryByText("Loading complete trip totals…")).toBeNull());
    expect(screen.getByRole("button", { name: /Complete trip ledger/ }).disabled).toBe(false);
    expect(screen.queryByRole("region", { name: "Selected trip payment summary" })).toBeNull();
  });

  it("shows a financial review before completing and locking the ledger", async () => {
    const row = createLedgerRow({
      rent: "100", hamali: "10", receipt_fee: "2", paid_total: "40",
      outstanding: "62", payment_status: "partial",
    });
    mockBookingApi({ trips: [trip], ledgerRows: [row] });
    await renderBooking("ledger", "owner");
    await waitFor(() => expect(screen.getByRole("button", { name: /Complete trip ledger/ }).disabled).toBe(false));
    await clickButton("Complete trip ledger");

    const review = screen.getByRole("dialog", { name: /Check trip money before finishing/ });
    expect(review.textContent).toContain("₹112");
    expect(review.textContent).toContain("₹40");
    expect(review.textContent).toContain("₹62");
    expect(review.textContent).toContain("Total amount");
    expect(review.textContent).toContain("✓ Already received");
    expect(review.textContent).toContain("! Still to collect");
    expect(api.post).not.toHaveBeenCalled();

    api.post.mockResolvedValue({ data: { id: trip.id, ledger_completed_at: "2026-10-07" } });
    await clickButton("✓ Finish trip", review);
    expect(api.post).toHaveBeenCalledWith(`/sites/${site.id}/trips/${trip.id}/ledger/complete`);
  });
  });
});
