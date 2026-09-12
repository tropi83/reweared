/**
 * DOM anchors on Vinted's sell form (https://www.vinted.<tld>/items/new). Ordered candidate lists:
 * the first match wins. When Vinted changes its markup, only this file changes.
 * Not yet verified against the live form (update the date here and in DEVELOPMENT.md once checked).
 */
export interface VintedSelectors {
  sellFormRoot: string[];
  titleInput: string[];
  descriptionInput: string[];
  photoInput: string[];
  photoThumbnail: string[];
}

export const VINTED_SELECTORS: VintedSelectors = {
  sellFormRoot: ['[data-testid="item-upload-form"]', 'form[action*="/items"]', "form"],
  titleInput: ['[data-testid="title--input"]', 'input[name="title"]', "input#title"],
  descriptionInput: ['[data-testid="description--input"]', 'textarea[name="description"]', "textarea#description"],
  photoInput: ['[data-testid="photo-input"]', 'input[type="file"][accept*="image"]', 'input[type="file"]'],
  photoThumbnail: ['[data-testid="photo-thumbnail"]', '[data-testid*="media-thumbnail"]', 'img[src^="blob:"]'],
};
