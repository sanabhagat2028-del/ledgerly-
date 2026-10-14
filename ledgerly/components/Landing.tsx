"use client";

import { useEffect, useRef } from "react";
import { LANDING_HTML } from "./landing-markup";

type DemoItem = { t: string; d: string; m: string; c: string; a: number };

const ITEMS: DemoItem[] = [
  { t: "Rs.649.00 debited from a/c XX4821 to NETFLIX.COM on 03-09-26. UPI Ref 4839201.", d: "03 Sep", m: "Netflix", c: "Subscriptions", a: 649 },
  { t: "INR 412.00 spent on HDFC Card XX7710 at SWIGGY on 05-09-26.", d: "05 Sep", m: "Swiggy", c: "Food delivery", a: 412 },
  { t: "Rs.18,500.00 debited a/c XX4821 UPI/RENT SEP/ANIL K on 07-09-26.", d: "07 Sep", m: "Rent", c: "Rent", a: 18500 },
  { t: "Rs.7,240.00 debited towards EMI, Loan A/c XX3305 on 10-09-26.", d: "10 Sep", m: "Loan EMI", c: "EMIs", a: 7240 },
  { t: "INR 1,499.00 debited to CULT.FIT MEMBERSHIP on 12-09-26 via UPI.", d: "12 Sep", m: "Cult.fit", c: "Subscriptions", a: 1499 },
];

const inr = (n: number) => "₹" + Number(n).toLocaleString("en-IN");

/**
 * The landing page markup is static, trusted HTML that ships with the app (see landing-markup.ts).
 * This component only attaches the interactions: the SMS-to-ledger loop, the stamp demo,
 * the red-pen circle and the "how to cancel" toggles.
 */
export default function Landing() {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = ref.current;
    if (!root) return;
    const q = <T extends Element>(s: string) => root.querySelector(s) as T | null;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let alive = true;
    const timers = new Set<number>();
    const sleep = (ms: number) =>
      new Promise<void>((res) => {
        const id = window.setTimeout(() => {
          timers.delete(id);
          res();
        }, ms);
        timers.add(id);
      });

    /* hero: SMS to ledger */
    const smsEl = q<HTMLElement>("#sms")!;
    const rowsEl = q<HTMLElement>("#rows")!;
    const totEl = q<HTMLElement>("#ltotal")!;

    const addRow = (it: DemoItem, animate: boolean) => {
      const li = document.createElement("li");
      li.className = "lrow" + (animate ? " snap" : "");
      const d = document.createElement("span");
      d.className = "mono d";
      d.textContent = it.d;
      const m = document.createElement("span");
      m.className = "m";
      const b = document.createElement("b");
      b.textContent = it.m;
      const tg = document.createElement("span");
      tg.className = "tag mono" + (it.c === "Subscriptions" ? " hot" : "");
      tg.textContent = it.c;
      m.append(b, tg);
      const a = document.createElement("span");
      a.className = "mono a";
      a.textContent = inr(it.a);
      li.append(d, m, a);
      rowsEl.appendChild(li);
    };

    const heroLoop = async () => {
      while (alive) {
        rowsEl.innerHTML = "";
        totEl.textContent = inr(0);
        smsEl.textContent = "";
        let total = 0;
        for (const it of ITEMS) {
          smsEl.textContent = "";
          for (let k = 1; k <= it.t.length; k++) {
            if (!alive) return;
            smsEl.textContent = it.t.slice(0, k);
            await sleep(20);
          }
          await sleep(380);
          if (!alive) return;
          addRow(it, true);
          total += it.a;
          totEl.textContent = inr(total);
          smsEl.textContent = "";
          await sleep(280);
        }
        await sleep(4200);
        if (!alive) return;
        Array.from(rowsEl.children).forEach((r) => {
          r.classList.remove("snap");
          r.classList.add("fadeout");
        });
        await sleep(500);
      }
    };

    if (reduce) {
      let tot = 0;
      ITEMS.forEach((it) => {
        addRow(it, false);
        tot += it.a;
      });
      totEl.textContent = inr(tot);
      smsEl.textContent = ITEMS[ITEMS.length - 1].t;
    } else {
      void heroLoop();
    }

    /* cancel demo */
    const saveEl = q<HTMLElement>("#saveNow")!;
    const yrEl = q<HTMLElement>("#saveYr")!;
    let shown = 0;
    let raf = 0;
    const paint = (n: number) => {
      saveEl.textContent = inr(n);
      yrEl.textContent = inr(n * 12);
    };
    const countTo = (target: number) => {
      cancelAnimationFrame(raf);
      if (reduce) {
        shown = target;
        paint(target);
        return;
      }
      const from = shown;
      const t0 = performance.now();
      const dur = 550;
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / dur);
        const e = 1 - Math.pow(1 - p, 3);
        shown = Math.round(from + (target - from) * e);
        paint(shown);
        if (p < 1) raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    };
    const sum = () => {
      let s = 0;
      root.querySelectorAll(".sub.cancelled").forEach((li) => {
        s += Number(li.getAttribute("data-amt"));
      });
      return s;
    };
    root.querySelectorAll<HTMLElement>(".sub").forEach((li) => {
      const hit = li.querySelector<HTMLButtonElement>(".sub-hit")!;
      hit.addEventListener("click", () => {
        const on = li.classList.toggle("cancelled");
        hit.setAttribute("aria-pressed", on ? "true" : "false");
        countTo(sum());
      });
      const how = li.querySelector<HTMLButtonElement>(".how")!;
      const txt = li.querySelector<HTMLElement>(".how-text")!;
      how.addEventListener("click", () => {
        const open = txt.hasAttribute("hidden");
        if (open) txt.removeAttribute("hidden");
        else txt.setAttribute("hidden", "");
        how.setAttribute("aria-expanded", open ? "true" : "false");
      });
    });

    /* red pen circle */
    const pen = q<SVGElement>(".pen");
    let io: IntersectionObserver | undefined;
    if (pen) {
      if (reduce || !("IntersectionObserver" in window)) {
        pen.classList.add("in");
      } else {
        io = new IntersectionObserver(
          (es) => {
            es.forEach((e) => {
              if (e.isIntersecting) {
                pen.classList.add("in");
                io?.disconnect();
              }
            });
          },
          { threshold: 0.6 }
        );
        const target = q<HTMLElement>("#circle");
        if (target) io.observe(target);
      }
    }

    return () => {
      alive = false;
      timers.forEach((id) => clearTimeout(id));
      cancelAnimationFrame(raf);
      io?.disconnect();
    };
  }, []);

  return (
    <div className="page" ref={ref} dangerouslySetInnerHTML={{ __html: LANDING_HTML }} />
  );
}
