# WAVES

**Walls And Vision Elevation Sampling** adds height-aware walls, three-dimensional visibility sampling, cover, peeking, and surface-aware sight to Foundry Virtual Tabletop.

WAVES is currently an **alpha release** for **Foundry VTT v14.367**. Use in an active campaign is not advisable.

## Requirements

- Foundry Virtual Tabletop v14.367
- [libWrapper](https://github.com/ruipin/fvtt-lib-wrapper)

WAVES is system-independent at its core. Its dnd5e integration recognizes the `prone` and `hiding` statuses.

## Visibility modes

### Foundry

Uses Foundry's center-based visibility with height-aware walls. This conservative compatibility mode does not calculate sampled cover.

### WAVES

Tests multiple source and target points in three dimensions. A target is visible when at least one valid ray is not blocked by a wall or sight-blocking surface.

WAVES mode provides:

- wall intersections tested at the ray's exact crossing elevation;
- occupied-space source and target sampling;
- configurable eye height and vertical eye movement;
- half and three-quarters cover;
- optional automatic peeking;
- support for sight aware **Define Surface** Region behaviors;
- target-specific height-aware illumination recovery;
- additional cached vision polygons as a performant canvas approximation.

Target-specific visibility is authoritative. The rendered canvas mask is an approximation and may not represent every sampled ray.

## Wall heights and Levels

Wall Configuration includes **Wall Bottom** and **Wall Top** fields. A wall blocks a ray only when the ray crosses it within that interval. The bottom is inclusive and the top is exclusive.

Blank bounds mean negative or positive infinity. A wall with both bounds blank is vertically unbounded. Level assignments remain a separate Foundry constraint; a wall applies across all Levels only when its Level assignment is empty.

Changing wall heights updates the Foundry Level assignments overlapped by the range. Changing Level assignments also updates the height range.

### Newly drawn walls

**New wall height** controls newly placed walls:

- **Viewed Level (Foundry default):** retains Foundry's viewed-Level assignment and matches the WAVES bounds to that Level.
- **All Levels (Unbounded):** clears Level assignments and leaves both WAVES bounds unbounded.

The GM-only **Toggle new wall height mode** keybinding defaults to `Alt+W` and displays the selected behavior in a notification.

Existing imported, migrated, or macro-created walls are not rewritten automatically. A GM can derive WAVES heights from existing Level assignments:

```js
await waves.syncWallHeightsFromLevels(canvas.scene);
```

Existing WAVES flags are preserved. To replace them:

```js
await waves.syncWallHeightsFromLevels(canvas.scene, { overwrite: true });
```

Walls without Level assignments remain unchanged because an empty assignment means all Levels.

## Token geometry

WAVES uses `TokenDocument` geometry. Actor size and Actor height are not consulted.

- `width` and `height` define horizontal occupied space.
- `depth` defines vertical size in grid units.
- `elevation` defines the bottom of the token's vertical volume.

In dnd5e, prone uses half the normal vertical volume for visibility sampling.

In WAVES mode, Token Configuration provides optional overrides for eye height, vertical eye movement, and vertical eye positions. A blank override uses the current world setting, shown by the **Automatic** placeholder.

## Cover

| Visible target samples | Result | Bonus |
| --- | --- | --- |
| 0% | Total cover | — |
| Up to 25% | Three-quarters cover | +5 |
| More than 25%, up to 50% | Half cover | +2 |
| More than 50% | No cover | +0 |

Any visible sample makes the target visible. Total cover prevents it from being attackable through the WAVES API.

WAVES currently reports cover and its suggested bonus through the API only. It does not apply attack modifiers, conditions, or other automation. Integrations with systems or automation modules such as Automated Conditions 5e or Midi-QOL may be added later.

## Automatic peeking

Peeking adds target-specific origins around nearby blocking cover, including limited over-wall and under-wall positions.

- Outside combat, eligible tokens may peek.
- During combat, only the active combatant may peek.
- The token must be adjacent to sight-blocking cover at the sampled eye elevation.
- Peeking is available to visibility, detection, and `attackableInTurn` checks.
- Peeking origins are not added to the global rendered vision mask.

## Define Surface Regions

A Region with a sight-enabled **Define Surface** behavior acts as a horizontal sight-blocking plane at the behavior's surface elevation. WAVES evaluates crossings between Levels and refreshes when relevant Regions or Region behaviors are created, updated, or deleted.

A Region elevation range does not give the surface physical thickness.

## Height-aware illumination and detection

Foundry's rendered light polygons remain two-dimensional. WAVES can recover a geometrically visible target reached by an active light source through height-valid light rays even when Foundry's rendered light shape is blocked at another elevation.

Recovered targets use distinct outlines:

- cyan: height-aware sampled sight;
- amber: height-aware illumination.

Foundry detection modes remain authoritative for hidden, invisible, and special-sense behavior. **Sense All** may reveal a token even when `waves.measureVisibility()` reports ordinary sight as blocked.

## Height-aware movement

Movement walls are ignored when their vertical range does not overlap the moving token's current vertical volume. Optional green dashed overlays identify height-passable walls for the controlled token. Secret doors are never exposed to non-GM users.

WAVES retains Foundry's path constraint, snapping, surfaces, movement actions, and movement costs.

## Level synchronization

**Synchronize token Level with elevation** prompts when an elevation change crosses into another Foundry Level. Confirming changes both elevation and Level; declining cancels the movement or update.

When **Elevation Level Change** is active, WAVES disables its synchronization handling and warns the GM.

## Settings

All WAVES settings are world settings.

| Setting | Default | Purpose |
| --- | --- | --- |
| New wall height | Viewed Level | Select viewed-Level or unbounded bounds for new walls. |
| Visibility mode | Foundry | Select Foundry center visibility or WAVES sampling. |
| Automatic peeking | Off | Permit eligible target-specific peeking. |
| Target area | Whole occupied space | Sample the full occupied area or a smaller body area. |
| Viewing position | Center | Look from the center or multiple occupied-space positions. |
| Eye height | 85% | Default eye position within token depth. |
| Vertical eye movement | 10% | Normal movement above and below eye height. |
| Vertical eye positions | 3 | Number of sampled vertical eye positions. |
| Show height-passable walls | On | Draw green dashed movement overlays. |
| Synchronize token Level with elevation | Off | Prompt when elevation crosses a Level boundary. |
| Performance debug | Off | Log aggregated timings to the browser console. |

## API

The API is available as `game.modules.get("waves").api` and `globalThis.waves`.

To copy an issue-report payload, open the browser developer console, control one source token, target one other token, and run:

```js
copy(JSON.stringify(waves.getIssueReportData()))
```

Alternatively, control exactly two tokens. WAVES uses them in their control order as source and target.

```js
const result = waves.measureVisibility(sourceToken, targetToken, {
  type: "sight",
  includeSurfaces: true,
  usePeeking: true
});
```

The result includes `visible`, `detected`, `attackable`, `attackableInTurn`, `percentage`, `cover`, `coverBonus`, sample counts, and peeking information.

For visual and console diagnostics:

```js
waves.measureVisibility(sourceToken, targetToken, {
  showTestSamples: true,
  usePeeking: false
});
```

This temporarily draws successful and blocked rays and logs one JSON object. Other API functions include:

```js
waves.getVisionOrigins(token, options);
waves.getWallHeightBounds(wall);
waves.hasBlockingWallCollision(origin, destination, type);
waves.registerOptionalResolutionAdapter(adapter);
waves.syncWallHeightsFromLevels(scene, options);
waves.testVisibility(source, target);
```

## Known limitations

- Rendered sampled vision is a performant approximation; target-specific measurement is authoritative.
- Peeking origins affect target-specific visibility checks only; they do not contribute polygons to the rendered vision mask.
- Foundry's rendered light shapes are not rebuilt in three dimensions.
- Occupied-space sampling may create a one-grid-space observational advantage near platform edges.
- Movement clearance uses the token's current vertical volume; vertically changing paths require further work.
- Gridless and hex scenes require broader release testing.
- Hidden and invisible targets remain subject to Foundry’s detection-mode checks.

## Reporting issues

Include reproduction steps, whether other modules were disabled, and the issue-report payload. The payload contains active module versions, scene geometry, WAVES settings, and the visibility result, so review it before sharing. Use `waves.measureVisibility(source, target, { showTestSamples: true })` only when temporary ray visualization is also useful.
