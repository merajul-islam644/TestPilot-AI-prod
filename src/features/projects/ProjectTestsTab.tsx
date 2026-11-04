// The Tests tab is the VS Code-style workbench (see features/workbench).
// This wrapper only adapts the project object; every behaviour --
// import, editing, persistence, runs -- lives in the workbench feature.
import type { Project } from "../../lib/demo/data";
import { Workbench } from "../workbench/Workbench";

export function ProjectTestsTab({ project }: { project: Project }) {
  return <Workbench project={project} />;
}
