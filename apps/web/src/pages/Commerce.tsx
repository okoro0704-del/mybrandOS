import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FULFILLMENT_TYPES, type CommerceCenterPayload, type CommerceOffer } from "@mybrandos/shared";
import { api } from "../lib/api";

export function CommercePage() {
  const [data, setData] = useState<CommerceCenterPayload | null>(null);
  const [assetId, setAssetId] = useState("");
  const [price, setPrice] = useState("10");
  const [fulfillmentType, setFulfillmentType] = useState<(typeof FULFILLMENT_TYPES)[number]>("DIGITAL_ACCESS");
  const [error, setError] = useState("");

  async function load() {
    setData(await api<CommerceCenterPayload>("/commerce"));
  }

  useEffect(() => {
    void load();
  }, []);

  if (!data) return <section className="page"><p className="muted">Loading commerce structure…</p></section>;

  async function create() {
    setError("");
    try {
      await api("/commerce/offers", {
        method: "POST",
        body: JSON.stringify({ assetId, price: Number(price), fulfillmentType, kind: "OFFER" }),
      });
      setAssetId("");
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create offer.");
    }
  }

  async function act(offer: CommerceOffer, action: "activate" | "pause" | "archive") {
    setError("");
    try {
      await api(`/commerce/offers/${offer.id}/${action}`, { method: "POST", body: JSON.stringify({}) });
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update offer.");
    }
  }

  return (
    <section className="page">
      <header className="page-head">
        <div className="eyebrow">Commerce</div>
        <h1>Offers and economic operations</h1>
        <p>The Asset stays the creative object. An Offer is what you sell. Money movement stays on FundzMan.</p>
      </header>
      <p className="placeholder-note">{data.payments.available ? data.payments.detail : "payments_unavailable"}</p>
      <p className="placeholder-note">{data.refunds.available ? data.refunds.detail : "refund_unavailable"}</p>
      {error ? <p className="placeholder-note">{error}</p> : null}

      <div className="grid grid-3">
        <article className="panel stat"><div className="eyebrow">Offers</div><b>{data.offers.length}</b></article>
        <article className="panel stat"><div className="eyebrow">Paid orders</div><b>{data.metrics.paidOrders}</b></article>
        <article className="panel stat">
          <div className="eyebrow">Period revenue</div>
          <b>{data.metrics.fundzmanBound && data.metrics.periodRevenue != null ? data.metrics.periodRevenue.toLocaleString() : "—"}</b>
        </article>
      </div>

      <article className="panel" style={{ marginTop: 16 }}>
        <div className="eyebrow">Create offer</div>
        <label className="field">
          Asset ID
          <input value={assetId} onChange={(e) => setAssetId(e.target.value)} placeholder="Published asset id" />
        </label>
        <label className="field">
          Price
          <input value={price} onChange={(e) => setPrice(e.target.value)} />
        </label>
        <label className="field">
          Fulfillment
          <select value={fulfillmentType} onChange={(e) => setFulfillmentType(e.target.value as (typeof FULFILLMENT_TYPES)[number])}>
            {FULFILLMENT_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
        </label>
        <button className="btn" onClick={() => void create()}>Create Offer</button>
      </article>

      <article className="panel" style={{ marginTop: 16 }}>
        <div className="eyebrow">Offers</div>
        {data.offers.length === 0 ? <p className="muted">No offers yet. Wrap a published Asset.</p> : null}
        {data.offers.map((offer) => (
          <div className="list-row" key={offer.id}>
            <div>
              <strong>{offer.title}</strong>
              <div className="small muted">
                {offer.status} · {offer.price} {offer.currency} · {offer.fulfillmentType || "fulfillment unset"}
              </div>
            </div>
            <div className="actions">
              {offer.assetId ? <Link to={`/assets/${offer.assetId}`}>Asset</Link> : null}
              {offer.status === "DRAFT" ? <button className="btn" onClick={() => void act(offer, "activate")}>Activate</button> : null}
              {offer.status === "ACTIVE" ? <button className="btn ghost" onClick={() => void act(offer, "pause")}>Pause</button> : null}
              {offer.status !== "ARCHIVED" ? <button className="btn ghost" onClick={() => void act(offer, "archive")}>Archive</button> : null}
            </div>
          </div>
        ))}
      </article>

      <article className="panel" style={{ marginTop: 16 }}>
        <div className="eyebrow">Orders</div>
        {data.orders.length === 0 ? <p className="muted">No orders yet. Sales numbers are not invented.</p> : null}
        {data.orders.map((order) => (
          <div className="list-row" key={order.id}>
            <div>
              <strong>{order.offerTitle}</strong>
              <div className="small muted">{order.paymentState} · fulfillment {order.fulfillmentState} · {order.amount} {order.currency}</div>
            </div>
            <span className="chip">{order.paymentState}</span>
          </div>
        ))}
      </article>
    </section>
  );
}
