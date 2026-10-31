/**
 * `{{name}}` substitution for trigger templates. There is no logic, only
 * lookups: an unknown variable renders empty. Values are escaped for the
 * place they land in, so a harness name can never break the JSON body, the
 * HTML of an e-mail or Telegram message, or a URL.
 */
export type TemplateEscape = 'raw' | 'json' | 'html' | 'url' | 'line';

export type TemplateVars = Record<string, string>;

const VARIABLE_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function escapeValue(value: string, mode: TemplateEscape): string {
  switch (mode) {
    case 'json':
      return JSON.stringify(value).slice(1, -1);
    case 'html':
      return escapeHtml(value);
    case 'url':
      return encodeURIComponent(value);
    case 'line':
      return value.replace(/[\r\n]+/g, ' ');
    default:
      return value;
  }
}

/**
 * `{{event.json}}` is every variable as one JSON object: inserted as-is in a
 * JSON body (so `{{event.json}}` alone is a valid body), escaped elsewhere.
 */
export function renderTemplate(
  template: string,
  vars: TemplateVars,
  mode: TemplateEscape = 'raw',
): string {
  return template.replace(VARIABLE_RE, (_match, name: string) => {
    if (name === 'event.json') {
      const json = JSON.stringify(vars);
      return mode === 'json' || mode === 'raw' ? json : escapeValue(json, mode);
    }
    const value = vars[name];
    return value === undefined ? '' : escapeValue(value, mode);
  });
}
