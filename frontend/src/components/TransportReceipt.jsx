import React, { useEffect, useState } from "react";
import { CalendarDays, FileText, MapPin, Phone, UserRound } from "lucide-react";
import naiduLogo from "../assets/naidu-goods-transport-logo.png";
import { dmy } from "../lib/format";
import { partyName } from "../lib/partyNames";

function textValue(hindi, english, language) {
  if (language !== "english" && hindi) return hindi;
  return english || hindi || "";
}

function moneyParts(value) {
  if (value == null || value === "") return ["", ""];
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount === 0) return ["", ""];
  const [rupees, paise] = amount.toFixed(2).split(".");
  return [rupees, paise];
}

function quantityValue(value, language) {
  const quantity = String(value ?? "");
  return language === "english"
    ? quantity
    : quantity.replace(/[0-9]/g, (digit) => "०१२३४५६७८९"[Number(digit)]);
}

function labelValue(hindi, english, language) {
  return language === "english" ? english : hindi;
}

function villageValue(hindi, english, language) {
  const value = String(english || hindi || "").trim();
  if (/^hinganghat$/i.test(value)) {
    return language === "english" ? "Hinganghat" : "हिंगणघाट";
  }
  return textValue(hindi, english, language);
}

function FieldLabel({ icon: Icon, children }) {
  return <strong className="transport-lr-field-label">
    <Icon aria-hidden="true" className="transport-lr-field-icon" />
    <span>{children}</span>
  </strong>;
}

function ReceiptLogo({ src, name }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const initials = String(name || "LR").trim().slice(0, 2).toLocaleUpperCase();
  return (
    <span className="transport-lr-logo" aria-label={src && !failed ? "Company logo" : `${initials} company mark`}>
      {src && !failed
        ? <img src={src} alt="" onError={() => setFailed(true)} />
        : <span aria-hidden="true">{initials}</span>}
    </span>
  );
}

export default function TransportReceipt({
  receipt, settings = {}, company = {}, showCharges = true, language = "hindi",
  printSize = "default", transportDetails = [], extraDetails = [],
  partyNameDictionary = [], showSenderAddress = true, showReceiverAddress = true,
  showReceiverPhone = true,
}) {
  if (!receipt) return null;
  const name = settings.company_name || company.name || "";
  const senderName = partyName(
    receipt.sender_name || receipt.sender?.name || "",
    receipt.sender_name_hindi_verified,
    language === "english" ? "english" : "hi",
    partyNameDictionary,
  );
  const receiverName = partyName(
    receipt.receiver_name || receipt.receiver?.name || "",
    receipt.receiver_name_hindi_verified,
    language === "english" ? "english" : "hi",
    partyNameDictionary,
  );
  const address = settings.address || [company.address, company.city, company.state].filter(Boolean).join(", ");
  const logo = naiduLogo;
  const contacts = (settings.contacts || []).slice(0, 3).filter((item) =>
    item && (item.label || item.phone || item.alternate_phone));
  const goods = (receipt.goods_rows || receipt.containers || []).filter((line) =>
    line && (line.type || line.description || Number(line.quantity) > 0));
  const quantityTotal = goods.reduce((total, line) => {
    const quantity = Number(line.quantity);
    return Number.isFinite(quantity) ? total + quantity : total;
  }, 0);
  const hasQuantity = goods.some((line) =>
    line.quantity !== undefined && line.quantity !== null && line.quantity !== ""
    && Number.isFinite(Number(line.quantity)));
  const goodsDensity = goods.length > 12 ? "dense" : goods.length > 5 ? "compact" : "normal";
  const total = receipt.total_rent ?? receipt.total_amount;
  const visibleDetails = [...transportDetails, ...extraDetails].filter((item) =>
    item?.value && !/trip\s*(?:no\.?|number)?|ट्रिप\s*(?:नं\.?|नंबर)|यात्रा\s*(?:नंबर|क्रमांक)/i.test(item.label || ""));
  const chargeRows = [
    ["भाड़ा", "Freight", receipt.rent],
    ["हमाली", "Handling", receipt.hamali],
    ["बि. चार्ज", "Receipt fee", receipt.receipt_fee],
    ["उतराई", "Unloading", receipt.unloading_charge ?? receipt.unloading],
    ["कुल", "Total", total],
  ];

  return (
    <article className={`transport-lr transport-lr--${goodsDensity} ${
      printSize === "80mm" ? "transport-lr--thermal-80"
        : printSize === "58mm" ? "transport-lr--thermal-58" : ""
    }`} lang="hi" data-print-size={printSize} data-goods-count={goods.length}>
      <header className="transport-lr-header">
        <div className="transport-lr-header-left">
          {settings.legal_line && <p className="transport-lr-jurisdiction">{settings.legal_line}</p>}
          <ReceiptLogo src={logo} name={name} />
        </div>
        <div className="transport-lr-brand">
          <span className="transport-lr-om" aria-label="Om">ॐ</span>
          <div className="transport-lr-company">
            <h1>{name}</h1>
            <strong>{labelValue("माल रसीद", "GOODS CONSIGNMENT NOTE", language)}</strong>
            {address && <p>{address}</p>}
          </div>
        </div>
        <div className="transport-lr-contacts">
          {contacts.map((item, index) => (
            <p key={`${item.label || "branch"}-${index}`}>
              {item.label && <strong>{item.label}: </strong>}
              {[
                item.phone && `${item.phone_label ? `${item.phone_label} ` : ""}${item.phone}`,
                item.alternate_phone && `${item.alternate_phone_label ? `${item.alternate_phone_label} ` : ""}${item.alternate_phone}`,
              ].filter(Boolean).join(" · ")}
            </p>
          ))}
        </div>
      </header>

      <section className="transport-lr-meta" aria-label="Receipt number and date">
        <p><FieldLabel icon={FileText}>{labelValue("रसीद नं.", "Receipt No.", language)}</FieldLabel><span className="transport-lr-value transport-lr-number">{receipt.lr_ref || receipt.lr_no || ""}</span></p>
        <p><FieldLabel icon={CalendarDays}>{labelValue("दि.", "Date", language)}</FieldLabel><span className="transport-lr-value">{dmy(receipt.receipt_date || receipt.date || receipt.operating_date)}</span></p>
      </section>

      <section className="transport-lr-parties" aria-label="Sender, receiver and village">
        <div className="transport-lr-party-card">
          <div className="transport-lr-party-name">
            <FieldLabel icon={UserRound}>{labelValue("भेजनेवाले", "Sender", language)}</FieldLabel>
            <span className="transport-lr-writing" title={receipt.sender_name || receipt.sender?.name || ""}>
              {senderName}
            </span>
          </div>
          <div className="transport-lr-party-subline">
            {receipt.sender_phone && <span className="transport-lr-inline-contact">
              <FieldLabel icon={Phone}>{labelValue("फोन", "Phone", language)}</FieldLabel>
              {receipt.sender_phone}
            </span>}
            {showSenderAddress && receipt.sender_address &&
              <span className="transport-lr-party-address">{labelValue("पता", "Address", language)}: {receipt.sender_address}</span>}
          </div>
        </div>
        <div className="transport-lr-party-card">
          <div className="transport-lr-party-name">
            <FieldLabel icon={UserRound}>{labelValue("पानेवाले", "Receiver", language)}</FieldLabel>
            <span className="transport-lr-writing" title={receipt.receiver_name || receipt.receiver?.name || ""}>
              {receiverName}
            </span>
          </div>
          <div className="transport-lr-party-subline">
            {showReceiverPhone && (receipt.receiver_phone || receipt.receiver?.mobile) &&
              <span className="transport-lr-inline-contact">
                <FieldLabel icon={Phone}>{labelValue("फोन", "Phone", language)}</FieldLabel>
                {receipt.receiver_phone || receipt.receiver.mobile}
              </span>}
            <span className="transport-lr-village">
              <FieldLabel icon={MapPin}>{labelValue("गांव", "Village", language)}</FieldLabel>
              <span className="transport-lr-writing">
                {villageValue(receipt.village_hindi || receipt.city_hindi,
                  receipt.village || receipt.destination || receipt.to_name || receipt.city || receipt.receiver?.city, language)}
              </span>
            </span>
            {showReceiverAddress && receipt.receiver_address &&
              <span className="transport-lr-party-address">{labelValue("पता", "Address", language)}: {receipt.receiver_address}</span>}
          </div>
        </div>
      </section>

      {visibleDetails.length > 0 && <section className="transport-lr-details">
        {visibleDetails.map((item, index) => (
          <span key={`${item.label}-${index}`}><strong>{item.label}:</strong> {item.value}</span>
        ))}
      </section>}

      <section className="transport-lr-body" aria-label="Goods and charges">
        <div className="transport-lr-goods">
          <div className="transport-lr-table-heading">
            <strong>{labelValue("नं.", "No.", language)}</strong>
            <strong>{labelValue("मात्रा", "Quantity", language)}</strong>
            <strong>{labelValue("माल का विवरण", "Goods description", language)}</strong>
          </div>
          <div className="transport-lr-goods-lines">
            <span className="transport-lr-serial-divider" aria-hidden="true" />
            <span className="transport-lr-quantity-divider" aria-hidden="true" />
            <div className="transport-lr-goods-list">
              {goods.map((line, index) => {
                const description = [
                  textValue(line.type_hindi, line.type, language),
                  textValue(line.description_hindi, line.description, language),
                ].filter(Boolean).join(" / ");
                return <p key={`${line.id || line.type || "goods"}-${index}`}>
                  <span>{index + 1}</span>
                  <strong className="transport-lr-writing">
                    {line.quantity != null && line.quantity !== "" && quantityValue(line.quantity, language)}
                  </strong>
                  <span className="transport-lr-writing">{description}</span>
                </p>;
              })}
            </div>
            {hasQuantity && <div className="transport-lr-quantity-total">
              <strong>{labelValue("कुल मात्रा", "Total quantity", language)}</strong>
              <strong className="transport-lr-writing">
                {quantityValue(Number(quantityTotal.toFixed(2)).toString(), language)}
              </strong>
            </div>}
          </div>
        </div>
        <table className="transport-lr-charges">
          <thead><tr>
            <th>{labelValue("चार्ज", "Charge", language)}</th>
            <th>{labelValue("रुपये", "Rupees", language)}</th>
            <th>{labelValue("पैसे", "Paise", language)}</th>
          </tr></thead>
          <tbody>{chargeRows.map(([hindiLabel, englishLabel, amount], index) => {
            const [rupees, paise] = showCharges ? moneyParts(amount) : ["", ""];
            return <tr key={hindiLabel} className={index === chargeRows.length - 1 ? "transport-lr-total-row" : ""}>
              <th>{labelValue(hindiLabel, englishLabel, language)}</th><td className="transport-lr-writing">
                {rupees && <><span className="transport-lr-currency-symbol" aria-label="Indian rupees">₹</span>{rupees}</>}
              </td>
              <td className="transport-lr-writing">{paise}</td>
            </tr>;
          })}</tbody>
        </table>
      </section>

      {(settings.terms || settings.footer) && <footer className="transport-lr-footer">
        {settings.terms && <p>{settings.terms}</p>}
        {settings.footer && <p>{settings.footer}</p>}
      </footer>}
    </article>
  );
}
