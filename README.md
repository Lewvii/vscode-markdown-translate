# MarkDown Preview Translate

Translate Markdown text in VS Code's built-in Markdown preview without changing the source file. Use Google Translate or an OpenAI-compatible AI provider.

## Install

Use VS Code 1.95 or later. Install **MarkDown Preview Translate** from the Extensions view, or run **Extensions: Install from VSIX...** to install a downloaded `.vsix` file.

If you used the earlier local **Translation Review** or **MarkDown Translate** extension, disable or uninstall it before enabling MarkDown Preview Translate. Existing endpoint, model, and language settings still apply. Keys saved by earlier versions in SecretStorage are no longer read or migrated. Enter your key in **Translation Review: Api Key** in User Settings.

## Choose a translation source

1. Open a Markdown file in a trusted workspace.
2. Hover over the target language in the status bar.
3. Click **Change translation source**.
4. Select **AI Provider** or **Google Translate**.

AI is selected by default. Choosing **AI Provider** opens the extension's native User Settings so you can configure the endpoint, model, and API key together. The extension does not switch providers automatically when a request fails.

### Use Google Translate

Select **Google Translate** to translate without an API key. No AI configuration is needed.

This option sends text to Google's unofficial online translation endpoint. Availability and rate limits are not guaranteed. Do not use it for content you cannot share with Google.

### Use an AI provider

1. Run **MarkDown Preview Translate: Configure AI Provider**, or select **AI Provider** from the translation source picker.
2. In User Settings, enter the complete Chat Completions **Endpoint**, **Model**, and **Api Key**. Leave the key blank if the service does not require authentication.

You can also edit these values in **Preferences: Open User Settings (JSON)**:

   ```json
   {
     "translationReview.source": "ai",
     "translationReview.endpoint": "https://api.openai.com/v1/chat/completions",
     "translationReview.model": "gpt-4o-mini",
     "translationReview.apiKey": "",
     "translationReview.targetLanguage": "zh-CN"
   }
   ```

The API key is stored as plain text in your user settings, alongside the endpoint and model. Do not share or commit settings containing a key. Settings Sync may copy it to your other installations unless you exclude it. Update or clear the key when you change providers; keys are no longer stored separately per endpoint.

Google Translate does not use the configured API key. Remote endpoints require HTTPS; local loopback endpoints may use HTTP.

## Choose a target language

Click the language name in the status bar, or run **MarkDown Preview Translate: Select Target Language**. Each row shows only the English language name. Search by that name, then select a language.

The default target is **Chinese (Simplified)** (`zh-CN`). Language choices and provider settings are saved at the user level. AI providers also accept a **Custom language** name; Google Translate requires a supported language from the list.

## Start and stop automatic translation

1. Open a Markdown file and run **Markdown: Open Preview**, or choose the built-in **Markdown Preview** editor.
2. By default, automatic translation starts without clicking the eye icon. The **red eye** indicates that it is enabled.
3. Follow Markdown links as usual. The active preview continues translating after navigation.
4. Click the **red eye** to disable automatic translation. Click the **blue eye** to enable it again.

In User Settings, **Translation Review: Automatic** (`translationReview.automatic`) controls whether automatic translation starts enabled. The checkbox is checked by default. Reload the window after changing it. The eye button changes only the current session and does not change this setting.

While enabled, opening a Markdown preview sends its text to the selected provider. Configure your AI provider or select Google Translate before opening a preview. Editing the current document or changing provider or target-language settings clears outdated translations and translates the current preview again.

Disabling cancels unfinished requests, clears cached translations for all documents in the window, and refreshes previews to show only the original Markdown. Late responses cannot restore cleared translations. Enabling translation again translates the current preview afresh. While enabled, returning to a document with cached translations does not resend completed paragraphs. Translations are kept in memory and are lost when the window reloads.

## Read translated content

Short translations appear beside the original text. Longer translations appear below it. Headings, lists, tables, emphasis, and links retain their formatting and link targets.

Before contacting either provider, the extension detects each paragraph's dominant language locally. For every supported detection language, it skips text confidently matching the target, even with embedded commands or product names. When detection is uncertain, predominantly non-Latin prose is checked without embedded Latin terms. Reliable paragraphs provide document context for ambiguous text with a compatible writing system, including short headings. Context is used only when reliable target-language paragraphs account for more than half of the document's analyzed words, counted with Unicode word segmentation. It never overrides a reliably identified foreign language. Protected formatting markers and dotted identifiers such as filenames are excluded from detection. Simplified and Traditional Chinese are checked separately. Text without enough evidence, unsupported detection languages, and custom target names still go through translation. Detection is heuristic; short words shared by related languages can remain ambiguous.

Translations identical to the original after whitespace normalization are not displayed. This applies to headings, paragraphs, lists, tables, and native frontmatter. Completed results remain cached, so suppressing a duplicate does not trigger another request.

Images, diagrams, code blocks, and inline code stay in the native preview. Code and image content are not sent for translation. Paragraphs containing inline math are left unchanged. Translation processes document text, not just the visible screen.

For a dynamic preview, the extension may briefly open its source tab to identify the exact document, then return to the preview.

## Handle a failed or cancelled request

Check the reported error, network connection, provider settings, and any service limits. For AI authentication errors, click **Configure AI Provider** in the error notification to open the same User Settings. Updating the API key invalidates cached translations. If automatic translation is enabled, return to the Markdown preview to translate with the updated configuration.

To retry unfinished paragraphs, turn automatic translation off and on. The extension does not retry failed requests automatically and retains completed results when possible.

Translation sends document text to the selected service while automatic translation is enabled. AI services may charge for requests. Cancelling local work does not guarantee that the provider stops processing or billing the request.
