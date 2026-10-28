# The Fatal Mistake

A client-side 3D bedroom tycoon and adventure game about FatalMistake02, catastrophic hardware procurement, and eventually making Mira.

## Play

Open **index.html** in a current browser with WebGL enabled. There is no installation, build step, CDN, server component, or account. Keep the files together, including the supplied **FatalMistake02.png** and **mira.png** images.

The game uses a small native WebGL renderer with smooth spheres, rounded boxes, lighting, fog, textured computer screens, and perspective cameras. It does not require an external engine. Browser storage behavior for local files varies; save export is available in Settings when persistence is unavailable or when moving between browsers.

## Controls

- **WASD / arrow keys:** move; A/D steer in the courier quest.
- **Space:** jump in the platformer, hop in the courier quest, slash in the duel, or hold to fire in survival.
- **Shift:** dodge in combat, crouch in stealth, brake while delivering.
- **E:** interact with shrines, cabinets, beacons, and exits.
- **D / F / J / K:** rhythm lanes; on-screen buttons also work.
- **Escape:** pause/settings, including during puzzles and rhythm.
- **Space / Enter during the opening:** advance the current scene.

Touch controls appear on devices reporting a coarse pointer. ACT has the same contextual behavior as Space. Dragging the camera is not required.

## Campaign

The twelve projects are Cardly, Rin, Rubber Duck Radio, Riya, Null Garden, Tab Tavern, Commit Kitchen, Cloudberry, README Realty, Sock Market, Checkmate Probably, and Mira. The chess bot is deliberately the second-to-last project and fails its tournament. Mira is the ending.

The eight expeditions are:

1. Woodland exploration, a Codex-versus-Copilot turn-based battle, and a sword duel against Xavier.
2. Magnetic charger platforming, with checkpoints.
3. Office stealth with access cards, patrol vision, cover, and crouching.
4. Three solvable Lights Out circuit boards with a real hint solver.
5. A four-lane cooling-fan rhythm performance.
6. A hover-courier highway with steering, hopping, boosting, and parcel integrity.
7. A timed arena with pop-ups, projectiles, dashes, hazards, and cancellation keys.
8. A constellation archive with ordered exploration and beacon questions.

There are 24 lore entries. Exploration quests have optional collectible sparks; circuit and rhythm quests award their entries on completion. Completed quests can be replayed free.

Normal project work totals 16,860 base seconds before hardware, workstation, design, and focus modifiers. Normal pace is intended to produce a roughly **3–5 hour campaign**, including expeditions; actual duration depends on reviews, upgrades, offline time, and play style. This is a balancing estimate, not a playtested duration. Story pace multiplies development and income by four without accelerating movement or rhythm timings.

Projects build automatically after being started. Optional, project-specific code reviews grant focus and small cash rewards. Each project also has a design milestone choosing greater recurring income or a shorter build. Launches require a click, so offline play cannot silently skip the story.

The first laptop runs for 75 coding seconds before revealing the magnetic charger problem. Workshop spending is locked until Cardly launches, protecting the first required travel budget. Later fee gates always have already-published revenue available.

## Saves and accessibility

Progress saves approximately every ten seconds and when leaving the page. Offline calculations are capped at two hours: full recurring income and 35% build speed. A finished build waits for its launch. Interrupted expeditions refund their travel fee once when loading; collected lore remains saved.

Settings provides JSON export/import, a confirmed new-story reset, sound, reduced motion, story pace, and quest assistance. Assistance reduces combat damage and stealth detection, plays rhythm notes, and exposes a circuit-solving button. No expedition has a permanent failure penalty. Retrying preserves the ticket already paid; retreating refunds it.

All written save content is rendered as text. Imports are version checked, bounded, and copied into a known schema. No save data is executed.

## Files and verification

- `index.html`: interface and entry point.
- `styles.css`: responsive interface, modal, touch, and reduced-motion styles.
- `renderer.js`: dependency-free WebGL renderer and smooth mesh generation.
- `content.js`: campaign writing, project balancing, quests, and review questions.
- `game.js`: gameplay, scenes, procedural audio, UI, and persistence.
- `CHECKLIST.md`: implementation chunks and an explicitly unexecuted manual QA checklist.

No browser or command-line checks were run in the authoring environment. Use the manual checklist before treating this as a tested release. The game is intentionally fictional: the technology-branded attacks, authenticator, programming language, and browser exist as game content rather than real implementations of those products.
