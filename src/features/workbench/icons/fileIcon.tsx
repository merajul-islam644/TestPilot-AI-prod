// File / folder icon elements for the workbench tree and tabs.
//
// Official Material Icon Theme SVGs (the most popular VS Code icon
// theme) imported as React components through vite-plugin-svgr's
// `?react` suffix. Folders always get Material artwork — the curated
// map or the theme's default folder. Files without a match keep VS
// Code's own codicon glyph, which is exactly what VS Code shows for
// unrecognised files under this theme.

import type { ReactElement } from "react";
import { getFileIcon as getMaterialFile, getFolderIcon } from "./materialIcons";

export function fileIconElement(filePath: string): ReactElement {
  const name = filePath.slice(filePath.lastIndexOf("/") + 1);
  const Material = getMaterialFile(name);
  if (Material) return <Material className="wb-svg" />;
  return <i aria-hidden="true" className="codicon codicon-file wb-svg" />;
}

export function folderIconElement(folderName: string, _open: boolean): ReactElement {
  const Material = getFolderIcon(folderName, _open);
  return <Material className="wb-svg" />;
}
