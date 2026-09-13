"use client";

import Link from "next/link";
import { useState, type ReactNode } from "react";

// The method strip (redesign 2026-09-13, Rationale §4): hairline above · one bold sentence · "How this is
// computed" toggle · optional status (mono, coloured only if it is a status) · "Method →" to the /about anchor.
// The expanded prose is `children`, rendered inside the same card. Server content may be passed as children.
export default function MethodStrip({ lead, status, note, href, children }: { lead: ReactNode; status?: ReactNode; note?: ReactNode; href: string; children?: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="method">
        <strong>{lead}</strong>
        {children && (
          <button type="button" className="toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? "Hide how this is computed" : "How this is computed"}
          </button>
        )}
        {note && <span className="num text-[11px] text-muted">{note}</span>}
        {status && <span className="num text-[11px] ml-auto">{status}</span>}
        <Link href={href} className={`num text-[11px] text-secondary hover:text-primary ${status ? "" : "ml-auto"}`}>Method →</Link>
      </div>
      {open && children}
    </>
  );
}
