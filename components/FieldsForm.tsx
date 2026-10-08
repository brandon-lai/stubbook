"use client";

import { carrierLabel, titleLabel } from "@/lib/format";
import { TICKET_TYPES, type FieldSource, type Fields } from "@/lib/types";

const TYPE_NAMES: Record<Fields["type"], string> = { flight: "Flight", train: "Train", subway: "Subway", event: "Event", other: "Other" };

interface Props {
  fields: Fields;
  sources?: Partial<Record<keyof Fields, FieldSource>>;
  onChange: (f: Fields, key: keyof Fields) => void;
  disabled?: boolean;
}

export default function FieldsForm({ fields: f, sources = {}, onChange, disabled }: Props) {
  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...f, [k]: e.target.value }, k);
  const src = (k: keyof Fields) => (sources[k] === "barcode" ? <span className="src">from barcode</span> : sources[k] === "text" || sources[k] === "ai" ? <span className="src">read</span> : null);
  const travel = f.type !== "event";
  return (
    <fieldset disabled={disabled} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
      <div className="field">
        <span className="label">Type{src("type")}</span>
        <div className="seg" role="group" aria-label="Ticket type">
          {TICKET_TYPES.map((t) => (
            <button key={t} type="button" aria-pressed={f.type === t} onClick={() => onChange({ ...f, type: t }, "type")}>{TYPE_NAMES[t]}</button>
          ))}
        </div>
      </div>
      {travel && (
        <div className="grid2">
          <div className="field"><label htmlFor="f-origin">From{src("origin")}</label><input id="f-origin" className="input" value={f.origin} onChange={set("origin")} autoComplete="off" /></div>
          <div className="field"><label htmlFor="f-dest">To{src("destination")}</label><input id="f-dest" className="input" value={f.destination} onChange={set("destination")} autoComplete="off" /></div>
        </div>
      )}
      <div className="grid2">
        <div className="field"><label htmlFor="f-title">{titleLabel(f.type)}{src("title")}</label><input id="f-title" className="input" value={f.title} onChange={set("title")} autoComplete="off" /></div>
        <div className="field"><label htmlFor="f-date">Date{src("date")}</label><input id="f-date" className="input" type="date" value={f.date} onChange={set("date")} /></div>
      </div>
      <div className="grid2">
        <div className="field"><label htmlFor="f-carrier">{carrierLabel(f.type)}{src("carrier")}</label><input id="f-carrier" className="input" value={f.carrier} onChange={set("carrier")} autoComplete="off" /></div>
        <div className="field"><label htmlFor="f-seat">Seat{src("seat")}</label><input id="f-seat" className="input" value={f.seat} onChange={set("seat")} autoComplete="off" /></div>
      </div>
    </fieldset>
  );
}
