/**
 * Piper ru_RU voices considered for AZAROV Alerts.
 *
 * Checked 2026-10-07 against huggingface.co/rhasspy/piper-voices MODEL_CARD:
 * - dmitri medium: dataset CC0 (OHF-Voice/voice-datasets). Recommended.
 * - denis medium: dataset CC0 (OHF-Voice/voice-datasets). Alternate sample.
 * - ruslan medium: dataset CC BY-NC-SA 4.0 — not used (non-commercial SA).
 * - irina medium: dataset license Unknown (RHVoice) — not used.
 *
 * Piper itself is MIT. Production stays on a CC0 voice until ops picks one.
 */
export const PIPER_VOICE_CANDIDATES = {
  dmitri: {
    id: "dmitri",
    language: "ru_RU",
    quality: "medium",
    datasetLicense: "CC0",
    modelFile: "ru_RU-dmitri-medium.onnx",
    hfPath: "ru/ru_RU/dmitri/medium/ru_RU-dmitri-medium.onnx",
  },
  denis: {
    id: "denis",
    language: "ru_RU",
    quality: "medium",
    datasetLicense: "CC0",
    modelFile: "ru_RU-denis-medium.onnx",
    hfPath: "ru/ru_RU/denis/medium/ru_RU-denis-medium.onnx",
  },
} as const;

export const DEFAULT_PIPER_VOICE = "dmitri";
