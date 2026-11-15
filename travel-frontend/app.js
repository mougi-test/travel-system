const API_URL = window.APP_CONFIG?.API_URL;
const TOKEN_KEY = "travel_token";

const $ = (id) => document.getElementById(id);
const money = new Intl.NumberFormat("mn-MN", { maximumFractionDigits: 0 });
const number = new Intl.NumberFormat("mn-MN");
const oneDecimal = new Intl.NumberFormat("mn-MN", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/* =====================================================================
   1. ТУСЛАХ ФУНКЦҮҮД
   ===================================================================== */

// Элемент үүсгэх. Текстийг үргэлж текстээр нэмнэ — HTML болж ажиллахгүй (XSS-ээс хамгаална).
// on* түлхүүр нь event болно: el("button", { onclick: fn }, "Дар")
function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") node.className = v;
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of children) node.append(c ?? "");
  return node;
}

let toastTimer;
function toast(message, kind = "ok") {
  const t = $("toast");
  t.textContent = message;
  t.className = `toast ${kind}`;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), 3500);
}

/* =====================================================================
   2. ТОКЕН БА API
   ===================================================================== */

const tokenStore = {
  get: () => sessionStorage.getItem(TOKEN_KEY),
  set: (t) => sessionStorage.setItem(TOKEN_KEY, t),
  clear: () => sessionStorage.removeItem(TOKEN_KEY),
};

function readToken(token) {
  try {
    const part = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(atob(part));
  } catch {
    return null;
  }
}

const isTokenValid = (t) => Boolean(t && readToken(t)?.exp * 1000 > Date.now());

class ApiError extends Error {
  constructor(status, detail) {
    super(typeof detail === "string" ? detail : `Алдаа гарлаа (${status})`);
    this.status = status;
    this.detail = detail; // 422 үед: [{ loc: ["body", "price"], msg }]
  }
}

// Токентой API дуудлага: api("/tours"), api("/tours", { method: "POST", body: {...} })
async function api(path, { method = "GET", body } = {}) {
  const headers = { Authorization: `Bearer ${tokenStore.get()}` };
  if (body !== undefined) headers["Content-Type"] = "application/json";

  let res;
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Сервертэй холбогдож чадсангүй.");
  }

  if (res.status === 401) {
    // Токен дууссан, хуурамч эсвэл байхгүй → нэвтрэх хуудас руу буцна
    logout("Нэвтрэх хугацаа дууссан байна. Дахин нэвтэрнэ үү.");
    throw new ApiError(401, "Нэвтрэх хугацаа дууссан. Дахин нэвтэрнэ үү.");
  }
  if (res.status === 204) return null;

  const data = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, data?.detail ?? `Алдаа гарлаа (${res.status})`);
  return data;
}

/* =====================================================================
   3. ЕРӨНХИЙ CRUD ХУУДАС
   ---------------------------------------------------------------------
   Аль ч цэсэнд (Аялал, Хөтөч, Үйлчлүүлэгч …) тохиргоо өгөөд л ашиглана:

   createCrudPage({
     title: "Аялал",            // Хуудасны гарчиг
     itemName: "аялал",         // Мессежэнд: «аялал нэмэгдлээ»
     endpoint: "/tours",        // GET/POST /tours, PUT/DELETE /tours/:id
     idKey: "tour_id",          // Мөр бүрийн дугаар
     labelKey: "name",          // Устгахаас өмнө асуухад харуулах нэр (эсвэл labelOf: (row) => "…")
     searchKeys: ["name", …],   // Хайлт эдгээр талбараар
     columns: [{ key, label, align: "num", wrap: true, format: (v, row) => … }],
     fields:  [{ key, label, type: "text"|"number"|"date"|"select",
                 required, min, max, maxlength, step,
                 options: async () => [{ value, label }], emptyLabel }],

     // --- Заавал биш нэмэлтүүд ---
     listUrl: (filterValue) => "/bookings?limit=50&status=…",  // жагсаалт татах хаяг
     countText: (n) => `Сүүлийн ${n} захиалга`,
     filter: { key: "status", label: "Төлөв", options: [{ value, label }] },
     rowActions: [{ label, class, show: (row) => bool,           // мөр бүрийн нэмэлт товч
                    run: (row) => api(...), done: "Батлагдлаа" }],
     deleteFallback: { label, show, run, done },                  // устгах боломжгүй (409) үед санал болгох үйлдэл
   })
   ===================================================================== */

function createCrudPage(cfg) {
  return async function render(root) {
    let items = [];
    let query = "";
    let optionsCache = null; // select-ийн сонголтуудыг нэг л удаа татна
    let filterValue = cfg.filter?.default ?? "";
    const listUrl = () => (cfg.listUrl ? cfg.listUrl(filterValue) : cfg.endpoint);
    // Шүүлтүүр идэвхтэй үед мөр шүүлтүүрт таарч байна уу (жишээ нь «Хүлээгдэж буй»-г батлахад жагсаалтаас гарна)
    const fitsFilter = (row) => !cfg.filter || !filterValue || String(row[cfg.filter.key]) === filterValue;

    // ---- Хуудасны араг ----
    const countEl = el("span", { class: "muted" });
    const search = el("input", {
      type: "search",
      class: "search",
      placeholder: "Хайх…",
      "aria-label": `${cfg.title} хайх`,
      oninput: (e) => { query = e.target.value.trim().toLowerCase(); drawRows(); },
    });
    const filterSelect = cfg.filter
      ? el("select", {
          class: "filter", "aria-label": cfg.filter.label,
          onchange: (e) => { filterValue = e.target.value; load(); },
        },
          el("option", { value: "" }, `Бүх ${cfg.filter.label.toLowerCase()}`),
          ...cfg.filter.options.map((o) => el("option", { value: o.value, selected: o.value === filterValue }, o.label)),
        )
      : null;
    const tbody = el("tbody");
    const tableWrap = el("div", { class: "table-wrap" },
      el("table", {},
        el("thead", {}, el("tr", {},
          ...cfg.columns.map((c) => el("th", { class: c.align }, c.label)),
          el("th", { class: "actions-col" }, el("span", { class: "sr-only" }, "Үйлдэл")),
        )),
        tbody,
      ),
    );
    const message = el("p", { class: "muted" }, "Ачаалж байна…");

    root.replaceChildren(
      el("div", { class: "page-head" },
        el("div", {}, el("h1", {}, cfg.title), countEl),
        el("button", { type: "button", onclick: () => openForm(null) }, `+ Нэмэх`),
      ),
      el("section", { class: "card panel" },
        el("div", { class: "toolbar" }, search, filterSelect),
        message,
        tableWrap,
      ),
    );
    tableWrap.hidden = true;

    // ---- Хүснэгт зурах ----
    const matches = (row) =>
      !query || cfg.searchKeys.some((k) => String(row[k] ?? "").toLowerCase().includes(query));

    function drawRows() {
      const visible = items.filter(matches);
      countEl.textContent = query
        ? `${number.format(visible.length)} / ${number.format(items.length)} ${cfg.itemName}`
        : cfg.countText ? cfg.countText(number.format(items.length))
        : `Нийт ${number.format(items.length)} ${cfg.itemName}`;

      if (!visible.length) {
        tableWrap.hidden = true;
        message.hidden = false;
        message.textContent = query ? `«${query}» гэсэн ${cfg.itemName} олдсонгүй.`
          : filterValue ? `Энэ төлөвтэй ${cfg.itemName} алга.` : `${cfg.title} хоосон байна.`;
        return;
      }
      message.hidden = true;
      tableWrap.hidden = false;
      tbody.replaceChildren(...visible.map((row) =>
        el("tr", {},
          ...cfg.columns.map((c) => {
            const v = c.format ? c.format(row[c.key], row) : row[c.key];
            return el("td", { class: [c.align, c.wrap && "wrap"].filter(Boolean).join(" ") || undefined }, v ?? "—");
          }),
          el("td", { class: "actions-cell" },
            el("div", { class: "row-actions" },
              ...(cfg.rowActions ?? []).filter((a) => !a.show || a.show(row)).map((a) =>
                el("button", { type: "button", class: `ghost ${a.class ?? ""}`, onclick: (e) => runAction(a, row, e.currentTarget) }, a.label)),
              el("button", { type: "button", class: "ghost", onclick: () => openForm(row) }, "Засах"),
              el("button", { type: "button", class: "ghost danger-text", onclick: () => confirmDelete(row) }, "Устгах"),
            ),
          ),
        )
      ));
    }

    // ---- Мөрийг шинэчлэх / нэмэх (шүүлтүүрт таарахгүй бол жагсаалтаас хасна) ----
    function applyUpdate(saved) {
      items = fitsFilter(saved)
        ? items.map((it) => (it[cfg.idKey] === saved[cfg.idKey] ? saved : it))
        : items.filter((it) => it[cfg.idKey] !== saved[cfg.idKey]);
      drawRows();
    }

    async function runAction(action, row, button) {
      if (button) button.disabled = true;
      try {
        applyUpdate(await action.run(row));
        toast(action.done ?? "Хадгалагдлаа.");
      } catch (err) {
        toast(errorText(err), "bad");
        if (button) button.disabled = false;
      }
    }

    // ---- Нэмэх / Засах ----
    async function loadOptions() {
      if (!optionsCache) {
        optionsCache = Object.fromEntries(await Promise.all(
          cfg.fields.filter((f) => f.options).map(async (f) => [f.key, await f.options()])
        ));
      }
      return optionsCache;
    }

    function buildInput(f, value, options) {
      const id = `f-${f.key}`;
      let input;
      if (f.type === "select") {
        input = el("select", { id, name: f.key, required: f.required },
          el("option", { value: "" }, f.emptyLabel ?? "— Сонгох —"),
          ...(options[f.key] ?? []).map((o) =>
            el("option", { value: o.value, selected: String(o.value) === String(value ?? f.default ?? "") }, o.label)),
        );
      } else {
        input = el("input", {
          id, name: f.key, type: f.type ?? "text",
          required: f.required, min: f.min, max: f.max, step: f.step, maxlength: f.maxlength,
        });
        input.value = value ?? "";
      }
      return el("div", { class: `field${f.wide ? " wide" : ""}` },
        el("label", { for: id }, f.label, f.required ? el("span", { class: "req", "aria-hidden": "true" }, " *") : null),
        input,
      );
    }

    // Маягтын утгуудыг API-д илгээх хэлбэрт оруулна ("" → null, тоо → Number)
    function readForm(form) {
      const out = {};
      for (const f of cfg.fields) {
        const raw = form.elements[f.key].value.trim();
        if (raw === "") out[f.key] = null;
        else if (f.type === "number" || f.numeric) out[f.key] = Number(raw);
        else out[f.key] = raw;
      }
      return out;
    }

    function errorText(err) {
      if (err.status === 422 && Array.isArray(err.detail)) {
        const key = err.detail[0]?.loc?.at(-1);
        const label = cfg.fields.find((f) => f.key === key)?.label;
        return label ? `«${label}» талбарын утга буруу байна.` : "Оруулсан мэдээлэл буруу байна.";
      }
      return err.message;
    }

    async function openForm(row) {
      const dialog = $("form-dialog");
      const form = $("crud-form");
      const submit = $("form-submit");
      const errorEl = $("form-error");
      const isEdit = Boolean(row);

      $("form-title").textContent = isEdit ? `${cfg.title} засах` : `Шинэ ${cfg.itemName} нэмэх`;
      errorEl.hidden = true;
      $("form-fields").replaceChildren(el("p", { class: "muted" }, "Ачаалж байна…"));
      submit.disabled = true;
      dialog.showModal();

      try {
        const options = await loadOptions();
        $("form-fields").replaceChildren(...cfg.fields.map((f) => buildInput(f, row?.[f.key], options)));
        submit.disabled = false;
        form.elements[cfg.fields[0].key].focus();
      } catch (err) {
        errorEl.textContent = errorText(err);
        errorEl.hidden = false;
        $("form-fields").replaceChildren();
        return;
      }

      form.onsubmit = async (e) => {
        e.preventDefault();
        submit.disabled = true;
        submit.textContent = "Хадгалж байна…";
        errorEl.hidden = true;
        try {
          const body = readForm(form);
          if (isEdit) {
            const saved = await api(`${cfg.endpoint}/${row[cfg.idKey]}`, { method: "PUT", body });
            applyUpdate(saved);
            toast(`${capitalize(cfg.itemName)} засагдлаа.`);
          } else {
            const saved = await api(cfg.endpoint, { method: "POST", body });
            if (fitsFilter(saved)) items.unshift(saved); // шинэ нь хамгийн дээр
            toast(`${capitalize(cfg.itemName)} нэмэгдлээ.`);
          }
          dialog.close();
          drawRows();
        } catch (err) {
          errorEl.textContent = errorText(err);
          errorEl.hidden = false;
        } finally {
          submit.disabled = false;
          submit.textContent = "Хадгалах";
        }
      };
    }

    // ---- Устгах (заавал асууна) ----
    function confirmDelete(row) {
      const dialog = $("confirm-dialog");
      const ok = $("confirm-ok");
      const errorEl = $("confirm-error");

      $("confirm-title").textContent = `${capitalize(cfg.itemName)} устгах уу?`;
      $("confirm-text").textContent =
        `«${cfg.labelOf ? cfg.labelOf(row) : row[cfg.labelKey]}»-г устгах гэж байна. Устгасны дараа буцаах боломжгүй.`;
      errorEl.hidden = true;
      ok.hidden = false;
      ok.disabled = false;
      ok.textContent = "Устгах";
      $("confirm-cancel").textContent = "Болих";
      dialog.showModal();
      $("confirm-cancel").focus(); // санамсаргүй Enter дарахад устгахгүй

      ok.onclick = async () => {
        ok.disabled = true;
        ok.textContent = "Устгаж байна…";
        try {
          await api(`${cfg.endpoint}/${row[cfg.idKey]}`, { method: "DELETE" });
          items = items.filter((it) => it[cfg.idKey] !== row[cfg.idKey]);
          dialog.close();
          drawRows();
          toast(`${capitalize(cfg.itemName)} устгагдлаа.`);
        } catch (err) {
          // Жишээ нь 409: захиалгатай аялал — серверийн тайлбарыг харуулна
          errorEl.textContent = errorText(err);
          errorEl.hidden = false;
          const fb = cfg.deleteFallback;
          if (err.status === 409 && fb && (!fb.show || fb.show(row))) {
            // Устгах боломжгүй → өөр үйлдэл санал болгоно (жишээ нь «Цуцлах»)
            ok.disabled = false;
            ok.textContent = fb.label;
            $("confirm-cancel").textContent = "Болих";
            ok.onclick = async () => {
              ok.disabled = true;
              dialog.close();
              await runAction(fb, row);
            };
            ok.focus();
          } else {
            ok.hidden = true;
            $("confirm-cancel").textContent = "Ойлголоо";
            $("confirm-cancel").focus();
          }
        }
      };
    }

    // ---- Ачаалах (эхэнд ба шүүлтүүр солигдоход) ----
    async function load() {
      const url = listUrl();
      message.hidden = false;
      message.className = "muted";
      message.textContent = "Ачаалж байна…";
      try {
        const data = await api(url);
        if (root.dataset.view !== cfg.id || url !== listUrl()) return; // энэ хооронд өөр зүйл сонгосон бол
        items = data;
      } catch (err) {
        message.textContent = `Мэдээлэл ачаалж чадсангүй: ${err.message}`;
        message.className = "error";
        tableWrap.hidden = true;
        return;
      }
      drawRows();
    }

    await load();
    if (root.dataset.view === cfg.id) search.focus();
  };
}

const capitalize = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/* =====================================================================
   4. ХУУДСУУД
   ===================================================================== */

const toursPage = createCrudPage({
  id: "tours",
  title: "Аялал",
  itemName: "аялал",
  endpoint: "/tours",
  idKey: "tour_id",
  labelKey: "name",
  searchKeys: ["name", "destination", "guide_name"],
  columns: [
    { key: "name", label: "Нэр" },
    { key: "destination", label: "Чиглэл" },
    { key: "days", label: "Хоног", align: "num" },
    { key: "price", label: "Үнэ (₮)", align: "num", format: (v) => (v == null ? null : money.format(v)) },
    { key: "guide_name", label: "Хөтөч" },
    { key: "booking_count", label: "Захиалга", align: "num" },
  ],
  fields: [
    { key: "name", label: "Нэр", required: true, maxlength: 100, wide: true },
    { key: "destination", label: "Чиглэл", maxlength: 50 },
    { key: "days", label: "Хоног", type: "number", required: true, min: 1, max: 365, step: 1 },
    { key: "price", label: "Үнэ (₮)", type: "number", required: true, min: 1, step: "any" },
    { key: "start_date", label: "Эхлэх огноо", type: "date" },
    {
      key: "guide_id", label: "Хөтөч", type: "select", numeric: true, wide: true,
      emptyLabel: "— Хөтөчгүй —",
      // Ижил нэртэй хөтчүүдийг ялгахын тулд хэл, туршлагыг нь хамт харуулна
      options: async () => (await api("/guides"))
        .sort((a, b) => a.full_name.localeCompare(b.full_name, "mn"))
        .map((g) => ({
          value: g.guide_id,
          label: [g.full_name, g.language, g.experience_years != null ? `${g.experience_years} жил` : null]
            .filter(Boolean).join(" · "),
        })),
    },
  ],
});

const customersPage = createCrudPage({
  id: "customers",
  title: "Үйлчлүүлэгч",
  itemName: "үйлчлүүлэгч",
  endpoint: "/customers",
  idKey: "customer_id",
  labelKey: "full_name",
  searchKeys: ["full_name", "country", "email"],
  columns: [
    { key: "full_name", label: "Нэр" },
    { key: "country", label: "Улс" },
    { key: "email", label: "И-мэйл" },
    { key: "booking_count", label: "Захиалга", align: "num" },
  ],
  fields: [
    { key: "full_name", label: "Нэр", required: true, maxlength: 100, wide: true },
    { key: "country", label: "Улс", maxlength: 50 },
    { key: "email", label: "И-мэйл", type: "email", maxlength: 100 },
  ],
});

const guidesPage = createCrudPage({
  id: "guides",
  title: "Хөтөч",
  itemName: "хөтөч",
  endpoint: "/guides",
  idKey: "guide_id",
  labelKey: "full_name",
  searchKeys: ["full_name", "language"],
  columns: [
    { key: "full_name", label: "Нэр" },
    { key: "language", label: "Хэл" },
    { key: "experience_years", label: "Туршлага", align: "num", format: (v) => (v == null ? null : `${v} жил`) },
    { key: "tour_count", label: "Хариуцсан аялал", align: "num" },
  ],
  fields: [
    { key: "full_name", label: "Нэр", required: true, maxlength: 100, wide: true },
    { key: "language", label: "Хэл", maxlength: 30 },
    { key: "experience_years", label: "Туршлага (жил)", type: "number", min: 0, max: 80, step: 1 },
  ],
});

const STATUS = {
  pending:   { label: "Хүлээгдэж буй", class: "pending" },
  confirmed: { label: "Батлагдсан",    class: "confirmed" },
  cancelled: { label: "Цуцалсан",      class: "cancelled" },
};
const statusBadge = (s) => el("span", { class: `status ${STATUS[s]?.class ?? ""}` }, STATUS[s]?.label ?? s);
const setStatus = (row, status) =>
  api(`/bookings/${row.booking_id}/status`, { method: "PATCH", body: { status } });
const cancelAction = {
  label: "Цуцлах", class: "danger-text",
  show: (row) => row.status !== "cancelled",
  run: (row) => setStatus(row, "cancelled"),
  done: "Захиалга цуцлагдлаа.",
};

const bookingsPage = createCrudPage({
  id: "bookings",
  title: "Захиалга",
  itemName: "захиалга",
  endpoint: "/bookings",
  idKey: "booking_id",
  labelOf: (row) => `#${row.booking_id} · ${row.customer_name} · ${row.tour_name}`,
  listUrl: (status) => `/bookings?limit=50${status ? `&status=${encodeURIComponent(status)}` : ""}`,
  countText: (n) => `Сүүлийн ${n} захиалга`,
  filter: {
    key: "status", label: "Төлөв",
    options: Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label })),
  },
  searchKeys: ["booking_id", "customer_name", "tour_name"],
  columns: [
    { key: "booking_id", label: "Дугаар", align: "num", format: (v) => `#${v}` },
    { key: "customer_name", label: "Үйлчлүүлэгч", wrap: true },
    { key: "tour_name", label: "Аялал", wrap: true },
    { key: "people", label: "Хүн", align: "num" },
    { key: "booked_at", label: "Огноо" },
    { key: "paid_amount", label: "Төлсөн (₮)", align: "num", format: (v) => (Number(v) > 0 ? money.format(v) : "—") },
    { key: "status", label: "Төлөв", format: statusBadge },
  ],
  fields: [
    {
      key: "tour_id", label: "Аялал", type: "select", numeric: true, required: true, wide: true,
      emptyLabel: "— Аялал сонгох —",
      options: async () => (await api("/tours"))
        .sort((a, b) => a.name.localeCompare(b.name, "mn"))
        .map((t) => ({ value: t.tour_id, label: `${t.name} · ${t.days} хоног · ${money.format(t.price)}₮` })),
    },
    {
      key: "customer_id", label: "Үйлчлүүлэгч", type: "select", numeric: true, required: true, wide: true,
      emptyLabel: "— Үйлчлүүлэгч сонгох —",
      options: async () => (await api("/customers"))
        .sort((a, b) => a.full_name.localeCompare(b.full_name, "mn"))
        .map((c) => ({ value: c.customer_id, label: [c.full_name, c.country, c.email].filter(Boolean).join(" · ") })),
    },
    { key: "people", label: "Хүний тоо", type: "number", required: true, min: 1, max: 100, step: 1 },
    {
      key: "status", label: "Төлөв", type: "select", required: true, default: "pending",
      emptyLabel: "— Төлөв сонгох —",
      options: async () => Object.entries(STATUS).map(([value, s]) => ({ value, label: s.label })),
    },
  ],
  // «Хүлээгдэж буй» захиалгад «Батлах», «Цуцлах»
  rowActions: [
    {
      label: "Батлах", class: "ok-text",
      show: (row) => row.status === "pending",
      run: (row) => setStatus(row, "confirmed"),
      done: "Захиалга батлагдлаа.",
    },
    { ...cancelAction, show: (row) => row.status === "pending" },
  ],
  // Төлбөртэй захиалгыг устгахгүй → «Цуцлах»-ыг санал болгоно
  deleteFallback: cancelAction,
});

async function renderDashboard(root) {
  root.replaceChildren(el("h1", {}, "Хяналт"), el("p", { class: "muted" }, "Ачаалж байна…"));

  let stats, topDemand;
  try {
    // Хоёуланг зэрэг татна. Загвар ачаалагдаагүй байсан ч картууд харагдана.
    [stats, topDemand] = await Promise.all([
      api("/admin/stats"),
      api("/demand/tours?limit=5").catch((err) => err),
    ]);
  } catch (err) {
    root.querySelector("p").textContent = `Мэдээлэл ачаалж чадсангүй: ${err.message}`;
    root.querySelector("p").className = "error";
    return;
  }
  if (root.dataset.view !== "dashboard") return;

  const cards = [
    { label: "Аялал", value: number.format(stats.tours) },
    { label: "Захиалга", value: number.format(stats.bookings) },
    { label: "Хүлээгдэж буй", value: number.format(stats.pending_bookings), accent: true },
    { label: "Нийт орлого", value: `${money.format(stats.revenue)} ₮` },
  ];

  const rows = stats.latest_pending.map((b) =>
    el("tr", {},
      el("td", { class: "num" }, `#${b.booking_id}`),
      el("td", {}, b.customer_name),
      el("td", {}, b.tour_name),
      el("td", { class: "num" }, b.people ?? "—"),
      el("td", {}, b.booked_at ?? "—"),
    )
  );

  root.replaceChildren(
    el("h1", {}, "Хяналт"),
    el("div", { class: "cards" },
      ...cards.map((c) =>
        el("div", { class: `card stat${c.accent ? " accent" : ""}` },
          el("span", { class: "stat-label" }, c.label),
          el("span", { class: "stat-value" }, c.value),
        )
      )
    ),
    el("section", { class: "card panel" },
      el("h2", {}, "Батлагдаагүй захиалга"),
      rows.length
        ? el("div", { class: "table-wrap" },
            el("table", {},
              el("thead", {}, el("tr", {},
                el("th", { class: "num" }, "Дугаар"), el("th", {}, "Үйлчлүүлэгч"), el("th", {}, "Аялал"),
                el("th", { class: "num" }, "Хүн"), el("th", {}, "Огноо"))),
              el("tbody", {}, ...rows)))
        : el("p", { class: "muted" }, "Батлагдаагүй захиалга алга."),
    ),
    el("section", { class: "card panel" },
      el("div", { class: "panel-head" },
        el("h2", {}, "Эрэлттэй 5 аялал"),
        el("a", { href: "#forecast", class: "link" }, "Бүгдийг харах →"),
      ),
      topDemand instanceof Error
        ? el("p", { class: "error" }, `Таамаглал ачаалж чадсангүй: ${topDemand.message}`)
        : demandTable(topDemand, { compact: true }),
    ),
  );
}

/* ---- Эрэлтийн хүснэгт (Хяналт ба Эрэлт таамаглах хуудас дундаа ашиглана) ---- */
function demandTable(rows, { compact = false } = {}) {
  if (!rows.length) return el("p", { class: "muted" }, "Захиалгатай аялал алга.");
  const max = Math.max(...rows.map((r) => Math.max(r.actual_bookings, r.predicted_demand ?? 0)), 1);

  const bar = (value, kind, fmt) =>
    el("span", { class: "bar-cell" },
      el("span", { class: `bar ${kind}`, style: `width:${Math.round(((value ?? 0) / max) * 100)}%` }),
      el("span", { class: "bar-num" }, value == null ? "—" : fmt.format(value)),
    );

  return el("div", { class: "table-wrap" },
    el("table", { class: "demand-table" },
      el("thead", {}, el("tr", {},
        el("th", { class: "num" }, "#"),
        el("th", {}, "Аялал"),
        compact ? null : el("th", { class: "num" }, "Хоног"),
        compact ? null : el("th", { class: "num" }, "Өдрийн үнэ (₮)"),
        compact ? null : el("th", {}, "Хөтөч"),
        el("th", {}, "Бодит захиалга"),
        el("th", {}, "Таамаглал"),
      )),
      el("tbody", {}, ...rows.map((r, i) =>
        el("tr", {},
          el("td", { class: "num muted" }, i + 1),
          el("td", {}, r.name),
          compact ? null : el("td", { class: "num" }, r.days),
          compact ? null : el("td", { class: "num" }, money.format(r.price_per_day)),
          compact ? null : el("td", {}, r.guide_name ? `${r.guide_name} · ${r.guide_experience} жил` : "—"),
          el("td", { class: "bar-col" }, bar(r.actual_bookings, "actual", number)),
          el("td", { class: "bar-col" }, bar(r.predicted_demand, "predicted", oneDecimal)),
        )
      )),
    ),
  );
}

/* ---- Эрэлт таамаглах хуудас: маягт + 10 аяллын хүснэгт ---- */
async function renderForecast(root) {
  const result = el("div", { class: "predict-result", "aria-live": "polite" },
    el("span", { class: "muted" }, "Утгуудаа оруулаад «Таамаглах» дарна уу."));

  const field = (id, label, attrs) =>
    el("div", { class: "field" },
      el("label", { for: id }, label),
      el("input", { id, name: id, type: "number", required: true, ...attrs }),
    );

  const form = el("form", { class: "predict-form" },
    field("price_per_day", "Өдрийн үнэ (₮)", { min: 0, step: "any", value: 150000 }),
    field("guide_experience", "Хөтчийн туршлага (жил)", { min: 0, max: 80, step: "any", value: 10 }),
    field("days", "Хоног", { min: 1, max: 365, step: 1, value: 5 }),
    el("button", { type: "submit" }, "Таамаглах"),
  );

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button");
    btn.disabled = true;
    const q = new URLSearchParams(
      ["price_per_day", "guide_experience", "days"].map((k) => [k, form.elements[k].value]));
    try {
      const data = await api(`/predict-demand?${q}`);
      result.replaceChildren(
        el("span", { class: "muted" }, "Таамагласан эрэлт"),
        el("strong", { class: "predict-value" }, oneDecimal.format(data.predicted_demand)),
        el("span", { class: "muted" }, "захиалга"),
      );
    } catch (err) {
      result.replaceChildren(el("span", { class: "error" }, err.status === 422
        ? "Утгууд буруу байна: үнэ ба туршлага 0-ээс их, хоног 1-ээс их байх ёстой."
        : err.message));
    } finally {
      btn.disabled = false;
    }
  });

  const tableSlot = el("div", {}, el("p", { class: "muted" }, "Ачаалж байна…"));

  root.replaceChildren(
    el("h1", {}, "Эрэлт таамаглах"),
    el("section", { class: "card panel" },
      el("h2", {}, "Шинэ аяллын эрэлтийг таамаглах"),
      el("p", { class: "muted hint" }, "Үнэ, хөтчийн туршлага, хоногоос хамааран хэдэн захиалга ирэхийг загвар таамаглана."),
      el("div", { class: "predict-row" }, form, result),
    ),
    el("section", { class: "card panel" },
      el("div", { class: "panel-head" },
        el("h2", {}, "Хамгийн их захиалгатай 10 аялал"),
        el("span", { class: "legend" },
          el("span", { class: "dot actual" }), "Бодит",
          el("span", { class: "dot predicted" }), "Таамаглал"),
      ),
      tableSlot,
    ),
  );

  try {
    const rows = await api("/demand/tours?limit=10");
    if (root.dataset.view !== "forecast") return;
    tableSlot.replaceChildren(demandTable(rows));
  } catch (err) {
    tableSlot.replaceChildren(el("p", { class: "error" }, `Ачаалж чадсангүй: ${err.message}`));
  }
}

function soonPage(title, verySoon = false) {
  return (root) => root.replaceChildren(
    el("h1", {}, title),
    el("div", { class: "card soon" },
      el("span", { class: "soon-badge" }, verySoon ? "Тун удахгүй" : "Удахгүй"),
      el("p", { class: "muted" },
        verySoon ? "Энэ хэсэг бараг бэлэн боллоо. Тун удахгүй нээгдэнэ." : "Энэ хэсэг хөгжүүлэлтийн шатанд байна."),
    ),
  );
}

/* =====================================================================
   5. ЦЭС БА ШИЛЖИЛТ (#dashboard, #tours …)
   ===================================================================== */

const ICON = {
  dashboard: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>',
  tours:     '<path d="M3 20l6-14 4 8 3-5 5 11z"/>',
  bookings:  '<rect x="4" y="4" width="16" height="17" rx="2"/><path d="M8 2v4M16 2v4M4 10h16"/>',
  customers: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 4-6 8-6s8 2 8 6"/>',
  guides:    '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>',
  forecast:  '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>',
  facebook:  '<path d="M14 21v-8h3l.5-3.5H14V7.5c0-1 .4-1.7 1.8-1.7H18V2.6C17.4 2.5 16.3 2.4 15 2.4c-2.8 0-4.5 1.7-4.5 4.7v2.4H7.5V13h3v8"/>',
};

const PAGES = [
  { id: "dashboard", label: "Хяналт",          render: renderDashboard },
  { id: "tours",     label: "Аялал",           render: toursPage },
  { id: "bookings",  label: "Захиалга",        render: bookingsPage },
  { id: "customers", label: "Үйлчлүүлэгч",     render: customersPage },
  { id: "guides",    label: "Хөтөч",           render: guidesPage },
  { id: "forecast",  label: "Эрэлт таамаглах", render: renderForecast },
  { id: "facebook",  label: "Facebook",        render: soonPage("Facebook", true) },
];

function buildMenu() {
  $("menu").replaceChildren(
    ...PAGES.map((p) => {
      const a = el("a", { href: `#${p.id}`, "data-page": p.id });
      a.insertAdjacentHTML("afterbegin", `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[p.id]}</svg>`);
      a.append(el("span", {}, p.label));
      return a;
    })
  );
}

function route() {
  if (!isTokenValid(tokenStore.get())) return logout("Нэвтрэх хугацаа дууссан байна. Дахин нэвтэрнэ үү.");
  const page = PAGES.find((p) => p.id === location.hash.slice(1)) ?? PAGES[0];

  document.querySelectorAll("#menu a").forEach((a) => {
    const active = a.dataset.page === page.id;
    a.classList.toggle("active", active);
    if (active) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });

  const content = $("content");
  content.dataset.view = page.id;
  page.render(content);
  document.title = `${page.label} · Аяллын систем`;
}

/* =====================================================================
   6. НЭВТРЭХ / ГАРАХ
   ===================================================================== */

function showLogin() {
  document.querySelectorAll("dialog[open]").forEach((d) => d.close());
  $("app-view").hidden = true;
  $("login-view").hidden = false;
  document.title = "Нэвтрэх · Аяллын систем";
  $("email").focus();
}

function showApp(token) {
  $("login-view").hidden = true;
  $("app-view").hidden = false;
  $("who").textContent = readToken(token)?.email ?? "";
  route();
}

function showLoginError(message) {
  $("login-error").textContent = message;
  $("login-error").hidden = !message;
}

async function login(event) {
  event.preventDefault();
  const email = $("email").value.trim();
  const password = $("password").value;
  if (!email || !password) return showLoginError("Имэйл болон нууц үгээ оруулна уу.");

  const button = $("login-btn");
  button.disabled = true;
  button.textContent = "Түр хүлээнэ үү…";
  showLoginError("");

  try {
    const res = await fetch(`${API_URL}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (res.status === 401) showLoginError("Имэйл эсвэл нууц үг буруу байна.");
    else if (res.status === 422) showLoginError("Имэйлийн хэлбэр буруу байна.");
    else if (res.status === 503) showLoginError("Өгөгдлийн сантай холбогдож чадсангүй.");
    else if (!res.ok) showLoginError("Сервер дээр алдаа гарлаа. Дахин оролдоно уу.");
    else {
      const data = await res.json();
      tokenStore.set(data.access_token);
      $("password").value = "";
      if (location.hash !== "#dashboard") history.replaceState(null, "", "#dashboard");
      showApp(data.access_token);
    }
  } catch {
    showLoginError("Сервертэй холбогдож чадсангүй.");
  } finally {
    button.disabled = false;
    button.textContent = "Нэвтрэх";
  }
}

// reason: нэвтрэх хуудсан дээр яагаад гарсныг харуулах мессеж (жишээ нь токен дууссан)
function logout(reason = "") {
  tokenStore.clear();
  showLogin();
  showLoginError(reason);
}

/* =====================================================================
   7. ЭХЛЭХ
   ===================================================================== */

if (!API_URL) {
  document.body.textContent = "config.js файлд API_URL алга. config.example.js-ийг харна уу.";
} else {
  buildMenu();
  $("login-form").addEventListener("submit", login);
  $("logout-btn").addEventListener("click", () => logout());
  document.querySelectorAll("[data-close]").forEach((b) =>
    b.addEventListener("click", () => b.closest("dialog").close()));
  window.addEventListener("hashchange", () => {
    if (!$("app-view").hidden) route();
  });

  const saved = tokenStore.get();
  if (isTokenValid(saved)) showApp(saved);
  else { tokenStore.clear(); showLogin(); }
}
