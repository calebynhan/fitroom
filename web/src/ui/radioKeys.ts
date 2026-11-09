import type { KeyboardEvent } from 'react';

const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * Arrow keys / Home / End inside a role="radiogroup": move focus to the next radio and select it (the ARIA radio
 * group pattern). Put on the group element; pair with rovingTab() so only the checked radio is in the Tab order.
 */
export function onRadioKeys(e: KeyboardEvent<HTMLElement>): void {
  const radios = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)'));
  const index = radios.indexOf(document.activeElement as HTMLButtonElement);
  if (index < 0 || radios.length < 2) return;
  let next: number;
  if (e.key in STEP) next = (index + STEP[e.key] + radios.length) % radios.length;
  else if (e.key === 'Home') next = 0;
  else if (e.key === 'End') next = radios.length - 1;
  else return;
  e.preventDefault();
  radios[next].focus();
  radios[next].click();
}

/** tabIndex for a radio: the checked one (or the first, if none is checked) is reachable with Tab. */
export function rovingTab(checked: boolean, index: number, anyChecked: boolean): 0 | -1 {
  return checked || (!anyChecked && index === 0) ? 0 : -1;
}
