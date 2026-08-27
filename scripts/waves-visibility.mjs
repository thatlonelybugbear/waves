import { resolveIsHidden, resolveIsProne } from './waves-optional-resolution.mjs';

const MODULE_ID = 'waves';
let performanceDebug = false;
let performanceFlush;
const performanceStats = new Map();

export function setPerformanceDebug(enabled) {
	performanceDebug = enabled;
	if (!enabled) performanceStats.clear();
}

function profile(name, callback) {
	if (!performanceDebug) return callback();
	const start = performance.now();
	try {
		return callback();
	} finally {
		const duration = performance.now() - start;
		const stats = performanceStats.get(name) ?? { calls: 0, total: 0, max: 0 };
		stats.calls++;
		stats.total += duration;
		stats.max = Math.max(stats.max, duration);
		performanceStats.set(name, stats);
		performanceFlush ??= setTimeout(() => {
			console.groupCollapsed('WAVES performance');
			console.table(
				Object.fromEntries(
					Array.from(performanceStats, ([key, value]) => [
						key,
						{
							calls: value.calls,
							totalMs: Number(value.total.toFixed(2)),
							averageMs: Number((value.total / value.calls).toFixed(3)),
							maxMs: Number(value.max.toFixed(3)),
						},
					]),
				),
			);
			console.groupEnd();
			performanceStats.clear();
			performanceFlush = undefined;
		}, 1000);
	}
}
function getWallElevationRanges(wall) {
	if (wall?.documentName !== 'Wall') return [{ bottom: -Infinity, top: Infinity }];
	const height = wall.getFlag(MODULE_ID, 'height') ?? wall._source?.flags?.rat?.height ?? {};
	const bottom = height.bottom === '' || height.bottom == null ? -Infinity : Number(height.bottom);
	const top = height.top === '' || height.top == null ? Infinity : Number(height.top);
	if (bottom !== -Infinity || top !== Infinity) return [{ bottom, top }];
	if (!wall.levels.size) return [{ bottom: -Infinity, top: Infinity }];
	return Array.from(wall.parent?.levels ?? [])
		.filter((level) => wall.includedInLevel(level))
		.map((level) => level.elevation);
}

function wallBlocksAtElevation(wall, elevation) {
	return getWallElevationRanges(wall).some(({ bottom, top }) => bottom <= elevation && elevation < top);
}

function wallOverlapsElevationRange(wall, bottom, top) {
	return getWallElevationRanges(wall).some((range) => range.bottom < top && range.top > bottom);
}

function hasBlockingWallVolumeCollision(origin, destination, bottom, top) {
	if (!canvas.dimensions.rect.contains(origin.x, origin.y)) return false;
	for (const level of canvas.scene.levels) {
		const collisions = CONFIG.Canvas.polygonBackends.move.testCollision(origin, destination, { type: 'move', mode: 'all', level });
		if (collisions.some((collision) => Array.from(collision.edges).some((edge) => wallOverlapsElevationRange(edge.object, bottom, top)))) return true;
	}
	return false;
}

function isPointOnSightWall(point) {
	return canvas.walls.placeables.some((wall) => {
		const document = wall.document;
		if (document.sight === CONST.EDGE_SENSE_TYPES.NONE) return false;
		if (document.door && document.ds === CONST.WALL_DOOR_STATES.OPEN) return false;
		if (!wallBlocksAtElevation(document, point.elevation)) return false;
		const closest = foundry.utils.closestPointToSegment(point, wall.edge.a, wall.edge.b);
		return Math.hypot(point.x - closest.x, point.y - closest.y) <= 1;
	});
}

function getSourceSampleAnchor(document, origin, xyPoints, elevation) {
	const center = { x: origin.x, y: origin.y, elevation };
	if (!isPointOnSightWall(center)) return center;
	const previous = sourceAnchorHistory.get(document.uuid);
	const reference = previous && !(previous.x.almostEqual(origin.x) && previous.y.almostEqual(origin.y)) ? previous : Array.from(xyPoints.values()).find((point) => !(point.x.almostEqual(origin.x) && point.y.almostEqual(origin.y)));
	if (!reference) return center;
	const distance = Math.hypot(reference.x - origin.x, reference.y - origin.y);
	if (!distance) return center;
	return { x: origin.x + (reference.x - origin.x) / distance, y: origin.y + (reference.y - origin.y) / distance, elevation };
}
export function hasBlockingWallCollision(origin, destination, type = 'move') {
	if (!canvas.dimensions.rect.contains(origin.x, origin.y)) return false;
	const backend = CONFIG.Canvas.polygonBackends[type];
	for (const level of canvas.scene.levels) {
		const collisions = backend.testCollision(origin, destination, { type, mode: 'all', level, wavesIntersectionElevation: true });
		if (
			collisions.some((collision) => {
				const elevation = origin.elevation + (destination.elevation - origin.elevation) * collision._distance;
				return Array.from(collision.edges).some((edge) => wallBlocksAtElevation(edge.object, elevation));
			})
		)
			return true;
	}
	return false;
}

function getLevelTransition(origin, destination, originLevel, destinationLevel) {
	if (originLevel === destinationLevel) return 1;
	const delta = destination.elevation - origin.elevation;
	let [to0, to1] = delta ? [(originLevel.elevation.bottom - origin.elevation) / delta, (originLevel.elevation.top - origin.elevation) / delta] : originLevel.elevation.bottom <= origin.elevation && originLevel.elevation.top >= origin.elevation ? [-Infinity, Infinity] : [Infinity, -Infinity];
	let [td0, td1] = delta ? [(destinationLevel.elevation.bottom - origin.elevation) / delta, (destinationLevel.elevation.top - origin.elevation) / delta] : destinationLevel.elevation.bottom <= origin.elevation && destinationLevel.elevation.top >= origin.elevation ? [-Infinity, Infinity] : [Infinity, -Infinity];
	if (to0 > to1) [to0, to1] = [to1, to0];
	if (td0 > td1) [td0, td1] = [td1, td0];
	if (td0 > 1 || td1 < 0) return 1;
	if (to0 > 1 || to1 < 0) return 0;
	to1 = Math.min(to1, 1);
	td1 = Math.min(td1, 1);
	if (to1 > td1) return 1;
	to0 = Math.max(to0, 0);
	td0 = Math.max(td0, 0);
	return to0 > td0 ? 0 : Math.max(to1, td0);
}

function hasBlockingSurfaceCollision(origin, destination, type) {
	const originLevel = canvas.scene.levels.get(origin.level) ?? canvas.level;
	const destinationLevel = canvas.scene.levels.get(destination.level) ?? originLevel;
	const t = getLevelTransition(origin, destination, originLevel, destinationLevel);
	const epsilon = 1e-8;
	return canvas.scene.testSurfaceCollision(origin, destination, { type, mode: 'any', tMax: Math.min(1, t + epsilon), level: originLevel }) || (t < 1 && canvas.scene.testSurfaceCollision(origin, destination, { type, mode: 'any', tMin: Math.max(0, t - epsilon), level: destinationLevel }));
}

let wallHeightOverlay;

function drawDashedWall(graphics, coordinates, color) {
	const [x1, y1, x2, y2] = coordinates;
	const length = Math.hypot(x2 - x1, y2 - y1);
	if (!length) return;
	const dash = 10;
	const gap = 6;
	graphics.lineStyle(3, color, 0.85);
	for (let distance = 0; distance < length; distance += dash + gap) {
		const start = distance / length;
		const end = Math.min(distance + dash, length) / length;
		graphics.moveTo(Math.mix(x1, x2, start), Math.mix(y1, y2, start));
		graphics.lineTo(Math.mix(x1, x2, end), Math.mix(y1, y2, end));
	}
}

export function refreshWallHeightOverlay() {
	if (wallHeightOverlay && !wallHeightOverlay.destroyed) wallHeightOverlay.destroy({ children: true });
	wallHeightOverlay = null;
	if (!canvas.ready || !game.settings?.get(MODULE_ID, 'showPassableWallOverlay')) return;
	const token = canvas.tokens.controlled[0];
	if (!token) return;
	const bottom = Number(token.document.elevation ?? 0);
	const top = bottom + Math.max(Number(token.document.depth ?? 1), 1) * canvas.grid.distance;
	const graphics = canvas.controls?.addChild(new PIXI.Graphics());
	if (!graphics) return;
	graphics.eventMode = 'none';
	for (const wall of canvas.walls.placeables) {
		if (wall.document.move === CONST.WALL_MOVEMENT_TYPES.NONE) continue;
		if (!game.user.isGM && wall.document.door === CONST.WALL_DOOR_TYPES.SECRET) continue;
		if (wallOverlapsElevationRange(wall.document, bottom, top)) continue;
		const [x1, y1, x2, y2] = wall.document.c;
		if (hasBlockingWallVolumeCollision(token.center, { x: (x1 + x2) / 2, y: (y1 + y2) / 2 }, bottom, top)) continue;
		drawDashedWall(graphics, wall.document.c, 0x00ff88);
	}
	wallHeightOverlay = graphics;
}

function getVisibilityPoint(subject) {
	const document = subject?.document ?? subject;
	if (document?.documentName === 'Token') return { ...document.getVisionOrigin(), level: document.level };
	const point = {
		x: Number(subject?.x),
		y: Number(subject?.y),
		elevation: Number(subject?.elevation ?? 0),
		level: subject?.level ?? canvas.level?.id,
	};
	if (!Number.isFinite(point.x) || !Number.isFinite(point.y) || !Number.isFinite(point.elevation)) {
		throw new TypeError('Visibility endpoints must be points, Tokens, or TokenDocuments.');
	}
	return point;
}

function getTokenEyeProfile(subject) {
	const document = subject?.document ?? subject;
	const bottom = Number(document.elevation ?? 0);
	const depth = Number(document.depth);
	const height = (Number.isFinite(depth) && depth > 0 ? depth : 1) * canvas.grid.distance;
	const flags = document.flags?.[MODULE_ID] ?? document._source?.flags?.rat ?? {};
	const prone = resolveIsProne(subject);
	const effectiveHeight = height * (prone ? 0.5 : 1);
	const eyeHeightPercent = Number(prone ? 35 : flags.eyeHeightPercent ?? game.settings?.get(MODULE_ID, 'eyeHeightPercent') ?? 85);
	const eyeTolerancePercent = Number(prone ? 15 : flags.eyeTolerancePercent ?? game.settings?.get(MODULE_ID, 'eyeTolerancePercent') ?? 10);
	const sampleCount = Math.max(1, Math.floor(Number(prone ? 3 : flags.eyeSampleCount ?? game.settings?.get(MODULE_ID, 'eyeSampleCount') ?? 3)));
	const center = Math.clamp(bottom + (effectiveHeight * eyeHeightPercent) / 100, bottom, bottom + effectiveHeight);
	const tolerance = (effectiveHeight * Math.max(0, eyeTolerancePercent)) / 100;
	const min = Math.max(bottom, center - tolerance);
	const max = Math.min(bottom + effectiveHeight, center + tolerance);
	const elevations = sampleCount === 1 || min === max ? [center] : Array.from({ length: sampleCount }, (_, index) => min + ((max - min) * index) / (sampleCount - 1));
	return { prone, bottom, height: effectiveHeight, center, elevations };
}

export function getVisionOrigins(subject, { includePeeking } = {}) {
	includePeeking = includePeeking !== false && canSourcePeek(subject);
	const document = subject?.document ?? subject;
	const origin = getVisibilityPoint(subject);
	if (document?.documentName !== 'Token') {
		return [{ ...origin, direction: 'center', sampled: false, peek: false }];
	}

	const sourceMode = game.settings?.get(MODULE_ID, 'visionSourceMode') ?? 'singular';
	const eye = getTokenEyeProfile(subject);
	const xyPoints = new Map([[origin.x + ',' + origin.y, { x: origin.x, y: origin.y }]]);
	if (sourceMode === 'grid') {
		for (const point of getTokenVisibilityPoints(subject, 'grid')) {
			xyPoints.set(point.x + ',' + point.y, { x: point.x, y: point.y });
		}
	}

	const origins = [];
	const anchors = new Map(eye.elevations.map((elevation) => [elevation, getSourceSampleAnchor(document, origin, xyPoints, elevation)]));
	for (const point of xyPoints.values()) {
		for (const elevation of eye.elevations) {
			const anchor = anchors.get(elevation);
			if ((point.x !== origin.x || point.y !== origin.y) && getCachedCollision(anchor, { ...point, elevation }, 'sight')) continue;
			const centered = point.x === origin.x && point.y === origin.y && elevation === eye.center;
			origins.push({
				...point,
				elevation,
				level: document.level,
				direction: centered ? 'center' : 'sample',
				sampled: !centered,
				peek: false,
			});
		}
	}
	if (!includePeeking) return origins;

	const object = subject?.document ? subject : document.object;
	const bounds = object?.bounds;
	if (!bounds) return origins;
	const clearance = Math.max(1, Math.min(bounds.width, bounds.height) * 0.05);
	const offsets = {
		north: [0, -(bounds.height / 2 + clearance)],
		northeast: [bounds.width / 2 + clearance, -(bounds.height / 2 + clearance)],
		east: [bounds.width / 2 + clearance, 0],
		southeast: [bounds.width / 2 + clearance, bounds.height / 2 + clearance],
		south: [0, bounds.height / 2 + clearance],
		southwest: [-(bounds.width / 2 + clearance), bounds.height / 2 + clearance],
		west: [-(bounds.width / 2 + clearance), 0],
		northwest: [-(bounds.width / 2 + clearance), -(bounds.height / 2 + clearance)],
	};
	const blockedDirections = new Set();
	for (const elevation of eye.elevations) {
		const base = { x: origin.x, y: origin.y, elevation };
		let adjacentToCover = false;
		for (const [direction, [dx, dy]] of Object.entries(offsets)) {
			if (!hasBlockingWallCollision(base, { x: origin.x + dx, y: origin.y + dy, elevation }, 'sight')) continue;
			blockedDirections.add(direction);
			adjacentToCover = true;
		}
		if (!adjacentToCover) continue;
		for (const [horizontalDirection, [dx, dy]] of Object.entries(offsets)) {
			const candidate = {
				x: origin.x + dx,
				y: origin.y + dy,
				elevation,
				level: document.level,
				direction: horizontalDirection,
				sampled: false,
				peek: true,
			};
			if (!canvas.dimensions.rect.contains(candidate.x, candidate.y)) continue;
			if (hasBlockingWallCollision(base, candidate, 'sight')) continue;
			origins.push(candidate);
		}
	}
	for (const direction of blockedDirections) {
		const [dx, dy] = offsets[direction];
		for (const [verticalDirection, elevation] of [['above', eye.bottom + eye.height], ['below', eye.bottom]]) {
			const base = { x: origin.x, y: origin.y, elevation };
			const candidate = { x: origin.x + dx, y: origin.y + dy, elevation, level: document.level, direction: `${direction}-${verticalDirection}`, sampled: false, peek: true };
			if (!canvas.dimensions.rect.contains(candidate.x, candidate.y)) continue;
			if (hasBlockingWallCollision(base, candidate, 'sight')) continue;
			origins.push(candidate);
		}
	}
	return origins;
}
function getTokenVisibilityPoints(subject, sampleMode) {
	const document = subject?.document ?? subject;
	if (document?.documentName !== 'Token') return [getVisibilityPoint(subject)];

	if (!canvas.grid.isGridless) {
		const points = new Map();
		const shape = canvas.grid.getShape();
		const gridSampling = (sampleMode ?? game.settings?.get(MODULE_ID, 'visibilitySampleMode') ?? 'grid') === 'grid';
		const scale = gridSampling ? 1 : 0.5;
		const boundaryInset = gridSampling ? Math.max(1, canvas.grid.size * 0.01) : 0;
		const depth = Number(document.depth);
		const bottom = Number(document.elevation ?? 0);
		const height = (Number.isFinite(depth) && depth > 0 ? depth : 1) * canvas.grid.distance * (resolveIsProne(subject) ? 0.5 : 1);
		const elevationFractions = [0.05, 0.5, 0.95];
		for (const offset of document.getOccupiedGridSpaceOffsets({ level: null })) {
			const center = canvas.grid.getCenterPoint(offset);
			for (const fraction of elevationFractions) {
				const point = { ...center, elevation: bottom + height * fraction, level: document.level };
				points.set(`${point.x},${point.y},${point.elevation}`, point);
			}
			const boundary = shape.flatMap((vertex, index) => {
				const next = shape[(index + 1) % shape.length];
				return [vertex, { x: (vertex.x + next.x) / 2, y: (vertex.y + next.y) / 2 }];
			});
			for (const vertex of boundary) {
				const radius = Math.hypot(vertex.x, vertex.y);
				const insetScale = radius ? Math.max(0, (radius - boundaryInset) / radius) : 1;
				for (const fraction of elevationFractions) {
					const point = {
						x: center.x + vertex.x * scale * insetScale,
						y: center.y + vertex.y * scale * insetScale,
						elevation: bottom + height * fraction,
						level: document.level,
					};
					points.set(`${point.x},${point.y},${point.elevation}`, point);
				}
			}
		}
		return Array.from(points.values());
	}

	const object = subject?.document ? subject : document.object;
	const bounds = object?.bounds;
	if (!bounds) return [{ ...document.getVisionOrigin(), level: document.level }];
	const bottom = Number(document.elevation ?? 0);
	const depth = Number(document.depth);
	const height = (Number.isFinite(depth) && depth > 0 ? depth : 1) * canvas.grid.distance * (resolveIsProne(subject) ? 0.5 : 1);
	const horizontalFractions = [0.01, 0.5, 0.99];
	const elevationFractions = [0.05, 0.5, 0.95];
	return elevationFractions.flatMap((z) =>
		horizontalFractions.flatMap((y) =>
			horizontalFractions.map((x) => ({
				x: bounds.x + bounds.width * x,
				y: bounds.y + bounds.height * y,
				elevation: bottom + height * z,
				level: document.level,
			})),
		),
	);
}

function getReachableTokenVisibilityPoints(subject) {
	const document = subject?.document ?? subject;
	const samples = getTokenVisibilityPoints(subject);
	if (document?.documentName !== 'Token') return samples;
	const origin = getVisibilityPoint(subject);
	const xyPoints = new Map(samples.map((sample) => [`${sample.x},${sample.y}`, sample]));
	const anchors = new Map();
	return samples.filter((sample) => {
		if (sample.x === origin.x && sample.y === origin.y) return true;
		if (!anchors.has(sample.elevation)) anchors.set(sample.elevation, getSourceSampleAnchor(document, origin, xyPoints, sample.elevation));
		return !getCachedCollision(anchors.get(sample.elevation), sample, 'sight');
	});
}

export function testVisibility(source, target) {
	const origin = getVisibilityPoint(source);
	const destination = getVisibilityPoint(target);
	return !hasBlockingWallCollision(origin, destination, 'sight');
}

function showVisibilitySampleRays(origin, results, options) {
	const config = options === true ? {} : options;
	const duration = Math.max(0, Number(config.duration ?? 3)) * 1000;
	const limits = {
		true: Math.max(0, Math.floor(Number(config.success ?? 5))),
		false: Math.max(0, Math.floor(Number(config.fail ?? 5))),
	};
	if (!duration || (!limits.true && !limits.false)) return;

	const graphics = canvas.controls?.addChild(new PIXI.Graphics());
	if (!graphics) return;
	graphics.eventMode = 'none';
	const drawn = { true: 0, false: 0 };
	for (const { destination, visible, origin: resultOrigin } of results) {
		if (drawn[visible] >= limits[visible]) continue;
		drawn[visible]++;
		const color = visible ? 0x00ff00 : 0xff0000;
		const rayOrigin = resultOrigin ?? origin;
		graphics.lineStyle(2, color, 0.8).moveTo(rayOrigin.x, rayOrigin.y).lineTo(destination.x, destination.y);
		graphics.beginFill(color, 0.9).drawCircle(destination.x, destination.y, 3).endFill();
	}
	setTimeout(() => {
		if (!graphics.destroyed) graphics.destroy({ children: true });
	}, duration);
}

function logVisibilityDebug(source, target, calculationMode, origins, samples, measurements, options) {
	const describeToken = (subject) => {
		const document = subject?.document ?? subject;
		return {
			id: document?.id,
			name: document?.name,
			x: document?.x,
			y: document?.y,
			elevation: document?.elevation,
			width: document?.width,
			height: document?.height,
			depth: document?.depth,
			level: document?.level,
		};
	};
	const sourcePoint = getVisibilityPoint(source);
	const targetPoint = getVisibilityPoint(target);
	const dxPixels = targetPoint.x - sourcePoint.x;
	const dyPixels = targetPoint.y - sourcePoint.y;
	const distanceScale = canvas.grid.distance / canvas.grid.size;
	const rays = measurements.flatMap(({ origin, results }) => results.map((result) => {
		const originLevel = canvas.scene.levels.get(origin.level) ?? canvas.level;
		const destinationLevel = canvas.scene.levels.get(result.destination.level) ?? originLevel;
		return {
			origin,
			destination: result.destination,
			transition: getLevelTransition(origin, result.destination, originLevel, destinationLevel),
			wallCollision: result.wallCollision,
			surfaceCollision: result.surfaceCollision,
			visible: result.visible,
		};
	}));
	const describeRay = ({ origin, destination, transition, wallCollision, surfaceCollision, visible }) => ({
		origin,
		destination,
		transition,
		wallCollision,
		surfaceCollision,
		visible,
	});
	const wallIntersections = Array.from(canvas.scene.walls).flatMap((wall) => {
		const [x1, y1, x2, y2] = wall.c;
		const intersections = rays.filter((ray) => ray.visible).flatMap((ray) => {
			const point = foundry.utils.lineSegmentIntersection(ray.origin, ray.destination, { x: x1, y: y1 }, { x: x2, y: y2 });
			if (!point) return [];
			const elevation = ray.origin.elevation + (ray.destination.elevation - ray.origin.elevation) * point.t0;
			return [{ point: { x: point.x, y: point.y }, elevation, blocksAtElevation: wallBlocksAtElevation(wall, elevation) }];
		}).slice(0, 5);
		return intersections.length ? [{ id: wall.id, name: wall.name, coordinates: wall.c, sight: wall.sight, levels: Array.from(wall.levels), heights: getWallElevationRanges(wall), intersections }] : [];
	});
	console.log(JSON.stringify({
		waves: 'measureVisibility',
		calculationMode,
		source: describeToken(source),
		target: describeToken(target),
		horizontal: {
			dx: dxPixels * distanceScale,
			dy: dyPixels * distanceScale,
			distance: Math.hypot(dxPixels, dyPixels) * distanceScale,
			units: canvas.scene.grid.units,
		},
		options,
		levels: Array.from(canvas.scene.levels, (level) => ({ id: level.id, name: level.name, elevation: level.elevation })),
		surfaces: canvas.scene.getSurfaces({ type: options.type }).map((surface) => ({
			key: surface.key,
			elevation: surface.elevation,
			region: surface.region.id,
			regionName: surface.region.name,
			regionElevation: surface.region.elevation,
			levels: Array.from(surface.region.levels ?? []),
		})),
		wallIntersections,
		counts: {
			origins: origins.length,
			samples: samples.length,
			rays: rays.length,
			visible: rays.filter((ray) => ray.visible).length,
			wallBlocked: rays.filter((ray) => ray.wallCollision).length,
			surfaceBlocked: rays.filter((ray) => ray.surfaceCollision).length,
		},
		visibleOrigins: measurements.filter((measurement) => measurement.visibleSamples).slice(0, 5).map((measurement) => ({ origin: measurement.origin, visibleSamples: measurement.visibleSamples })),
		visibleRays: rays.filter((ray) => ray.visible).slice(0, 5).map(describeRay),
		surfaceBlockedRays: rays.filter((ray) => ray.surfaceCollision).slice(0, 5).map(describeRay),
	}));
}
export function measureVisibility(source, target, { showTestSamples = false, type = 'sight', includeSurfaces = true, ignoreHidden = false, usePeeking } = {}) {
	const sampledMode = (game.settings?.get(MODULE_ID, 'visibilityCalculationMode') ?? 'foundry') === 'sampled';
	if (!sampledMode) {
		const origin = getVisibilityPoint(source);
		const destination = getVisibilityPoint(target);
		const wallCollision = hasBlockingWallCollision(origin, destination, type);
		const surfaceCollision = !wallCollision && includeSurfaces && hasBlockingSurfaceCollision(origin, destination, type);
		const visible = !wallCollision && !surfaceCollision;
		const hidden = !ignoreHidden && resolveIsHidden(target);
		const detected = visible && !hidden;
		if (showTestSamples) {
			const results = [{ destination, wallCollision, surfaceCollision, visible }];
			showVisibilitySampleRays(origin, results, showTestSamples);
			logVisibilityDebug(source, target, 'foundry', [origin], [destination], [{ origin, results }], { type, includeSurfaces });
		}
		return {
			visible, detected, attackable: detected, attackableInTurn: detected, hidden,
			percentage: visible ? 100 : 0, cover: null, coverBonus: 0,
			visibleSamples: Number(visible), totalSamples: 1, origin: { ...origin },
			peekUsed: false, peekDirection: null,
			originX: origin.x, originY: origin.y, originElevation: origin.elevation,
			peek: { used: false, direction: null }, baseVisibleSamples: Number(visible),
		};
	}
	const includePeeking = usePeeking !== false && canSourcePeek(source);
	const origins = getVisionOrigins(source, { includePeeking });
	const samples = getReachableTokenVisibilityPoints(target);
	const measurements = origins.map((origin) => {
		const results = samples.map((destination) => {
			const wallCollision = hasBlockingWallCollision(origin, destination, type);
			const surfaceCollision = !wallCollision && includeSurfaces && hasBlockingSurfaceCollision(origin, destination, type);
			return { destination, wallCollision, surfaceCollision, visible: !wallCollision && !surfaceCollision };
		});
		return { origin, results, visibleSamples: results.reduce((count, result) => count + result.visible, 0) };
	});
	const combineMeasurements = (candidates) => {
		const results = samples.map((destination, index) => {
			const measurement = candidates.find((candidate) => candidate.results[index].visible);
			return { destination, visible: Boolean(measurement), origin: measurement?.origin };
		});
		return { results, visibleSamples: results.reduce((count, result) => count + result.visible, 0) };
	};
	const baseMeasurement = combineMeasurements(measurements.filter((candidate) => !candidate.origin.peek));
	const measurement = combineMeasurements(measurements);
	const { results, visibleSamples } = measurement;
	const peekUsed = visibleSamples > baseMeasurement.visibleSamples;
	const origin = (peekUsed ? results.find((result) => result.visible && result.origin?.peek)?.origin : null) ?? results.find((result) => result.visible)?.origin ?? origins[0];
	const totalSamples = samples.length;
	const percentage = totalSamples ? (visibleSamples / totalSamples) * 100 : 0;
	const cover =
		percentage === 0 ? 'total'
		: percentage <= 25 ? 'threeQuarters'
		: percentage <= 50 ? 'half'
		: 'none';
	const visible = visibleSamples > 0;

	const hidden = !ignoreHidden && resolveIsHidden(target);
	const detected = visible && !hidden;
	const attackable = detected && cover !== 'total';
	const sourceTurn = isSourceTurn(source);
	const attackableInTurn = attackable && (!peekUsed || sourceTurn);
	if (showTestSamples) {
		showVisibilitySampleRays(origin, measurements.flatMap((measurement) => measurement.results.map((result) => ({ ...result, origin: measurement.origin }))), showTestSamples);
		logVisibilityDebug(source, target, 'sampled', origins, samples, measurements, { type, includeSurfaces, includePeeking });
	}
	return {
		visible,
		detected,
		attackable,
		attackableInTurn,
		hidden,
		percentage,
		cover,
		coverBonus:
			cover === 'threeQuarters' ? 5
			: cover === 'half' ? 2
			: 0,
		visibleSamples,
		totalSamples,
		origin: { ...origin },
		peekUsed,
		peekDirection: peekUsed ? origin.direction : null,
		originX: origin.x,
		originY: origin.y,
		originElevation: origin.elevation,
		peek: {
			used: peekUsed,
			direction: peekUsed ? origin.direction : null,
		},
		baseVisibleSamples: baseMeasurement.visibleSamples,
	};
}

export function getIssueReportData(source, target, options = {}) {
	if (!source && !target) {
		const controlled = canvas.tokens.controlled;
		if (controlled.length === 1 && game.user.targets.size === 1) {
			source = controlled[0];
			target = Array.from(game.user.targets)[0];
		} else if (controlled.length === 2) [source, target] = controlled;
	}
	if (!source || !target) throw new Error('Control one source token and target one token, or control exactly two tokens.');
	const scene = canvas.scene;
	const describeToken = (subject) => {
		const document = subject.document ?? subject;
		return {
			id: document.id, name: document.name, x: document.x, y: document.y,
			elevation: document.elevation, width: document.width, height: document.height, depth: document.depth, level: document.level,
		};
	};
	const settingKeys = [
		'newWallHeightMode', 'visibilityCalculationMode', 'peekingMode', 'visibilitySampleMode',
		'visionSourceMode', 'eyeHeightPercent', 'eyeTolerancePercent', 'eyeSampleCount',
		'showPassableWallOverlay', 'synchronizeTokenLevel', 'performanceDebug',
	];
	return {
		waves: 'issueReport',
		versions: {
			foundry: game.version,
			system: { id: game.system.id, version: game.system.version },
			waves: game.modules.get(MODULE_ID)?.version,
		},
		activeModules: Array.from(game.modules.values()).filter((module) => module.active).map((module) => ({ id: module.id, version: module.version })),
		tokens: { source: describeToken(source), target: describeToken(target) },
		options: { type: options.type ?? 'sight', includeSurfaces: options.includeSurfaces ?? true, usePeeking: options.usePeeking },
		scene: {
			id: scene.id,
			name: scene.name,
			grid: { type: scene.grid.type, size: scene.grid.size, distance: scene.grid.distance, units: scene.grid.units },
			levels: Array.from(scene.levels, (level) => ({ id: level.id, name: level.name, elevation: level.elevation })),
			surfaces: scene.getSurfaces({ type: options.type ?? 'sight' }).map((surface) => ({
				elevation: surface.elevation,
				region: surface.region.id,
				regionName: surface.region.name,
				regionElevation: surface.region.elevation,
				levels: Array.from(surface.region.levels ?? []),
			})),
			walls: Array.from(scene.walls, (wall) => ({
				id: wall.id,
				coordinates: wall.c,
				levels: Array.from(wall.levels),
				heights: getWallElevationRanges(wall),
				move: wall.move,
				sight: wall.sight,
				light: wall.light,
				door: wall.door,
				doorState: wall.ds,
			})),
		},
		settings: Object.fromEntries(settingKeys.map((key) => [key, game.settings.get(MODULE_ID, key)])),
		visibility: measureVisibility(source, target, { ...options, showTestSamples: false }),
	};
}
let heightVisibilityCache = new Map();
let heightIlluminationCache = new Map();
let heightSightDetectionFilter;
let heightLightDetectionFilter;
let movementVisibilityCache = new Map();
let collisionCache = new Map();
let sampledVisionSources = new Map();
const sourceAnchorHistory = new Map();
const movementGenerations = new WeakMap();
const movingTokens = new Set();

function isTokenMovementInProgress() {
	if (movingTokens.size) return true;
	if (canvas.tokens?.preview?.children?.length) return true;
	return false;
}

function getHeightDetectionFilter(type) {
	const current = type === 'light' ? heightLightDetectionFilter : heightSightDetectionFilter;
	if (current) return current;
	const filter = foundry.canvas.rendering.filters.OutlineOverlayFilter.create({
		outlineColor: type === 'light' ? [1, 0.65, 0, 1] : [0, 0.85, 1, 1],
		knockout: true,
	});
	if (type === 'light') heightLightDetectionFilter = filter;
	else heightSightDetectionFilter = filter;
	return filter;
}
function getMovementVisibilityKey(detectionMode, visionSource, target) {
	const sourceId = visionSource.object?.document?.uuid ?? visionSource.object?.id;
	const targetId = target.document?.uuid ?? target.id;
	return `${detectionMode.id}:${sourceId}:${targetId}:${visionSource.constructor.sourceType ?? 'sight'}`;
}

function isSourceTurn(source) {
	const sourceDocument = source?.document ?? source;
	return !game.combat?.started || game.combat.combatant?.tokenId === sourceDocument?.id;
}

function canSourcePeek(source) {
	return (game.settings?.get(MODULE_ID, 'peekingMode') ?? 'disabled') === 'auto' && isSourceTurn(source);
}

function prioritizeAutomaticSamples(samples, reference, limit) {
	const groups = new Map();
	for (const sample of samples) {
		const key = `${sample.x}:${sample.y}`;
		if (!groups.has(key)) groups.set(key, []);
		groups.get(key).push(sample);
	}
	return Array.from(groups.values())
		.sort((a, b) => Math.hypot(a[0].x - reference.x, a[0].y - reference.y) - Math.hypot(b[0].x - reference.x, b[0].y - reference.y))
		.flatMap((group) => {
			const sorted = group.toSorted((a, b) => a.elevation - b.elevation);
			return [sorted[0], sorted[Math.floor((sorted.length - 1) / 2)], sorted.at(-1)].filter((sample, index, selected) => selected.indexOf(sample) === index);
		})
		.slice(0, limit);
}

function getAutomaticVisionOrigins(source, target) {
	const includePeeking = canSourcePeek(source);
	const origins = getVisionOrigins(source, { includePeeking });
	const reference = getVisibilityPoint(target);
	const base = prioritizeAutomaticSamples(origins.filter((origin) => !origin.peek), reference, 18);
	const peeking = includePeeking ? prioritizeAutomaticSamples(origins.filter((origin) => origin.peek), reference, 9) : [];
	return [...base, ...peeking];
}

function getAutomaticTargetSamples(source, target) {
	return prioritizeAutomaticSamples(getReachableTokenVisibilityPoints(target), getVisibilityPoint(source), 27);
}

function getCachedCollision(origin, destination, type, surface = false) {
	const key = `${surface ? 'surface' : 'wall'}:${type}:${origin.x}:${origin.y}:${origin.elevation}:${destination.x}:${destination.y}:${destination.elevation}`;
	if (collisionCache.has(key)) return collisionCache.get(key);
	const collision = surface ? hasBlockingSurfaceCollision(origin, destination, type) : hasBlockingWallCollision(origin, destination, type);
	collisionCache.set(key, collision);
	return collision;
}

function hasAnySampledVisibility(source, target, type) {
	if ((game.settings?.get(MODULE_ID, 'visibilityCalculationMode') ?? 'foundry') !== 'sampled') {
		const origin = getVisibilityPoint(source);
		const destination = getVisibilityPoint(target);
		return !hasBlockingWallCollision(origin, destination, type) && !hasBlockingSurfaceCollision(origin, destination, type);
	}
	const origins = getAutomaticVisionOrigins(source, target);
	const samples = getAutomaticTargetSamples(source, target);
	for (const origin of origins) {
		for (const destination of samples) {
			if (getCachedCollision(origin, destination, type)) continue;
			if (getCachedCollision(origin, destination, type, true)) continue;
			return true;
		}
	}
	return false;
}

function isPointWithinLightSource(source, point) {
	const origin = source.origin;
	const radius = Number(source.radius ?? source.data?.radius ?? 0);
	if (!origin || radius <= 0) return false;
	const elevationScale = canvas.grid.size / canvas.grid.distance;
	const dz = (point.elevation - origin.elevation) * elevationScale;
	if (Math.hypot(point.x - origin.x, point.y - origin.y, dz) > radius) return false;
	const angle = Number(source.data?.angle ?? 360);
	if (angle >= 360) return true;
	const direction = Math.toDegrees(Math.atan2(point.y - origin.y, point.x - origin.x));
	const minimum = Number(source.data?.rotation ?? 0) + 90 - angle / 2;
	return (((direction - minimum) % 360) + 360) % 360 <= angle;
}

function isHeightAwareIlluminated(target) {
	const targetId = target.document?.uuid ?? target.id;
	if (heightIlluminationCache.has(targetId)) return heightIlluminationCache.get(targetId);
	const samples = getReachableTokenVisibilityPoints(target);
	const illuminated = canvas.effects.lightSources.some((source) => {
		if (!source.active || source.suppression?.darkness) return false;
		const origin = source.origin;
		return samples.some((destination) => isPointWithinLightSource(source, destination)
			&& !getCachedCollision(origin, destination, 'light')
			&& !getCachedCollision(origin, destination, 'light', true));
	});
	heightIlluminationCache.set(targetId, illuminated);
	return illuminated;
}
function hasMatchingSurfaceFootprint(point, reference, level) {
	for (const surface of canvas.scene.getSurfaces({ type: 'sight', level })) {
		const elevation = surface.elevation;
		const pointInside = surface.region.polygonTree.testPoint({ x: point.x, y: point.y, elevation }, 0.75);
		const referenceInside = surface.region.polygonTree.testPoint({ x: reference.x, y: reference.y, elevation }, 0.75);
		if (pointInside !== referenceInside) return false;
	}
	return true;
}
function getSampledVisionSources(visionSource) {
	const token = visionSource.object;
	if (!token?.document || isTokenMovementInProgress()) return [];
	const key = token.document.uuid;
	if (sampledVisionSources.has(key)) return sampledVisionSources.get(key);
	const data = token._getVisionSourceData();
	const coreOrigin = token.document.getVisionOrigin();
	const sources = getVisionOrigins(token, { includePeeking: false })
		.filter((origin) => hasMatchingSurfaceFootprint(origin, coreOrigin, token.document.level))
		.filter((origin) => !(origin.x.almostEqual(coreOrigin.x) && origin.y.almostEqual(coreOrigin.y) && origin.elevation.almostEqual(coreOrigin.elevation)))
		.map((origin, index) => {
			const source = new CONFIG.Canvas.visionSourceClass({ sourceId: `${token.sourceId}.waves.${index}`, object: token });
			source.initialize({ ...data, x: origin.x, y: origin.y, elevation: origin.elevation, level: origin.level ?? data.level });
			return source;
		});
	sampledVisionSources.set(key, sources);
	return sources;
}

function drawSampledVision(visibility) {
	if ((game.settings?.get(MODULE_ID, 'visibilityCalculationMode') ?? 'foundry') !== 'sampled') return;
	if (isTokenMovementInProgress()) return;
	for (const visionSource of canvas.effects.visionSources) {
		if (!visionSource.active || visionSource.isBlinded || visionSource.isPreview) continue;
		for (const source of getSampledVisionSources(visionSource)) {
			if (source.radius > 0) visibility.vision.sight.drawShape(source.shape);
			if (source.lightRadius > 0) visibility.vision.light.mask.drawShape(source.light);
		}
	}
}
function getCachedHeightVisibility(visionSource, target) {
	const type = visionSource.constructor.sourceType ?? 'sight';
	const sourceId = visionSource.object?.document?.uuid ?? visionSource.object?.id;
	const targetId = target.document?.uuid ?? target.id;
	const key = `${sourceId}:${targetId}:${type}`;
	if (heightVisibilityCache.has(key)) return heightVisibilityCache.get(key);
	const visible = profile('hasAnySampledVisibility', () => hasAnySampledVisibility(visionSource.object, target, type));
	heightVisibilityCache.set(key, visible);
	return visible;
}

export function registerHeightAwareVisibilityHooks() {
	const invalidateHeightVisibilityCache = () => {
		heightVisibilityCache = new Map();
		heightIlluminationCache = new Map();
		movementVisibilityCache = new Map();
		collisionCache = new Map();
		for (const sources of sampledVisionSources.values()) for (const source of sources) source.destroy();
		sampledVisionSources = new Map();
	};
	const refreshSightSurfaces = () => {
		invalidateHeightVisibilityCache();
		canvas.perception.update({ initializeVision: true, refreshVision: true });
	};
	const hasSightSurface = (region) => region.behaviors.some((behavior) => behavior.type === 'defineSurface' && behavior.system.sight);
	Hooks.on('visibilityRefresh', drawSampledVision);
	Hooks.on('initializeLightSources', () => { heightIlluminationCache = new Map(); });
	Hooks.on('canvasReady', () => {
		invalidateHeightVisibilityCache();
		refreshWallHeightOverlay();
	});
	Hooks.on('controlToken', refreshWallHeightOverlay);
	Hooks.on('updateWall', () => {
		invalidateHeightVisibilityCache();
		refreshWallHeightOverlay();
	});
	for (const hook of ['createRegion', 'updateRegion', 'deleteRegion']) {
		Hooks.on(hook, (region) => {
			if (hasSightSurface(region)) refreshSightSurfaces();
		});
	}
	for (const hook of ['createRegionBehavior', 'updateRegionBehavior', 'deleteRegionBehavior']) {
		Hooks.on(hook, (behavior, change) => {
			if (behavior.type === 'defineSurface' && (behavior.system.sight || foundry.utils.hasProperty(change ?? {}, 'system.sight'))) refreshSightSurfaces();
		});
	}
	Hooks.on('updateCombat', (combat, change) => {
		if (!['round', 'turn', 'active'].some((field) => foundry.utils.hasProperty(change, field))) return;
		invalidateHeightVisibilityCache();
		canvas.perception.update({ initializeVision: true, refreshVision: true });
	});
	Hooks.on('deleteCombat', () => {
		invalidateHeightVisibilityCache();
		canvas.perception.update({ initializeVision: true, refreshVision: true });
	});
	libWrapper.register(
		MODULE_ID,
		'foundry.canvas.placeables.Token.prototype._onUpdate',
		function (wrapped, changed, options, userId) {
			const moved = ['x', 'y'].some((field) => foundry.utils.hasProperty(changed, field));
			const previousOrigin = moved ? { x: this.center.x, y: this.center.y } : null;
			const movement = moved || ['elevation', 'rotation', 'width', 'height', 'depth', 'level'].some((field) => foundry.utils.hasProperty(changed, field));
			if (moved) sourceAnchorHistory.set(this.document.uuid, previousOrigin);
			const generation = movement ? (movementGenerations.get(this) ?? 0) + 1 : 0;
			if (movement) {
				movementGenerations.set(this, generation);
				movingTokens.add(this);
			} else invalidateHeightVisibilityCache();
			const result = profile('Token._onUpdate', () => wrapped(changed, options, userId));
			if (movement) {
				Promise.resolve(this.movementAnimationPromise).finally(() => {
					if (movementGenerations.get(this) !== generation) return;
					movementGenerations.delete(this);
					movingTokens.delete(this);
					invalidateHeightVisibilityCache();
					if (!movingTokens.size) {
						canvas.perception.update({ initializeVision: true, refreshVision: true });
						refreshWallHeightOverlay();
					}
				});
			}
			return result;
		},
		'WRAPPER',
	);
	libWrapper.register(
		MODULE_ID,
		'foundry.canvas.geometry.ClockwiseSweepPolygon.prototype._testEdgeInclusion',
		function (wrapped, edge, edgeTypes) {
			return profile('ClockwiseSweepPolygon._testEdgeInclusion', () => {
				const included = wrapped(edge, edgeTypes);
				if (!included) return false;
				if (this.config.type === 'sight') {
					if (this.config.wavesIntersectionElevation) return true;
					return wallBlocksAtElevation(edge.object, this.origin.elevation);
				}
				if (this.config.type !== 'move') return true;
				const document = this.config.source?.object?.document;
				if (document?.documentName !== 'Token') return true;
				const height = Math.max(Number(document.depth ?? 1), 1) * canvas.grid.distance;
				const bottom = Number(this.origin.elevation) - height / 2;
				return wallOverlapsElevationRange(edge.object, bottom, bottom + height);
			});
		},
		'MIXED',
	);
	libWrapper.register(
		MODULE_ID,
		'foundry.canvas.perception.DetectionMode.prototype._testLOS',
		function (wrapped, visionSource, mode, target, test) {
			return profile('DetectionMode._testLOS', () => {
				const coreVisible = wrapped(visionSource, mode, target, test);
				const cacheKey = target?.document ? getMovementVisibilityKey(this, visionSource, target) : null;
				if (cacheKey && isTokenMovementInProgress()) {
					const cached = movementVisibilityCache.get(cacheKey);
					if (cached) {
						if (cached.detectionFilter) target.detectionFilter = cached.detectionFilter;
						return cached.visible;
					}
				}
				let visible = coreVisible;
				if (this.walls && target?.document && this.type === this.constructor.DETECTION_TYPES.SIGHT && this._testAngle(visionSource, mode, target, test) && (coreVisible || !resolveIsHidden(target))) {
					visible = getCachedHeightVisibility(visionSource, target);
					const detectionFilter = visible && !coreVisible ? getHeightDetectionFilter('sight') : null;
					if (detectionFilter) target.detectionFilter = detectionFilter;
				}
				if (cacheKey) movementVisibilityCache.set(cacheKey, { visible, detectionFilter: visible ? target.detectionFilter : null });
				return visible;
			});
		},
		'MIXED',
	);
	libWrapper.register(
		MODULE_ID,
		'foundry.canvas.perception.DetectionModeLightPerception.prototype._testPoint',
		function (wrapped, visionSource, mode, target, test) {
			const visible = wrapped(visionSource, mode, target, test);
			if (visible || !target?.document) return visible;
			if (!this._testRange(visionSource, mode, target, test) || !this._testAngle(visionSource, mode, target, test)) return false;
			const heightVisible = getCachedHeightVisibility(visionSource, target) && isHeightAwareIlluminated(target);
			if (heightVisible) target.detectionFilter = getHeightDetectionFilter('light');
			return heightVisible;
		},
		'MIXED',
	);
}
