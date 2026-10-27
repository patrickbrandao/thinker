import type { Component, JSX } from 'solid-js';

/**
 * Renders a translated sentence whose `{{ key }}` placeholders are JSX nodes
 * (inline code, bold names, buttons), so translators keep the whole sentence
 * and its word order in one catalog entry.
 */
const RichText: Component<{ text: string; parts: Record<string, JSX.Element> }> = (props) => (
  <>
    {props.text.split(/(\{\{\s*\w+\s*\}\})/).map((segment) => {
      const key = /^\{\{\s*(\w+)\s*\}\}$/.exec(segment)?.[1];
      return key && key in props.parts ? props.parts[key] : segment;
    })}
  </>
);

export default RichText;
