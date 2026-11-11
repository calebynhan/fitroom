// The panel's link to ChatGPT: the MCP Apps bridge (ext-apps App over postMessage) for tool results, server tool
// calls, links and model context; ChatGPT's optional window.openai extensions (feature-detected) to keep the finished
// photo with the conversation.
import { App, applyDocumentTheme, applyHostStyleVariables, PostMessageTransport } from '@modelcontextprotocol/ext-apps';
import type { ToolAnswer } from './run';

interface OpenAiExtras {
  widgetState?: { privateContent?: unknown } | null;
  setWidgetState?: (state: unknown) => void;
  uploadFile?: (file: File, options?: { library?: boolean }) => Promise<{ fileId: string }>;
  getFileDownloadUrl?: (args: { fileId: string }) => Promise<{ downloadUrl: string }>;
}

declare global {
  interface Window {
    openai?: OpenAiExtras;
  }
}

export interface Bridge {
  lastResult: ToolAnswer | null;
  onResult: (listener: (result: ToolAnswer) => void) => () => void;
  callTool: (name: string, args: Record<string, unknown>) => Promise<ToolAnswer>;
  openLink: (url: string) => Promise<void>;
  updateModelContext: (text: string) => Promise<void>;
  uploadImage: (file: File) => Promise<string | null>;
  fileUrl: (fileId: string) => Promise<string | null>;
  savedState: <T>() => T | null;
  saveState: (privateContent: unknown, modelContent: string, imageIds: string[]) => void;
}

export async function connectBridge(): Promise<Bridge> {
  const app = new App({ name: 'FitRoom', version: '1.0.0' }, {}, { autoResize: true });
  const listeners = new Set<(r: ToolAnswer) => void>();
  const bridge: Bridge = {
    lastResult: null,
    onResult: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    callTool: async (name, args) => (await app.callServerTool({ name, arguments: args })) as ToolAnswer,
    openLink: async (url) => {
      try {
        await app.openLink({ url });
      } catch {
        window.open(url, '_blank', 'noopener');
      }
    },
    updateModelContext: async (text) => {
      try {
        await app.updateModelContext({ content: [{ type: 'text', text }] });
      } catch {
        // older hosts: the model still has the tool result
      }
    },
    uploadImage: async (file) => (window.openai?.uploadFile ? (await window.openai.uploadFile(file)).fileId : null),
    fileUrl: async (fileId) => {
      try {
        return window.openai?.getFileDownloadUrl ? (await window.openai.getFileDownloadUrl({ fileId })).downloadUrl : null;
      } catch {
        return null;
      }
    },
    savedState: <T,>() => (window.openai?.widgetState?.privateContent as T | undefined) ?? null,
    saveState: (privateContent, modelContent, imageIds) => window.openai?.setWidgetState?.({ modelContent, privateContent, imageIds }),
  };
  app.onerror = (err) => console.error('[fitroom] bridge error', err);
  app.ontoolresult = (result) => {
    bridge.lastResult = result as ToolAnswer;
    for (const l of listeners) l(bridge.lastResult);
  };
  app.onhostcontextchanged = (ctx) => {
    if (ctx.theme) applyDocumentTheme(ctx.theme);
    if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  };
  await app.connect(new PostMessageTransport(window.parent, window.parent));
  const ctx = app.getHostContext();
  if (ctx?.theme) applyDocumentTheme(ctx.theme);
  if (ctx?.styles?.variables) applyHostStyleVariables(ctx.styles.variables);
  return bridge;
}
