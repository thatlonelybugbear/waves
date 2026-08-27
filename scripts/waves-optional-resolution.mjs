let adapter = {
  isProne: () => false,
  isHidden: () => false
};

export function registerOptionalResolutionAdapter(overrides={}) {
  adapter = { ...adapter, ...overrides };
}

export function resolveIsProne(subject) {
  return adapter.isProne(subject);
}

export function resolveIsHidden(subject) {
  return adapter.isHidden(subject);
}