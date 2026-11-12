export type TranslationLanguage = {
  readonly code: string;
  readonly label: string;
  readonly aliases: readonly string[];
};

export type ResolvedTranslationLanguage = Pick<TranslationLanguage, "code" | "label">;

export const translationLanguages: readonly TranslationLanguage[] = [
  { code: "zh-CN", label: "Chinese (Simplified)", aliases: ["简体中文", "简体", "中文", "中文（简体）", "Chinese", "Chinese (Simplified)", "Simplified Chinese", "zh", "zh-Hans", "zh-SG", "简体中文 / Chinese (Simplified)"] },
  { code: "zh-TW", label: "Chinese (Traditional)", aliases: ["繁體中文", "繁体中文", "繁體", "繁体", "中文（繁體）", "中文（繁体）", "Chinese (Traditional)", "Traditional Chinese", "zh-Hant", "zh-HK", "繁體中文 / Chinese (Traditional)"] },
  { code: "en", label: "English", aliases: ["English", "英语", "英語", "英文", "English / 英语"] },
  { code: "ja", label: "Japanese", aliases: ["日本語", "Japanese", "日语", "日語", "日文", "日本語 / Japanese / 日语"] },
  { code: "ko", label: "Korean", aliases: ["한국어", "Korean", "韩语", "韓語", "韩文", "朝鲜语", "한국어 / Korean / 韩语"] },
  { code: "de", label: "German", aliases: ["Deutsch", "German", "德语", "德語", "德文", "Deutsch / German / 德语"] },
  { code: "fr", label: "French", aliases: ["Français", "French", "法语", "法語", "法文", "Français / French / 法语"] },
  { code: "es", label: "Spanish", aliases: ["Español", "Spanish", "西班牙语", "西班牙語", "Español / Spanish / 西班牙语"] },
  { code: "ru", label: "Russian", aliases: ["Русский", "Russian", "俄语", "俄語", "俄文", "Русский / Russian / 俄语"] },
  { code: "pt", label: "Portuguese", aliases: ["Português", "Portuguese", "葡萄牙语", "葡萄牙語", "Português / Portuguese / 葡萄牙语"] },
  { code: "it", label: "Italian", aliases: ["Italiano", "Italian", "意大利语", "義大利語", "Italiano / Italian / 意大利语"] },
  { code: "nl", label: "Dutch", aliases: ["Nederlands", "Dutch", "荷兰语", "荷蘭語", "Nederlands / Dutch / 荷兰语"] },
  { code: "pl", label: "Polish", aliases: ["Polski", "Polish", "波兰语", "波蘭語", "Polski / Polish / 波兰语"] },
  { code: "uk", label: "Ukrainian", aliases: ["Українська", "Ukrainian", "乌克兰语", "烏克蘭語", "Українська / Ukrainian / 乌克兰语"] },
  { code: "cs", label: "Czech", aliases: ["Čeština", "Czech", "捷克语", "捷克語", "Čeština / Czech / 捷克语"] },
  { code: "sk", label: "Slovak", aliases: ["Slovenčina", "Slovak", "斯洛伐克语", "Slovenčina / Slovak / 斯洛伐克语"] },
  { code: "sv", label: "Swedish", aliases: ["Svenska", "Swedish", "瑞典语", "瑞典語", "Svenska / Swedish / 瑞典语"] },
  { code: "da", label: "Danish", aliases: ["Dansk", "Danish", "丹麦语", "丹麥語", "Dansk / Danish / 丹麦语"] },
  { code: "nb", label: "Norwegian", aliases: ["Norsk", "Norsk bokmål", "Norwegian", "Norwegian Bokmål", "挪威语", "挪威語", "no", "Norsk bokmål / Norwegian / 挪威语"] },
  { code: "fi", label: "Finnish", aliases: ["Suomi", "Finnish", "芬兰语", "芬蘭語", "Suomi / Finnish / 芬兰语"] },
  { code: "el", label: "Greek", aliases: ["Ελληνικά", "Greek", "希腊语", "希臘語", "Ελληνικά / Greek / 希腊语"] },
  { code: "tr", label: "Turkish", aliases: ["Türkçe", "Turkish", "土耳其语", "土耳其語", "Türkçe / Turkish / 土耳其语"] },
  { code: "ar", label: "Arabic", aliases: ["العربية", "Arabic", "阿拉伯语", "阿拉伯語", "العربية / Arabic / 阿拉伯语"] },
  { code: "he", label: "Hebrew", aliases: ["עברית", "Hebrew", "希伯来语", "希伯來語", "iw", "עברית / Hebrew / 希伯来语"] },
  { code: "fa", label: "Persian", aliases: ["فارسی", "Persian", "Farsi", "波斯语", "波斯語", "فارسی / Persian / 波斯语"] },
  { code: "hi", label: "Hindi", aliases: ["हिन्दी", "हिंदी", "Hindi", "印地语", "印地語", "हिन्दी / Hindi / 印地语"] },
  { code: "bn", label: "Bengali", aliases: ["বাংলা", "Bengali", "Bangla", "孟加拉语", "孟加拉語", "বাংলা / Bengali / 孟加拉语"] },
  { code: "ur", label: "Urdu", aliases: ["اردو", "Urdu", "乌尔都语", "烏爾都語", "اردو / Urdu / 乌尔都语"] },
  { code: "ta", label: "Tamil", aliases: ["தமிழ்", "Tamil", "泰米尔语", "坦米爾語", "தமிழ் / Tamil / 泰米尔语"] },
  { code: "te", label: "Telugu", aliases: ["తెలుగు", "Telugu", "泰卢固语", "泰盧固語", "తెలుగు / Telugu / 泰卢固语"] },
  { code: "th", label: "Thai", aliases: ["ไทย", "Thai", "泰语", "泰語", "ไทย / Thai / 泰语"] },
  { code: "vi", label: "Vietnamese", aliases: ["Tiếng Việt", "Vietnamese", "越南语", "越南語", "Tiếng Việt / Vietnamese / 越南语"] },
  { code: "id", label: "Indonesian", aliases: ["Bahasa Indonesia", "Indonesian", "印度尼西亚语", "印尼语", "印尼語", "in", "Bahasa Indonesia / Indonesian / 印度尼西亚语"] },
  { code: "ms", label: "Malay", aliases: ["Bahasa Melayu", "Malay", "马来语", "馬來語", "Bahasa Melayu / Malay / 马来语"] },
  { code: "tl", label: "Tagalog", aliases: ["Filipino", "Tagalog", "菲律宾语", "菲律賓語", "fil", "Filipino / Tagalog / 菲律宾语"] },
  { code: "ro", label: "Romanian", aliases: ["Română", "Romanian", "罗马尼亚语", "羅馬尼亞語", "Română / Romanian / 罗马尼亚语"] },
  { code: "hu", label: "Hungarian", aliases: ["Magyar", "Hungarian", "匈牙利语", "匈牙利語", "Magyar / Hungarian / 匈牙利语"] },
  { code: "bg", label: "Bulgarian", aliases: ["Български", "Bulgarian", "保加利亚语", "保加利亞語", "Български / Bulgarian / 保加利亚语"] },
  { code: "hr", label: "Croatian", aliases: ["Hrvatski", "Croatian", "克罗地亚语", "克羅埃西亞語", "Hrvatski / Croatian / 克罗地亚语"] },
  { code: "sr", label: "Serbian", aliases: ["Српски", "Srpski", "Serbian", "塞尔维亚语", "塞爾維亞語", "Српски / Serbian / 塞尔维亚语"] },
  { code: "sl", label: "Slovenian", aliases: ["Slovenščina", "Slovenian", "斯洛文尼亚语", "斯洛維尼亞語", "Slovenščina / Slovenian / 斯洛文尼亚语"] },
  { code: "et", label: "Estonian", aliases: ["Eesti", "Estonian", "爱沙尼亚语", "愛沙尼亞語", "Eesti / Estonian / 爱沙尼亚语"] },
  { code: "lv", label: "Latvian", aliases: ["Latviešu", "Latvian", "拉脱维亚语", "拉脫維亞語", "Latviešu / Latvian / 拉脱维亚语"] },
  { code: "lt", label: "Lithuanian", aliases: ["Lietuvių", "Lithuanian", "立陶宛语", "立陶宛語", "Lietuvių / Lithuanian / 立陶宛语"] },
  { code: "sw", label: "Swahili", aliases: ["Kiswahili", "Swahili", "斯瓦希里语", "斯瓦希里語", "Kiswahili / Swahili / 斯瓦希里语"] },
  { code: "af", label: "Afrikaans", aliases: ["Afrikaans", "南非荷兰语", "南非語", "Afrikaans / 南非荷兰语"] },
];

function normalizeLanguage(value: string): string {
  return value.trim().normalize("NFKC").toLowerCase().replace(/_/g, "-");
}

const languagesByName = new Map<string, TranslationLanguage>();
for (const language of translationLanguages) {
  for (const name of [language.code, language.label, ...language.aliases]) {
    languagesByName.set(normalizeLanguage(name), language);
  }
}

export function resolveTargetLanguage(value: string): ResolvedTranslationLanguage | undefined {
  return languagesByName.get(normalizeLanguage(value));
}
