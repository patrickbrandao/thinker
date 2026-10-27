import { Fragment, type ReactNode } from 'react';

/**
 * Renders a translated sentence whose `{{ key }}` placeholders are JSX nodes
 * (inline code, bold names, buttons), so translators keep the whole sentence
 * and its word order in one catalog entry.
 */
export default function RichText({
  text,
  parts,
}: {
  text: string;
  parts: Record<string, ReactNode>;
}) {
  return (
    <>
      {text.split(/(\{\{\s*\w+\s*\}\})/).map((segment, i) => {
        const key = /^\{\{\s*(\w+)\s*\}\}$/.exec(segment)?.[1];
        return <Fragment key={i}>{key && key in parts ? parts[key] : segment}</Fragment>;
      })}
    </>
  );
}
