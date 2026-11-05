import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
  CHIP,
  KeyValue,
  OnboardField,
  OnboardFields,
  RevealButton,
  SetupCard,
  SetupHint,
  SetupSegment,
  SnippetBlock,
  ThemedIcon,
  monoIconClass,
  themedIcon,
  useDarkTheme,
  useSetupKey,
} from '../../src/components/setup-ui';
import RichText from '../../src/components/RichText';
import { setThemePreference } from '../../src/lib/theme';
import { resetLocaleForTests } from '../../src/i18n';

const writeText = vi.fn().mockResolvedValue(undefined);

beforeEach(() => {
  writeText.mockClear();
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
});

afterEach(() => {
  setThemePreference('system');
  document.documentElement.classList.remove('dark');
});

describe('monoIconClass', () => {
  it('inverts monochrome brand marks on dark', () => {
    expect(monoIconClass('/icons/openai.svg')).toBe('[.dark_&]:invert');
    expect(monoIconClass('/icons/anthropic.svg')).toBe('[.dark_&]:invert');
    expect(monoIconClass('/icons/github.svg')).toBe('[.dark_&]:invert');
    expect(monoIconClass('/icons/hermes.svg')).toBe('[.dark_&]:invert');
  });

  it('leaves colored icons alone', () => {
    expect(monoIconClass('/icons/gemini.svg')).toBeUndefined();
  });

  it('handles missing sources', () => {
    expect(monoIconClass(null)).toBeUndefined();
    expect(monoIconClass(undefined)).toBeUndefined();
    expect(monoIconClass('')).toBeUndefined();
  });
});

describe('themedIcon', () => {
  it('uses the dark variant (not inverted) on dark when one exists', () => {
    expect(themedIcon('/icons/copilot.svg', true)).toEqual({ src: '/icons/copilot-dark.svg' });
    expect(themedIcon('/icons/open-webui.svg', true)).toEqual({
      src: '/icons/open-webui-dark.svg',
    });
  });

  it('keeps the original icon on light, with the mono class when it applies', () => {
    expect(themedIcon('/icons/copilot.svg', false)).toEqual({
      src: '/icons/copilot.svg',
      className: '[.dark_&]:invert',
    });
  });

  it('falls back to the icon itself on dark when no variant exists', () => {
    expect(themedIcon('/icons/gemini.svg', true)).toEqual({
      src: '/icons/gemini.svg',
      className: undefined,
    });
  });
});

describe('ThemedIcon / useDarkTheme', () => {
  function Probe() {
    return <span data-testid="dark">{String(useDarkTheme())}</span>;
  }

  it('re-renders when the theme preference changes', () => {
    setThemePreference('light');
    render(
      <>
        <Probe />
        <ThemedIcon src="/icons/copilot.svg" size={20} className="x" />
      </>,
    );
    expect(screen.getByTestId('dark').textContent).toBe('false');
    const img = document.querySelector('img') as HTMLImageElement;
    expect(img.getAttribute('src')).toBe('/icons/copilot.svg');
    expect(img.getAttribute('alt')).toBe('');
    expect(img.getAttribute('width')).toBe('20');
    expect(img.className).toContain('x');

    act(() => setThemePreference('dark'));
    expect(screen.getByTestId('dark').textContent).toBe('true');
    expect(document.querySelector('img')!.getAttribute('src')).toBe('/icons/copilot-dark.svg');
  });
});

describe('RichText', () => {
  it('substitutes {{ key }} placeholders with nodes and keeps the word order', () => {
    const { container } = render(
      <RichText
        text="Open {{ file }} then run {{cmd}} now"
        parts={{ file: <b>a.json</b>, cmd: <i>go</i> }}
      />,
    );
    expect(container.textContent).toBe('Open a.json then run go now');
    expect(container.querySelector('b')!.textContent).toBe('a.json');
    expect(container.querySelector('i')!.textContent).toBe('go');
  });

  it('leaves unknown placeholders as literal text', () => {
    const { container } = render(<RichText text="Hello {{ who }}" parts={{}} />);
    expect(container.textContent).toBe('Hello {{ who }}');
  });

  it('can reuse one placeholder twice', () => {
    const { container } = render(<RichText text="{{ a }}-{{ a }}" parts={{ a: <u>x</u> }} />);
    expect(container.querySelectorAll('u')).toHaveLength(2);
  });

  it('renders plain text untouched', () => {
    const { container } = render(<RichText text="no placeholders" parts={{}} />);
    expect(container.textContent).toBe('no placeholders');
  });
});

describe('building blocks', () => {
  it('SetupCard and SetupHint render their children', () => {
    render(
      <SetupCard>
        <SetupHint className="extra">hint text</SetupHint>
      </SetupCard>,
    );
    const hint = screen.getByText('hint text');
    expect(hint.tagName).toBe('P');
    expect(hint.className).toContain('extra');
  });

  it('CHIP carries the stable test hook class', () => {
    expect(CHIP).toContain('setup-model-hint__code');
  });

  it('RevealButton labels itself for revealed/masked and code variants', () => {
    const onToggle = vi.fn();
    const { rerender } = render(<RevealButton revealed={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: 'Reveal API key' }));
    expect(onToggle).toHaveBeenCalledTimes(1);
    rerender(<RevealButton revealed onToggle={onToggle} />);
    expect(screen.getByRole('button', { name: 'Hide API key' })).toBeTruthy();
    rerender(<RevealButton revealed={false} onToggle={onToggle} inCode />);
    expect(screen.getByRole('button', { name: 'Reveal API key in code' })).toBeTruthy();
    rerender(<RevealButton revealed onToggle={onToggle} inCode />);
    expect(screen.getByRole('button', { name: 'Hide API key in code' })).toBeTruthy();
  });

  it('RevealButton is localized in pt-BR', () => {
    resetLocaleForTests('pt-BR');
    render(<RevealButton revealed={false} onToggle={() => {}} />);
    expect(screen.queryByRole('button', { name: 'Reveal API key' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Mostrar chave de API' })).toBeTruthy();
  });
});

describe('SnippetBlock', () => {
  it('shows the code and copies copyText, not the displayed text', async () => {
    render(<SnippetBlock code="KEY=masked..." copyText="KEY=real" language="bash" />);
    expect(document.querySelector('pre')!.textContent).toBe('KEY=masked...');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Copy to clipboard' }));
    });
    expect(writeText).toHaveBeenCalledWith('KEY=real');
  });

  it('escapes HTML in the snippet instead of injecting it', () => {
    render(<SnippetBlock code={'<img src=x onerror=alert(1)>'} copyText="" language="json" />);
    expect(document.querySelector('pre img')).toBeNull();
    expect(document.querySelector('pre')!.textContent).toBe('<img src=x onerror=alert(1)>');
  });

  it('renders the optional reveal slot next to the copy button', () => {
    render(<SnippetBlock code="x" copyText="x" language="bash" reveal={<button>eye</button>} />);
    expect(screen.getByRole('button', { name: 'eye' })).toBeTruthy();
  });
});

describe('OnboardFields', () => {
  it('exposes a labelled list of rows with copyable values', async () => {
    render(
      <OnboardFields label="Values">
        <OnboardField label="URL" value="http://x/v1" copyable />
        <OnboardField label="Plain" value="p" />
        <OnboardField label="Custom">
          <span>custom cell</span>
        </OnboardField>
      </OnboardFields>,
    );
    const list = screen.getByRole('list', { name: 'Values' });
    expect(list).toBeTruthy();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('http://x/v1')).toBeTruthy();
    expect(screen.getByText('custom cell')).toBeTruthy();
    // Only the copyable row has a copy button.
    expect(screen.getAllByRole('button')).toHaveLength(1);
    await act(async () => {
      fireEvent.click(screen.getByRole('button'));
    });
    expect(writeText).toHaveBeenCalledWith('http://x/v1');
  });
});

describe('useSetupKey / KeyValue', () => {
  function Harness({ apiKey, keyPrefix }: { apiKey: string | null; keyPrefix: string | null }) {
    const key = useSetupKey(apiKey, keyPrefix);
    return (
      <div>
        <span data-testid="shown">{key.shown}</span>
        <span data-testid="copy">{key.copy}</span>
        <div data-testid="reveal">{key.reveal}</div>
        <KeyValue {...key.cell} />
      </div>
    );
  }

  it('falls back to the YOUR_KEY placeholder with neither key nor prefix', () => {
    render(<Harness apiKey={null} keyPrefix={null} />);
    expect(screen.getByTestId('shown').textContent).toBe('thk_YOUR_KEY');
    expect(screen.getByTestId('copy').textContent).toBe('thk_YOUR_KEY');
    expect(screen.queryByRole('button', { name: /Reveal/ })).toBeNull();
  });

  it('masks with the prefix and offers no reveal while the full key is unknown', () => {
    render(<Harness apiKey={null} keyPrefix="thk_ab" />);
    expect(screen.getByTestId('shown').textContent).toBe('thk_ab...');
    expect(screen.getByTestId('copy').textContent).toBe('thk_ab...');
    expect(screen.queryByRole('button', { name: /Reveal/ })).toBeNull();
  });

  it('reveals the full key on toggle but always copies the real key', async () => {
    render(<Harness apiKey="thk_full_secret" keyPrefix="thk_fu" />);
    expect(screen.getByTestId('shown').textContent).toBe('thk_fu...');
    expect(screen.getByTestId('copy').textContent).toBe('thk_full_secret');
    const reveals = screen.getAllByRole('button', { name: 'Reveal API key' });
    expect(reveals).toHaveLength(2); // the slot for snippets and the KeyValue cell
    fireEvent.click(reveals[0]);
    expect(screen.getByTestId('shown').textContent).toBe('thk_full_secret');
    expect(screen.getAllByRole('button', { name: 'Hide API key' })).toHaveLength(2);
    fireEvent.click(screen.getAllByRole('button', { name: 'Hide API key' })[1]);
    expect(screen.getByTestId('shown').textContent).toBe('thk_fu...');
  });

  it('the KeyValue copy button writes the real key even while masked', async () => {
    render(<Harness apiKey="thk_full_secret" keyPrefix="thk_fu" />);
    const copyButtons = screen.getAllByRole('button', { name: 'Copy to clipboard' });
    await act(async () => {
      fireEvent.click(copyButtons[0]);
    });
    expect(writeText).toHaveBeenCalledWith('thk_full_secret');
  });
});

describe('SetupSegment', () => {
  it('renders tabs with aria-selected and fires onChange', () => {
    const onChange = vi.fn();
    render(
      <SetupSegment
        label="Method"
        value="b"
        onChange={onChange}
        items={[
          { key: 'a', label: 'Alpha' },
          { key: 'b', label: 'Beta' },
        ]}
      />,
    );
    expect(screen.getByRole('tablist', { name: 'Method' })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'Beta' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('tab', { name: 'Alpha' }).getAttribute('aria-selected')).toBe('false');
    fireEvent.click(screen.getByRole('tab', { name: 'Alpha' }));
    expect(onChange).toHaveBeenCalledWith('a');
  });

  it('full mode stretches the tabs', () => {
    render(
      <SetupSegment
        full
        label="Method"
        value="a"
        onChange={() => {}}
        items={[{ key: 'a', label: 'Alpha' }]}
      />,
    );
    expect(screen.getByRole('tablist').className).toContain('w-full');
    expect(screen.getByRole('tab').className).toContain('flex-1');
    expect(screen.getByRole('tab').className).toContain('is-active');
  });
});
