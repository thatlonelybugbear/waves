import { registerOptionalResolutionAdapter } from '../waves-optional-resolution.mjs';

function isProne(subject) {
	return subject?.actor?.statuses?.has?.('prone');
}

function isHidden(subject) {
	const tokenDocument = subject?.document ?? subject;
	if (!tokenDocument) return false;
	if (tokenDocument?.hidden) return true;
	return subject?.actor?.statuses?.has?.('hiding');
}

export function registerDnd5eVisibilityAdapter() {
	registerOptionalResolutionAdapter({ isProne, isHidden });
}
