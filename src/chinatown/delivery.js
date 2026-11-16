// Delivery rider NPC and gold-coin economy for the run.
//
// A rider arrives after every dish is packed: it enters from a street edge on a bright-
// yellow electric scooter, dismounts near the stove, walks through the zombie crowd to
// pick up the order, collects it (+30 coins), then rides away safely. The player must
// protect the rider from zombies (each bite costs a point of rider HP; 30 bites kill it
// → -50 coins) and must not shoot the rider (each bullet -1 HP = -10 coins; headshot
// kills = -100 coins).
//
// Zombies gain +5 coins per kill.
//
// The rider is a rabbit-helmet delivery guy (programmatic geometry). The scooter is a
// bright-yellow electric moped (body + handlebars + seat + wheels). Navigation uses the
// game's existing A* grid.
//
// This module is self-contained: run.js calls createDelivery(G) once, then
//   delivery.spawn(stovePos)   — after a dish is packed (serve)
//   delivery.update(dt)        — every frame from the run's update
//   delivery.onBulletHit(e)    — wired to player:hitEnemy when the target is a rider
//   delivery.reset()           — on run reset
//   delivery.stop()            — on run stop
//   delivery.money             — current coin balance (read/write)
//
// Pure data lives in RUN.delivery (runtune.js).

import * as L10N from "../i18n/index.js";
import { RUN } from "./runtune.js";

// ── rider states ──
const STATE = {
  IDLE: "idle", // not active
  RIDE_IN: "rideIn", // on scooter heading to dismount point
  WALK: "walk", // on foot navigating to stove
  PICKUP: "pickup", // at stove, picking up the order
  RIDE_OUT: "rideOut", // on scooter leaving
  DEAD: "dead", // killed (by player or zombies)
};

export function createDelivery(G, { toast } = {}) {
  const T = G.THREE;
  const V3 = T.Vector3;
  const nav = G.physics && G.physics.nav;
  const D = RUN.delivery;

  // ── coin balance ──
  let money = 0;

  // ── rider pool (one rider at a time for MVP) ──
  const riders = []; // active rider objects

  // ── colours ──
  const YELLOW = 0xf5a623; // delivery brand yellow
  const YELLOW_BRIGHT = 0xffcc00;
  const DARK = 0x222222;
  const SKIN = 0xffddaa;
  const GREY = 0x444444;
  // ── build the yellow electric scooter / moped ──
  // Called once per rider spawn; returns a T.Group that is toggled visible during
  // rideIn / rideOut and hidden while walking.
  function buildScooter() {
    const sg = new T.Group();
    sg.name = "delivery-scooter";

    const sm = (geo, mat, x, y, z) => {
      const mesh = new T.Mesh(geo, mat.clone());
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      sg.add(mesh);
      return mesh;
    };

    // ── main body / frame (tapered box, yellow) ──
    sm(new T.BoxGeometry(0.32, 0.28, 1.1), matYellow, 0, 0.38, 0);

    // front fairing (narrower wedge in front)
    sm(new T.BoxGeometry(0.24, 0.35, 0.3), matYellow, 0, 0.42, 0.58);

    // footboard / running board (flat dark plate under rider's feet)
    sm(new T.BoxGeometry(0.38, 0.04, 0.5), matDark, 0, 0.22, 0.05);

    // ── seat (dark cushion on top of body) ──
    sm(new T.BoxGeometry(0.26, 0.08, 0.45), matDark, 0, 0.56, -0.12);
    // seat back rest (small bump)
    sm(new T.BoxGeometry(0.22, 0.12, 0.06), matDark, 0, 0.62, -0.37);

    // ── rear cargo rack / flat platform for the delivery box ──
    sm(new T.BoxGeometry(0.34, 0.03, 0.3), matGrey, 0, 0.52, -0.52);

    // ── wheels (two, front and rear) ──
    const wheelGeo = new T.TorusGeometry(0.16, 0.05, 8, 16);
    const hubGeo = new T.CylinderGeometry(0.04, 0.04, 0.1, 8);
    // front wheel
    const frontWheel = sm(wheelGeo, matDark, 0, 0.16, 0.62);
    frontWheel.rotation.y = Math.PI / 2;
    const fh = sm(hubGeo, matGrey, 0, 0.16, 0.62);
    fh.rotation.z = Math.PI / 2;
    // rear wheel
    const rearWheel = sm(wheelGeo, matDark, 0, 0.16, -0.52);
    rearWheel.rotation.y = Math.PI / 2;
    const rh = sm(hubGeo, matGrey, 0, 0.16, -0.52);
    rh.rotation.z = Math.PI / 2;

    // front fork (two thin cylinders from body down to front wheel axle)
    const forkGeo = new T.CylinderGeometry(0.018, 0.018, 0.38, 5);
    const lfork = sm(forkGeo, matGrey, -0.08, 0.3, 0.58);
    lfork.rotation.x = 0.25;
    const rfork = sm(forkGeo, matGrey, 0.08, 0.3, 0.58);
    rfork.rotation.x = 0.25;

    // ── handlebars (horizontal bar + two grips) ──
    sm(new T.CylinderGeometry(0.015, 0.015, 0.42, 5), matGrey, 0, 0.6, 0.55);
    // rotate to horizontal
    sg.children[sg.children.length - 1].rotation.z = Math.PI / 2;
    // grips (dark, at ends of handlebar)
    sm(
      new T.CylinderGeometry(0.022, 0.022, 0.08, 5),
      matDark,
      -0.22,
      0.6,
      0.55,
    );
    sg.children[sg.children.length - 1].rotation.z = Math.PI / 2;
    sm(new T.CylinderGeometry(0.022, 0.022, 0.08, 5), matDark, 0.22, 0.6, 0.55);
    sg.children[sg.children.length - 1].rotation.z = Math.PI / 2;

    // ── headlight (small bright disc on front) ──
    const hlMat = new T.MeshStandardMaterial({
      color: 0xffffcc,
      emissive: 0xffffcc,
      emissiveIntensity: 0.5,
      roughness: 0.3,
    });
    sm(new T.CylinderGeometry(0.05, 0.05, 0.03, 8), hlMat, 0, 0.48, 0.74);
    sg.children[sg.children.length - 1].rotation.x = Math.PI / 2;

    // ── tail light (small red on rear) ──
    const tlMat = new T.MeshStandardMaterial({
      color: 0xcc2222,
      emissive: 0xcc2222,
      emissiveIntensity: 0.4,
      roughness: 0.4,
    });
    sm(new T.CylinderGeometry(0.03, 0.03, 0.02, 6), tlMat, 0, 0.42, -0.68);
    sg.children[sg.children.length - 1].rotation.x = Math.PI / 2;

    // ── yellow side panels / brand accent ──
    sm(new T.BoxGeometry(0.02, 0.18, 0.5), matYellowBright, -0.17, 0.4, 0);
    sm(new T.BoxGeometry(0.02, 0.18, 0.5), matYellowBright, 0.17, 0.4, 0);

    // ── rear mud-guard (small arc behind rear wheel) ──
    sm(new T.BoxGeometry(0.28, 0.03, 0.2), matYellow, 0, 0.33, -0.58);

    // ── rear delivery box (insulated food container on cargo rack) ──
    // main box body (yellow with dark border)
    sm(new T.BoxGeometry(0.44, 0.38, 0.36), matYellow, 0, 0.76, -0.52);
    // lid (slightly wider, thin)
    sm(new T.BoxGeometry(0.46, 0.04, 0.38), matYellowBright, 0, 0.97, -0.52);
    // dark border edges (top & bottom trim)
    sm(new T.BoxGeometry(0.46, 0.025, 0.38), matDark, 0, 0.56, -0.52);
    // vertical dark corner strips
    sm(new T.BoxGeometry(0.025, 0.38, 0.025), matDark, -0.22, 0.76, -0.34);
    sm(new T.BoxGeometry(0.025, 0.38, 0.025), matDark, 0.22, 0.76, -0.34);
    sm(new T.BoxGeometry(0.025, 0.38, 0.025), matDark, -0.22, 0.76, -0.7);
    sm(new T.BoxGeometry(0.025, 0.38, 0.025), matDark, 0.22, 0.76, -0.7);
    // horizontal partition line (suggests compartments inside)
    sm(new T.BoxGeometry(0.4, 0.015, 0.02), matDark, 0, 0.76, -0.33);
    // wok icon on front face (small dark disc + handle)
    const iconMat = new T.MeshStandardMaterial({
      color: DARK,
      roughness: 0.7,
      emissive: 0x111111,
      emissiveIntensity: 0.1,
    });
    const wokIcon = sm(
      new T.SphereGeometry(0.06, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.5),
      iconMat,
      0,
      0.78,
      -0.33,
    );
    wokIcon.rotation.x = Math.PI; // bowl shape
    // tiny handle on wok icon
    sm(
      new T.CylinderGeometry(0.008, 0.008, 0.07, 4),
      iconMat,
      0.08,
      0.78,
      -0.33,
    );
    sg.children[sg.children.length - 1].rotation.z = Math.PI / 2;

    sg._frontWheel = frontWheel;
    sg._rearWheel = rearWheel;
    return sg;
  }

  // ── shared materials (cloned per rider to allow independent colour tweaks) ──
  const matYellow = new T.MeshStandardMaterial({
    color: YELLOW,
    roughness: 0.5,
    metalness: 0.05,
    emissive: YELLOW,
    emissiveIntensity: 0.15,
  });
  const matYellowBright = new T.MeshStandardMaterial({
    color: YELLOW_BRIGHT,
    roughness: 0.4,
    metalness: 0.0,
    emissive: YELLOW_BRIGHT,
    emissiveIntensity: 0.25,
  });
  const matDark = new T.MeshStandardMaterial({
    color: DARK,
    roughness: 0.8,
    metalness: 0.1,
  });
  const matSkin = new T.MeshStandardMaterial({
    color: SKIN,
    roughness: 0.8,
  });
  const matGrey = new T.MeshStandardMaterial({
    color: GREY,
    roughness: 0.7,
    metalness: 0.2,
  });

  // ── build rider geometry group (rabbit-helmet delivery rider) ──
  function buildRiderMesh() {
    const g = new T.Group();
    g.name = "delivery-rider";

    const m = (geo, mat, x, y, z) => {
      const mesh = new T.Mesh(geo, mat.clone());
      mesh.position.set(x, y, z);
      mesh.castShadow = true;
      g.add(mesh);
      return mesh;
    };

    // ── legs (two dark cylinders) ──
    const leftLeg = m(
      new T.CylinderGeometry(0.07, 0.08, 0.7, 6),
      matDark,
      -0.1,
      0.35,
      0,
    );
    const rightLeg = m(
      new T.CylinderGeometry(0.07, 0.08, 0.7, 6),
      matDark,
      0.1,
      0.35,
      0,
    );

    // ── torso (yellow raincoat) ──
    const torso = m(new T.BoxGeometry(0.38, 0.55, 0.28), matYellow, 0, 1.0, 0);

    // ── arms (yellow cylinders, slightly angled) ──
    const armGeo = new T.CylinderGeometry(0.06, 0.06, 0.5, 6);
    const leftArm = m(armGeo, matYellow, -0.26, 0.95, 0);
    leftArm.rotation.z = 0.2;
    const rightArm = m(armGeo, matYellow, 0.26, 0.95, 0);
    rightArm.rotation.z = -0.2;

    // ── delivery box on back (dark box with yellow edges) ──
    const box = m(
      new T.BoxGeometry(0.32, 0.36, 0.28),
      matYellow,
      0,
      1.15,
      -0.28,
    );
    // dark border strip on box
    m(new T.BoxGeometry(0.34, 0.02, 0.3), matDark, 0, 1.34, -0.28);
    m(new T.BoxGeometry(0.34, 0.02, 0.3), matDark, 0, 0.97, -0.28);
    // vertical dark strips on box sides
    m(new T.BoxGeometry(0.02, 0.36, 0.3), matDark, -0.17, 1.15, -0.28);
    m(new T.BoxGeometry(0.02, 0.36, 0.3), matDark, 0.17, 1.15, -0.28);

    // ── neck ──
    m(new T.CylinderGeometry(0.06, 0.07, 0.1, 6), matSkin, 0, 1.33, 0);

    // ── head (skin sphere) ──
    const head = m(new T.SphereGeometry(0.14, 8, 6), matSkin, 0, 1.48, 0);

    // ── HELMET (bright yellow half-sphere + brim) ──
    // half sphere on top of head
    const helmetGeo = new T.SphereGeometry(
      0.17,
      10,
      6,
      0,
      Math.PI * 2,
      0,
      Math.PI * 0.55,
    );
    const helmet = m(helmetGeo, matYellowBright, 0, 1.52, 0);
    // brim
    m(new T.CylinderGeometry(0.19, 0.19, 0.02, 12), matYellowBright, 0, 1.5, 0);
    // chin strap
    m(new T.CylinderGeometry(0.005, 0.005, 0.14, 4), matDark, 0.12, 1.42, 0.05);
    m(
      new T.CylinderGeometry(0.005, 0.005, 0.14, 4),
      matDark,
      -0.12,
      1.42,
      0.05,
    );

    // ── RABBIT EARS (the key identifier!) ──
    // Two tall yellow ear shapes on top of helmet
    const earGeo = new T.CapsuleGeometry(0.035, 0.22, 4, 6);
    const leftEar = m(earGeo, matYellowBright, -0.08, 1.8, -0.02);
    leftEar.rotation.z = 0.12; // slight outward tilt
    leftEar.rotation.x = -0.08;
    const rightEar = m(earGeo, matYellowBright, 0.08, 1.8, -0.02);
    rightEar.rotation.z = -0.12;
    rightEar.rotation.x = -0.08;
    // inner ear (darker tint)
    const innerEarGeo = new T.CapsuleGeometry(0.018, 0.16, 3, 4);
    const liEar = m(innerEarGeo, matSkin, -0.08, 1.8, 0.0);
    liEar.rotation.z = 0.12;
    liEar.rotation.x = -0.08;
    const riEar = m(innerEarGeo, matSkin, 0.08, 1.8, 0.0);
    riEar.rotation.z = -0.12;
    riEar.rotation.x = -0.08;

    // ── visor / goggles line (dark strip across face) ──
    m(new T.BoxGeometry(0.22, 0.04, 0.06), matGrey, 0, 1.5, 0.12);

    // ── shoes (dark boxes at bottom of legs) ──
    m(new T.BoxGeometry(0.09, 0.06, 0.14), matDark, -0.1, 0.03, 0.02);
    m(new T.BoxGeometry(0.09, 0.06, 0.14), matDark, 0.1, 0.03, 0.02);

    return { group: g, head, torso, leftLeg, rightLeg, leftArm, rightArm };
  }

  // head sphere for headshot detection (invisible, kept for raycasting)
  const headGeo = new T.SphereGeometry(0.16, 8, 6);
  const headMat = new T.MeshStandardMaterial({
    color: SKIN,
    roughness: 0.8,
  });

  const root = new T.Group();
  root.name = "delivery-riders";
  G.scene.add(root);

  // ── spawn entry points (street edges, far from player) ──
  const ENTRY_POINTS = [
    new V3(-38, 0, 6),
    new V3(34, 0, 6),
    new V3(-38, 0, -4),
    new V3(34, 0, -4),
  ];

  // ── exit points (same edges) ──
  const EXIT_POINTS = [
    new V3(-42, 0, 6),
    new V3(38, 0, 6),
    new V3(-42, 0, -4),
    new V3(38, 0, -4),
  ];

  function pickEntry(stovePos) {
    // pick the entry point farthest from player but reasonably close to stove
    const ppos = G.player && G.player.pos;
    let best = ENTRY_POINTS[0];
    let bestScore = -Infinity;
    for (const ep of ENTRY_POINTS) {
      const dPlayer = ppos ? Math.hypot(ep.x - ppos.x, ep.z - ppos.z) : 20;
      const dStove = Math.hypot(ep.x - stovePos.x, ep.z - stovePos.z);
      // prefer far from player, but not too far from stove
      const score = dPlayer - dStove * 0.3;
      if (score > bestScore) {
        bestScore = score;
        best = ep;
      }
    }
    return best.clone();
  }

  function pickExit(pos) {
    let best = EXIT_POINTS[0];
    let bestDist = Infinity;
    for (const ep of EXIT_POINTS) {
      const d = Math.hypot(ep.x - pos.x, ep.z - pos.z);
      if (d < bestDist) {
        bestDist = d;
        best = ep;
      }
    }
    return best.clone();
  }

  // ── find a walkable dismount point near the stove ──
  function dismountPoint(stovePos, entryPos) {
    // a point ~4m from the stove in the direction of entry, on the nav grid
    const dir = new V3()
      .subVectors(entryPos, stovePos)
      .setY(0)
      .normalize()
      .multiplyScalar(D.dismountDist);
    const pt = new V3().addVectors(stovePos, dir);
    pt.y = stovePos.y || 0;
    if (nav && nav.isWalkable && !nav.isWalkable(pt.x, pt.z)) {
      // try closer
      pt.lerpVectors(stovePos, pt, 0.5);
    }
    return pt;
  }

  // ── pathfinding wrapper ──
  function findPath(from, to) {
    if (!nav || !nav.findPath) return null;
    try {
      return nav.findPath(from, to);
    } catch {
      return null;
    }
  }

  // ── create a rider object ──
  function createRider(stovePos) {
    const entry = pickEntry(stovePos);
    const dismount = dismountPoint(stovePos, entry);
    const exit = pickExit(dismount);

    // build the detailed rabbit-helmet rider mesh
    const riderMesh = buildRiderMesh();
    const group = riderMesh.group;

    // invisible hit-detection body (used by raycast)
    const body = new T.Mesh(
      new T.BoxGeometry(0.4, 1.0, 0.4),
      new T.MeshBasicMaterial({ visible: false }),
    );
    body.position.y = 0.95;
    group.add(body);

    // invisible vest hitbox (same purpose)
    const vest = new T.Mesh(
      new T.BoxGeometry(0.44, 0.5, 0.44),
      new T.MeshBasicMaterial({ visible: false }),
    );
    vest.position.y = 1.1;
    group.add(vest);

    // invisible head hitbox for headshot detection
    const head = new T.Mesh(
      headGeo,
      new T.MeshBasicMaterial({ visible: false }),
    );
    head.position.y = 1.52;
    group.add(head);

    // electric scooter (bright yellow moped)
    const scooter = buildScooter();
    // position so rider appears to be sitting on the seat
    scooter.position.set(0, 0, 0.1);
    group.add(scooter);

    group.position.copy(entry);
    root.add(group);

    const rider = {
      group,
      body,
      vest,
      head,
      scooter,
      // animation refs
      leftLeg: riderMesh.leftLeg,
      rightLeg: riderMesh.rightLeg,
      leftArm: riderMesh.leftArm,
      rightArm: riderMesh.rightArm,
      frontWheel: scooter._frontWheel,
      rearWheel: scooter._rearWheel,
      animT: 0, // animation time accumulator
      state: STATE.RIDE_IN,
      hp: D.riderHp,
      maxHp: D.riderHp,
      pos: group.position,
      stovePos: stovePos.clone(),
      entry,
      dismount,
      exit,
      path: null,
      pathIdx: 0,
      t: 0,
      pickupT: 0,
      // for zombie targeting
      alive: true,
      // for hit detection (raycasting)
      headPos: new V3(),
      chest: new V3(),
      feet: new V3(),
      radius: 0.3,
    };

    // point toward dismount initially
    const dx = dismount.x - entry.x;
    const dz = dismount.z - entry.z;
    group.rotation.y = Math.atan2(dx, -dz);

    return rider;
  }

  // ── rider movement ──
  function moveToward(rider, target, speed, dt) {
    const dx = target.x - rider.pos.x;
    const dz = target.z - rider.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.15) return true; // arrived
    const step = Math.min(speed * dt, dist);
    rider.pos.x += (dx / dist) * step;
    rider.pos.z += (dz / dist) * step;
    // face movement direction
    rider.group.rotation.y = Math.atan2(dx, -dz);
    return false;
  }

  function followPath(rider, speed, dt) {
    if (!rider.path || rider.pathIdx >= rider.path.length) return true;
    const wp = rider.path[rider.pathIdx];
    const dx = wp.x - rider.pos.x;
    const dz = wp.z - rider.pos.z;
    const dist = Math.hypot(dx, dz);
    if (dist < 0.3) {
      rider.pathIdx++;
      if (rider.pathIdx >= rider.path.length) return true;
      return false;
    }
    const step = Math.min(speed * dt, dist);
    rider.pos.x += (dx / dist) * step;
    rider.pos.z += (dz / dist) * step;
    rider.group.rotation.y = Math.atan2(dx, -dz);
    return false;
  }

  // ── update hit positions (for raycast) ──
  function syncHitPos(rider) {
    rider.headPos.set(rider.pos.x, rider.pos.y + 1.52, rider.pos.z);
    rider.chest.set(rider.pos.x, rider.pos.y + 1.0, rider.pos.z);
    rider.feet.set(rider.pos.x, rider.pos.y, rider.pos.z);
  }

  // ── zombie bite detection ──
  function checkZombieBites(rider, dt) {
    if (!G.enemies || !G.enemies.list) return;
    for (const z of G.enemies.list) {
      if (!z.alive) continue;
      const d = Math.hypot(z.pos.x - rider.pos.x, z.pos.z - rider.pos.z);
      if (d < D.zombieBiteRange) {
        // zombie is close enough to bite
        rider.t += dt;
        if (rider.t >= D.zombieBiteInterval) {
          rider.t -= D.zombieBiteInterval;
          rider.hp -= 1;
          if (rider.hp <= 0) {
            killRider(rider, "zombie");
            return;
          }
        }
        // only the closest zombie bites at a time (simplification)
        break;
      }
    }
  }

  // ── rider takes bullet damage ──
  function bulletHit(rider, isHeadshot) {
    if (!rider.alive) return;
    if (isHeadshot) {
      rider.hp = 0;
      killRider(rider, "headshot");
      return;
    }
    rider.hp -= 1;
    money = Math.max(money + D.penaltyPerShot, 0);
    showToast("delivery.hit", "warn", { n: D.penaltyPerShot });
    if (rider.hp <= 0) {
      killRider(rider, "player");
    }
  }

  function killRider(rider, cause) {
    rider.alive = false;
    rider.state = STATE.DEAD;
    if (cause === "headshot") {
      money = Math.max(money + D.penaltyHeadshot, 0);
      showToast("delivery.headshot", "warn", { n: D.penaltyHeadshot });
    } else if (cause === "zombie") {
      money = Math.max(money + D.penaltyZombieKill, 0);
      showToast("delivery.zombieKill", "warn", { n: D.penaltyZombieKill });
    } else if (cause === "player") {
      // penalty already applied per-shot, plus the death penalty
      money = Math.max(
        money + D.penaltyHeadshot - D.penaltyPerShot * D.riderHp,
        0,
      );
      showToast("delivery.killed", "warn", { n: D.penaltyHeadshot });
    }
    // visual: rider falls
    rider.group.rotation.x = Math.PI / 2;
    rider.group.position.y -= 0.5;
    // remove after a delay
    rider.removeT = 3;
  }

  function showToast(key, kind, vars) {
    if (toast) toast(L10N.t(key, vars), kind);
  }

  // ── procedural animation for walk (legs/arms swing) and ride (wheel rotation) ──
  function animateRider(rider, dt) {
    rider.animT += dt;
    const t = rider.animT;
    if (rider.state === STATE.WALK || rider.state === STATE.PICKUP) {
      // walking: legs swing forward/back, arms swing opposite
      const freq = 6; // swing frequency
      const legAmp = 0.5; // radians
      const armAmp = 0.35;
      const swing = Math.sin(t * freq);
      if (rider.leftLeg) rider.leftLeg.rotation.x = swing * legAmp;
      if (rider.rightLeg) rider.rightLeg.rotation.x = -swing * legAmp;
      if (rider.leftArm) rider.leftArm.rotation.x = -swing * armAmp;
      if (rider.rightArm) rider.rightArm.rotation.x = swing * armAmp;
    } else {
      // reset limbs when not walking
      if (rider.leftLeg) rider.leftLeg.rotation.x = 0;
      if (rider.rightLeg) rider.rightLeg.rotation.x = 0;
      if (rider.leftArm) rider.leftArm.rotation.x = 0;
      if (rider.rightArm) rider.rightArm.rotation.x = 0;
    }
    if (rider.state === STATE.RIDE_IN || rider.state === STATE.RIDE_OUT) {
      // wheel rotation based on scooter speed
      const wheelSpeed = D.scooterSpeed * 3; // visual rotation speed (rad/s)
      if (rider.frontWheel) rider.frontWheel.rotation.x += wheelSpeed * dt;
      if (rider.rearWheel) rider.rearWheel.rotation.x += wheelSpeed * dt;
    }
  }

  // ── per-frame update for one rider ──
  function updateRider(rider, dt) {
    if (!rider.alive && rider.state === STATE.DEAD) {
      rider.removeT -= dt;
      if (rider.removeT <= 0) {
        root.remove(rider.group);
        const idx = riders.indexOf(rider);
        if (idx >= 0) riders.splice(idx, 1);
      }
      return;
    }

    syncHitPos(rider);
    animateRider(rider, dt);

    switch (rider.state) {
      case STATE.RIDE_IN: {
        rider.scooter.visible = true;
        const arrived = moveToward(rider, rider.dismount, D.scooterSpeed, dt);
        if (arrived) {
          rider.state = STATE.WALK;
          rider.scooter.visible = false;
          // compute walking path to stove
          rider.path = findPath(rider.pos, rider.stovePos);
          rider.pathIdx = 0;
        }
        // While riding in, zombies don't really target the scooter (simplification)
        break;
      }

      case STATE.WALK: {
        // walk toward stove through zombies
        let arrived;
        if (rider.path && rider.path.length > 0) {
          arrived = followPath(rider, D.walkSpeed, dt);
        } else {
          // fallback: direct walk
          arrived = moveToward(rider, rider.stovePos, D.walkSpeed, dt);
        }
        // check zombie bites while walking
        checkZombieBites(rider, dt);
        if (!rider.alive) return;
        if (arrived) {
          rider.state = STATE.PICKUP;
          rider.pickupT = 0;
        }
        break;
      }

      case STATE.PICKUP: {
        rider.pickupT += dt;
        // check zombie bites while picking up
        checkZombieBites(rider, dt);
        if (!rider.alive) return;
        if (rider.pickupT >= D.pickupTime) {
          // success! coins earned
          money += D.deliveryReward;
          showToast("delivery.success", "gold", { n: D.deliveryReward });
          // transition to ride out
          rider.state = STATE.RIDE_OUT;
          rider.scooter.visible = true;
          // safe once picked up - no more damage
          rider.alive = false; // can't be hit anymore
        }
        break;
      }

      case STATE.RIDE_OUT: {
        rider.scooter.visible = true;
        const gone = moveToward(rider, rider.exit, D.scooterSpeed, dt);
        if (gone) {
          root.remove(rider.group);
          const idx = riders.indexOf(rider);
          if (idx >= 0) riders.splice(idx, 1);
        }
        break;
      }
    }
  }

  // ── make zombies target the rider ──
  // Each frame, nearby idle/wandering zombies may switch to targeting the rider
  function attractZombies(rider) {
    if (!rider.alive || rider.state === STATE.RIDE_IN) return;
    if (!G.enemies || !G.enemies.list) return;
    for (const z of G.enemies.list) {
      if (!z.alive || z.target) continue;
      const d = Math.hypot(z.pos.x - rider.pos.x, z.pos.z - rider.pos.z);
      if (d < D.zombieAggroRange) {
        // make zombie aware of rider (it will come closer)
        // We can't set z.target directly (that's the player),
        // but we can un-dull them so they at least move toward something
        if (z.dull) z.dull = false;
      }
    }
  }

  // ── raycast: check if a ray hits any rider ──
  // Returns { rider, headshot } or null
  function raycast(origin, direction, maxDist) {
    const ray = new T.Raycaster(origin, direction, 0, maxDist || 100);
    for (const rider of riders) {
      if (!rider.alive) continue;
      // check head first (smaller target, headshot)
      const headHits = ray.intersectObject(rider.head, false);
      if (headHits.length > 0) {
        return { rider, headshot: true, distance: headHits[0].distance };
      }
      // check body + vest
      const bodyHits = ray.intersectObjects([rider.body, rider.vest], false);
      if (bodyHits.length > 0) {
        return { rider, headshot: false, distance: bodyHits[0].distance };
      }
    }
    return null;
  }

  // ── public API ──
  const api = {
    get money() {
      return money;
    },
    set money(v) {
      money = v;
    },

    get riders() {
      return riders;
    },

    /** Spawn a rider heading for the given stove position. */
    spawn(stovePos) {
      if (!stovePos) return;
      const rider = createRider(stovePos);
      riders.push(rider);
    },

    /** Per-frame update, called from run.js update. */
    update(dt) {
      for (let i = riders.length - 1; i >= 0; i--) {
        const rider = riders[i];
        updateRider(rider, dt);
        if (rider.alive) attractZombies(rider);
      }
    },

    /** Check if a weapon ray hits any rider. Returns { rider, headshot } or null. */
    raycast,

    /** Apply bullet damage to a rider. */
    bulletHit(rider, isHeadshot) {
      bulletHit(rider, isHeadshot);
    },

    /** Called when a zombie is killed - add coins. */
    onZombieKill() {
      money += D.zombieKillReward;
    },

    /** Reset for a new run. */
    reset() {
      for (const r of riders) root.remove(r.group);
      riders.length = 0;
      money = 0;
    },

    /** Clean up on run stop. */
    stop() {
      for (const r of riders) root.remove(r.group);
      riders.length = 0;
    },
  };

  return api;
}
