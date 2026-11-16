// Delivery rider NPC and gold-coin economy for the run.
//
// A rider arrives after every dish is packed: it enters from a street edge on a scooter,
// dismounts near the stove, walks through the zombie crowd to pick up the order, collects
// it (+30 coins), then rides away safely. The player must protect the rider from zombies
// (each bite costs a point of rider HP; 30 bites kill it → -50 coins) and must not shoot
// the rider (each bullet -1 HP = -10 coins; headshot kills = -100 coins).
//
// Zombies gain +5 coins per kill.
//
// The rider reuses a zombie body mesh for MVP (no custom model yet). The scooter is a
// simple box geometry placeholder. Navigation uses the game's existing A* grid.
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

import * as THREE from "three";
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
  const T = G.THREE || THREE;
  const V3 = T.Vector3;
  const nav = G.physics && G.physics.nav;
  const D = RUN.delivery;

  // ── coin balance ──
  let money = 0;

  // ── rider pool (one rider at a time for MVP) ──
  const riders = []; // active rider objects

  // ── scooter placeholder geometry ──
  const scooterGeo = new T.BoxGeometry(0.5, 0.8, 1.6);
  const scooterMat = new T.MeshStandardMaterial({
    color: 0x2288aa,
    roughness: 0.6,
    metalness: 0.3,
  });

  // ── rider body: borrow a zombie-like capsule/box for hit detection ──
  // For MVP we create a simple humanoid placeholder (coloured box-man).
  const riderGeo = new T.BoxGeometry(0.4, 1.6, 0.4);
  const riderMat = new T.MeshStandardMaterial({
    color: 0x33cc66,
    roughness: 0.7,
    metalness: 0.1,
  });
  // Bright vest on the rider so player can tell them apart
  const vestGeo = new T.BoxGeometry(0.44, 0.5, 0.44);
  const vestMat = new T.MeshStandardMaterial({
    color: 0xffcc00,
    roughness: 0.5,
    metalness: 0.0,
    emissive: 0xffcc00,
    emissiveIntensity: 0.3,
  });

  // head sphere for headshot detection
  const headGeo = new T.SphereGeometry(0.16, 8, 6);
  const headMat = new T.MeshStandardMaterial({
    color: 0xffddaa,
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

    const group = new T.Group();
    group.name = "delivery-rider";

    // body
    const body = new T.Mesh(riderGeo, riderMat.clone());
    body.position.y = 0.8;
    body.castShadow = true;
    group.add(body);

    // vest (high-vis)
    const vest = new T.Mesh(vestGeo, vestMat.clone());
    vest.position.y = 1.05;
    vest.castShadow = true;
    group.add(vest);

    // head
    const head = new T.Mesh(headGeo, headMat.clone());
    head.position.y = 1.72;
    head.castShadow = true;
    group.add(head);

    // scooter
    const scooter = new T.Mesh(scooterGeo, scooterMat.clone());
    scooter.position.y = 0.4;
    scooter.castShadow = true;
    group.add(scooter);

    group.position.copy(entry);
    root.add(group);

    const rider = {
      group,
      body,
      vest,
      head,
      scooter,
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
    rider.headPos.set(rider.pos.x, rider.pos.y + 1.72, rider.pos.z);
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
