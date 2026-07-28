"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { renderRr3Template, type Rr3TokenData } from "@/lib/rr3Template";

interface Rr3Card extends Rr3TokenData {
  CardId: string;
}

export default function PrintRr3Page() {
  const searchParams = useSearchParams();
  const property = searchParams.get("property") || "";
  const startDate = searchParams.get("start_date") || "";
  const endDate = searchParams.get("end_date") || "";
  const cardId = searchParams.get("card_id");
  const cardIdsParam = searchParams.get("card_ids");
  const cardIds = cardIdsParam ? cardIdsParam.split(",").filter(Boolean) : null;

  const [cards, setCards] = useState<Rr3Card[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [template, setTemplate] = useState<string | null>(null);
  const [templateError, setTemplateError] = useState<string | null>(null);

  useEffect(() => {
    const fetchCards = async () => {
      try {
        const params = new URLSearchParams({
          property_name: property,
          start_date: startDate,
          end_date: endDate,
        });
        const res = await fetch(`/api/rr3/cards?${params.toString()}`);
        const result = await res.json();
        if (result.status !== "success") throw new Error(result.message || result.detail || "Failed to load RR3 cards");
        let data: Rr3Card[] = result.data || [];
        if (cardIds) {
          const idSet = new Set(cardIds);
          data = data.filter((c) => idSet.has(c.CardId));
        } else if (cardId) {
          data = data.filter((c) => c.CardId === cardId);
        }
        setCards(data);
      } catch (err: any) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };
    if (property) fetchCards();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [property, startDate, endDate, cardId, cardIdsParam]);

  useEffect(() => {
    const fetchTemplate = async () => {
      try {
        // No property_name - the RR3 card is one shared template for every property.
        const res = await fetch(`/api/rr3/template`);
        const result = await res.json();
        if (result.status === "success") {
          setTemplate(result.data.html_template);
        } else {
          // A non-2xx response still parses as JSON, so check explicitly -
          // otherwise the page sits on "Loading template..." forever (same
          // silent-hang bug the billing print page had).
          setTemplateError(result.message || result.detail || "Failed to load RR3 template");
        }
      } catch (err: any) {
        setTemplateError(err.message || "Failed to load RR3 template");
      }
    };
    fetchTemplate();
  }, []);

  if (loading) return <div className="p-10 text-center text-sm">Loading...</div>;
  if (error) return <div className="p-10 text-center text-red-600 text-sm">{error}</div>;
  if (cards.length === 0) return <div className="p-10 text-center text-sm">No guest cards found for this range.</div>;
  if (templateError) return <div className="p-10 text-center text-red-600 text-sm">{templateError}</div>;
  if (!template) return <div className="p-10 text-center text-sm">Loading template...</div>;

  return (
    <div style={{ minHeight: "100vh", background: "#525659", padding: "40px 0" }}>
      <div className="no-print" style={{ position: "fixed", top: 20, right: 20, display: "flex", gap: 10, zIndex: 9999 }}>
        <button onClick={() => window.print()} className="btn-brand btn-primary">
          Print / Save as PDF ({cards.length} card{cards.length > 1 ? "s" : ""})
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 20 }}>
        {cards.map((c) => (
          <div key={c.CardId} dangerouslySetInnerHTML={{ __html: renderRr3Template(template, c) }} />
        ))}
      </div>
    </div>
  );
}
