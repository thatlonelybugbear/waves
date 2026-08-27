import {
	getVisionOrigins,
	getIssueReportData,
	hasBlockingWallCollision,
	measureVisibility,
	registerHeightAwareVisibilityHooks,
	testVisibility,
} from './waves-visibility.mjs';
import { registerOptionalResolutionAdapter } from './waves-optional-resolution.mjs';
import { getWallHeightBounds, registerWallHeightHooks, syncWallHeightsFromLevels } from './waves-wall-height.mjs';
import { registerDnd5eVisibilityAdapter } from './integrations/waves-dnd5e.mjs';
import {
	ELEVATION_LEVEL_CHANGE_ID,
	normalizeTokenVisionFlags,
	registerSettings,
	renderSettingsConfig,
	renderTokenVisionSettings,
	warnElevationLevelChangeConflict,
} from './waves-settings.mjs';

const MODULE_ID = 'waves';
async function confirmTokenLevelTransition(document, movement, changes) {
	const waypoints = movement ? foundry.utils.deepClone(movement.pending.waypoints) : null;
	const destination = waypoints?.at(-1);
	const elevation = Number(destination?.elevation ?? changes?.elevation);
	if (!Number.isFinite(elevation)) return;
	const levels = Array.from(document.parent?.levels ?? []).filter((level) => elevation >= level.elevation.bottom && elevation < level.elevation.top);
	if (!levels.length || levels.some((level) => level.id === document.level)) return;
	const options = levels.map((level) => ({ value: level.id, label: level.name }));
	const content = levels.length === 1
		? `<p>${game.i18n.format('WAVES.LevelTransition.Confirm', { token: document.name, level: levels[0].name })}</p>`
		: foundry.applications.fields.createFormGroup({
			label: game.i18n.localize('WAVES.LevelTransition.Level'),
			input: foundry.applications.fields.createSelectInput({ name: 'level', options }),
		});
	const levelId = await foundry.applications.api.DialogV2.confirm({
		window: { title: game.i18n.localize('WAVES.LevelTransition.Title') },
		content,
		yes: { callback: (event, button) => levels.length === 1 ? levels[0].id : button.form.elements.level.value },
	});
	if (!levelId) return;
	if (changes) return document.update({ ...changes, level: levelId }, { wavesLevelTransition: true });
	destination.level = levelId;
	await document.move(waypoints, { wavesLevelTransition: true });
}

function synchronizeTokenLevelUpdate(document, changes, operation) {
	normalizeTokenVisionFlags(changes);
	if (game.modules.get(ELEVATION_LEVEL_CHANGE_ID)?.active) return;
	if (!game.settings.get(MODULE_ID, 'synchronizeTokenLevel') || operation.wavesLevelTransition) return;
	if (!foundry.utils.hasProperty(changes, 'elevation') || (changes.level && changes.level !== document.level)) return;
	const elevation = Number(changes.elevation);
	const levels = Array.from(document.parent?.levels ?? []).filter((level) => elevation >= level.elevation.bottom && elevation < level.elevation.top);
	if (!levels.length || levels.some((level) => level.id === document.level)) return;
	void confirmTokenLevelTransition(document, null, foundry.utils.deepClone(changes));
	return false;
}
function synchronizeTokenLevel(document, movement, operation) {
	if (game.modules.get(ELEVATION_LEVEL_CHANGE_ID)?.active) return;
	if (!game.settings.get(MODULE_ID, 'synchronizeTokenLevel') || operation.wavesLevelTransition) return;
	const destination = movement.pending.waypoints.at(-1);
	if (!Number.isFinite(Number(destination?.elevation)) || (destination.level && destination.level !== document.level)) return;
	const levels = Array.from(document.parent?.levels ?? []).filter((level) => destination.elevation >= level.elevation.bottom && destination.elevation < level.elevation.top);
	if (!levels.length || levels.some((level) => level.id === document.level)) return;
	void confirmTokenLevelTransition(document, movement);
	return false;
}
Hooks.once('init', () => {
	registerSettings();
	registerHeightAwareVisibilityHooks();
});

Hooks.on('renderSettingsConfig', renderSettingsConfig);
Hooks.on('renderApplicationV2', renderTokenVisionSettings);
Hooks.on('preUpdateToken', synchronizeTokenLevelUpdate);
Hooks.on('preMoveToken', synchronizeTokenLevel);

Hooks.once('ready', () => {
	warnElevationLevelChangeConflict();
	registerWallHeightHooks();
	if (game.system?.id === 'dnd5e') registerDnd5eVisibilityAdapter();
	game.modules.get(MODULE_ID).api = {
		MODULE_ID,
		getVisionOrigins,
		getIssueReportData,
		getWallHeightBounds,
		hasBlockingWallCollision,
		measureVisibility,
		registerOptionalResolutionAdapter,
		syncWallHeightsFromLevels,
		testVisibility,
	};
	globalThis[MODULE_ID] = game.modules.get(MODULE_ID).api;
});
