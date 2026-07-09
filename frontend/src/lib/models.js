export const MODELS = [
  {
    value: "qwen3.5:4b",
    label: "Qwen3.5",
    description: "Fast & general",
  },
  {
    value: "deepseek-r1:7b",
    label: "DeepSeek R1",
    description: "Deep reasoning",
  },
]

export const DEFAULT_MODEL = MODELS[0].value

export function getModel(value) {
  return MODELS.find((m) => m.value === value) ?? MODELS[0]
}
