export function revealHomeItem(element: HTMLElement): void {
  const bounds = element.getBoundingClientRect();
  if (bounds.top < 0 || bounds.bottom > window.innerHeight) {
    element.scrollIntoView({ block: 'nearest', behavior: 'instant' });
  }
  element.querySelector<HTMLElement>('textarea, input')?.focus({ preventScroll: true });
}
