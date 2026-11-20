## 14.370.1.1
* Cap cover from intervening creatures at Half Cover in D&D5e, while preserving stronger cover from walls and surfaces.

## 14.370.1
* Support Foundry VTT 14.370.
* Add Brazilian Portuguese localization.
* Fix a brief incorrect illumination result when stronger darkness reaches a weaker lamp through a Reverse Proximity window.
* Resolve competing light and darkness at each target sample and apply Darkness restrictions to rays from darkness emitters.
* Keep ambient-light Level resolution independent of the viewed Level and prevent suppressed darkness sources from suppressing other lights.
* Add a collapsible WAVES section to the Wall Tools palette with Wall Bottom, Wall Top, and Levels, including single-Level scenes and mixed selected heights.
* Allow elevated lights to shine past lower walls and refresh lighting after wall height edits.
* Check ambient and token illumination across Levels, including light sources without rendered objects, and expose `waves.isHeightAwareIlluminated()` for Tokens and TokenDocuments.
* Add 3D Corner-to-corner as an alternative to the existing Sampled 3D cover calculation. Intervening tokens can optionally provide cover in either mode.
* Support cover and peeking checks for tokens on other Levels even when those tokens are not rendered on the client.
* Prevent corner cover checks from looking through walls or surfaces within the attacker's space, and include eligible peeking positions.
* Respect hidden tokens and apply Proximity/Reverse Proximity window thresholds and attenuation to sight, light, and darkness rays.
* Fix stale visibility results after changes to scene geometry, token status, or WAVES settings.
* Fix compatibility warnings when clearing token eye overrides and visibility errors caused by zero-length walls.
* Respect Tiles with **Restrict Light** when a ray crosses the Tile's elevation on an applicable Level. Use the Tile footprint while its texture loads and its opaque areas once loaded.
* Hide height-passable wall overlays during token movement and redraw them after the visibility refresh, including when a token changes Level.
* Improve cover ray displays and issue reports to help diagnose visibility problems.

## 14.367.1.1
* Preserve hidden WAVES settings if Foundry mode is selected.

## 14.367.1
* Initial release for Foundry v14.367.
