import type { Cases } from "@drydock/catalog/cases"
import { Probe } from "./Probe"

export default {
  sample: { tone: "calm" },
  windows: { small: [400, 300] },
  more: {
    "In a window": { window: "small", render: <Probe tone="calm" /> },
  },
} satisfies Cases<typeof Probe>
