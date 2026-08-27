import {
	getVisionOrigins,
	getIssueReportData,
	hasBlockingWallCollision,
	measureVisibility,
	refreshWallHeightOverlay,
	registerHeightAwareVisibilityHooks,
	setPerformanceDebug,
	testVisibility,
} from './waves-visibility.mjs';
import { registerOptionalResolutionAdapter } from './waves-optional-resolution.mjs';
import { getWallHeightBounds, registerWallHeightHooks, syncWallHeightsFromLevels } from './waves-wall-height.mjs';
import { registerDnd5eVisibilityAdapter } from './integrations/waves-dnd5e.mjs';

const MODULE_ID = 'waves';
const ELEVATION_LEVEL_CHANGE_ID = 'elevation-level-change';
const EYE_SETTING_DEFAULTS = { eyeHeightPercent: 85, eyeTolerancePercent: 10, eyeSampleCount: 3 };
const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

class WAVESLinksMenu extends HandlebarsApplicationMixin(ApplicationV2) {
	static LINKS = [
		{ label: 'README', icon: 'fa-brands fa-github', url: 'https://github.com/thatlonelybugbear/waves/blob/main/README.md' },
		{ label: 'Issues', icon: 'fa-solid fa-circle-exclamation', url: 'https://github.com/thatlonelybugbear/waves/issues' },
		{ label: 'Discord', icon: 'fa-brands fa-discord', url: 'https://discord.gg/twsvWuJJEN' },
		{ label: 'Ko-Fi', icon: 'fa-solid fa-mug-hot', url: 'https://ko-fi.com/thatlonelybugbear' },
		{ label: 'Patreon', icon: 'fa-brands fa-patreon', url: 'https://www.patreon.com/thatlonelybugbear' },
	];

	static DEFAULT_OPTIONS = {
		id: 'waves-links-menu',
		classes: ['waves-links-menu'],
		window: {
			title: 'WAVES.LinksMenu.Title',
			icon: 'fa-solid fa-link',
			resizable: false,
		},
		actions: {
			openLink: WAVESLinksMenu.#onOpenLink,
		},
		position: {
			width: 420,
			height: 'auto',
		},
	};

	static PARTS = {
		body: {
			template: 'modules/waves/templates/apps/waves-links-menu.hbs',
		},
	};

	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		context.primaryLinks = this.constructor.LINKS.slice(0, 2);
		context.secondaryLinks = this.constructor.LINKS.slice(2, 3);
		context.tertiaryLinks = this.constructor.LINKS.slice(3);
		return context;
	}

	static #onOpenLink(_event, target) {
		const url = target?.dataset?.url;
		if (!url) return;
		globalThis.open(url, '_blank', 'noopener,noreferrer');
	}
}

function renderTokenVisionSettings(app, html) {
	if (!(app instanceof foundry.applications.sheets.TokenConfig)) return;
	if ((game.settings.get(MODULE_ID, 'visibilityCalculationMode') ?? 'foundry') !== 'sampled') return;
	const root = html instanceof HTMLElement ? html : html?.[0];
	const vision = root?.querySelector('.tab[data-tab="vision"]');
	if (!vision || vision.querySelector('[data-waves-token-vision]')) return;
	const flags = app.document.flags?.[MODULE_ID] ?? {};
	const automatic = game.i18n.localize('WAVES.Settings.TokenVision.Automatic');
	const labels = {
		eyeHeightPercent: 'EyeHeightPercent',
		eyeTolerancePercent: 'EyeTolerancePercent',
		eyeSampleCount: 'EyeSampleCount',
	};
	const fieldset = document.createElement('fieldset');
	fieldset.dataset.wavesTokenVision = '';
	fieldset.innerHTML = `
		<legend>${game.i18n.localize('WAVES.Settings.TokenVision.Legend')}</legend>
		${Object.entries(EYE_SETTING_DEFAULTS).map(([key, fallback]) => `
			<div class="form-group">
				<label>${game.i18n.localize(`WAVES.Settings.${labels[key]}.Name`)}</label>
				<div class="form-fields">
					<input type="number" name="flags.${MODULE_ID}.${key}" value="${flags[key] ?? ''}" placeholder="${automatic} (${game.settings.get(MODULE_ID, key) ?? fallback})" min="${key === 'eyeSampleCount' ? 1 : 0}" ${key === 'eyeSampleCount' ? 'max="9" step="2"' : `max="${key === 'eyeTolerancePercent' ? 50 : 100}" step="1"`}>
				</div>
			</div>`).join('')}`;
	vision.append(fieldset);
}

function normalizeTokenVisionFlags(document, changes) {
	const flags = changes.flags?.[MODULE_ID];
	if (!flags) return;
	for (const key of Object.keys(EYE_SETTING_DEFAULTS)) {
		if (flags[key] !== '' && flags[key] !== null) continue;
		delete flags[key];
		flags[`-=${key}`] = null;
	}
}

let elevationLevelChangeWarningShown = false;
function warnElevationLevelChangeConflict() {
	if (elevationLevelChangeWarningShown || !game.user.isGM || !game.modules.get(ELEVATION_LEVEL_CHANGE_ID)?.active || !game.settings.get(MODULE_ID, 'synchronizeTokenLevel')) return;
	elevationLevelChangeWarningShown = true;
	ui.notifications.warn(game.i18n.localize('WAVES.LevelTransition.CompatibilityWarning'));
}
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
	normalizeTokenVisionFlags(document, changes);
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
function registerSettings() {
	game.settings.registerMenu(MODULE_ID, 'linksMenu', {
		name: 'WAVES.LinksMenu.Name',
		label: 'WAVES.LinksMenu.Label',
		hint: 'WAVES.LinksMenu.Hint',
		icon: 'fa-solid fa-link',
		type: WAVESLinksMenu,
		restricted: false,
	});
	game.settings.register(MODULE_ID, 'newWallHeightMode', {
		name: 'WAVES.Settings.NewWallHeightMode.Name',
		hint: 'WAVES.Settings.NewWallHeightMode.Hint',
		scope: 'world',
		config: true,
		type: String,
		choices: { level: 'WAVES.Settings.NewWallHeightMode.Level', unbounded: 'WAVES.Settings.NewWallHeightMode.Unbounded' },
		default: 'level',
	});
	game.keybindings.register(MODULE_ID, 'toggleNewWallHeightMode', {
		name: 'WAVES.Keybindings.ToggleNewWallHeightMode.Name',
		hint: 'WAVES.Keybindings.ToggleNewWallHeightMode.Hint',
		restricted: true,
		editable: [{ key: 'KeyW', modifiers: ['Alt'] }],
		onDown: async () => {
			const mode = game.settings.get(MODULE_ID, 'newWallHeightMode') === 'level' ? 'unbounded' : 'level';
			await game.settings.set(MODULE_ID, 'newWallHeightMode', mode);
			ui.notifications.info(game.i18n.localize(`WAVES.Notifications.NewWallHeightMode.${mode === 'level' ? 'Level' : 'Unbounded'}`));
			return true;
		},
	});
	game.settings.register(MODULE_ID, 'visibilityCalculationMode', {
		name: 'WAVES.Settings.VisibilityCalculationMode.Name',
		hint: 'WAVES.Settings.VisibilityCalculationMode.Hint',
		scope: 'world',
		config: true,
		type: String,
		choices: { foundry: 'WAVES.Settings.VisibilityCalculationMode.Foundry', sampled: 'WAVES.Settings.VisibilityCalculationMode.Sampled' },
		default: 'foundry',
	});
	game.settings.register(MODULE_ID, 'peekingMode', {
		name: 'WAVES.Settings.PeekingMode.Name',
		hint: 'WAVES.Settings.PeekingMode.Hint',
		scope: 'world',
		config: true,
		type: String,
		choices: { disabled: 'WAVES.Settings.PeekingMode.Disabled', auto: 'WAVES.Settings.PeekingMode.Auto' },
		default: 'disabled',
	});
	game.settings.register(MODULE_ID, 'visibilitySampleMode', {
		name: 'WAVES.Settings.VisibilitySampleMode.Name',
		hint: 'WAVES.Settings.VisibilitySampleMode.Hint',
		scope: 'world',
		config: true,
		type: String,
		choices: { grid: 'WAVES.Settings.VisibilitySampleMode.Grid', body: 'WAVES.Settings.VisibilitySampleMode.Body' },
		default: 'grid',
	});
	game.settings.register(MODULE_ID, 'visionSourceMode', {
		name: 'WAVES.Settings.VisionSourceMode.Name',
		hint: 'WAVES.Settings.VisionSourceMode.Hint',
		scope: 'world',
		config: true,
		type: String,
		choices: { singular: 'WAVES.Settings.VisionSourceMode.Singular', grid: 'WAVES.Settings.VisionSourceMode.Grid' },
		default: 'singular',
	});

	game.settings.register(MODULE_ID, 'eyeHeightPercent', {
		name: 'WAVES.Settings.EyeHeightPercent.Name',
		hint: 'WAVES.Settings.EyeHeightPercent.Hint',
		scope: 'world',
		config: true,
		type: Number,
		range: { min: 0, max: 100, step: 1 },
		default: 85,
	});
	game.settings.register(MODULE_ID, 'eyeTolerancePercent', {
		name: 'WAVES.Settings.EyeTolerancePercent.Name',
		hint: 'WAVES.Settings.EyeTolerancePercent.Hint',
		scope: 'world',
		config: true,
		type: Number,
		range: { min: 0, max: 50, step: 1 },
		default: 10,
	});
	game.settings.register(MODULE_ID, 'eyeSampleCount', {
		name: 'WAVES.Settings.EyeSampleCount.Name',
		hint: 'WAVES.Settings.EyeSampleCount.Hint',
		scope: 'world',
		config: true,
		type: Number,
		range: { min: 1, max: 9, step: 2 },
		default: 3,
	});
	game.settings.register(MODULE_ID, 'showPassableWallOverlay', {
		name: 'WAVES.Settings.ShowPassableWallOverlay.Name',
		hint: 'WAVES.Settings.ShowPassableWallOverlay.Hint',
		scope: 'world',
		config: true,
		type: Boolean,
		default: true,
		onChange: refreshWallHeightOverlay,
	});
	game.settings.register(MODULE_ID, 'synchronizeTokenLevel', {
		name: 'WAVES.Settings.SynchronizeTokenLevel.Name',
		hint: 'WAVES.Settings.SynchronizeTokenLevel.Hint',
		scope: 'world',
		config: true,
		type: Boolean,
		default: false,
		onChange: warnElevationLevelChangeConflict,
	});
	game.settings.register(MODULE_ID, 'performanceDebug', {
		name: 'WAVES.Settings.PerformanceDebug.Name',
		hint: 'WAVES.Settings.PerformanceDebug.Hint',
		scope: 'world',
		config: true,
		type: Boolean,
		default: false,
		onChange: setPerformanceDebug,
	});
	setPerformanceDebug(game.settings.get(MODULE_ID, 'performanceDebug'));
}

Hooks.once('init', () => {
	registerSettings();
	registerHeightAwareVisibilityHooks();
});

Hooks.on('renderSettingsConfig', (app, html) => {
	const root = html instanceof HTMLElement ? html : html?.[0];
	const sampledSettings = ['peekingMode', 'visibilitySampleMode', 'visionSourceMode', ...Object.keys(EYE_SETTING_DEFAULTS)];
	const updateSampledSettings = () => {
		const sampled = root?.querySelector(`[name="${MODULE_ID}.visibilityCalculationMode"]`)?.value === 'sampled';
		for (const key of sampledSettings) root?.querySelector(`[name="${MODULE_ID}.${key}"]`)?.closest('.form-group')?.toggleAttribute('hidden', !sampled);
	};
	root?.addEventListener('change', (event) => {
		if (event.target?.name === `${MODULE_ID}.visibilityCalculationMode`) updateSampledSettings();
	});
	updateSampledSettings();
	for (const [key, value] of Object.entries(EYE_SETTING_DEFAULTS)) {
		const picker = root?.querySelector(`range-picker[name="${MODULE_ID}.${key}"]`);
		if (!picker || picker.parentElement.querySelector(`[data-waves-reset-eye="${key}"]`)) continue;
		const button = document.createElement('button');
		button.type = 'button';
		button.classList.add('icon');
		button.dataset.wavesResetEye = key;
		button.title = button.ariaLabel = game.i18n.localize('WAVES.Settings.ResetEyeSetting');
		button.innerHTML = '<i class="fa-solid fa-arrow-rotate-left"></i>';
		button.addEventListener('click', () => {
			picker.value = value;
			picker.dispatchEvent(new Event('change', { bubbles: true }));
		});
		picker.append(button);
	}
});
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
