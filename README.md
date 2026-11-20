# WAVES

**Walls And Vision Elevation Sampling** adds height-aware walls, three-dimensional visibility sampling, cover, peeking, and surface-aware sight to Foundry Virtual Tabletop.

WAVES is currently an **alpha release**, targeting **Foundry VTT v14.370** with a minimum version of v14.367. Use in an active campaign is not advisable.

## Requirements

- Foundry Virtual Tabletop v14.367 or later in v14 (verified on v14.370)
- [libWrapper](https://github.com/ruipin/fvtt-lib-wrapper)

WAVES is system-independent at its core. Its dnd5e integration recognizes the `prone` and `hiding` statuses.

## Visibility modes

### Foundry

WAVES tests a single ray between the tokens' vision origins for its own geometric visibility check. Foundry still runs its detection modes. Sampled cover is available in WAVES mode.

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
- additional cached vision polygons for the rendered vision mask.

With **Viewing position** set to **Whole occupied space**, source samples include inset corners, edge midpoints, and centers of occupied grid cells at the configured eye elevations. Center viewing uses the token's center at those eye elevations.

WAVES creates additional cached Foundry vision sources at eligible sample positions and draws their polygons into the same vision mask. This produces a visual union without explicitly merging polygon geometry. Target-specific 3D ray tests determine WAVES geometric visibility; the rendered mask is an approximation and may not represent every sampled ray. Foundry's detection rules still determine whether a token can be seen.

## Wall heights and Levels

Wall Configuration includes **Wall Bottom** and **Wall Top** fields. A wall blocks a ray only when the ray crosses it within that interval. The bottom is inclusive and the top is exclusive.

The Wall Tools palette also provides a collapsible **WAVES** section with Wall Bottom, Wall Top, and Levels. Selected walls with different heights show mixed-value placeholders; applying changes updates only edited bounds.

A blank bottom or top leaves that end of an explicit height range open. When both bounds are blank, WAVES uses the elevation ranges of the wall's assigned Levels. With both bounds blank and no assigned Levels, the wall blocks at every elevation for its configured restrictions.

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

| Uncovered target samples | Result | Bonus |
| --- | --- | --- |
| 0% | Total cover | — |
| More than 0%, up to 25% | Three-quarters cover | +5 |
| More than 25%, up to 50% | Half cover | +2 |
| More than 50% | No cover | +0 |

Any geometrically visible sample gives the target line of sight, subject to Foundry's detection rules. Cover uses the proportion of uncovered samples in the selected cover mode. Total cover prevents the target from being attackable through the WAVES API.

**Cover calculation** selects either the normal sampled 3D rays or 3D corner-to-corner rays. Corner-to-corner chooses the source corner or eligible peeking position that exposes the most target corners, then applies the same cover thresholds. This is a 3D extension, not a literal implementation of the D&D grid-cover rules.

When **Token-to-token cover** is enabled, intervening non-hidden tokens can reduce the uncovered target samples using their TokenDocument horizontal footprint, elevation, and depth. Tokens do not block binary visibility or the rendered vision mask.

In D&D5e, intervening tokens contribute up to Half Cover. WAVES counts rays blocked by walls, surfaces, and tokens together, so blockers that intercept different rays can jointly grant Half Cover. For example, if a wall blocks two of eight corner rays and a token blocks two other rays, the target has Half Cover. Three-Quarters Cover and Total Cover require enough rays to be blocked by walls or surfaces alone. The reported uncovered percentage reflects the actual sample counts.

Cover checks, including peeking and corner samples, support TokenDocuments without rendered Token objects. Intervening tokens are read from the Scene's documents, including tokens on other Levels. Calculations require the currently viewed Scene; passing a token from another Scene throws an error because collision checks use the active canvas.

WAVES reports cover and its suggested bonus through the API. Automated Conditions 5e integrates with WAVES for cover automation in the D&D5e system only. WAVES itself does not apply attack modifiers, conditions, or other automation.

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

Foundry's rendered light polygons remain two-dimensional. WAVES filters their walls at the light source's elevation, so a light above a wall's top can shine past it. This is a horizontal approximation, not a three-dimensional shadow calculation. The painted area can therefore disagree with illumination of a token at another elevation.

For height-aware token illumination, WAVES reads ambient and token light emission from Scene documents, including emitters without rendered objects on the viewed Level. It checks three-dimensional range, direction, wall heights, Proximity/Reverse Proximity thresholds and attenuation, and light-blocking surfaces. Core global and third-party light sources remain supplied by Foundry.

Light and darkness compete by emitter priority. Darkness wins ties. If darkness reaches a weaker lamp through a window, it can suppress that lamp even for targets outside the darkness radius.

A Tile with **Restrict Light** blocks those recovered light rays as a horizontal plane at the Tile's elevation when it applies to the source or target Level. Texture transparency is respected even when the Tile is not rendered. Until its texture is available, its footprint conservatively blocks light. WAVES does not add Tile thickness or treat ordinary Tiles as sight blockers.

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
| Cover calculation | Sampled 3D | Use sampled rays or 3D corner-to-corner checks. |
| Token-to-token cover | Off | Include intervening non-hidden token volumes in either cover mode. |
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

The result includes `visible`, `detected`, `attackable`, `attackableInTurn`, `percentage`, `cover`, `coverBonus`, sample counts, and peeking information. Here `detected` means the geometry allows sight and the target passes the hidden-token check. Use Foundry's player view to check actual detection with lighting, range, and special senses.

`visibleSamples / totalSamples` describes geometric visibility. `percentage` reports the raw uncovered share (`uncoveredSamples / totalCoverSamples`). Use `cover` for the final tier, which accounts for the D&D5e Half Cover cap on intervening creatures. For example, a creature blocking every ray can yield `percentage: 0` and `cover: 'half'`. Corner mode tests eight target corners. These are geometry results, not a replacement for Foundry's lighting, range, or special-sense detection checks.

Sampled results also include `coverDetails`: the selected corner `origin` (null for combined sampled origins), `wallBlockedSamples`, `surfaceBlockedSamples`, `tokenBlockedSamples`, `unreachableSamples`, `uncoveredSamples`, and `totalSamples`. Blocker counts follow wall > surface > token precedence; they are not independently calculated cover categories. Corner origins must be reachable from the source's center at that height. Eligible peeking positions still follow the peeking setting and combat turn.

To check whether a token receives height-aware illumination:

```js
const token = canvas.scene.tokens.get("TOKEN_ID");
waves.isHeightAwareIlluminated(token);
```

`isHeightAwareIlluminated(token)` accepts a Token or TokenDocument and returns a boolean: `true` when at least one reachable target sample receives light, otherwise `false`. Different source and target Levels do not by themselves prevent illumination. The token must belong to the currently viewed Scene; tokens from another Scene throw an error. A rendered Token object is not required.

This is an illumination query, not an observer-to-target detection query. It does not establish whether a particular observer can see the token, and its result need not match the painted light area. While a blocking Tile texture loads, the result may remain `false`; detection refreshes when loading completes.

For visual and console diagnostics:

```js
waves.measureVisibility(sourceToken, targetToken, {
  showTestSamples: true,
  usePeeking: false
});
```

This temporarily draws successful and blocked cover rays and logs one JSON object containing both visibility diagnostics and `coverDetails.rays`. In corner mode these rays originate from the selected cover corner or peeking position. Other API functions include:

```js
waves.getVisionOrigins(token, options);
waves.getWallHeightBounds(wall);
waves.hasBlockingWallCollision(origin, destination, type);
waves.isHeightAwareIlluminated(token);
waves.registerOptionalResolutionAdapter(adapter);
waves.syncWallHeightsFromLevels(scene, options);
waves.testVisibility(source, target);
```

## Known limitations

- The rendered vision mask, automatic sight checks, and `waves.measureVisibility()` can disagree. In WAVES mode, automatic sight checks use up to 18 ordinary origins, 9 eligible peeking origins, and 27 target points. The API measures the full eligible sample set.
- Peeking can reveal a target or improve measured cover while the surrounding area stays outside the rendered vision mask.
- Foundry's rendered light shapes are not rebuilt in three dimensions.
- Near a platform edge, **Whole occupied space** can reveal areas hidden from the token's center. The difference depends on token size, placement, and scene geometry.
- Movement clearance tests the token's vertical span at the movement ray's origin. A path that climbs or descends can cross a wall at a different elevation.
- Corner cover and intervening-token cover use rectangular token bounds, including for hexagonal or irregular footprints.
- On gridless scenes, both **Target area** choices use the same sample positions within the token bounds.
- Hidden and invisible targets remain subject to Foundry’s detection-mode checks.

## Reporting issues

Include reproduction steps, whether other modules were disabled, and the issue-report payload. It contains active module versions, scene geometry, WAVES settings, token detection settings, rendering state, combat state, and `visibility` / `reverseVisibility` results, so review it before sharing. Rendering state reflects the current client's combined vision sources; it does not establish either token's individual detectability. Use `waves.measureVisibility(source, target, { showTestSamples: true })` only when temporary ray visualization is also useful.
