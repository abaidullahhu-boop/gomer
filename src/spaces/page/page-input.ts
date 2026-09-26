import { BadRequestException } from '@nestjs/common';
import { isObject } from '../spec/validate-spec';

/** Largest page Gaspo may save, in characters. A generous plan is 40–60K. */
export const MAX_PAGE_CHARS = 300_000;

/** Largest single value a page may save to its state, as JSON. */
export const MAX_STATE_VALUE_CHARS = 100_000;

/** A new page, as the model describes it. */
export interface PageInput {
  name: string;
  description: string | null;
  html: string;
  allowSignup: boolean;
}

/** One targeted change to a page: `find` must occur exactly once. */
export interface PageEdit {
  find: string;
  replace: string;
}

/** Validates a page's HTML: a non-empty document within the size limit. */
export function validatePageHtml(html: unknown): string {
  if (typeof html !== 'string' || html.trim() === '') {
    throw new BadRequestException('html must be the whole page as one HTML document');
  }
  if (html.length > MAX_PAGE_CHARS) {
    throw new BadRequestException(
      `html is ${html.length} characters; a page may be at most ${MAX_PAGE_CHARS}. Make it shorter`,
    );
  }
  if (!/<[a-z!]/i.test(html)) {
    throw new BadRequestException('html must be an HTML document, not plain text');
  }
  return html;
}

/** Validates the model's input for a new page. */
export function validatePageInput(input: unknown): PageInput {
  if (!isObject(input)) throw new BadRequestException('page input must be an object');
  if (typeof input.name !== 'string' || input.name.trim() === '') {
    throw new BadRequestException('name is required');
  }
  if (input.description !== undefined && typeof input.description !== 'string') {
    throw new BadRequestException('description must be a string');
  }
  if (input.allowSignup !== undefined && typeof input.allowSignup !== 'boolean') {
    throw new BadRequestException('allowSignup must be a boolean');
  }
  return {
    name: input.name.trim(),
    description: typeof input.description === 'string' ? input.description : null,
    html: validatePageHtml(input.html),
    allowSignup: input.allowSignup === true,
  };
}

/**
 * Applies find/replace edits to a page, in order, all or nothing. Each `find`
 * must match exactly once where it is applied: no match means the model is
 * working from a stale or misremembered copy, and several means the edit would
 * land somewhere it did not intend. Either way it is told which edit and why.
 */
export function applyPageEdits(html: string, edits: unknown): string {
  if (!Array.isArray(edits) || edits.length === 0) {
    throw new BadRequestException('edits must be a non-empty list of { find, replace }');
  }
  const errors: string[] = [];
  let result = html;
  edits.forEach((edit: unknown, i) => {
    if (!isObject(edit) || typeof edit.find !== 'string' || typeof edit.replace !== 'string') {
      errors.push(`edits[${i}] must be { find: string, replace: string }`);
      return;
    }
    if (edit.find === '') {
      errors.push(`edits[${i}].find is empty`);
      return;
    }
    const matches = result.split(edit.find).length - 1;
    if (matches !== 1) {
      errors.push(
        matches === 0
          ? `edits[${i}].find does not appear in the page. Copy it exactly from get_page`
          : `edits[${i}].find appears ${matches} times. Include more of the surrounding text`,
      );
      return;
    }
    const at = result.indexOf(edit.find);
    result = result.slice(0, at) + edit.replace + result.slice(at + edit.find.length);
  });
  if (errors.length > 0) {
    throw new BadRequestException({ message: 'The page was not changed', errors });
  }
  return validatePageHtml(result);
}

/** Validates one key/value a page saves. `null` removes the key. */
export function validatePageStateEntry(
  key: unknown,
  value: unknown,
): { key: string; json: string } {
  if (typeof key !== 'string' || key === '' || key.length > 200) {
    throw new BadRequestException('key must be a string of 1 to 200 characters');
  }
  const json = JSON.stringify(value ?? null);
  if (json.length > MAX_STATE_VALUE_CHARS) {
    throw new BadRequestException(
      `value must be JSON of at most ${MAX_STATE_VALUE_CHARS} characters`,
    );
  }
  return { key, json };
}
