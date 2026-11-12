import * as vscode from "vscode";

import { resolveTargetLanguage, translationLanguages } from "./translationLanguages";

type SourcePick = vscode.QuickPickItem & { source: "ai" | "google" };
type LanguagePick = vscode.QuickPickItem & { code: string };
const customLanguageCode = "__custom__";
const translationSources: readonly SourcePick[] = [
  {
    source: "ai",
    label: "AI Provider",
    description: "ai · Use the configured API and model",
    detail: "Keeps your existing endpoint, model, and API key settings.",
  },
  {
    source: "google",
    label: "Google Translate",
    description: "google · No API key required",
    detail: "Unofficial online service. Source text is sent to Google. The service may be rate-limited or unavailable. Translation sources will not switch automatically.",
  },
];

export function registerTranslationControls(context: vscode.ExtensionContext): void {
  const languageStatus = vscode.window.createStatusBarItem("translationReview.targetLanguage", vscode.StatusBarAlignment.Right, 100);
  const cancellation = new vscode.CancellationTokenSource();
  languageStatus.name = "MarkDown Preview Translate target language";
  languageStatus.command = "translationReview.selectTargetLanguage";

  const refresh = (): void => {
    const configuration = vscode.workspace.getConfiguration("translationReview");
    const source = configuration.get<string>("source", "ai");
    const target = configuration.inspect<string>("targetLanguage");
    const targetLanguage = target?.globalValue ?? target?.defaultValue ?? "zh-CN";
    const language = resolveTargetLanguage(targetLanguage);
    const sourceChoice = translationSources.find((choice) => choice.source === source);
    languageStatus.text = language?.label ?? targetLanguage;
    const tooltip = new vscode.MarkdownString();
    tooltip.appendText(`Target language: ${language?.label ?? targetLanguage}. Click to change the target language.\n\n`);
    tooltip.appendText(`Current translation source: ${sourceChoice?.label ?? source}.\n\n`);
    tooltip.appendMarkdown("[Change translation source](command:translationReview.selectSource)");
    if (sourceChoice?.detail) tooltip.appendText(`\n\n${sourceChoice.detail}`);
    tooltip.isTrusted = { enabledCommands: ["translationReview.selectSource"] };
    languageStatus.tooltip = tooltip;

    const input = vscode.window.tabGroups.activeTabGroup.activeTab?.input;
    const visible = (input instanceof vscode.TabInputWebview && input.viewType === "mainThreadWebview-markdown.preview")
      || (input instanceof vscode.TabInputCustom && input.viewType === "vscode.markdown.preview.editor")
      || (input instanceof vscode.TabInputText && vscode.workspace.textDocuments.some((document) =>
        !document.isClosed && document.languageId === "markdown" && document.uri.toString() === input.uri.toString()));
    if (visible) {
      languageStatus.show();
    } else {
      languageStatus.hide();
    }
  };

  context.subscriptions.push(
    languageStatus,
    new vscode.Disposable(() => {
      cancellation.cancel();
      cancellation.dispose();
    }),
    vscode.commands.registerCommand("translationReview.selectSource", async () => {
      const configuration = vscode.workspace.getConfiguration("translationReview");
      const current = configuration.get<string>("source", "ai");
      const selected = await vscode.window.showQuickPick(
        translationSources.map((source) => ({ ...source, picked: source.source === current })),
        {
          title: "Select translation source",
          placeHolder: "AI uses your configured API. Google is an unofficial online service with no API key required.",
          matchOnDescription: true,
          matchOnDetail: true,
        },
        cancellation.token,
      );
      if (!selected || cancellation.token.isCancellationRequested) return;
      const latest = vscode.workspace.getConfiguration("translationReview");
      if (latest.get<string>("source", "ai") !== selected.source) {
        await latest.update("source", selected.source, vscode.ConfigurationTarget.Global);
      }
    }),
    vscode.commands.registerCommand("translationReview.selectTargetLanguage", async () => {
      const configuration = vscode.workspace.getConfiguration("translationReview");
      const target = configuration.inspect<string>("targetLanguage");
      const current = target?.globalValue ?? target?.defaultValue ?? "zh-CN";
      const currentLanguage = resolveTargetLanguage(current);
      const languages: LanguagePick[] = translationLanguages.map((language) => ({
        code: language.code,
        label: language.label,
        description: language.code,
        detail: language.aliases.join(" · "),
        picked: language.code === currentLanguage?.code,
      }));
      if (configuration.get<string>("source", "ai") === "ai") {
        languages.push({
          code: customLanguageCode,
          label: "Custom language",
          description: "AI only",
          detail: "Enter any target language name. Google Translate supports only the standard codes above.",
        });
      }
      const selected = await vscode.window.showQuickPick(languages, {
        title: "Select target language",
        placeHolder: `Search by language name or code. Current language: ${currentLanguage?.label ?? current}`,
        matchOnDescription: true,
        matchOnDetail: true,
      }, cancellation.token);
      if (!selected || cancellation.token.isCancellationRequested) return;
      let value = selected.code;
      if (value === customLanguageCode) {
        const custom = await vscode.window.showInputBox({
          title: "Enter a custom target language",
          prompt: "AI sends this name to your configured model as entered.",
          value: currentLanguage ? "" : current,
          ignoreFocusOut: true,
          validateInput: (input) => input.trim() ? undefined : "Enter a target language.",
        });
        if (custom === undefined || cancellation.token.isCancellationRequested) return;
        value = custom.trim();
      }
      const latest = vscode.workspace.getConfiguration("translationReview").inspect<string>("targetLanguage");
      if ((latest?.globalValue ?? latest?.defaultValue ?? "zh-CN") !== value) {
        await vscode.workspace.getConfiguration("translationReview").update("targetLanguage", value, vscode.ConfigurationTarget.Global);
      }
    }),
    vscode.window.tabGroups.onDidChangeTabs(refresh),
    vscode.window.tabGroups.onDidChangeTabGroups(refresh),
    vscode.window.onDidChangeActiveTextEditor(refresh),
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidCloseTextDocument(refresh),
    vscode.workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration("translationReview")) refresh();
    }),
  );
  refresh();
}
