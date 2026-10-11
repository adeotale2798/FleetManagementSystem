import React from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Ban, MessageCircle, Printer, Truck } from "lucide-react";
import { api, assetUrl, errMsg } from "../lib/api";
import { useFetch } from "../lib/hooks";
import { money, dmy } from "../lib/format";
import { hasAdminAccess } from "../lib/adminAccess";
import { Badge, Btn, Card, ErrorState, Loader, PageHead, toast } from "../components/ui";
import TransportReceipt from "../components/TransportReceipt";

export default function LRView({ user }) {
  const { id } = useParams();
  const nav = useNavigate();
  const { data: lr, loading, error, reload } = useFetch(`/lrs/${id}`);
  const canFinance = hasAdminAccess(user, "industrial_finance");

  if (loading && !lr) return <Loader />;
  if (error) return <ErrorState text={error} onRetry={reload} />;

  const c = lr.company || {};
  const cancel = async () => {
    if (!window.confirm("Cancel this LR? The freight will be reversed from the party ledger.")) return;
    try { await api.post(`/lrs/${id}/cancel`); toast("LR cancelled"); reload(); }
    catch (e) { toast(errMsg(e), "err"); }
  };

  const share = () => {
    const mob = String(lr.sender?.mobile || lr.receiver?.mobile || "").replace(/\D/g, "");
    const text = [
      `*${c.name || "Transport"}* — Lorry Receipt`,
      `LR No: ${lr.lr_no}`,
      `Date: ${dmy(lr.date)}`,
      `Route: ${lr.from_name} → ${lr.to_name}`,
      `Vehicle: ${lr.vehicle_no}${lr.driver_name ? ` · Driver: ${lr.driver_name}` : ""}`,
      `Sender: ${lr.sender?.name || "—"}`,
      `Receiver: ${lr.receiver?.name || "—"}`,
      `Goods: ${(lr.items?.length ? lr.items.map((i) => i.description).filter(Boolean).join(", ") : lr.goods_description) || "—"}`,
      ...(canFinance ? [
        `Freight: ${money(lr.freight)} (${lr.payment_status})`,
        lr.outstanding > 0 ? `Pending: ${money(lr.outstanding)}` : "",
      ] : []),
      c.mobile ? `Contact: ${c.mobile}` : "",
    ].filter(Boolean).join("\n");
    const url = `https://wa.me/${mob ? (mob.length === 10 ? `91${mob}` : mob) : ""}?text=${encodeURIComponent(text)}`;
    window.open(url, "_blank");
  };
  const printReceipt = () => {
    window.print();
  };

  const rows = lr.items?.length ? lr.items : [{
    description: lr.goods_description, quantity: lr.quantity, weight: lr.weight,
    rate: "", amount: lr.freight,
  }];
  const receipt = {
    lr_ref: lr.lr_no,
    receipt_date: lr.date,
    sender_name: lr.sender?.name,
    sender_phone: lr.sender?.mobile,
    receiver_name: lr.receiver?.name,
    receiver_phone: lr.receiver?.mobile,
    village: lr.to_name || lr.receiver?.city,
    goods_rows: rows.map((item) => ({
      description: item.description || "",
      quantity: item.quantity,
    })),
    rent: lr.freight,
    total_rent: lr.freight,
  };
  const optionalDetails = [
    ...(canFinance ? [
      ["Freight type", lr.freight_type],
      ["Payment", lr.payment_status],
      ["Received", lr.received == null ? "" : money(lr.received)],
      ["Outstanding", lr.outstanding == null ? "" : money(lr.outstanding)],
    ] : []),
    ["Invoice No.", lr.optional?.invoice_no],
    ["E-way Bill", lr.optional?.eway],
    ["HSN", lr.optional?.hsn],
    ["Packaging", lr.optional?.packaging],
    ...(canFinance ? [["Goods value", lr.optional?.goods_value == null ? "" : money(lr.optional.goods_value)]] : []),
    ["Status", lr.cancelled ? "CANCELLED" : ""],
  ].filter(([, value]) => value).map(([label, value]) => ({ label, value }));
  const contacts = [c.mobile || c.alt_mobile ? {
    label: "", phone: c.mobile || "", alternate_phone: c.alt_mobile || "",
  } : null].filter(Boolean);

  return (
    <div className="lr-view-page mx-auto max-w-4xl">
      <style>{`
        @page { size: 260mm 160mm; margin: 0; }
        @media print {
          .lr-view-page { width: 260mm !important; max-width: none !important; margin: 0 !important; }
          .lr-view-page .transport-lr-preview { overflow: visible !important; }
        }
      `}</style>
      <div className="no-print">
        <PageHead title={`LR ${lr.lr_no}`} back="/trips?tab=lrs"
          subtitle={`${dmy(lr.date)} · ${lr.from_name} → ${lr.to_name}`}
          actions={
            <div className="flex max-w-full flex-wrap gap-2">
              <Btn variant="s" icon={Printer} data-testid="print-lr" onClick={printReceipt}>Print</Btn>
              <Btn variant="s" icon={MessageCircle} data-testid="share-lr-whatsapp" onClick={share}>WhatsApp</Btn>
              <Btn variant="s" icon={Printer} data-testid="download-lr" onClick={printReceipt}>Save as PDF / Print</Btn>
              {lr.trip_id && <Btn variant="s" icon={Truck} onClick={() => nav(`/trips/${lr.trip_id}`)}>Open Trip</Btn>}
              {canFinance && !lr.cancelled && <Btn variant="d" icon={Ban} onClick={cancel}>Cancel LR</Btn>}
            </div>
          } />
        {canFinance && <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          {[["Freight", money(lr.freight)], ["Received", money(lr.received)],
            ["Outstanding", money(lr.outstanding)], ["Status", lr.payment_status]].map(([k, v]) => (
            <Card key={k} className="p-3.5">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-muted">{k}</p>
              {k === "Status" ? <div className="mt-2"><Badge>{v}</Badge></div>
                : <p className="num mt-1.5 font-head text-[19px] font-bold">{v}</p>}
            </Card>
          ))}
        </div>}
      </div>

      <div className="transport-lr-preview" data-testid="lr-document">
        <TransportReceipt receipt={receipt} settings={{
          company_name: c.name || "",
          legal_line: c.legal_line || "",
          address: [c.address, c.city, c.state].filter(Boolean).join(", "),
          logo_url: assetUrl(c.logo || ""),
          contacts,
          terms: c.terms || lr.remarks || "",
          footer: c.footer || "",
        }} company={c} transportDetails={[
          { label: "From", value: lr.from_name },
          { label: "To", value: lr.to_name },
          { label: "Vehicle", value: lr.vehicle_no },
          { label: "Driver", value: lr.driver_name },
        ]} extraDetails={optionalDetails} />
      </div>

      {canFinance && lr.receipts?.length > 0 && (
        <Card className="no-print mt-4 overflow-hidden">
          <div className="border-b border-line px-4 py-3"><h3 className="font-head text-[15.5px] font-bold">Payments against this LR</h3></div>
          <table className="w-full">
            <tbody className="divide-y divide-line">
              {lr.receipts.map((r) => (
                <tr key={r.id}>
                  <td className="td">{dmy(r.date)}</td>
                  <td className="td">{r.mode}{r.deewanji_name ? ` · ${r.deewanji_name}` : ""}</td>
                  <td className="td num text-right font-semibold">{money(r.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}
