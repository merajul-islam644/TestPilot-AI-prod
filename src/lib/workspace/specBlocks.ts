// Static parser for Playwright spec files: walks the source with a
// brace-depth + string/comment/regex-aware scanner and returns every
// `test()` block with its describe chain, declaration line, and the
// `test.step()` blocks nested inside it. This is the app-facing list of
// "the blocks in a spec file" — run results attach onto it by title
// (see CaseTree).
//
// Why not regex-per-line: the real suites close every `test.step` body
// with `});`, so a line-based describe stack pops early and everything
// after lands in the wrong file section. Braces are the truth; strings,
// comments AND regex literals are skipped so braces inside them (common
// in toHaveTitle(/…}) assertions) can not skew depth.

export type SpecStepBlock = {
  title: string;
  /** 1-based declaration line of the test.step(...) call. */
  line: number;
  /** Nesting level among steps (0 = directly inside the test body). */
  depth: number;
};

export type SpecTestBlock = {
  title: string;
  /** 1-based declaration line of the test(...) call. */
  line: number;
  /** Enclosing test.describe titles, outermost first. */
  describeChain: string[];
  /** test.step blocks declared inside this test's body, in source order. */
  steps: SpecStepBlock[];
};

type OpenBlock = {
  kind: "describe" | "test" | "step";
  title: string;
  openDepth: number;
};

type Quote = "'" | '"' | "`";

const IDENT_START = /[A-Za-z_$]/;
const IDENT_BODY = /[\w$]/;
// Keywords after which a `/` must open a regex literal, not division.
const REGEX_PRECEDING_WORDS = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void",
  "throw", "case", "do", "else", "yield", "await"
]);

export function parseSpecBlocks(content: string): SpecTestBlock[] {
  const tests: SpecTestBlock[] = [];
  const stack: OpenBlock[] = [];
  const templateBraces: number[] = [];
  let depth = 0;
  // Scanner context: code, or the quote that opened the current string.
  let mode: "code" | Quote = "code";
  const n = content.length;
  let i = 0;

  /** 1-based line of an index — called a handful of times per file. */
  const lineAt = (index: number): number => {
    let line = 1;
    for (let k = 0; k < index && k < n; k++) if (content[k] === "\n") line += 1;
    return line;
  };

  function skipWsComments(from: number): number {
    let k = from;
    for (;;) {
      while (k < n) {
        const ch = content[k];
        if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
          k += 1;
          continue;
        }
        break;
      }
      if (content[k] === "/" && content[k + 1] === "/") {
        while (k < n && content[k] !== "\n") k += 1;
        continue;
      }
      if (content[k] === "/" && content[k + 1] === "*") {
        k += 2;
        while (k < n && !(content[k] === "*" && content[k + 1] === "/")) k += 1;
        k += 2;
        continue;
      }
      return k;
    }
  }

  /** Previous significant (non-whitespace, non-comment) char before an
   *  index, keyword-aware: decides regex-vs-division for a `/`. */
  const isRegexStart = (at: number): boolean => {
    let k = at - 1;
    while (k >= 0) {
      const ch = content[k];
      if (ch === undefined) break;
      if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
        k -= 1;
        continue;
      }
      if (ch === "/" && content[k + 1] === "/") {
        while (k >= 0 && content[k] !== "\n") k -= 1;
        continue;
      }
      if (ch === "/" && content[k + 1] === "*") {
        k -= 2;
        while (k >= 1 && !(content[k] === "/" && content[k - 1] === "*")) k -= 1;
        k -= 2;
        continue;
      }
      if (IDENT_BODY.test(ch)) {
        // Read the whole word backwards, then decide.
        let wordStart = k;
        while (wordStart > 0 && IDENT_BODY.test(content[wordStart - 1] ?? "")) wordStart -= 1;
        const word = content.slice(wordStart, k + 1);
        // A word preceded by `.` is a member, not a keyword context.
        let before = wordStart - 1;
        while (before >= 0 && (content[before] === " " || content[before] === "\t")) before -= 1;
        if (content[before] === ".") return false;
        return REGEX_PRECEDING_WORDS.has(word);
      }
      if (ch === ")" || ch === "]" || ch === "}" || ch === ".") return false;
      // After a closing quote division is legal ("a" / 2), and specs never
      // regex there — prefer division (false) so paths like strings survive.
      if (ch === "'" || ch === '"' || ch === "`") return false;
      return true; // operators, "(", ",", "=", ":", ";", "{", "[" …
    }
    return true;
  };

  /** Skip a regex literal starting at its `/`; returns the index past the
   *  closing slash. Char classes `[...]` may hold bare slashes; a newline
   *  before the close means this was never a regex — bail minimal. */
  const skipRegex = (start: number): number => {
    let k = start + 1;
    let inClass = false;
    while (k < n) {
      const ch = content[k];
      if (ch === "\\") {
        k += 2;
        continue;
      }
      if (ch === "\n") return start + 1;
      if (inClass) {
        if (ch === "]") inClass = false;
        k += 1;
        continue;
      }
      if (ch === "[") {
        inClass = true;
        k += 1;
        continue;
      }
      if (ch === "/") return k + 1;
      k += 1;
    }
    return n;
  };

  /** Read `a.b.c` starting at an identifier; returns the dotted chain
   *  and the index just past it. Comments between parts are skipped. */
  const readDottedChain = (start: number): { chain: string; end: number } => {
    let k = skipWsComments(start);
    let chain = "";
    for (;;) {
      let id = "";
      for (;;) {
        const ch = content[k];
        if (ch === undefined || !IDENT_BODY.test(ch)) break;
        id += ch;
        k += 1;
      }
      if (!id) break;
      chain = chain ? `${chain}.${id}` : id;
      const after = skipWsComments(k);
      if (content[after] === ".") {
        k = after + 1;
        continue;
      }
      break;
    }
    return { chain, end: k };
  };

  /** Read a quoted string literal; returns its unescaped value and the
   *  index just past the closing quote. */
  const readStringLiteral = (start: number): [string, number] => {
    const quote = content[start] as Quote;
    let k = start + 1;
    let value = "";
    while (k < n) {
      const ch = content[k];
      if (ch === "\\") {
        const next = content[k + 1];
        value += next === "n" ? "\n" : next === "t" ? "\t" : (next ?? "");
        k += 2;
        continue;
      }
      if (ch === quote) return [value, k + 1];
      value += ch;
      k += 1;
    }
    return [value, n];
  };

  /** Index of the `)` that closes the `(` at `open`, or -1. Strings,
   *  comments and regex literals are skipped so their contents never
   *  miscount parens. */
  const findCallClose = (open: number): number => {
    let paren = 0;
    let k = open;
    let scan: "code" | Quote = "code";
    while (k < n) {
      const ch = content[k];
      if (ch === undefined) break;
      if (scan === "code") {
        if (ch === "'" || ch === '"' || ch === "`") {
          scan = ch;
          k += 1;
          continue;
        }
        if (ch === "/" && content[k + 1] === "/") {
          while (k < n && content[k] !== "\n") k += 1;
          continue;
        }
        if (ch === "/" && content[k + 1] === "*") {
          k += 2;
          while (k < n && !(content[k] === "*" && content[k + 1] === "/")) k += 1;
          k += 2;
          continue;
        }
        if (ch === "/" && isRegexStart(k)) {
          k = skipRegex(k);
          continue;
        }
        if (ch === "(") paren += 1;
        if (ch === ")") {
          paren -= 1;
          if (paren === 0) return k;
        }
        k += 1;
        continue;
      }
      if (ch === "\\") {
        k += 2;
        continue;
      }
      if (ch === scan) scan = "code";
      k += 1;
    }
    return -1;
  };

  /** First `=>` between the indices (outside strings/comments/regexes),
   *  or -1. */
  const findArrow = (from: number, to: number): number => {
    let k = from;
    let scan: "code" | Quote = "code";
    while (k < to && k < n) {
      const ch = content[k];
      if (ch === undefined) break;
      if (scan === "code") {
        if (ch === "'" || ch === '"' || ch === "`") {
          scan = ch;
          k += 1;
          continue;
        }
        if (ch === "/" && content[k + 1] === "/") {
          while (k < n && content[k] !== "\n") k += 1;
          continue;
        }
        if (ch === "/" && content[k + 1] === "*") {
          k += 2;
          while (k < n && !(content[k] === "*" && content[k + 1] === "/")) k += 1;
          k += 2;
          continue;
        }
        if (ch === "/" && isRegexStart(k)) {
          k = skipRegex(k);
          continue;
        }
        if (ch === "=" && content[k + 1] === ">") return k;
        k += 1;
        continue;
      }
      if (ch === "\\") {
        k += 2;
        continue;
      }
      if (ch === scan) scan = "code";
      k += 1;
    }
    return -1;
  };

  while (i < n) {
    const ch = content[i];
    if (ch === undefined) break;
    if (mode === "code") {
      if (ch === "'" || ch === '"') {
        mode = ch;
        i += 1;
        continue;
      }
      if (ch === "`") {
        mode = "`";
        i += 1;
        continue;
      }
      if (ch === "/" && content[i + 1] === "/") {
        while (i < n && content[i] !== "\n") i += 1;
        continue;
      }
      if (ch === "/" && content[i + 1] === "*") {
        i += 2;
        while (i < n && !(content[i] === "*" && content[i + 1] === "/")) i += 1;
        i += 2;
        continue;
      }
      if (ch === "/" && isRegexStart(i)) {
        i = skipRegex(i);
        continue;
      }
      if (ch === "{") {
        depth += 1;
        i += 1;
        continue;
      }
      if (ch === "}") {
        // Re-enter an enclosing template literal first: `${…}` codes that
        // close never pop test blocks (which cannot open inside templates).
        if (templateBraces.length > 0 && depth - 1 === templateBraces[templateBraces.length - 1]) {
          templateBraces.pop();
          mode = "`";
          depth -= 1;
          i += 1;
          continue;
        }
        depth -= 1;
        for (;;) {
          const top = stack[stack.length - 1];
          if (top === undefined || top.openDepth <= depth) break;
          stack.pop();
        }
        i += 1;
        continue;
      }
      if (IDENT_START.test(ch) && !(i > 0 && IDENT_BODY.test(content[i - 1] ?? ""))) {
        const { chain, end } = readDottedChain(i);
        // A `.test(` reached here is a member call on some other receiver
        // (its owner ident was already consumed as part of a chain).
        if (i > 0 && content[i - 1] === ".") {
          i = end;
          continue;
        }
        const isDescribe = chain === "test.describe" || chain === "describe";
        const isTest = chain === "test" || chain === "it";
        const isStep = chain === "test.step";
        if (isDescribe || isTest || isStep) {
          const parenAt = skipWsComments(end);
          if (content[parenAt] === "(") {
            const close = findCallClose(parenAt);
            if (close > 0) {
              const titleStart = skipWsComments(parenAt + 1);
              const quote = content[titleStart];
              const isQuoted = quote === "'" || quote === '"' || quote === "`";
              if (isQuoted && quote) {
                const [title] = readStringLiteral(titleStart);
                const arrow = findArrow(parenAt + 1, close);
                const brace = arrow > 0 ? skipWsComments(arrow + 2) : -1;
                if (arrow > 0 && content[brace] === "{") {
                  depth += 1;
                  const kind: OpenBlock["kind"] = isDescribe ? "describe" : isTest ? "test" : "step";
                  const line = lineAt(end);
                  if (kind === "test") {
                    const describeChain = stack.filter((block) => block.kind === "describe").map((block) => block.title);
                    tests.push({ title, line, describeChain, steps: [] });
                  }
                  if (kind === "step") {
                    const owner = tests[tests.length - 1];
                    if (owner) {
                      let stepDepth = 0;
                      for (let s = stack.length - 1; s >= 0; s--) {
                        if (stack[s]?.kind !== "step") break;
                        stepDepth += 1;
                      }
                      owner.steps.push({ title, line, depth: stepDepth });
                    }
                  }
                  stack.push({ kind, title, openDepth: depth });
                  i = brace + 1;
                  continue;
                }
              }
            }
          }
        }
        i = end;
        continue;
      }
      i += 1;
      continue;
    }
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === mode) {
      mode = "code";
      i += 1;
      continue;
    }
    if (mode === "`" && ch === "$" && content[i + 1] === "{") {
      templateBraces.push(depth);
      mode = "code";
      depth += 1;
      i += 2;
      continue;
    }
    i += 1;
  }
  return tests;
}
