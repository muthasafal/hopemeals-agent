// The planner page: a yearly giving total spread over months, drawn as jars that fill.
// The page object is shared by the page's own form and the assistant's actions, so both
// follow one set of rules.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MIN_TOTAL = 100;
const MAX_TOTAL = 10000000;

const inr = (n) => `₹${Math.round(n).toLocaleString("en-IN")}`;

export class PlannerPage {
  constructor(doc) {
    this.doc = doc;
    this.total = 36000;
    this.months = 12;
    this.version = 0;
  }

  /** Check a plan without changing anything. */
  check({ total, months }) {
    if (!Number.isInteger(total) || total < MIN_TOTAL) return { ok: false, field: "total", reason: `The yearly total must be at least ${inr(MIN_TOTAL)}.` };
    if (total > MAX_TOTAL) return { ok: false, field: "total", reason: `This planner handles up to ${inr(MAX_TOTAL)} a year.` };
    if (!Number.isInteger(months) || months < 1 || months > 12) return { ok: false, field: "months", reason: "Spread it over 1 to 12 months." };
    return { ok: true };
  }

  /** The plan as plain data, for the assistant. */
  getState() {
    const perMonth = Math.floor(this.total / this.months);
    const remainder = this.total - perMonth * this.months;
    return {
      version: this.version,
      yearlyTotal: inr(this.total),
      yearlyTotalRupees: this.total,
      months: this.months,
      perMonth: inr(perMonth),
      perMonthRupees: perMonth,
      lastMonthExtra: remainder ? inr(remainder) : null,
      monthsIncluded: MONTHS.slice(0, this.months),
      partnerLinks: { HopeMeals: this.doc.getElementById("partner-hopemeals")?.href || "" },
      note: "The planner only spreads the total. What a gift funds comes from the charity itself.",
    };
  }

  /** Change the plan; refuses bad input without changing anything. */
  setPlan({ total = this.total, months = this.months }) {
    const c = this.check({ total, months });
    if (!c.ok) return c;
    this.total = total;
    this.months = months;
    this.version++;
    this.render();
    return { ok: true, ...this.getState() };
  }

  render() {
    const d = this.doc;
    const total = d.getElementById("plan-total");
    const months = d.getElementById("plan-months");
    if (Number(total.value) !== this.total) total.value = String(this.total);
    if (Number(months.value) !== this.months) months.value = String(this.months);
    months.style.setProperty("--fill", `${((this.months - 1) / 11) * 100}%`);
    const perMonth = Math.floor(this.total / this.months);
    d.getElementById("plan-summary").textContent = `${inr(perMonth)} a month for ${this.months} month${this.months === 1 ? "" : "s"}, ${inr(this.total)} in all.`;
    d.getElementById("plan-error").textContent = "";
    const jars = d.getElementById("jars");
    if (!jars.children.length) {
      for (const m of MONTHS) {
        const jar = d.createElement("div");
        jar.className = "jar";
        jar.innerHTML = `<span class="lid" aria-hidden="true"></span><span class="fill" aria-hidden="true"></span><span class="label"></span><span class="month">${m}</span>`;
        jars.append(jar);
      }
    }
    // Fuller jars for bigger monthly gifts, up to a full jar at ₹10,000 a month.
    const level = Math.min(1, perMonth / 10000);
    [...jars.children].forEach((jar, i) => {
      const on = i < this.months;
      jar.classList.toggle("on", on);
      jar.style.setProperty("--level", on ? String(Math.max(0.12, level)) : "0");
      jar.style.setProperty("--delay", `${i * 40}ms`);
      jar.querySelector(".label").textContent = on ? inr(perMonth) : "";
    });
    d.getElementById("year").setAttribute("aria-label", `${this.months} months of ${inr(perMonth)}`);
  }

  wire() {
    const d = this.doc;
    const form = d.getElementById("plan-form");
    const onInput = () => {
      const r = this.setPlan({ total: Math.round(Number(d.getElementById("plan-total").value)), months: Number(d.getElementById("plan-months").value) });
      if (!r.ok) d.getElementById("plan-error").textContent = r.reason;
    };
    form.addEventListener("input", onInput);
    form.addEventListener("submit", (e) => e.preventDefault());
    this.render();
  }
}

export class App {
  static page = typeof document !== "undefined" ? new PlannerPage(document) : null;
}

if (typeof document !== "undefined") App.page.wire();
