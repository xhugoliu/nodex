import { invoke } from "@tauri-apps/api/core";
import type { InvokeArgs } from "@tauri-apps/api/core";
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
  return invoke<T>(command, toInvokeArgs(args));
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

  return typeof selected === "string" ? normalizeDisplayPath(selected) : null;
}

function toTauriArgs(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => toTauriArgs(item));
  }

  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entryValue]) => [
        toCamelCase(key),
        toTauriArgs(entryValue),
      ]),
    );
  }

  return value;
}

function toInvokeArgs(args: Record<string, unknown>): InvokeArgs {
  return toTauriArgs(args) as InvokeArgs;
}

function toCamelCase(key: string): string {
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function normalizeDisplayPath(path: string): string {
  if (path.startsWith("\\\\?\\UNC\\")) {
    return `\\\\${path.slice("\\\\?\\UNC\\".length)}`;
  }

  if (path.startsWith("\\\\?\\")) {
    return path.slice("\\\\?\\".length);
  }

  return path;
}
