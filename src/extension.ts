import { createHash } from "node:crypto";

import type MarkdownIt from "markdown-it";
import * as vscode from "vscode";

import { extendMarkdownIt, type Paragraph } from "./paragraphs";
import { normalizeEndpoint, type TranslationSettings } from "./translation";
import { translateSegments } from "./translationBatches";
import { translateFreeSegments } from "./freeTranslation";
import { registerTranslationControls } from "./translationControls";

type SourceState = {
  document: vscode.TextDocument;
  version: number;
  paragraphs: readonly Paragraph[];
  translations: Map<string, string>;
};

type TranslationRequest = {
  document: vscode.TextDocument;
  version: number;
  settings: TranslationSettings;
  source: "ai" | "google";
  controller: AbortController;
};

type NativePreview = {
  tab: vscode.Tab;
  group: vscode.TabGroup;
  input: vscode.Tab["input"];
  label: string;
};

type MarkdownExtension = { extendMarkdownIt(md: MarkdownIt): MarkdownIt };

function readSettings(): TranslationSettings {
  const configuration = vscode.workspace.getConfiguration("translationReview");
  const endpoint = configuration.inspect<string>("endpoint");
  const model = configuration.inspect<string>("model");
  const targetLanguage = configuration.inspect<string>("targetLanguage");
  return {
    endpoint: endpoint?.globalValue ?? endpoint?.defaultValue ?? "",
    model: model?.globalValue ?? model?.defaultValue ?? "",
    targetLanguage: targetLanguage?.globalValue ?? targetLanguage?.defaultValue ?? "",
  };
}

function secretName(endpoint: string): string {
  return `translationReview.apiKey.${createHash("sha256").update(normalizeEndpoint(endpoint)).digest("hex")}`;
}

async function setApiKey(secrets: vscode.SecretStorage): Promise<void> {
  let endpoint: string;
  try {
    endpoint = normalizeEndpoint(readSettings().endpoint);
  } catch {
    await vscode.window.showErrorMessage("Set a valid endpoint in the MarkDown Preview Translate settings first.");
    return;
  }
  const value = await vscode.window.showInputBox({
    title: "MarkDown Preview Translate: Set API Key",
    prompt: `Used only for ${endpoint}. Leave blank and confirm to delete the API key for this endpoint.`,
    password: true,
    ignoreFocusOut: true,
  });
  if (value === undefined) {
    return;
  }
  try {
    const name = secretName(endpoint);
    if (value.trim()) {
      await secrets.store(name, value.trim());
    } else {
      await secrets.delete(name);
    }
  } catch {
    await vscode.window.showErrorMessage("Could not update the API key. Please try again.");
  }
}

function previewExists(preview: NativePreview): boolean {
  return vscode.window.tabGroups.all.includes(preview.group)
    && preview.group.tabs.includes(preview.tab)
    && ((preview.input instanceof vscode.TabInputWebview && preview.tab.input instanceof vscode.TabInputWebview
      && preview.input.viewType === preview.tab.input.viewType)
      || (preview.input instanceof vscode.TabInputCustom && preview.tab.input instanceof vscode.TabInputCustom
        && preview.input.viewType === preview.tab.input.viewType && preview.input.uri.toString() === preview.tab.input.uri.toString()))
    && preview.tab.label === preview.label;
}

function previewIsActive(preview: NativePreview): boolean {
  return previewExists(preview) && vscode.window.tabGroups.activeTabGroup === preview.group
    && preview.group.activeTab === preview.tab;
}

async function restorePreview(preview: NativePreview, signal: AbortSignal): Promise<boolean> {
  const groups = vscode.window.tabGroups.all.length;
  for (let attempt = 0; attempt < groups; attempt++) {
    if (signal.aborted || !previewExists(preview)) {
      return false;
    }
    if (vscode.window.tabGroups.activeTabGroup === preview.group) {
      break;
    }
    await vscode.commands.executeCommand("workbench.action.focusNextGroup");
  }
  if (signal.aborted || !previewExists(preview) || vscode.window.tabGroups.activeTabGroup !== preview.group) {
    return false;
  }
  if (previewIsActive(preview)) {
    return true;
  }
  const previousTab = preview.group.activeTab;
  return new Promise<boolean>((resolve) => {
    const finish = (restored: boolean): void => {
      clearTimeout(timer);
      tabs.dispose();
      groupsChanged.dispose();
      signal.removeEventListener("abort", cancel);
      resolve(restored);
    };
    const observe = (): void => {
      if (signal.aborted || !previewExists(preview) || vscode.window.tabGroups.activeTabGroup !== preview.group
        || (preview.group.activeTab !== previousTab && preview.group.activeTab !== preview.tab)) {
        finish(false);
      } else if (previewIsActive(preview)) {
        finish(true);
      }
    };
    const cancel = (): void => finish(false);
    const tabs = vscode.window.tabGroups.onDidChangeTabs(observe);
    const groupsChanged = vscode.window.tabGroups.onDidChangeTabGroups(observe);
    const timer = setTimeout(() => finish(false), 2_000);
    signal.addEventListener("abort", cancel, { once: true });
    const index = preview.group.tabs.indexOf(preview.tab);
    if (signal.aborted || index < 0 || !previewExists(preview)) {
      finish(false);
      return;
    }
    // This command does not return its internal openEditor promise.
    void vscode.commands.executeCommand("workbench.action.openEditorAtIndex", index).then(undefined, () => finish(false));
  });
}

async function resolveSource(preview: NativePreview, value: unknown, signal: AbortSignal): Promise<vscode.TextDocument | undefined> {
  if (!previewIsActive(preview) || signal.aborted) {
    return undefined;
  }
  if (preview.input instanceof vscode.TabInputCustom && preview.input.viewType === "vscode.markdown.preview.editor") {
    const uri = preview.input.uri;
    if (uri.scheme === "webview-panel" || (value instanceof vscode.Uri && value.toString() !== uri.toString())) {
      throw new Error("The preview source changed. Toggle automatic translation off and on in the current Markdown preview.");
    }
    const document = await vscode.workspace.openTextDocument(uri);
    return !signal.aborted && previewIsActive(preview) ? document : undefined;
  }
  if (!(preview.input instanceof vscode.TabInputWebview) || preview.input.viewType !== "mainThreadWebview-markdown.preview") {
    throw new Error("Use the translation button in VS Code's built-in Markdown preview.");
  }
  if (preview.tab.isPreview) {
    await vscode.commands.executeCommand("workbench.action.keepEditor");
    if (signal.aborted || !previewIsActive(preview)) {
      return undefined;
    }
  }
  const result: unknown = await vscode.commands.executeCommand("markdown.showSource");
  const editor = vscode.window.visibleTextEditors.find((candidate) => candidate === result);
  const sourceTab = vscode.window.tabGroups.activeTabGroup.activeTab;
  if (signal.aborted || !previewExists(preview)) {
    return undefined;
  }
  if (!editor || !(sourceTab?.input instanceof vscode.TabInputText)
    || sourceTab.input.uri.toString() !== editor.document.uri.toString()
    || editor.viewColumn !== vscode.window.tabGroups.activeTabGroup.viewColumn
    || editor.document.uri.scheme === "webview-panel") {
    throw new Error("Could not determine the exact preview source. No translation request was sent. Reopen the built-in Markdown preview and try again.");
  }
  if (!await restorePreview(preview, signal)) {
    if (!signal.aborted) {
      throw new Error("Could not restore the Markdown preview. No translation request was sent. Try again in that preview.");
    }
    return undefined;
  }
  return editor.document;
}

export function activate(context: vscode.ExtensionContext): MarkdownExtension {
  registerTranslationControls(context);
  const sources = new Map<string, SourceState>();
  const requests = new Map<string, TranslationRequest>();
  const routes = new Map<vscode.Tab, AbortController>();
  const rendered = new vscode.EventEmitter<string>();
  let disposed = false;
  let automatic: { attempted: WeakSet<SourceState> } | undefined;
  let automaticTimer: NodeJS.Timeout | undefined;
  let automaticPending = false;
  let lastResolvedSource: SourceState | undefined;
  const scheduleAutomatic = (): void => {
    if (!automatic || disposed) return;
    clearTimeout(automaticTimer);
    automaticTimer = setTimeout(() => {
      automaticTimer = undefined;
      if (routes.size) {
        automaticPending = true;
        return;
      }
      automaticPending = false;
      void translate(undefined);
    }, 150);
  };
  const observePreview = (): void => {
    if (!routes.size) scheduleAutomatic();
  };

  const refresh = (): void => {
    if (!disposed) {
      void vscode.commands.executeCommand("markdown.preview.refresh").then(undefined, () => {
        void vscode.window.showErrorMessage("Could not refresh the built-in Markdown preview. Please reopen it.");
      });
    }
  };
  const invalidate = (uri: string): void => {
    requests.get(uri)?.controller.abort();
    requests.delete(uri);
    sources.delete(uri);
  };
  const invalidateAll = (): void => {
    for (const controller of routes.values()) {
      controller.abort();
    }
    for (const uri of new Set([...sources.keys(), ...requests.keys()])) {
      invalidate(uri);
    }
    refresh();
    scheduleAutomatic();
  };
  const isCurrent = (request: TranslationRequest): boolean => {
    return !disposed && !request.controller.signal.aborted && !request.document.isClosed
      && request.document.version === request.version
      && requests.get(request.document.uri.toString()) === request;
  };
  const lookup = (uri: string, paragraphs: readonly Paragraph[]): ReadonlyMap<string, string> | undefined => {
    if (disposed) {
      return undefined;
    }
    const document = vscode.workspace.textDocuments.find((candidate) => !candidate.isClosed && candidate.uri.toString() === uri);
    if (!document) {
      invalidate(uri);
      return undefined;
    }
    let source = sources.get(uri);
    if (source && (source.document !== document || source.version !== document.version
      || source.paragraphs.length !== paragraphs.length
      || source.paragraphs.some((paragraph, index) => paragraph.id !== paragraphs[index].id || paragraph.text !== paragraphs[index].text || paragraph.formatting !== paragraphs[index].formatting))) {
      invalidate(uri);
      source = undefined;
    }
    if (!source) {
      source = { document, version: document.version, paragraphs: paragraphs.map((paragraph) => ({ ...paragraph })), translations: new Map() };
      sources.set(uri, source);
    }
    if (source !== lastResolvedSource) scheduleAutomatic();
    rendered.fire(uri);
    return source.translations;
  };
  const waitForSnapshot = (request: TranslationRequest): Promise<SourceState | undefined> => {
    const uri = request.document.uri.toString();
    const existing = sources.get(uri);
    if (existing && existing.document === request.document && existing.version === request.version) {
      return Promise.resolve(existing);
    }
    return new Promise((resolve, reject) => {
      const finish = (source: SourceState | undefined, error?: Error): void => {
        clearTimeout(timer);
        listener.dispose();
        request.controller.signal.removeEventListener("abort", cancel);
        if (error) {
          reject(error);
        } else {
          resolve(source);
        }
      };
      const listener = rendered.event((renderedUri) => {
        if (renderedUri !== uri) {
          return;
        }
        const source = sources.get(uri);
        if (isCurrent(request) && source?.document === request.document && source.version === request.version) {
          finish(source);
        }
      });
      const cancel = (): void => finish(undefined);
      const timer = setTimeout(() => finish(undefined, new Error("The current Markdown preview is not ready. Wait for it to load, then toggle automatic translation off and on.")), 5_000);
      request.controller.signal.addEventListener("abort", cancel, { once: true });
      if (!isCurrent(request)) {
        finish(undefined);
        return;
      }
      void vscode.commands.executeCommand("markdown.preview.refresh").then(undefined, () => {
        finish(undefined, new Error("Could not refresh the built-in Markdown preview. Reopen it and try again."));
      });
    });
  };
  const translate = async (value: unknown): Promise<void> => {
    const session = automatic;
    if (!session || disposed) return;
    if (!vscode.workspace.isTrusted) {
      await vscode.window.showErrorMessage("Trust this workspace before using translation services.");
      return;
    }
    const group = vscode.window.tabGroups.activeTabGroup;
    const tab = group.activeTab;
    if (!tab) {
      return;
    }
    if (!((tab.input instanceof vscode.TabInputWebview && tab.input.viewType === "mainThreadWebview-markdown.preview")
      || (tab.input instanceof vscode.TabInputCustom && tab.input.viewType === "vscode.markdown.preview.editor"))) return;
    if (routes.size) {
      automaticPending = true;
      return;
    }
    const preview: NativePreview = { tab, group, input: tab.input, label: tab.label };
    const controller = new AbortController();
    routes.set(tab, controller);
    let request: TranslationRequest | undefined;
    try {
      const guardPreview = (): void => {
        if (!previewExists(preview)) {
          controller.abort();
        }
      };
      const routingListeners = [
        vscode.window.tabGroups.onDidChangeTabs(guardPreview),
        vscode.window.tabGroups.onDidChangeTabGroups(guardPreview),
      ];
      let document: vscode.TextDocument | undefined;
      try {
        document = await resolveSource(preview, value, controller.signal);
      } finally {
        for (const listener of routingListeners) {
          listener.dispose();
        }
      }
      if (routes.get(tab) === controller) routes.delete(tab);
      if (!document || automatic !== session || disposed || controller.signal.aborted || !previewIsActive(preview) || document.isClosed) {
        return;
      }
      const uri = document.uri.toString();
      for (const [otherUri, other] of requests) {
        if (otherUri !== uri) other.controller.abort();
      }
      const snapshot = sources.get(uri);
      lastResolvedSource = snapshot;
      if (snapshot && session.attempted.has(snapshot)) return;
      const existing = requests.get(uri);
      if (existing?.document === document && existing.version === document.version && !existing.controller.signal.aborted) {
        return;
      }
      existing?.controller.abort();
      const source = vscode.workspace.getConfiguration("translationReview").get<string>("source", "ai");
      if (source !== "ai" && source !== "google") throw new Error("Select a valid translation source: AI Provider or Google Translate.");
      const current: TranslationRequest = { document, version: document.version, settings: readSettings(), source, controller };
      request = current;
      requests.set(uri, current);
      await vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: "Translating Markdown Preview", cancellable: true }, async (progress, token) => {
        const cancellation = token.onCancellationRequested(() => controller.abort());
        try {
          if (token.isCancellationRequested || !isCurrent(current)) {
            controller.abort();
            return;
          }
          progress.report({ message: "Reading the current preview..." });
          const source = await waitForSnapshot(current);
          if (!source || !isCurrent(current) || sources.get(uri) !== source) {
            return;
          }
          lastResolvedSource = source;
          if (session.attempted.has(source)) return;
          session.attempted.add(source);
          const paragraphs = source.paragraphs.filter((paragraph) => !source.translations.has(paragraph.id));
          if (!paragraphs.length) {
            return;
          }
          let apiKey = "";
          if (current.source === "ai") {
            try {
              apiKey = await context.secrets.get(secretName(current.settings.endpoint)) ?? "";
            } catch {
              throw new Error("Could not read the API key. Set it again and retry.");
            }
          }
          if (!isCurrent(current) || sources.get(uri) !== source) {
            return;
          }
          const total = paragraphs.length;
          let completed = 0;
          progress.report({ message: `0 / ${total}` });
          const publish = (translations: ReadonlyMap<string, string>): void => {
            if (!isCurrent(current) || sources.get(uri) !== source) {
              controller.abort();
              return;
            }
            for (const [id, text] of translations) source.translations.set(id, text);
            completed += translations.size;
            progress.report({ increment: 100 * translations.size / total, message: `${completed} / ${total}` });
            refresh();
          };
          if (current.source === "google") {
            await translateFreeSegments(paragraphs, current.settings.targetLanguage, controller.signal, publish);
          } else {
            await translateSegments(paragraphs, current.settings, apiKey, controller.signal, publish);
          }
          if (isCurrent(current) && sources.get(uri) === source) {
            void vscode.window.showInformationMessage(`Translation complete. Translated ${total} paragraphs.`);
          }
        } finally {
          cancellation.dispose();
        }
      });
    } catch (error) {
      if (!disposed && !controller.signal.aborted && (!request || isCurrent(request))) {
        const completed = request ? sources.get(request.document.uri.toString())?.translations.size ?? 0 : 0;
        const message = error instanceof Error ? error.message : "Translation failed. Please try again.";
        await vscode.window.showErrorMessage(completed ? `${message} Kept translations for ${completed} completed paragraphs.` : message);
      }
    } finally {
      if (routes.get(tab) === controller) {
        routes.delete(tab);
      }
      if (request && requests.get(request.document.uri.toString()) === request) {
        requests.delete(request.document.uri.toString());
      }
      if (automaticPending) scheduleAutomatic();
    }
  };
  const toggleTranslation = async (value: unknown): Promise<void> => {
    if (automatic) {
      automatic = undefined;
      clearTimeout(automaticTimer);
      automaticPending = false;
      for (const controller of routes.values()) controller.abort();
      for (const request of requests.values()) request.controller.abort();
      await vscode.commands.executeCommand("setContext", "translationReview.automatic", false);
      return;
    }
    if (!vscode.workspace.isTrusted) {
      await vscode.window.showErrorMessage("Trust this workspace before using translation services.");
      return;
    }
    const session = { attempted: new WeakSet<SourceState>() };
    automatic = session;
    await vscode.commands.executeCommand("setContext", "translationReview.automatic", true);
    if (automatic === session) await translate(value);
  };
  void vscode.commands.executeCommand("setContext", "translationReview.automatic", false);

  context.subscriptions.push(
    rendered,
    vscode.commands.registerCommand("translationReview.translate", toggleTranslation),
    vscode.commands.registerCommand("translationReview.disableAutomatic", toggleTranslation),
    vscode.window.tabGroups.onDidChangeTabs(observePreview),
    vscode.window.tabGroups.onDidChangeTabGroups(observePreview),
    vscode.commands.registerCommand("translationReview.setApiKey", () => setApiKey(context.secrets)),
    vscode.workspace.onDidChangeTextDocument((event) => {
      const uri = event.document.uri.toString();
      const source = sources.get(uri);
      const request = requests.get(uri);
      if ((source && source.version !== event.document.version) || (request && request.version !== event.document.version)) {
        invalidate(uri);
        refresh();
        scheduleAutomatic();
      }
    }),
    vscode.workspace.onDidCloseTextDocument((document) => {
      invalidate(document.uri.toString());
    }),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("translationReview.source") || event.affectsConfiguration("translationReview.endpoint") || event.affectsConfiguration("translationReview.model") || event.affectsConfiguration("translationReview.targetLanguage")) {
        invalidateAll();
      }
    }),
    context.secrets.onDidChange((event) => {
      try {
        if (event.key === secretName(readSettings().endpoint)) {
          invalidateAll();
        }
      } catch {
        return;
      }
    }),
    new vscode.Disposable(() => {
      disposed = true;
      automatic = undefined;
      clearTimeout(automaticTimer);
      invalidateAll();
      sources.clear();
      routes.clear();
    }),
  );
  return { extendMarkdownIt: (md: MarkdownIt): MarkdownIt => extendMarkdownIt(md, lookup) };
}
