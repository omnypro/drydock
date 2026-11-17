import type { Cases } from "@drydock/catalog/cases"
import { Ringless } from "./Ringless"

export default {
  sample: { label: "Go" },
  windows: { small: [320, 200] },
  more: { "In a window": { window: "small", render: <Ringless label="Go" /> } },
} satisfies Cases<typeof Ringless>
