// Upgrade shop — an HTML overlay panel toggled with the B key.
//
// Three upgrades purchasable with gold coins:
//   🔥 Wok Hei (damage multiplier)  — RUN.shop.wok   coins
//   🔫 Ammo Cache (ammo cap bonus)  — RUN.shop.ammo  coins
//   🛡 Shield (temp HP bonus)        — RUN.shop.shield coins
//
// MVP: purchases deduct coins and set a flag / multiplier that run.js can read.
// The panel is pure DOM, styled with .rl-shop-* classes in style.css.
// Opened/closed by B key; pointer is freed while open.
//
// ⚠️  Does NOT import three — only needs G for events / input / pointer lock.

import * as L10N from "../i18n/index.js";
import { RUN } from "./runtune.js";

export function createShop(G, { getMoney, setMoney, toast, onPurchase }) {
  const SH = RUN.shop;

  // ── state ──
  const bought = { wok: 0, ammo: 0, shield: 0 }; // purchase count (0 or 1 for MVP)
  let open = false;

  // ── DOM ──
  const ui = document.getElementById("ui");
  const root = document.createElement("div");
  root.className = "rl-shop";
  root.setAttribute("aria-hidden", "true");

  // title
  const title = document.createElement("div");
  title.className = "rl-shop-title";
  root.appendChild(title);

  // items container
  const list = document.createElement("div");
  list.className = "rl-shop-list";
  root.appendChild(list);

  // hint at bottom
  const hint = document.createElement("div");
  hint.className = "rl-shop-hint";
  root.appendChild(hint);

  const items = [
    {
      id: "wok",
      icon: "🔥",
      cost: SH.wok,
      key: "shop.wok",
      descKey: "shop.wok.d",
    },
    {
      id: "ammo",
      icon: "🔫",
      cost: SH.ammo,
      key: "shop.ammo",
      descKey: "shop.ammo.d",
    },
    {
      id: "shield",
      icon: "🛡",
      cost: SH.shield,
      key: "shop.shield",
      descKey: "shop.shield.d",
    },
  ];

  const rows = [];
  for (const it of items) {
    const row = document.createElement("div");
    row.className = "rl-shop-row";

    const icon = document.createElement("span");
    icon.className = "rl-shop-icon";
    icon.textContent = it.icon;

    const info = document.createElement("div");
    info.className = "rl-shop-info";

    const name = document.createElement("span");
    name.className = "rl-shop-name";

    const desc = document.createElement("span");
    desc.className = "rl-shop-desc";

    info.appendChild(name);
    info.appendChild(desc);

    const price = document.createElement("button");
    price.className = "rl-shop-buy";

    price.addEventListener("click", () => {
      if (bought[it.id]) return;
      const m = getMoney();
      if (m < it.cost) {
        if (toast) toast(L10N.t("shop.poor"), "warn");
        return;
      }
      setMoney(m - it.cost);
      bought[it.id] = 1;
      if (toast) toast(L10N.t(it.key) + " ✓", "gold");
      if (onPurchase) onPurchase(it.id, bought);
      refresh();
    });

    row.appendChild(icon);
    row.appendChild(info);
    row.appendChild(price);
    list.appendChild(row);
    rows.push({
      el: row,
      nameEl: name,
      descEl: desc,
      priceEl: price,
      item: it,
    });
  }

  ui.appendChild(root);

  function refresh() {
    title.textContent = L10N.t("shop.title");
    hint.textContent = L10N.t("shop.hint");
    const m = getMoney();
    for (const r of rows) {
      r.nameEl.textContent = L10N.t(r.item.key);
      r.descEl.textContent = L10N.t(r.item.descKey);
      const done = bought[r.item.id];
      if (done) {
        r.priceEl.textContent = "✓";
        r.priceEl.disabled = true;
        r.el.classList.add("bought");
      } else {
        r.priceEl.textContent = "¥" + r.item.cost;
        r.priceEl.disabled = m < r.item.cost;
        r.el.classList.toggle("poor", m < r.item.cost);
        r.el.classList.remove("bought");
      }
    }
  }

  function show(v) {
    open = v;
    root.classList.toggle("open", v);
    root.setAttribute("aria-hidden", v ? "false" : "true");
    if (v) {
      refresh();
      // release pointer so player can click buttons
      try {
        if (document.pointerLockElement) document.exitPointerLock();
      } catch {
        /* ok */
      }
    }
  }

  function toggle() {
    show(!open);
  }

  // ── B key listener ──
  function onKey(e) {
    if (
      e.code === "KeyB" &&
      !e.repeat &&
      !e.ctrlKey &&
      !e.altKey &&
      !e.metaKey
    ) {
      // don't toggle if the player is in a menu/pick/ticket screen
      // (checked by caller via isActive, but guard here too)
      toggle();
    }
  }
  document.addEventListener("keydown", onKey);

  return {
    get open() {
      return open;
    },
    get bought() {
      return { ...bought };
    },
    show,
    toggle,
    refresh,
    /** Reset purchases for a new run. */
    reset() {
      bought.wok = 0;
      bought.ammo = 0;
      bought.shield = 0;
      show(false);
    },
    /** Clean up. */
    dispose() {
      document.removeEventListener("keydown", onKey);
      if (root.parentNode) root.parentNode.removeChild(root);
    },
  };
}
