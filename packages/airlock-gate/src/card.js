// The extended consent card: "What this agent will learn about you".
//
// It shows, before anything leaves the device, which details are withheld or replaced
// and the visitor's own words next to what is actually sent. No framework; style it with
// airlock-gate.css (or your own rules on the .ag-* classes).

const DEST = {
  model: (d) => `your AI provider (${d})`,
  partner: (d) => `the partner site ${d}`,
  "partner-action": (d) => `the partner site ${d}`,
};

/**
 * Plain-language lines for the card: one per replaced detail.
 *
 * @param {import("./gate.js").Report} report
 * @returns {string[]}
 */
export function learnLines(report) {
  const seen = new Set();
  const lines = [];
  for (const it of report.items) {
    const key = `${it.label}|${it.replacement}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const name = it.label.charAt(0).toUpperCase() + it.label.slice(1);
    lines.push(it.action === "GENERALIZE"
      ? `${name}: only "${it.replacement.replace(/^\[[^:]+:\s*|\]$/g, "")}"`
      : `${name}: not shared`);
  }
  return lines;
}

/**
 * Build the card element. It is plain DOM, so tests can read it.
 *
 * @param {Document} doc
 * @param {import("./gate.js").Report} report
 * @param {{title?: string, buttons?: boolean}} [options]
 * @returns {HTMLElement}
 */
export function buildLearnCard(doc, report, { title = "What this agent will learn about you", buttons = true } = {}) {
  const card = doc.createElement("section");
  card.className = "ag-card";
  card.setAttribute("role", "group");
  card.setAttribute("aria-label", title);

  const h = doc.createElement("h3");
  h.className = "ag-title";
  h.textContent = title;
  h.tabIndex = -1;

  const lead = doc.createElement("p");
  lead.className = "ag-lead";
  lead.textContent = `This message goes to ${(DEST[report.channel] || DEST.model)(report.destination)}. These details stay on this device:`;

  const list = doc.createElement("ul");
  list.className = "ag-list";
  for (const line of learnLines(report)) {
    const li = doc.createElement("li");
    li.textContent = line;
    list.append(li);
  }

  card.append(h, lead, list);

  if (report.segments?.length) {
    const diff = doc.createElement("div");
    diff.className = "ag-diff";
    const yours = doc.createElement("p");
    yours.className = "ag-diff-row";
    const sent = doc.createElement("p");
    sent.className = "ag-diff-row";
    const yLabel = doc.createElement("span");
    yLabel.className = "ag-diff-label";
    yLabel.textContent = "You wrote";
    const sLabel = doc.createElement("span");
    sLabel.className = "ag-diff-label";
    sLabel.textContent = "It receives";
    yours.append(yLabel);
    sent.append(sLabel);
    for (const seg of report.segments) {
      if (seg.kind === "same") {
        yours.append(doc.createTextNode(seg.text));
        sent.append(doc.createTextNode(seg.text));
      } else {
        const del = doc.createElement("del");
        del.className = "ag-removed";
        del.textContent = seg.original;
        const ins = doc.createElement("ins");
        ins.className = "ag-added";
        ins.textContent = seg.replacement;
        yours.append(del);
        sent.append(ins);
      }
    }
    diff.append(yours, sent);
    card.append(diff);
  }

  if (buttons) {
    const row = doc.createElement("div");
    row.className = "ag-actions";
    const send = doc.createElement("button");
    send.type = "button";
    send.className = "ag-send";
    send.textContent = "Send without these details";
    const stop = doc.createElement("button");
    stop.type = "button";
    stop.className = "ag-stop";
    stop.textContent = "Don't send";
    row.append(send, stop);
    card.append(row);
  }
  return card;
}

/**
 * An onReview handler that draws the card in a container (the chat's message list) and
 * waits for the visitor.
 *
 * @param {() => HTMLElement|null} getContainer
 * @returns {(report: import("./gate.js").Report) => Promise<boolean>}
 */
export function cardReviewer(getContainer) {
  return (report) => new Promise((resolve) => {
    const container = getContainer();
    if (!container) { resolve(false); return; } // fail closed: no card, no send
    const doc = container.ownerDocument;
    const card = buildLearnCard(doc, report);
    container.append(card);
    card.scrollIntoView?.({ block: "nearest" });
    card.querySelector(".ag-title").focus?.();
    const done = (ok) => {
      card.querySelector(".ag-actions")?.remove();
      const note = doc.createElement("p");
      note.className = "ag-note";
      note.textContent = ok ? "Sent without these details." : "Not sent. Nothing left this device.";
      card.append(note);
      resolve(ok);
    };
    card.querySelector(".ag-send").addEventListener("click", () => done(true));
    card.querySelector(".ag-stop").addEventListener("click", () => done(false));
  });
}

/**
 * A render function for wrapConsent: adds the learn block (no buttons, since the
 * runtime's own card has Allow and Decline) under the newest consent card.
 *
 * @param {() => HTMLElement|null} getContainer
 */
export function consentRenderer(getContainer) {
  return (report) => {
    if (!report.items.length) return;
    const container = getContainer();
    if (!container) return;
    const cards = container.querySelectorAll(".ns-consent");
    const target = cards[cards.length - 1] || container;
    target.append(buildLearnCard(container.ownerDocument, report, { buttons: false }));
  };
}
