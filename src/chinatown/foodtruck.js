// Food truck / mobile stall — a visual landmark near the player's starting area.
// Inspired by the concept art: stainless steel cart body, canopy with wok+sunburst sign,
// exhaust duct, red gas canisters, wheels, counter-top props (wok, pots, bowls).
//
// Pure decoration: does not affect navigation or gameplay. run.js calls createFoodtruck(G)
// once; it returns { group, dispose }.
//
// ⚠️  Does NOT import three — uses G.THREE exclusively (see delivery.js lesson).

import { RUN } from "./runtune.js";

/** Position of the food truck in world space (near the first supply site / spawn). */
const POS = { x: -24, y: 0, z: 5 };
const YAW = 0.3; // slight rotation so it looks natural

export function createFoodtruck(G) {
  const T = G.THREE;
  const root = new T.Group();
  root.name = "foodtruck";

  // ── materials ──
  const steel = new T.MeshStandardMaterial({
    color: 0x888888,
    roughness: 0.35,
    metalness: 0.7,
  });
  const steelDark = new T.MeshStandardMaterial({
    color: 0x555555,
    roughness: 0.4,
    metalness: 0.6,
  });
  const red = new T.MeshStandardMaterial({
    color: 0xcc2222,
    roughness: 0.5,
    metalness: 0.3,
  });
  const white = new T.MeshStandardMaterial({
    color: 0xeeeeee,
    roughness: 0.6,
    metalness: 0.1,
  });
  const orange = new T.MeshStandardMaterial({
    color: 0xf5a623,
    roughness: 0.5,
    metalness: 0.1,
    emissive: 0xf5a623,
    emissiveIntensity: 0.15,
  });
  const dark = new T.MeshStandardMaterial({
    color: 0x222222,
    roughness: 0.8,
    metalness: 0.1,
  });
  const wood = new T.MeshStandardMaterial({
    color: 0x8b6914,
    roughness: 0.75,
    metalness: 0.0,
  });

  const m = (geo, mat) => {
    const mesh = new T.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    root.add(mesh);
    return mesh;
  };

  // ── cart body (stainless steel box) ──
  const bodyW = 2.4,
    bodyH = 1.0,
    bodyD = 1.2;
  const body = m(new T.BoxGeometry(bodyW, bodyH, bodyD), steel);
  body.position.set(0, bodyH / 2 + 0.35, 0);

  // counter-top surface (slightly wider, thin)
  const counter = m(
    new T.BoxGeometry(bodyW + 0.1, 0.04, bodyD + 0.1),
    steelDark,
  );
  counter.position.set(0, bodyH + 0.35 + 0.02, 0);

  // ── red/white warning stripes (front & back) ──
  const stripeGeo = new T.BoxGeometry(bodyW + 0.02, 0.08, 0.02);
  for (const zOff of [bodyD / 2 + 0.01, -(bodyD / 2 + 0.01)]) {
    const s1 = m(stripeGeo, red);
    s1.position.set(0, 0.55, zOff);
    const s2 = m(stripeGeo, white);
    s2.position.set(0, 0.65, zOff);
  }

  // ── wheels (4 cylinders) ──
  const wheelGeo = new T.CylinderGeometry(0.15, 0.15, 0.08, 10);
  const wheelPositions = [
    [-bodyW / 2 + 0.2, 0.15, bodyD / 2 + 0.05],
    [-bodyW / 2 + 0.2, 0.15, -(bodyD / 2 + 0.05)],
    [bodyW / 2 - 0.2, 0.15, bodyD / 2 + 0.05],
    [bodyW / 2 - 0.2, 0.15, -(bodyD / 2 + 0.05)],
  ];
  for (const [wx, wy, wz] of wheelPositions) {
    const w = m(wheelGeo, dark);
    w.position.set(wx, wy, wz);
    w.rotation.x = Math.PI / 2;
  }

  // ── canopy frame (4 vertical poles + top bars) ──
  const canopyH = 1.4;
  const poleGeo = new T.CylinderGeometry(0.025, 0.025, canopyH, 6);
  const canopyBase = bodyH + 0.37;
  const poles = [
    [-bodyW / 2 + 0.05, canopyBase + canopyH / 2, bodyD / 2],
    [bodyW / 2 - 0.05, canopyBase + canopyH / 2, bodyD / 2],
    [-bodyW / 2 + 0.05, canopyBase + canopyH / 2, -bodyD / 2],
    [bodyW / 2 - 0.05, canopyBase + canopyH / 2, -bodyD / 2],
  ];
  for (const [px, py, pz] of poles) {
    const p = m(poleGeo, steelDark);
    p.position.set(px, py, pz);
  }

  // canopy roof (flat box)
  const roofY = canopyBase + canopyH + 0.02;
  const roof = m(new T.BoxGeometry(bodyW + 0.2, 0.04, bodyD + 0.3), steelDark);
  roof.position.set(0, roofY, 0);

  // ── signboard on canopy front (sunburst orange background) ──
  const signW = 1.6,
    signH = 0.5;
  const sign = m(new T.BoxGeometry(signW, signH, 0.04), orange);
  sign.position.set(0, roofY - 0.02 - signH / 2, bodyD / 2 + 0.17);

  // wok silhouette on sign (dark half sphere)
  const wokSign = m(
    new T.SphereGeometry(0.15, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.5),
    dark,
  );
  wokSign.position.set(0, roofY - signH / 2 - 0.02, bodyD / 2 + 0.19);
  wokSign.rotation.x = Math.PI; // upside down = wok

  // ── exhaust duct (curved pipe from back to above canopy) ──
  // Approximate with a vertical cylinder + angled top piece
  const ductGeo = new T.CylinderGeometry(0.08, 0.08, 1.2, 8);
  const duct = m(ductGeo, steelDark);
  duct.position.set(bodyW / 2 - 0.15, canopyBase + 0.6, -(bodyD / 2 - 0.1));

  // duct elbow (horizontal piece at top)
  const elbowGeo = new T.CylinderGeometry(0.08, 0.08, 0.3, 8);
  const elbow = m(elbowGeo, steelDark);
  elbow.position.set(bodyW / 2 - 0.15, canopyBase + 1.25, -(bodyD / 2 + 0.05));
  elbow.rotation.x = Math.PI / 2;

  // exhaust fan disc (visual)
  const fanGeo = new T.CylinderGeometry(0.12, 0.12, 0.04, 8);
  const fan = m(fanGeo, dark);
  fan.position.set(bodyW / 2 - 0.15, canopyBase + 1.25, -(bodyD / 2 + 0.22));
  fan.rotation.x = Math.PI / 2;

  // ── red gas canister (side of cart) ──
  const canisterGeo = new T.CylinderGeometry(0.12, 0.12, 0.5, 10);
  const canister = m(canisterGeo, red);
  canister.position.set(-(bodyW / 2 + 0.18), 0.6, 0);

  // canister cap
  const capGeo = new T.CylinderGeometry(0.06, 0.08, 0.06, 8);
  const cap = m(capGeo, steelDark);
  cap.position.set(-(bodyW / 2 + 0.18), 0.88, 0);

  // second smaller canister
  const canister2 = m(new T.CylinderGeometry(0.09, 0.09, 0.4, 8), red);
  canister2.position.set(-(bodyW / 2 + 0.18), 0.55, 0.28);
  const cap2 = m(new T.CylinderGeometry(0.05, 0.06, 0.05, 6), steelDark);
  cap2.position.set(-(bodyW / 2 + 0.18), 0.78, 0.28);

  // ── counter-top props ──
  // wok (half sphere, dark)
  const wokGeo = new T.SphereGeometry(
    0.18,
    10,
    5,
    0,
    Math.PI * 2,
    0,
    Math.PI * 0.55,
  );
  const wok = m(wokGeo, dark);
  wok.position.set(-0.5, bodyH + 0.42, 0.1);
  wok.rotation.x = Math.PI; // upside down = wok shape

  // wok handle
  const handleGeo = new T.CylinderGeometry(0.015, 0.015, 0.3, 4);
  const handle = m(handleGeo, wood);
  handle.position.set(-0.5, bodyH + 0.42, 0.32);
  handle.rotation.x = Math.PI / 2;

  // big pot (cylinder)
  const potGeo = new T.CylinderGeometry(0.12, 0.1, 0.2, 8);
  const pot = m(potGeo, steelDark);
  pot.position.set(0.2, bodyH + 0.47, -0.1);

  // stack of bowls (a few thin discs)
  for (let i = 0; i < 4; i++) {
    const bowl = m(new T.CylinderGeometry(0.08, 0.06, 0.025, 8), white);
    bowl.position.set(0.7, bodyH + 0.39 + i * 0.028, 0.2);
  }

  // condiment jars (small cylinders)
  const jarGeo = new T.CylinderGeometry(0.04, 0.04, 0.1, 6);
  for (let i = 0; i < 3; i++) {
    const c = i === 0 ? red : i === 1 ? orange : dark;
    const jar = m(jarGeo, c);
    jar.position.set(0.4 + i * 0.12, bodyH + 0.43, -0.3);
  }

  // stacked food containers (bento boxes)
  for (let i = 0; i < 3; i++) {
    const bento = m(new T.BoxGeometry(0.14, 0.06, 0.1), white);
    bento.position.set(-0.9, bodyH + 0.4 + i * 0.065, 0.15);
  }

  // ── warm glow light under canopy ──
  const glow = new T.PointLight(0xffaa44, 1.2, 6);
  glow.position.set(0, canopyBase + canopyH * 0.6, 0);
  root.add(glow);

  // ── position in world ──
  // Try to place at ground level
  let groundY = 0;
  try {
    if (G.physics && G.physics.groundHeight) {
      groundY = G.physics.groundHeight(POS.x, POS.z, 2) || 0;
    }
  } catch {
    groundY = 0;
  }
  root.position.set(POS.x, groundY, POS.z);
  root.rotation.y = YAW;
  G.scene.add(root);

  return {
    group: root,
    dispose() {
      G.scene.remove(root);
      root.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
          if (child.material.dispose) child.material.dispose();
        }
      });
    },
  };
}
