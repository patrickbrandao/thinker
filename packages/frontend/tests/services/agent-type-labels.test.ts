import { describe, it, expect } from 'vitest';
import { categoryLabel, platformLabel } from '../../src/services/agent-type-labels';
import { resetLocaleForTests } from '../../src/i18n';

describe('categoryLabel', () => {
  it('returns the English label for each category', () => {
    expect(categoryLabel('personal')).toBe('AI agent');
    expect(categoryLabel('automation')).toBe('Automation');
    expect(categoryLabel('app')).toBe('App AI SDK');
    expect(categoryLabel('coding')).toBe('Coding Assistant');
  });

  it('echoes an unknown category instead of failing', () => {
    expect(categoryLabel('mystery')).toBe('mystery');
    expect(categoryLabel('')).toBe('');
  });

  it('is localized in pt-BR', () => {
    resetLocaleForTests('pt-BR');
    expect(categoryLabel('personal')).toBe('Agentes de IA');
    expect(categoryLabel('coding')).toBe('Assistente de código');
    expect(categoryLabel('mystery')).toBe('mystery');
  });
});

describe('platformLabel', () => {
  it('keeps product names as they are', () => {
    expect(platformLabel('openclaw')).toBe('OpenClaw');
    expect(platformLabel('n8n')).toBe('n8n');
    expect(platformLabel('open-webui')).toBe('Open WebUI');
  });

  it('translates only "other"', () => {
    expect(platformLabel('other')).toBe('Other');
    resetLocaleForTests('pt-BR');
    expect(platformLabel('other')).toBe('Outro');
    expect(platformLabel('openclaw')).toBe('OpenClaw');
  });

  it('echoes an unknown platform', () => {
    expect(platformLabel('brand-new')).toBe('brand-new');
  });
});
