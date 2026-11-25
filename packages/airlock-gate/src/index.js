// airlock-gate: an on-device privacy gate for outgoing agent messages.
export { AirlockGate, GateDeclined } from "./gate.js";
export { Vault } from "./vault.js";
export { RuleDetector, VaultDetector, fromScrubEngine, mergeFindings, verhoeffValid, verhoeffDigit } from "./detectors.js";
export { DEFAULT_POLICY, definePolicy, incomeRangeAbstraction, parseRupees, ruleFor, replacementFor } from "./policy.js";
export { installOnRuntime, wrapConsent } from "./runtime.js";
export { buildLearnCard, cardReviewer, consentRenderer, learnLines } from "./card.js";
