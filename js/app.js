/* ===========================================================
   ATZ Invoice Generator — application logic
   =========================================================== */
(function () {
  "use strict";

  const C = window.COMPANY;
  const $ = (sel) => document.querySelector(sel);
  const STORAGE_KEY = "atz_invoice_state_v1";

  let state = { template: "accent", items: [], signature: null, sigEnabled: true };

  /* ---------- Helpers ---------- */
  const fmtMoney = (n, cur) =>
    cur + (isFinite(n) ? n : 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  function fmtDate(iso) {
    if (!iso) return "—";
    const d = new Date(iso + "T00:00:00");
    return isNaN(d) ? "—" : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const nl2br = (s) => esc(s).replace(/\n/g, "<br>");
  const num = (id) => parseFloat($("#" + id).value) || 0;
  const val = (id) => $("#" + id).value;

  /* ---------- Line items ---------- */
  function addItem(item) {
    state.items.push(item || { desc: "", detail: "", qty: 1, price: 0 });
    renderItems(); update();
  }
  function removeItem(i) {
    state.items.splice(i, 1);
    if (state.items.length === 0) addItem();
    else { renderItems(); update(); }
  }
  function renderItems() {
    const wrap = $("#itemsList");
    wrap.innerHTML = "";
    state.items.forEach((it, i) => {
      const row = document.createElement("div");
      row.className = "item-grid";
      row.innerHTML = `
        <input class="full" type="text" placeholder="Item / service name" data-k="desc" value="${esc(it.desc)}" />
        <input class="full" type="text" placeholder="Description (optional)" data-k="detail" value="${esc(it.detail)}" />
        <input type="number" min="0" step="any" placeholder="Qty" data-k="qty" value="${it.qty}" />
        <input type="number" min="0" step="any" placeholder="Rate" data-k="price" value="${it.price}" />
        <div class="item-head">Amount</div>
        <button class="item-del" title="Remove" data-del="${i}">×</button>`;
      row.querySelectorAll("input").forEach((inp) => {
        inp.addEventListener("input", () => {
          const k = inp.dataset.k;
          state.items[i][k] = (k === "qty" || k === "price") ? (parseFloat(inp.value) || 0) : inp.value;
          update();
        });
      });
      row.querySelector("[data-del]").addEventListener("click", () => removeItem(i));
      wrap.appendChild(row);
    });
  }

  /* ---------- Totals ---------- */
  function computeTotals() {
    const subtotal = state.items.reduce((s, it) => s + it.qty * it.price, 0);
    const discInput = num("discount");
    const discount = val("discountType") === "percent" ? subtotal * (discInput / 100) : discInput;
    const taxable = Math.max(subtotal - discount, 0);
    const taxRate = num("taxRate");
    const tax = taxable * (taxRate / 100);
    const shipping = num("shipping");
    return { subtotal, discount, tax, taxRate, shipping, total: taxable + tax + shipping };
  }

  /* ---------- Build a render model ---------- */
  function buildModel() {
    const cur = val("currency");
    const t = computeTotals();
    const items = state.items.map((it) => ({
      name: it.desc, detail: it.detail, qty: it.qty, price: it.price, amount: it.qty * it.price
    }));
    const clientLines = [
      val("clientContact") ? "Attn: " + esc(val("clientContact")) : "",
      nl2br(val("clientAddress")),
      val("clientEmail") ? esc(val("clientEmail")) : "",
      val("clientPhone") ? esc(val("clientPhone")) : ""
    ].filter(Boolean).join("<br>");
    return {
      cur, t, items,
      inv: { number: val("invNumber"), po: val("poNumber"), issue: fmtDate(val("issueDate")), due: fmtDate(val("dueDate")) },
      client: { name: val("clientName") || "Client Name", lines: clientLines || "—" }
    };
  }

  /* ---------- Shared HTML fragments ---------- */
  const logoImg = (cls) => C.logo
    ? `<img src="${C.logo}" alt="${esc(C.name)}" class="inv-logo ${cls || ""}" onerror="this.style.display='none'" />` : "";

  // Flat label/value cells — .inv-meta is a 2-column grid, so labels and values
  // line up in fixed columns and a long PO wraps inside its own column.
  function metaRows(m) {
    const cell = (k, v) => `<span class="k">${esc(k)}</span><span class="v">${esc(v)}</span>`;
    let r = cell("Invoice #", m.inv.number);
    if (m.inv.po) r += cell("PO / Ref", m.inv.po);
    r += cell("Issue Date", m.inv.issue);
    r += cell("Due Date", m.inv.due);
    return r;
  }
  function itemRows(m) {
    if (!m.items.length) return `<tr><td colspan="4" class="inv-empty">No items yet.</td></tr>`;
    return m.items.map((it) => `<tr>
      <td><div class="inv-item-name">${esc(it.name || "—")}</div>${it.detail ? `<div class="inv-item-desc">${esc(it.detail)}</div>` : ""}</td>
      <td class="num">${(+it.qty).toLocaleString()}</td>
      <td class="num">${fmtMoney(it.price, m.cur)}</td>
      <td class="num">${fmtMoney(it.amount, m.cur)}</td></tr>`).join("");
  }
  function totalRows(m) {
    let h = `<div class="row"><span>Subtotal</span><span>${fmtMoney(m.t.subtotal, m.cur)}</span></div>`;
    if (m.t.discount > 0) h += `<div class="row"><span>Discount</span><span>− ${fmtMoney(m.t.discount, m.cur)}</span></div>`;
    if (m.t.tax > 0) h += `<div class="row"><span>Tax (${m.t.taxRate}%)</span><span>${fmtMoney(m.t.tax, m.cur)}</span></div>`;
    if (m.t.shipping > 0) h += `<div class="row"><span>Shipping / Other</span><span>${fmtMoney(m.t.shipping, m.cur)}</span></div>`;
    return h;
  }
  const grand = (m) => `<div class="grand"><span>Total Due</span><span>${fmtMoney(m.t.total, m.cur)}</span></div>`;
  const tableHtml = (m) => `<table class="inv-table"><thead><tr>
      <th>Description</th><th class="num">Qty</th><th class="num">Rate</th><th class="num">Amount</th>
    </tr></thead><tbody>${itemRows(m)}</tbody></table>`;
  // Fixed thank-you line (Notes / Terms & Conditions blocks removed).
  const THANK_YOU = C.thankYou || "Thank you for your business!";
  const thanksHtml = () => `<div class="inv-thanks">${esc(THANK_YOU)}</div>`;

  const summaryHtml = (m) => `<div class="inv-summary">
      <div class="inv-notes">${thanksHtml()}</div>
      <div class="inv-totals">${totalRows(m)}${grand(m)}</div>
    </div>`;
  const footerHtml = () => `<div class="inv-footer">
      <div><strong>${esc(C.name)}</strong> &nbsp;•&nbsp; ${esc(C.address)}, ${esc(C.cityStateZip)}</div>
      <div>${esc(C.phone)} &nbsp;•&nbsp; ${esc(C.email)} &nbsp;•&nbsp; ${esc(C.website)}</div>
    </div>`;

  // Footer icons as data-URI <img> (html2canvas renders these reliably, unlike inline <svg>).
  const ficon = (inner) => `<img class="ac-fimg" alt="" src="data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2ba0d8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`
  )}" />`;
  const ICONS = {
    phone: ficon(`<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>`),
    mail: ficon(`<rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-10 6L2 7"/>`),
    pin: ficon(`<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>`)
  };

  // Bottom-left corner art as a data-URI <img>. CSS clip-path triangles are NOT
  // rendered by html2canvas (they come out as full rectangles in the PDF), so the
  // two overlapping triangles are drawn as SVG polygons instead.
  const AC_CORNER_BL = `<img class="ac-deco ac-deco--bl" alt="" src="data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="250" height="96" viewBox="0 0 250 96">` +
      `<polygon points="0,26.88 144,96 0,96" fill="#11314f"/>` +
      `<polygon points="0,61.8 125,96 0,96" fill="#2ba0d8"/>` +
    `</svg>`
  )}" />`;

  // Signature block — image (optional) above the line, with a typed name/title underneath.
  function signatureBlock() {
    if (!state.sigEnabled) return "";
    const name = (val("signName") || "").trim();
    const title = (val("signTitle") || "").trim();
    return `<div class="inv-sign">
      ${state.signature ? `<img class="sig-img" src="${state.signature}" alt="Signature" />` : ""}
      <div class="sig-line"></div>
      <div class="sig-name">${esc(name || C.name)}</div>
      <div class="sig-sub">${esc(title || "Authorized Signature")}</div>
    </div>`;
  }
  // Right-aligned signature row used by the non-Azure templates (omitted entirely when off).
  const signRow = () => state.sigEnabled ? `<div class="inv-signrow">${signatureBlock()}</div>` : "";

  /* ---------- Per-template renderers ---------- */
  const RENDERERS = {
    // 1) Classic split header
    blue(m) {
      return `<div class="inv-pad">
        <div class="inv-header">
          <div class="inv-brand">${logoImg()}<div>
            <h2 class="inv-company">${esc(C.name)}</h2>
            <p class="inv-tagline">${esc(C.tagline)}</p>
          </div></div>
          <div class="inv-title-block"><h1 class="inv-title">Invoice</h1><div class="inv-meta">${metaRows(m)}</div></div>
        </div>
        <div class="inv-parties">
          <div class="inv-party"><h3>Bill To</h3><div class="name">${esc(m.client.name)}</div><div class="lines">${m.client.lines}</div></div>
          <div class="inv-party inv-party--right"><h3>Amount Due</h3><div class="name big">${fmtMoney(m.t.total, m.cur)}</div><div class="lines">Due ${m.inv.due}</div></div>
        </div>
        ${tableHtml(m)}
        ${summaryHtml(m)}
        ${signRow()}
      </div>${footerHtml()}`;
    },

    // 2) Centered letterhead (serif)
    maroon(m) {
      return `<div class="inv-pad">
        <div class="ml-head">
          ${logoImg("ml-logo")}
          <h2 class="inv-company">${esc(C.name)}</h2>
          <p class="inv-tagline">${esc(C.tagline)}</p>
        </div>
        <div class="ml-title">Invoice</div>
        <div class="ml-info">
          <div class="inv-party"><h3>Bill To</h3><div class="name">${esc(m.client.name)}</div><div class="lines">${m.client.lines}</div></div>
          <div class="inv-meta ml-meta">${metaRows(m)}</div>
        </div>
        ${tableHtml(m)}
        ${summaryHtml(m)}
        ${signRow()}
      </div>${footerHtml()}`;
    },

    // 3) Left navy sidebar
    corporate(m) {
      return `<aside class="inv-aside">
          ${logoImg("aside-logo")}
          <div class="aside-company">${esc(C.name)}</div>
          <div class="aside-tag">${esc(C.tagline)}</div>
          <div class="aside-block"><h4>Bill To</h4><strong>${esc(m.client.name)}</strong><br>${m.client.lines}</div>
          <div class="aside-due"><span>Amount Due</span><strong>${fmtMoney(m.t.total, m.cur)}</strong><small>Due ${m.inv.due}</small></div>
        </aside>
        <div class="inv-main">
          <div class="cm-head"><h1 class="inv-title">Invoice</h1><div class="inv-meta">${metaRows(m)}</div></div>
          ${tableHtml(m)}
          ${summaryHtml(m)}
          ${signRow()}
          <div class="cm-foot">${esc(C.name)} &nbsp;•&nbsp; ${esc(C.phone)} &nbsp;•&nbsp; ${esc(C.email)} &nbsp;•&nbsp; ${esc(C.website)}</div>
        </div>`;
    },

    // 4) Airy minimal
    minimal(m) {
      const po = m.inv.po ? `<div><label>PO / Ref</label><b>${esc(m.inv.po)}</b></div>` : "";
      return `<div class="inv-pad mn">
        <div class="mn-head">
          <div class="mn-brand">${logoImg("mn-logo")}<div>
            <div class="mn-company">${esc(C.name)}</div>
          </div></div>
          <h1 class="mn-title">Invoice</h1>
        </div>
        <div class="mn-meta">
          <div><label>Invoice</label><b>${esc(m.inv.number)}</b></div>
          ${po}
          <div><label>Issued</label><b>${m.inv.issue}</b></div>
          <div><label>Due</label><b>${m.inv.due}</b></div>
          <div><label>Bill To</label><b>${esc(m.client.name)}</b></div>
        </div>
        ${tableHtml(m)}
        ${summaryHtml(m)}
        ${signRow()}
      </div>${footerHtml()}`;
    },

    // 5) Azure Pro — modern, decorative corners, icon footer
    accent(m) {
      const rows = [
        ["Invoice", m.inv.number],
        m.inv.po ? ["PO / Ref", m.inv.po] : null,
        ["Date", m.inv.issue],
        ["Due Date", m.inv.due]
      ].filter(Boolean).map(([k, v]) => `<span class="k">${esc(k)}</span><b class="v">${esc(v)}</b>`).join("");

      const sumRows =
        `<div class="row"><span>Subtotal</span><span>${fmtMoney(m.t.subtotal, m.cur)}</span></div>` +
        (m.t.discount > 0 ? `<div class="row"><span>Discount</span><span>− ${fmtMoney(m.t.discount, m.cur)}</span></div>` : "") +
        (m.t.tax > 0 ? `<div class="row"><span>Tax VAT ${m.t.taxRate}%</span><span>${fmtMoney(m.t.tax, m.cur)}</span></div>` : "") +
        (m.t.shipping > 0 ? `<div class="row"><span>Shipping / Other</span><span>${fmtMoney(m.t.shipping, m.cur)}</span></div>` : "");

      return `
        <div class="ac-deco ac-deco--tr"></div>
        <div class="ac-deco ac-deco--tr2"></div>
        ${AC_CORNER_BL}
        <div class="inv-pad ac">
          <div class="ac-brand">
            ${logoImg("ac-logo")}
            <div class="ac-name">${esc(C.name)}</div>
          </div>
          <div class="ac-info">
            <div class="ac-billto">
              <div class="ac-label">Billing To:</div>
              <div class="ac-client-name">${esc(m.client.name)}</div>
              <div class="ac-client-lines">${m.client.lines}</div>
            </div>
            <div class="ac-invblock">
              <h1 class="ac-title">Invoice</h1>
              <div class="ac-meta">${rows}</div>
            </div>
          </div>
          ${tableHtml(m)}
          <div class="ac-sum">
            <div class="ac-sum-rows">${sumRows}</div>
            <div class="ac-total"><span>Total</span><span>${fmtMoney(m.t.total, m.cur)}</span></div>
          </div>
          <div class="ac-bottom">
            <div class="ac-pay">${thanksHtml()}</div>
            ${signatureBlock()}
          </div>
          <div class="ac-footer">
            <div class="ac-fitem"><span class="ac-ficon">${ICONS.phone}</span><span>${esc(C.phone)}${C.phoneAlt ? "<br>" + esc(C.phoneAlt) : ""}</span></div>
            <div class="ac-fitem"><span class="ac-ficon">${ICONS.mail}</span><span>${esc(C.email)}<br>${esc(C.website)}</span></div>
            <div class="ac-fitem"><span class="ac-ficon">${ICONS.pin}</span><span>${esc(C.address)}<br>${esc(C.cityStateZip)}</span></div>
          </div>
        </div>`;
    }
  };

  /* ---------- Render ---------- */
  function update() {
    const m = buildModel();
    const render = RENDERERS[state.template] || RENDERERS.blue;
    const inv = $("#invoice");
    inv.className = "invoice tpl-" + state.template;
    inv.innerHTML = render(m);
    save();
  }

  function setTemplate(name) {
    state.template = name;
    document.querySelectorAll(".tpl-chip").forEach((c) => c.classList.toggle("is-active", c.dataset.template === name));
    update();
  }

  /* ---------- Persistence ---------- */
  const FIELDS = ["invNumber","currency","issueDate","dueDate","poNumber","clientName","clientContact",
    "clientAddress","clientEmail","clientPhone","taxRate","discount","discountType","shipping",
    "signName","signTitle"];
  function save() {
    try {
      const data = { template: state.template, items: state.items, signature: state.signature, sigEnabled: state.sigEnabled, fields: {} };
      FIELDS.forEach((id) => data.fields[id] = val(id));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (e) {}
  }
  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
      if (!data) return false;
      if (data.fields) Object.keys(data.fields).forEach((id) => { const el = $("#" + id); if (el) el.value = data.fields[id]; });
      state.template = data.template || "accent";
      if (!RENDERERS[state.template]) state.template = "accent"; // legacy "elegant" -> accent
      state.signature = data.signature || null;
      state.sigEnabled = data.sigEnabled !== false;
      state.items = (data.items && data.items.length) ? data.items : null;
      return true;
    } catch (e) { return false; }
  }

  /* ---------- PDF (robust: inlines images so it works on file:// and HTTPS) ---------- */
  async function inlineImages(node) {
    const imgs = Array.from(node.querySelectorAll("img"));
    await Promise.all(imgs.map(async (img) => {
      if (img.src.startsWith("data:")) return;
      try {
        const res = await fetch(img.src, { cache: "force-cache" });
        const blob = await res.blob();
        img.src = await new Promise((rs, rj) => {
          const fr = new FileReader();
          fr.onload = () => rs(fr.result);
          fr.onerror = rj;
          fr.readAsDataURL(blob);
        });
      } catch (e) {
        // file:// blocks fetch — fall back to the embedded placeholder, else drop the image
        if (window.COMPANY_LOGO_FALLBACK) img.src = window.COMPANY_LOGO_FALLBACK;
        else img.remove();
      }
    }));
  }

  async function downloadPdf() {
    const btn = $("#btnPdf");
    if (typeof window.html2pdf === "undefined") {
      alert("The PDF library didn't load (check your internet connection).\nYou can still use the Print button and choose \u201cSave as PDF\u201d.");
      return;
    }
    const src = $("#invoice");
    const clone = src.cloneNode(true);
    clone.style.margin = "0";
    clone.style.boxShadow = "none";
    // Render at a real on-page origin (0,0) but tucked behind the app, so
    // html2canvas computes the capture box correctly (a negative offset shifts it).
    const holder = document.createElement("div");
    holder.style.cssText = "position:fixed;left:0;top:0;width:816px;z-index:-1;background:#fff;";
    holder.appendChild(clone);
    document.body.appendChild(holder);

    const old = btn.textContent;
    btn.disabled = true; btn.textContent = "Generating\u2026";
    try {
      await inlineImages(clone);
      const name = (val("invNumber") || "invoice").replace(/[^\w\-]+/g, "_");
      await window.html2pdf().set({
        margin: 0,
        filename: `${name}_ATZ.pdf`,
        image: { type: "jpeg", quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: "#ffffff", width: 816, windowWidth: 816, x: 0, y: 0, scrollX: 0, scrollY: 0 },
        jsPDF: { unit: "in", format: "letter", orientation: "portrait" },
        pagebreak: { mode: ["css", "legacy"] }
      }).from(clone).save();
    } catch (err) {
      console.error(err);
      alert("Couldn't auto-generate the PDF (" + ((err && err.message) || err) + ").\nUse the Print button and choose \u201cSave as PDF\u201d.");
    } finally {
      document.body.removeChild(holder);
      btn.disabled = false; btn.textContent = old;
    }
  }

  /* ---------- Defaults / init ---------- */
  function todayISO(offset) {
    const d = new Date();
    d.setDate(d.getDate() + (offset || 0));
    return d.toISOString().slice(0, 10);
  }
  function init() {
    load();
    if (!val("issueDate")) $("#issueDate").value = todayISO(0);
    if (!val("dueDate")) $("#dueDate").value = todayISO(30);
    if (!state.items) {
      state.items = [
        { desc: "", detail: "", qty: 1, price: 0 },
        { desc: "", detail: "", qty: 1, price: 0 }
      ];
    }
    renderItems();
    setTemplate(state.template);

    document.querySelectorAll(".panel input, .panel select, .panel textarea").forEach((el) => el.addEventListener("input", update));
    $("#templatePicker").addEventListener("click", (e) => {
      const chip = e.target.closest(".tpl-chip");
      if (chip) setTemplate(chip.dataset.template);
    });
    // Signature controls
    const sigInput = $("#sigInput");
    const sigToggle = $("#sigEnabled");
    function syncSigUI() {
      const prev = $("#sigPreview"), rm = $("#sigRemove");
      if (state.signature) { prev.src = state.signature; prev.style.display = "block"; rm.style.display = "inline-block"; }
      else { prev.removeAttribute("src"); prev.style.display = "none"; rm.style.display = "none"; }
      sigToggle.checked = state.sigEnabled;
      $("#sigControls").style.display = state.sigEnabled ? "" : "none";
    }
    sigToggle.addEventListener("change", () => { state.sigEnabled = sigToggle.checked; syncSigUI(); update(); });
    sigInput.addEventListener("change", () => {
      const file = sigInput.files && sigInput.files[0];
      if (!file) return;
      const fr = new FileReader();
      fr.onload = () => { state.signature = fr.result; syncSigUI(); update(); };
      fr.readAsDataURL(file);
    });
    $("#sigRemove").addEventListener("click", () => {
      state.signature = null; sigInput.value = ""; syncSigUI(); update();
    });
    syncSigUI();

    $("#btnAddItem").addEventListener("click", () => addItem());
    $("#btnPdf").addEventListener("click", downloadPdf);
    $("#btnPrint").addEventListener("click", () => window.print());
    $("#btnReset").addEventListener("click", () => {
      if (confirm("Clear all invoice data and start over?")) { localStorage.removeItem(STORAGE_KEY); location.reload(); }
    });
    update();
  }
  document.addEventListener("DOMContentLoaded", init);
})();
