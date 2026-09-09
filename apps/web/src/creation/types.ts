import type { CreationWorkspace, ContentBlock, WorkspaceTab } from "@mybrandos/shared";

export type WorkspaceState = CreationWorkspace & {
  dirty: boolean;
  selectedBlockId: string | null;
  selectedText: string;
  tab: WorkspaceTab;
};

export function blockText(block: ContentBlock): string {
  return String(block.content.text ?? "");
}
