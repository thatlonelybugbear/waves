const MODULE_ID = 'waves';

export function getWallHeightBounds(wall, change = {}) {
	const height = wall.getFlag(MODULE_ID, 'height') ?? wall._source?.flags?.rat?.height ?? {};
	const bottomPath = 'flags.waves.height.bottom';
	const topPath = 'flags.waves.height.top';
	const bottom = foundry.utils.hasProperty(change, bottomPath) ? foundry.utils.getProperty(change, bottomPath) : height.bottom;
	const top = foundry.utils.hasProperty(change, topPath) ? foundry.utils.getProperty(change, topPath) : height.top;
	return {
		bottom: bottom === '' || bottom == null ? -Infinity : Number(bottom),
		top: top === '' || top == null ? Infinity : Number(top),
	};
}

export async function syncWallHeightsFromLevels(scene = canvas.scene, { overwrite = false } = {}) {
	if (!game.user.isGM) throw new Error('Only a GM can update wall heights.');
	if (!scene) throw new Error('A Scene is required.');
	const updates = [];
	for (const wall of scene.walls) {
		if (!overwrite && wall.getFlag(MODULE_ID, 'height') != null) continue;
		const ranges = Array.from(wall.levels ?? []).map((id) => scene.levels.get(id)?.elevation).filter(Boolean);
		if (!ranges.length) continue;
		const bottom = Math.min(...ranges.map((range) => range.bottom));
		const top = Math.max(...ranges.map((range) => range.top));
		updates.push({
			_id: wall.id,
			'flags.waves.height': {
				bottom: Number.isFinite(bottom) ? bottom : null,
				top: Number.isFinite(top) ? top : null,
			},
		});
	}
	if (updates.length) await foundry.documents.modifyBatch([{ action: 'update', documentName: 'Wall', parent: scene, updates }]);
	return { scene, updated: updates.length, skipped: scene.walls.size - updates.length };
}

export function registerWallHeightHooks() {
	Hooks.on('preCreateWall', (wall) => {
		if (!game.user.isGM || wall.parent !== canvas.scene) return;
		const level = canvas.level;
		if (!level || wall.levels.size !== 1 || !wall.levels.has(level.id)) return;
		if (wall.getFlag(MODULE_ID, 'height') != null || wall._source?.flags?.rat?.height != null) return;
		if (game.settings.get(MODULE_ID, 'newWallHeightMode') === 'level') {
			wall.updateSource({
				'flags.waves.height': {
					bottom: Number.isFinite(level.elevation.bottom) ? level.elevation.bottom : null,
					top: Number.isFinite(level.elevation.top) ? level.elevation.top : null,
				},
				levels: [level.id],
			});
		} else wall.updateSource({ 'flags.waves.height': { bottom: null, top: null }, levels: [] });
	});
	Hooks.on('renderWallConfig', (app, html) => {
		const root = html;
		if (!root || root.querySelector('[name="flags.waves.height.bottom"]')) return;

		const height = app.document.getFlag(MODULE_ID, 'height') ?? app.document._source?.flags?.rat?.height ?? {};
		const fields = document.createElement('div');
		fields.classList.add('form-fields');
		const inputs = {};
		for (const [key, label] of [
			['bottom', 'WAVES.Wall.Bottom'],
			['top', 'WAVES.Wall.Top'],
		]) {
			const fieldLabel = document.createElement('label');
			fieldLabel.textContent = game.i18n.localize(label);

			const input = document.createElement('input');
			input.type = 'number';
			input.name = 'flags.waves.height.' + key;
			input.step = '1';
			input.value = height[key] ?? '';
			inputs[key] = input;
			fields.append(fieldLabel, input);
		}

		const field = foundry.applications.fields.createFormGroup({
			label: game.i18n.localize('WAVES.Wall.Height'),
			hint: game.i18n.localize('WAVES.Wall.HeightHint'),
			input: fields,
		});
		const levels = root.querySelector('[name="levels"]');
		levels?.closest('.form-group')?.after(field);
		if (!levels) return;

		const getSelected = () =>
			Array.isArray(levels.value) ? levels.value
			: levels.value ? [levels.value]
			: [];
		const getBound = (input) =>
			input.value === '' ?
				input === inputs.bottom ?
					-Infinity
				:	Infinity
			:	Number(input.value);
		const setBound = (input, value) => {
			const next = Number.isFinite(value) ? String(value) : '';
			if (input.value === next) return;
			input.value = next;
			input.dispatchEvent(new Event('input', { bubbles: true }));
			input.dispatchEvent(new Event('change', { bubbles: true }));
		};
		let syncing = false;
		let selected = new Set(getSelected());

		const syncLevelsFromHeight = () => {
			const bottom = getBound(inputs.bottom);
			const top = getBound(inputs.top);
			if (Number.isNaN(bottom) || Number.isNaN(top) || bottom >= top) return;
			const ids =
				bottom === -Infinity && top === Infinity ?
					[]
				:	Array.from(app.document.parent.levels)
						.filter((level) => level.visible && bottom < level.elevation.top && top > level.elevation.bottom)
						.map((level) => level.id);
			selected = new Set(ids);
			syncing = true;
			levels.value = ids;
			syncing = false;
		};

		const syncHeightFromLevels = () => {
			const ids = getSelected();
			const nextSelected = new Set(ids);
			if (!ids.length) {
				syncing = true;
				setBound(inputs.bottom, -Infinity);
				setBound(inputs.top, Infinity);
				syncing = false;
				selected = nextSelected;
				return;
			}

			const ranges = ids.map((id) => app.document.parent.levels.get(id)?.elevation).filter(Boolean);
			if (!ranges.length) return;
			let bottom = getBound(inputs.bottom);
			let top = getBound(inputs.top);
			const lower = Math.min(...ranges.map((range) => range.bottom));
			const upper = Math.max(...ranges.map((range) => range.top));
			const added = ranges.filter((range, index) => !selected.has(ids[index]));
			if (added.some((range) => range.top <= bottom)) bottom = lower;
			if (added.some((range) => range.bottom >= top)) top = upper;
			if (!ranges.some((range) => range.bottom <= bottom && bottom < range.top)) bottom = lower;
			if (!ranges.some((range) => range.bottom < top && top <= range.top)) top = upper;

			syncing = true;
			setBound(inputs.bottom, bottom);
			setBound(inputs.top, top);
			syncing = false;
			selected = nextSelected;
			syncLevelsFromHeight();
		};

		levels.addEventListener('change', () => {
			if (!syncing) syncHeightFromLevels();
		});
		for (const input of Object.values(inputs)) {
			input.addEventListener('change', () => {
				if (!syncing) syncLevelsFromHeight();
			});
		}
	});
	Hooks.on('preUpdateWall', (wall, change) => {
		const { bottom, top } = getWallHeightBounds(wall, change);
		if (Number.isNaN(bottom) || Number.isNaN(top) || bottom >= top) return;
		if (bottom === -Infinity && top === Infinity) {
			if (foundry.utils.hasProperty(change, 'flags.waves.height')) change.levels = [];
			return;
		}

		change.levels = Array.from(wall.parent.levels)
			.filter((level) => bottom < level.elevation.top && top > level.elevation.bottom)
			.map((level) => level.id);
	});
	Hooks.on('updateWall', (wall, change) => {
		if (wall.parent !== canvas.scene || !foundry.utils.hasProperty(change, 'flags.waves.height')) return;
		canvas.perception.update({ initializeVision: true, refreshVision: true });
	});
}
