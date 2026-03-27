import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export interface DialogFilter {
  name: string;
  extensions: string[];
}

export function hasTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function invokeCommand<T>(
  command: string,
  args: Record<string, unknown>,
): Promise<T> {
  return invoke<T>(command, args);
}

export async function openPath(options: {
  directory: boolean;
  title: string;
  filters?: DialogFilter[];
}): Promise<string | null> {
  const selected = await open({
    directory: options.directory,
    multiple: false,
    title: options.title,
    filters: options.filters,
  });

  return typeof selected === "string" ? selected : null;
}
