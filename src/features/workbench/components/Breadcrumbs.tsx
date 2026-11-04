// Breadcrumb bar above the editor: the open file's path segments
// separated by chevrons, with the file's type icon leading the last
// segment -- same information the VS Code breadcrumbs carry.

import { ChevronRight } from "lucide-react";
import { basenameOf, breadcrumbsOf } from "../model/treeModel";
import { fileIconElement } from "../icons/fileIcon";

export function Breadcrumbs({ path }: { path: string }) {
  const segments = breadcrumbsOf(path);
  const name = basenameOf(path);
  return (
    <div className="wb-breadcrumbs">
      {segments.map((segment, index) => (
        <span className="wb-crumb" key={`${segment}-${index}`}>
          {index > 0 ? <ChevronRight size={11} /> : null}
          {segment === name ? <span className="wb-tree-icon">{fileIconElement(path)}</span> : null}
          <span>{segment}</span>
        </span>
      ))}
    </div>
  );
}
