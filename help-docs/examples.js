/* Ready-made help-page sources. Paste into the playground or the client editor
 * (Server settings → Help button). One api.* call per line, // comments allowed.
 * Source of truth: client/src/components/server-help/builder.ts
 */
(function () {
  "use strict";

  var RULES_FAQ = [
    "// Example: rules and FAQ behind the `?` button.",
    "// One api.* call per line; full JavaScript is not supported here.",
    'api.page("rules", "Rules");',
    'api.text("Server rules", { size: "lg", weight: "bold", align: "center" });',
    'api.text("1. No spam or flooding the chat.");',
    'api.text("2. Be kind to other members.");',
    "api.divider();",
    'api.checkbox("read", "I have read the rules");',
    'api.select("topic", "Question topic", ["Roles", "Voice", "Files"], "Roles");',
    'api.button("Open FAQ", { toPage: "faq" });',
    'api.button("Got it", { variant: "primary" });',
    "",
    'api.page("faq", "FAQ");',
    'api.text("Frequently asked questions", { size: "md", weight: "bold" });',
    'api.text("How do I get a role? Ask an administrator in the chat.");',
    'api.button("Back to rules", { toPage: "rules" });',
    "",
  ].join("\n");

  var RULES_GATE = [
    "// Rules gate: newcomers see only this page and cannot write until accept.",
    "// The server re-checks `requires` on help.accept; leaving resets acceptance.",
    'api.gate("rules");',
    'api.page("rules", "Rules", { audience: "pending" });',
    'api.text("Server rules", { size: "lg", weight: "bold", align: "center" });',
    'api.text("1. No spam or flooding the chat.");',
    'api.text("2. Be kind to other members.");',
    "api.divider();",
    'api.checkbox("agree", "I have read the rules");',
    'api.button("Accept the rules", { variant: "primary", accept: true, requires: ["agree"] });',
    "",
    'api.page("news", "News", { audience: "accepted" });',
    'api.text("Welcome inside! Only accepted members see this page.");',
    'api.button("Back to rules", { toPage: "rules" });',
    "",
  ].join("\n");

  var ONBOARDING = [
    "// Onboarding: first screen every newcomer sees.",
    'api.page("start", "Welcome");',
    'api.text("Welcome!", { size: "lg", weight: "bold", align: "center" });',
    'api.text("Pick a nickname style in your profile, say hi in the chat.");',
    "api.divider();",
    'api.switch("notify", "Notify me about events");',
    'api.select("lang", "Language", ["EN", "RU", "ZH"], "EN");',
    'api.button("Read the rules", { toPage: "rules", variant: "primary" });',
    "",
    'api.page("rules", "Rules");',
    'api.text("Short rules", { size: "md", weight: "bold" });',
    'api.text("No spam. No insults. Spoilers stay in threads.");',
    'api.checkbox("agree", "I agree with the rules", true);',
    'api.button("Back", { toPage: "start" });',
    'api.button("Close", { close: true });',
    "",
  ].join("\n");

  var VOICE_GUIDE = [
    "// Voice guide: push-to-talk, mute, screen share limits.",
    'api.page("voice", "Voice");',
    'api.text("Voice rooms", { size: "md", weight: "bold" });',
    'api.text("Join a voice channel, check your mic, use push-to-talk in noisy rooms.");',
    "api.divider();",
    'api.select("mic", "Microphone mode", ["Voice activity", "Push-to-talk"], "Voice activity");',
    'api.switch("noise", "Noise suppression", true);',
    'api.button("Common issues", { toPage: "issues" });',
    "",
    'api.page("issues", "Issues");',
    'api.text("No sound? Leave and rejoin the channel first.");',
    'api.text("Robot voice? Lower screen-share resolution in settings.");',
    'api.button("Back to voice", { toPage: "voice" });',
    "",
  ].join("\n");

  window.HELP_EXAMPLES = {
    rulesFaq: { id: "rulesFaq", source: RULES_FAQ },
    rulesGate: { id: "rulesGate", source: RULES_GATE },
    onboarding: { id: "onboarding", source: ONBOARDING },
    voiceGuide: { id: "voiceGuide", source: VOICE_GUIDE },
  };
})();
