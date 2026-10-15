import type { Page } from '@playwright/test';

/** Match the visible form submission action, not an image URL's adjacent save button. */
export function visibleSubmitButton(page: Page) {
  return page.locator('button[type="submit"]:visible').last();
}
