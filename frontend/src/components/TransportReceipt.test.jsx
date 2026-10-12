import React from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import TransportReceipt from "./TransportReceipt";
import naiduLogo from "../assets/naidu-goods-transport-logo.png";

describe("TransportReceipt", () => {
  const receipt = {
    lr_ref: "NGP-LR-01",
    receipt_date: "2026-10-08",
    sender_name: "Saman",
    receiver_name: "Ramesh",
    village: "Nagpur",
    goods_rows: [{ type: "Rice", type_hindi: "चावल", quantity: 2 }],
    rent: "30.00",
    hamali: "5.00",
    receipt_fee: "2.00",
    total_rent: "37.00",
  };

  it("renders the compact goods and separated rupees/paise charge table", () => {
    const { container } = render(<TransportReceipt receipt={receipt} settings={{
      company_name: "नायडू गुड्स ट्रांसपोर्ट",
      legal_line: "Nagpur jurisdiction",
      address: "Nagpur",
      contacts: [{ label: "Nagpur", phone: "0000000000" }],
    }} />);

    expect(screen.getByText("NGP-LR-01")).toBeTruthy();
    expect(screen.getByText("08-10-2026")).toBeTruthy();
    expect(screen.getByText("नायडू गुड्स ट्रांसपोर्ट")).toBeTruthy();
    expect(screen.getByText("चावल")).toBeTruthy();
    expect(screen.getAllByText("२")).toHaveLength(2);
    expect(container.querySelector(".transport-lr-header-left").firstElementChild.classList
      .contains("transport-lr-jurisdiction")).toBe(true);
    expect(container.querySelector(".transport-lr-header-left > .transport-lr-logo")).not.toBeNull();
    expect(container.querySelector(".transport-lr-brand > .transport-lr-om")).not.toBeNull();
    expect(container.querySelector(".transport-lr-brand > .transport-lr-company")).not.toBeNull();
    expect(container.querySelector(".transport-lr-logo").getAttribute("class")).toContain("transport-lr-logo");
    expect(container.querySelector(".transport-lr-brand .transport-lr-om").textContent).toBe("ॐ");
    expect(container.querySelector(".transport-lr-contacts").textContent).toContain("0000000000");
    expect(container.querySelector('.transport-lr-meta [aria-hidden="true"].transport-lr-field-icon')).not.toBeNull();
    expect(container.querySelector(".transport-lr-serial-divider")).not.toBeNull();
    expect(container.querySelector(".transport-lr-quantity-divider")).not.toBeNull();
    expect([...container.querySelectorAll(".transport-lr-table-heading strong")]
      .map((heading) => heading.textContent)).toEqual(["नं.", "मात्रा", "माल का विवरण"]);
    expect([...container.querySelector(".transport-lr-goods-list > p").children]
      .map((cell) => cell.textContent)).toEqual(["1", "२", "चावल"]);
    expect(container.querySelectorAll(".transport-lr-parties .transport-lr-field-icon").length)
      .toBeGreaterThanOrEqual(3);
    const amountCells = [...container.querySelectorAll(".transport-lr-charges tbody tr:last-child td")]
      .map((cell) => cell.textContent);
    expect(amountCells).toEqual(["₹37", "00"]);
    expect(container.querySelectorAll(".transport-lr-currency-symbol")).toHaveLength(4);
  });

  it("renders thermal receipt layouts at the configured roll width", () => {
    const { container, rerender } = render(<TransportReceipt receipt={receipt} printSize="80mm" />);
    const receiptElement = container.querySelector(".transport-lr");

    expect(receiptElement.classList.contains("transport-lr--thermal-80")).toBe(true);
    expect(receiptElement.getAttribute("data-print-size")).toBe("80mm");
    expect(receiptElement.textContent).toContain("NGP-LR-01");
    expect(receiptElement.textContent).toContain("चावल");
    expect(receiptElement.textContent).toContain("₹30");

    rerender(<TransportReceipt receipt={receipt} printSize="58mm" />);
    expect(container.querySelector(".transport-lr").classList.contains("transport-lr--thermal-58"))
      .toBe(true);
    expect(container.querySelector(".transport-lr").getAttribute("data-print-size")).toBe("58mm");
  });

  it("ignores unverified legacy Hindi fields and transliterates the original party spelling", () => {
    const { container } = render(<TransportReceipt receipt={{
      ...receipt,
      sender_name_hindi: "अम्बिक",
      receiver_name_hindi: "जधव",
    }} />);

    expect(container.querySelectorAll(".transport-lr-party-name .transport-lr-writing")[0].textContent)
      .toBe("समन");
    expect(container.querySelectorAll(".transport-lr-party-name .transport-lr-writing")[1].textContent)
      .toBe("रमेश");
    expect(container.textContent).not.toContain("अम्बिक");
    expect(container.textContent).not.toContain("जधव");
  });

  it("prints verified Hindi party names on Hindi receipts but keeps English receipt names unchanged", () => {
    const localizedReceipt = {
      ...receipt,
      sender_name: "Aniket",
      sender_name_hindi: "अम्बिक",
      sender_name_hindi_verified: "अनिकेत",
      receiver_name: "Ashok Bogande",
      receiver_name_hindi: "जधव",
      receiver_name_hindi_verified: "अशोक बोगांडे",
    };
    const { container, rerender } = render(<TransportReceipt receipt={localizedReceipt} />);
    const getPartyNames = () => [...container.querySelectorAll(
      ".transport-lr-party-name .transport-lr-writing",
    )].map((element) => element.textContent);

    expect(getPartyNames()).toEqual(["अनिकेत", "अशोक बोगांडे"]);

    rerender(<TransportReceipt receipt={localizedReceipt} language="english" />);
    expect(getPartyNames()).toEqual(["Aniket", "Ashok Bogande"]);
  });

  it("transliterates names on Hindi receipts when no verified spelling exists", () => {
    const { container } = render(<TransportReceipt receipt={{
      ...receipt,
      sender_name: "Deepak Jadhav",
      receiver_name: "Kasva General",
    }} />);

    expect([...container.querySelectorAll(
      ".transport-lr-party-name .transport-lr-writing",
    )].map((element) => element.textContent)).toEqual(["दीपक जधव", "कस्वा जनरल"]);
  });

  it("leaves unentered charges and the total blank on the printable receipt", () => {
    const { container } = render(<TransportReceipt receipt={{
      ...receipt,
      rent: null,
      hamali: "0.00",
      total_rent: null,
    }} />);
    const chargeRows = [...container.querySelectorAll(".transport-lr-charges tbody tr")];

    expect(chargeRows[0].querySelectorAll("td")[0].textContent).toBe("");
    expect(chargeRows[0].querySelectorAll("td")[1].textContent).toBe("");
    expect(chargeRows[1].querySelectorAll("td")[0].textContent).toBe("");
    expect(chargeRows[1].querySelectorAll("td")[1].textContent).toBe("");
    expect(chargeRows.at(-1).querySelectorAll("td")[0].textContent).toBe("");
    expect(chargeRows.at(-1).querySelectorAll("td")[1].textContent).toBe("");
    expect(chargeRows[2].textContent).toContain("₹2");
  });

  it("prints configurable branch contact lines in the right-side header block", () => {
    const { container } = render(<TransportReceipt receipt={receipt} settings={{
      company_name: "Transport",
      legal_line: "Nagpur jurisdiction",
      contacts: [
        { label: "Nagpur", phone: "2767741", alternate_phone: "7304047399" },
        { label: "Wadi", phone: "9420681470", alternate_phone: "9260629740" },
        {
          label: "Hinganghat", phone: "244240", phone_label: "(O)",
          alternate_phone: "9764424190", alternate_phone_label: "(G)",
        },
        { label: "Extra", phone: "0000000000" },
      ],
    }} />);

    const contacts = container.querySelector(".transport-lr-contacts");
    expect(container.querySelector(".transport-lr-header-left .transport-lr-jurisdiction").textContent)
      .toBe("Nagpur jurisdiction");
    expect(contacts.textContent).not.toContain("Nagpur jurisdiction");
    expect(contacts.textContent).toContain("2767741 · 7304047399");
    expect(contacts.textContent).toContain("Wadi: 9420681470 · 9260629740");
    expect(contacts.textContent).toContain("Hinganghat: (O) 244240 · (G) 9764424190");
    expect(contacts.textContent).not.toContain("Extra");
    expect(container.querySelector(".transport-lr-brand").textContent).toContain("Transport");
  });

  it("shows a Hindi total quantity below all goods rows", () => {
    const { container } = render(<TransportReceipt receipt={{
      ...receipt,
      goods_rows: [
        { description: "कार का पुर्जा", quantity: 5 },
        { description: "कार्टन", quantity: "10" },
        { description: "अनाज", quantity: 55 },
      ],
    }} />);

    const totalRow = container.querySelector(".transport-lr-quantity-total");
    expect(totalRow.textContent).toContain("कुल मात्रा");
    expect(totalRow.textContent).toContain("७०");
    expect(totalRow.lastElementChild.textContent).toBe("७०");
    expect(container.querySelectorAll(".transport-lr-goods-list > p")).toHaveLength(3);
  });

  it("compacts a long goods list to keep its rows and quantity total within the LR layout", () => {
    const goodsRows = Array.from({ length: 8 }, (_, index) => ({
      type_hindi: `सामान ${index + 1}`,
      quantity: index + 1,
    }));
    const { container } = render(<TransportReceipt receipt={{
      ...receipt,
      goods_rows: goodsRows,
    }} />);

    const lr = container.querySelector(".transport-lr");
    expect(lr.classList.contains("transport-lr--compact")).toBe(true);
    expect(lr.getAttribute("data-goods-count")).toBe("8");
    expect(container.querySelectorAll(".transport-lr-goods-list > p")).toHaveLength(8);
    expect(container.querySelector(".transport-lr-quantity-total").textContent).toContain("३६");
  });

  it("uses the denser goods layout for very long item lists", () => {
    const { container } = render(<TransportReceipt receipt={{
      ...receipt,
      goods_rows: Array.from({ length: 13 }, (_, index) => ({
        description: `Goods item ${index + 1}`,
        quantity: 1,
      })),
    }} />);

    expect(container.querySelector(".transport-lr").classList.contains("transport-lr--dense")).toBe(true);
    expect(container.querySelectorAll(".transport-lr-goods-list > p")).toHaveLength(13);
  });

  it("shows the total quantity in English when English receipt language is selected", () => {
    const { container } = render(<TransportReceipt receipt={{
      ...receipt, goods_rows: [{ description: "Carton", quantity: 5 }],
    }} language="english" />);

    expect(container.querySelector(".transport-lr-quantity-total").textContent)
      .toContain("Total quantity5");
  });

  it("uses the text mark when the receipt logo cannot load", () => {
    const { container } = render(<TransportReceipt receipt={receipt} settings={{
      company_name: "Transport",
      logo_url: "/api/files/broken.png",
    }} />);

    fireEvent.error(container.querySelector(".transport-lr-logo img"));
    expect(container.querySelector(".transport-lr-logo img")).toBeNull();
    expect(container.querySelector(".transport-lr-logo > span").textContent).toBe("TR");
  });

  it("uses the supplied Naidu logo without moving the centered company block", () => {
    const { container } = render(<TransportReceipt receipt={receipt}
      settings={{
        company_name: "Transport",
        legal_line: "Nagpur jurisdiction",
        logo_url: "/api/files/uploaded-receipt-logo.png",
      }}
      company={{ logo: "/api/files/other-logo.png" }} />);
    expect(container.querySelector(".transport-lr-logo img").getAttribute("src"))
      .toBe(naiduLogo);
    expect(container.querySelector(".transport-lr-brand > .transport-lr-company h1").textContent)
      .toBe("Transport");
    expect(container.querySelector(".transport-lr-header-left > .transport-lr-logo")
      .previousElementSibling.classList.contains("transport-lr-jurisdiction")).toBe(true);
  });

  it("keeps the supplied Naidu logo when no uploaded logos are configured", () => {
    const { container } = render(<TransportReceipt receipt={receipt}
      settings={{ company_name: "Transport", logo_url: "" }}
      company={{ logo: "/api/files/other-logo.png" }} />);
    expect(container.querySelector(".transport-lr-logo img").getAttribute("src"))
      .toBe(naiduLogo);
  });

  it("keeps the supplied receipt logo when company branding changes", () => {
    const { container, rerender } = render(<TransportReceipt receipt={receipt} settings={{
      company_name: "Transport",
      logo_url: "/api/files/broken.png",
    }} />);
    const image = container.querySelector(".transport-lr-logo img");
    rerender(<TransportReceipt receipt={receipt} settings={{
      company_name: "Transport",
      logo_url: "/api/files/replacement.png",
    }} />);

    expect(container.querySelector(".transport-lr-logo img").getAttribute("src"))
      .toBe(naiduLogo);
  });

  it("keeps receiver name and phone on one line and respects address visibility", () => {
    const { container } = render(<TransportReceipt receipt={{
      ...receipt,
      sender_address: "Old Sender Road",
      receiver_address: "Old Receiver Road",
      receiver_phone: "9876543210",
    }} showSenderAddress={false} showReceiverAddress={false} />);

    const partyCards = container.querySelectorAll(".transport-lr-party-card");
    expect(partyCards[0].textContent).toContain("समन");
    expect(partyCards[1].textContent).toContain("रमेश");
    expect(partyCards[1].textContent).toContain("9876543210");
    expect(container.querySelector(".transport-lr-party-address")).toBeNull();
  });

  it("shows sender and receiver phones when supplied and formats Hinganghat in Hindi", () => {
    const { container } = render(<TransportReceipt receipt={{
      ...receipt,
      village: "Hinganghat",
      sender_phone: "9123456789",
      receiver_phone: "9876543210",
    }} />);

    expect(container.textContent).toContain("हिंगणघाट");
    expect(container.textContent).toContain("9123456789");
    expect(container.textContent).toContain("9876543210");
    const partyCards = container.querySelectorAll(".transport-lr-party-card");
    expect(partyCards[0].textContent).toContain("समन");
    expect(partyCards[0].textContent).toContain("9123456789");
    expect(partyCards[1].textContent).toContain("रमेश");
    expect(partyCards[1].textContent).toContain("9876543210");
    expect(partyCards[1].querySelector(".transport-lr-party-name").textContent)
      .not.toContain("9876543210");
    expect(partyCards[1].querySelector(".transport-lr-party-subline").textContent)
      .toContain("हिंगणघाट");
  });

  it("does not render trip number in receipt details", () => {
    const { container } = render(<TransportReceipt receipt={receipt}
      transportDetails={[{ label: "Trip No.", value: "TRIP-123" }]} />);

    expect(container.textContent).not.toContain("TRIP-123");
  });

  it("can omit the receiver phone when phone details are disabled", () => {
    const { container } = render(<TransportReceipt receipt={{
      ...receipt, receiver_phone: "9876543210",
    }} showReceiverPhone={false} />);

    expect(container.querySelector(".transport-lr-inline-contact")).toBeNull();
    expect(container.textContent).not.toContain("9876543210");
  });
});
