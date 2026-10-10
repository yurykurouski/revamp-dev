import postcss, { CssSyntaxError, Root } from 'postcss';
import { IMvpTheme, MVP_THEME_VARS, MvpThemeKey } from '@revamp/shared-types';

// The CSS of a model-written page (REV-136). The model styles the whole page, so `:root`, element selectors and
// hidden menus are its own business; what is checked is that the CSS loads or runs nothing: no imports, no web
// fonts of its own (Google Fonts come in by <link>), and `url()` only to the original's own images.

/** Anything in a value that runs code or pulls in a resource other than through `url()` */
const ACTIVE = /expression\(|javascript:|image-set\(|image\(|element\(|src\(|attr\(/i;
const DENIED_PROPERTIES = new Set(['behavior', '-moz-binding']);
const DENIED_AT_RULES = new Set(['import', 'font-face', 'namespace', 'document']);

const parse = (css: string): Root | string => {
  try {
    return postcss.parse(css);
  } catch (error) {
    return error instanceof CssSyntaxError ? error.reason : String(error);
  }
};

const urlsIn = (value: string) =>
  Array.from(value.matchAll(/url\(\s*(['"]?)(.*?)\1\s*\)/gi), (m) => (m[2] ?? '').trim());

/** Problems found in a stylesheet (or a `style` attribute wrapped in a rule), `[]` when it is safe */
export function checkPageCss(css: string, allowedUrls: ReadonlySet<string>): string[] {
  // The CSS sits inside a <style> element: "<" could close it and start markup
  if (css.includes('<')) return ['it contains "<", which could break out of the style element'];
  const root = parse(css);
  if (typeof root === 'string') return [`it is not valid CSS (${root})`];

  const problems: string[] = [];
  const checkValue = (where: string, value: string) => {
    if (value.includes('\\')) problems.push(`"${where}" uses escapes`);
    else if (ACTIVE.test(value)) problems.push(`"${where}" runs or loads something`);
    else {
      for (const url of urlsIn(value)) {
        if (!allowedUrls.has(url)) problems.push(`"${where}" loads ${url.slice(0, 80)}, which is not one of the site's images`);
      }
      // url( without a closing match, e.g. url(x;
      if (/url\(/i.test(value) && urlsIn(value).length === 0) problems.push(`"${where}" has a malformed url()`);
    }
  };
  root.walk((node) => {
    if (node.type === 'atrule') {
      const name = node.name.toLowerCase().replace(/^-webkit-/, '');
      if (DENIED_AT_RULES.has(name)) {
        problems.push(`"@${node.name}" is not allowed`);
        // Rejected whole: its own declarations are not reported again
        if (node.nodes) node.removeAll();
      } else checkValue(`@${node.name} ${node.params}`, node.params);
    } else if (node.type === 'rule') {
      if (node.selector.includes('\\')) problems.push(`selector "${node.selector}" uses escapes`);
    } else if (node.type === 'decl') {
      const prop = node.prop.toLowerCase();
      if (DENIED_PROPERTIES.has(prop)) problems.push(`"${node.prop}" is not allowed`);
      else checkValue(`${node.prop}: ${node.value}`, node.value);
    }
  });
  return [...new Set(problems)];
}

const VAR_TO_KEY = new Map<string, MvpThemeKey>(
  (Object.entries(MVP_THEME_VARS) as Array<[MvpThemeKey, string]>).map(([key, name]) => [name, key]),
);

/** The theme variables declared in top-level `:root` rules, the last declaration of each winning; blocks that don't parse are skipped */
export function readMvpTheme(cssBlocks: string[]): Partial<IMvpTheme> {
  const theme: Partial<IMvpTheme> = {};
  for (const css of cssBlocks) {
    const root = parse(css);
    if (typeof root === 'string') continue;
    root.walkRules((rule) => {
      // Only a top-level :root: a variant inside @media (dark mode, print) is not the page's theme
      if (rule.selector.trim() !== ':root' || rule.parent?.type !== 'root') return;
      rule.walkDecls((decl) => {
        const key = VAR_TO_KEY.get(decl.prop);
        if (key && decl.value.trim()) theme[key] = decl.value.trim();
      });
    });
  }
  return theme;
}
