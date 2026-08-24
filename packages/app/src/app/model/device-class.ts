/**
 * Whether this looks like a phone. Not a browser sniff: a coarse pointer on a small screen,
 * or a device that admits to having little memory. Getting it wrong costs a default, not a
 * feature, and the model picker is right there.
 */
export function looksLikeAPhone(): boolean {
  const memory = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  if (typeof memory === 'number' && memory <= 4) {
    return true;
  }

  const shortSide = Math.min(screen.width, screen.height);
  return navigator.maxTouchPoints > 0 && shortSide < 820;
}
