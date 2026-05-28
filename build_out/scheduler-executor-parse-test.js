// supabase/functions/scheduler-executor/index.ts
import { createClient } from "npm:@supabase/supabase-js@2";
import { DOMParser } from "https://deno.land/x/deno_dom/deno-dom-wasm.ts";

// src/shared/generationPolicy.ts
var TARGET_WORD_COUNT_BY_LENGTH = {
  short: 1e3,
  medium: 2e3,
  long: 3e3
};
var DEFAULT_TARGET_WORD_COUNT = TARGET_WORD_COUNT_BY_LENGTH.medium;

// src/shared/multiStepPromptTemplates.ts
function buildSchedulerStructureRules(targetWordCount) {
  if (targetWordCount <= 1200) {
    return [
      "\u69CB\u6210\u30EB\u30FC\u30EB:",
      "- Lead 1\u3064\u3001H2\u30924\u3064\uFF08\u6700\u5F8C\u306F\u307E\u3068\u3081\uFF09",
      "- H3\u306F\u539F\u5247\u4F7F\u308F\u306A\u3044",
      "- \u898B\u51FA\u3057\u540C\u58EB\u306E\u91CD\u8907\u3092\u907F\u3051\u308B",
      "- \u539F\u56E0\u3001\u5177\u4F53\u7B56\u3001\u6CE8\u610F\u70B9\u306E\u3046\u3061\u6700\u4F4E2\u7A2E\u985E\u3092\u542B\u3081\u308B",
      "- \u5165\u529B\u30AD\u30FC\u30EF\u30FC\u30C9\u3092\u305D\u306E\u307E\u307E\u4E26\u3079\u305A\u3001\u8AAD\u8005\u304C\u7406\u89E3\u30FB\u5224\u65AD\u3059\u308B\u9806\u756A\u306B\u6574\u7406\u3059\u308B",
      "- \u898B\u51FA\u3057\u306F\u77ED\u3044\u5358\u8A9E\u3067\u306F\u306A\u304F\u3001\u8AAD\u8005\u306B\u5185\u5BB9\u3068\u4FA1\u5024\u304C\u4F1D\u308F\u308B\u6587\u7AE0\u5F62\u5F0F\u306B\u3059\u308B"
    ].join("\n");
  }
  if (targetWordCount <= 2500) {
    return [
      "\u69CB\u6210\u30EB\u30FC\u30EB:",
      "- Lead 1\u3064\u3001\u4E3B\u8981H2\u30923\u3064\u524D\u5F8C\u3001\u6700\u5F8C\u306B\u307E\u3068\u3081",
      "- H2\u306F\u7AE0\u30BF\u30A4\u30C8\u30EB\u3068\u3057\u3066\u4F7F\u3044\u3001\u672C\u6587\u306F\u7AE0\u306E\u5C0E\u5165\u7A0B\u5EA6\u306B\u77ED\u304F\u3059\u308B",
      "- \u4E3B\u8981H2\u306E\u76F4\u5F8C\u306BH3\u30923\u3064\u7F6E\u304D\u3001\u5177\u4F53\u8AD6\u306FH3\u3067\u5C55\u958B\u3059\u308B",
      "- \u8A18\u4E8B\u5168\u4F53\u3067H3\u30928\u301C10\u3064\u8FFD\u52A0\u30022000\u5B57\u524D\u5F8C\u3067\u306F\u4E3B\u8981H2 3\u3064 \xD7 H3 3\u3064\u3092\u76EE\u5B89\u306B\u3059\u308B",
      "- \u307E\u3068\u3081\u30FB\u5C0E\u5165\u306B\u306FH3\u3092\u4ED8\u3051\u306A\u3044",
      "- \u5404H2\u306F\u7570\u306A\u308B\u30C8\u30D4\u30C3\u30AF\u3092\u62C5\u5F53\u3059\u308B\u3053\u3068\u3002\u540C\u3058\u30C6\u30FC\u30DE\u3092\u5225\u306E\u8868\u73FE\u3067\u7E70\u308A\u8FD4\u3055\u306A\u3044",
      "- \u539F\u56E0\u3001\u5177\u4F53\u7B56\u3001\u6BD4\u8F03\u3001\u9078\u3073\u65B9\u3001\u6CE8\u610F\u70B9\u3001\u5C0E\u5165\u624B\u9806\u306E\u3046\u3061\u6700\u4F4E3\u7A2E\u985E\u3092\u542B\u3081\u308B",
      "- \u5BFE\u7B56\u7CFB\u306E\u8A18\u4E8B\u3067\u306F\u3001\u539F\u56E0\u3001\u512A\u5148\u9806\u4F4D\u3001\u7D44\u307F\u5408\u308F\u305B\u65B9\u3001\u5C0E\u5165\u524D\u306E\u6CE8\u610F\u70B9\u3092\u542B\u3081\u308B",
      "- \u95A2\u9023\u30AD\u30FC\u30EF\u30FC\u30C9\u3092\u6A2A\u4E26\u3073\u306B\u305B\u305A\u3001\u4E3B\u984C\u306B\u5BFE\u3059\u308B\u5F79\u5272\u3068\u3057\u3066\u6574\u7406\u3059\u308B",
      "- \u62BD\u8C61\u7684\u306A\u898B\u51FA\u3057\u3060\u3051\u3067\u7D42\u308F\u3089\u305B\u305A\u3001\u8AAD\u8005\u304C\u5B9F\u884C\u3067\u304D\u308B\u7C92\u5EA6\u306B\u5206\u89E3\u3059\u308B",
      "- \u898B\u51FA\u3057\u306F\u77ED\u3044\u5358\u8A9E\u3067\u306F\u306A\u304F\u3001\u8AAD\u8005\u306B\u5185\u5BB9\u3068\u4FA1\u5024\u304C\u4F1D\u308F\u308B\u6587\u7AE0\u5F62\u5F0F\u306B\u3059\u308B"
    ].join("\n");
  }
  return [
    "\u69CB\u6210\u30EB\u30FC\u30EB:",
    "- Lead 1\u3064\u3001\u4E3B\u8981H2\u30924\u3064\u524D\u5F8C\u3001\u6700\u5F8C\u306B\u307E\u3068\u3081",
    "- H2\u306F\u7AE0\u30BF\u30A4\u30C8\u30EB\u3068\u3057\u3066\u4F7F\u3044\u3001\u672C\u6587\u306F\u7AE0\u306E\u5C0E\u5165\u7A0B\u5EA6\u306B\u77ED\u304F\u3059\u308B",
    "- \u4E3B\u8981H2\u306E\u76F4\u5F8C\u306BH3\u30923\u3064\u7F6E\u304D\u3001\u5177\u4F53\u8AD6\u306FH3\u3067\u5C55\u958B\u3059\u308B",
    "- \u8A18\u4E8B\u5168\u4F53\u3067H3\u309210\u301C13\u3064\u8FFD\u52A0\u3002\u305F\u3060\u3057\u307E\u3068\u3081\u30FB\u5C0E\u5165\u306B\u306FH3\u3092\u4ED8\u3051\u306A\u3044",
    "- \u5404H2\u306F\u7570\u306A\u308B\u30C8\u30D4\u30C3\u30AF\u3092\u62C5\u5F53\u3059\u308B\u3053\u3068\u3002\u540C\u3058\u30C6\u30FC\u30DE\u3092\u5225\u306E\u8868\u73FE\u3067\u7E70\u308A\u8FD4\u3055\u306A\u3044",
    "- \u7DB2\u7F85\u6027\u3068\u91CD\u8907\u56DE\u907F\u3092\u4E21\u7ACB\u3059\u308B",
    "- \u539F\u56E0\u3001\u5177\u4F53\u7B56\u3001\u6BD4\u8F03\u3001\u9078\u3073\u65B9\u3001\u6CE8\u610F\u70B9\u3001\u5C0E\u5165\u624B\u9806\u3001\u8CBB\u7528\u611F\u306E\u3046\u3061\u6700\u4F4E4\u7A2E\u985E\u3092\u542B\u3081\u308B",
    "- \u5BFE\u7B56\u7CFB\u306E\u8A18\u4E8B\u3067\u306F\u3001\u539F\u56E0\u3001\u512A\u5148\u9806\u4F4D\u3001\u7D44\u307F\u5408\u308F\u305B\u65B9\u3001\u5C0E\u5165\u524D\u306E\u6CE8\u610F\u70B9\u3092\u5FC5\u305A\u542B\u3081\u308B",
    "- \u95A2\u9023\u30AD\u30FC\u30EF\u30FC\u30C9\u3092\u6A2A\u4E26\u3073\u306B\u305B\u305A\u3001\u4E3B\u984C\u306B\u5BFE\u3059\u308B\u5F79\u5272\u3068\u3057\u3066\u6574\u7406\u3059\u308B",
    "- \u62BD\u8C61\u7684\u306A\u898B\u51FA\u3057\u3060\u3051\u3067\u7D42\u308F\u3089\u305B\u305A\u3001\u8AAD\u8005\u304C\u5B9F\u884C\u3067\u304D\u308B\u7C92\u5EA6\u306B\u5206\u89E3\u3059\u308B",
    "- \u898B\u51FA\u3057\u306F\u77ED\u3044\u5358\u8A9E\u3067\u306F\u306A\u304F\u3001\u8AAD\u8005\u306B\u5185\u5BB9\u3068\u4FA1\u5024\u304C\u4F1D\u308F\u308B\u6587\u7AE0\u5F62\u5F0F\u306B\u3059\u308B"
  ].join("\n");
}
function buildCountermeasureOutlinePattern() {
  return [
    "\u3010\u8AB2\u984C\u89E3\u6C7A\u578B\u8A18\u4E8B\u306E\u63A8\u5968H2\u30D1\u30BF\u30FC\u30F3\u3011",
    "- [\u4E3B\u984C]\u304C\u8D77\u304D\u308B\u7406\u7531\u30FB\u539F\u56E0",
    "- \u307E\u305A\u78BA\u8A8D\u3059\u3079\u304D\u72B6\u6CC1\u30FB\u512A\u5148\u9806\u4F4D",
    "- \u4E3B\u8981\u306A\u5BFE\u7B561: \u4F55\u3092\u3069\u3046\u6539\u5584\u3059\u308B\u304B",
    "- \u4E3B\u8981\u306A\u5BFE\u7B562: \u5225\u89D2\u5EA6\u304B\u3089\u4F55\u3092\u88DC\u3046\u304B",
    "- \u8907\u6570\u306E\u5BFE\u7B56\u3092\u3069\u3046\u7D44\u307F\u5408\u308F\u305B\u308B\u304B",
    "- \u5C0E\u5165\u524D\u306B\u78BA\u8A8D\u3059\u3079\u304D\u8CBB\u7528\u30FB\u65BD\u5DE5\u30FB\u5B89\u5168\u9762\u306E\u6CE8\u610F\u70B9",
    "- \u307E\u3068\u3081",
    "",
    "\u907F\u3051\u308B\u3079\u304D\u898B\u51FA\u3057\u30D1\u30BF\u30FC\u30F3:",
    "- [\u4E3B\u984C]\u306E\u6D3B\u7528\u65B9\u6CD5",
    "- [\u4E3B\u984C]\u306E\u9078\u3073\u65B9\u3068\u6CE8\u610F\u70B9",
    "- [\u4E3B\u984C]\u306E\u7A2E\u985E\u3068\u7279\u5FB4",
    "- [\u4E3B\u984C]\u3068\u306F\uFF1F",
    "- \u3088\u304F\u3042\u308B\u7591\u554F"
  ].join("\n");
}
function buildArticleStructureTemplate(type = "standard") {
  switch (type) {
    case "problem_solution":
      return [
        "\u8A18\u4E8B\u69CB\u6210\u30BF\u30A4\u30D7: \u8AB2\u984C\u89E3\u6C7A\u578B",
        "- \u8AAD\u8005\u306E\u60A9\u307F\u30FB\u56F0\u308A\u3054\u3068\u3092\u8D77\u70B9\u306B\u3059\u308B",
        "- \u539F\u56E0\u3001\u512A\u5148\u3059\u3079\u304D\u5BFE\u7B56\u3001\u89E3\u6C7A\u7B56\u3001\u9078\u3073\u65B9\u3001\u5C0E\u5165\u624B\u9806\u3001\u6CE8\u610F\u70B9\u3001\u307E\u3068\u3081\u306E\u6D41\u308C\u3092\u512A\u5148\u3059\u308B",
        "- \u8907\u6570\u306E\u5BFE\u7B56\u304C\u3042\u308B\u5834\u5408\u306F\u3001\u305D\u308C\u305E\u308C\u3092\u7F85\u5217\u305B\u305A\u7D44\u307F\u5408\u308F\u305B\u65B9\u307E\u3067\u6574\u7406\u3059\u308B",
        "- \u5404\u5BFE\u7B56\u306F\u300C\u4F55\u3092\u3059\u308C\u3070\u3088\u3044\u304B\u300D\u304C\u5206\u304B\u308B\u7C92\u5EA6\u306B\u3059\u308B"
      ].join("\n");
    case "comparison":
      return [
        "\u8A18\u4E8B\u69CB\u6210\u30BF\u30A4\u30D7: \u6BD4\u8F03\u30FB\u9078\u5B9A\u578B",
        "- \u9078\u3076\u524D\u306E\u524D\u63D0\u3001\u6BD4\u8F03\u8EF8\u3001\u9078\u3073\u65B9\u3001\u5411\u304D\u4E0D\u5411\u304D\u3001\u6CE8\u610F\u70B9\u3001\u307E\u3068\u3081\u306E\u6D41\u308C\u3092\u512A\u5148\u3059\u308B",
        "- \u6761\u4EF6\u5225\u306B\u3069\u308C\u3092\u9078\u3076\u3079\u304D\u304B\u5224\u65AD\u3067\u304D\u308B\u69CB\u6210\u306B\u3059\u308B",
        "- \u8907\u6570\u306E\u9078\u629E\u80A2\u3092\u5358\u306B\u4E26\u3079\u305A\u3001\u8AAD\u8005\u306E\u6761\u4EF6\u3054\u3068\u306E\u512A\u5148\u9806\u4F4D\u3092\u793A\u3059",
        "- \u6BD4\u8F03\u9805\u76EE\u306F\u62BD\u8C61\u8AD6\u3067\u306F\u306A\u304F\u3001\u8CBB\u7528\u30FB\u52B9\u679C\u30FB\u624B\u9593\u30FB\u30EA\u30B9\u30AF\u306A\u3069\u5177\u4F53\u7684\u306B\u3059\u308B"
      ].join("\n");
    case "practical":
      return [
        "\u8A18\u4E8B\u69CB\u6210\u30BF\u30A4\u30D7: \u5B9F\u52D9\u30CE\u30A6\u30CF\u30A6\u578B",
        "- \u73FE\u5834\u306E\u8AB2\u984C\u3001\u5B9F\u8DF5\u624B\u9806\u3001\u5931\u6557\u4F8B\u3001\u6539\u5584\u7B56\u3001\u904B\u7528\u30DD\u30A4\u30F3\u30C8\u3001\u307E\u3068\u3081\u306E\u6D41\u308C\u3092\u512A\u5148\u3059\u308B",
        "- \u8AAD\u8005\u304C\u5B9F\u52D9\u3067\u305D\u306E\u307E\u307E\u4F7F\u3048\u308B\u78BA\u8A8D\u9805\u76EE\u3084\u624B\u9806\u3092\u5165\u308C\u308B",
        "- \u73FE\u5834\u3067\u78BA\u8A8D\u3059\u308B\u9806\u756A\u3001\u5C0E\u5165\u3059\u308B\u9806\u756A\u3001\u904B\u7528\u3067\u898B\u76F4\u3059\u70B9\u3092\u5206\u3051\u308B",
        "- \u6CE8\u610F\u70B9\u306F\u5B9F\u884C\u6642\u306B\u8D77\u304D\u3084\u3059\u3044\u554F\u984C\u3068\u3057\u3066\u5177\u4F53\u5316\u3059\u308B"
      ].join("\n");
    case "seo_comprehensive":
      return [
        "\u8A18\u4E8B\u69CB\u6210\u30BF\u30A4\u30D7: SEO\u7DB2\u7F85\u578B",
        "- \u57FA\u790E\u77E5\u8B58\u3001\u539F\u56E0\u3001\u5177\u4F53\u7B56\u3001\u6BD4\u8F03\u3001\u9078\u3073\u65B9\u3001\u6CE8\u610F\u70B9\u3001\u3088\u304F\u3042\u308B\u7591\u554F\u3001\u307E\u3068\u3081\u306E\u6D41\u308C\u3092\u512A\u5148\u3059\u308B",
        "- \u691C\u7D22\u610F\u56F3\u3092\u5E83\u304F\u62FE\u3044\u3001\u95A2\u9023\u8AD6\u70B9\u306E\u629C\u3051\u6F0F\u308C\u3092\u6E1B\u3089\u3059",
        "- \u95A2\u9023\u30AD\u30FC\u30EF\u30FC\u30C9\u3054\u3068\u306E\u898B\u51FA\u3057\u3092\u91CF\u7523\u305B\u305A\u3001\u8AAD\u8005\u306E\u7591\u554F\u306E\u6D41\u308C\u306B\u7D71\u5408\u3059\u308B",
        "- \u4F3C\u305F\u898B\u51FA\u3057\u306E\u91CD\u8907\u3092\u907F\u3051\u3001\u5404\u898B\u51FA\u3057\u306E\u5F79\u5272\u3092\u660E\u78BA\u306B\u5206\u3051\u308B"
      ].join("\n");
    case "conversion":
      return [
        "\u8A18\u4E8B\u69CB\u6210\u30BF\u30A4\u30D7: \u554F\u3044\u5408\u308F\u305B\u5C0E\u7DDA\u578B",
        "- \u8AB2\u984C\u63D0\u8D77\u3001\u653E\u7F6E\u30EA\u30B9\u30AF\u3001\u89E3\u6C7A\u7B56\u3001\u5C0E\u5165\u30E1\u30EA\u30C3\u30C8\u3001\u76F8\u8AC7\u524D\u306E\u78BA\u8A8D\u70B9\u3001\u307E\u3068\u3081\u306E\u6D41\u308C\u3092\u512A\u5148\u3059\u308B",
        "- \u904E\u5EA6\u306B\u717D\u3089\u305A\u3001\u554F\u3044\u5408\u308F\u305B\u524D\u306B\u6574\u7406\u3059\u3079\u304D\u5224\u65AD\u6750\u6599\u3092\u5165\u308C\u308B",
        "- \u81EA\u529B\u5BFE\u5FDC\u3068\u76F8\u8AC7\u3059\u3079\u304D\u30B1\u30FC\u30B9\u306E\u9055\u3044\u304C\u5206\u304B\u308B\u69CB\u6210\u306B\u3059\u308B",
        "- \u4E8B\u696D\u8005\u306B\u76F8\u8AC7\u3059\u308B\u7406\u7531\u304C\u81EA\u7136\u306B\u4F1D\u308F\u308B\u69CB\u6210\u306B\u3059\u308B"
      ].join("\n");
    default:
      return [
        "\u8A18\u4E8B\u69CB\u6210\u30BF\u30A4\u30D7: \u6A19\u6E96\u89E3\u8AAC\u578B",
        "- \u57FA\u790E\u77E5\u8B58\u3001\u539F\u56E0\u3001\u5177\u4F53\u7B56\u3001\u9078\u3073\u65B9\u3001\u6CE8\u610F\u70B9\u3001\u307E\u3068\u3081\u306E\u6D41\u308C\u3092\u512A\u5148\u3059\u308B",
        "- \u8AAD\u8005\u304C\u5168\u4F53\u50CF\u3092\u7406\u89E3\u3057\u3066\u6B21\u306E\u884C\u52D5\u3092\u6C7A\u3081\u3089\u308C\u308B\u69CB\u6210\u306B\u3059\u308B",
        "- \u95A2\u9023\u30AD\u30FC\u30EF\u30FC\u30C9\u306F\u5358\u72EC\u898B\u51FA\u3057\u306B\u305B\u305A\u3001\u4E3B\u984C\u306E\u7406\u89E3\u306B\u5FC5\u8981\u306A\u4F4D\u7F6E\u3078\u7D71\u5408\u3059\u308B",
        "- \u4E00\u822C\u8AD6\u3060\u3051\u3067\u306A\u304F\u3001\u5B9F\u52D9\u3067\u4F7F\u3048\u308B\u5224\u65AD\u57FA\u6E96\u3092\u5165\u308C\u308B"
      ].join("\n");
  }
}
function buildAioStructureGuidelines() {
  return [
    "AIO\u30FBAI\u691C\u7D22\u5411\u3051\u69CB\u9020\u5316\u30EB\u30FC\u30EB:",
    "- \u5C0E\u5165\u3067\u306F\u8AAD\u8005\u306E\u8CEA\u554F\u306B\u5BFE\u3059\u308B\u7D50\u8AD6\u3092\u5148\u306B\u793A\u3057\u3001\u8A18\u4E8B\u5168\u4F53\u3067\u4F55\u304C\u5206\u304B\u308B\u304B\u3092\u660E\u78BA\u306B\u3059\u308B",
    "- \u5404H2/H3\u306F\u300C\u5B9A\u7FA9\u300D\u300C\u539F\u56E0\u300D\u300C\u624B\u9806\u300D\u300C\u6BD4\u8F03\u300D\u300C\u5224\u65AD\u57FA\u6E96\u300D\u300C\u6CE8\u610F\u70B9\u300D\u300CFAQ\u300D\u306E\u3069\u306E\u5F79\u5272\u304B\u5206\u304B\u308B\u898B\u51FA\u3057\u306B\u3059\u308B",
    "- AI\u304C\u8981\u7D04\u3057\u3084\u3059\u3044\u3088\u3046\u306B\u30011\u3064\u306E\u898B\u51FA\u3057\u3067\u8907\u6570\u30C6\u30FC\u30DE\u3092\u6DF7\u305C\u305A\u3001\u7B54\u3048\u3092\u77ED\u304F\u62BD\u51FA\u3067\u304D\u308B\u69CB\u6210\u306B\u3059\u308B",
    "- \u624B\u9806\u3084\u9078\u3073\u65B9\u3092\u6271\u3046\u5834\u5408\u306F\u3001\u9806\u756A\u30FB\u6761\u4EF6\u30FB\u5224\u65AD\u57FA\u6E96\u304C\u5206\u304B\u308B\u6D41\u308C\u306B\u3059\u308B",
    "- \u6BD4\u8F03\u3092\u6271\u3046\u5834\u5408\u306F\u3001\u6BD4\u8F03\u8EF8\u3092\u5148\u306B\u793A\u3057\u3001\u9055\u3044\u30FB\u5411\u3044\u3066\u3044\u308B\u30B1\u30FC\u30B9\u30FB\u6CE8\u610F\u70B9\u3092\u5206\u3051\u308B",
    "- \u3088\u304F\u3042\u308B\u7591\u554F\u304C\u60F3\u5B9A\u3055\u308C\u308B\u30C6\u30FC\u30DE\u3067\u306F\u3001\u7D42\u76E4\u306BFAQ\u3078\u8EE2\u7528\u3057\u3084\u3059\u3044\u7591\u554F\u89E3\u6D88\u306E\u898B\u51FA\u3057\u3092\u5165\u308C\u308B",
    "- \u307E\u3068\u3081\u3067\u306F\u5358\u306A\u308B\u518D\u63B2\u3067\u306F\u306A\u304F\u3001\u8AAD\u8005\u304C\u6B21\u306B\u53D6\u308B\u884C\u52D5\u3084\u78BA\u8A8D\u70B9\u3092\u7C21\u6F54\u306B\u6574\u7406\u3059\u308B"
  ].join("\n");
}
function buildSearchConsoleQueryGuidance(queries) {
  const rows = (queries || []).map((row) => ({
    query: String(row.query || "").trim(),
    clicks: row.clicks ?? 0,
    impressions: row.impressions ?? 0,
    ctr: row.ctr,
    position: row.position
  })).filter((row) => row.query).slice(0, 10);
  if (rows.length === 0) return "";
  const formatPercent = (value) => typeof value === "number" && Number.isFinite(value) ? `${(value * 100).toFixed(1)}%` : "-";
  const formatPosition = (value) => typeof value === "number" && Number.isFinite(value) ? value.toFixed(1) : "-";
  const queryLines = rows.map((row) => `- ${row.query}\uFF08\u30AF\u30EA\u30C3\u30AF:${row.clicks} / \u8868\u793A:${row.impressions} / CTR:${formatPercent(row.ctr)} / \u5E73\u5747\u9806\u4F4D:${formatPosition(row.position)}\uFF09`).join("\n");
  return `
\u3010Search Console\u691C\u7D22\u30AF\u30A8\u30EA\uFF08\u691C\u7D22\u610F\u56F3\u306E\u88DC\u52A9\u6750\u6599\uFF09\u3011
${queryLines}

\u4F7F\u3044\u65B9:
- \u30AF\u30EA\u30C3\u30AF\u6570\u304C\u3042\u308B\u30AF\u30A8\u30EA\u306F\u3001\u65E2\u306B\u8AAD\u8005\u53CD\u5FDC\u304C\u3042\u308B\u8868\u73FE\u3068\u3057\u3066\u30BF\u30A4\u30C8\u30EB\u30FB\u5C0E\u5165\u30FB\u4E3B\u8981\u898B\u51FA\u3057\u306E\u53C2\u8003\u306B\u3059\u308B
- \u8868\u793A\u56DE\u6570\u304C\u591A\u304FCTR\u304C\u4F4E\u3044\u30AF\u30A8\u30EA\u306F\u3001\u8AAD\u8005\u306E\u7591\u554F\u306B\u5BFE\u3059\u308B\u7D50\u8AD6\u3084\u898B\u51FA\u3057\u306E\u5177\u4F53\u6027\u3092\u88DC\u3046\u6750\u6599\u306B\u3059\u308B
- \u5E73\u5747\u9806\u4F4D\u304C\u4F4E\u3044\u30AF\u30A8\u30EA\u306F\u3001\u672C\u6587\u3067\u88DC\u8DB3\u3059\u3079\u304D\u95A2\u9023\u7591\u554F\u3068\u3057\u3066\u6271\u3046
- \u30AF\u30A8\u30EA\u3092\u305D\u306E\u307E\u307E\u7F85\u5217\u3057\u305F\u308A\u3001\u5168\u3066\u3092\u898B\u51FA\u3057\u5316\u3057\u305F\u308A\u3057\u306A\u3044
`.trim();
}
function buildSchedulerOutlinePrompt(input) {
  const competitorInsights = (() => {
    if (input.competitorArticles && input.competitorArticles.length > 0) {
      const articlesText = input.competitorArticles.map((a, i) => {
        const headingLines = a.headings.slice(0, 5).map((h) => `  \u898B\u51FA\u3057: ${h}`).join("\n");
        const excerptLine = a.excerpt ? `  \u5185\u5BB9\u629C\u7C8B: ${a.excerpt}` : "";
        return `\u8A18\u4E8B${i + 1}\u300C${a.title}\u300D
${headingLines}${excerptLine ? "\n" + excerptLine : ""}`;
      }).join("\n\n");
      return `
\u3010\u4E0A\u4F4D\u8A18\u4E8B\u306E\u5185\u5BB9\uFF08\u53C2\u7167\u306E\u307F\u3002\u5206\u6790\u3084\u89E3\u8AAC\u306E\u51FA\u529B\u306F\u4E0D\u8981\u3002\u30A2\u30A6\u30C8\u30E9\u30A4\u30F3\u306E\u5F62\u5F0F\u3060\u3051\u3092\u51FA\u529B\u3059\u308B\u3053\u3068\uFF09\u3011
${articlesText}

\u203B\u4E0A\u8A18\u306E\u5185\u5BB9\u306B\u542B\u307E\u308C\u308B\u5177\u4F53\u7684\u306A\u8A71\u984C\u30FB\u89E3\u6C7A\u7B56\u30FB\u6CE8\u610F\u70B9\u3092\u30BB\u30AF\u30B7\u30E7\u30F3\u8A2D\u8A08\u306E\u6839\u62E0\u306B\u3059\u308B\u3053\u3068\u3002\u6839\u62E0\u306E\u306A\u3044\u6C4E\u7528\u7684\u306A\u898B\u51FA\u3057\u3092\u4F5C\u3089\u306A\u3044\u3053\u3068
`;
    }
    if (input.competitorHeadings && input.competitorHeadings.length > 0) {
      return `
\u3010\u4E0A\u4F4D\u8A18\u4E8B\u304C\u6271\u3063\u3066\u3044\u308B\u30C8\u30D4\u30C3\u30AF\uFF08\u8AAD\u8005\u306E\u671F\u5F85\u3059\u308B\u5185\u5BB9\u3092\u628A\u63E1\u3059\u308B\u6750\u6599\u3068\u3057\u3066\u4F7F\u3046\u3053\u3068\uFF09\u3011
- ${input.competitorHeadings.join("\n- ")}
\u203B\u3053\u308C\u3089\u306E\u30C8\u30D4\u30C3\u30AF\u304B\u3089\u8AAD\u8005\u306E\u7591\u554F\u3092\u63A8\u5B9A\u3057\u3001\u305D\u306E\u7591\u554F\u306B\u7B54\u3048\u308B\u898B\u51FA\u3057\u3092\u4F5C\u308B\u3053\u3068\u3002\u898B\u51FA\u3057\u306E\u8868\u73FE\u306F\u72EC\u7ACB\u3055\u305B\u308B\u3053\u3068
`;
    }
    return "";
  })();
  const relatedKeywordsSection = input.relatedKeywords && input.relatedKeywords.length > 0 ? `
\u3010\u8AAD\u8005\u306E\u95A2\u5FC3\u30AD\u30FC\u30EF\u30FC\u30C9\uFF08\u5404\u30AD\u30FC\u30EF\u30FC\u30C9\u3092\u5358\u72EC\u3067\u898B\u51FA\u3057\u5316\u305B\u305A\u3001\u6700\u3082\u9069\u5207\u306A\u30BB\u30AF\u30B7\u30E7\u30F3\u306B\u7D71\u5408\u3059\u308B\u3053\u3068\uFF09\u3011
${input.relatedKeywords.join("\u3001")}
` : "";
  const searchConsoleQuerySection = buildSearchConsoleQueryGuidance(input.searchConsoleQueries);
  const structureRules = buildSchedulerStructureRules(input.targetWordCount);
  const structureTemplate = buildArticleStructureTemplate(input.articleStructureType);
  const aioStructureGuidelines = buildAioStructureGuidelines();
  const countermeasurePattern = input.articleStructureType === "problem_solution" || !input.articleStructureType ? buildCountermeasureOutlinePattern() : "";
  return `
\u3042\u306A\u305F\u306F\u65E5\u672C\u8A9ESEO\u30E9\u30A4\u30BF\u30FC\u3067\u3059\u3002\u4EE5\u4E0B\u306E\u6761\u4EF6\u3067\u3001\u30AA\u30EA\u30B8\u30CA\u30EB\u306E\u8A18\u4E8B\u30A2\u30A6\u30C8\u30E9\u30A4\u30F3\u3092\u4F5C\u6210\u3057\u3066\u304F\u3060\u3055\u3044\u3002

\u3010\u30E1\u30A4\u30F3\u30AD\u30FC\u30EF\u30FC\u30C9\u3011
${input.keyword}

\u3010\u76EE\u6A19\u6587\u5B57\u6570\u3011
${input.targetWordCount}\u6587\u5B57

${input.fixedTitle ? `\u3010\u56FA\u5B9A\u30BF\u30A4\u30C8\u30EB\u3011
${input.fixedTitle}
` : ""}
${input.customInstructions ? `\u3010\u8FFD\u52A0\u6307\u793A\u3011
${input.customInstructions}
` : ""}
${competitorInsights}
${relatedKeywordsSection}
${searchConsoleQuerySection}
${structureRules}

${structureTemplate}

${aioStructureGuidelines}

${countermeasurePattern}

\u3010\u898B\u51FA\u3057\u4F5C\u6210\u30EB\u30FC\u30EB\u3011
- \u5404\u898B\u51FA\u3057\u306F\u3001\u8AAD\u8005\u306B\u305D\u306E\u30BB\u30AF\u30B7\u30E7\u30F3\u3067\u5F97\u3089\u308C\u308B\u5185\u5BB9\u30FB\u4FA1\u5024\u304C\u5177\u4F53\u7684\u306B\u4F1D\u308F\u308B\u8868\u73FE\u306B\u3059\u308B
- \u65E2\u5B58\u8A18\u4E8B\u306E\u898B\u51FA\u3057\u3092\u6A21\u5023\u3057\u306A\u3044\u3002\u69CB\u6210\u30FB\u8A9E\u9806\u30FB\u8868\u73FE\u3059\u3079\u3066\u30AA\u30EA\u30B8\u30CA\u30EB\u306B\u3059\u308B
- \u30AD\u30FC\u30EF\u30FC\u30C9\u3092\u6A5F\u68B0\u7684\u306B\u7E70\u308A\u8FD4\u3055\u306A\u3044\uFF08\u5168\u898B\u51FA\u3057\u306B\u540C\u3058\u8A9E\u3092\u5165\u308C\u306A\u3044\uFF09
- \u4E3B\u984C\u8A9E\u306F\u30BF\u30A4\u30C8\u30EB\u30FB\u5C0E\u5165\u30FB\u5FC5\u8981\u306AH2\u3060\u3051\u306B\u4F7F\u3044\u3001\u5168\u898B\u51FA\u3057\u306E\u5148\u982D\u306B\u540C\u3058\u8A9E\u3092\u4ED8\u3051\u306A\u3044
- \u540C\u3058\u4E3B\u984C\u8A9E\u3092\u7E70\u308A\u8FD4\u3059\u4EE3\u308F\u308A\u306B\u300C\u5185\u90E8\u300D\u300C\u4F5C\u696D\u74B0\u5883\u300D\u300C\u8A2D\u5099\u300D\u300C\u5BFE\u7B56\u300D\u300C\u5C0E\u5165\u524D\u300D\u306A\u3069\u5F79\u5272\u304C\u5206\u304B\u308B\u8868\u73FE\u3078\u7F6E\u304D\u63DB\u3048\u308B
- \u5165\u529B\u30AD\u30FC\u30EF\u30FC\u30C9\u3092\u305D\u306E\u307E\u307E\u898B\u51FA\u3057\u5316\u3057\u306A\u3044\u3002\u30AD\u30FC\u30EF\u30FC\u30C9\u306F\u4E3B\u984C\u306B\u5BFE\u3059\u308B\u5F79\u5272\u3078\u5909\u63DB\u3057\u3066\u914D\u7F6E\u3059\u308B
- \u898B\u51FA\u3057\u306F\u300C\u8AAD\u8005\u304C\u78BA\u8A8D\u30FB\u5224\u65AD\u30FB\u5B9F\u884C\u3059\u308B\u9806\u756A\u300D\u306B\u4E26\u3079\u308B
- \u5BFE\u7B56\u7CFB\u306E\u8A18\u4E8B\u3067\u306F\u3001\u5FC5\u305A\u300C\u539F\u56E0\u300D\u300C\u512A\u5148\u9806\u4F4D\u300D\u300C\u7D44\u307F\u5408\u308F\u305B\u65B9\u300D\u300C\u5C0E\u5165\u524D\u306E\u6CE8\u610F\u70B9\u300D\u3092\u542B\u3081\u308B
- \u95A2\u9023\u30AD\u30FC\u30EF\u30FC\u30C9\u3092\u4E26\u5217\u306B\u4E26\u3079\u305A\u3001\u4E3B\u984C\u306B\u6CBF\u3063\u3066\u539F\u56E0\u3001\u5BFE\u7B56\u3001\u6BD4\u8F03\u3001\u6CE8\u610F\u70B9\u306A\u3069\u3078\u518D\u5206\u985E\u3059\u308B
- \u300C\u590F\u300D\u300C\u65B9\u6CD5\u300D\u300C\u7A2E\u985E\u300D\u300C\u6D3B\u7528\u300D\u306A\u3069\u306E\u5E83\u3059\u304E\u308B\u5358\u8A9E\u3092\u5358\u72EC\u306E\u898B\u51FA\u3057\u30C6\u30FC\u30DE\u306B\u3057\u306A\u3044
- \u300C\u3007\u3007\u306E\u7A2E\u985E\u3068\u7279\u5FB4\u300D\u300C\u3007\u3007\u306E\u9078\u3073\u65B9\u3068\u6CE8\u610F\u70B9\u300D\u3060\u3051\u306E\u6D45\u3044\u898B\u51FA\u3057\u3092\u907F\u3051\u3001\u4F55\u3092\u5224\u65AD\u3067\u304D\u308B\u306E\u304B\u307E\u3067\u66F8\u304F
- \u300C\u301C\u306E\u30C1\u30A7\u30C3\u30AF\u30DD\u30A4\u30F3\u30C8\u300D\u300C\u301C\u306E\u30DD\u30A4\u30F3\u30C8\u3092\u62BC\u3055\u3048\u308B\u300D\u306A\u3069\u306E\u6C4E\u7528\u7684\u306A\u5B9A\u578B\u8868\u73FE\u3092\u907F\u3051\u308B
- \u4E00\u822C\u8AD6\u3060\u3051\u3067\u306A\u304F\u3001\u539F\u56E0\u3001\u5BFE\u7B56\u3001\u6BD4\u8F03\u3001\u9078\u5B9A\u57FA\u6E96\u3001\u6CE8\u610F\u70B9\u3001\u5C0E\u5165\u5F8C\u306E\u904B\u7528\u307E\u3067\u6D41\u308C\u304C\u5206\u304B\u308B\u69CB\u6210\u306B\u3059\u308B
- H3\u306F\u76F4\u524D\u306EH2\u3092\u88DC\u8DB3\u3059\u308B\u5C0F\u898B\u51FA\u3057\u3068\u3057\u3066\u914D\u7F6E\u3057\u3001\u72EC\u7ACB\u3057\u305F\u5927\u30C6\u30FC\u30DE\u306B\u3057\u306A\u3044
- \u539F\u56E0\u3068\u30EA\u30B9\u30AF\u3001\u9078\u629E\u80A2\u306E\u6BD4\u8F03\u3001\u5224\u65AD\u57FA\u6E96\u3068\u6CE8\u610F\u70B9\u306E\u3088\u3046\u306B\u3001\u672C\u6587\u304C\u9577\u304F\u306A\u308A\u3084\u3059\u3044H2\u306FH3\u3067\u5206\u3051\u308B
- \u30BF\u30A4\u30C8\u30EB\u3068\u30AD\u30FC\u30EF\u30FC\u30C9\u3060\u3051\u304B\u3089\u4F5C\u308B\u5834\u5408\u3067\u3082\u3001\u696D\u754C\u30FB\u7528\u9014\u30FB\u8AAD\u8005\u306E\u56F0\u308A\u3054\u3068\u3092\u63A8\u5B9A\u3057\u3066\u5177\u4F53\u5316\u3059\u308B
- \u898B\u51FA\u3057\u306E\u5148\u982D\u30FB\u672B\u5C3E\u306B\u300C\u300D\u3084\uFF08\uFF09\u306A\u3069\u306E\u62EC\u5F27\u8A18\u53F7\u3092\u4F7F\u308F\u306A\u3044
- \u51FA\u529B\u306F\u4E0B\u8A18\u30D5\u30A9\u30FC\u30DE\u30C3\u30C8\u306E\u307F\u3002\u524D\u7F6E\u304D\u30FB\u89E3\u8AAC\u30FB\u88DC\u8DB3\u306F\u4E0D\u8981

\u51FA\u529B\u5F62\u5F0F\uFF08\u3053\u306E\u5F62\u5F0F\u306E\u307F\uFF09:

Title: [\u8A18\u4E8B\u30BF\u30A4\u30C8\u30EB]

Section (Lead): [\u5C0E\u5165\u30BB\u30AF\u30B7\u30E7\u30F3\u540D]
Description: [\u3053\u306E\u30BB\u30AF\u30B7\u30E7\u30F3\u3067\u6271\u3046\u5185\u5BB9\u306E\u8981\u70B9\uFF0830\u5B57\u4EE5\u5185\uFF09]
Estimated: [\u63A8\u5B9A\u6587\u5B57\u6570]

Section (H2): [\u898B\u51FA\u3057]
Description: [\u3053\u306E\u30BB\u30AF\u30B7\u30E7\u30F3\u3067\u6271\u3046\u5185\u5BB9\u306E\u8981\u70B9\uFF0830\u5B57\u4EE5\u5185\uFF09]
Estimated: [\u63A8\u5B9A\u6587\u5B57\u6570]

Section (H3): [\u5FC5\u8981\u306A\u5834\u5408\u306E\u307F]
Description: [\u3053\u306E\u30BB\u30AF\u30B7\u30E7\u30F3\u3067\u6271\u3046\u5185\u5BB9\u306E\u8981\u70B9\uFF0830\u5B57\u4EE5\u5185\uFF09]
Estimated: [\u63A8\u5B9A\u6587\u5B57\u6570]

\u6CE8\u610F:
- Description\u306F\u672C\u6587\u3067\u306F\u306A\u304F\u3001\u30BB\u30AF\u30B7\u30E7\u30F3\u5185\u5BB9\u306E\u8981\u70B9\u30E1\u30E2\u306E\u307F\uFF0830\u5B57\u4EE5\u5185\u53B3\u5B88\uFF09
- Description\u306F\u9014\u4E2D\u3067\u5207\u3089\u305A\u3001\u8AAD\u70B9\u300C\u3001\u300D\u3084\u300C\u3084\u300D\u300C\u3068\u300D\u300C\u3057\u305F\u300D\u306A\u3069\u3067\u7D42\u3048\u306A\u3044\u3053\u3068
- H3\u306F\u5FC5\u305A\u95A2\u9023\u3059\u308BH2\u306E\u76F4\u5F8C\u306B\u7F6E\u304F\u3053\u3068
- H3\u3092\u7F6E\u304F\u5834\u5408\u3001\u305D\u306E\u76F4\u524D\u306EH2\u306F\u7AE0\u306E\u5C0E\u5165\u30FB\u6982\u8981\u306B\u3057\u3001\u8A73\u7D30\u306FH3\u3078\u5206\u3051\u308B\u3053\u3068
- \u6700\u5F8C\u306EH2\u306F\u300C\u307E\u3068\u3081\u300D\u306B\u3057\u3066\u304F\u3060\u3055\u3044\u3002
`.trim();
}

// src/shared/outlineParser.ts
function normalizeTitle(value) {
  return String(value || "").replace(/^#{1,6}\s+/, "").replace(/^[\d０-９]+[\.．、:：)\]]\s*/, "").replace(/^["'「」]+|["'「」]+$/g, "").replace(/\s{2,}/g, " ").trim();
}
function parseEstimatedWordCount(line) {
  const m = String(line || "").match(/(?:estimated|推定|目安)\s*[:：]?\s*(\d+)/i);
  if (!m) return null;
  const value = Number.parseInt(m[1], 10);
  if (!Number.isFinite(value) || value <= 0) return null;
  return value;
}
function fallbackSections(defaultEstimatedWordCount) {
  const per = Math.max(180, defaultEstimatedWordCount || 300);
  return [
    { title: "\u5C0E\u5165", level: 2, description: "\u8A18\u4E8B\u306E\u5C0E\u5165", estimatedWordCount: per, isLead: true },
    { title: "\u57FA\u790E\u77E5\u8B58", level: 2, description: "\u57FA\u672C\u4E8B\u9805\u3092\u6574\u7406\u3059\u308B", estimatedWordCount: per, isLead: false },
    { title: "\u6BD4\u8F03\u30DD\u30A4\u30F3\u30C8", level: 2, description: "\u5224\u65AD\u57FA\u6E96\u3092\u660E\u78BA\u306B\u3059\u308B", estimatedWordCount: per, isLead: false },
    { title: "\u5B9F\u8DF5\u624B\u9806", level: 2, description: "\u5931\u6557\u3057\u306B\u304F\u3044\u9032\u3081\u65B9\u3092\u793A\u3059", estimatedWordCount: per, isLead: false },
    { title: "\u307E\u3068\u3081", level: 2, description: "\u8981\u70B9\u3092\u632F\u308A\u8FD4\u308B", estimatedWordCount: per, isLead: false }
  ];
}
function parseOutlineTitle(text, keyword, fixedTitle = null) {
  if (fixedTitle) return fixedTitle;
  const match = String(text || "").match(
    /^\s*(?:Title|タイトル|記事タイトル)\s*[:：]\s*(.+)$/im
  );
  if (match?.[1]) {
    const parsed = normalizeTitle(match[1]);
    if (parsed) return parsed;
  }
  return `${keyword}\u306B\u3064\u3044\u3066`;
}
function isTokenOnlyLine(line) {
  return /^(?:Lead|H2|H3|導入|はじめに)$/i.test(String(line || "").trim());
}
function detectSectionStart(lines, index) {
  const line = String(lines[index] || "").trim();
  if (!line) return null;
  const sectionStyle = line.match(/^(?:Section|セクション)\s*\((Lead|H2|H3)\)\s*[:：]\s*(.+)$/i);
  if (sectionStyle) {
    const token = sectionStyle[1].toLowerCase();
    const title = normalizeTitle(sectionStyle[2]);
    if (!title) return null;
    return {
      level: token === "h3" ? 3 : 2,
      isLead: token === "lead",
      title,
      consumed: 0
    };
  }
  const simpleTokenInline = line.match(/^(Lead|H2|H3)\s*[:：]\s*(.+)$/i);
  if (simpleTokenInline) {
    const token = simpleTokenInline[1].toLowerCase();
    const title = normalizeTitle(simpleTokenInline[2]);
    if (!title) return null;
    return {
      level: token === "h3" ? 3 : 2,
      isLead: token === "lead",
      title,
      consumed: 0
    };
  }
  const mdH3 = line.match(/^###\s*(.+)$/);
  if (mdH3) {
    const title = normalizeTitle(mdH3[1]);
    if (!title) return null;
    return { level: 3, isLead: false, title, consumed: 0 };
  }
  const mdH2 = line.match(/^##\s*(.+)$/);
  if (mdH2) {
    const title = normalizeTitle(mdH2[1]);
    if (!title) return null;
    const isLead = /^(導入|リード|はじめに)$/i.test(title);
    return { level: 2, isLead, title, consumed: 0 };
  }
  const orderedHeading = line.match(/^\d+\.\s*(.+)$/);
  if (orderedHeading) {
    const title = normalizeTitle(orderedHeading[1]).replace(/[：:]$/, "").trim();
    if (!title) return null;
    return { level: 2, isLead: false, title, consumed: 0 };
  }
  if (isTokenOnlyLine(line)) {
    const token = line.toLowerCase();
    if (token === "lead" || token === "\u5C0E\u5165" || token === "\u306F\u3058\u3081\u306B") {
      return { level: 2, isLead: true, title: "\u306F\u3058\u3081\u306B", consumed: 0 };
    }
    let j = index + 1;
    while (j < lines.length && !String(lines[j] || "").trim()) j += 1;
    if (j >= lines.length) return null;
    const candidate = String(lines[j] || "").trim();
    if (!candidate || isTokenOnlyLine(candidate) || parseEstimatedWordCount(candidate) !== null) {
      return null;
    }
    const title = normalizeTitle(candidate);
    if (!title) return null;
    return {
      level: token === "h3" ? 3 : 2,
      isLead: token === "lead" || token === "\u5C0E\u5165" || token === "\u306F\u3058\u3081\u306B",
      title,
      consumed: j - index
    };
  }
  return null;
}
function parseLeadFromPreamble(lines, defaultEstimatedWordCount) {
  const trimmed = (lines || []).map((line) => String(line || "").trim()).filter((line) => line.length > 0);
  if (trimmed.length === 0) return null;
  let estimatedWordCount = defaultEstimatedWordCount;
  for (const line of trimmed) {
    const estimated = parseEstimatedWordCount(line);
    if (estimated !== null) {
      estimatedWordCount = estimated;
    }
  }
  const looksLikeStandaloneTitle = (line) => {
    const text = String(line || "").trim();
    if (!text) return false;
    if (/^(?:Title|タイトル|記事タイトル)\s*[:：]/i.test(text)) return true;
    const len = text.length;
    return len >= 12 && len <= 90 && !/[。！？]$/.test(text);
  };
  let startIndex = 0;
  if (trimmed.length >= 2 && looksLikeStandaloneTitle(trimmed[0])) {
    startIndex = 1;
  }
  let description = "";
  for (let i = startIndex; i < trimmed.length; i += 1) {
    const line = trimmed[i];
    if (parseEstimatedWordCount(line) !== null) continue;
    if (/^(?:Description|説明|概要)\s*[:：]/i.test(line)) {
      description = line.replace(/^(?:Description|説明|概要)\s*[:：]\s*/i, "").trim();
      break;
    }
    if (isTokenOnlyLine(line)) continue;
    if (/^(?:H2|H3|Lead)\b/i.test(line)) continue;
    description = line;
    break;
  }
  if (!description && trimmed.length > startIndex) {
    description = trimmed.find((line, index) => index >= startIndex && parseEstimatedWordCount(line) === null && !/^(?:H2|H3|Lead)\b/i.test(line)) || "";
  }
  if (!description) {
    description = "\u8A18\u4E8B\u5168\u4F53\u306E\u5C0E\u5165";
  }
  return {
    title: "\u306F\u3058\u3081\u306B",
    level: 2,
    description,
    estimatedWordCount: Math.max(120, estimatedWordCount),
    isLead: true
  };
}
function parseBlockStyleSections(text, defaultEstimatedWordCount) {
  const blocks = String(text || "").split(/\n{2,}/).map((block) => block.trim()).filter((block) => block.length > 0);
  const sections = [];
  for (const block of blocks) {
    const lines = block.split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
    if (lines.length === 0) continue;
    let token = null;
    let title = "";
    let startIndex = 0;
    if (/^(?:Lead|H2|H3|導入)$/i.test(lines[0])) {
      const key = lines[0].toLowerCase();
      token = key === "h3" ? "h3" : key === "h2" ? "h2" : "lead";
      if (lines.length < 2) continue;
      title = normalizeTitle(lines[1]);
      startIndex = 2;
    } else {
      const first = normalizeTitle(lines[0]);
      const hasEstimated = lines.some((line) => parseEstimatedWordCount(line) !== null);
      if (!first || !hasEstimated && first.length > 70) continue;
      title = first;
      token = sections.length === 0 ? "lead" : "h2";
      startIndex = 1;
    }
    if (!title) continue;
    let description = "";
    let estimatedWordCount = defaultEstimatedWordCount;
    for (let i = startIndex; i < lines.length; i += 1) {
      const line = lines[i];
      const estimated = parseEstimatedWordCount(line);
      if (estimated !== null) {
        estimatedWordCount = estimated;
        continue;
      }
      const descMatch = line.match(/^(?:Description|説明|概要)\s*[:：]\s*(.+)$/i);
      if (descMatch?.[1]) {
        description = descMatch[1].trim();
        continue;
      }
      if (!description && !/^(?:H2|H3|Lead)\b/i.test(line)) {
        description = line;
      }
    }
    sections.push({
      title,
      level: token === "h3" ? 3 : 2,
      description,
      estimatedWordCount: Math.max(120, estimatedWordCount),
      isLead: token === "lead"
    });
  }
  return sections;
}
function parseOutlineSections(text, defaultEstimatedWordCount = 300, allowFallback = true) {
  const lines = String(text || "").split("\n");
  const sections = [];
  let firstDetectedIndex = -1;
  let firstDetectedStart = null;
  for (let i = 0; i < lines.length; ) {
    const start = detectSectionStart(lines, i);
    if (!start) {
      i += 1;
      continue;
    }
    if (firstDetectedIndex === -1) {
      firstDetectedIndex = i;
      firstDetectedStart = start;
    }
    let description = "";
    let estimatedWordCount = defaultEstimatedWordCount;
    let j = i + start.consumed + 1;
    for (; j < lines.length; j += 1) {
      const boundary = detectSectionStart(lines, j);
      if (boundary) break;
      const raw = String(lines[j] || "").trim();
      if (!raw) continue;
      const estimated = parseEstimatedWordCount(raw);
      if (estimated !== null) {
        estimatedWordCount = estimated;
        continue;
      }
      const descMatch = raw.match(/^(?:Description|説明|概要)\s*[:：]\s*(.+)$/i);
      if (descMatch?.[1]) {
        description = descMatch[1].trim();
        continue;
      }
      if (!description && !isTokenOnlyLine(raw) && !raw.startsWith("#")) {
        description = raw;
      }
    }
    sections.push({
      title: start.title,
      level: start.level,
      description,
      estimatedWordCount,
      isLead: start.isLead
    });
    i = j;
  }
  if (sections.length > 0 && firstDetectedIndex > 0 && !firstDetectedStart?.isLead) {
    const leadCandidate = parseLeadFromPreamble(
      lines.slice(0, firstDetectedIndex),
      defaultEstimatedWordCount
    );
    if (leadCandidate) {
      sections.unshift(leadCandidate);
    }
  }
  if (sections.length === 0) {
    const blockParsed = parseBlockStyleSections(text, defaultEstimatedWordCount);
    if (blockParsed.length > 0) {
      sections.push(...blockParsed);
    }
  }
  const normalized = [];
  for (const section of sections) {
    const title = normalizeTitle(section.title);
    if (!title) continue;
    const level = section.level === 3 ? 3 : 2;
    normalized.push({
      title,
      level,
      isLead: Boolean(section.isLead),
      description: String(section.description || "").trim(),
      estimatedWordCount: Number.isFinite(section.estimatedWordCount) ? Math.max(120, section.estimatedWordCount) : Math.max(120, defaultEstimatedWordCount)
    });
  }
  if (normalized.length > 0) {
    const firstLeadIndex = normalized.findIndex((section) => section.isLead);
    if (firstLeadIndex === -1) {
      normalized[0] = { ...normalized[0], isLead: true, level: 2 };
    } else if (firstLeadIndex > 0) {
      const lead = { ...normalized[firstLeadIndex], isLead: true, level: 2 };
      normalized.splice(firstLeadIndex, 1);
      normalized.unshift(lead);
    }
    for (let i = 1; i < normalized.length; i += 1) {
      if (normalized[i].isLead) normalized[i] = { ...normalized[i], isLead: false };
    }
    return normalized;
  }
  return allowFallback ? fallbackSections(defaultEstimatedWordCount) : [];
}

// src/shared/articleGenerationCore.ts
function countGeneratedChars(content) {
  const cleaned = content.replace(/^#+\s+/gm, "").replace(/\*\*/g, "").replace(/\*/g, "").replace(/^[-*]\s+/gm, "").replace(/\n+/g, "\n").trim();
  return cleaned.length;
}
function parseOutlineSectionsFromJson(text, defaultEstimatedWordCount = 300) {
  const source = String(text || "");
  if (!source.trim()) return { sections: [] };
  const extractJsonCandidate = () => {
    const fenced = source.match(/```json\s*([\s\S]*?)```/i);
    if (fenced?.[1]) return fenced[1].trim();
    const objMatch = source.match(/\{[\s\S]*\}/);
    if (objMatch?.[0]) return objMatch[0].trim();
    const arrMatch = source.match(/\[[\s\S]*\]/);
    if (arrMatch?.[0]) return arrMatch[0].trim();
    return "";
  };
  const jsonCandidate = extractJsonCandidate();
  if (!jsonCandidate) return { sections: [] };
  let parsed;
  try {
    parsed = JSON.parse(jsonCandidate);
  } catch {
    return { sections: [] };
  }
  const rootTitle = typeof parsed?.title === "string" ? parsed.title.trim() : void 0;
  const rawSections = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.sections) ? parsed.sections : [];
  const sections = [];
  for (const item of rawSections) {
    const rawTitle = String(item?.title || "").trim();
    if (!rawTitle) continue;
    const rawLevel = String(item?.level ?? "").toLowerCase();
    const isLead = rawLevel === "lead" || rawLevel === "intro" || rawLevel === "\u5C0E\u5165" || Boolean(item?.isLead);
    const level = rawLevel === "h3" || rawLevel === "3" ? 3 : 2;
    const description = String(item?.description || item?.summary || "").trim();
    const estimated = Number.parseInt(String(item?.estimatedWordCount ?? item?.estimated ?? item?.chars ?? ""), 10);
    sections.push({
      title: rawTitle,
      level,
      description,
      estimatedWordCount: Number.isFinite(estimated) && estimated > 0 ? estimated : Math.max(120, defaultEstimatedWordCount),
      isLead
    });
  }
  if (sections.length > 0) {
    const leadIndex = sections.findIndex((section) => section.isLead);
    if (leadIndex === -1) {
      sections[0] = { ...sections[0], isLead: true, level: 2 };
    } else if (leadIndex > 0) {
      const [lead] = sections.splice(leadIndex, 1);
      sections.unshift({ ...lead, isLead: true, level: 2 });
    }
  }
  return { title: rootTitle, sections };
}
function parseLooseH2Lines(text, defaultEstimatedWordCount = 300) {
  const lines = String(text || "").split("\n").map((line) => line.trim()).filter((line) => line.length > 0);
  const sections = [];
  const seen = /* @__PURE__ */ new Set();
  const pickTitle = (line) => {
    const patterns = [
      /^(?:H2)\s*[:：]\s*(.+)$/i,
      /^##\s+(.+)$/,
      /^[-*]\s+(.+)$/,
      /^\d+[.)]\s+(.+)$/
    ];
    for (const pattern of patterns) {
      const m = line.match(pattern);
      if (m?.[1]) return m[1].trim();
    }
    if (line.length <= 70 && !/[。！？]$/.test(line)) return line;
    return "";
  };
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^(?:Description|説明|概要|Estimated|推定|目安)\s*[:：]/i.test(line)) {
      continue;
    }
    const rawTitle = pickTitle(line);
    if (!rawTitle) continue;
    const title = rawTitle.replace(/^["'「」]+|["'「」]+$/g, "").replace(/[：:]$/, "").trim();
    if (!title) continue;
    if (/^(導入|はじめに|まとめ|結論)$/i.test(title)) continue;
    const key = canonicalizeHeading(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    let description = "";
    let estimatedWordCount = Math.max(120, defaultEstimatedWordCount);
    for (let j = i + 1; j < lines.length; j += 1) {
      const next = lines[j];
      if (/^(?:H2)\s*[:：]/i.test(next) || /^##\s+/.test(next) || /^\d+[.)]\s+/.test(next)) {
        break;
      }
      const descMatch = next.match(/^(?:Description|説明|概要)\s*[:：]\s*(.+)$/i);
      if (descMatch?.[1]) {
        description = descMatch[1].trim();
        continue;
      }
      const estimated = next.match(/^(?:Estimated|推定|目安)\s*[:：]?\s*(\d+)/i);
      if (estimated?.[1]) {
        const parsedEstimated = Number.parseInt(estimated[1], 10);
        if (Number.isFinite(parsedEstimated) && parsedEstimated > 0) {
          estimatedWordCount = parsedEstimated;
        }
      }
    }
    sections.push({
      title,
      level: 2,
      description,
      estimatedWordCount,
      isLead: false
    });
    if (sections.length >= 6) break;
  }
  return sections;
}
function selectH3TitlesForH2(h2Title, count) {
  const title = String(h2Title || "").toLowerCase();
  const pool = (() => {
    if (title.includes("\u30E1\u30EA\u30C3\u30C8") && title.includes("\u30C7\u30E1\u30EA\u30C3\u30C8")) {
      return ["\u30E1\u30EA\u30C3\u30C8\u9762\u306E\u6574\u7406", "\u30C7\u30E1\u30EA\u30C3\u30C8\u9762\u306E\u6574\u7406"];
    }
    if (title.includes("\u30E1\u30EA\u30C3\u30C8")) {
      return ["\u4E3B\u306A\u30E1\u30EA\u30C3\u30C8", "\u4F53\u611F\u3057\u3084\u3059\u3044\u52B9\u679C"];
    }
    if (title.includes("\u30C7\u30E1\u30EA\u30C3\u30C8")) {
      return ["\u4E3B\u306A\u30C7\u30E1\u30EA\u30C3\u30C8", "\u5F8C\u6094\u3092\u9632\u3050\u5BFE\u7B56"];
    }
    if (title.includes("\u8CBB\u7528") || title.includes("\u4FA1\u683C") || title.includes("\u30B3\u30B9\u30C8")) {
      return ["\u8CBB\u7528\u306E\u5185\u8A33", "\u30B3\u30B9\u30C8\u3092\u6291\u3048\u308B\u30DD\u30A4\u30F3\u30C8"];
    }
    if (title.includes("\u9078\u3073\u65B9") || title.includes("\u6BD4\u8F03")) {
      return ["\u6BD4\u8F03\u6642\u306E\u30C1\u30A7\u30C3\u30AF\u9805\u76EE", "\u5224\u65AD\u3092\u8AA4\u3089\u306A\u3044\u30B3\u30C4"];
    }
    if (title.includes("\u65B9\u6CD5") || title.includes("\u624B\u9806") || title.includes("\u3084\u308A\u65B9")) {
      return ["\u57FA\u672C\u7684\u306A\u624B\u9806", "\u5B9F\u8DF5\u6642\u306E\u6CE8\u610F\u70B9"];
    }
    if (title.includes("\u7A2E\u985E") || title.includes("\u30BF\u30A4\u30D7") || title.includes("\u5206\u985E")) {
      return ["\u4E3B\u306A\u7A2E\u985E\u3068\u7279\u5FB4", "\u7528\u9014\u306B\u5FDC\u3058\u305F\u9078\u3073\u65B9"];
    }
    if (title.includes("\u539F\u56E0") || title.includes("\u7406\u7531") || title.includes("\u306A\u305C")) {
      return ["\u4E3B\u306A\u539F\u56E0\u306E\u6574\u7406", "\u6839\u672C\u7684\u306A\u5BFE\u51E6\u306E\u8003\u3048\u65B9"];
    }
    if (title.includes("\u7BA1\u7406") || title.includes("\u904B\u7528") || title.includes("\u30E1\u30F3\u30C6")) {
      return ["\u65E5\u5E38\u7BA1\u7406\u306E\u30DD\u30A4\u30F3\u30C8", "\u30C8\u30E9\u30D6\u30EB\u3092\u9632\u3050\u5BFE\u7B56"];
    }
    return ["\u57FA\u672C\u7684\u306A\u8003\u3048\u65B9", "\u5B9F\u8DF5\u306B\u304A\u3051\u308B\u7740\u773C\u70B9"];
  })();
  return pool.slice(0, Math.max(1, Math.min(count, pool.length)));
}
function insertSubheadingsIntoLongSections(markdown, targetWordCount) {
  if (Number.isFinite(targetWordCount) && Number(targetWordCount) <= 1200) {
    return String(markdown || "").trim();
  }
  const text = String(markdown || "").trim();
  if (!text) return text;
  const h2Regex = /^##\s+(.+)$/gm;
  const matches = [];
  let m = null;
  while ((m = h2Regex.exec(text)) !== null) {
    matches.push({ index: m.index, full: m[0], title: String(m[1] || "").trim() });
  }
  if (matches.length === 0) return text;
  const blocks = [];
  let cursor = 0;
  const pushUntil = (end) => {
    if (end > cursor) {
      blocks.push(text.slice(cursor, end));
      cursor = end;
    }
  };
  for (let i = 0; i < matches.length; i += 1) {
    const current = matches[i];
    const nextIndex = i + 1 < matches.length ? matches[i + 1].index : text.length;
    pushUntil(current.index);
    const blockRaw = text.slice(current.index, nextIndex);
    const firstBreak = blockRaw.indexOf("\n");
    if (firstBreak < 0) {
      blocks.push(blockRaw);
      cursor = nextIndex;
      continue;
    }
    const headingLine = blockRaw.slice(0, firstBreak).trimEnd();
    const body = blockRaw.slice(firstBreak + 1).trim();
    if (!body || /^###\s+/m.test(body) || SUMMARY_TITLE_PATTERN.test(current.title) || countGeneratedChars(body) < 520) {
      blocks.push(blockRaw);
      cursor = nextIndex;
      continue;
    }
    const paragraphs = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
    if (paragraphs.length < 3) {
      blocks.push(blockRaw);
      cursor = nextIndex;
      continue;
    }
    const insertCount = paragraphs.length >= 5 ? 2 : 1;
    const h3Titles = selectH3TitlesForH2(current.title, insertCount);
    let rebuiltBody = "";
    if (insertCount === 1) {
      const split = Math.max(1, Math.floor(paragraphs.length / 2));
      const part1 = paragraphs.slice(0, split).join("\n\n");
      const part2 = paragraphs.slice(split).join("\n\n");
      rebuiltBody = [
        `### ${h3Titles[0] || "\u91CD\u8981\u30DD\u30A4\u30F3\u30C8"}`,
        "",
        part1,
        "",
        part2
      ].join("\n").trim();
    } else {
      const split1 = Math.max(1, Math.floor(paragraphs.length / 2));
      const part1 = paragraphs.slice(0, split1).join("\n\n");
      const part2 = paragraphs.slice(split1).join("\n\n");
      rebuiltBody = [
        `### ${h3Titles[0] || "\u91CD\u8981\u30DD\u30A4\u30F3\u30C8"}`,
        "",
        part1,
        "",
        `### ${h3Titles[1] || "\u5B9F\u8DF5\u6642\u306E\u7740\u773C\u70B9"}`,
        "",
        part2
      ].join("\n").trim();
    }
    blocks.push(`${headingLine}

${rebuiltBody}
`);
    cursor = nextIndex;
  }
  pushUntil(text.length);
  return blocks.join("").trim();
}
var SUMMARY_TITLE_PATTERN = /(まとめ|結論|総括|おわりに|最後に|summary|conclusion)/i;
function calculateEdgeSectionWordCount(targetWordCount) {
  if (!Number.isFinite(targetWordCount) || targetWordCount <= 0) return 250;
  if (targetWordCount <= 1200) return Math.max(90, Math.round(targetWordCount * 0.11));
  if (targetWordCount <= 2200) return Math.max(120, Math.round(targetWordCount * 0.1));
  return Math.max(160, Math.round(targetWordCount * 0.09));
}
function getEdgeSectionBounds(targetWordCount) {
  const base = calculateEdgeSectionWordCount(targetWordCount);
  const min = Math.max(80, Math.round(base * 0.8));
  const max = Math.max(min + 30, Math.round(base * 1.2));
  return { min, max, base };
}
function clampNumber(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}
function normalizeOutlineDescription(section) {
  const raw = String(section.description || "").replace(/\s+/g, " ").trim().replace(/[、,，・／/]+$/g, "").trim();
  const title = String(section.title || "").trim();
  const fallback = (() => {
    if (section.isLead) return "\u8A18\u4E8B\u5168\u4F53\u306E\u5C0E\u5165\u3068\u8AAD\u3080\u30E1\u30EA\u30C3\u30C8\u3092\u793A\u3059";
    if (isSummaryLikeTitle(title)) return "\u8A18\u4E8B\u5168\u4F53\u306E\u8981\u70B9\u3092\u7DCF\u62EC\u3059\u308B";
    if (section.level === 3) return `${title}\u306E\u5177\u4F53\u7684\u306A\u5224\u65AD\u6750\u6599\u3092\u6574\u7406\u3059\u308B`;
    return `${title}\u306E\u5168\u4F53\u50CF\u3068\u5224\u65AD\u30DD\u30A4\u30F3\u30C8\u3092\u6574\u7406\u3059\u308B`;
  })();
  if (!raw) return fallback;
  if (raw.length < 6) return fallback;
  if (/(?:や|と|が|を|は|に|で|へ|も|から|まで|による|に応じた|に合わせた|を踏まえた|するための|した|しやすい)$/.test(raw)) {
    return fallback;
  }
  return raw;
}
function normalizeOutlineSections(sections, targetWordCount) {
  const normalized = sections.map((section) => ({
    ...section,
    description: normalizeOutlineDescription(section)
  }));
  const edgeBounds = getEdgeSectionBounds(targetWordCount);
  const leadWordCount = edgeBounds.base;
  const summaryWordCount = edgeBounds.base;
  const leadIndex = normalized.findIndex((section) => section.isLead);
  if (leadIndex === -1) {
    normalized.unshift({
      title: "\u5C0E\u5165",
      level: 2,
      description: "\u8A18\u4E8B\u5168\u4F53\u306E\u5C0E\u5165",
      isLead: true,
      estimatedWordCount: leadWordCount
    });
  } else if (leadIndex > 0) {
    const [lead] = normalized.splice(leadIndex, 1);
    normalized.unshift({
      ...lead,
      title: "\u5C0E\u5165",
      level: 2,
      isLead: true
    });
  } else {
    normalized[0] = {
      ...normalized[0],
      title: "\u5C0E\u5165",
      level: 2,
      isLead: true
    };
  }
  for (let i = 1; i < normalized.length; i++) {
    if (normalized[i].isLead) {
      normalized[i] = { ...normalized[i], isLead: false };
    }
  }
  const summaryIndex = normalized.findIndex((section, index) => index > 0 && SUMMARY_TITLE_PATTERN.test(section.title || ""));
  if (summaryIndex === -1) {
    normalized.push({
      title: "\u307E\u3068\u3081",
      level: 2,
      description: "\u8A18\u4E8B\u5168\u4F53\u306E\u8981\u70B9\u3092\u7DCF\u62EC",
      isLead: false,
      estimatedWordCount: summaryWordCount
    });
  } else if (summaryIndex !== normalized.length - 1) {
    const [summary] = normalized.splice(summaryIndex, 1);
    normalized.push({
      ...summary,
      title: "\u307E\u3068\u3081",
      level: 2,
      isLead: false
    });
  } else {
    const last = normalized[normalized.length - 1];
    normalized[normalized.length - 1] = {
      ...last,
      title: "\u307E\u3068\u3081",
      level: 2,
      isLead: false
    };
  }
  if (normalized.length > 0) {
    normalized[0].estimatedWordCount = clampNumber(
      normalized[0].estimatedWordCount || leadWordCount,
      edgeBounds.min,
      edgeBounds.max
    );
  }
  if (normalized.length > 1) {
    const lastIndex = normalized.length - 1;
    normalized[lastIndex].estimatedWordCount = clampNumber(
      normalized[lastIndex].estimatedWordCount || summaryWordCount,
      edgeBounds.min,
      edgeBounds.max
    );
  }
  return normalized;
}
function rebalanceEstimatedWordCounts(sections, targetWordCount) {
  if (!Array.isArray(sections) || sections.length === 0) return sections;
  if (!Number.isFinite(targetWordCount) || targetWordCount <= 0) return sections;
  const minPerSection = 120;
  const edgeBounds = getEdgeSectionBounds(targetWordCount);
  const weights = sections.map((section) => Math.max(1, section.estimatedWordCount || 1));
  const weightSum = weights.reduce((sum, w) => sum + w, 0);
  const adjusted = sections.map((section, index) => {
    const ratio = weightSum > 0 ? weights[index] / weightSum : 1 / sections.length;
    const isEdge = section.isLead || isSummaryLikeTitle(section.title);
    const min = isEdge ? edgeBounds.min : minPerSection;
    const max = isEdge ? edgeBounds.max : Number.MAX_SAFE_INTEGER;
    const estimated = clampNumber(Math.round(targetWordCount * ratio), min, max);
    return { ...section, estimatedWordCount: estimated };
  });
  let currentSum = adjusted.reduce((sum, section) => sum + section.estimatedWordCount, 0);
  let remainder = targetWordCount - currentSum;
  const primaryOrder = adjusted.map((section, index) => ({ index, score: section.estimatedWordCount, isEdge: section.isLead || isSummaryLikeTitle(section.title) })).sort((a, b) => {
    if (a.isEdge !== b.isEdge) return a.isEdge ? 1 : -1;
    return b.score - a.score;
  }).map((x) => x.index);
  let guard = 0;
  while (remainder !== 0 && guard < 5e3) {
    let moved = false;
    for (const idx of primaryOrder) {
      if (remainder === 0) break;
      const section = adjusted[idx];
      const isEdge = section.isLead || isSummaryLikeTitle(section.title);
      const min = isEdge ? edgeBounds.min : minPerSection;
      const max = isEdge ? edgeBounds.max : Number.MAX_SAFE_INTEGER;
      if (remainder > 0) {
        if (section.estimatedWordCount < max) {
          section.estimatedWordCount += 1;
          remainder -= 1;
          moved = true;
        }
      } else if (section.estimatedWordCount > min) {
        section.estimatedWordCount -= 1;
        remainder += 1;
        moved = true;
      }
    }
    if (!moved) break;
    guard += 1;
  }
  currentSum = adjusted.reduce((sum, section) => sum + section.estimatedWordCount, 0);
  if (currentSum !== targetWordCount) {
    const delta = targetWordCount - currentSum;
    const fallbackOrder = adjusted.map((section, index) => ({ index, isEdge: section.isLead || isSummaryLikeTitle(section.title) })).sort((a, b) => a.isEdge === b.isEdge ? 0 : a.isEdge ? 1 : -1).map((x) => x.index);
    let remaining = delta;
    for (const idx of fallbackOrder) {
      if (remaining === 0) break;
      const section = adjusted[idx];
      const isEdge = section.isLead || isSummaryLikeTitle(section.title);
      const min = isEdge ? edgeBounds.min : minPerSection;
      const max = isEdge ? edgeBounds.max : Number.MAX_SAFE_INTEGER;
      if (remaining > 0) {
        const movable = Math.min(remaining, Math.max(0, max - section.estimatedWordCount));
        if (movable > 0) {
          section.estimatedWordCount += movable;
          remaining -= movable;
        }
      } else {
        const movable = Math.min(-remaining, Math.max(0, section.estimatedWordCount - min));
        if (movable > 0) {
          section.estimatedWordCount -= movable;
          remaining += movable;
        }
      }
    }
  }
  return adjusted;
}
function flattenHeadingLevelsForMediumLength(sections, targetWordCount) {
  if (!Array.isArray(sections) || sections.length === 0) return sections;
  if (!Number.isFinite(targetWordCount) || targetWordCount <= 0) return sections;
  if (targetWordCount > 1200) return sections;
  return sections.map((section) => ({ ...section, level: 2 }));
}
function canonicalizeHeading(title) {
  return String(title || "").replace(/[ 　\t]/g, "").replace(/[!！?？:：・]/g, "").toLowerCase();
}
function isSummaryLikeTitle(title) {
  return SUMMARY_TITLE_PATTERN.test(String(title || "").trim());
}
function isWeakH3Title(title) {
  const t = String(title || "").trim();
  if (!t) return true;
  const normalized = canonicalizeHeading(t);
  if (normalized.length <= 2) return true;
  return /^(物流|効率|品質|安全|費用|コスト|方法|対策|課題|効果|種類|比較|選び方|注意点|ポイント|メリット|デメリット|概要|基本|導入)$/.test(normalized);
}
function getTargetH3Count(targetWordCount) {
  if (!Number.isFinite(targetWordCount) || targetWordCount < 1800) return 0;
  if (targetWordCount < 2600) return 9;
  if (targetWordCount < 3600) return 12;
  return 15;
}
function getHardMinimumH3Count(targetWordCount) {
  const targetH3Count = getTargetH3Count(targetWordCount);
  if (targetH3Count <= 0) return 0;
  return Math.min(targetH3Count, 1);
}
function countH3Sections(sections) {
  return sections.filter((section) => !section.isLead && section.level === 3).length;
}
function findParentH2Index(sections, childIndex) {
  for (let i = childIndex - 1; i >= 0; i -= 1) {
    const section = sections[i];
    if (!section.isLead && section.level === 2 && !isSummaryLikeTitle(section.title)) {
      return i;
    }
  }
  return -1;
}
function countChildH3(sections, h2Index) {
  let count = 0;
  for (let i = h2Index + 1; i < sections.length; i += 1) {
    const section = sections[i];
    if (section.isLead || section.level === 2) break;
    if (section.level === 3) count += 1;
  }
  return count;
}
function shouldSplitH2IntoH3(section) {
  const title = String(section.title || "");
  const description = String(section.description || "");
  const combined = `${title} ${description}`;
  if (section.estimatedWordCount >= 420) return true;
  if (/[・、／/]|(?:と|や|から|まで).*(?:と|や|まで)/.test(title)) return true;
  return /(原因|理由|リスク|選択肢|比較|選び方|判断基準|注意点|ポイント|手順|方法|対策|導入効果|費用|安全)/.test(combined);
}
function selectH2IndexesForH3Supplement(sections, targetWordCount, targetH3Count) {
  if (targetH3Count <= 0) return [];
  const currentH3Count = countH3Sections(sections);
  const missing = Math.max(0, targetH3Count - currentH3Count);
  if (missing === 0) return [];
  const candidates = sections.map((section, index) => ({ section, index })).filter(({ section, index }) => !section.isLead && section.level === 2 && !isSummaryLikeTitle(section.title) && countChildH3(sections, index) < 3).map(({ section, index }) => ({
    index,
    score: (shouldSplitH2IntoH3(section) ? 100 : 0) + Math.max(0, section.estimatedWordCount - 260) + (targetWordCount >= 1800 ? 20 : 0) - countChildH3(sections, index) * 40
  })).sort((a, b) => b.score - a.score);
  const selected = [];
  for (const candidate of candidates) {
    if (selected.length >= Math.max(1, missing)) break;
    const section = sections[candidate.index];
    if (!section) continue;
    const currentChildren = countChildH3(sections, candidate.index);
    const plannedChildren = selected.filter((index) => index === candidate.index).length;
    const capacity = Math.max(0, 3 - currentChildren - plannedChildren);
    const desired = shouldSplitH2IntoH3(section) ? 3 : 2;
    const addCount = Math.min(capacity, desired, missing - selected.length);
    for (let i = 0; i < addCount; i += 1) {
      selected.push(candidate.index);
    }
  }
  return selected.slice(0, missing);
}
function ensureOutlineDescriptions(sections) {
  return sections.map((section) => {
    if (section.description && section.description.trim()) return section;
    if (section.isLead) {
      return { ...section, description: "\u8A18\u4E8B\u5168\u4F53\u306E\u5C0E\u5165\u3068\u8AAD\u3080\u30E1\u30EA\u30C3\u30C8\u3092\u793A\u3059" };
    }
    if (isSummaryLikeTitle(section.title)) {
      return { ...section, description: "\u8A18\u4E8B\u5168\u4F53\u306E\u8981\u70B9\u3092\u7DCF\u62EC" };
    }
    if (section.level === 2) {
      return { ...section, description: "\u3053\u306E\u7AE0\u306E\u5168\u4F53\u50CF\u3068\u5224\u65AD\u30DD\u30A4\u30F3\u30C8\u3092\u6574\u7406\u3059\u308B" };
    }
    return { ...section, description: "\u5177\u4F53\u7684\u306A\u8AD6\u70B9\u3092\u6398\u308A\u4E0B\u3052\u308B" };
  });
}
function rebalanceParentAndChildH3WordCounts(sections, targetWordCount) {
  if (!Array.isArray(sections) || sections.length === 0) return sections;
  const adjusted = sections.map((section) => ({ ...section }));
  const parentToChildren = /* @__PURE__ */ new Map();
  for (let i = 0; i < adjusted.length; i += 1) {
    if (adjusted[i].level !== 3) continue;
    const parentIndex = findParentH2Index(adjusted, i);
    if (parentIndex < 0) continue;
    const list = parentToChildren.get(parentIndex) || [];
    list.push(i);
    parentToChildren.set(parentIndex, list);
  }
  for (const [parentIndex, childIndexes] of parentToChildren.entries()) {
    const parent = adjusted[parentIndex];
    if (!parent || childIndexes.length === 0) continue;
    const total = parent.estimatedWordCount + childIndexes.reduce((sum, index) => sum + adjusted[index].estimatedWordCount, 0);
    const parentTarget = clampNumber(
      Math.round(total * 0.28),
      120,
      targetWordCount >= 2200 ? 220 : 190
    );
    const childTotal = Math.max(childIndexes.length * 120, total - parentTarget);
    const perChild = Math.max(120, Math.round(childTotal / childIndexes.length));
    parent.estimatedWordCount = parentTarget;
    for (const childIndex of childIndexes) {
      adjusted[childIndex].estimatedWordCount = perChild;
    }
  }
  return adjusted;
}
function isCountermeasureTopic(keyword, fixedTitle) {
  const text = `${keyword || ""} ${fixedTitle || ""}`;
  return /(対策|改善|解決|防ぐ|抑制|備える|換気|遮熱|断熱|冷却|暑さ|温度|リスク|方法)/i.test(text);
}
function inferSubjectTerm(keyword, fixedTitle) {
  const text = `${fixedTitle || ""} ${keyword || ""}`;
  const subjectMatch = text.match(/[A-Za-z0-9ぁ-んァ-ン一-龠]{2,12}(?:倉庫|工場|店舗|施設|設備|機械|システム|サービス|ツール|会社|業者)/);
  if (subjectMatch) return subjectMatch[0].trim();
  return String(keyword || "").split(/[、,｜|/／\s]+/).map((item) => item.trim()).find((item) => item.length >= 2 && item.length <= 12) || "";
}
function isWeakOutlineTitle(title) {
  const t = String(title || "").trim();
  if (!t) return true;
  if (isSummaryLikeTitle(t)) return false;
  if (t.length <= 7) return true;
  return /(?:とは[？?]?|活用方法|種類と特徴|選び方と注意点|よくある疑問|重要ポイント|基礎知識|基礎)$/i.test(t);
}
function scoreOutlineSections(sections, keyword, fixedTitle) {
  if (!Array.isArray(sections) || sections.length === 0) return Number.NEGATIVE_INFINITY;
  const nonLead = sections.filter((section) => !section.isLead && !isSummaryLikeTitle(section.title));
  let score = sections.length * 10;
  for (const section of nonLead) {
    const title = String(section.title || "").trim();
    const description = String(section.description || "").trim();
    if (title.length >= 12) score += 3;
    if (description.length >= 18) score += 2;
    if (/(理由|原因|メカニズム|確認|優先|組み合わせ|併用|費用|施工|安全|注意|判断|比較|選び方|手順|失敗|リスク|導入前)/.test(title)) {
      score += 5;
    }
    if (/(換気|遮熱|断熱|冷却|排出|抑える|防ぐ|守る|改善|導入|施工)/.test(title)) {
      score += 3;
    }
    if (isWeakOutlineTitle(title)) score -= 18;
  }
  const allTitles = nonLead.map((section) => section.title).join(" / ");
  const subjectTerm = inferSubjectTerm(keyword, fixedTitle);
  if (subjectTerm) {
    const repeatedSubjectCount = nonLead.filter((section) => String(section.title || "").includes(subjectTerm)).length;
    if (repeatedSubjectCount > 2) {
      score -= (repeatedSubjectCount - 2) * 12;
    }
  }
  if (isCountermeasureTopic(keyword, fixedTitle)) {
    const checks = [
      /(理由|原因|メカニズム)/,
      /(まず|確認|優先|判断)/,
      /(組み合わせ|併用|使い分け)/,
      /(費用|施工|安全|導入前|注意)/
    ];
    for (const pattern of checks) {
      score += pattern.test(allTitles) ? 10 : -10;
    }
  }
  return score;
}
async function supplementOutlineSectionsWithAI(sections, keyword, relatedKeywords, targetWordCount, minimumSectionCount, callAI2) {
  if (sections.length >= minimumSectionCount) {
    return { sections, added: 0, usedAI: false };
  }
  const normalized = normalizeOutlineSections(sections, targetWordCount);
  if (normalized.length >= minimumSectionCount || normalized.length < 2) {
    return { sections: normalized, added: 0, usedAI: false };
  }
  const lead = normalized[0];
  const summary = normalized[normalized.length - 1];
  const middle = normalized.slice(1, -1);
  const missing = Math.max(0, minimumSectionCount - normalized.length);
  if (missing === 0) return { sections: normalized, added: 0, usedAI: false };
  const perSection = Math.max(180, Math.floor(Math.max(1200, targetWordCount) / minimumSectionCount));
  const existing = new Set(normalized.map((section) => canonicalizeHeading(section.title)));
  const extracted = [];
  const bannedHeadingPattern = /後悔しないための比較軸/i;
  const maxSupplementAttempts = 3;
  for (let attempt = 0; attempt < maxSupplementAttempts && extracted.length < missing; attempt += 1) {
    const remain = missing - extracted.length;
    const aiPrompt = [
      `\u30AD\u30FC\u30EF\u30FC\u30C9\u300C${keyword}\u300D\u306E\u8A18\u4E8B\u30A2\u30A6\u30C8\u30E9\u30A4\u30F3\u3067\u3001H2\u898B\u51FA\u3057\u304C\u3042\u3068${remain}\u500B\u4E0D\u8DB3\u3057\u3066\u3044\u307E\u3059\u3002`,
      "\u65E2\u5B58\u898B\u51FA\u3057\u3068\u91CD\u8907\u3057\u306A\u3044\u3001\u4E0D\u81EA\u7136\u3067\u306A\u3044H2\u898B\u51FA\u3057\u3068\u8AAC\u660E\u6587\u3092\u4F5C\u3063\u3066\u304F\u3060\u3055\u3044\u3002",
      "\u5C0E\u5165\u3084\u307E\u3068\u3081\u306F\u4F5C\u3089\u306A\u3044\u3067\u304F\u3060\u3055\u3044\u3002H2\u306E\u307F\u3067\u3059\u3002",
      "\u30AD\u30FC\u30EF\u30FC\u30C9\u306E\u6A5F\u68B0\u7684\u306A\u9023\u547C\u3092\u907F\u3051\u3001\u81EA\u7136\u306A\u898B\u51FA\u3057\u306B\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      "\u300C\u5F8C\u6094\u3057\u306A\u3044\u305F\u3081\u306E\u6BD4\u8F03\u8EF8\u300D\u3068\u3044\u3046\u8A9E\u53E5\u306F\u4F7F\u308F\u306A\u3044\u3067\u304F\u3060\u3055\u3044\u3002",
      relatedKeywords && relatedKeywords.length > 0 ? `\u95A2\u9023\u8A9E: ${relatedKeywords.slice(0, 8).join("\u3001")}` : "",
      "\u65E2\u5B58\u898B\u51FA\u3057:",
      ...normalized.map((section) => `- ${section.title}`),
      ...extracted.map((section) => `- ${section.title}`),
      "",
      "\u51FA\u529B\u5F62\u5F0F\uFF08\u3053\u306E\u5F62\u5F0F\u306E\u307F\uFF09:",
      "H2: [\u898B\u51FA\u3057]",
      "Description: [\u8AAC\u660E]",
      `Estimated: ${perSection}`,
      "",
      `\u4E0A\u8A18\u3092${remain}\u30BB\u30C3\u30C8\u3002\u524D\u7F6E\u304D\u3084\u88DC\u8DB3\u8AAC\u660E\u306F\u7981\u6B62\u3002`
    ].filter(Boolean).join("\n");
    try {
      const response = await callAI2(aiPrompt, 1200);
      console.debug(`[outline supplement debug] attempt${attempt + 1} response (first 800 chars):`, response.slice(0, 800));
      let parsed = parseLooseH2Lines(response, perSection);
      if (parsed.length === 0) {
        parsed = parseOutlineSectionsFromJson(response, perSection).sections.filter((section) => !section.isLead).map((section) => ({ ...section, isLead: false, level: 2 }));
      }
      if (parsed.length === 0) {
        parsed = parseOutlineSections(response, perSection, false).filter((section) => !section.isLead).map((section) => ({ ...section, isLead: false, level: 2 }));
      }
      console.debug(
        `[outline supplement debug] attempt${attempt + 1} parsed=${parsed.length} missing=${missing} extracted=${extracted.length}`
      );
      for (const item of parsed) {
        if (extracted.length >= missing) break;
        if (item.isLead) continue;
        if (isSummaryLikeTitle(item.title)) continue;
        if (bannedHeadingPattern.test(item.title)) continue;
        const key = canonicalizeHeading(item.title);
        if (!key || existing.has(key)) continue;
        existing.add(key);
        extracted.push({
          title: item.title,
          level: 2,
          description: item.description || "\u6BD4\u8F03\u6642\u306E\u5224\u65AD\u57FA\u6E96\u3092\u6574\u7406\u3059\u308B",
          isLead: false,
          estimatedWordCount: item.estimatedWordCount || perSection
        });
      }
    } catch (err) {
      throw err;
    }
  }
  if (extracted.length === 0) {
    throw new Error("AI\u306B\u3088\u308B\u30BB\u30AF\u30B7\u30E7\u30F3\u88DC\u5145\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002\u30A2\u30A6\u30C8\u30E9\u30A4\u30F3\u3092\u518D\u751F\u6210\u3057\u3066\u304F\u3060\u3055\u3044\u3002");
  }
  const combined = normalizeOutlineSections(
    [lead, ...middle, ...extracted, summary],
    targetWordCount
  );
  return { sections: combined, added: extracted.length, usedAI: true };
}
async function supplementH3SectionsWithAI(sections, keyword, targetWordCount, targetH3Count, callAI2) {
  const normalized = normalizeOutlineSections(sections, targetWordCount);
  const currentH3Count = countH3Sections(normalized);
  if (targetH3Count <= 0 || currentH3Count >= targetH3Count) {
    return { sections: normalized, added: 0 };
  }
  const targetH2Indexes = selectH2IndexesForH3Supplement(normalized, targetWordCount, targetH3Count);
  if (targetH2Indexes.length === 0) {
    return { sections: normalized, added: 0 };
  }
  const missing = targetH3Count - currentH3Count;
  const perH3 = Math.max(140, Math.floor(Math.max(1200, targetWordCount) / Math.max(6, normalized.length + missing)));
  const targetCounts = targetH2Indexes.reduce((map, index) => {
    map.set(index, (map.get(index) || 0) + 1);
    return map;
  }, /* @__PURE__ */ new Map());
  const targetPlans = Array.from(targetCounts.entries()).map(([index, needed]) => ({ index, needed, section: normalized[index] })).filter((plan) => plan.section);
  const prompt = [
    `\u30AD\u30FC\u30EF\u30FC\u30C9\u300C${keyword}\u300D\u306E\u8A18\u4E8B\u30A2\u30A6\u30C8\u30E9\u30A4\u30F3\u306B\u5C0F\u898B\u51FA\u3057\uFF08H3\uFF09\u304C\u4E0D\u8DB3\u3057\u3066\u3044\u307E\u3059\u3002`,
    `\u76EE\u6A19\u306FH3\u5408\u8A08${targetH3Count}\u500B\u3067\u3059\u3002\u73FE\u5728${currentH3Count}\u500B\u306A\u306E\u3067\u3001H3\u3092\u5408\u8A08${missing}\u500B\u8FFD\u52A0\u3057\u3066\u304F\u3060\u3055\u3044\u3002`,
    "H3\u306F\u5FC5\u305A\u6307\u5B9A\u3057\u305FH2\u306E\u76F4\u4E0B\u306B\u5165\u308B\u5C0F\u898B\u51FA\u3057\u3068\u3057\u3066\u4F5C\u3063\u3066\u304F\u3060\u3055\u3044\u3002",
    "\u8FFD\u52A0\u5BFE\u8C61\u3054\u3068\u306ENeededH3\u306E\u6570\u3092\u5FC5\u305A\u5B88\u3063\u3066\u304F\u3060\u3055\u3044\u3002",
    "1\u3064\u306E\u4E3B\u8981H2\u306B\u3064\u304DH3\u304C\u5408\u8A083\u500B\u306B\u306A\u308B\u3088\u3046\u306B\u8FFD\u52A0\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
    "\u540C\u3058ParentH2\u306BH3\u30923\u500B\u307E\u3067\u8FFD\u52A0\u3057\u3066\u69CB\u3044\u307E\u305B\u3093\u3002",
    "H2\u3068\u540C\u3058\u5185\u5BB9\u306E\u8A00\u3044\u63DB\u3048\u3067\u306F\u306A\u304F\u3001\u672C\u6587\u3092\u5206\u5272\u3057\u3084\u3059\u3044\u5177\u4F53\u7684\u306A\u8AD6\u70B9\u306B\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
    "\u300C\u7269\u6D41\u300D\u300C\u5B89\u5168\u300D\u300C\u54C1\u8CEA\u300D\u300C\u52B9\u7387\u300D\u306E\u3088\u3046\u306A\u5358\u8A9E\u3060\u3051\u306EH3\u306F\u7981\u6B62\u3067\u3059\u3002\u5FC5\u305A\u4F55\u3092\u8AD6\u3058\u308B\u304B\u5206\u304B\u308B\u5177\u4F53\u7684\u306A\u898B\u51FA\u3057\u306B\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
    "Description\u306F\u77ED\u3044\u540D\u8A5E\u53E5\u307E\u305F\u306F\u77ED\u6587\u3068\u3057\u3066\u5B8C\u7D50\u3055\u305B\u3001\u8AAD\u70B9\u300C\u3001\u300D\u3084\u300C\u3084\u300D\u300C\u3068\u300D\u300C\u3057\u305F\u300D\u3067\u7D42\u3048\u306A\u3044\u3067\u304F\u3060\u3055\u3044\u3002",
    "\u307E\u3068\u3081\u30FB\u5C0E\u5165\u306EH3\u306F\u4F5C\u3089\u306A\u3044\u3067\u304F\u3060\u3055\u3044\u3002",
    "",
    "\u8FFD\u52A0\u5BFE\u8C61\u306EH2\u3068\u5FC5\u8981\u6570:",
    ...targetPlans.map(({ section, needed }) => {
      return [
        `- ParentH2: ${section.title}`,
        `  NeededH3: ${needed}`,
        `  Description: ${section.description || ""}`
      ].join("\n");
    }),
    "",
    "\u65E2\u5B58\u30A2\u30A6\u30C8\u30E9\u30A4\u30F3:",
    ...normalized.map((section) => {
      if (section.isLead) return `Lead: ${section.title}`;
      return `${section.level === 3 ? "H3" : "H2"}: ${section.title}`;
    }),
    "",
    "\u51FA\u529B\u5F62\u5F0F\uFF08\u3053\u306E\u5F62\u5F0F\u306E\u307F\uFF09:",
    "ParentH2: [\u8FFD\u52A0\u5BFE\u8C61H2\u306E\u898B\u51FA\u3057]",
    "H3: [\u5C0F\u898B\u51FA\u3057]",
    "Description: [\u6271\u3046\u5185\u5BB9\u306E\u8981\u70B9\uFF0830\u5B57\u4EE5\u5185\u30FB\u9014\u4E2D\u3067\u5207\u3089\u305A\u5B8C\u7D50\uFF09]",
    `Estimated: ${perH3}`
  ].join("\n");
  const response = await callAI2(prompt, 1200);
  console.debug("[outline h3 supplement debug] response (first 800 chars):", response.slice(0, 800));
  const lines = String(response || "").split("\n").map((line) => line.trim()).filter(Boolean);
  const byParent = /* @__PURE__ */ new Map();
  const orphanItems = [];
  let currentParent = "";
  let pending = null;
  const flush = () => {
    if (!pending) return;
    if (!currentParent) {
      orphanItems.push(pending);
      pending = null;
      return;
    }
    const list = byParent.get(currentParent) || [];
    list.push(pending);
    byParent.set(currentParent, list);
    pending = null;
  };
  for (const line of lines) {
    const parentMatch = line.match(/^ParentH2\s*[:：]\s*(.+)$/i);
    if (parentMatch?.[1]) {
      flush();
      currentParent = canonicalizeHeading(parentMatch[1]);
      continue;
    }
    const h3Match = line.match(/^H3\s*[:：]\s*(.+)$/i);
    if (h3Match?.[1]) {
      flush();
      pending = {
        title: h3Match[1].trim(),
        level: 3,
        description: "",
        isLead: false,
        estimatedWordCount: perH3
      };
      continue;
    }
    const descMatch = line.match(/^(?:Description|説明|概要)\s*[:：]\s*(.+)$/i);
    if (descMatch?.[1] && pending) {
      pending.description = descMatch[1].trim();
      continue;
    }
    const estimatedMatch = line.match(/^(?:Estimated|推定|目安)\s*[:：]?\s*(\d+)/i);
    if (estimatedMatch?.[1] && pending) {
      const estimated = Number.parseInt(estimatedMatch[1], 10);
      if (Number.isFinite(estimated) && estimated > 0) {
        pending.estimatedWordCount = estimated;
      }
    }
  }
  flush();
  const existing = new Set(normalized.map((section) => canonicalizeHeading(section.title)));
  const rebuilt = [];
  let added = 0;
  const maxAdd = missing;
  const usedParentKeys = /* @__PURE__ */ new Set();
  const looseItemsForParent = (parentKey) => {
    const exact = byParent.get(parentKey);
    if (exact && exact.length > 0) {
      usedParentKeys.add(parentKey);
      return exact;
    }
    for (const [candidateKey, items] of byParent.entries()) {
      if (usedParentKeys.has(candidateKey)) continue;
      if (parentKey.includes(candidateKey) || candidateKey.includes(parentKey)) {
        usedParentKeys.add(candidateKey);
        return items;
      }
    }
    return [];
  };
  for (let i = 0; i < normalized.length; i += 1) {
    const section = normalized[i];
    rebuilt.push(section);
    if (added >= maxAdd || section.isLead || section.level !== 2 || isSummaryLikeTitle(section.title)) {
      continue;
    }
    const parentKey = canonicalizeHeading(section.title);
    const items = looseItemsForParent(parentKey);
    for (const item of items) {
      if (added >= maxAdd) break;
      const key = canonicalizeHeading(item.title);
      if (!key || existing.has(key) || isSummaryLikeTitle(item.title) || isWeakH3Title(item.title)) continue;
      existing.add(key);
      rebuilt.push({
        ...item,
        description: item.description || "\u5177\u4F53\u7684\u306A\u5224\u65AD\u6750\u6599\u3092\u6574\u7406\u3059\u308B"
      });
      added += 1;
    }
  }
  if (added < maxAdd) {
    const leftovers = [
      ...orphanItems,
      ...Array.from(byParent.entries()).filter(([key]) => !usedParentKeys.has(key)).flatMap(([, items]) => items)
    ];
    const targetSet = new Set(targetH2Indexes);
    const inserted = [];
    for (let i = 0; i < rebuilt.length; i += 1) {
      inserted.push(rebuilt[i]);
      const originalIndex = normalized.findIndex((section) => section.title === rebuilt[i].title && section.level === rebuilt[i].level && section.isLead === rebuilt[i].isLead);
      if (added >= maxAdd || !targetSet.has(originalIndex)) continue;
      while (leftovers.length > 0 && added < maxAdd) {
        const item = leftovers.shift();
        if (!item) break;
        const key = canonicalizeHeading(item.title);
        if (!key || existing.has(key) || isSummaryLikeTitle(item.title) || isWeakH3Title(item.title)) continue;
        existing.add(key);
        inserted.push({
          ...item,
          description: item.description || "\u5177\u4F53\u7684\u306A\u5224\u65AD\u6750\u6599\u3092\u6574\u7406\u3059\u308B"
        });
        added += 1;
        break;
      }
    }
    rebuilt.splice(0, rebuilt.length, ...inserted);
  }
  console.debug("[outline h3 supplement debug]", {
    targetH3Count,
    currentH3Count,
    added,
    targetH2: targetPlans.map(({ section, needed }) => ({ title: section.title, needed }))
  });
  return {
    sections: normalizeOutlineSections(rebuilt, targetWordCount),
    added
  };
}
async function generateOutlineWithSharedCore(params) {
  const basePrompt = buildSchedulerOutlinePrompt({
    keyword: params.keyword,
    targetWordCount: params.targetWordCount,
    fixedTitle: params.fixedTitle,
    customInstructions: params.customInstructions,
    competitorHeadings: params.competitorHeadings || [],
    competitorArticles: params.competitorArticles,
    relatedKeywords: params.relatedKeywords || [],
    searchConsoleQueries: params.searchConsoleQueries || [],
    articleStructureType: params.articleStructureType
  });
  const maxAttempts = 4;
  const minimumSectionCount = params.targetWordCount <= 1200 ? 5 : params.targetWordCount <= 2500 ? 5 : params.targetWordCount <= 3500 ? 6 : 7;
  const minimumNonLeadCount = Math.max(3, minimumSectionCount - 1);
  const targetH3Count = getTargetH3Count(params.targetWordCount);
  const hardMinimumH3Count = getHardMinimumH3Count(params.targetWordCount);
  let resolvedTitle = params.fixedTitle || `${params.keyword} \u306B\u3064\u3044\u3066`;
  let bestSections = [];
  let bestScore = Number.NEGATIVE_INFINITY;
  const attemptDiagnostics = [];
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const retryInstruction = attempt === 0 ? "" : [
      "\u3010\u518D\u751F\u6210\u6307\u793A\u3011",
      "- \u51FA\u529B\u5F62\u5F0F\u3092\u53B3\u5B88\u3057\u3001Section(Lead/H2/H3) \u306E\u5F62\u3067\u8FD4\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      "- \u5C0E\u5165\u3068\u307E\u3068\u3081\u4EE5\u5916\u306E\u898B\u51FA\u3057\u3092\u6700\u4F4E3\u3064\u4F5C\u6210\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      targetH3Count > 0 ? `- \u4E3B\u8981H2\u3054\u3068\u306BH3\u30923\u500B\u7F6E\u3044\u3066\u304F\u3060\u3055\u3044\u3002\u8A18\u4E8B\u5168\u4F53\u306EH3\u76EE\u6A19\u306F${targetH3Count}\u500B\u3067\u3059\u3002H3\u306F\u76F4\u524D\u306EH2\u306E\u5177\u4F53\u8AD6\u306B\u3057\u3066\u304F\u3060\u3055\u3044\u3002` : "",
      "- \u898B\u51FA\u3057\u306F\u30AD\u30FC\u30EF\u30FC\u30C9\u9023\u547C\u3092\u907F\u3051\u3001\u81EA\u7136\u306A\u65E5\u672C\u8A9E\u3067\u5177\u4F53\u5316\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      "- \u300C\u590F\u306E\u6D3B\u7528\u65B9\u6CD5\u300D\u300C\u7A2E\u985E\u3068\u7279\u5FB4\u300D\u300C\u9078\u3073\u65B9\u3068\u6CE8\u610F\u70B9\u300D\u300C\u3088\u304F\u3042\u308B\u7591\u554F\u300D\u306E\u3088\u3046\u306A\u6D45\u3044\u898B\u51FA\u3057\u3092\u907F\u3051\u3066\u304F\u3060\u3055\u3044\u3002",
      "- \u5BFE\u7B56\u8A18\u4E8B\u3067\u306F\u3001\u539F\u56E0\u3001\u512A\u5148\u9806\u4F4D\u3001\u7D44\u307F\u5408\u308F\u305B\u65B9\u3001\u8CBB\u7528\u30FB\u65BD\u5DE5\u30FB\u5B89\u5168\u9762\u306E\u6CE8\u610F\u70B9\u3092\u5165\u308C\u3066\u304F\u3060\u3055\u3044\u3002",
      params.relatedKeywords && params.relatedKeywords.length > 0 ? `- \u95A2\u9023\u8A9E\u306F\u305D\u306E\u307E\u307E\u898B\u51FA\u3057\u306B\u305B\u305A\u3001\u4E3B\u984C\u306B\u6CBF\u3063\u3066\u6574\u7406: ${params.relatedKeywords.slice(0, 6).join("\u3001")}` : "",
      attempt >= 2 ? '- \u5F62\u5F0F\u3092\u5B88\u308C\u306A\u3044\u5834\u5408\u306FJSON\u306E\u307F\u3067\u8FD4\u3057\u3066\u304F\u3060\u3055\u3044: {"title":"...","sections":[{"level":"lead|h2|h3","title":"...","description":"...","estimatedWordCount":300}]}' : ""
    ].filter(Boolean).join("\n");
    const prompt = retryInstruction ? `${basePrompt}

${retryInstruction}` : basePrompt;
    let text;
    try {
      text = await params.callAI(prompt, 4e3);
    } catch (callError) {
      if (callError?.partialText && typeof callError.partialText === "string" && callError.partialText.length > 100) {
        console.warn(`[outline] callAI truncated on attempt ${attempt + 1}, trying partial text (${callError.partialText.length} chars)`);
        text = callError.partialText;
      } else {
        attemptDiagnostics.push(`attempt${attempt + 1}: callAI error - ${String(callError?.message || callError)}`);
        continue;
      }
    }
    console.debug(`[outline debug] attempt${attempt + 1} response (first 800 chars):`, text.slice(0, 800));
    let parsedSections = parseOutlineSections(text, 400, false);
    const parsedFromJson = parsedSections.length <= 1 ? parseOutlineSectionsFromJson(text, 400) : { sections: [] };
    if (parsedFromJson.sections.length > parsedSections.length) {
      parsedSections = parsedFromJson.sections;
    }
    resolvedTitle = parsedFromJson.title || parseOutlineTitle(text, params.keyword, params.fixedTitle || null);
    if (parsedSections.length === 0) {
      attemptDiagnostics.push(`attempt${attempt + 1}: parsed=0`);
      continue;
    }
    const mapped = parsedSections.map((section) => ({
      title: section.title,
      level: section.level,
      description: section.description,
      isLead: section.isLead,
      estimatedWordCount: section.estimatedWordCount
    }));
    const normalized = normalizeOutlineSections(mapped, params.targetWordCount);
    const qualityScore = scoreOutlineSections(normalized, params.keyword, params.fixedTitle);
    const h3Count = countH3Sections(normalized);
    attemptDiagnostics.push(`attempt${attempt + 1}: parsed=${parsedSections.length}, normalized=${normalized.length}, h3=${h3Count}, score=${qualityScore}`);
    if (qualityScore > bestScore || qualityScore === bestScore && normalized.length > bestSections.length) {
      bestSections = normalized;
      bestScore = qualityScore;
    }
    const nonLeadCount = normalized.filter((section) => !section.isLead).length;
    const minimumQualityScore = isCountermeasureTopic(params.keyword, params.fixedTitle) ? 70 : 45;
    if (normalized.length >= minimumSectionCount && nonLeadCount >= minimumNonLeadCount && h3Count >= targetH3Count && qualityScore >= minimumQualityScore) {
      bestSections = normalized;
      bestScore = qualityScore;
      break;
    }
  }
  if (bestSections.length < minimumSectionCount) {
    try {
      const rescuePrompt = [
        "\u4EE5\u4E0B\u306E\u6761\u4EF6\u3067\u3001\u898B\u51FA\u3057\u6848\u3092\u518D\u4F5C\u6210\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
        `\u30AD\u30FC\u30EF\u30FC\u30C9: ${params.keyword}`,
        `\u76EE\u6A19\u6587\u5B57\u6570: ${params.targetWordCount}`,
        "\u5FC5\u305A\u6B21\u306E\u5F62\u5F0F\u3060\u3051\u3067\u8FD4\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
        "Title: [\u8A18\u4E8B\u30BF\u30A4\u30C8\u30EB]",
        "Section (Lead): \u5C0E\u5165",
        "Description: [\u5C0E\u5165\u306E\u8AAC\u660E]",
        "Estimated: [\u6587\u5B57\u6570]",
        "Section (H2): [\u898B\u51FA\u3057]",
        "Description: [\u8AAC\u660E]",
        "Estimated: [\u6587\u5B57\u6570]",
        targetH3Count > 0 ? `Section (H3)\u3082\u76EE\u6A19${targetH3Count}\u500B\u5165\u308C\u308B\u3053\u3068\u3002\u4E3B\u8981H2\u3054\u3068\u306BH3\u30923\u500B\u7F6E\u304D\u3001H3\u306F\u95A2\u9023\u3059\u308BH2\u306E\u76F4\u5F8C\u306B\u7F6E\u304F\u3053\u3068\u3002` : "",
        "\u6700\u5F8C\u306EH2\u306F\u300C\u307E\u3068\u3081\u300D\u306B\u3059\u308B\u3053\u3068\u3002",
        `\u5C0E\u5165\u3068\u307E\u3068\u3081\u4EE5\u5916\u306B\u6700\u4F4E${Math.max(2, minimumSectionCount - 2)}\u3064\u306EH2\u3092\u5165\u308C\u308B\u3053\u3068\u3002`,
        "\u30AD\u30FC\u30EF\u30FC\u30C9\u3092\u4E0D\u81EA\u7136\u306B\u7E70\u308A\u8FD4\u3055\u306A\u3044\u3053\u3068\u3002",
        'Section\u5F62\u5F0F\u3067\u8FD4\u305B\u306A\u3044\u5834\u5408\u306F\u3001JSON\u306E\u307F\u3067\u8FD4\u3057\u3066\u304F\u3060\u3055\u3044: {"title":"...","sections":[{"level":"lead|h2|h3","title":"...","description":"...","estimatedWordCount":300}]}'
      ].join("\n");
      const rescueText = await params.callAI(rescuePrompt, 1400);
      let rescueParsed = parseOutlineSections(rescueText, 400, false);
      const rescueJson = rescueParsed.length <= 1 ? parseOutlineSectionsFromJson(rescueText, 400) : { sections: [] };
      if (rescueJson.sections.length > rescueParsed.length) {
        rescueParsed = rescueJson.sections;
      }
      if (rescueJson.title) {
        resolvedTitle = rescueJson.title;
      }
      if (rescueParsed.length > 0) {
        const rescueMapped = rescueParsed.map((section) => ({
          title: section.title,
          level: section.level,
          description: section.description,
          isLead: section.isLead,
          estimatedWordCount: section.estimatedWordCount
        }));
        const rescueNormalized = normalizeOutlineSections(rescueMapped, params.targetWordCount);
        if (rescueNormalized.length > bestSections.length) {
          bestSections = rescueNormalized;
        }
        attemptDiagnostics.push(`rescue: parsed=${rescueParsed.length}, normalized=${rescueNormalized.length}`);
      } else {
        attemptDiagnostics.push("rescue: parsed=0");
      }
    } catch (error) {
      attemptDiagnostics.push(`rescue:error=${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (bestSections.length < minimumSectionCount && bestSections.length >= 2) {
    try {
      const supplementedResult = await supplementOutlineSectionsWithAI(
        bestSections,
        params.keyword,
        params.relatedKeywords || [],
        params.targetWordCount,
        minimumSectionCount,
        params.callAI
      );
      if (supplementedResult.sections.length > bestSections.length) {
        bestSections = supplementedResult.sections;
      }
      attemptDiagnostics.push(
        `supplemented:${supplementedResult.usedAI ? "ai" : "rule"} added=${supplementedResult.added} normalized=${bestSections.length}`
      );
    } catch (error) {
      attemptDiagnostics.push(`supplement:error=${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (countH3Sections(bestSections) < targetH3Count && bestSections.length >= minimumSectionCount) {
    for (let h3Attempt = 0; h3Attempt < 4 && countH3Sections(bestSections) < targetH3Count; h3Attempt += 1) {
      try {
        const h3Supplement = await supplementH3SectionsWithAI(
          bestSections,
          params.keyword,
          params.targetWordCount,
          targetH3Count,
          params.callAI
        );
        if (h3Supplement.sections.length > bestSections.length) {
          bestSections = h3Supplement.sections;
        }
        attemptDiagnostics.push(`h3Supplement: added=${h3Supplement.added} h3=${countH3Sections(bestSections)} normalized=${bestSections.length}`);
        if (h3Supplement.added === 0) break;
      } catch (error) {
        attemptDiagnostics.push(`h3Supplement:error=${error instanceof Error ? error.message : String(error)}`);
        break;
      }
    }
  }
  if (bestSections.length < minimumSectionCount) {
    throw new Error(`\u30A2\u30A6\u30C8\u30E9\u30A4\u30F3\u306E\u751F\u6210\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002AI\u306E\u5FDC\u7B54\u304C\u6B63\u3057\u304F\u89E3\u6790\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\uFF08diagnostics: ${attemptDiagnostics.join(" | ")}\uFF09`);
  }
  if (countH3Sections(bestSections) < hardMinimumH3Count) {
    const h3Count = countH3Sections(bestSections);
    attemptDiagnostics.push(`h3SoftFallback: h3=${h3Count} hardMinimum=${hardMinimumH3Count}`);
    console.warn(
      `Outline H3 count is below preferred minimum, but generation will continue. h3=${h3Count}, hardMinimum=${hardMinimumH3Count}, diagnostics=${attemptDiagnostics.join(" | ")}`
    );
  }
  const sectionsWithDescriptions = ensureOutlineDescriptions(bestSections);
  const sectionsWithBalancedH3 = rebalanceParentAndChildH3WordCounts(sectionsWithDescriptions, params.targetWordCount);
  const rebalancedSections = rebalanceEstimatedWordCounts(sectionsWithBalancedH3, params.targetWordCount);
  const normalizedLevels = flattenHeadingLevelsForMediumLength(rebalancedSections, params.targetWordCount);
  return { title: resolvedTitle, sections: normalizedLevels };
}
async function generateOutlineWithAutoModeStyle(params) {
  return generateOutlineWithSharedCore(params);
}

// src/shared/autoModeQuality.ts
function compactAutoModeInstructions(parts) {
  const text = parts.map((part) => String(part || "").trim()).filter(Boolean).join("\n\n").trim();
  return text || void 0;
}
function buildAutoModeQualityInstructions(options) {
  return [
    "\u81EA\u52D5\u30E2\u30FC\u30C9\u54C1\u8CEA\u57FA\u6E96:",
    options.selectedTitle ? `- \u56FA\u5B9A\u30BF\u30A4\u30C8\u30EB\u300C${options.selectedTitle}\u300D\u306E\u691C\u7D22\u610F\u56F3\u3092\u6700\u512A\u5148\u3057\u3001\u30BF\u30A4\u30C8\u30EB\u304B\u3089\u5916\u308C\u305F\u7AE0\u3092\u4F5C\u3089\u306A\u3044` : "- \u5165\u529B\u30AD\u30FC\u30EF\u30FC\u30C9\u304B\u3089\u8AAD\u8005\u306E\u691C\u7D22\u610F\u56F3\u3092\u7279\u5B9A\u3057\u3001\u8A18\u4E8B\u5168\u4F53\u3092\u4E00\u3064\u306E\u660E\u78BA\u306A\u76EE\u7684\u306B\u63C3\u3048\u308B",
    `- \u76EE\u6A19\u6587\u5B57\u6570\u306F${options.targetWordCount}\u5B57\u3002\u5C0E\u5165\u30FB\u672C\u6587\u30FB\u307E\u3068\u3081\u306E\u914D\u5206\u3092\u5D29\u3055\u305A\u3001\u672C\u6587\u3092\u8584\u304F\u3057\u306A\u3044`,
    "- \u5BFE\u8A71\u30E2\u30FC\u30C9\u3067\u4EBA\u304C\u78BA\u8A8D\u3057\u305F\u30A2\u30A6\u30C8\u30E9\u30A4\u30F3\u3068\u540C\u7B49\u306B\u306A\u308B\u3088\u3046\u3001\u5404H2\u306E\u5F79\u5272\u3092\u5206\u3051\u308B",
    "- \u300C\u7A2E\u985E\u3068\u7279\u5FB4\u300D\u300C\u9078\u3073\u65B9\u3068\u6CE8\u610F\u70B9\u300D\u300C\u6D3B\u7528\u65B9\u6CD5\u300D\u3060\u3051\u306E\u6C4E\u7528\u898B\u51FA\u3057\u306B\u9003\u3052\u305A\u3001\u30C6\u30FC\u30DE\u56FA\u6709\u306E\u5224\u65AD\u6750\u6599\u306B\u3059\u308B",
    "- H3\u306F\u76F4\u524D\u306EH2\u3092\u5177\u4F53\u5316\u3059\u308B\u5C0F\u898B\u51FA\u3057\u3068\u3057\u3066\u4F7F\u3044\u3001\u72EC\u7ACB\u3057\u305F\u5927\u30C6\u30FC\u30DE\u306B\u3057\u306A\u3044",
    "- \u672C\u6587\u3067\u306F\u540C\u3058\u8AAC\u660E\u3092\u7E70\u308A\u8FD4\u3055\u305A\u3001\u539F\u56E0\u30FB\u5BFE\u7B56\u30FB\u6BD4\u8F03\u30FB\u6CE8\u610F\u70B9\u30FB\u5B9F\u884C\u624B\u9806\u306E\u3069\u308C\u3092\u6271\u3046\u304B\u3092\u660E\u78BA\u306B\u3059\u308B",
    "- AIO\u30FBAI\u691C\u7D22\u3067\u8981\u7D04\u3055\u308C\u3084\u3059\u3044\u3088\u3046\u3001\u5C0E\u5165\u3067\u7D50\u8AD6\u3092\u5148\u306B\u793A\u3057\u3001\u5B9A\u7FA9\u30FB\u624B\u9806\u30FB\u6BD4\u8F03\u30FB\u5224\u65AD\u57FA\u6E96\u30FBFAQ\u306B\u8EE2\u7528\u3057\u3084\u3059\u3044\u898B\u51FA\u3057\u3092\u5FC5\u8981\u306B\u5FDC\u3058\u3066\u5165\u308C\u308B",
    "- \u5404\u898B\u51FA\u3057\u306F1\u3064\u306E\u8CEA\u554F\u306B\u5BFE\u3059\u308B\u7B54\u3048\u304C\u629C\u304D\u51FA\u305B\u308B\u7C92\u5EA6\u306B\u3057\u3001\u8907\u6570\u30C6\u30FC\u30DE\u3092\u6DF7\u305C\u306A\u3044",
    options.articleStructureType ? `- \u8A18\u4E8B\u69CB\u6210\u30BF\u30A4\u30D7: ${options.articleStructureType}` : ""
  ].filter(Boolean).join("\n");
}
function normalizeComparableText(value) {
  return String(value || "").toLowerCase().replace(/[^\p{Letter}\p{Number}]+/gu, "").trim();
}
function isSummaryTitle(title) {
  const normalized = String(title || "").trim().toLowerCase();
  return normalized.includes("\u307E\u3068\u3081") || normalized.includes("\u7D50\u8AD6") || normalized.includes("\u304A\u308F\u308A\u306B") || normalized.includes("\u7DCF\u62EC") || normalized.includes("\u6700\u5F8C\u306B") || normalized.includes("summary") || normalized.includes("conclusion");
}
function evaluateAutoOutlineQuality(outline, options) {
  const issues = [];
  const sections = outline.sections || [];
  const nonLeadSections = sections.filter((section) => !section.isLead);
  const h2Sections = nonLeadSections.filter((section) => section.level === 2);
  const h3Sections = nonLeadSections.filter((section) => section.level === 3);
  const minSections = options.targetWordCount <= 1200 ? 5 : options.targetWordCount <= 3e3 ? 6 : 7;
  if (sections.length < minSections) {
    issues.push(`section count is too low (${sections.length}/${minSections})`);
  }
  if (h2Sections.length < 3) {
    issues.push(`H2 count is too low (${h2Sections.length}/3)`);
  }
  if (options.targetWordCount >= 1600 && h3Sections.length < 2) {
    issues.push(`H3 count is too low (${h3Sections.length}/2)`);
  }
  if (!sections.some((section) => isSummaryTitle(section.title))) {
    issues.push("summary section is missing");
  }
  const seenTitles = /* @__PURE__ */ new Set();
  const genericHeadingPattern = /(活用方法|種類と特徴|選び方と注意点|ポイント|メリット|デメリット|主な種類と特徴|特徴・費用・継続しやすさ)$/;
  let genericHeadingCount = 0;
  for (const section of nonLeadSections) {
    const title = String(section.title || "").trim();
    const normalized = normalizeComparableText(title);
    if (!normalized) {
      issues.push("empty heading exists");
      continue;
    }
    if (seenTitles.has(normalized)) {
      issues.push(`duplicate heading: ${title}`);
    }
    seenTitles.add(normalized);
    if (genericHeadingPattern.test(title)) {
      genericHeadingCount += 1;
    }
  }
  if (genericHeadingCount >= 2) {
    issues.push(`too many generic headings (${genericHeadingCount})`);
  }
  return { passed: issues.length === 0, issues };
}
function buildAutoOutlineRetryInstructions(issues) {
  return [
    "\u81EA\u52D5\u30E2\u30FC\u30C9\u518D\u751F\u6210\u6307\u793A:",
    "\u524D\u56DE\u306E\u30A2\u30A6\u30C8\u30E9\u30A4\u30F3\u306F\u81EA\u52D5\u751F\u6210\u54C1\u8CEA\u57FA\u6E96\u3092\u6E80\u305F\u3057\u3066\u3044\u307E\u305B\u3093\u3002\u4EE5\u4E0B\u3092\u5FC5\u305A\u4FEE\u6B63\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
    ...issues.map((issue) => `- ${issue}`),
    "- H2\u3054\u3068\u306E\u5F79\u5272\u3092\u660E\u78BA\u306B\u5206\u3051\u3001\u6C4E\u7528\u898B\u51FA\u3057\u3092\u30C6\u30FC\u30DE\u56FA\u6709\u306E\u5177\u4F53\u7684\u306A\u898B\u51FA\u3057\u306B\u7F6E\u304D\u63DB\u3048\u308B",
    "- \u76EE\u6A19\u6587\u5B57\u6570\u306B\u5BFE\u3057\u3066\u672C\u6587\u304C\u8584\u304F\u306A\u3089\u306A\u3044\u7AE0\u6570\u3068\u914D\u5206\u306B\u3059\u308B"
  ].join("\n");
}

// src/shared/titleGenerationCore.ts
function extractJsonArray(text) {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = trimmed.indexOf("[");
  const end = trimmed.lastIndexOf("]");
  if (start !== -1 && end !== -1 && end > start) {
    return trimmed.slice(start, end + 1);
  }
  return null;
}
function normalizeTitleText(value) {
  return String(value || "").replace(/^タイトル[:：]\s*/i, "").replace(/^\*\*|\*\*$/g, "").replace(/^["']|["']$/g, "").replace(/[「」『』【】]/g, "").replace(/\s+/g, " ").trim();
}
function normalizeComparable(value) {
  return normalizeTitleText(value).toLowerCase().replace(/[｜|:：\-‐‑–—]/g, "").replace(/\s+/g, "");
}
function hasRedundantTitlePattern(title, keyword) {
  const normalizedTitle = normalizeComparable(title);
  const normalizedKeyword = normalizeComparable(keyword);
  if (!normalizedTitle) return false;
  if (/(選び方|おすすめ|比較|評判|費用|ポイント)の\1/.test(normalizedTitle)) {
    return true;
  }
  if (normalizedKeyword.length >= 4 && normalizedTitle.includes(`${normalizedKeyword}\u306E${normalizedKeyword}`)) {
    return true;
  }
  return false;
}
function buildReasonFromTitle(title) {
  const t = String(title || "");
  if (/費用|価格|相場|料金/.test(t)) {
    return "\u8CBB\u7528\u9762\u306E\u4E0D\u5B89\u3092\u5148\u56DE\u308A\u3057\u3066\u89E3\u6D88\u3057\u3001\u6BD4\u8F03\u691C\u8A0E\u5C64\u306E\u30AF\u30EA\u30C3\u30AF\u52D5\u6A5F\u3092\u9AD8\u3081\u308B\u305F\u3081\u3002";
  }
  if (/比較|選び方|判断|基準|見極め/.test(t)) {
    return "\u6BD4\u8F03\u8EF8\u3092\u5148\u306B\u63D0\u793A\u3057\u3001\u691C\u8A0E\u6BB5\u968E\u306E\u8AAD\u8005\u304C\u610F\u601D\u6C7A\u5B9A\u3057\u3084\u3059\u304F\u306A\u308B\u305F\u3081\u3002";
  }
  if (/失敗|後悔|注意|落とし穴|避ける/.test(t)) {
    return "\u5931\u6557\u56DE\u907F\u30CB\u30FC\u30BA\u306B\u76F4\u63A5\u5FDC\u3048\u3001\u691C\u7D22\u610F\u56F3\u3068\u306E\u4E00\u81F4\u7387\u3092\u9AD8\u3081\u308B\u305F\u3081\u3002";
  }
  if (/始め方|手順|ステップ|初めて|入門/.test(t)) {
    return "\u5B9F\u884C\u624B\u9806\u3092\u60F3\u8D77\u3055\u305B\u3001\u3053\u308C\u304B\u3089\u59CB\u3081\u308B\u8AAD\u8005\u306E\u884C\u52D5\u3092\u5F8C\u62BC\u3057\u3059\u308B\u305F\u3081\u3002";
  }
  if (/評判|口コミ|レビュー/.test(t)) {
    return "\u7B2C\u4E09\u8005\u8A55\u4FA1\u3092\u91CD\u8996\u3059\u308B\u5C64\u306B\u523A\u3055\u308A\u3001\u30AF\u30EA\u30C3\u30AF\u306E\u5FC3\u7406\u7684\u30CF\u30FC\u30C9\u30EB\u3092\u4E0B\u3052\u308B\u305F\u3081\u3002";
  }
  if (/おすすめ|厳選|ランキング/.test(t)) {
    return "\u5019\u88DC\u306E\u7D5E\u308A\u8FBC\u307F\u30CB\u30FC\u30BA\u306B\u5FDC\u3048\u3001\u77ED\u6642\u9593\u3067\u6BD4\u8F03\u3057\u305F\u3044\u8AAD\u8005\u306B\u9069\u5408\u3059\u308B\u305F\u3081\u3002";
  }
  return "\u691C\u7D22\u610F\u56F3\u306B\u6CBF\u3046\u5207\u308A\u53E3\u3092\u660E\u78BA\u306B\u3057\u3001\u30AF\u30EA\u30C3\u30AF\u5F8C\u306E\u671F\u5F85\u5024\u3068\u306E\u30AE\u30E3\u30C3\u30D7\u3092\u6291\u3048\u308B\u305F\u3081\u3002";
}
function parseJsonLikeTitles(raw) {
  const titleMatches = [...String(raw || "").matchAll(/["“”](?:title|タイトル)["“”]\s*[:：]\s*["“”]([^"“”]+)["“”]/gi)];
  if (titleMatches.length === 0) return [];
  const reasonMatches = [...String(raw || "").matchAll(/["“”](?:reason|理由|狙い)["“”]\s*[:：]\s*["“”]([^"“”]+)["“”]/gi)];
  return titleMatches.map((match, index) => ({
    title: normalizeTitleText(String(match[1] || "")),
    reason: normalizeTitleText(String(reasonMatches[index]?.[1] || ""))
  }));
}
function parseMarkdownTableTitles(raw) {
  const lines = String(raw || "").split("\n").map((line) => line.trim()).filter((line) => line.startsWith("|") && line.endsWith("|"));
  const results = [];
  for (const line of lines) {
    if (/^\|\s*-+/.test(line)) continue;
    if (/タイトル|title/i.test(line) && /理由|reason|狙い/i.test(line)) continue;
    const cells = line.split("|").map((cell) => cell.trim()).filter(Boolean);
    if (cells.length < 1) continue;
    const title = normalizeTitleText(cells[0] || "");
    if (!title || title.length < 6 || title.length > 120) continue;
    results.push({
      title,
      reason: normalizeTitleText(cells[1] || "")
    });
  }
  return results;
}
function parseLineBasedTitles(raw) {
  const lines = String(raw || "").split("\n").map((line) => line.trim()).filter(Boolean);
  const results = [];
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const looksLikeTitleLine = /^[-*]\s+/.test(line) || /^\d+[.)、]\s+/.test(line) || /^(?:タイトル案?|案|title)\s*\d*\s*[:：]/i.test(line) || /^#{1,4}\s+/.test(line);
    if (!looksLikeTitleLine) continue;
    const cleaned = line.replace(/^#{1,4}\s+/, "").replace(/^[-*]\s+/, "").replace(/^\d+[.)、]\s+/, "").replace(/^(?:タイトル案?|案|title)\s*\d*\s*[:：]\s*/i, "").replace(/\*\*/g, "").split(/\s+(?:-|--|ー|:|：)\s*(?:理由|狙い|reason)\s*[:：]?/i)[0].split(/\s+\|\s+/)[0].trim();
    if (!cleaned || cleaned.length < 6 || cleaned.length > 120) continue;
    if (/^(理由|狙い|reason)[:：]/i.test(cleaned)) continue;
    const nextLine = String(lines[index + 1] || "").trim();
    const reasonMatch = nextLine.match(/^(?:理由|狙い|reason)[:：]\s*(.+)$/i);
    results.push({
      title: normalizeTitleText(cleaned),
      reason: reasonMatch ? normalizeTitleText(reasonMatch[1]) : ""
    });
  }
  return results;
}
function normalizeAndFilterSuggestions(suggestions, keyword, limit) {
  const seen = /* @__PURE__ */ new Set();
  const normalized = [];
  for (const item of suggestions) {
    const title = normalizeTitleText(String(item?.title || ""));
    if (!title) continue;
    if (hasRedundantTitlePattern(title, keyword)) continue;
    const comparable = normalizeComparable(title);
    if (!comparable || seen.has(comparable)) continue;
    seen.add(comparable);
    const reason = String(item?.reason || "").trim() || buildReasonFromTitle(title);
    normalized.push({ title, reason });
    if (normalized.length >= limit) break;
  }
  return normalized;
}
function ensureReasonDiversity(suggestions) {
  if (suggestions.length <= 1) return suggestions;
  const uniqueReasons = new Set(
    suggestions.map((item) => String(item.reason || "").trim()).filter(Boolean)
  );
  if (uniqueReasons.size >= Math.min(3, suggestions.length)) return suggestions;
  return suggestions.map((item) => ({
    title: item.title,
    reason: buildReasonFromTitle(item.title)
  }));
}
function parseSuggestionsFromJsonValue(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const record = value;
  const candidateKeys = ["titles", "suggestions", "titleSuggestions", "candidates", "items", "\u30BF\u30A4\u30C8\u30EB\u5019\u88DC"];
  for (const key of candidateKeys) {
    if (Array.isArray(record[key])) return record[key];
  }
  return [];
}
function parseAiTitleSuggestions(raw, keyword, count) {
  const parsers = [
    () => parseJsonLikeTitles(raw),
    () => parseMarkdownTableTitles(raw),
    () => parseLineBasedTitles(raw)
  ];
  for (const parse of parsers) {
    const suggestions = normalizeAndFilterSuggestions(parse(), keyword, count);
    if (suggestions.length >= count) return ensureReasonDiversity(suggestions);
  }
  const jsonText = extractJsonArray(raw);
  if (jsonText) {
    try {
      const parsed = JSON.parse(jsonText);
      const parsedSuggestions = parseSuggestionsFromJsonValue(parsed);
      const suggestions = normalizeAndFilterSuggestions(parsedSuggestions, keyword, count);
      if (suggestions.length >= count) return ensureReasonDiversity(suggestions);
    } catch {
      return [];
    }
  }
  return [];
}
async function generateTitleSuggestionsWithSharedCore(params) {
  const count = Math.max(1, Math.min(8, Number(params.count) || 5));
  const keyword = String(params.keyword || "").trim();
  if (!keyword) {
    throw new Error("\u30BF\u30A4\u30C8\u30EB\u751F\u6210\u306B\u5FC5\u8981\u306A\u30AD\u30FC\u30EF\u30FC\u30C9\u304C\u3042\u308A\u307E\u305B\u3093\u3002");
  }
  const ngKeywords = (params.ngKeywords || []).map((k) => String(k || "").trim()).filter(Boolean);
  const essentialKeywords = (params.essentialKeywords || []).map((k) => String(k || "").trim()).filter(Boolean);
  const relatedKeywords = (params.relatedKeywords || []).map((k) => String(k || "").trim()).filter(Boolean);
  const hotTopics = (params.hotTopics || []).map((k) => String(k || "").trim()).filter(Boolean);
  const competitors = (params.competitors || []).filter((c) => String(c?.title || "").trim().length > 0);
  const filteredRelated = relatedKeywords.filter((kw) => !ngKeywords.includes(kw));
  const filteredHotTopics = hotTopics.filter((topic) => !ngKeywords.some((ng) => topic.includes(ng)));
  const relatedLine = [...filteredRelated, ...filteredHotTopics].slice(0, 12).join("\u3001") || "\u306A\u3057";
  const competitorText = competitors.length > 0 ? competitors.map((c) => {
    const title = String(c.title || "").trim();
    const headings = Array.isArray(c.headings) ? c.headings.filter(Boolean).slice(0, 5).join(", ") : "";
    return `- \u30BF\u30A4\u30C8\u30EB: ${title}${headings ? `
  (\u4E3B\u306A\u898B\u51FA\u3057: ${headings})` : ""}`;
  }).join("\n") : "\uFF08\u30C7\u30FC\u30BF\u306A\u3057\uFF09";
  const outputExample = Array.from(
    { length: count },
    (_, index) => `  { "title": "\u30BF\u30A4\u30C8\u30EB${index + 1}", "reason": "\u3053\u306E\u5207\u308A\u53E3\u306B\u3057\u305F\u7406\u7531" }`
  ).join(",\n");
  const prompt = `
\u3042\u306A\u305F\u306F\u65E5\u672C\u8A9ESEO\u30E9\u30A4\u30BF\u30FC\u3067\u3059\u3002\u4EE5\u4E0B\u306E\u30AD\u30FC\u30EF\u30FC\u30C9\u3067\u3001\u30AA\u30EA\u30B8\u30CA\u30EB\u306E\u30D6\u30ED\u30B0\u8A18\u4E8B\u30BF\u30A4\u30C8\u30EB\u3092${count}\u4EF6\u4F5C\u6210\u3057\u3066\u304F\u3060\u3055\u3044\u3002

\u3010\u30E1\u30A4\u30F3\u30AD\u30FC\u30EF\u30FC\u30C9\u3011
${keyword}

\u3010\u95A2\u9023\u30AD\u30FC\u30EF\u30FC\u30C9\uFF08\u8A18\u4E8B\u5185\u5BB9\u306E\u53C2\u8003\u306B\uFF09\u3011
${relatedLine}

${essentialKeywords.length > 0 ? `\u3010\u5FC5\u305A\u542B\u3081\u308B\u30AD\u30FC\u30EF\u30FC\u30C9\u3011
${essentialKeywords.join("\u3001")}
` : ""}
${ngKeywords.length > 0 ? `\u3010\u4F7F\u7528\u7981\u6B62\u30AD\u30FC\u30EF\u30FC\u30C9\u3011
${ngKeywords.join("\u3001")}
` : ""}

${competitors.length > 0 ? `\u3010\u65E2\u5B58\u8A18\u4E8B\uFF08\u5DEE\u5225\u5316\u306E\u305F\u3081\u306B\u53C2\u7167\u3001\u6A21\u5023\u3057\u306A\u3044\u3053\u3068\uFF09\u3011
${competitorText}
` : ""}
\u3010\u30BF\u30A4\u30C8\u30EB\u4F5C\u6210\u30EB\u30FC\u30EB\u3011
1. \u65E2\u5B58\u8A18\u4E8B\u306E\u30BF\u30A4\u30C8\u30EB\u3092\u771F\u4F3C\u3057\u306A\u3044\u3002\u69CB\u6210\u30FB\u8A9E\u9806\u30FB\u8A9E\u5C3E\u3059\u3079\u3066\u72EC\u81EA\u306B\u8003\u3048\u308B
2. \u300C\u25CB\u25CB\u306E\u9078\u3073\u65B9\u300D\u300C\u5F8C\u6094\u3057\u306A\u3044\u300D\u300C\u25CB\u25CB\u5E74\u7248\u300D\u306A\u3069\u306E\u4F7F\u3044\u53E4\u3057\u305F\u5B9A\u578B\u53E5\u3092\u907F\u3051\u308B
3. ${count}\u4EF6\u305D\u308C\u305E\u308C\u7570\u306A\u308B\u5207\u308A\u53E3\u30FB\u8996\u70B9\u30FB\u6587\u4F53\u306B\u3059\u308B\uFF08\u540C\u3058\u578B\u306E\u7E70\u308A\u8FD4\u3057\u7981\u6B62\uFF09
4. \u8AAD\u8005\u306E\u300C\u306A\u305C\uFF1F\u300D\u300C\u3069\u3046\u3084\u3063\u3066\uFF1F\u300D\u300C\u4F55\u304C\u9055\u3046\uFF1F\u300D\u306A\u3069\u306E\u554F\u3044\u306B\u76F4\u63A5\u7B54\u3048\u308B\u30BF\u30A4\u30C8\u30EB\u306B\u3059\u308B
5. \u30AD\u30FC\u30EF\u30FC\u30C9\u306F\u6587\u8108\u306B\u5408\u308F\u305B\u3066\u81EA\u7136\u306B\u542B\u3081\u3001\u7121\u7406\u306A\u8A70\u3081\u8FBC\u307F\u3092\u3057\u306A\u3044
6. \u8A18\u4E8B\u306E\u5177\u4F53\u7684\u306A\u5185\u5BB9\u30FB\u4FA1\u5024\u304C\u4F1D\u308F\u308B\u30BF\u30A4\u30C8\u30EB\u306B\u3059\u308B\uFF08\u66D6\u6627\u306A\u8868\u73FE\u3092\u907F\u3051\u308B\uFF09
7. \u5404\u30BF\u30A4\u30C8\u30EB\u306B\u3001\u305D\u306E\u30BF\u30A4\u30C8\u30EB\u306B\u3057\u305F\u7406\u7531\uFF08\u8AAD\u8005\u8996\u70B9\u3067\u306E\u72D9\u3044\uFF09\u30921\u6587\u3067\u6DFB\u3048\u308B

\u3010\u51FA\u529B\u5F62\u5F0F\uFF08JSON\u914D\u5217\u306E\u307F\u3001\u524D\u7F6E\u304D\u4E0D\u8981\uFF09\u3011
[
${outputExample}
]
`.trim();
  try {
    const raw = await params.callAI(prompt, 1800);
    const suggestions = parseAiTitleSuggestions(raw, keyword, count);
    if (suggestions.length >= 1) return suggestions;
    const retryPrompt = `
\u6B21\u306E\u30AD\u30FC\u30EF\u30FC\u30C9\u304B\u3089\u3001\u30D6\u30ED\u30B0\u8A18\u4E8B\u30BF\u30A4\u30C8\u30EB\u6848\u3092\u5FC5\u305A${count}\u4EF6\u4F5C\u6210\u3057\u3066\u304F\u3060\u3055\u3044\u3002

\u30AD\u30FC\u30EF\u30FC\u30C9: ${keyword}
\u95A2\u9023\u30AD\u30FC\u30EF\u30FC\u30C9: ${relatedLine}

\u6761\u4EF6:
- \u8FD4\u7B54\u306FJSON\u914D\u5217\u306E\u307F
- \u914D\u5217\u306E\u8981\u7D20\u6570\u306F\u5FC5\u305A${count}\u4EF6
- \u5404\u8981\u7D20\u306F title \u3068 reason \u3092\u6301\u3064
- title\u306F\u8A18\u4E8B\u30BF\u30A4\u30C8\u30EB\u3068\u3057\u3066\u305D\u306E\u307E\u307E\u4F7F\u3048\u308B\u65E5\u672C\u8A9E\u306B\u3059\u308B
- reason\u306F1\u6587\u3067\u66F8\u304F

\u51FA\u529B\u4F8B:
[
${outputExample}
]
`.trim();
    const retryRaw = await params.callAI(retryPrompt, 1200);
    const retrySuggestions = parseAiTitleSuggestions(retryRaw, keyword, count);
    if (retrySuggestions.length >= 1) return retrySuggestions;
    throw new Error(`AI\u306E\u30BF\u30A4\u30C8\u30EB\u5019\u88DC\u30921\u4EF6\u3082\u53D6\u5F97\u3067\u304D\u307E\u305B\u3093\u3067\u3057\u305F\u3002`);
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error("AI\u30BF\u30A4\u30C8\u30EB\u751F\u6210\u306B\u5931\u6557\u3057\u307E\u3057\u305F\u3002");
  }
}

// supabase/functions/scheduler-executor/_fact-check-helpers.ts
async function extractFactsFromContent(content, userMarkedText) {
  const items = [];
  if (userMarkedText) {
    const regex = /\[\[(.+?)\]\]/g;
    let match2;
    while ((match2 = regex.exec(userMarkedText)) !== null) {
      const start = Math.max(0, match2.index - 50);
      const end = Math.min(userMarkedText.length, match2.index + match2[0].length + 50);
      items.push({
        claim: match2[1],
        context: userMarkedText.substring(start, end),
        priority: "high"
      });
    }
  }
  const numberRegex = /(\d{1,3}(?:,\d{3})*(?:\.\d+)?(?:%|円|ドル|人|件|倍|km|kg)?)/g;
  let match;
  while ((match = numberRegex.exec(content)) !== null) {
    const start = Math.max(0, match.index - 30);
    const end = Math.min(content.length, match.index + match[0].length + 30);
    items.push({
      claim: match[0],
      context: content.substring(start, end),
      priority: "normal"
    });
  }
  const dateRegex = /(\d{4}年\d{1,2}月\d{1,2}日|\d{4}年\d{1,2}月|\d{4}年)/g;
  while ((match = dateRegex.exec(content)) !== null) {
    const start = Math.max(0, match.index - 30);
    const end = Math.min(content.length, match.index + match[0].length + 30);
    items.push({
      claim: match[0],
      context: content.substring(start, end),
      priority: "normal"
    });
  }
  return items.sort((a, b) => a.priority === "high" ? -1 : b.priority === "high" ? 1 : 0);
}
async function verifyFactsBatch(items, apiKey, keyword, modelName = "sonar", batchSize = 5) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const claimsList = batch.map((item, idx) => `${idx + 1}. \u4E3B\u5F35: ${item.claim}
   \u6587\u8108: ${item.context}`).join("\n\n");
    const prompt = [
      "\u6B21\u306E\u4E3B\u5F35\u3092\u6700\u65B0\u306E\u516C\u958B\u60C5\u5831\u3067\u691C\u8A3C\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      "",
      "\u3010\u30C1\u30A7\u30C3\u30AF\u5BFE\u8C61\u3011",
      claimsList,
      "",
      `\u3010\u95A2\u9023\u30AD\u30FC\u30EF\u30FC\u30C9\u3011${keyword}`,
      "",
      "\u6B21\u306EJSON\u914D\u5217\u306E\u307F\u3092\u8FD4\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
      "[",
      "  {",
      '    "claim_number": 1,',
      '    "verdict": "correct | incorrect | partially_correct | unverified",',
      '    "confidence": 0,',
      '    "correct_info": "\u88DC\u8DB3\u60C5\u5831",',
      '    "explanation": "\u7406\u7531",',
      '    "source_url": "https://..."',
      "  }",
      "]"
    ].join("\n");
    try {
      const response = await fetch("https://api.perplexity.ai/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: modelName,
          messages: [
            { role: "system", content: "You are a fact-checking expert. Verify claims and return JSON only." },
            { role: "user", content: prompt }
          ],
          temperature: 0.1
        })
      });
      if (!response.ok) {
        throw new Error(`Perplexity API error: ${response.status}`);
      }
      const data = await response.json();
      const content = data?.choices?.[0]?.message?.content ?? "[]";
      let batchResults = [];
      try {
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        batchResults = JSON.parse(jsonMatch ? jsonMatch[0] : content);
      } catch {
        batchResults = batch.map((_, idx) => ({
          claim_number: idx + 1,
          verdict: "unverified",
          confidence: 0,
          explanation: "\u30EC\u30B9\u30DD\u30F3\u30B9\u306E\u89E3\u6790\u306B\u5931\u6557\u3057\u307E\u3057\u305F",
          source_url: ""
        }));
      }
      batch.forEach((item, idx) => {
        const result = batchResults.find((r) => r.claim_number === idx + 1) ?? batchResults[idx];
        if (!result) return;
        results.push({
          claim: item.claim,
          verdict: result.verdict,
          confidence: result.confidence,
          correctInfo: result.correct_info,
          sourceUrl: result.source_url ?? "",
          explanation: result.explanation ?? ""
        });
      });
      if (i + batchSize < items.length) {
        await new Promise((resolve) => setTimeout(resolve, 2e3));
      }
    } catch (error) {
      console.error(`Batch verification failed for items ${i}-${i + batchSize}:`, error);
      batch.forEach((item) => {
        results.push({
          claim: item.claim,
          verdict: "unverified",
          confidence: 0,
          explanation: `\u30A8\u30E9\u30FC: ${error?.message ?? "unknown error"}`,
          sourceUrl: ""
        });
      });
    }
  }
  return results;
}
async function applyFactCheckCorrections(originalContent, results, apiKey, keyword, modelName = "sonar") {
  const issues = (results || []).filter(
    (result) => result.verdict === "incorrect" || result.verdict === "partially_correct" && Number(result.confidence || 0) >= 40
  );
  if (issues.length === 0) return originalContent;
  const issuesText = issues.slice(0, 20).map((result, idx) => {
    const correction = result.correctInfo ? `
- \u4FEE\u6B63\u60C5\u5831: ${result.correctInfo}` : "";
    const source = result.sourceUrl ? `
- \u51FA\u5178: ${result.sourceUrl}` : "";
    return `${idx + 1}. \u4E3B\u5F35: ${result.claim}
- \u5224\u5B9A: ${result.verdict} (${result.confidence}%)
- \u7406\u7531: ${result.explanation || ""}${correction}${source}`;
  }).join("\n\n");
  const prompt = [
    "\u4EE5\u4E0B\u306E\u8A18\u4E8B\u3092\u3001\u6307\u6458\u3055\u308C\u305F\u4E8B\u5B9F\u8AA4\u8A8D\u306E\u307F\u4FEE\u6B63\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
    "\u6587\u4F53\u30FB\u69CB\u6210\u30FB\u898B\u51FA\u3057\u30FB\u6BB5\u843D\u9806\u306F\u53EF\u80FD\u306A\u9650\u308A\u7DAD\u6301\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
    "\u4E0D\u78BA\u304B\u306A\u8A18\u8FF0\u306F\u65AD\u5B9A\u3092\u907F\u3051\u308B\u8868\u73FE\u306B\u4FEE\u6B63\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
    "\u56DE\u7B54\u306F\u4FEE\u6B63\u5F8C\u306E\u8A18\u4E8B\u672C\u6587\u306E\u307F\u3092\u8FD4\u3057\u3066\u304F\u3060\u3055\u3044\u3002",
    "",
    `\u3010\u95A2\u9023\u30AD\u30FC\u30EF\u30FC\u30C9\u3011${keyword}`,
    "",
    "\u3010\u4FEE\u6B63\u5BFE\u8C61\u3011",
    issuesText,
    "",
    "\u3010\u5143\u8A18\u4E8B\u3011",
    originalContent
  ].join("\n");
  try {
    const response = await fetch("https://api.perplexity.ai/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: "system", content: "You edit Japanese articles to fix factual mistakes while preserving style." },
          { role: "user", content: prompt }
        ],
        temperature: 0.2
      })
    });
    if (!response.ok) throw new Error(`Perplexity API error: ${response.status}`);
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content ?? "";
    const cleaned = content.trim().replace(/^```[a-zA-Z]*\s*/, "").replace(/\s*```$/, "");
    return cleaned || null;
  } catch (error) {
    console.error("Auto-fix correction failed:", error);
    return null;
  }
}

// supabase/functions/scheduler-executor/index.ts
var corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey"
};
var parseBoolean = (value, fallback = false) => {
  if (value == null || value === "") return fallback;
  const normalized = String(value).trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
};
var parseNumber = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};
var SCHEDULE_EXECUTION_LOCK_TTL_SECONDS = 20 * 60;
var FALLBACK_SCHEDULE_ROW_LOCK_WINDOW_SECONDS = 8 * 60;
var AI_REQUEST_TIMEOUT_MS = 180 * 1e3;
var STALE_RUNNING_EXECUTION_MINUTES = 12;
var warnedMissingSchedulerLockRpc = false;
var warnedUsingFallbackScheduleRowLock = false;
var warnedSchedulerLockUnavailable = false;
var AiOutputTruncatedError = class extends Error {
  partialText;
  constructor(message, partialText) {
    super(message);
    this.name = "AiOutputTruncatedError";
    this.partialText = partialText;
  }
};
async function fetchWithTimeout(url, init, timeoutMs = AI_REQUEST_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error(`AI\u5FDC\u7B54\u304C${Math.round(timeoutMs / 1e3)}\u79D2\u4EE5\u5185\u306B\u5B8C\u4E86\u3057\u307E\u305B\u3093\u3067\u3057\u305F\u3002`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
var KeywordExhaustedError = class extends Error {
  constructor(message) {
    super(message);
    this.name = "KeywordExhaustedError";
  }
};
function isKeywordExhaustedError(error) {
  return error instanceof KeywordExhaustedError || typeof error === "object" && error !== null && error.name === "KeywordExhaustedError";
}
function parseJstDate(input) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input)) return null;
  const [y, m, d] = input.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d, 0, 0, 0));
  return Number.isNaN(date.getTime()) ? null : date;
}
function getCurrentJstDate(now = /* @__PURE__ */ new Date()) {
  const jstString = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);
  return parseJstDate(jstString) ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}
function isWithinScheduleDateRange(schedule, now = /* @__PURE__ */ new Date()) {
  const currentJstDate = getCurrentJstDate(now);
  const start = schedule.start_date ? parseJstDate(schedule.start_date) : null;
  const end = schedule.end_date ? parseJstDate(schedule.end_date) : null;
  if (start && currentJstDate < start) return false;
  if (end && currentJstDate > end) return false;
  return true;
}
var INVALID_GEMINI_MODELS = /* @__PURE__ */ new Set([
  "gemini-1.0-pro",
  "gemini-1.5-pro-latest",
  "gemini-3.0-pro",
  "gemini-3.0-flash"
]);
function normalizeAiConfig(config) {
  const provider = String(config.provider || "").toLowerCase();
  if (provider !== "gemini") return config;
  if (!INVALID_GEMINI_MODELS.has(String(config.model || ""))) return config;
  return { ...config, model: "gemini-2.5-flash" };
}
function resolveWritingTone(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "casual" || normalized === "friendly" || normalized === "desu_masu") {
    return "casual";
  }
  if (normalized === "professional" || normalized === "technical" || normalized === "da_dearu") {
    return "professional";
  }
  return "professional";
}
function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}
function truncateForStyleReference(value, minLength = 500, maxLength = 800) {
  const text = normalizeWhitespace(value);
  if (!text) return "";
  if (text.length <= maxLength) return text;
  const candidate = text.slice(0, maxLength);
  const boundary = Math.max(
    candidate.lastIndexOf("\u3002"),
    candidate.lastIndexOf("\uFF01"),
    candidate.lastIndexOf("\uFF1F"),
    candidate.lastIndexOf(". ")
  );
  if (boundary >= minLength) {
    return candidate.slice(0, boundary + 1).trim();
  }
  return candidate.trim();
}
async function fetchStyleReferenceSample(styleReferenceUrl) {
  const url = String(styleReferenceUrl || "").trim();
  if (!url) return "";
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8e3);
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; AutomaticWriter/1.0; +https://example.com/bot)"
      },
      signal: controller.signal
    });
    clearTimeout(timer);
    if (!response.ok) {
      throw new Error(`style reference fetch failed: ${response.status}`);
    }
    const html = await response.text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    if (!doc) return "";
    const removeTargets = doc.querySelectorAll("script, style, nav, footer, header, noscript, aside, form");
    removeTargets.forEach((node) => node.remove());
    const mainNode = doc.querySelector("article") || doc.querySelector("main") || doc.querySelector('[role="main"]') || doc.body;
    const paragraphNodes = mainNode?.querySelectorAll("p") || [];
    let text = Array.from(paragraphNodes).map((node) => normalizeWhitespace(node.textContent)).filter((line) => line.length >= 20).join(" ");
    if (!text) {
      text = normalizeWhitespace(mainNode?.textContent || "");
    }
    return truncateForStyleReference(text);
  } catch (error) {
    console.warn("Failed to fetch style reference sample:", error);
    return "";
  }
}
function buildStyleReferenceInstructions(sample, styleReferenceUrl) {
  const normalizedSample = truncateForStyleReference(sample);
  if (!normalizedSample) return "";
  const sourceLine = styleReferenceUrl ? `Reference URL: ${styleReferenceUrl}` : "";
  return [
    "Use the following writing style sample only as a tone and structure reference. Do not copy facts or wording from it.",
    sourceLine,
    "Style sample:",
    normalizedSample
  ].filter(Boolean).join("\n");
}
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(supabaseUrl, supabaseKey);
    const body = await req.text();
    console.log("Raw request body:", body);
    const params = body ? JSON.parse(body) : {};
    console.log("Parsed params:", params);
    const forceExecute = params.forceExecute === true;
    const targetScheduleId = params.scheduleId;
    const allowDuplicateForce = params.allowDuplicateForce === true;
    if (params.action === "clear_execution_state" && targetScheduleId) {
      const result = await clearScheduleExecutionState(supabase, targetScheduleId);
      return new Response(
        JSON.stringify({ success: true, action: "clear_execution_state", ...result }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
    const processSchedules = async () => {
      const schedulerStartTime = Date.now();
      console.log("Scheduler execution started:", new Date(schedulerStartTime).toISOString());
      await markStaleRunningExecutionsFailed(supabase);
      const stats = {
        totalActive: 0,
        considered: 0,
        executed: 0,
        skipped: 0,
        failed: 0
      };
      if (forceExecute) {
        console.log(`FORCE EXECUTE MODE: Ignoring time checks (Target: ${targetScheduleId || "ALL"})`);
      }
      const { data: aiConfigs, error: aiError } = await supabase.from("ai_configs").select("*").order("is_active", { ascending: false }).order("created_at", { ascending: false });
      if (aiError || !aiConfigs || aiConfigs.length === 0) {
        console.error("No AI config found:", aiError);
        return stats;
      }
      const normalizedAiConfigs = aiConfigs.map((config) => normalizeAiConfig(config));
      const activeAiConfig = normalizedAiConfigs.find((config) => config.is_active) || normalizedAiConfigs[0];
      const aiConfigMap = new Map(normalizedAiConfigs.map((config) => [config.id, config]));
      console.log("Default active AI config:", activeAiConfig.provider, activeAiConfig.model);
      let chatworkApiToken = null;
      let serpApiKey = null;
      let googleApiKey = null;
      let searchEngineId = null;
      let imageCostUsdPerImage = 0.04;
      let maxPostsPerSitePerRun = 1;
      let maxTotalPostsPerRun = 1;
      const { data: appSettings, error: appSettingsError } = await supabase.from("app_settings").select("key, value").in("key", [
        "chatwork_api_token",
        "serpapi_key",
        "google_custom_search_api_key",
        "google_custom_search_engine_id",
        "image_cost_usd_per_image",
        "scheduler_max_posts_per_run",
        "scheduler_max_total_posts_per_run"
      ]);
      if (appSettingsError) {
        console.error("Error fetching app_settings:", appSettingsError);
      }
      console.log("App settings fetched:", JSON.stringify(appSettings));
      if (appSettings) {
        appSettings.forEach((setting) => {
          if (setting.key === "chatwork_api_token") chatworkApiToken = setting.value;
          if (setting.key === "serpapi_key") serpApiKey = setting.value;
          if (setting.key === "google_custom_search_api_key") googleApiKey = setting.value;
          if (setting.key === "google_custom_search_engine_id") searchEngineId = setting.value;
          if (setting.key === "image_cost_usd_per_image") {
            const n = Number(setting.value);
            if (Number.isFinite(n) && n >= 0) imageCostUsdPerImage = n;
          }
          if (setting.key === "scheduler_max_posts_per_run") {
            const n = Number(setting.value);
            if (Number.isFinite(n) && n > 0) {
              maxPostsPerSitePerRun = Math.floor(n);
            }
          }
          if (setting.key === "scheduler_max_total_posts_per_run") {
            const n = Number(setting.value);
            if (Number.isFinite(n) && n > 0) {
              maxTotalPostsPerRun = Math.floor(n);
            }
          }
        });
      }
      console.log("Key values - SerpAPI:", serpApiKey ? "Found(hidden)" : "Not Found", "Google:", googleApiKey ? "Found(hidden)" : "Not Found");
      let { data: schedules, error: schedError } = await supabase.from("schedule_settings").select(`*, wordpress_configs!inner(*)`);
      if (schedError) {
        console.error("Database query failed:", schedError);
        return stats;
      }
      schedules = (schedules || []).filter((s) => {
        if (forceExecute && targetScheduleId && s.id === targetScheduleId) return true;
        return s.status === true || s.is_active === true;
      });
      if (forceExecute && targetScheduleId) {
        schedules = schedules.filter((s) => s.id === targetScheduleId);
      }
      if (!schedules || schedules.length === 0) {
        console.log("No active schedules found");
        return stats;
      }
      stats.totalActive = schedules.length;
      console.log(`Found ${schedules.length} active schedules`);
      const now = /* @__PURE__ */ new Date();
      const jstFormatter = new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      });
      const currentTimeJST = jstFormatter.format(now);
      const currentDateTimeJST = new Intl.DateTimeFormat("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false
      }).format(now);
      console.log(`Current JST datetime: ${currentDateTimeJST} (time-check=${currentTimeJST})`);
      const executedWpConfigIds = /* @__PURE__ */ new Set();
      for (const schedule of schedules) {
        stats.considered += 1;
        const scheduleSetting = schedule;
        const wpConfig = schedule.wordpress_configs;
        const scheduleAccountId = scheduleSetting.account_id || wpConfig.account_id;
        const timeToUse = scheduleSetting.post_time;
        if (!forceExecute && executedWpConfigIds.has(wpConfig.id)) {
          stats.skipped += 1;
          console.log(`Skipping schedule ${scheduleSetting.id}: already executed for site ${wpConfig.id} in this run`);
          continue;
        }
        if (!forceExecute && maxPostsPerSitePerRun > 0) {
          const siteThrottleMinutes = 1;
          const recentExecutionCount = await countExecutionsForWpConfigWithinMinutes(
            supabase,
            wpConfig.id,
            siteThrottleMinutes
          );
          if (recentExecutionCount >= maxPostsPerSitePerRun) {
            stats.skipped += 1;
            console.log(
              `Skipping schedule ${scheduleSetting.id}: site throttle active for ${wpConfig.id} (executions in last ${siteThrottleMinutes} min: ${recentExecutionCount}, limit per site: ${maxPostsPerSitePerRun})`
            );
            continue;
          }
        }
        if (!forceExecute && !isWithinScheduleDateRange(scheduleSetting)) {
          stats.skipped += 1;
          console.log(
            `Skipping schedule ${scheduleSetting.id}: outside configured date range (start=${scheduleSetting.start_date ?? "-"}, end=${scheduleSetting.end_date ?? "-"})`
          );
          continue;
        }
        let shouldExecute = forceExecute || await shouldExecuteNow(timeToUse, currentTimeJST, scheduleSetting.frequency, scheduleSetting.id, supabase);
        const bypassExecutionLock = forceExecute && allowDuplicateForce;
        if (forceExecute && shouldExecute && !allowDuplicateForce) {
          const recentlyExecuted = await wasExecutedWithinMinutes(scheduleSetting.id, supabase, 1);
          if (recentlyExecuted) {
            shouldExecute = false;
            console.log(`Skipping force execution for ${wpConfig.name}: executed within last 1 minute`);
          }
        }
        if (shouldExecute) {
          if (!forceExecute && stats.executed >= maxTotalPostsPerRun) {
            stats.skipped += 1;
            console.log(
              `Skipping schedule ${scheduleSetting.id}: max total posts per run reached (${maxTotalPostsPerRun})`
            );
            continue;
          }
          let acquiredExecutionLock = null;
          if (!bypassExecutionLock) {
            const lockAcquired = await acquireScheduleExecutionLock(
              supabase,
              scheduleSetting.id,
              wpConfig.id,
              SCHEDULE_EXECUTION_LOCK_TTL_SECONDS
            );
            if (!lockAcquired.acquired) {
              stats.skipped += 1;
              console.log(`Skipping schedule ${scheduleSetting.id}: execution lock is active`);
              if (forceExecute) {
                await recordForceExecutionSkippedByLock(supabase, scheduleSetting, wpConfig);
              }
              continue;
            }
            acquiredExecutionLock = lockAcquired;
            if (!forceExecute) {
              const shouldExecuteAfterLock = await shouldExecuteNow(
                timeToUse,
                currentTimeJST,
                scheduleSetting.frequency,
                scheduleSetting.id,
                supabase
              );
              if (!shouldExecuteAfterLock) {
                stats.skipped += 1;
                console.log(`Skipping schedule ${scheduleSetting.id}: no longer eligible after lock acquisition`);
                await releaseScheduleExecutionLock(
                  supabase,
                  acquiredExecutionLock.scheduleId,
                  acquiredExecutionLock.wpConfigId,
                  acquiredExecutionLock.lockToken
                );
                continue;
              }
            }
          }
          console.log(`Executing schedule for ${wpConfig.name}`);
          const accountAiConfigs = normalizedAiConfigs.filter((config) => {
            if (!scheduleAccountId) return true;
            return config.account_id === scheduleAccountId;
          });
          const accountActiveAiConfig = accountAiConfigs.find((config) => config.is_active) || accountAiConfigs[0];
          if (!accountActiveAiConfig) {
            stats.failed += 1;
            console.error(`No AI config found for account ${scheduleAccountId || "unknown"} schedule ${scheduleSetting.id}`);
            if (acquiredExecutionLock) {
              await releaseScheduleExecutionLock(
                supabase,
                acquiredExecutionLock.scheduleId,
                acquiredExecutionLock.wpConfigId,
                acquiredExecutionLock.lockToken
              );
            }
            continue;
          }
          let accountChatworkApiToken = chatworkApiToken;
          let accountSerpApiKey = serpApiKey;
          let accountGoogleApiKey = googleApiKey;
          let accountSearchEngineId = searchEngineId;
          let accountImageCostUsdPerImage = imageCostUsdPerImage;
          let accountImageGenerationAllowed = true;
          if (scheduleAccountId) {
            const { data: accountAppSettings, error: accountAppSettingsError } = await supabase.from("app_settings").select("key, value").eq("account_id", scheduleAccountId).in("key", [
              "chatwork_api_token",
              "serpapi_key",
              "google_custom_search_api_key",
              "google_custom_search_engine_id",
              "image_cost_usd_per_image"
            ]);
            if (accountAppSettingsError) {
              console.error(`Error fetching app_settings for account ${scheduleAccountId}:`, accountAppSettingsError);
            }
            (accountAppSettings || []).forEach((setting) => {
              if (setting.key === "chatwork_api_token") accountChatworkApiToken = setting.value;
              if (setting.key === "serpapi_key") accountSerpApiKey = setting.value;
              if (setting.key === "google_custom_search_api_key") accountGoogleApiKey = setting.value;
              if (setting.key === "google_custom_search_engine_id") accountSearchEngineId = setting.value;
              if (setting.key === "image_cost_usd_per_image") {
                const n = Number(setting.value);
                if (Number.isFinite(n) && n >= 0) accountImageCostUsdPerImage = n;
              }
            });
            const { data: accountRow, error: accountError } = await supabase.from("accounts").select("feature_flags").eq("id", scheduleAccountId).maybeSingle();
            if (accountError) {
              console.error(`Error fetching account feature_flags for account ${scheduleAccountId}:`, accountError);
            }
            accountImageGenerationAllowed = accountRow?.feature_flags?.image_generation !== false;
          }
          const requestedAiConfigId = scheduleSetting.ai_config_id;
          const requestedAiConfig = requestedAiConfigId ? accountAiConfigs.find((config) => config.id === requestedAiConfigId) || null : null;
          const baseAiConfig = requestedAiConfig || accountActiveAiConfig;
          const overrideProvider = String(scheduleSetting.ai_provider_override || "").trim().toLowerCase();
          const overrideModel = String(scheduleSetting.ai_model_override || "").trim();
          let effectiveAiConfig = baseAiConfig;
          if (requestedAiConfig) {
            console.log(
              `Using schedule AI config: ${baseAiConfig.provider} (${baseAiConfig.model}) [${baseAiConfig.id}]`
            );
          } else if (requestedAiConfigId) {
            console.warn(
              `Schedule AI config not found (${requestedAiConfigId}). Falling back to active config ${accountActiveAiConfig.id}`
            );
          } else {
            console.log(`No schedule AI config specified. Using active config ${accountActiveAiConfig.id}`);
          }
          if (overrideProvider && !overrideModel || !overrideProvider && overrideModel) {
            console.warn(`Ignoring incomplete AI override for schedule ${scheduleSetting.id}: provider="${overrideProvider}" model="${overrideModel}"`);
          } else if (overrideProvider && overrideModel) {
            effectiveAiConfig = normalizeAiConfig({
              ...baseAiConfig,
              provider: overrideProvider,
              model: overrideModel
            });
            console.log(
              `Applying schedule model override: ${effectiveAiConfig.provider} (${effectiveAiConfig.model}) [auth from ${baseAiConfig.id}]`
            );
          }
          try {
            const effectiveScheduleSetting = accountImageGenerationAllowed ? scheduleSetting : {
              ...scheduleSetting,
              image_generation_enabled: false,
              images_per_article: 0
            };
            await executeSchedule(
              effectiveScheduleSetting,
              wpConfig,
              effectiveAiConfig,
              supabase,
              accountChatworkApiToken,
              accountSerpApiKey,
              accountGoogleApiKey,
              accountSearchEngineId,
              accountImageCostUsdPerImage,
              schedulerStartTime,
              forceExecute ? "manual" : "automatic"
            );
            stats.executed += 1;
            executedWpConfigIds.add(wpConfig.id);
          } catch (error) {
            if (isKeywordExhaustedError(error)) {
              console.log(`Skipping schedule ${scheduleSetting.id}: ${error.message}`);
              stats.skipped += 1;
            } else {
              console.error(`Failed to execute schedule for ${wpConfig.name}:`, error);
              await recordScheduleExecutionFailure(
                supabase,
                scheduleSetting,
                wpConfig,
                effectiveAiConfig,
                error,
                forceExecute ? "manual" : "automatic"
              );
              await notifyScheduleExecutionFailure(
                scheduleSetting,
                wpConfig,
                accountChatworkApiToken,
                error
              );
              stats.failed += 1;
            }
          } finally {
            if (acquiredExecutionLock) {
              await releaseScheduleExecutionLock(
                supabase,
                acquiredExecutionLock.scheduleId,
                acquiredExecutionLock.wpConfigId,
                acquiredExecutionLock.lockToken
              );
            }
          }
        } else {
          stats.skipped += 1;
        }
      }
      return stats;
    };
    if (forceExecute) {
      console.log("Starting background execution for Force Run");
      const processPromise = processSchedules().catch((err) => {
        console.error("Background processing error:", err);
      });
      EdgeRuntime.waitUntil(processPromise);
      return new Response(
        JSON.stringify({
          success: true,
          mode: "background",
          message: "Request accepted. Processing started in background. Please check Execution History for results.",
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        }),
        { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    } else {
      console.log("Starting foreground execution for scheduled run");
      const stats = await processSchedules();
      return new Response(
        JSON.stringify({
          success: true,
          mode: "foreground",
          message: "Scheduled processing completed.",
          stats,
          timestamp: (/* @__PURE__ */ new Date()).toISOString()
        }),
        { status: 202, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }
  } catch (error) {
    console.error("Scheduler handler error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
function isMissingSchedulerLockRpc(error) {
  const errorText = [
    String(error?.message || ""),
    String(error?.details || ""),
    String(error?.hint || "")
  ].join(" ").toLowerCase();
  return errorText.includes("could not find the function") || errorText.includes("function") && errorText.includes("does not exist");
}
async function acquireScheduleExecutionLock(supabase, scheduleId, wpConfigId, lockSeconds = SCHEDULE_EXECUTION_LOCK_TTL_SECONDS) {
  const notAcquired = {
    acquired: false,
    scheduleId,
    wpConfigId,
    lockToken: null
  };
  const { data, error } = await supabase.rpc("acquire_scheduler_execution_lock", {
    p_schedule_id: scheduleId,
    p_wp_config_id: wpConfigId,
    p_lock_seconds: lockSeconds
  });
  if (error) {
    if (isMissingSchedulerLockRpc(error)) {
      if (!warnedMissingSchedulerLockRpc) {
        console.warn(
          'Scheduler lock RPC "acquire_scheduler_execution_lock" is not available. Apply latest Supabase migration to enable duplicate-run protection.'
        );
        warnedMissingSchedulerLockRpc = true;
      }
    } else {
      console.error(`Failed to acquire scheduler execution lock for ${scheduleId}:`, error);
    }
    const fallbackAcquired = await acquireScheduleExecutionLockWithScheduleRow(
      supabase,
      scheduleId,
      lockSeconds
    );
    if (fallbackAcquired !== null) {
      if (!warnedUsingFallbackScheduleRowLock) {
        console.warn(
          "Using fallback schedule row lock (schedule_settings.updated_at). Please apply latest Supabase migration for robust lock RPC support."
        );
        warnedUsingFallbackScheduleRowLock = true;
      }
      return {
        acquired: fallbackAcquired,
        scheduleId,
        wpConfigId,
        lockToken: null
      };
    }
    if (!warnedSchedulerLockUnavailable) {
      console.warn(
        "Scheduler execution lock is unavailable (RPC + fallback both failed). Proceeding without lock \u906F\uFF76\u7E5D\uFF7Bapply latest migration to enable duplicate-run protection."
      );
      warnedSchedulerLockUnavailable = true;
    }
    return {
      acquired: true,
      scheduleId,
      wpConfigId,
      lockToken: null
    };
  }
  const lockRow = Array.isArray(data) ? data[0] : data;
  const acquired = lockRow?.acquired === true;
  if (!acquired) return notAcquired;
  console.log(
    `Schedule lock acquired for ${scheduleId} (until ${lockRow?.locked_until || "unknown"})`
  );
  return {
    acquired: true,
    scheduleId,
    wpConfigId,
    lockToken: lockRow?.lock_token || null
  };
}
async function releaseScheduleExecutionLock(supabase, scheduleId, wpConfigId, lockToken) {
  try {
    if (lockToken) {
      const rpcResult = await supabase.rpc("release_scheduler_execution_lock", {
        p_schedule_id: scheduleId,
        p_wp_config_id: wpConfigId,
        p_lock_token: lockToken
      });
      if (!rpcResult.error) {
        console.log(`Schedule lock released for ${scheduleId}`);
        return;
      }
      if (!isMissingSchedulerLockRpc(rpcResult.error)) {
        console.warn(`Failed to release scheduler execution lock via RPC for ${scheduleId}:`, rpcResult.error);
      }
    }
    let deleteQuery = supabase.from("scheduler_execution_locks").delete().eq("schedule_id", scheduleId).eq("wp_config_id", wpConfigId);
    if (lockToken) {
      deleteQuery = deleteQuery.eq("lock_token", lockToken);
    }
    const { error } = await deleteQuery;
    if (error) {
      console.warn(`Failed to release scheduler execution lock row for ${scheduleId}:`, error);
      return;
    }
    console.log(`Schedule lock row released for ${scheduleId}`);
  } catch (error) {
    console.warn(`Unexpected error releasing scheduler execution lock for ${scheduleId}:`, error);
  }
}
function isMissingUpdatedAtColumn(error) {
  const errorText = [
    String(error?.message || ""),
    String(error?.details || ""),
    String(error?.hint || "")
  ].join(" ").toLowerCase();
  return errorText.includes("updated_at") && errorText.includes("does not exist");
}
function isMissingColumnError(error, columnName) {
  if (!error) return false;
  const errorText = [
    String(error?.message || ""),
    String(error?.details || ""),
    String(error?.hint || "")
  ].join(" ").toLowerCase();
  const normalizedColumn = columnName.toLowerCase();
  return errorText.includes(normalizedColumn) && (errorText.includes("does not exist") || errorText.includes("schema cache") || errorText.includes("could not find"));
}
async function createExecutionProgressHistory(supabase, params) {
  const payload = {
    account_id: params.schedule.account_id || params.wpConfig.account_id || null,
    schedule_id: params.schedule.id,
    wordpress_config_id: params.wpConfig.id,
    executed_at: (/* @__PURE__ */ new Date()).toISOString(),
    keyword_used: params.keyword,
    article_title: params.title || "",
    wordpress_post_id: "",
    status: "running",
    error_message: null,
    cost_breakdown: {
      trigger_type: params.triggerType,
      generation_debug: {
        current_stage: params.stage,
        progress_message: params.message,
        progress_percent: params.progress,
        provider: params.aiConfig.provider || "",
        model: params.aiConfig.model || "",
        started_at: (/* @__PURE__ */ new Date()).toISOString()
      }
    },
    estimated_cost_usd: 0
  };
  let result = await supabase.from("execution_history").insert(payload).select("id").single();
  if (isMissingColumnError(result.error, "account_id")) {
    delete payload.account_id;
    result = await supabase.from("execution_history").insert(payload).select("id").single();
  }
  if (result.error) {
    console.error("Failed to create execution progress history:", result.error);
    return null;
  }
  return result.data?.id || null;
}
async function updateExecutionProgressHistory(supabase, historyId, params) {
  if (!historyId) return;
  const generationDebug = {
    ...params.debug || {},
    current_stage: params.stage,
    progress_message: params.message,
    progress_percent: params.progress,
    updated_at: (/* @__PURE__ */ new Date()).toISOString()
  };
  const updatePayload = {
    status: "running",
    cost_breakdown: {
      generation_debug: generationDebug
    }
  };
  if (params.title !== void 0) {
    updatePayload.article_title = params.title;
  }
  const { error } = await supabase.from("execution_history").update(updatePayload).eq("id", historyId);
  if (error) {
    console.error("Failed to update execution progress history:", error);
  }
}
async function acquireScheduleExecutionLockWithScheduleRow(supabase, scheduleId, lockSeconds = SCHEDULE_EXECUTION_LOCK_TTL_SECONDS) {
  const lockWindowSeconds = Math.max(
    60,
    Math.min(lockSeconds, FALLBACK_SCHEDULE_ROW_LOCK_WINDOW_SECONDS)
  );
  const nowIso = (/* @__PURE__ */ new Date()).toISOString();
  const thresholdIso = new Date(Date.now() - lockWindowSeconds * 1e3).toISOString();
  const thresholdAttempt = await supabase.from("schedule_settings").update({ updated_at: nowIso }).eq("id", scheduleId).lte("updated_at", thresholdIso).select("id").limit(1);
  if (thresholdAttempt.error) {
    if (isMissingUpdatedAtColumn(thresholdAttempt.error)) {
      return null;
    }
    console.error(`Fallback lock acquisition failed for ${scheduleId} (threshold):`, thresholdAttempt.error);
    return null;
  }
  const thresholdData = Array.isArray(thresholdAttempt.data) ? thresholdAttempt.data : [];
  if (thresholdData.length > 0) {
    console.log(`Fallback schedule row lock acquired for ${scheduleId} (window=${lockWindowSeconds}s)`);
    return true;
  }
  const nullAttempt = await supabase.from("schedule_settings").update({ updated_at: nowIso }).eq("id", scheduleId).is("updated_at", null).select("id").limit(1);
  if (nullAttempt.error) {
    if (isMissingUpdatedAtColumn(nullAttempt.error)) {
      return null;
    }
    console.error(`Fallback lock acquisition failed for ${scheduleId} (null check):`, nullAttempt.error);
    return null;
  }
  const nullData = Array.isArray(nullAttempt.data) ? nullAttempt.data : [];
  if (nullData.length > 0) {
    console.log(`Fallback schedule row lock acquired for ${scheduleId} (window=${lockWindowSeconds}s, null->set)`);
    return true;
  }
  return false;
}
async function shouldExecuteNow(scheduleTime, currentTime, frequency, scheduleId, supabase) {
  const [scheduleHour, scheduleMinute] = scheduleTime.split(":").map(Number);
  const [currentHour, currentMinute] = currentTime.split(":").map(Number);
  const scheduleMinutes = scheduleHour * 60 + scheduleMinute;
  const currentMinutes = currentHour * 60 + currentMinute;
  const diff = currentMinutes - scheduleMinutes;
  if (diff < 0 || diff > 5) {
    return false;
  }
  const lastExecution = await getLastAutomaticExecutionForCadence(
    supabase,
    scheduleId,
    scheduleTime
  );
  if (!lastExecution) {
    return true;
  }
  const lastExecutedAt = new Date(lastExecution.executed_at);
  const now = /* @__PURE__ */ new Date();
  const hoursSinceLastExecution = (now.getTime() - lastExecutedAt.getTime()) / (1e3 * 60 * 60);
  const freqMap = {
    "\u6BCE\u65E5": "daily",
    "\u6BCE\u9031": "weekly",
    "\u9694\u9031": "biweekly",
    "\u6BCE\u6708": "monthly"
  };
  const normalizedFreq = freqMap[frequency] || frequency;
  const jstDateFormatter = new Intl.DateTimeFormat("ja-JP", { timeZone: "Asia/Tokyo", year: "numeric", month: "2-digit", day: "2-digit" });
  const lastExecutedDate = jstDateFormatter.format(lastExecutedAt);
  const currentDate = jstDateFormatter.format(now);
  console.log(`[Freq Check] ${normalizedFreq}, Hours since: ${hoursSinceLastExecution.toFixed(1)}, Last day: ${lastExecutedDate}, Today: ${currentDate}`);
  if (normalizedFreq === "daily") {
    if (lastExecutedDate !== currentDate) {
      return true;
    }
  } else if (normalizedFreq === "weekly" && hoursSinceLastExecution >= 24 * 6) {
    return true;
  } else if (normalizedFreq === "biweekly" && hoursSinceLastExecution >= 24 * 12) {
    return true;
  } else if (normalizedFreq === "monthly" && hoursSinceLastExecution >= 24 * 27) {
    return true;
  }
  return false;
}
function getJstMinutesOfDay(date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return hour * 60 + minute;
}
function isExecutionNearScheduleTime(executedAt, scheduleTime) {
  const [scheduleHour, scheduleMinute] = String(scheduleTime || "").split(":").map(Number);
  if (!Number.isFinite(scheduleHour) || !Number.isFinite(scheduleMinute)) return false;
  const executedMinutes = getJstMinutesOfDay(new Date(executedAt));
  if (executedMinutes == null) return false;
  const scheduleMinutes = scheduleHour * 60 + scheduleMinute;
  const diff = executedMinutes - scheduleMinutes;
  return diff >= 0 && diff <= 5;
}
function isAutomaticExecutionForCadence(row, scheduleTime) {
  const triggerType = row?.cost_breakdown?.trigger_type;
  if (triggerType === "manual") return false;
  if (triggerType === "automatic") return true;
  return isExecutionNearScheduleTime(row?.executed_at, scheduleTime);
}
async function getLastAutomaticExecutionForCadence(supabase, scheduleId, scheduleTime) {
  const { data, error } = await supabase.from("execution_history").select("executed_at,status,cost_breakdown").eq("schedule_id", scheduleId).eq("status", "success").order("executed_at", { ascending: false }).limit(20);
  if (error) {
    console.warn(`Could not fetch automatic execution history for ${scheduleId}:`, error);
    return null;
  }
  const rows = Array.isArray(data) ? data : [];
  return rows.find((row) => isAutomaticExecutionForCadence(row, scheduleTime)) || null;
}
async function wasExecutedWithinMinutes(scheduleId, supabase, minutes) {
  const { data: lastExecution } = await supabase.from("execution_history").select("executed_at").eq("schedule_id", scheduleId).in("status", ["running", "success"]).order("executed_at", { ascending: false }).limit(1).maybeSingle();
  if (!lastExecution?.executed_at) return false;
  const last = new Date(lastExecution.executed_at);
  const now = /* @__PURE__ */ new Date();
  const diffMinutes = (now.getTime() - last.getTime()) / (1e3 * 60);
  return diffMinutes >= 0 && diffMinutes < minutes;
}
async function countExecutionsForWpConfigWithinMinutes(supabase, wpConfigId, minutes) {
  const since = new Date(Date.now() - minutes * 60 * 1e3).toISOString();
  const { count, error } = await supabase.from("execution_history").select("id", { count: "exact", head: true }).eq("wordpress_config_id", wpConfigId).in("status", ["running", "success"]).gte("executed_at", since);
  if (error) {
    console.error(`Failed to count recent executions for wp_config ${wpConfigId}:`, error);
    return 0;
  }
  return count ?? 0;
}
function resolveAiModelRate(provider, model) {
  const p = String(provider || "").toLowerCase();
  const m = String(model || "").toLowerCase();
  if (p === "openai") {
    if (m.includes("gpt-5") && m.includes("mini")) return { input: 0.3, output: 2.5 };
    if (m.includes("gpt-5")) return { input: 1.25, output: 10 };
    if (m.includes("gpt-4o-mini")) return { input: 0.15, output: 0.6 };
    if (m.includes("gpt-4o")) return { input: 5, output: 15 };
    return { input: 0.3, output: 2.5 };
  }
  if (p === "gemini") {
    if (m.includes("2.5-pro")) return { input: 1.25, output: 10 };
    if (m.includes("2.5-flash")) return { input: 0.3, output: 2.5 };
    return { input: 0.3, output: 2.5 };
  }
  if (p === "claude") {
    if (m.includes("opus")) return { input: 15, output: 75 };
    if (m.includes("haiku")) return { input: 0.8, output: 4 };
    return { input: 3, output: 15 };
  }
  return { input: 1, output: 5 };
}
function estimateExecutionCostBreakdown(params) {
  const rate = resolveAiModelRate(params.provider, params.model);
  const generationMultiplier = 1;
  const inputTokens = Math.ceil(params.generatedChars / 1e3 * 300 * generationMultiplier);
  const outputTokens = Math.ceil(params.generatedChars / 1e3 * 700 * generationMultiplier);
  const aiCostUsd = inputTokens / 1e6 * rate.input + outputTokens / 1e6 * rate.output;
  const researchCostUsd = params.competitorResearchUsed ? 5e-3 : 0;
  const factCheckCostUsd = null;
  const imageCostUsd = params.imagesGenerated > 0 ? params.imagesGenerated * Math.max(0, params.imageUnitCostUsd) : 0;
  const totalEstimatedUsd = aiCostUsd + researchCostUsd + imageCostUsd;
  return {
    ai: {
      provider: params.provider,
      model: params.model,
      tokens: {
        input_estimated: inputTokens,
        output_estimated: outputTokens
      },
      rate_usd_per_1m_tokens: rate,
      estimated_usd: Number(aiCostUsd.toFixed(6))
    },
    research: {
      serpapi_used: params.competitorResearchUsed,
      estimated_usd: Number(researchCostUsd.toFixed(6))
    },
    fact_check: {
      items_checked: params.factCheckItemsChecked,
      estimated_usd: factCheckCostUsd
    },
    images: {
      generated_count_estimated: params.imagesGenerated,
      unit_cost_usd: Number(params.imageUnitCostUsd.toFixed(6)),
      estimated_usd: Number(imageCostUsd.toFixed(6))
    },
    assumptions: {
      char_to_token: "1000 chars ~= input 300 + output 700 tokens",
      excludes_unknown_services: ["fact_check"],
      includes: ["ai_generation", "serpapi", "image_generation"],
      image_price_source: "app_settings.image_cost_usd_per_image"
    },
    total_estimated_usd: Number(totalEstimatedUsd.toFixed(6))
  };
}
async function callAI(prompt, aiConfig, maxTokens) {
  const provider = String(aiConfig.provider || "").toLowerCase();
  const model = aiConfig.model;
  const apiKey = aiConfig.api_key;
  const temperature = aiConfig.temperature ?? 0.7;
  const resolvedMaxTokens = maxTokens ?? aiConfig.max_tokens ?? 2e3;
  if (!apiKey) {
    throw new Error(`Missing API key for provider: ${provider}`);
  }
  if (provider === "openai") {
    const response = await fetchWithTimeout("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature,
        max_tokens: resolvedMaxTokens
      })
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error: ${response.status} - ${errorText}`);
    }
    const data = await response.json();
    const choice = data?.choices?.[0];
    if (choice?.finish_reason === "length") {
      throw new Error("OpenAI response was cut off because max_tokens was reached");
    }
    const content = choice?.message?.content;
    if (typeof content === "string") return content;
    if (Array.isArray(content)) {
      return content.map((part) => typeof part?.text === "string" ? part.text : "").join("\n").trim();
    }
    throw new Error("OpenAI API returned empty content");
  }
  if (provider === "claude") {
    const response = await fetchWithTimeout("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model,
        max_tokens: resolvedMaxTokens,
        temperature,
        messages: [{ role: "user", content: prompt }]
      })
    });
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude API error: ${response.status} - ${errorText}`);
    }
    const data = await response.json();
    if (data?.stop_reason === "max_tokens") {
      throw new Error("Claude response was cut off because max_tokens was reached");
    }
    const text = Array.isArray(data?.content) ? data.content.map((part) => typeof part?.text === "string" ? part.text : "").join("\n").trim() : "";
    if (!text) throw new Error("Claude API returned empty content");
    return text;
  }
  if (provider === "gemini") {
    const response = await fetchWithTimeout(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature,
            maxOutputTokens: resolvedMaxTokens
          }
        })
      }
    );
    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Gemini API error: ${response.status} - ${errorText}`);
    }
    const data = await response.json();
    const candidate = data?.candidates?.[0];
    const parts = candidate?.content?.parts;
    const text = Array.isArray(parts) ? parts.map((part) => typeof part?.text === "string" ? part.text : "").join("\n").trim() : "";
    if (candidate?.finishReason === "MAX_TOKENS") {
      if (text) {
        throw new AiOutputTruncatedError("Gemini\u306E\u51FA\u529B\u304CmaxOutputTokens\u4E0A\u9650\u3067\u9014\u4E2D\u7D42\u4E86\u3057\u307E\u3057\u305F\u3002", text);
      }
      throw new Error("Gemini\u306E\u51FA\u529B\u304CmaxOutputTokens\u4E0A\u9650\u3067\u9014\u4E2D\u7D42\u4E86\u3057\u307E\u3057\u305F\u3002");
    }
    if (!text) throw new Error("Gemini API returned empty content");
    return text;
  }
  throw new Error(`Unsupported AI provider: ${aiConfig.provider}`);
}
function extractRelatedKeywordsFromCompetitorData(competitorData, mainKeyword, limit = 5) {
  if (!competitorData?.articles || competitorData.articles.length === 0) return [];
  const wordFrequency = /* @__PURE__ */ new Map();
  const mainKeywordLower = mainKeyword.toLowerCase();
  for (const article of competitorData.articles) {
    const headings = article.headings || [];
    for (const heading of headings) {
      const words = heading.replace(/[邵ｲ闊個莉｣ﾂ蠕個髦ｪﾂ蠑ｱﾂ謫ｾ・ｼ闌ｨ・ｼ繝ｻ)\[\]]/g, " ").split(/[\s邵ｲﾂ,邵ｲ竏壹・]+/).map((w) => w.trim()).filter((w) => w.length >= 2 && w.length <= 20);
      for (const word of words) {
        if (word.toLowerCase() === mainKeywordLower) continue;
        wordFrequency.set(word, (wordFrequency.get(word) || 0) + 1);
      }
    }
    if (article.metaDescription) {
      const descWords = article.metaDescription.replace(/[。、！？「」『』（）()[\]【】,，.．:：;；/]/g, " ").split(/\s+/).map((w) => w.trim()).filter((w) => w.length >= 2 && w.length <= 15);
      for (const word of descWords) {
        if (word.toLowerCase() === mainKeywordLower) continue;
        wordFrequency.set(word, (wordFrequency.get(word) || 0) + 1);
      }
    }
  }
  return Array.from(wordFrequency.entries()).filter(([, count]) => count >= 2).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([word]) => word);
}
function extractCompetitorHeadings(competitorData, limit = 15) {
  if (!competitorData?.articles || competitorData.articles.length === 0) return [];
  const headings = [];
  const seen = /* @__PURE__ */ new Set();
  for (const article of competitorData.articles) {
    const articleHeadings = Array.isArray(article?.headings) ? article.headings : [];
    for (const heading of articleHeadings) {
      const normalized = String(heading || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
      if (!normalized || normalized.length < 3 || normalized.length > 120) continue;
      const key = normalized.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      headings.push(normalized);
      if (headings.length >= limit) return headings;
    }
  }
  return headings;
}
async function fetchRelatedKeywordsViaCustomSearch(keyword, googleApiKey, searchEngineId) {
  try {
    const url = `https://www.googleapis.com/customsearch/v1?key=${googleApiKey}&cx=${searchEngineId}&q=${encodeURIComponent(keyword)}&gl=jp&hl=ja&num=5`;
    const res = await fetch(url);
    if (!res.ok) return [];
    const data = await res.json();
    const items = data.items || [];
    const keywords = /* @__PURE__ */ new Set();
    for (const item of items) {
      const text = `${item.title || ""} ${item.snippet || ""}`;
      const words = text.replace(/[邵ｲ闊個莉｣ﾂ蠕個髦ｪﾂ蠑ｱﾂ謫ｾ・ｼ闌ｨ・ｼ繝ｻ)\[\]邵ｲ繧・繝ｻ・ｼ繝ｻ・ｼ貅ｪﾂ・ｦ]/g, " ").split(/[\s邵ｲﾂ,]+/).map((w) => w.trim()).filter(
        (w) => w.length >= 2 && w.length <= 15 && w.toLowerCase() !== keyword.toLowerCase()
      );
      words.forEach((w) => keywords.add(w));
    }
    return Array.from(keywords).slice(0, 8);
  } catch (err) {
    console.warn("Google Custom Search keyword extraction failed:", err);
    return [];
  }
}
async function generateTitleWithAI(keyword, relatedKeywords, competitorTitles, aiConfig, competitorData) {
  const TITLE_MIN_LENGTH = 24;
  const TITLE_MAX_LENGTH = 68;
  const normalizeTitle2 = (raw) => {
    let cleaned = String(raw || "").trim().replace(/^Title:\s*/i, "").replace(/^["']|["']$/g, "");
    if (cleaned.startsWith("[") && cleaned.endsWith("]") || cleaned.startsWith("(") && cleaned.endsWith(")")) {
      cleaned = cleaned.slice(1, -1);
    }
    cleaned = cleaned.replace(/^[\[\(]+/, "");
    return cleaned.replace(/\s+/g, " ").trim();
  };
  const includesKeyword = (title, baseKeyword) => {
    const compactTitle = title.replace(/\s+/g, "");
    const compactKeyword = baseKeyword.replace(/\s+/g, "");
    if (compactKeyword && compactTitle.includes(compactKeyword)) return true;
    const keywordTokens = baseKeyword.split(/\s+/).map((t) => t.trim()).filter((t) => t.length >= 2);
    return keywordTokens.some((token) => compactTitle.includes(token));
  };
  const isGenericTitleOnly = (title, currentYear2) => {
    const normalized = title.replace(/\s+/g, "");
    const genericPattern = new RegExp("^(?:" + currentYear2 + "\u5E74)?(?:SEO\u5BFE\u7B56|\u8A18\u4E8B\u30BF\u30A4\u30C8\u30EB|\u30D6\u30ED\u30B0\u8A18\u4E8B)$");
    return genericPattern.test(normalized);
  };
  const isValidSeoTitle = (title, baseKeyword, currentYear2) => {
    const compactTitle = title.replace(/\s+/g, "");
    const compactKeyword = baseKeyword.replace(/\s+/g, "");
    const hasRedundantPattern = /(まとめまとめ|とはとは|方法方法)/.test(compactTitle);
    const repeatsWholeKeyword = compactKeyword.length >= 4 && compactTitle.includes(`${compactKeyword}\u90B5\uFF7A\u30FB\uFF6E${compactKeyword}`);
    if (!title) return false;
    if (title.length < TITLE_MIN_LENGTH || title.length > TITLE_MAX_LENGTH) return false;
    if (!includesKeyword(title, baseKeyword)) return false;
    if (isGenericTitleOnly(title, currentYear2)) return false;
    if (hasRedundantPattern || repeatsWholeKeyword) return false;
    if (/^(タイトル|記事タイトル|SEOタイトル)[:：]/.test(title)) return false;
    const hasFreshness = new RegExp(String(currentYear2)).test(title);
    const hasReaderValue = /(方法|ポイント|比較|解説|事例|手順|メリット|注意点|成功)/.test(title);
    if (!hasFreshness && !hasReaderValue) return false;
    return true;
  };
  const currentYear = (/* @__PURE__ */ new Date()).getFullYear();
  const competitorInputs = Array.isArray(competitorData?.articles) && competitorData.articles.length > 0 ? competitorData.articles.slice(0, 6).map((article) => ({
    title: String(article?.title || "").trim(),
    headings: Array.isArray(article?.headings) ? article.headings.slice(0, 6) : []
  })).filter((item) => item.title.length > 0) : competitorTitles.slice(0, 6).map((title) => ({ title: String(title || "").trim() })).filter((item) => item.title.length > 0);
  try {
    const suggestions = await generateTitleSuggestionsWithSharedCore({
      keyword,
      relatedKeywords,
      competitors: competitorInputs,
      count: 3,
      callAI: (prompt, maxTokens) => callAI(prompt, aiConfig, Math.max(600, maxTokens))
    });
    for (const candidate of suggestions) {
      const title = normalizeTitle2(candidate.title);
      if (!title) continue;
      if (isValidSeoTitle(title, keyword, currentYear)) {
        return title;
      }
      console.warn(`AI title rejected by validator: ${title}`);
    }
  } catch (err) {
    console.error("Shared title core failed:", err);
    throw new Error("AI title generation failed.");
  }
  throw new Error("AI title generation did not return a valid title.");
}
async function executeSchedule(schedule, wpConfig, aiConfig, supabase, chatworkApiToken, serpApiKey, googleApiKey, searchEngineId, imageCostUsdPerImage, schedulerStartTime, triggerType = "automatic") {
  let keyword = "";
  let fixedTitle = null;
  const mode = schedule.generation_mode || "keyword";
  const hasConfiguredKeyword = String(schedule.keyword || "").split(",").some((k) => k.trim());
  const shouldUseTitleSet = Boolean(
    schedule.title_set_id && (mode === "title" || mode === "both" || !hasConfiguredKeyword)
  );
  console.log(`Generation Mode: ${mode}`);
  if (shouldUseTitleSet && schedule.title_set_id) {
    const { data: titleSet } = await supabase.from("title_sets").select("titles").eq("id", schedule.title_set_id).maybeSingle();
    if (titleSet && titleSet.titles && titleSet.titles.length > 0) {
      const selectedTitle = await selectUnusedTitle(schedule.id, titleSet.titles, supabase);
      if (selectedTitle) {
        fixedTitle = selectedTitle;
        keyword = selectedTitle;
        console.log(`Title selected: ${fixedTitle}`);
      } else {
        throw new Error("All titles in this title set have already been used.");
      }
    } else {
      throw new Error("Title set is empty or not found.");
    }
  } else if (mode === "both") {
    const useTitle = Boolean(schedule.title_set_id);
    if (useTitle && schedule.title_set_id) {
      const { data: titleSet } = await supabase.from("title_sets").select("titles").eq("id", schedule.title_set_id).maybeSingle();
      if (titleSet && titleSet.titles && titleSet.titles.length > 0) {
        const selectedTitle = await selectUnusedTitle(schedule.id, titleSet.titles, supabase);
        if (selectedTitle) {
          fixedTitle = selectedTitle;
          keyword = selectedTitle;
          console.log(`Mode "Both" -> Title selected: ${fixedTitle}`);
        }
      }
    }
  }
  if (!keyword) {
    const allKeywords = (schedule.keyword || "").split(",").map((k) => k.trim()).filter((k) => k);
    if (allKeywords.length === 0 && fixedTitle) {
      keyword = fixedTitle;
    }
    const selectedKeyword = await selectUnusedKeyword(schedule.id, allKeywords, supabase);
    if (!selectedKeyword && !keyword) {
      throw new KeywordExhaustedError("All keywords in this schedule have already been used.");
    }
    if (selectedKeyword) {
      keyword = selectedKeyword;
    }
    console.log(`Keyword selected: ${keyword}`);
  }
  const progressHistoryId = await createExecutionProgressHistory(supabase, {
    schedule,
    wpConfig,
    keyword,
    title: fixedTitle || "",
    triggerType,
    stage: "keyword_selected",
    message: "\u30AD\u30FC\u30EF\u30FC\u30C9\u307E\u305F\u306F\u30BF\u30A4\u30C8\u30EB\u3092\u9078\u629E\u3057\u307E\u3057\u305F",
    progress: 10,
    aiConfig
  });
  let customInstructions = "";
  if (schedule.prompt_set_id) {
    const { data: promptSet } = await supabase.from("prompt_sets").select("custom_instructions").eq("id", schedule.prompt_set_id).maybeSingle();
    if (promptSet) {
      customInstructions = promptSet.custom_instructions;
      console.log("Using custom instructions from prompt set");
    }
  }
  await updateExecutionProgressHistory(supabase, progressHistoryId, {
    stage: "prompt_loaded",
    message: "\u30D7\u30ED\u30F3\u30D7\u30C8\u8A2D\u5B9A\u3092\u8AAD\u307F\u8FBC\u307F\u307E\u3057\u305F",
    progress: 18
  });
  let styleReferenceInstructions = "";
  if (wpConfig.style_reference_url) {
    const styleSample = await fetchStyleReferenceSample(wpConfig.style_reference_url);
    if (styleSample) {
      styleReferenceInstructions = buildStyleReferenceInstructions(styleSample, wpConfig.style_reference_url);
      console.log(`Loaded style reference sample from ${wpConfig.style_reference_url}`);
    } else {
      console.warn(`Style reference URL configured but no sample could be extracted: ${wpConfig.style_reference_url}`);
    }
  }
  await updateExecutionProgressHistory(supabase, progressHistoryId, {
    stage: "style_reference_loaded",
    message: styleReferenceInstructions ? "\u30B9\u30BF\u30A4\u30EB\u53C2\u7167\u3092\u8AAD\u307F\u8FBC\u307F\u307E\u3057\u305F" : "\u30B9\u30BF\u30A4\u30EB\u53C2\u7167\u306F\u3042\u308A\u307E\u305B\u3093",
    progress: 24
  });
  console.log(`Conducting competitor research for: ${keyword}`);
  let competitorData = null;
  if (serpApiKey) {
    try {
      competitorData = await conductCompetitorResearchWithFallback(keyword, serpApiKey, 5);
      console.log(`Competitor research completed. Found ${competitorData.articles.length} articles`);
    } catch (researchError) {
      console.warn("Competitor research failed, proceeding without it:", researchError);
    }
  } else {
    console.log("SerpAPI key not found. Skipping competitor research.");
  }
  await updateExecutionProgressHistory(supabase, progressHistoryId, {
    stage: "competitor_research_done",
    message: competitorData ? `\u7AF6\u5408\u8ABF\u67FB\u304C\u5B8C\u4E86\u3057\u307E\u3057\u305F\uFF08${competitorData.articles?.length || 0}\u4EF6\uFF09` : "\u7AF6\u5408\u8ABF\u67FB\u306F\u30B9\u30AD\u30C3\u30D7\u3057\u307E\u3057\u305F",
    progress: 35
  });
  console.log(`Enriching keywords for: ${keyword}`);
  const targetWordCount = schedule.target_word_count || DEFAULT_TARGET_WORD_COUNT;
  const writingTone = resolveWritingTone(schedule.writing_tone);
  const keywordArray = (schedule.keyword || "").split(",").map((k) => k.trim()).filter((k) => k);
  let relatedKeywords = [];
  if (competitorData) {
    const competitorKeywords = extractRelatedKeywordsFromCompetitorData(competitorData, keyword, 5);
    relatedKeywords.push(...competitorKeywords);
    console.log(`Extracted ${competitorKeywords.length} related keywords from competitor data`);
  }
  if (googleApiKey && searchEngineId) {
    try {
      const searchKeywords = await fetchRelatedKeywordsViaCustomSearch(keyword, googleApiKey, searchEngineId);
      relatedKeywords.push(...searchKeywords);
      console.log(`Fetched ${searchKeywords.length} related keywords from Google Custom Search`);
    } catch (err) {
      console.warn("Google Custom Search failed:", err);
    }
  }
  await updateExecutionProgressHistory(supabase, progressHistoryId, {
    stage: "keywords_enriched",
    message: `\u95A2\u9023\u30AD\u30FC\u30EF\u30FC\u30C9\u3092\u6574\u7406\u3057\u307E\u3057\u305F\uFF08${relatedKeywords.length}\u4EF6\uFF09`,
    progress: 45
  });
  const sectionKeywordCandidates = [keyword, ...keywordArray, ...relatedKeywords].map((k) => String(k || "").trim()).filter(Boolean);
  const sectionKeywords = [];
  const seenSectionKeywordNormalized = /* @__PURE__ */ new Set();
  for (const candidate of sectionKeywordCandidates) {
    const normalized = candidate.replace(/\s+/g, "").toLowerCase();
    if (!normalized || seenSectionKeywordNormalized.has(normalized)) continue;
    seenSectionKeywordNormalized.add(normalized);
    sectionKeywords.push(candidate);
    if (sectionKeywords.length >= 3) break;
  }
  console.log(`Final section keywords: ${sectionKeywords.join(", ")}`);
  const competitorHeadings = extractCompetitorHeadings(competitorData, 15);
  if (competitorHeadings.length > 0) {
    console.log(`Extracted ${competitorHeadings.length} competitor headings for outline context`);
  }
  if (!fixedTitle) {
    await updateExecutionProgressHistory(supabase, progressHistoryId, {
      stage: "title_generating",
      message: "AI\u30BF\u30A4\u30C8\u30EB\u3092\u751F\u6210\u3057\u3066\u3044\u307E\u3059",
      progress: 50
    });
    const competitorTitles = (competitorData?.articles || []).map((a) => a.title).filter(Boolean);
    const generatedTitle = await generateTitleWithAI(keyword, relatedKeywords, competitorTitles, aiConfig, competitorData);
    fixedTitle = generatedTitle;
    console.log(`AI-generated title: ${fixedTitle}`);
  }
  await updateExecutionProgressHistory(supabase, progressHistoryId, {
    stage: "title_done",
    message: "\u30BF\u30A4\u30C8\u30EB\u304C\u6C7A\u307E\u308A\u307E\u3057\u305F",
    progress: 58,
    title: fixedTitle || ""
  });
  console.log(`Generating outline for: ${keyword}`);
  const runGeneration = async () => {
    console.log("Generating outline with AI generator style...");
    const customInstructionText = customInstructions.trim();
    const baseCustomInstructions = compactAutoModeInstructions([
      customInstructionText,
      styleReferenceInstructions,
      relatedKeywords.length > 0 ? `Related keywords: ${relatedKeywords.slice(0, 8).join(", ")}` : void 0
    ]);
    const effectiveCustomInstructions = compactAutoModeInstructions([
      baseCustomInstructions,
      buildAutoModeQualityInstructions({
        selectedTitle: fixedTitle || void 0,
        targetWordCount
      })
    ]);
    await updateExecutionProgressHistory(supabase, progressHistoryId, {
      stage: "outline_generating",
      message: "\u30A2\u30A6\u30C8\u30E9\u30A4\u30F3\u3092\u751F\u6210\u3057\u3066\u3044\u307E\u3059",
      progress: 65,
      title: fixedTitle || ""
    });
    let outline2 = await generateOutlineWithAutoModeStyle({
      keyword,
      targetWordCount,
      fixedTitle,
      customInstructions: effectiveCustomInstructions,
      competitorHeadings,
      relatedKeywords,
      tone: writingTone,
      callAI: (prompt, maxTokens) => callAI(prompt, aiConfig, maxTokens)
    });
    const outlineQuality = evaluateAutoOutlineQuality(outline2, {
      targetWordCount,
      selectedTitle: fixedTitle || void 0
    });
    if (!outlineQuality.passed) {
      console.warn("Scheduler auto outline quality gate failed. Regenerating outline:", outlineQuality.issues);
      await updateExecutionProgressHistory(supabase, progressHistoryId, {
        stage: "outline_regenerating",
        message: `\u30A2\u30A6\u30C8\u30E9\u30A4\u30F3\u3092\u518D\u751F\u6210\u3057\u3066\u3044\u307E\u3059\uFF08${outlineQuality.issues.join(" / ")}\uFF09`,
        progress: 70,
        title: fixedTitle || ""
      });
      outline2 = await generateOutlineWithAutoModeStyle({
        keyword,
        targetWordCount,
        fixedTitle,
        customInstructions: compactAutoModeInstructions([
          effectiveCustomInstructions,
          buildAutoOutlineRetryInstructions(outlineQuality.issues)
        ]),
        competitorHeadings,
        relatedKeywords,
        tone: writingTone,
        callAI: (prompt, maxTokens) => callAI(prompt, aiConfig, maxTokens)
      });
    }
    await updateExecutionProgressHistory(supabase, progressHistoryId, {
      stage: "outline_done",
      message: `\u30A2\u30A6\u30C8\u30E9\u30A4\u30F3\u304C\u3067\u304D\u307E\u3057\u305F\uFF08H2:${outline2.sections.filter((section) => !section.isLead && section.level !== 3).length} / H3:${outline2.sections.filter((section) => section.level === 3).length}\uFF09`,
      progress: 75,
      title: fixedTitle || "",
      debug: buildGenerationDebug({
        outline: outline2,
        title: fixedTitle || "",
        keyword,
        targetWordCount,
        relatedKeywords,
        competitorHeadings
      })
    });
    await updateExecutionProgressHistory(supabase, progressHistoryId, {
      stage: "article_generating",
      message: "\u672C\u6587\u3092\u751F\u6210\u3057\u3066\u3044\u307E\u3059",
      progress: 82,
      title: fixedTitle || ""
    });
    const generationResult2 = await generateSchedulerArticleSinglePass({
      outline: outline2,
      keyword,
      keywords: sectionKeywords,
      tone: writingTone,
      targetWordCount,
      customInstructions: effectiveCustomInstructions,
      aiConfig
    });
    await updateExecutionProgressHistory(supabase, progressHistoryId, {
      stage: "article_done",
      message: `\u672C\u6587\u751F\u6210\u304C\u5B8C\u4E86\u3057\u307E\u3057\u305F\uFF08${generationResult2.wordCount}\u6587\u5B57\uFF09`,
      progress: 88,
      title: fixedTitle || "",
      debug: buildGenerationDebug({
        outline: outline2,
        title: fixedTitle || "",
        keyword,
        targetWordCount,
        generatedChars: generationResult2.wordCount,
        relatedKeywords,
        competitorHeadings
      })
    });
    return { outline: outline2, generationResult: generationResult2 };
  };
  const scheduleImageGenerationEnabled = schedule.image_generation_enabled === true;
  const scheduleImagesPerArticle = Math.max(
    0,
    Math.min(10, Number.isFinite(Number(schedule.images_per_article)) ? Number(schedule.images_per_article) : Number(aiConfig.images_per_article ?? 0))
  );
  const schedulerRun = await runGeneration();
  const outline = schedulerRun.outline;
  const generationResult = schedulerRun.generationResult;
  await updateExecutionProgressHistory(supabase, progressHistoryId, {
    stage: "post_processing",
    message: "\u6295\u7A3F\u524D\u306E\u6574\u5F62\u3068\u691C\u8A3C\u3092\u5B9F\u884C\u3057\u3066\u3044\u307E\u3059",
    progress: 92,
    title: fixedTitle || ""
  });
  function cleanupContentArtifacts(content, articleTitle2) {
    let text = String(content || "");
    text = text.replace(/^(#{1,6}\s+.+?)[繝ｻ繝ｻ](.+)$/gm, "$1 $2").replace(/^(#{1,6}\s+.+?)[繝ｻ繝ｻ]\s*$/gm, "$1");
    text = text.replace(/^(#{1,6}\s+)\d+[\.\)\-、:：]\s*(.+)$/gm, "$1$2");
    text = text.replace(/^(#{1,6}\s+)[\u300c\u300d\u300e\u300f\u3010\u3011\uff08\uff09\[\]\u3001\u3002\uff01\uff1f]+\s*/gm, "$1");
    text = text.replace(/^(#{1,6}\s+)(.+?)[\u300d\u300f\u3011\uff09]+\s*$/gm, "$1$2");
    text = text.replace(/^#{1,6}\s*$/gm, "");
    const lines = text.split("\n");
    const firstNonEmpty = lines.findIndex((l) => l.trim().length > 0);
    if (firstNonEmpty !== -1) {
      const firstLine = lines[firstNonEmpty].trim();
      const normalize = (s) => s.replace(/[^\w\u3040-\u30ff\u3400-\u9fff\u4e00-\u9faf]/g, "").toLowerCase();
      const normalizedFirst = normalize(firstLine);
      const normalizedTitle = normalize(articleTitle2);
      if (normalizedFirst.length > 0 && normalizedTitle.length > 0) {
        const isTitleLine = normalizedFirst === normalizedTitle || normalizedTitle.startsWith(normalizedFirst) && normalizedFirst.length >= normalizedTitle.length * 0.8 || normalizedFirst.startsWith(normalizedTitle) && firstLine.length <= articleTitle2.length * 1.3;
        if (isTitleLine) {
          lines.splice(firstNonEmpty, 1);
          text = lines.join("\n");
        }
      }
    }
    text = text.replace(/^(#{1,6})(\s+.+)\n+(?=(#{1,6})\s+)/gm, (match, level1, rest, level2) => {
      if (level2.length > level1.length) {
        return match;
      }
      console.log("Removed empty heading:", `${level1}${rest}`.trim());
      return "";
    });
    text = text.replace(/^(邵ｺ・ｾ邵ｺ・ｨ郢ｧ・埼お蜊・ｫ鄙ｻ驍ｱ荵怜ｳ｡)[繝ｻ繝ｻ]\s*/gm, "");
    text = text.replace(/\*\*(.+?)\*\*/g, "$1");
    text = text.replace(/\*\*/g, "");
    text = text.replace(/\n{3,}/g, "\n\n");
    text = text.replace(/([^\n])(\n)(#{1,6}\s)/g, "$1\n\n$3");
    text = text.replace(/(#{1,6}\s[^\n]+)(\n)([^#\n-*])/g, "$1\n\n$3");
    return text.trim();
  }
  async function refineContentWithAI(content, _title, _keyword, _aiConfig) {
    return content;
  }
  async function regenerateHeadingsWithAI(content, _title, _keyword, _aiConfig) {
    return content;
  }
  let fullContent = generationResult.fullContent;
  const baseGeneratedContent = generationResult.fullContent;
  const articleTitle = outline.title;
  console.log("Word count check:", {
    target: targetWordCount,
    current: countGeneratedChars(fullContent),
    initial: generationResult.wordCount
  });
  fullContent = cleanupContentArtifacts(fullContent, articleTitle);
  console.log("Deterministic cleanup applied");
  fullContent = insertSubheadingsIntoLongSections(fullContent, targetWordCount);
  console.log("H3 subheadings inserted");
  const elapsedMs = Date.now() - schedulerStartTime;
  const REFINEMENT_TIME_LIMIT_MS = 12e4;
  if (elapsedMs < REFINEMENT_TIME_LIMIT_MS) {
    try {
      const refinedContent = await refineContentWithAI(fullContent, articleTitle, keyword, aiConfig);
      if (refinedContent && refinedContent.length > 500) {
        fullContent = refinedContent;
        console.log("Content refined successfully");
      }
    } catch (refineError) {
      console.warn("Refinement step skipped due to error:", refineError);
    }
  } else {
    console.log("Skipping AI refinement to avoid timeout", { elapsedSeconds: Math.round(elapsedMs / 1e3) });
  }
  const elapsedForHeadingMs = Date.now() - schedulerStartTime;
  const HEADING_REGEN_TIME_LIMIT_MS = 15e4;
  if (elapsedForHeadingMs < HEADING_REGEN_TIME_LIMIT_MS) {
    try {
      const headingCountBeforeRegeneration = countNonSummaryHeadings(fullContent);
      const regeneratedHeadingContent = await regenerateHeadingsWithAI(fullContent, articleTitle, keyword, aiConfig);
      if (regeneratedHeadingContent && regeneratedHeadingContent.length > 500) {
        const headingCountAfterRegeneration = countNonSummaryHeadings(regeneratedHeadingContent);
        if (headingCountBeforeRegeneration >= 2 && headingCountAfterRegeneration < Math.max(2, headingCountBeforeRegeneration - 1)) {
          console.warn("Skipping regenerated headings because heading count dropped too much", {
            before: headingCountBeforeRegeneration,
            after: headingCountAfterRegeneration
          });
        } else {
          fullContent = regeneratedHeadingContent;
        }
      }
    } catch (headingError) {
      console.warn("Heading regeneration step skipped due to error:", headingError);
    }
  } else {
    console.log("Skipping heading regeneration to avoid timeout", { elapsedSeconds: Math.round(elapsedForHeadingMs / 1e3) });
  }
  fullContent = cleanupContentArtifacts(fullContent, articleTitle);
  let finalPostStatus = schedule.post_status || "draft";
  let factCheckReport = null;
  let factCheckItemsChecked = 0;
  const factCheckAlerts = [];
  let factCheckExecuted = false;
  let factCheckCriticalIssues = 0;
  let factCheckMinorIssues = 0;
  let factCheckChangeSummaries = [];
  let factCheckAutoFixApplied = false;
  if (schedule.enable_fact_check) {
    console.log(`Starting fact-check for article: ${articleTitle}`);
    try {
      const scheduleUserId = schedule.user_id;
      const scheduleAccountId = schedule.account_id;
      let factCheckSettings = null;
      if (!scheduleUserId) {
        console.warn(`Schedule ${schedule.id} has no user_id. Falling back to app_settings for fact-check.`);
      } else {
        let userFactCheckQuery = supabase.from("fact_check_settings").select("*").eq("user_id", scheduleUserId).order("updated_at", { ascending: false }).limit(1);
        if (scheduleAccountId) {
          userFactCheckQuery = userFactCheckQuery.eq("account_id", scheduleAccountId);
        }
        const { data: userFactCheckSettings } = await userFactCheckQuery.maybeSingle();
        factCheckSettings = userFactCheckSettings;
      }
      if (!factCheckSettings) {
        let appSettingsQuery = supabase.from("app_settings").select("key, value").in("key", [
          "perplexity_api_key",
          "fact_check_enabled",
          "fact_check_model_name",
          "fact_check_max_items",
          "fact_check_auto_fix_enabled"
        ]);
        if (scheduleAccountId) {
          appSettingsQuery = appSettingsQuery.eq("account_id", scheduleAccountId);
        }
        const { data: globalRows } = await appSettingsQuery;
        if (globalRows && globalRows.length > 0) {
          const map = /* @__PURE__ */ new Map();
          globalRows.forEach((row) => {
            map.set(String(row.key), String(row.value ?? ""));
          });
          const apiKey = map.get("perplexity_api_key");
          if (apiKey) {
            factCheckSettings = {
              enabled: parseBoolean(map.get("fact_check_enabled"), true),
              perplexity_api_key: apiKey,
              model_name: map.get("fact_check_model_name") || "sonar",
              max_items_to_check: parseNumber(map.get("fact_check_max_items"), 10),
              auto_fix_enabled: parseBoolean(map.get("fact_check_auto_fix_enabled"), false)
            };
          }
        }
      }
      if (factCheckSettings?.enabled && factCheckSettings?.perplexity_api_key) {
        factCheckExecuted = true;
        const factsToCheck = await extractFactsFromContent(fullContent, schedule.fact_check_note);
        const maxItems = factCheckSettings.max_items_to_check || 10;
        const itemsToCheck = factsToCheck.slice(0, maxItems);
        factCheckItemsChecked = itemsToCheck.length;
        console.log(`Found ${factsToCheck.length} facts, checking top ${itemsToCheck.length} in batches`);
        let factCheckResults = await verifyFactsBatch(
          itemsToCheck,
          factCheckSettings.perplexity_api_key,
          keyword,
          factCheckSettings.model_name || "sonar",
          5
        );
        const criticalIssues = factCheckResults.filter(
          (r) => r.verdict === "incorrect" && r.confidence >= 70
        ).length;
        const minorIssues = factCheckResults.filter(
          (r) => r.verdict === "partially_correct" || r.verdict === "incorrect" && r.confidence < 70
        ).length;
        factCheckCriticalIssues = criticalIssues;
        factCheckMinorIssues = minorIssues;
        const scheduleAutoFixValue = schedule.fact_check_auto_fix_enabled;
        const autoFixEnabled = typeof scheduleAutoFixValue === "boolean" ? scheduleAutoFixValue : Boolean(factCheckSettings.auto_fix_enabled);
        console.log(`Fact-check completed: ${criticalIssues} critical, ${minorIssues} minor issues`);
        if (autoFixEnabled && (criticalIssues > 0 || minorIssues > 0)) {
          console.log("Auto-fix mode enabled. Applying AI corrections...");
          const headingCountBeforeAutoFix = countNonSummaryHeadings(fullContent);
          const contentBeforeAutoFix = fullContent;
          const fixedContent = await applyFactCheckCorrections(
            fullContent,
            factCheckResults,
            factCheckSettings.perplexity_api_key,
            keyword,
            factCheckSettings.model_name || "sonar"
          );
          if (fixedContent && fixedContent.trim().length > 0) {
            const normalizedFixedContent = normalizeGeneratedContentForPublishing(fixedContent, articleTitle);
            const headingCountAfterAutoFix = countNonSummaryHeadings(normalizedFixedContent);
            if (headingCountBeforeAutoFix >= 2 && headingCountAfterAutoFix < Math.max(2, headingCountBeforeAutoFix - 1)) {
              console.warn(
                `Auto-fix removed too many headings (before=${headingCountBeforeAutoFix}, after=${headingCountAfterAutoFix}). Keeping pre-fix content.`
              );
            } else {
              fullContent = normalizedFixedContent;
              factCheckChangeSummaries = summarizeFactCheckContentChanges(contentBeforeAutoFix, normalizedFixedContent, 5);
              if (factCheckChangeSummaries.length > 0) {
                factCheckAutoFixApplied = true;
                factCheckAlerts.push(`\u30D5\u30A1\u30AF\u30C8\u30C1\u30A7\u30C3\u30AF\u306E\u81EA\u52D5\u4FEE\u6B63\u3092\u9069\u7528\u3057\u307E\u3057\u305F\uFF08${factCheckChangeSummaries.length}\u4EF6\uFF09`);
              }
            }
            const recheckFacts = await extractFactsFromContent(fullContent, schedule.fact_check_note);
            const recheckItems = recheckFacts.slice(0, maxItems);
            factCheckResults = await verifyFactsBatch(
              recheckItems,
              factCheckSettings.perplexity_api_key,
              keyword,
              factCheckSettings.model_name || "sonar",
              5
            );
            const reCritical = factCheckResults.filter(
              (r) => r.verdict === "incorrect" && r.confidence >= 70
            ).length;
            const reMinor = factCheckResults.filter(
              (r) => r.verdict === "partially_correct" || r.verdict === "incorrect" && r.confidence < 70
            ).length;
            factCheckCriticalIssues = reCritical;
            factCheckMinorIssues = reMinor;
            console.log(`Re-check after auto-fix: ${reCritical} critical, ${reMinor} minor issues`);
          } else {
            console.warn("Auto-fix returned empty content. Keeping original content.");
          }
        }
        const criticalIssuesAfterFix = factCheckResults.filter(
          (r) => r.verdict === "incorrect" && r.confidence >= 70
        ).length;
        const minorIssuesAfterFix = factCheckResults.filter(
          (r) => r.verdict === "partially_correct" || r.verdict === "incorrect" && r.confidence < 70
        ).length;
        factCheckCriticalIssues = criticalIssuesAfterFix;
        factCheckMinorIssues = minorIssuesAfterFix;
        if (criticalIssuesAfterFix > 0) {
          console.log(`Critical errors found (${criticalIssuesAfterFix}). Forcing draft status.`);
          finalPostStatus = "draft";
          factCheckAlerts.push(`\u91CD\u5927\u306A\u30D5\u30A1\u30AF\u30C8\u30C1\u30A7\u30C3\u30AF\u6307\u6458\u304C\u6B8B\u3063\u3066\u3044\u307E\u3059\uFF08${criticalIssuesAfterFix}\u4EF6\uFF09\u3002\u4E0B\u66F8\u304D\u306B\u5909\u66F4\u3057\u307E\u3057\u305F\u3002`);
        }
        const { data: savedReport } = await supabase.from("fact_check_results").insert({
          account_id: scheduleAccountId,
          schedule_id: schedule.id,
          checked_items: factCheckResults,
          total_checked: itemsToCheck.length,
          issues_found: criticalIssuesAfterFix + minorIssuesAfterFix,
          critical_issues: criticalIssuesAfterFix
        }).select().single();
        factCheckReport = savedReport;
      } else {
        console.log("Fact-check settings not configured or API key missing");
        factCheckAlerts.push("\u30D5\u30A1\u30AF\u30C8\u30C1\u30A7\u30C3\u30AF\u8A2D\u5B9A\u307E\u305F\u306FPerplexity API\u30AD\u30FC\u304C\u672A\u8A2D\u5B9A\u3067\u3059\u3002");
      }
    } catch (factCheckError) {
      console.error("Fact-check failed:", factCheckError);
      const errorText = factCheckError instanceof Error ? factCheckError.message : String(factCheckError || "");
      factCheckAlerts.push(`\u30D5\u30A1\u30AF\u30C8\u30C1\u30A7\u30C3\u30AF\u306B\u5931\u6557\u3057\u307E\u3057\u305F: ${errorText}`);
    }
  }
  fullContent = fullContent.replace(/\[\[(.+?)\]\]/g, "$1");
  const contentBeforeNormalization = fullContent;
  fullContent = normalizeGeneratedContentForPublishing(fullContent, articleTitle);
  if (contentBeforeNormalization !== fullContent) {
    console.log("Normalized generated content structure before publishing");
  }
  const baselineNormalizedContent = normalizeGeneratedContentForPublishing(baseGeneratedContent, articleTitle);
  const baselineHeadingCount = countNonSummaryHeadings(baselineNormalizedContent);
  const finalHeadingCount = countNonSummaryHeadings(fullContent);
  if (baselineHeadingCount >= 2 && finalHeadingCount < Math.max(2, baselineHeadingCount - 1)) {
    console.warn(
      `Final content lost too many headings (baseline=${baselineHeadingCount}, final=${finalHeadingCount}). Restoring baseline heading structure.`
    );
    fullContent = baselineNormalizedContent;
  }
  const finalCharsBeforeCompaction = countGeneratedChars(fullContent);
  fullContent = compactArticleToTargetLength(fullContent, targetWordCount);
  const finalCharsAfterCompaction = countGeneratedChars(fullContent);
  if (finalCharsAfterCompaction < finalCharsBeforeCompaction) {
    console.log(`Compacted article length: ${finalCharsBeforeCompaction} -> ${finalCharsAfterCompaction}`);
  }
  validateGeneratedArticleCompleteness(fullContent, outline, targetWordCount);
  let postId = null;
  let publishErrorMessage = null;
  let publishedAtIso = null;
  console.log(`Publishing to WordPress: ${articleTitle} (Status: ${finalPostStatus})`);
  await updateExecutionProgressHistory(supabase, progressHistoryId, {
    stage: "wordpress_publishing",
    message: finalPostStatus === "publish" ? "WordPress\u3078\u516C\u958B\u6295\u7A3F\u3057\u3066\u3044\u307E\u3059" : "WordPress\u3078\u4E0B\u66F8\u304D\u4FDD\u5B58\u3057\u3066\u3044\u307E\u3059",
    progress: 96,
    title: articleTitle
  });
  try {
    postId = await publishToWordPress(
      wpConfig,
      articleTitle,
      fullContent,
      finalPostStatus
    );
    publishedAtIso = (/* @__PURE__ */ new Date()).toISOString();
    console.log(`Published: Post ID ${postId}`);
  } catch (publishError) {
    publishErrorMessage = publishError?.message || String(publishError);
    console.error("WordPress publish failed:", publishError);
  }
  const articleSnapshotStatus = postId ? finalPostStatus === "publish" ? "published" : "draft" : "failed";
  await saveGeneratedArticleSnapshot(supabase, {
    title: articleTitle,
    content: fullContent,
    keywords: sectionKeywords,
    status: articleSnapshotStatus,
    tone: writingTone,
    aiConfig,
    wpConfig,
    postId,
    publishedAt: publishedAtIso
  });
  if (postId && schedule.chatwork_room_id && chatworkApiToken) {
    console.log(`Sending Chatwork notification to rooms: ${schedule.chatwork_room_id}`);
    try {
      const postUrl = `${wpConfig.url}/?p=${postId}`;
      await sendChatworkNotifications(
        chatworkApiToken,
        schedule.chatwork_room_id,
        schedule.chatwork_message_template || "",
        articleTitle,
        postUrl,
        keyword,
        schedule.post_status === "publish" ? "\u516C\u958B" : "\u4E0B\u66F8\u304D"
      );
    } catch (cwError) {
      console.error("Chatwork notification failed:", cwError);
    }
  }
  const rawNotifyEveryRun = schedule.fact_check_notify_on_every_run === true;
  const rawNotifyOnAnomaly = schedule.fact_check_notify_on_anomaly ?? true;
  const factCheckNotifyOnEveryRun = rawNotifyEveryRun;
  const factCheckNotifyOnAnomaly = rawNotifyEveryRun ? false : rawNotifyOnAnomaly;
  const factCheckAlertRoomIds = String(schedule.fact_check_alert_chatwork_room_id || schedule.chatwork_room_id || "").trim();
  if (schedule.enable_fact_check && factCheckAlertRoomIds && chatworkApiToken) {
    const alertUrl = postId ? `${wpConfig.url}/?p=${postId}` : "(\u6295\u7A3FURL\u306A\u3057)";
    const postStatusLabel = finalPostStatus === "publish" ? "\u516C\u958B" : "\u4E0B\u66F8\u304D";
    const factCheckChangeBlock = factCheckAutoFixApplied ? `
\u81EA\u52D5\u4FEE\u6B63\u5185\u5BB9:
${factCheckChangeSummaries.join("\n\n")}` : "\n\u81EA\u52D5\u4FEE\u6B63\u5185\u5BB9: \u306A\u3057";
    if (factCheckNotifyOnEveryRun) {
      try {
        const summaryTemplate = `\u30D5\u30A1\u30AF\u30C8\u30C1\u30A7\u30C3\u30AF\u7D50\u679C\u901A\u77E5
\u30B9\u30B1\u30B8\u30E5\u30FC\u30EBID: ${schedule.id}
\u30BF\u30A4\u30C8\u30EB: {title}
\u30AD\u30FC\u30EF\u30FC\u30C9: {keyword}
\u6295\u7A3FURL: {url}
\u6295\u7A3F\u72B6\u614B: {status}

\u5B9F\u884C\u72B6\u614B: ${factCheckExecuted ? "\u5B9F\u884C\u6E08\u307F" : "\u672A\u5B9F\u884C"}
\u30C1\u30A7\u30C3\u30AF\u4EF6\u6570: ${factCheckItemsChecked}\u4EF6
\u91CD\u5927\u306A\u6307\u6458: ${factCheckCriticalIssues}\u4EF6
\u8EFD\u5FAE\u306A\u6307\u6458: ${factCheckMinorIssues}\u4EF6${factCheckChangeBlock}`;
        await sendChatworkNotifications(
          chatworkApiToken,
          factCheckAlertRoomIds,
          summaryTemplate,
          articleTitle,
          alertUrl,
          keyword,
          postStatusLabel
        );
      } catch (summaryError) {
        console.error("Fact-check summary notification failed:", summaryError);
      }
    }
    if (factCheckNotifyOnAnomaly && factCheckAlerts.length > 0) {
      console.log(`Sending fact-check alert to rooms: ${factCheckAlertRoomIds}`);
      try {
        const alertTemplate = `\u30D5\u30A1\u30AF\u30C8\u30C1\u30A7\u30C3\u30AF\u8B66\u544A\u901A\u77E5
\u30B9\u30B1\u30B8\u30E5\u30FC\u30EBID: ${schedule.id}
\u30BF\u30A4\u30C8\u30EB: {title}
\u30AD\u30FC\u30EF\u30FC\u30C9: {keyword}
\u6295\u7A3FURL: {url}
\u6295\u7A3F\u72B6\u614B: {status}

\u8B66\u544A\u5185\u5BB9:
${factCheckAlerts.map((item, index) => `${index + 1}. ${item}`).join("\n")}${factCheckChangeBlock}`;
        await sendChatworkNotifications(
          chatworkApiToken,
          factCheckAlertRoomIds,
          alertTemplate,
          articleTitle,
          alertUrl,
          keyword,
          postStatusLabel
        );
      } catch (alertError) {
        console.error("Fact-check alert notification failed:", alertError);
      }
    }
  }
  const costBreakdown = estimateExecutionCostBreakdown({
    provider: aiConfig.provider,
    model: aiConfig.model,
    generatedChars: countGeneratedChars(fullContent),
    competitorResearchUsed: Boolean(competitorData?.articles?.length),
    factCheckItemsChecked,
    imagesGenerated: scheduleImageGenerationEnabled && aiConfig.image_enabled ? scheduleImagesPerArticle : 0,
    imageUnitCostUsd: imageCostUsdPerImage
  });
  costBreakdown.trigger_type = triggerType;
  costBreakdown.generation_debug = buildGenerationDebug({
    outline,
    title: articleTitle,
    keyword,
    targetWordCount,
    generatedChars: countGeneratedChars(fullContent),
    relatedKeywords,
    competitorHeadings,
    publishErrorMessage
  });
  const executionHistoryPayload = {
    account_id: schedule.account_id || wpConfig.account_id || null,
    schedule_id: schedule.id,
    wordpress_config_id: wpConfig.id,
    executed_at: (/* @__PURE__ */ new Date()).toISOString(),
    keyword_used: keyword,
    article_title: articleTitle,
    wordpress_post_id: postId ?? "",
    status: postId ? "success" : "failed",
    error_message: postId ? null : publishErrorMessage || "WordPress publish failed",
    cost_breakdown: costBreakdown,
    estimated_cost_usd: costBreakdown.total_estimated_usd
  };
  let executionHistoryResult = progressHistoryId ? await supabase.from("execution_history").update(executionHistoryPayload).eq("id", progressHistoryId).select("id").single() : await supabase.from("execution_history").insert(executionHistoryPayload).select("id").single();
  if (isMissingColumnError(executionHistoryResult.error, "account_id")) {
    console.warn("execution_history.account_id is missing. Retrying history insert without account_id.");
    delete executionHistoryPayload.account_id;
    executionHistoryResult = progressHistoryId ? await supabase.from("execution_history").update(executionHistoryPayload).eq("id", progressHistoryId).select("id").single() : await supabase.from("execution_history").insert(executionHistoryPayload).select("id").single();
  }
  const { data: executionHistory, error: executionHistoryError } = executionHistoryResult;
  if (executionHistoryError) {
    console.error("Failed to save execution history:", executionHistoryError);
  }
  if (!postId) {
    throw new Error(`WordPress publish failed: ${publishErrorMessage || "Unknown error"}`);
  }
  return {
    wordpress_config_id: wpConfig.id,
    wordpress_config_name: wpConfig.name,
    success: true,
    keyword,
    title: articleTitle,
    post_id: postId
  };
}
async function selectUnusedKeyword(scheduleId, allKeywords, supabase) {
  const { data: history } = await supabase.from("execution_history").select("keyword_used").eq("schedule_id", scheduleId);
  const usedKeywords = new Set((history || []).map((h) => h.keyword_used));
  const availableKeywords = allKeywords.filter((k) => !usedKeywords.has(k));
  if (availableKeywords.length === 0) {
    console.log(`All keywords used for schedule ${scheduleId}. Posting will be skipped until keywords are reset.`);
    return null;
  }
  return availableKeywords[0];
}
async function selectUnusedTitle(scheduleId, allTitles, supabase) {
  const { data: history } = await supabase.from("execution_history").select("article_title").eq("schedule_id", scheduleId);
  const usedTitles = new Set((history || []).map((h) => h.article_title));
  const availableTitles = allTitles.filter((t) => !usedTitles.has(t));
  if (availableTitles.length === 0) {
    console.log("All titles used, resetting list");
    if (allTitles.length === 0) return null;
    return allTitles[0];
  }
  return availableTitles[0];
}
async function getTermIdBySlugOrName(config, restBase, categoryIdentifier) {
  const auth = btoa(`${config.username}:${config.password}`);
  try {
    let response = await fetch(
      `${config.url}/wp-json/wp/v2/${restBase}?slug=${encodeURIComponent(categoryIdentifier)}`,
      { headers: { "Authorization": `Basic ${auth}` } }
    );
    if (response.ok) {
      const data = await response.json();
      if (data.length > 0) {
        console.log(`Found category by slug "${categoryIdentifier}": ID ${data[0].id}`);
        return data[0].id;
      }
    }
    response = await fetch(
      `${config.url}/wp-json/wp/v2/${restBase}?search=${encodeURIComponent(categoryIdentifier)}`,
      { headers: { "Authorization": `Basic ${auth}` } }
    );
    if (response.ok) {
      const data = await response.json();
      const exactMatch = data.find(
        (cat) => cat.name.toLowerCase() === categoryIdentifier.toLowerCase()
      );
      if (exactMatch) {
        console.log(`Found category by name "${categoryIdentifier}": ID ${exactMatch.id}`);
        return exactMatch.id;
      }
      if (data.length > 0) {
        console.log(`Found category by partial match "${categoryIdentifier}": ID ${data[0].id}`);
        return data[0].id;
      }
    }
    console.warn(`Category "${categoryIdentifier}" not found`);
    return null;
  } catch (error) {
    console.error(`Error searching for category "${categoryIdentifier}":`, error);
    return null;
  }
}
function splitLongParagraphForReadability(text) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (!normalized) return [];
  const sentences = normalized.split(/(?<=[邵ｲ繧托ｽｼ繝ｻ・ｼ繝ｻ?])\s*/g).map((s) => s.trim()).filter(Boolean);
  if (sentences.length <= 2) return [normalized];
  const chunks = [];
  let buffer = [];
  let charCount = 0;
  for (const sentence of sentences) {
    buffer.push(sentence);
    charCount += sentence.length;
    if (buffer.length >= 2 || charCount >= 140) {
      chunks.push(buffer.join(""));
      buffer = [];
      charCount = 0;
    }
  }
  if (buffer.length > 0) {
    chunks.push(buffer.join(""));
  }
  return chunks.length > 0 ? chunks : [normalized];
}
function renderBufferedBlock(lines) {
  const cleaned = (lines || []).map((line) => String(line || "").trim()).filter((line) => line.length > 0);
  if (cleaned.length === 0) return [];
  const isUnorderedList = cleaned.every((line) => /^[-*+]\s+/.test(line));
  if (isUnorderedList) {
    const items = cleaned.map((line) => line.replace(/^[-*+]\s+/, "").trim()).filter(Boolean).map((item) => `<li>${item}</li>`).join("\n");
    return [`<ul>
${items}
</ul>`];
  }
  const isOrderedList = cleaned.every((line) => /^\d+[.)]\s+/.test(line));
  if (isOrderedList) {
    const items = cleaned.map((line) => line.replace(/^\d+[.)]\s+/, "").trim()).filter(Boolean).map((item) => `<li>${item}</li>`).join("\n");
    return [`<ol>
${items}
</ol>`];
  }
  const merged = cleaned.join(" ").replace(/\s+/g, " ").trim();
  return splitLongParagraphForReadability(merged).map((paragraph) => `<p>${paragraph}</p>`);
}
function wrapPlainTextBlocksWithParagraphs(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const output = [];
  let buffer = [];
  const flushBuffer = () => {
    const rendered = renderBufferedBlock(buffer);
    if (rendered.length > 0) {
      output.push(...rendered);
    }
    buffer = [];
  };
  for (const rawLine of lines) {
    const line = String(rawLine || "").trim();
    if (!line) {
      flushBuffer();
      continue;
    }
    if (/^<h[1-6][^>]*>[\s\S]*<\/h[1-6]>$/i.test(line)) {
      flushBuffer();
      output.push(line);
      continue;
    }
    if (/^<(ul|ol|li|p|blockquote|pre|table)\b/i.test(line)) {
      flushBuffer();
      output.push(line);
      continue;
    }
    buffer.push(line);
  }
  flushBuffer();
  return output.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}
function formatContentForWordPress(rawContent) {
  let text = String(rawContent ?? "");
  text = text.replace(/^\s*######\s+(.+)$/gm, "<h6>$1</h6>").replace(/^\s*#####\s+(.+)$/gm, "<h5>$1</h5>").replace(/^\s*####\s+(.+)$/gm, "<h4>$1</h4>").replace(/^\s*###\s+(.+)$/gm, "<h3>$1</h3>").replace(/^\s*##\s+(.+)$/gm, "<h2>$1</h2>").replace(/^\s*#\s+(.+)$/gm, "<h1>$1</h1>");
  text = text.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/\*(.+?)\*/g, "<em>$1</em>");
  text = text.replace(/\*\*/g, "");
  return wrapPlainTextBlocksWithParagraphs(text);
}
function normalizeComparableText2(value) {
  return String(value || "").replace(/^#{1,6}\s+/, "").replace(/^<h[1-6][^>]*>/i, "").replace(/<\/h[1-6]>$/i, "").replace(/^(タイトル|見出し|heading|title)\s*[:：]\s*/i, "").replace(/^[Tt]itle[:：]\s*/, "").toLowerCase().replace(/[\s\u3000]/g, "").replace(/[「」『』（）()【】\[\]"'`]/g, "").replace(/[、。,.・:：]/g, "").trim();
}
function extractHeadingText(line) {
  const trimmed = String(line || "").trim();
  const markdown = trimmed.match(/^#{1,6}\s+(.+)$/);
  if (markdown?.[1]) return markdown[1].trim();
  const html = trimmed.match(/^<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>$/i);
  if (html?.[1]) return html[1].replace(/<[^>]+>/g, "").trim();
  return trimmed;
}
function isHeadingLine(line) {
  const trimmed = String(line || "").trim();
  return /^#{1,6}\s+.+$/.test(trimmed) || /^<h[1-6][^>]*>[\s\S]*<\/h[1-6]>$/i.test(trimmed);
}
function findNextNonEmptyLineIndex(lines, startIndex) {
  for (let i = startIndex; i < lines.length; i++) {
    if (String(lines[i] || "").trim()) return i;
  }
  return -1;
}
function isLikelyBodyLine(line) {
  const text = String(line || "").trim();
  if (!text) return false;
  if (isHeadingLine(text)) return false;
  if (/^[-*+]\s|^\d+[.)]\s|^[・●■◆]\s?/.test(text)) return true;
  return text.length >= 20 || /[。！？!?]$/.test(text);
}
function looksLikeStandaloneHeadingLine(line) {
  const text = String(line || "").trim();
  if (!text) return false;
  if (isHeadingLine(text)) return false;
  if (/^[-*+]\s|^\d+[.)]\s|^[・●■◆]\s?/.test(text)) return false;
  if (/^https?:\/\//i.test(text)) return false;
  if (text.length < 5 || text.length > 90) return false;
  if (/[。！？!?]$/.test(text)) return false;
  return /[A-Za-z0-9\u3040-\u30ff\u3400-\u9fff]/.test(text);
}
function isSummaryHeadingText(text) {
  const normalized = normalizeComparableText2(text);
  if (!normalized) return false;
  const tokens = ["\u307E\u3068\u3081", "\u7D50\u8AD6", "\u8981\u7D04", "\u7DCF\u62EC", "summary", "conclusion"];
  return tokens.some((token) => normalized.includes(normalizeComparableText2(token)));
}
function sanitizeHeadingLabel(text) {
  return String(text || "").replace(/^[\d０-９]+[.)．、:：]\s*/, "").replace(/^[・●■◆]\s*/, "").replace(/[。！？!?]\s*$/, "").replace(/\s{2,}/g, " ").trim();
}
function expandSimpleH2Heading(title) {
  const current = sanitizeHeadingLabel(title);
  if (!current || isSummaryHeadingText(current)) return current;
  return current;
}
function getHeadingLevel(line) {
  const trimmed = String(line || "").trim();
  const markdown = trimmed.match(/^(#{1,6})\s+(.+)$/);
  if (markdown?.[1]) return markdown[1].length;
  const html = trimmed.match(/^<h([1-6])[^>]*>[\s\S]*<\/h[1-6]>$/i);
  if (html?.[1]) return Number(html[1]);
  return 0;
}
function rewriteHeadingLine(originalLine, level, title) {
  const safeLevel = Math.min(6, Math.max(1, Math.floor(level)));
  const safeTitle = String(title || "").trim();
  if (!safeTitle) return originalLine;
  if (/^<h[1-6][^>]*>[\s\S]*<\/h[1-6]>$/i.test(String(originalLine || "").trim())) {
    return `<h${safeLevel}>${safeTitle}</h${safeLevel}>`;
  }
  return `${"#".repeat(safeLevel)} ${safeTitle}`;
}
function normalizeHeadingHierarchy(lines) {
  const output = [...lines];
  for (let i = 0; i < output.length; i += 1) {
    const rawLine = String(output[i] || "");
    const trimmed = rawLine.trim();
    if (!isHeadingLine(trimmed)) continue;
    let level = getHeadingLevel(trimmed);
    if (!Number.isFinite(level) || level <= 0) continue;
    let title = sanitizeHeadingLabel(extractHeadingText(trimmed));
    if (!title) continue;
    if (level === 1) {
      level = 2;
    } else if (level > 3) {
      level = 3;
    }
    if (!isSummaryHeadingText(title)) {
      title = expandSimpleH2Heading(title);
    }
    output[i] = rewriteHeadingLine(rawLine, level, title);
  }
  return output;
}
function countNonSummaryHeadings(content) {
  const lines = String(content || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  let count = 0;
  for (const rawLine of lines) {
    const trimmed = String(rawLine || "").trim();
    if (!trimmed) continue;
    let level = 0;
    const markdownMatch = trimmed.match(/^(#{1,6})\s+.+$/);
    if (markdownMatch?.[1]) {
      level = markdownMatch[1].length;
    } else {
      const htmlMatch = trimmed.match(/^<h([1-6])[^>]*>[\s\S]*<\/h[1-6]>$/i);
      if (htmlMatch?.[1]) {
        level = Number(htmlMatch[1]);
      }
    }
    if (!Number.isFinite(level) || level < 2) continue;
    const headingText = extractHeadingText(trimmed);
    if (!headingText || isSummaryHeadingText(headingText)) continue;
    count += 1;
  }
  return count;
}
function removeDuplicateSummarySections(lines) {
  const headingRows = [];
  for (let i = 0; i < lines.length; i++) {
    const text = String(lines[i] || "").trim();
    if (!isHeadingLine(text)) continue;
    let nextHeading = lines.length;
    for (let j = i + 1; j < lines.length; j++) {
      const nextText = String(lines[j] || "").trim();
      if (isHeadingLine(nextText)) {
        nextHeading = j;
        break;
      }
    }
    const bodyLength = lines.slice(i + 1, nextHeading).join(" ").replace(/\s+/g, "").length;
    headingRows.push({
      start: i,
      end: nextHeading,
      headingText: extractHeadingText(text),
      bodyLength
    });
  }
  const summaryRows = headingRows.filter((row) => isSummaryHeadingText(row.headingText));
  if (summaryRows.length <= 1) return lines;
  const keepRow = summaryRows.slice().sort((a, b) => b.bodyLength - a.bodyLength)[0];
  const removeRanges = summaryRows.filter((row) => row.start !== keepRow.start).map((row) => ({ start: row.start, end: row.end }));
  if (removeRanges.length === 0) return lines;
  const filtered = lines.filter((_, index) => {
    return !removeRanges.some((range) => index >= range.start && index < range.end);
  });
  console.log(`Removed duplicate summary sections: ${removeRanges.length} removed`);
  return filtered;
}
function shouldRemoveLeadingTitleLine(line, articleTitle) {
  const raw = extractHeadingText(line);
  if (!raw) return false;
  const looksHeadingLike = isHeadingLine(line) || raw.length <= 80 && !/[邵ｲ繧托ｽｼ繝ｻ・ｼ繝ｻ!?]$/.test(raw) && /[A-Za-z0-9\u3040-\u30ff\u3400-\u9fff]/.test(raw);
  if (!looksHeadingLike) return false;
  const normalizedLine = normalizeComparableText2(raw);
  const normalizedTitle = normalizeComparableText2(articleTitle);
  if (!normalizedLine || !normalizedTitle) return false;
  const withoutSummary = normalizeComparableText2(raw.replace(/繝ｻ驛・ｽｦ竏ｫ・ｴ繝ｻ・ｼ讎蚕(髫補悪・ｴﾐｫ)|邵ｲ蜊・ｦ竏ｫ・ｴ繝ｻﾂ謗・囎竏ｫ・ｴ繝ｻ/g, ""));
  if (normalizedLine === normalizedTitle) return true;
  if (withoutSummary === normalizedTitle) return true;
  const lineIsShortEnough = raw.length <= articleTitle.length * 1.3 + 10;
  if (lineIsShortEnough && (normalizedLine.startsWith(normalizedTitle) || normalizedTitle.startsWith(normalizedLine))) return true;
  const hasSummarySuffix = /(繝ｻ驛・ｽｦ竏ｫ・ｴ繝ｻ・ｼ讎蚕(髫補悪・ｴﾐｫ)|邵ｲ蜊・ｦ竏ｫ・ｴ繝ｻﾂ謗・囎竏ｫ・ｴ繝ｻ)/.test(raw);
  if (hasSummarySuffix && (normalizedLine.includes(normalizedTitle) || withoutSummary.includes(normalizedTitle))) {
    return true;
  }
  const minComparable = Math.min(normalizedLine.length, normalizedTitle.length);
  if (minComparable >= 10) {
    let commonPrefixLen = 0;
    while (commonPrefixLen < minComparable && normalizedLine[commonPrefixLen] === normalizedTitle[commonPrefixLen]) {
      commonPrefixLen += 1;
    }
    const prefixRate = commonPrefixLen / Math.max(1, minComparable);
    if (prefixRate >= 0.72) return true;
  }
  return false;
}
function normalizeGeneratedContentForPublishing(rawContent, articleTitle) {
  let text = String(rawContent ?? "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").replace(/\uFEFF/g, "").trim();
  if (!text) return "";
  let lines = text.split("\n");
  const firstHeadingIndex = findNextNonEmptyLineIndex(lines, 0);
  if (firstHeadingIndex !== -1 && getHeadingLevel(lines[firstHeadingIndex]) === 1) {
    lines.splice(firstHeadingIndex, 1);
  }
  const firstLineIndex = findNextNonEmptyLineIndex(lines, 0);
  if (firstLineIndex !== -1 && shouldRemoveLeadingTitleLine(lines[firstLineIndex], articleTitle)) {
    lines.splice(firstLineIndex, 1);
  }
  for (let pass = 0; pass < 2; pass += 1) {
    const idx = findNextNonEmptyLineIndex(lines, 0);
    if (idx === -1) break;
    if (!shouldRemoveLeadingTitleLine(lines[idx], articleTitle)) break;
    lines.splice(idx, 1);
  }
  for (let i = 0; i < lines.length; i++) {
    const current = String(lines[i] || "").trim();
    if (!looksLikeStandaloneHeadingLine(current)) continue;
    const nextIndex = findNextNonEmptyLineIndex(lines, i + 1);
    if (nextIndex === -1) continue;
    const next = String(lines[nextIndex] || "").trim();
    if (isHeadingLine(next)) continue;
    if (!isLikelyBodyLine(next)) continue;
    const normalizedHeading = expandSimpleH2Heading(current) || sanitizeHeadingLabel(current) || current;
    lines[i] = `## ${normalizedHeading}`;
  }
  lines = normalizeHeadingHierarchy(lines);
  lines = removeDuplicateSummarySections(lines);
  const withoutEmptyHeadings = [];
  for (let i = 0; i < lines.length; i++) {
    const rawLine = String(lines[i] || "");
    const trimmed = rawLine.trim();
    if (!trimmed) {
      withoutEmptyHeadings.push(rawLine);
      continue;
    }
    if (!isHeadingLine(trimmed)) {
      withoutEmptyHeadings.push(rawLine);
      continue;
    }
    const nextIndex = findNextNonEmptyLineIndex(lines, i + 1);
    if (nextIndex === -1) continue;
    const next = String(lines[nextIndex] || "").trim();
    if (isHeadingLine(next)) continue;
    withoutEmptyHeadings.push(rawLine);
  }
  lines = withoutEmptyHeadings;
  lines = normalizeHeadingHierarchy(lines);
  lines = removeDuplicateSummarySections(lines);
  let cleaned = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const postLines = cleaned.split("\n");
  const postFirstHeadingIndex = findNextNonEmptyLineIndex(postLines, 0);
  if (postFirstHeadingIndex !== -1 && getHeadingLevel(postLines[postFirstHeadingIndex]) === 1) {
    postLines.splice(postFirstHeadingIndex, 1);
  }
  const postFirstLineIndex = findNextNonEmptyLineIndex(postLines, 0);
  if (postFirstLineIndex !== -1 && shouldRemoveLeadingTitleLine(postLines[postFirstLineIndex], articleTitle)) {
    postLines.splice(postFirstLineIndex, 1);
  }
  cleaned = postLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return cleaned;
}
function extractExcerpt(content, maxLength = 180) {
  const plain = String(content || "").replace(/^#{1,6}\s+/gm, "").replace(/\*\*/g, "").replace(/\*/g, "").replace(/!\[[^\]]*]\([^)]+\)/g, "").replace(/\[[^\]]+]\([^)]+\)/g, "$1").replace(/\s+/g, " ").trim();
  if (plain.length <= maxLength) return plain;
  return `${plain.slice(0, maxLength)}...`;
}
function inferLengthCategory(charCount) {
  if (charCount < 1200) return "short";
  if (charCount < 2400) return "medium";
  return "long";
}
async function saveGeneratedArticleSnapshot(supabase, params) {
  const wordCount = countGeneratedChars(params.content);
  const readingTime = Math.max(1, Math.round(wordCount / 500));
  const payload = {
    title: params.title,
    content: params.content,
    excerpt: extractExcerpt(params.content),
    keywords: params.keywords,
    category: params.wpConfig.category || "",
    status: params.status,
    tone: params.tone,
    length: inferLengthCategory(wordCount),
    ai_provider: params.aiConfig.provider || "",
    ai_model: params.aiConfig.model || "",
    published_at: params.publishedAt ?? null,
    wordpress_post_id: params.postId ?? "",
    wordpress_config_id: params.wpConfig.id,
    reading_time: readingTime,
    word_count: wordCount,
    trend_data: {}
  };
  const { data, error } = await supabase.from("articles").insert(payload).select("id").single();
  if (error) {
    console.error("Failed to save generated article snapshot:", error);
    return null;
  }
  const articleId = data?.id ? String(data.id) : null;
  if (articleId) {
    console.log(`Saved generated article snapshot: ${articleId}`);
  }
  return articleId;
}
async function publishToWordPress(config, title, content, status) {
  const auth = btoa(`${config.username}:${config.password}`);
  const postType = config.post_type || "posts";
  const wpApiUrl = `${config.url}/wp-json/wp/v2/${postType}`;
  console.log(`Publishing to WordPress: ${wpApiUrl}`);
  const termAssignment = config.category ? await resolveTermAssignmentForPostType(config, postType, config.category) : null;
  let categoryIds = [];
  if (config.category) {
    const trimmed = config.category.trim();
    const parsed = parseInt(trimmed, 10);
    if (!isNaN(parsed)) {
      categoryIds = [parsed];
      console.log(`Using category ID: ${parsed}`);
    } else {
      console.log(`Looking up category by slug/name: ${trimmed}`);
      const categoryId = await getCategoryIdBySlugOrName(config, trimmed);
      if (categoryId) {
        categoryIds = [categoryId];
        console.log(`Found category ID: ${categoryId} for "${trimmed}"`);
      } else {
        console.warn(`Category "${trimmed}" not found. WordPress will use default category.`);
      }
    }
  }
  const postPayload = {
    title,
    content: formatContentForWordPress(content),
    status
  };
  if (termAssignment) {
    postPayload[termAssignment.field] = termAssignment.ids;
    console.log(`Using taxonomy field "${termAssignment.field}" for "${config.category}": ${termAssignment.ids.join(", ")}`);
  } else {
    postPayload.categories = categoryIds;
  }
  const requestBody = JSON.stringify(postPayload);
  const postWithEndpoint = async (endpoint) => {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Basic ${auth}`
      },
      body: requestBody
    });
    if (!response.ok) {
      const text = await response.text();
      return { ok: false, status: response.status, text };
    }
    const data = await response.json();
    return { ok: true, postId: String(data.id) };
  };
  const primary = await postWithEndpoint(wpApiUrl);
  if (primary.ok) {
    return primary.postId;
  }
  const primaryErrorText = String(primary.text || "");
  const shouldFallbackToPosts = postType !== "posts" && (primary.status === 404 || /rest_no_route|invalid[_ ]post[_ ]type|post[_ ]type/i.test(primaryErrorText));
  if (!shouldFallbackToPosts) {
    throw new Error(`WordPress API error: ${primary.status} - ${primaryErrorText}`);
  }
  const fallbackUrl = `${config.url}/wp-json/wp/v2/posts`;
  console.warn(`Primary post_type "${postType}" failed. Falling back to default posts endpoint: ${fallbackUrl}`);
  const fallback = await postWithEndpoint(fallbackUrl);
  if (fallback.ok) {
    return fallback.postId;
  }
  throw new Error(
    `WordPress API error on both endpoints. primary(${wpApiUrl}): ${primary.status} - ${primaryErrorText}; fallback(${fallbackUrl}): ${fallback.status} - ${fallback.text}`
  );
}
function formatOutlineForSinglePass(outline) {
  return (outline.sections || []).map((section, index) => {
    const level = section.isLead ? "lead" : section.level === 3 ? "H3" : "H2";
    const indent = section.level === 3 ? "   " : "";
    const chars = section.estimatedWordCount ? ` (${section.estimatedWordCount}\u5B57)` : "";
    const description = section.description ? ` \u2014 ${section.description}` : "";
    return `${indent}${index + 1}. [${level}] ${section.title}${chars}${description}`;
  }).join("\n");
}
function validateGeneratedArticleCompleteness(content, outline, targetWordCount) {
  const normalized = String(content || "").trim();
  const charCount = countGeneratedChars(normalized);
  const minChars = Math.max(500, Math.round(Math.max(800, targetWordCount) * 0.75));
  if (charCount < minChars) {
    throw new Error(`Generated article is too short (${charCount}/${targetWordCount} chars). AI output may have stopped midway.`);
  }
  const expectedHeadings = (outline.sections || []).filter((section) => !section.isLead).length;
  const actualHeadings = countNonSummaryHeadings(normalized);
  const minHeadings = Math.min(Math.max(2, Math.floor(expectedHeadings * 0.5)), expectedHeadings);
  if (expectedHeadings >= 3 && actualHeadings < minHeadings) {
    throw new Error(`Generated article is missing headings (${actualHeadings}/${expectedHeadings}). AI output may be incomplete.`);
  }
  const lines = normalized.split("\n").map((line) => line.trim()).filter(Boolean);
  const lastTextLine = lines.slice().reverse().find((line) => !/^#{1,6}\s/.test(line) && !/^[-*]\s/.test(line) && line.length >= 20) || "";
  if (lastTextLine && !/[。！？.!?」』）)\w]$/.test(lastTextLine)) {
    console.warn(`Generated article may end mid-sentence: ${trimForLog(lastTextLine, 120)}`);
  }
}
function compactArticleToTargetLength(content, targetWordCount) {
  const maxChars = Math.round(Math.max(800, targetWordCount) * 1.2);
  let text = String(content || "").trim();
  if (!text || countGeneratedChars(text) <= maxChars) return text;
  const blocks = text.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean);
  const compacted = [];
  for (const block of blocks) {
    const isHeading = /^#{1,6}\s+/.test(block) || /^<h[1-6][^>]*>/i.test(block);
    if (isHeading) {
      compacted.push(block);
      continue;
    }
    const sentences = block.split(/(?<=[。！？!?])\s*/).map((sentence) => sentence.trim()).filter(Boolean);
    const reduced = sentences.length >= 3 ? sentences.slice(0, Math.max(1, Math.ceil(sentences.length * 0.65))).join("") : block;
    compacted.push(reduced);
  }
  text = compacted.join("\n\n").trim();
  if (countGeneratedChars(text) <= maxChars) return text;
  const shortened = [];
  let current = 0;
  for (const block of compacted) {
    const length = countGeneratedChars(block);
    if (!/^#{1,6}\s+/.test(block) && current + length > maxChars) {
      continue;
    }
    shortened.push(block);
    current += length;
  }
  return shortened.join("\n\n").trim() || text;
}
async function generateSchedulerArticleSinglePass(params) {
  const outlineText = formatOutlineForSinglePass(params.outline);
  const keywordLine = Array.from(new Set([params.keyword, ...params.keywords || []].map((item) => String(item || "").trim()).filter(Boolean))).slice(0, 6).join(", ");
  const toneInstruction = params.tone === "casual" ? "Tone: natural, approachable Japanese. Use desu/masu consistently." : "Tone: professional Japanese for business readers. Use desu/masu consistently.";
  const hardMaxChars = Math.round(params.targetWordCount * 1.2);
  const hardMinChars = Math.round(params.targetWordCount * 0.85);
  const prompt = [
    "Write a complete Japanese article in Markdown.",
    "",
    `Title: ${params.outline.title}`,
    `Main keyword: ${params.keyword}`,
    keywordLine ? `Related keywords: ${keywordLine}` : "",
    `Target length: ${params.targetWordCount} Japanese characters. Stay between ${hardMinChars} and ${hardMaxChars} characters. Stop writing once the article reaches ${hardMaxChars} characters \u2014 do NOT exceed this limit.`,
    toneInstruction,
    "",
    "Hard requirements:",
    "- Output only the article body. Do not include explanations, JSON, code fences, or notes.",
    "- Do not repeat the title as an H1.",
    '- Follow the outline structure exactly. Write every [H2] entry as "##" and every [H3] entry as "###". Do NOT skip any heading.',
    "- [H3] entries (indented in the outline) are sub-sections of the preceding [H2]. Always place them inside that H2 section.",
    '- Write 2 to 3 short lead paragraphs BEFORE the first "##" heading.',
    "- H2 sections: 1-2 paragraphs of body text (2-4 sentences each).",
    "- H3 sections: 1-2 paragraphs of body text (2-4 sentences each). Keep each H3 concise to stay within the character limit.",
    "- Separate EVERY paragraph with a blank line (one empty line between paragraphs).",
    "- Separate headings from surrounding paragraphs with a blank line.",
    "- Avoid unfinished sentences and placeholder text.",
    "",
    "Outline (indented entries = H3 sub-sections):",
    outlineText,
    "",
    params.customInstructions ? `Additional instructions:
${params.customInstructions}` : ""
  ].filter(Boolean).join("\n");
  const maxTokens = Math.min(
    12e3,
    Math.max(3e3, Math.ceil(params.targetWordCount * 2.5))
  );
  const raw = await callAI(prompt, params.aiConfig, maxTokens);
  const fullContent = String(raw || "").trim();
  if (!fullContent) {
    throw new Error("Single-pass article generation returned empty content");
  }
  validateGeneratedArticleCompleteness(fullContent, params.outline, params.targetWordCount);
  return {
    sectionsWithContent: [],
    fullContent,
    wordCount: countGeneratedChars(fullContent)
  };
}
async function sendChatworkNotifications(apiToken, roomIdsStr, template, title, url, keyword, status) {
  const roomIds = roomIdsStr.split(",").map((id) => id.trim()).filter((id) => id);
  if (roomIds.length === 0) return;
  let body = template;
  if (!body) {
    body = `\u4E88\u7D04\u6295\u7A3F\u304C\u5B8C\u4E86\u3057\u307E\u3057\u305F\u3002

\u30BF\u30A4\u30C8\u30EB:
{title}

\u30AD\u30FC\u30EF\u30FC\u30C9:
{keyword}

\u6295\u7A3FURL:
{url}

\u6295\u7A3F\u72B6\u614B:
{status}`;
  }
  body = body.replace(/{title}/g, title).replace(/{url}/g, url).replace(/{status}/g, status);
  const keywordValue = String(keyword || "").trim();
  const normalizedLines = body.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const filteredLines = [];
  for (const rawLine of normalizedLines) {
    const line = String(rawLine || "");
    if (!keywordValue && line.includes("{keyword}")) {
      continue;
    }
    const replaced = line.replace(/{keyword}/g, keywordValue);
    if (!keywordValue) {
      const trimmed = replaced.trim();
      if (/^(?:キーワード|Keyword)[:：]?\s*$/i.test(trimmed)) {
        continue;
      }
    }
    filteredLines.push(replaced);
  }
  body = filteredLines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  const errors = [];
  for (const roomId of roomIds) {
    try {
      const response = await fetch(`https://api.chatwork.com/v2/rooms/${roomId}/messages`, {
        method: "POST",
        headers: {
          "X-ChatWorkToken": apiToken,
          "Content-Type": "application/x-www-form-urlencoded"
        },
        body: `body=${encodeURIComponent(body)}`
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`Status ${response.status}: ${text}`);
      }
      console.log(`Chatwork message sent to room ${roomId}`);
    } catch (error) {
      console.error(`Failed to send to Chatwork room ${roomId}:`, error);
      errors.push(error);
    }
  }
}
function isLikelyJwt(value) {
  const token = String(value || "").trim();
  if (!token) return false;
  const parts = token.split(".");
  return parts.length === 3 && parts.every((part) => part.length > 0);
}
function trimForLog(text, maxLength) {
  const normalized = String(text || "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, maxLength)}...`;
}
function formatScheduleFailureReason(error) {
  const raw = error instanceof Error ? error.message : String(error || "");
  const message = trimForLog(raw, 700) || "Unknown error";
  const lower = message.toLowerCase();
  if (message.includes("H3") || message.includes("\u898B\u51FA\u3057") || message.includes("\u30A2\u30A6\u30C8\u30E9\u30A4\u30F3") || lower.includes("outline")) {
    return `\u30A2\u30A6\u30C8\u30E9\u30A4\u30F3\u307E\u305F\u306F\u898B\u51FA\u3057\u751F\u6210\u3067\u5931\u6557\u3057\u307E\u3057\u305F: ${message}`;
  }
  return message;
}
function getFirstScheduleKeyword(schedule) {
  return String(schedule.keyword || "").split(",").map((item) => item.trim()).filter(Boolean)[0] || "";
}
function buildGenerationDebug(params) {
  const sections = params.outline?.sections || [];
  const h2 = sections.filter((section) => section.level !== 3 && !section.isLead);
  const h3 = sections.filter((section) => section.level === 3);
  return {
    title: params.title || "",
    keyword: params.keyword || "",
    target_word_count: params.targetWordCount || null,
    generated_chars: params.generatedChars || 0,
    h2_count: h2.length,
    h3_count: h3.length,
    headings: sections.map((section) => ({
      level: section.isLead ? "lead" : `h${section.level === 3 ? 3 : 2}`,
      title: section.title,
      estimated_word_count: section.estimatedWordCount
    })),
    related_keywords: (params.relatedKeywords || []).slice(0, 12),
    competitor_headings_sample: (params.competitorHeadings || []).slice(0, 12),
    publish_error_message: params.publishErrorMessage || null
  };
}
function isPublishFailureAlreadyRecorded(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  return message.startsWith("WordPress publish failed:");
}
async function markStaleRunningExecutionsFailed(supabase) {
  const thresholdIso = new Date(Date.now() - STALE_RUNNING_EXECUTION_MINUTES * 60 * 1e3).toISOString();
  const reason = `\u5B9F\u884C\u304C${STALE_RUNNING_EXECUTION_MINUTES}\u5206\u4EE5\u4E0A\u9032\u307E\u306A\u304B\u3063\u305F\u305F\u3081\u505C\u6B62\u6271\u3044\u306B\u3057\u307E\u3057\u305F\u3002AI\u5FDC\u7B54\u5F85\u3061\u3001Edge Function\u306E\u30BF\u30A4\u30E0\u30A2\u30A6\u30C8\u3001\u307E\u305F\u306F\u5916\u90E8API\u505C\u6B62\u306E\u53EF\u80FD\u6027\u304C\u3042\u308A\u307E\u3059\u3002`;
  try {
    const { data, error } = await supabase.from("execution_history").update({
      status: "failed",
      error_message: reason
    }).eq("status", "running").lt("executed_at", thresholdIso).select("id");
    if (error) {
      console.warn("Failed to mark stale running executions:", error);
      return;
    }
    if (Array.isArray(data) && data.length > 0) {
      console.warn(`Marked ${data.length} stale running execution(s) as failed.`);
    }
  } catch (error) {
    console.warn("Unexpected error while marking stale running executions:", error);
  }
}
async function clearScheduleExecutionState(supabase, scheduleId) {
  const reason = "\u5B9F\u884C\u30ED\u30C3\u30AF\u3092\u624B\u52D5\u89E3\u9664\u3057\u305F\u305F\u3081\u3001\u3053\u306E\u5B9F\u884C\u3092\u505C\u6B62\u6271\u3044\u306B\u3057\u307E\u3057\u305F\u3002";
  let locksDeleted = 0;
  let runningMarkedFailed = 0;
  try {
    const { data: lockRows, error: lockError } = await supabase.from("scheduler_execution_locks").delete().eq("schedule_id", scheduleId).select("schedule_id");
    if (lockError) {
      console.warn(`Failed to delete scheduler execution locks for ${scheduleId}:`, lockError);
    } else {
      locksDeleted = Array.isArray(lockRows) ? lockRows.length : 0;
    }
  } catch (error) {
    console.warn(`Unexpected error deleting scheduler execution locks for ${scheduleId}:`, error);
  }
  try {
    const { data: runningRows, error: runningError } = await supabase.from("execution_history").update({
      status: "failed",
      error_message: reason
    }).eq("schedule_id", scheduleId).eq("status", "running").select("id");
    if (runningError) {
      console.warn(`Failed to mark running execution histories failed for ${scheduleId}:`, runningError);
    } else {
      runningMarkedFailed = Array.isArray(runningRows) ? runningRows.length : 0;
    }
  } catch (error) {
    console.warn(`Unexpected error marking running histories failed for ${scheduleId}:`, error);
  }
  console.log(`Cleared execution state for ${scheduleId}: locks=${locksDeleted}, running=${runningMarkedFailed}`);
  return { locksDeleted, runningMarkedFailed };
}
async function recordScheduleExecutionFailure(supabase, schedule, wpConfig, aiConfig, error, triggerType = "automatic") {
  if (isPublishFailureAlreadyRecorded(error)) return;
  const reason = formatScheduleFailureReason(error);
  try {
    const failureHistoryPayload = {
      account_id: schedule.account_id || wpConfig.account_id || null,
      schedule_id: schedule.id,
      wordpress_config_id: wpConfig.id,
      executed_at: (/* @__PURE__ */ new Date()).toISOString(),
      keyword_used: getFirstScheduleKeyword(schedule),
      article_title: "",
      wordpress_post_id: "",
      status: "failed",
      error_message: reason,
      cost_breakdown: {
        trigger_type: triggerType,
        generation_debug: {
          failure_stage: "generation_or_quality_check",
          provider: aiConfig.provider || "",
          model: aiConfig.model || "",
          target_word_count: schedule.target_word_count || null,
          writing_tone: schedule.writing_tone || "",
          reason
        }
      },
      estimated_cost_usd: 0
    };
    let runningHistoryId = null;
    let insertResult = await supabase.from("execution_history").select("id").eq("schedule_id", schedule.id).eq("status", "running").order("executed_at", { ascending: false }).limit(1).maybeSingle();
    if (!insertResult.error && insertResult.data?.id) {
      runningHistoryId = insertResult.data.id;
      insertResult = await supabase.from("execution_history").update(failureHistoryPayload).eq("id", runningHistoryId);
    } else {
      insertResult = await supabase.from("execution_history").insert(failureHistoryPayload);
    }
    if (isMissingColumnError(insertResult.error, "account_id")) {
      console.warn("execution_history.account_id is missing. Retrying failed history save without account_id.");
      delete failureHistoryPayload.account_id;
      insertResult = runningHistoryId ? await supabase.from("execution_history").update(failureHistoryPayload).eq("id", runningHistoryId) : await supabase.from("execution_history").insert(failureHistoryPayload);
    }
    const { error: insertError } = insertResult;
    if (insertError) {
      console.error("Failed to save failed execution history:", insertError);
    }
  } catch (historyError) {
    console.error("Failed to record scheduler failure:", historyError);
  }
}
async function recordForceExecutionSkippedByLock(supabase, schedule, wpConfig) {
  const reason = "\u524D\u56DE\u306E\u4E88\u7D04\u6295\u7A3F\u5B9F\u884C\u30ED\u30C3\u30AF\u304C\u307E\u3060\u6709\u52B9\u3067\u3059\u3002\u524D\u306E\u51E6\u7406\u304C\u5B9F\u884C\u4E2D\u3001\u307E\u305F\u306F\u7570\u5E38\u7D42\u4E86\u5F8C\u306E\u30ED\u30C3\u30AF\u671F\u9593\u5F85\u3061\u3067\u3059\u3002\u6570\u5206\u5F8C\u306B\u518D\u5B9F\u884C\u3059\u308B\u304B\u3001\u30ED\u30C3\u30AF\u3092\u89E3\u9664\u3057\u3066\u304F\u3060\u3055\u3044\u3002";
  const payload = {
    account_id: schedule.account_id || wpConfig.account_id || null,
    schedule_id: schedule.id,
    wordpress_config_id: wpConfig.id,
    executed_at: (/* @__PURE__ */ new Date()).toISOString(),
    keyword_used: getFirstScheduleKeyword(schedule),
    article_title: "",
    wordpress_post_id: "",
    status: "failed",
    error_message: reason,
    cost_breakdown: {
      trigger_type: "manual",
      generation_debug: {
        failure_stage: "execution_lock",
        current_stage: "execution_lock",
        progress_message: reason,
        progress_percent: 0,
        reason
      }
    },
    estimated_cost_usd: 0
  };
  try {
    let result = await supabase.from("execution_history").insert(payload);
    if (isMissingColumnError(result.error, "account_id")) {
      delete payload.account_id;
      result = await supabase.from("execution_history").insert(payload);
    }
    if (result.error) {
      console.error("Failed to save force execution lock skip history:", result.error);
    }
  } catch (error) {
    console.error("Failed to record force execution lock skip:", error);
  }
}
async function getCategoryIdBySlugOrName(config, categoryIdentifier) {
  return getTermIdBySlugOrName(config, "categories", categoryIdentifier);
}
async function getTaxonomyCandidatesForPostType(config, postType) {
  const candidates = [];
  const addCandidate = (field, restBase) => {
    if (!field || !restBase) return;
    if (candidates.some((item) => item.field === field || item.restBase === restBase)) return;
    candidates.push({ field, restBase });
  };
  if (postType === "posts") {
    addCandidate("categories", "categories");
    return candidates;
  }
  const normalizedPostType = String(postType || "").trim();
  const auth = btoa(`${config.username}:${config.password}`);
  try {
    const optionsResponse = await fetch(
      `${config.url}/wp-json/wp/v2/${postType}`,
      {
        method: "OPTIONS",
        headers: { "Authorization": `Basic ${auth}` }
      }
    );
    if (optionsResponse.ok) {
      const schema = await optionsResponse.json();
      const properties = schema?.schema?.properties || schema?.endpoints?.[0]?.schema?.properties || {};
      const ignoredFields = /* @__PURE__ */ new Set([
        "id",
        "date",
        "date_gmt",
        "guid",
        "modified",
        "modified_gmt",
        "slug",
        "status",
        "type",
        "link",
        "title",
        "content",
        "excerpt",
        "author",
        "featured_media",
        "comment_status",
        "ping_status",
        "template",
        "meta",
        "permalink_template",
        "generated_slug",
        "tags"
      ]);
      for (const [fieldName, definition] of Object.entries(properties)) {
        if (ignoredFields.has(fieldName)) continue;
        const item = definition;
        const itemType = item?.items?.type || item?.items?.[0]?.type;
        if (item?.type === "array" && (itemType === "integer" || itemType === "number")) {
          addCandidate(fieldName, fieldName);
        }
      }
    }
  } catch (error) {
    console.warn(`Failed to inspect REST schema for post type "${postType}":`, error);
  }
  try {
    const response = await fetch(
      `${config.url}/wp-json/wp/v2/taxonomies?type=${encodeURIComponent(postType)}`,
      { headers: { "Authorization": `Basic ${auth}` } }
    );
    if (!response.ok) return candidates;
    const taxonomies = await response.json();
    for (const [taxonomyName, taxonomy] of Object.entries(taxonomies || {})) {
      const item = taxonomy;
      if (item?.visibility?.show_in_rest === false) continue;
      if (item?.hierarchical === false) continue;
      const restBase = String(item?.rest_base || taxonomyName || "").trim();
      const field = restBase;
      addCandidate(field, restBase);
      addCandidate(String(taxonomyName), restBase);
    }
  } catch (error) {
    console.warn(`Failed to fetch taxonomies for post type "${postType}":`, error);
  }
  try {
    const response = await fetch(
      `${config.url}/wp-json/wp/v2/taxonomies`,
      { headers: { "Authorization": `Basic ${auth}` } }
    );
    if (response.ok) {
      const taxonomies = await response.json();
      for (const [taxonomyName, taxonomy] of Object.entries(taxonomies || {})) {
        const item = taxonomy;
        if (item?.visibility?.show_in_rest === false) continue;
        if (item?.hierarchical === false) continue;
        const types = Array.isArray(item?.types) ? item.types.map(String) : [];
        if (!types.includes(postType)) continue;
        const restBase = String(item?.rest_base || taxonomyName || "").trim();
        addCandidate(restBase, restBase);
        addCandidate(String(taxonomyName), restBase);
      }
    }
  } catch (error) {
    console.warn(`Failed to match all taxonomies for post type "${postType}":`, error);
  }
  [
    `${normalizedPostType}_category`,
    `${normalizedPostType}_cat`,
    `${normalizedPostType}-category`,
    `${normalizedPostType}-cat`,
    `${normalizedPostType}_categories`,
    `${normalizedPostType}-categories`
  ].forEach((candidate) => addCandidate(candidate, candidate));
  if (candidates.length === 0) {
    addCandidate("categories", "categories");
  }
  console.log(`Taxonomy candidates for post type "${postType}":`, candidates);
  return candidates;
}
async function resolveTermAssignmentForPostType(config, postType, categoryIdentifier) {
  const trimmed = String(categoryIdentifier || "").trim();
  if (!trimmed) return null;
  const candidates = await getTaxonomyCandidatesForPostType(config, postType);
  const explicitMatch = trimmed.match(/^([A-Za-z0-9_-]+)\s*[:：]\s*(.+)$/);
  if (explicitMatch) {
    const explicitField = explicitMatch[1].trim();
    const explicitTerm = explicitMatch[2].trim();
    const explicitId = await getTermIdBySlugOrName(config, explicitField, explicitTerm);
    if (explicitId) {
      return { field: explicitField, ids: [explicitId] };
    }
    console.warn(`Explicit taxonomy "${explicitField}" did not contain term "${explicitTerm}"`);
  }
  const parsed = parseInt(trimmed, 10);
  if (!isNaN(parsed)) {
    return { field: candidates[0]?.field || "categories", ids: [parsed] };
  }
  for (const candidate of candidates) {
    const termId = await getTermIdBySlugOrName(config, candidate.restBase, trimmed);
    if (termId) {
      return { field: candidate.field, ids: [termId] };
    }
  }
  return null;
}
async function notifyScheduleExecutionFailure(schedule, wpConfig, chatworkApiToken, error) {
  const roomIds = String(schedule.fact_check_alert_chatwork_room_id || schedule.chatwork_room_id || "").trim();
  if (!chatworkApiToken || !roomIds) return;
  const reason = formatScheduleFailureReason(error);
  const keyword = getFirstScheduleKeyword(schedule);
  const template = `[info][title]\u9AE2\uFF7E\u30FB\uFF6A\u9677\u698A\uFF62\u7058\u30FB\u9A55\u6A78\uFF7D\uFF7F\u90E2\uFF67\u96CB\u6A1E\u916A\u96CE\u30FB\uFF7D\uFF62\u90B5\uFF7A\u8709\uFF71\u7ACF\uFF6A\u90B5\uFF7A\u8709\uFF71\u7B33\u30FB/title]
\u90E2\uFF67\u30FB\uFF79\u90E2\uFF67\u30FB\uFF71\u90E2\uFF67\u30FB\uFF78\u90E2\u6662\uFF7D\uFF65\u90E2\u6662\uFF7D\uFF7C\u90E2\u6662\uFF7D\uFF6BID: ${schedule.id}
\u90E2\uFF67\u30FB\uFF75\u90E2\uFF67\u30FB\uFF64\u90E2\u6634\u30FB ${wpConfig.name}
URL: ${wpConfig.url}
\u90E2\uFF67\u30FB\uFF6D\u90E2\u6662\uFF7D\uFF7C\u90E2\u6662\uFF7D\uFF6F\u90E2\u6662\uFF7D\uFF7C\u90E2\u6634\u30FB {keyword}
\u9711\uFF65\u30FB\uFF76\u96B2\uFF77\u7E5D\uFF7B \u96B0\u58FD\u30FB\u30FB\uFF68\u30FB\uFF7F\u964B\u5E36\u32A7\u30FB\uFF6D\u30FB\uFF62

\u9A3E\u30FB\u30FB\u9102\uFF70:
${reason}

\u9AEB\uFF6A\u86DF\u30FB\uFF7D\uFF7A\u873F\uFF65\u86FB\x80\u9AEE\u4F1A\uFF7D\uFF6A\u90E2\uFF67\u96CB\u6A78\uFF7D\uFF6E\u86F9\uFF7B\u30FB\u72D7\uFF78\uFF7A\u8C85\u5047\uFF7D\u222B\uFF78\uFF72\u8389\u6350rdPress\u90B5\uFF7A\u30FB\uFF78\u90B5\uFF7A\u30FB\uFF6E\u96B0\u58FD\u30FB\u30FB\uFF68\u30FB\uFF7F\u90B5\uFF7A\u30FB\uFF6F\u9AEF\uFF66\u8815\u5A2F\u5922\u90B5\uFF7A\u30FB\uFF66\u90B5\uFF7A\u7E5D\uFF7B\u7ACF\uFF6A\u90B5\uFF7A\u87F6\u547B\uFF7D\u934B\uFF78\uFF72\u7E5D\uFF7BAI\u9AEB\uFF6A\u30FB\uFF6D\u965E\uFF73\u87A2\uFF79\uFF82\x80\u7ACF\u58F9\u30FB\u90E2\u6662\uFF7D\uFF6D\u90E2\u6662\uFF7D\uFF73\u90E2\u664F\u5E72\u7E5D\uFF68\u90B5\uFF72\u7ACF\u58F9\uFFE5\u90E2\u6662\uFF7D\uFF7C\u90E2\u6662\uFF7D\uFF6F\u90E2\u6662\uFF7D\uFF7C\u90E2\u664F\uFF73\uFF68\uFF82\x80\u7ACF\uFF6C\u30FB\uFF66\u873F\uFF65\u7E5D\uFF7B\u90B5\uFF7A\u9087\uFF72\u8B2B\u30FB\u8102\u30FB\uFF76\u90E2\uFF67\u8763\uFF64\u30FB\uFF62\u30FB\uFF7A\u9AEB\uFF71\u9AE6\uFF6A\u30FB\uF8F0\u90B5\uFF7A\u30FB\uFF66\u90B5\uFF7A\u8373\u5CA9\u5473\u90B5\uFF7A\u9708\u8CBB\uFF7C\u6A12\uFF78\uFF72\u7E5D\uFF7B[/info]`;
  try {
    await sendChatworkNotifications(
      chatworkApiToken,
      roomIds,
      template,
      "\u9AE2\uFF7E\u30FB\uFF6A\u9677\u698A\uFF62\u7058\u30FB\u9A55\u6A78\uFF7D\uFF7F\u964B\u5E36\u32A7\u30FB\uFF6D\u30FB\uFF62",
      wpConfig.url,
      keyword,
      "\u96B0\u58FD\u30FB\u30FB\uFF68\u30FB\uFF7F\u964B\u5E36\u32A7\u30FB\uFF6D\u30FB\uFF62"
    );
  } catch (notifyError) {
    console.error("Schedule failure notification failed:", notifyError);
  }
}
function summarizeFactCheckContentChanges(beforeContent, afterContent, maxItems = 5) {
  const beforeLines = String(beforeContent || "").replace(/\r\n/g, "\n").split("\n");
  const afterLines = String(afterContent || "").replace(/\r\n/g, "\n").split("\n");
  const maxLines = Math.max(beforeLines.length, afterLines.length);
  const summaries = [];
  for (let i = 0; i < maxLines && summaries.length < maxItems; i += 1) {
    const beforeRaw = beforeLines[i] ?? "";
    const afterRaw = afterLines[i] ?? "";
    const beforeLine = trimForLog(beforeRaw, 120);
    const afterLine = trimForLog(afterRaw, 120);
    if (beforeLine === afterLine) continue;
    summaries.push(
      `${summaries.length + 1}. L${i + 1}
\u95D6\uFF6B\u30FB\uFF6E\u96CE\u30FB\uFF7D\uFF63\u9677\u4EE3\u30FB ${beforeLine || "(\u9A55\uFF68\u30FB\uFF7A\u9AEF\uFF66\u7E5D\uFF7B"}
\u95D6\uFF6B\u30FB\uFF6E\u96CE\u30FB\uFF7D\uFF63\u965F\u8F14\u30FB ${afterLine || "(\u9A55\uFF68\u30FB\uFF7A\u9AEF\uFF66\u7E5D\uFF7B"}`
    );
  }
  return summaries;
}
function buildCompetitorSearchAuthAttempts(anonKeyRaw, serviceRoleKeyRaw) {
  const candidates = [
    { label: "anon", value: String(anonKeyRaw || "").trim() },
    { label: "service", value: String(serviceRoleKeyRaw || "").trim() }
  ].filter((candidate) => candidate.value.length > 0);
  const apiCandidates = [
    candidates.find((candidate) => candidate.label === "service"),
    candidates.find((candidate) => candidate.label === "anon")
  ].filter(Boolean);
  const jwtCandidates = candidates.filter((candidate) => isLikelyJwt(candidate.value));
  const nonJwtCandidates = candidates.filter((candidate) => !isLikelyJwt(candidate.value));
  const authCandidates = [...jwtCandidates, ...nonJwtCandidates];
  const attempts = [];
  const seen = /* @__PURE__ */ new Set();
  const pushAttempt = (name, headers) => {
    const fingerprint = `${name}:${Object.keys(headers).sort().join("|")}:${headers.apikey?.length ?? 0}:${headers.Authorization ? 1 : 0}`;
    if (seen.has(fingerprint)) return;
    seen.add(fingerprint);
    attempts.push({ name, headers });
  };
  for (const apiCandidate of apiCandidates) {
    for (const authCandidate of authCandidates) {
      pushAttempt(
        `auth-${authCandidate.label}-apikey-${apiCandidate.label}`,
        {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${authCandidate.value}`,
          "apikey": apiCandidate.value
        }
      );
    }
    for (const authCandidate of authCandidates) {
      pushAttempt(
        `auth-only-${authCandidate.label}`,
        {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${authCandidate.value}`
        }
      );
    }
    pushAttempt(
      `apikey-only-${apiCandidate.label}`,
      {
        "Content-Type": "application/json",
        "apikey": apiCandidate.value
      }
    );
  }
  if (attempts.length === 0) {
    attempts.push({
      name: "no-auth-header",
      headers: { "Content-Type": "application/json" }
    });
  }
  return attempts;
}
async function conductCompetitorResearchViaEdgeFunction(keyword, serpApiKey, limit = 5) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl) {
    throw new Error("SUPABASE_URL is missing");
  }
  if (!anonKey && !serviceRoleKey) {
    throw new Error("SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY is missing");
  }
  const endpoint = `${supabaseUrl}/functions/v1/competitor-search`;
  const body = JSON.stringify({ keyword, limit, serpApiKey });
  const attempts = buildCompetitorSearchAuthAttempts(anonKey, serviceRoleKey);
  const errors = [];
  for (const attempt of attempts) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: attempt.headers,
      body
    });
    if (response.ok) {
      const data = await response.json();
      return {
        articles: Array.isArray(data?.topArticles) ? data.topArticles : [],
        averageLength: Number.isFinite(Number(data?.averageLength)) ? Number(data.averageLength) : 0,
        commonTopics: Array.isArray(data?.commonTopics) ? data.commonTopics : []
      };
    }
    const text = await response.text();
    const reason = `${attempt.name} -> ${response.status} ${trimForLog(text, 220)}`;
    errors.push(reason);
    if (response.status >= 400 && response.status < 500 && response.status !== 401 && response.status !== 403) {
      throw new Error(`competitor-search error: ${reason}`);
    }
  }
  throw new Error(
    `competitor-search auth failed after ${attempts.length} attempts. Details: ${errors.join(" | ")}. If this persists, deploy competitor-search with verify_jwt disabled.`
  );
}
async function conductCompetitorResearchWithFallback(keyword, serpApiKey, limit = 5) {
  try {
    const deepResult = await conductCompetitorResearchViaEdgeFunction(keyword, serpApiKey, limit);
    if (deepResult.articles.length > 0) {
      console.log(`Deep competitor research completed via competitor-search (${deepResult.articles.length} articles)`);
      return deepResult;
    }
    console.warn("competitor-search returned no articles. Falling back to inline scraper.");
  } catch (error) {
    console.warn("competitor-search failed. Falling back to inline scraper:", error);
  }
  return await conductCompetitorResearch(keyword, serpApiKey, limit);
}
async function conductCompetitorResearch(keyword, serpApiKey, limit = 5) {
  const searchUrl = `https://serpapi.com/search.json?engine=google&q=${encodeURIComponent(keyword)}&api_key=${serpApiKey}&gl=jp&hl=ja&num=${limit}`;
  const searchRes = await fetch(searchUrl);
  if (!searchRes.ok) {
    throw new Error(`SerpAPI error: ${searchRes.status}`);
  }
  const searchData = await searchRes.json();
  const results = searchData.organic_results || [];
  const articles = [];
  for (const item of results.slice(0, limit)) {
    const url = item.link;
    console.log(`Scraping: ${url}`);
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), 8e3);
      const res = await fetch(url, {
        headers: {
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36"
        },
        signal: controller.signal
      });
      clearTimeout(id);
      if (!res.ok) throw new Error(`Fetch failed: ${res.status}`);
      const html = await res.text();
      const h2Matches = html.match(/<h2[^>]*>([^<]+)<\/h2>/gi) || [];
      const h3Matches = html.match(/<h3[^>]*>([^<]+)<\/h3>/gi) || [];
      const headings = [...h2Matches, ...h3Matches].map((h) => h.replace(/<\/?[^>]+(>|$)/g, "").trim()).filter((h) => h.length > 2 && h.length < 100).slice(0, 10);
      articles.push({
        title: item.title,
        url,
        domain: new URL(url).hostname,
        headings: headings.length > 0 ? headings : [item.title],
        metaDescription: item.snippet || ""
      });
    } catch (err) {
      console.error(`Scraping failed for ${url}:`, err.message);
      articles.push({
        title: item.title,
        url,
        domain: new URL(url).hostname,
        headings: [item.title],
        metaDescription: item.snippet || ""
      });
    }
  }
  return {
    articles,
    averageLength: 2500,
    commonTopics: []
  };
}
