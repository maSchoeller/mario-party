import { h } from './dom';

/** Wordmark generated for v0.6 (docs/ASSETS_LICENSES.md). */
export const LOGO_URL = '/media/ui/logo.webp';

/** Star and coin tokens drawn in CSS (base.css), shared by TV HUD and phone. */
export const starIcon = (): HTMLElement => h('i', { class: 'ico-star', 'aria-hidden': 'true' });
export const coinIcon = (): HTMLElement => h('i', { class: 'ico-coin', 'aria-hidden': 'true' });
