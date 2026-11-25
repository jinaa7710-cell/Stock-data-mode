/* ============================================================
   FIREBASE SETUP
   ============================================================ */
import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot
} from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCiSmfyfEUqmBxLhJ4ChLcNZSnAfwU6R7A",
  authDomain: "stock-mode.firebaseapp.com",
  projectId: "stock-mode",
  storageBucket: "stock-mode.firebasestorage.app",
  messagingSenderId: "850020458190",
  appId: "1:850020458190:web:aacf50ac9e1fd2e8893a9f",
  measurementId: "G-R9S7HTQL01"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const DOC_REF = doc(db, "stockApp", "data");

/* ============================================================
   THEME
   ============================================================ */
const THEME_KEY = "stockTheme";
let currentTheme = localStorage.getItem(THEME_KEY) || "dark";

function applyTheme(theme) {
  currentTheme = theme;
  document.documentElement.setAttribute("data-theme", theme);
  const btn = document.getElementById("themeToggle");
  if (btn) btn.textContent = theme === "dark" ? "🌙" : "☀️";
  localStorage.setItem(THEME_KEY, theme);
}

window.toggleTheme = function () {
  applyTheme(currentTheme === "dark" ? "light" : "dark");
};

/* ============================================================
   STATE
   ============================================================ */
const weekdays = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const UNITS = ["can", "bag", "pack", "bottle", "case", "dozen", "bundle", "piece"];

const defaultItems = [
  "Black coffee", "YeYe coffee", "Coast milk", "Cereal", "Corn flakes", "Chocos", "Honey", 
  "Peanut butter", "Crumpy", "Jam", "Cream Crackers", "Packet juice", "Packet milk", "Coke", 
  "XL(small)", "Bitter lemon", "Becool juice", "Orange", "Apple", "Watermelon", "Pumpkin", 
  "Papaya", "Chilli powder", "Chicken curry powder", "Dry chilli", "Tissue (small)", 
  "Tissue (medium)", "Kitchen tissue", "Tissue box", "Disposable cup", "Garlic", "Ginger", 
  "Egg", "Noodle", "Spaghetti", "Tuna chunks in oil", "Green peas", "Chilli sauce", 
  "Chilli and garlic sauce", "Tomato sauce", "Soya sauce", "Oyster sauce", "Tomato paste", 
  "Vanilla essence", "Salt", "Corn flour", "Baking powder", "Margarine", "Basmati rice", 
  "Dal", "Aj no moto", "Butter", "Cheese", "Whole chicken", "Chicken breast", 
  "Chicken drumsticks", "Snickers", "Plain yoghurt", "Flavour yoghurt", "Butter chicken", 
  "Biryani", "Atta", "Black tea", "Condensed milk", "Fruit cocktail", "Apollo chocolate cake", 
  "Apollo pandan", "Toothpick", "Mama", "Hand wash", "Gloves", "Fresh tomatoes", 
  "Baked beans", "Onions", "Potato", "Cooking oil", "Beef", "Parata", "Chilli", "Lemon"
];

const todayName = weekdays[new Date().getDay()];
let selectedDay = todayName;
let selectedUnit = "pack";

let stock = { days: {}, godown: [] };
let shipment = [];
let shipmentMeta = { supplier: "", date: "", notes: "" };
let shipmentHistory = [];
let activeHistoryId = null;
let godownFilter = "";
let catalogFilter = "";

function makeEmptyDay() {
  return { catalog: [], items: [], hidden: [] };
}

function nameKey(name) {
  return String(name || "").trim().toLowerCase();
}

function sanitizeStock(parsed) {
  const fresh = { days: {}, godown: [], shipment: [], shipmentMeta: {}, shipmentHistory: [] };
  weekdays.forEach(d => (fresh.days[d] = makeEmptyDay()));

  if (!parsed || typeof parsed !== "object") {
    weekdays.forEach(day => (fresh.days[day].catalog = [...defaultItems]));
    return fresh;
  }

  if (parsed.days && typeof parsed.days === "object") {
    weekdays.forEach(day => {
      const d = parsed.days[day];
      if (d && typeof d === "object") {
        fresh.days[day] = {
          catalog: Array.isArray(d.catalog) ? d.catalog.filter(x => typeof x === "string") : [],
          items: Array.isArray(d.items)
            ? d.items.filter(it => it && typeof it.name === "string").map(it => ({
                id: typeof it.id === "string" ? it.id : uid(),
                name: it.name,
                qty: Number.isFinite(Number(it.qty)) ? Math.floor(Number(it.qty)) : 0,
                collected: !!it.collected
              }))
            : [],
          hidden: Array.isArray(d.hidden) ? d.hidden.filter(x => typeof x === "string") : []
        };
      }
    });
  } else {
    weekdays.forEach(day => (fresh.days[day].catalog = [...defaultItems]));
  }

  const sanitizeLedger = arr =>
    Array.isArray(arr)
      ? arr.filter(g => g && typeof g.name === "string" && Number.isFinite(g.base) && g.base >= 0 && UNITS.includes(g.unit))
          .map(g => {
            const packSize = Number.isFinite(Number(g.packSize)) ? Math.max(0, Math.floor(Number(g.packSize))) : 0;
            const packUnit = typeof g.packUnit === "string" && UNITS.includes(g.packUnit) ? g.packUnit : "";
            return {
              name: g.name,
              unit: g.unit,
              packUnit: packUnit && packSize >= 2 ? packUnit : "",
              packSize: packUnit && packSize >= 2 ? packSize : 0,
              base: Math.floor(g.base),
              used: Math.max(0, Math.floor(g.used || 0))
            };
          })
      : [];

  fresh.godown = sanitizeLedger(parsed.godown);

  fresh.shipment = Array.isArray(parsed.shipment)
    ? parsed.shipment.filter(s => s && typeof s.name === "string" && Number.isFinite(Number(s.qty)) && Number(s.qty) > 0)
        .map(s => ({ name: s.name, qty: Math.floor(Number(s.qty)), unit: UNITS.includes(s.unit) ? s.unit : "piece" }))
    : [];

  fresh.shipmentMeta = parsed.shipmentMeta && typeof parsed.shipmentMeta === "object"
    ? {
        supplier: typeof parsed.shipmentMeta.supplier === "string" ? parsed.shipmentMeta.supplier : "",
        date: typeof parsed.shipmentMeta.date === "string" ? parsed.shipmentMeta.date : "",
        notes: typeof parsed.shipmentMeta.notes === "string" ? parsed.shipmentMeta.notes : ""
      }
    : { supplier: "", date: "", notes: "" };

  fresh.shipmentHistory = Array.isArray(parsed.shipmentHistory)
    ? parsed.shipmentHistory.filter(h => h && typeof h.id === "string" && Array.isArray(h.items))
        .map(h => ({
          id: h.id,
          supplier: typeof h.supplier === "string" ? h.supplier : "",
          date: typeof h.date === "string" ? h.date : "",
          notes: typeof h.notes === "string" ? h.notes : "",
          shippedAt: typeof h.shippedAt === "string" ? h.shippedAt : new Date().toISOString(),
          items: h.items.filter(it => it && typeof it.name === "string" && Number.isFinite(Number(it.qty)))
            .map(it => ({ name: it.name, qty: Math.floor(Number(it.qty)), unit: UNITS.includes(it.unit) ? it.unit : "piece" }))
        }))
    : [];

  return fresh;
}

async function loadStockFromFirebase() {
  try {
    const snap = await getDoc(DOC_REF);
    if (snap.exists()) {
      stock = sanitizeStock(snap.data());
    } else {
      stock = sanitizeStock(null);
      await saveNow();
    }
  } catch (e) {
    console.error("Firestore load failed:", e);
    toast("Failed to load data from Firebase");
    stock = sanitizeStock(null);
  }
  shipment = stock.shipment || [];
  shipmentMeta = stock.shipmentMeta || { supplier: "", date: "", notes: "" };
  shipmentHistory = stock.shipmentHistory || [];
}

let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(saveNow, 400);
}

async function saveNow() {
  try {
    stock.shipment = shipment;
    stock.shipmentMeta = shipmentMeta;
    stock.shipmentHistory = shipmentHistory;
    const plain = JSON.parse(JSON.stringify(stock));
    await setDoc(DOC_REF, plain);
  } catch (e) {
    console.error("Firestore save failed:", e);
    toast("Could not save data to Firebase");
  }
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

/* ============================================================
   HELPERS
   ============================================================ */
function currentDay() {
  if (!stock.days[selectedDay]) stock.days[selectedDay] = makeEmptyDay();
  return stock.days[selectedDay];
}
function dayItems() { return currentDay().items; }
function dayCatalog() { return currentDay().catalog; }

function syncCatalogFromGodown() {
  const day = currentDay();
  const hidden = new Set((day.hidden || []).map(nameKey));
  const have = new Set(day.catalog.map(nameKey));
  stock.godown.forEach(g => {
    const k = nameKey(g.name);
    if (hidden.has(k) || have.has(k)) return;
    day.catalog.push(g.name);
    have.add(k);
  });
}

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
}

function itemHasPack(item) {
  return !!(item && item.packUnit && item.packSize >= 2);
}

function formatQty(baseUnits, item) {
  const n = Math.max(0, Math.floor(baseUnits));
  if (!itemHasPack(item)) return `${n} ${item?.unit || ""}`.trim();
  const packs = Math.floor(n / item.packSize);
  const rem   = n % item.packSize;
  if (packs === 0) return `${rem} ${item.unit}`;
  if (rem === 0)   return `${packs} ${item.packUnit}`;
  return `${packs} ${item.packUnit} + ${rem} ${item.unit}`;
}

function toBaseQty(qty, unit, item) {
  const n = Math.max(0, Math.floor(Number(qty) || 0));
  if (itemHasPack(item) && unit === item.packUnit) return n * item.packSize;
  return n;
}

function findGodown(name) {
  const key = nameKey(name);
  return stock.godown.find(g => nameKey(g.name) === key);
}

function deductGodown(name, amount) {
  const g = findGodown(name);
  if (!g) return { deducted: 0, shortfall: amount, unit: "" };
  const want = Math.max(0, Math.floor(amount));
  const deducted = Math.min(want, g.base);
  g.base -= deducted;
  g.used += deducted;
  const shortfall = want - deducted;
  if (shortfall > 0) toast(`Only ${deducted} ${g.unit}(s) available in godown`);
  return { deducted, shortfall, unit: g.unit };
}

function refundGodown(name, amount) {
  const g = findGodown(name);
  if (!g) return;
  const want = Math.max(0, Math.floor(amount));
  const refund = Math.min(want, g.used);
  g.used -= refund;
  g.base += refund;
}

/* ============================================================
   BULK ADD ITEMS
   ============================================================ */
window.bulkAddItemsToAllDays = function() {
  if (!confirm("This will add all 80+ items to every day's catalog. Proceed?")) return;
  
  weekdays.forEach(day => {
    const dayData = stock.days[day];
    if (!dayData) return;
    
    const existing = new Set(dayData.catalog.map(n => nameKey(n)));
    
    defaultItems.forEach(item => {
      const key = nameKey(item);
      if (!existing.has(key)) {
        dayData.catalog.push(item);
        existing.add(key);
      }
    });
  });

  save();
  renderCatalog();
  renderDays();
  toast("✅ Loaded all items into every day!");
};

/* ============================================================
   RENDER: DAYS
   ============================================================ */
function renderDays() {
  const wrap = document.getElementById("days");
  if (!wrap) return;
  wrap.innerHTML = weekdays.map(day => {
    const count = (stock.days[day]?.items || []).length;
    return `
      <button class="day ${day === selectedDay ? "active" : ""}"
              onclick="changeDay('${day}')"
              aria-pressed="${day === selectedDay}">
        <span class="dow">${day.slice(0, 3)}</span>
        ${count > 0 ? `<span class="dot" title="${count} item(s)"></span>` : ""}
      </button>`;
  }).join("");
}

window.changeDay = function (day) {
  selectedDay = day;
  catalogUI = [];
  catalogFilter = "";
  const input = document.getElementById("catalogSearch");
  if (input) input.value = "";
  const clearBtn = document.getElementById("catalogSearchClear");
  if (clearBtn) clearBtn.classList.add("hidden");
  syncCatalogFromGodown();
  render();
};

/* ============================================================
   RENDER: CATALOG
   ============================================================ */
let catalogUI = [];

function syncCatalogUI() {
  const prev = new Map(catalogUI.map(c => [c.name, c]));
  catalogUI = dayCatalog().map(name => {
    const found = prev.get(name);
    return { name, checked: found ? found.checked : false, qty: found ? found.qty : "" };
  });
}

function renderCatalog() {
  syncCatalogFromGodown();
  syncCatalogUI();
  
  const wrap = document.getElementById("catalog");
  if (!wrap) return;
  document.getElementById("catalogDayBadge").textContent = selectedDay;

  const clearBtn = document.getElementById("catalogSearchClear");
  if (clearBtn) clearBtn.classList.toggle("hidden", catalogFilter === "");

  const filter = catalogFilter.toLowerCase();
  const visibleIdx = dayCatalog()
    .map((name, i) => ({ name, i }))
    .filter(({ name }) => filter === "" || name.toLowerCase().includes(filter));

  if (dayCatalog().length === 0) {
    wrap.innerHTML = `<div class="empty">No items for ${selectedDay} yet. Add one below.</div>`;
    updateAddSelectedBtn();
    return;
  }

  if (visibleIdx.length === 0) {
    wrap.innerHTML = `<div class="empty">No items match "<strong>${escapeHTML(catalogFilter)}</strong>".</div>`;
    updateAddSelectedBtn();
    return;
  }

  const alreadyOnDay = new Set(dayItems().map(i => nameKey(i.name)));

  wrap.innerHTML = visibleIdx.map(({ name, i }) => {
    const onDay = alreadyOnDay.has(nameKey(name));
    return `
      <div class="item" data-idx="${i}">
        <input type="checkbox" id="check${i}"
               ${catalogUI[i]?.checked ? "checked" : ""}
               onchange="onCheckChange(${i}, this.checked)">
        <span class="name">
          ${escapeHTML(name)}
          ${onDay ? `<span class="badge">on ${selectedDay.slice(0, 3)}</span>` : ""}
        </span>
        <input type="number" id="qty${i}" min="0" step="1"
               inputmode="numeric" placeholder="QTY"
               value="${escapeAttr(catalogUI[i]?.qty ?? "")}"
               oninput="onQtyInput(${i}, this.value)">
        <button class="btn-del" title="Remove ${escapeAttr(name)} from ${escapeAttr(selectedDay)}"
                aria-label="Remove ${escapeAttr(name)}"
                onclick="deleteCatalogItem(${i})">✕</button>
      </div>`;
  }).join("");

  updateAddSelectedBtn();
}

window.onCatalogSearch = function (value) {
  catalogFilter = String(value || "").trim();
  const clearBtn = document.getElementById("catalogSearchClear");
  if (clearBtn) clearBtn.classList.toggle("hidden", catalogFilter === "");
  renderCatalog();
};

window.clearCatalogSearch = function () {
  catalogFilter = "";
  const input = document.getElementById("catalogSearch");
  if (input) { input.value = ""; input.focus(); }
  const clearBtn = document.getElementById("catalogSearchClear");
  if (clearBtn) clearBtn.classList.add("hidden");
  renderCatalog();
};

window.onCheckChange = function (i, checked) {
  if (catalogUI[i]) catalogUI[i].checked = checked;
  updateAddSelectedBtn();
};

window.onQtyInput = function (i, value) {
  if (catalogUI[i]) catalogUI[i].qty = value;
  updateAddSelectedBtn();
};

function updateAddSelectedBtn() {
  const btn = document.getElementById("addSelectedBtn");
  if (!btn) return;
  btn.disabled = !catalogUI.some(c => c.checked);
}

/* ============================================================
   ACTIONS: CATALOG
   ============================================================ */
window.addItem = function () {
  const input = document.getElementById("newName");
  const name = input.value.trim();
  if (!name) { toast("Enter an item name"); return; }
  if (dayCatalog().some(x => nameKey(x) === nameKey(name))) {
    toast(`"${name}" already in ${selectedDay}'s list`);
    return;
  }
  dayCatalog().push(name);
  const day = currentDay();
  if (Array.isArray(day.hidden)) {
    day.hidden = day.hidden.filter(n => nameKey(n) !== nameKey(name));
  }
  save();
  input.value = "";
  renderCatalog();
  toast(`Added "${name}" to ${selectedDay}`);
};

window.deleteCatalogItem = function (i) {
  const name = dayCatalog()[i];
  if (name == null) return;

  const day = currentDay();
  day.catalog.splice(i, 1);
  if (!Array.isArray(day.hidden)) day.hidden = [];
  if (!day.hidden.some(n => nameKey(n) === nameKey(name))) {
    day.hidden.push(name);
  }

  const toRemove = day.items.filter(it => nameKey(it.name) === nameKey(name));
  toRemove.forEach(it => {
    if (it.collected) refundGodown(it.name, it.qty);
  });
  day.items = day.items.filter(it => nameKey(it.name) !== nameKey(name));
  catalogUI.splice(i, 1);

  save();
  renderCatalog();
  renderUpdate();
  renderDays();
  renderGodown();
  toast(toRemove.length > 0 ? `Removed "${name}" (and ${toRemove.length} from update)` : `Removed "${name}" from ${selectedDay}`);
};

window.addSelected = function () {
  let added = 0, merged = 0, reverted = 0, invalid = 0, overstocked = 0;

  dayCatalog().forEach((name, i) => {
    const ui = catalogUI[i];
    if (!ui || !ui.checked) return;

    const raw = String(ui.qty).trim();
    const qtyNum = Number(raw);
    if (raw === "" || !Number.isFinite(qtyNum) || qtyNum <= 0 || !Number.isInteger(qtyNum)) {
      invalid++;
      return;
    }

    const key = nameKey(name);
    const existing = dayItems().find(item => nameKey(item.name) === key);

    if (existing) {
      if (existing.collected) {
        refundGodown(existing.name, existing.qty);
        existing.collected = false;
        existing.qty += qtyNum;
        reverted++;
      } else {
        existing.qty += qtyNum;
        merged++;
      }
    } else {
      const g = findGodown(name);
      if (g && qtyNum > g.base) overstocked++;
      dayItems().push({ id: uid(), name, qty: qtyNum, collected: false });
      added++;
    }

    ui.checked = false;
    ui.qty = "";
  });

  save();

  if (added === 0 && merged === 0 && reverted === 0) {
    toast(invalid > 0 ? "Enter a valid positive quantity" : "Select items first");
    renderCatalog();
    return;
  }

  renderDays();
  renderCatalog();
  renderUpdate();
  renderGodown();

  const parts = [];
  if (added)    parts.push(`${added} added`);
  if (merged)   parts.push(`${merged} merged`);
  if (reverted) parts.push(`${reverted} merged (uncollected)`);

  toast(overstocked > 0 ? `${parts.join(", ")} · ${overstocked} exceed godown stock` : parts.join(", ") + ` → ${selectedDay}`);
  showPage("update", document.querySelector('.tabs button[data-tab="update"]'));
};

/* ============================================================
   ACTIONS: DAILY UPDATE
   ============================================================ */
window.toggleCollected = function (id, value) {
  const item = dayItems().find(x => x.id === id);
  if (!item) return;
  if (value) {
    if (!item.collected) {
      deductGodown(item.name, item.qty);
      item.collected = true;
    }
  } else {
    if (item.collected) {
      refundGodown(item.name, item.qty);
      item.collected = false;
    }
  }
  save();
  renderUpdate();
  renderGodown();
};

window.clearCollected = function () {
  const day = currentDay();
  const before = day.items.length;
  day.items = day.items.filter(x => !x.collected);
  const removed = before - day.items.length;
  save();
  renderUpdate();
  renderDays();
  renderCatalog();
  renderGodown();
  toast(removed ? `Removed ${removed} collected item${removed > 1 ? "s" : ""}` : "Nothing collected to remove");
};

window.resetDay = function () {
  if (!confirm(`Reset all items for ${selectedDay}? This cannot be undone.`)) return;
  stock.days[selectedDay].items.forEach(item => {
    if (item.collected) refundGodown(item.name, item.qty);
  });
  stock.days[selectedDay].items = [];
  save();
  renderUpdate();
  renderDays();
  renderCatalog();
  renderGodown();
  toast(`${selectedDay} update reset`);
};

window.selectAllRemaining = function () {
  let n = 0, short = 0;
  dayItems().forEach(item => {
    if (!item.collected) {
      const res = deductGodown(item.name, item.qty);
      if (res.shortfall > 0) short++;
      item.collected = true;
      n++;
    }
  });
  save();
  renderUpdate();
  renderGodown();
  if (n) toast(short > 0 ? `Marked ${n} collected (${short} short on stock)` : `Marked ${n} as collected`);
};

window.unselectAll = function () {
  dayItems().forEach(item => {
    if (item.collected) {
      refundGodown(item.name, item.qty);
      item.collected = false;
    }
  });
  save();
  renderUpdate();
  renderGodown();
  toast("Unmarked all");
};

/* ============================================================
   RENDER: UPDATE
   ============================================================ */
function renderUpdate() {
  const items = dayItems();
  const total = items.length;
  const collected = items.filter(x => x.collected).length;
  const remaining = total - collected;
  
  document.getElementById("dayBadge").textContent = selectedDay;
  document.getElementById("statCollected").textContent = collected;
  document.getElementById("statTotal").textContent = total;
  document.getElementById("statRemaining").textContent = remaining;

  const list = document.getElementById("updateList");
  if (total === 0) {
    list.innerHTML = `<div class="empty">No items for ${selectedDay} yet.<br>Add some from the "Daily stock data" tab.</div>`;
    return;
  }

  const sorted = [...items].sort((a, b) => Number(a.collected) - Number(b.collected));
  list.innerHTML = sorted.map(item => {
    const g = findGodown(item.name);
    const qtyLabel = g ? formatQty(item.qty, g) : `${item.qty}`;
    return `
      <div class="item" style="grid-template-columns:28px 1fr 84px;">
        <input type="checkbox" ${item.collected ? "checked" : ""}
               onchange="toggleCollected('${item.id}', this.checked)">
        <span class="name ${item.collected ? "done" : ""}">${escapeHTML(item.name)}</span>
        <span class="qty-badge">${escapeHTML(qtyLabel)}</span>
      </div>
    `;
  }).join("");
}

/* ============================================================
   RENDER: GODOWN
   ============================================================ */
function renderGodown() {
  const wrap = document.getElementById("godownList");
  if (!wrap) return;

  const filter = godownFilter.toLowerCase();
  const visible = filter
    ? stock.godown.map((g, i) => ({ g, i })).filter(({ g }) => g.name.toLowerCase().includes(filter))
    : stock.godown.map((g, i) => ({ g, i }));

  const clearBtn = document.getElementById("godownSearchClear");
  if (clearBtn) clearBtn.classList.toggle("hidden", filter === "");

  if (stock.godown.length === 0) {
    wrap.innerHTML = `<div class="empty">No godown items yet. Add one below.</div>`;
    renderUnitPicker();
    return;
  }

  if (visible.length === 0) {
    wrap.innerHTML = `<div class="empty">No items match "<strong>${escapeHTML(godownFilter)}</strong>".</div>`;
    renderUnitPicker();
    return;
  }

  const header = `
    <div class="godown-row godown-header">
      <span class="g-name">Item</span>
      <span class="g-unit">Unit</span>
      <span class="g-num">Total</span>
      <span class="g-num">Used</span>
      <span class="g-num">Avail</span>
      <span></span>
    </div>`;

  const rows = visible.map(({ g, i }) => {
    const inShipment = shipment.some(s => nameKey(s.name) === nameKey(g.name));
    const totalBase = g.base + g.used;
    const totalStr  = formatQty(totalBase, g);
    const usedStr   = formatQty(g.used, g);
    const availStr  = formatQty(g.base, g);

    return `
      <div class="godown-row">
        <span class="g-name">${escapeHTML(g.name)}</span>
        <span class="g-unit">${escapeHTML(g.unit)}${g.packUnit ? ` / ${escapeHTML(g.packUnit)}` : ""}</span>
        <span class="g-num">${escapeHTML(totalStr)}</span>
        <span class="g-num used">${escapeHTML(usedStr)}</span>
        <span class="g-num avail">${escapeHTML(availStr)}</span>
        <button class="btn-del" title="Delete ${escapeAttr(g.name)}" aria-label="Delete ${escapeAttr(g.name)}" onclick="deleteGodownItem(${i})">✕</button>
        <div class="restock">
          <input type="number" id="restock${i}" min="1" step="1" inputmode="numeric" placeholder="Restock qty"
                 onkeydown="if(event.key==='Enter')restockGodown(${i})">
          <select id="restockUnit${i}">
            <option value="${g.unit}">${g.unit}</option>
            ${g.packUnit ? `<option value="${g.packUnit}">${g.packUnit}</option>` : ""}
          </select>
          <button onclick="restockGodown(${i})">Restock</button>
          <button onclick="editGodownPack(${i})" title="Set Pack Unit">⚙</button>
          <button class="add-to-shipment ${inShipment ? "added" : ""}" title="Add ${escapeAttr(g.name)} to shipment"
                  aria-label="Add ${escapeAttr(g.name)} to shipment" onclick="toggleShipment('${escapeAttr(g.name)}')">
            ${inShipment ? "✓" : "+"}
          </button>
        </div>
      </div>`;
  }).join("");

  wrap.innerHTML = header + rows;
  renderUnitPicker();
}

window.onGodownSearch = function (value) {
  godownFilter = String(value || "").trim();
  const clearBtn = document.getElementById("godownSearchClear");
  if (clearBtn) clearBtn.classList.toggle("hidden", godownFilter === "");
  renderGodown();
};

window.clearGodownSearch = function () {
  godownFilter = "";
  const input = document.getElementById("godownSearch");
  if (input) { input.value = ""; input.focus(); }
  const clearBtn = document.getElementById("godownSearchClear");
  if (clearBtn) clearBtn.classList.add("hidden");
  renderGodown();
};

function renderUnitPicker() {
  const wrap = document.getElementById("godownUnitPicker");
  if (!wrap) return;
  wrap.innerHTML = UNITS.map(u => `
    <button class="${u === selectedUnit ? "active" : ""}" onclick="pickUnit('${u}')">${u}</button>
  `).join("");
}

window.pickUnit = function (u) {
  selectedUnit = u;
  renderUnitPicker();
};

window.onGodownPackUnitChange = function () {
  const unitSel = document.getElementById("godownPackUnit");
  const sizeEl  = document.getElementById("godownPackSize");
  if (!unitSel || !sizeEl) return;
  sizeEl.disabled = !unitSel.value;
  if (!unitSel.value) sizeEl.value = "";
};

window.addGodownItem = function () {
  const nameEl = document.getElementById("godownName");
  const qtyEl = document.getElementById("godownQty");
  const name = nameEl.value.trim();
  const qty = Number(qtyEl.value);
  if (!name) { toast("Enter an item name"); return; }
  if (!Number.isFinite(qty) || qty <= 0 || !Number.isInteger(qty)) { toast("Enter a valid positive quantity"); return; }
  if (!UNITS.includes(selectedUnit)) { toast("Pick a base unit"); return; }
  if (findGodown(name)) { toast(`"${name}" already in godown — use Restock`); return; }

  const pu = document.getElementById("godownPackUnit");
  const ps = document.getElementById("godownPackSize");
  const packUnit = pu ? pu.value : "";
  const packSize = ps ? Number(ps.value) : 0;
  const finalPackUnit = (packUnit && UNITS.includes(packUnit) && packSize >= 2 && packUnit !== selectedUnit) ? packUnit : "";
  const finalPackSize = finalPackUnit ? Math.floor(packSize) : 0;

  stock.godown.push({ name, unit: selectedUnit, packUnit: finalPackUnit, packSize: finalPackSize, base: qty, used: 0 });
  
  weekdays.forEach(d => {
    const day = stock.days[d];
    if (day && Array.isArray(day.hidden)) {
      day.hidden = day.hidden.filter(n => nameKey(n) !== nameKey(name));
    }
  });

  save();
  nameEl.value = "";
  qtyEl.value = "";
  if (pu) pu.value = "";
  if (ps) { ps.value = ""; ps.disabled = true; }
  renderGodown();
  renderCatalog();
  toast(`Added "${name}"`);
};

window.restockGodown = function (i) {
  const g = stock.godown[i];
  if (!g) return;
  const input = document.getElementById(`restock${i}`);
  const unitSel = document.getElementById(`restockUnit${i}`);
  const raw = Number(input.value);
  if (!Number.isFinite(raw) || raw <= 0 || !Number.isInteger(raw)) { toast("Enter a valid restock quantity"); return; }
  const unit = unitSel ? unitSel.value : g.unit;
  const addBase = toBaseQty(raw, unit, g);
  g.base += addBase;
  save();
  renderGodown();
  toast(`Restocked ${formatQty(addBase, g)} of "${g.name}"`);
};

window.editGodownPack = function (i) {
  const g = stock.godown[i];
  if (!g) return;
  const unitList = UNITS.filter(u => u !== g.unit).join(", ");
  const pu = prompt(`Pack unit for "${g.name}" (base unit: ${g.unit}).\nLeave blank for none.\nAvailable: ${unitList}`, g.packUnit || "");
  if (pu === null) return;
  const packUnit = pu.trim().toLowerCase();
  if (packUnit === "") {
    g.packUnit = "";
    g.packSize = 0;
    save(); renderGodown(); toast(`Pack cleared for "${g.name}"`); return;
  }
  if (!UNITS.includes(packUnit) || packUnit === g.unit) {
    toast(`Invalid pack unit — must be one of: ${unitList}`); return;
  }
  const ps = prompt(`How many ${g.unit} in 1 ${packUnit}?`, g.packSize || "12");
  if (ps === null) return;
  const n = Number(ps);
  if (!Number.isFinite(n) || n < 2 || !Number.isInteger(n)) { toast("Pack size must be a whole number ≥ 2"); return; }
  g.packUnit = packUnit;
  g.packSize = Math.floor(n);
  save(); renderGodown(); toast(`"${g.name}" now packs ${g.packSize} ${g.unit} per ${g.packUnit}`);
};

window.deleteGodownItem = function (i) {
  const g = stock.godown[i];
  if (!g) return;
  if (!confirm(`Delete "${g.name}" from godown?`)) return;
  stock.godown.splice(i, 1);
  save(); renderGodown(); toast(`Deleted "${g.name}"`);
};

/* ============================================================
   SHIPMENT + HISTORY
   ============================================================ */
function renderShipment() {
  const wrap = document.getElementById("shipmentList");
  const actions = document.getElementById("shipmentActions");
  const actions2 = document.getElementById("shipmentActionRow2");
  const badge = document.getElementById("shipmentCountBadge");
  const supplierEl = document.getElementById("shipmentSupplier");
  const dateEl = document.getElementById("shipmentDate");
  const notesEl = document.getElementById("shipmentNotes");
  if (!wrap) return;

  badge.textContent = `${shipment.length} item${shipment.length === 1 ? "" : "s"}`;

  if (supplierEl && document.activeElement !== supplierEl) supplierEl.value = shipmentMeta.supplier || "";
  if (dateEl && document.activeElement !== dateEl) dateEl.value = shipmentMeta.date || "";
  if (notesEl && document.activeElement !== notesEl) notesEl.value = shipmentMeta.notes || "";

  if (shipment.length === 0) {
    wrap.innerHTML = `<div class="empty">No items in shipment yet.</div>`;
    actions.style.display = "none";
    actions2.style.display = "none";
    return;
  }

  wrap.innerHTML = shipment.map((s, i) => {
    const g = findGodown(s.name);
    const unitLabel = g ? g.unit : s.unit;
    return `
      <div class="shipment-row">
        <span class="s-name">${escapeHTML(s.name)}</span>
        <input type="number" min="1" step="1" inputmode="numeric" value="${s.qty}" onchange="updateShipmentQty(${i}, this.value)">
        <span class="s-qty">${escapeHTML(unitLabel)}</span>
        <button class="btn-del" title="Remove ${escapeAttr(s.name)}" onclick="removeShipmentItem(${i})">✕</button>
      </div>
    `;
  }).join("");

  actions.style.display = "flex";
  actions2.style.display = "flex";
}

window.onShipmentMetaInput = function () {
  const supplierEl = document.getElementById("shipmentSupplier");
  const dateEl = document.getElementById("shipmentDate");
  const notesEl = document.getElementById("shipmentNotes");
  shipmentMeta = { supplier: supplierEl.value.trim(), date: dateEl.value, notes: notesEl.value.trim() };
  save();
};

window.toggleShipment = function (name) {
  const key = nameKey(name);
  const idx = shipment.findIndex(s => nameKey(s.name) === key);
  if (idx >= 0) {
    shipment.splice(idx, 1);
    toast(`Removed "${name}" from shipment`);
  } else {
    const g = findGodown(name);
    shipment.push({ name, qty: 1, unit: g ? g.unit : "piece" });
    toast(`Added "${name}" to shipment`);
  }
  save(); renderGodown(); renderShipment();
};

window.updateShipmentQty = function (i, value) {
  const s = shipment[i];
  if (!s) return;
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) { toast("Invalid quantity"); renderShipment(); return; }
  s.qty = n;
  save();
};

window.removeShipmentItem = function (i) {
  if (!shipment[i]) return;
  const name = shipment[i].name;
  shipment.splice(i, 1);
  save(); renderGodown(); renderShipment(); toast(`Removed "${name}" from shipment`);
};

window.clearShipment = function () {
  if (shipment.length === 0) return;
  if (!confirm("Clear the entire shipment order?")) return;
  shipment = [];
  shipmentMeta = { supplier: "", date: "", notes: "" };
  save(); renderGodown(); renderShipment(); toast("Shipment cleared");
};

function buildShipmentPDF(items, meta, opts = {}) {
  const { jsPDF } = window.jspdf;
  const pdf = new jsPDF({ unit: "pt", format: "a4" });
  const margin = 48, pageW = pdf.internal.pageSize.getWidth(), pageH = pdf.internal.pageSize.getHeight();
  const supplier = (meta.supplier || "").trim(), dateStr = meta.date || new Date().toISOString().slice(0, 10);
  const notes = (meta.notes || "").trim(), isHistory = !!opts.history;

  pdf.setFillColor(244, 189, 34); pdf.rect(0, 0, pageW, 70, "F"); pdf.setTextColor(0, 0, 0); pdf.setFont("helvetica", "bold"); pdf.setFontSize(20);
  pdf.text(isHistory ? "SHIPMENT RECORD" : "SHIPMENT ORDER", margin, 42);
  pdf.setFont("helvetica", "normal"); pdf.setFontSize(10);
  const headerRight = isHistory && opts.shippedAt ? `Shipped: ${new Date(opts.shippedAt).toLocaleString()}` : `Date: ${dateStr}`;
  pdf.text(headerRight, pageW - margin, 30, { align: "right" });
  pdf.text(new Date().toLocaleString(), pageW - margin, 46, { align: "right" });

  let y = 100;
  if (supplier) {
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(11); pdf.setTextColor(90, 90, 90); pdf.text("TO", margin, y);
    pdf.setTextColor(0, 0, 0); pdf.setFont("helvetica", "normal"); pdf.setFontSize(12); pdf.text(supplier, margin + 40, y); y += 20;
  }
  if (notes) {
    pdf.setFont("helvetica", "bold"); pdf.setFontSize(11); pdf.setTextColor(90, 90, 90); pdf.text("NOTES", margin, y);
    pdf.setTextColor(0, 0, 0); pdf.setFont("helvetica", "normal"); pdf.setFontSize(11);
    const noteLines = pdf.splitTextToSize(notes, pageW - margin * 2 - 50); pdf.text(noteLines, margin + 55, y); y += noteLines.length * 14 + 10;
  }

  y += 14;
  pdf.setFont("helvetica", "bold"); pdf.setFontSize(11); pdf.setTextColor(90, 90, 90);
  pdf.text("#", margin, y); pdf.text("ITEM", margin + 30, y);
  pdf.text("QTY", pageW - margin - 120, y, { align: "right" }); pdf.text("UNIT", pageW - margin - 20, y, { align: "right" });
  pdf.setDrawColor(200); pdf.line(margin, y + 6, pageW - margin, y + 6); y += 24;

  pdf.setTextColor(0, 0, 0); pdf.setFont("helvetica", "normal"); pdf.setFontSize(12);
  items.forEach((s, i) => {
    if (y > pageH - 80) { pdf.addPage(); y = 60; }
    pdf.text(String(i + 1), margin, y); pdf.text(String(s.name).slice(0, 60), margin + 30, y);
    pdf.text(String(s.qty), pageW - margin - 120, y, { align: "right" }); pdf.text(s.unit, pageW - margin - 20, y, { align: "right" });
    y += 22; pdf.setDrawColor(235); pdf.line(margin, y - 12, pageW - margin, y - 12);
  });

  const totalQty = items.reduce((sum, s) => sum + s.qty, 0);
  y += 10; pdf.setFont("helvetica", "bold"); pdf.setFontSize(12);
  pdf.text(`Items: ${items.length}`, margin, y); pdf.text(`Total qty: ${totalQty}`, pageW - margin, y, { align: "right" });
  return pdf;
}

function shipmentFileName(prefix = "shipment") {
  const d = new Date(), pad = n => String(n).padStart(2, "0");
  return `${prefix}-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.pdf`;
}

window.downloadShipmentPDF = function () {
  if (shipment.length === 0) { toast("Shipment is empty"); return; }
  try { buildShipmentPDF(shipment, shipmentMeta).save(shipmentFileName("shipment")); toast("PDF downloaded"); } 
  catch (e) { console.error(e); toast("Failed to generate PDF"); }
};

window.shareShipmentPDF = async function () {
  if (shipment.length === 0) { toast("Shipment is empty"); return; }
  try {
    const pdf = buildShipmentPDF(shipment, shipmentMeta);
    const blob = pdf.output("blob");
    const file = new File([blob], shipmentFileName("shipment"), { type: "application/pdf" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: "Shipment Order", text: "Please review the attached shipment order." });
      toast("Shared");
    } else { pdf.save(shipmentFileName("shipment")); toast("Sharing not supported — downloaded instead"); }
  } catch (e) { if (e.name !== "AbortError") { console.error(e); toast("Share failed"); } }
};

window.markShipped = async function () {
  if (shipment.length === 0) { toast("Shipment is empty"); return; }
  if (!confirm("Mark this shipment as shipped? Stock will be deducted from the godown and the order moved to history.")) return;

  let shortfalls = 0;
  shipment.forEach(s => { if (deductGodown(s.name, s.qty).shortfall > 0) shortfalls++; });

  const entry = {
    id: uid(), supplier: shipmentMeta.supplier || "", date: shipmentMeta.date || new Date().toISOString().slice(0, 10),
    notes: shipmentMeta.notes || "", shippedAt: new Date().toISOString(), items: shipment.map(s => ({ ...s }))
  };
  shipmentHistory.unshift(entry);
  shipment = []; shipmentMeta = { supplier: "", date: "", notes: "" };

  save(); renderGodown(); renderShipment(); renderHistory();
  toast(shortfalls > 0 ? `Shipped with ${shortfalls} item(s) short on stock` : "Marked as shipped");
};

function renderHistory() {
  const wrap = document.getElementById("historyList");
  const badge = document.getElementById("historyCountBadge");
  const bulk = document.getElementById("historyBulkActions");
  if (!wrap) return;
  badge.textContent = String(shipmentHistory.length);

  if (bulk) bulk.style.display = shipmentHistory.length > 0 ? "flex" : "none";
  if (shipmentHistory.length === 0) { wrap.innerHTML = `<div class="empty">No past shipments yet.</div>`; return; }

  wrap.innerHTML = shipmentHistory.map(h => {
    const totalQty = h.items.reduce((sum, s) => sum + s.qty, 0);
    const supplier = h.supplier ? escapeHTML(h.supplier) : "(no supplier)";
    const when = h.date || new Date(h.shippedAt).toLocaleDateString();
    return `
      <div class="history-entry" onclick="openHistoryModal('${h.id}')">
        <div class="h-main">
          <span class="h-supplier">${supplier}</span>
          <span class="h-meta">${escapeHTML(when)} · ${h.items.length} item${h.items.length === 1 ? "" : "s"}</span>
        </div>
        <div class="h-total">${totalQty} qty</div>
      </div>`;
  }).join("");
}

window.openHistoryModal = function (id) {
  const h = shipmentHistory.find(x => x.id === id);
  if (!h) return;
  activeHistoryId = id;
  document.getElementById("modalTitle").textContent = h.supplier ? `Shipment · ${h.supplier}` : "Shipment";
  const totalQty = h.items.reduce((sum, s) => sum + s.qty, 0);
  
  const body = `
    <h4>Details</h4>
    <div>Date: ${escapeHTML(h.date || new Date(h.shippedAt).toLocaleDateString())}</div>
    <div>Shipped: ${escapeHTML(new Date(h.shippedAt).toLocaleString())}</div>
    ${h.supplier ? `<div>Supplier: ${escapeHTML(h.supplier)}</div>` : ""}
    ${h.notes ? `<div>Notes: ${escapeHTML(h.notes)}</div>` : ""}
    <h4>Items</h4>
    ${h.items.map(s => `
      <div class="m-line">
        <span>${escapeHTML(s.name)}</span>
        <span class="m-qty">${s.qty}</span>
        <span class="m-unit">${escapeHTML(s.unit)}</span>
      </div>`).join("")}
    <div class="m-total"><span>Total</span><span>${totalQty} qty</span></div>`;
  document.getElementById("modalBody").innerHTML = body;
  document.getElementById("historyModal").classList.remove("hidden");
};

window.closeHistoryModal = function () {
  document.getElementById("historyModal").classList.add("hidden");
  activeHistoryId = null;
};

window.downloadHistoryPDF = function () {
  const h = shipmentHistory.find(x => x.id === activeHistoryId);
  if (!h) return;
  try { buildShipmentPDF(h.items, { supplier: h.supplier, date: h.date, notes: h.notes }, { history: true, shippedAt: h.shippedAt }).save(shipmentFileName("shipment-record")); toast("PDF downloaded"); } 
  catch (e) { console.error(e); toast("Failed to generate PDF"); }
};

window.shareHistoryPDF = async function () {
  const h = shipmentHistory.find(x => x.id === activeHistoryId);
  if (!h) return;
  try {
    const pdf = buildShipmentPDF(h.items, { supplier: h.supplier, date: h.date, notes: h.notes }, { history: true, shippedAt: h.shippedAt });
    const blob = pdf.output("blob");
    const file = new File([blob], shipmentFileName("shipment-record"), { type: "application/pdf" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: "Shipment Record", text: "Shipment record attached." });
      toast("Shared");
    } else { pdf.save(shipmentFileName("shipment-record")); toast("Sharing not supported — downloaded instead"); }
  } catch (e) { if (e.name !== "AbortError") { console.error(e); toast("Share failed"); } }
};

window.deleteHistoryEntry = function () {
  const idx = shipmentHistory.findIndex(x => x.id === activeHistoryId);
  if (idx < 0) return;
  if (!confirm("Delete this shipment record? (Godown stock will NOT be restored.)")) return;
  shipmentHistory.splice(idx, 1);
  save(); closeHistoryModal(); renderHistory(); toast("Record deleted");
};

window.undoShipment = function () {
  const h = shipmentHistory.find(x => x.id === activeHistoryId);
  if (!h) return;
  if (!confirm(`Undo this shipment?\n\n• Stock will be returned to the godown\n• The history record will be removed\n\nThis cannot be undone.`)) return;
  h.items.forEach(it => refundGodown(it.name, it.qty));
  const idx = shipmentHistory.findIndex(x => x.id === activeHistoryId);
  if (idx >= 0) shipmentHistory.splice(idx, 1);
  save(); closeHistoryModal(); renderGodown(); renderHistory(); toast("Shipment undone — stock restored");
};

window.deleteAllHistory = function () {
  if (shipmentHistory.length === 0) return;
  if (!confirm(`Delete ALL ${shipmentHistory.length} shipment record(s)?\n\nGodown stock will NOT be restored.\nUse "Undo shipment" on each record first if you want stock back.`)) return;
  shipmentHistory = [];
  save(); renderHistory(); toast("All history deleted");
};

/* ============================================================
   NAVIGATION & UTIL
   ============================================================ */
window.showPage = function (page, button) {
  document.getElementById("data").classList.toggle("hidden", page !== "data");
  document.getElementById("update").classList.toggle("hidden", page !== "update");
  document.getElementById("godown").classList.toggle("hidden", page !== "godown");
  document.querySelectorAll(".tabs button").forEach(b => b.classList.remove("active"));
  if (button) button.classList.add("active");
};

function escapeHTML(str) {
  return String(str).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(str) { return escapeHTML(str).replace(/`/g, "&#96;"); }

function populatePackUnitSelects() {
  const opts = `<option value="">— none —</option>` + UNITS.map(u => `<option value="${u}">${u}</option>`).join("");
  const el = document.getElementById("godownPackUnit");
  if (el) el.innerHTML = opts;
}

/* ============================================================
   INIT
   ============================================================ */
applyTheme(currentTheme);
populatePackUnitSelects();

function render() {
  renderDays();
  renderCatalog();
  renderUpdate();
  renderGodown();
  renderShipment();
  renderHistory();
}

(async () => {
  await loadStockFromFirebase();
  render();

  onSnapshot(DOC_REF, (snap) => {
    if (!snap.exists()) return;
    const incoming = sanitizeStock(snap.data());
    const incomingBundle = {
      ...incoming,
      shipment: incoming.shipment || [],
      shipmentMeta: incoming.shipmentMeta || {},
      shipmentHistory: incoming.shipmentHistory || []
    };
    if (JSON.stringify(incomingBundle) !== JSON.stringify({
      ...stock, shipment, shipmentMeta, shipmentHistory
    })) {
      stock = incoming;
      shipment = stock.shipment || [];
      shipmentMeta = stock.shipmentMeta || { supplier: "", date: "", notes: "" };
      shipmentHistory = stock.shipmentHistory || [];
      render();
    }
  });
})();
