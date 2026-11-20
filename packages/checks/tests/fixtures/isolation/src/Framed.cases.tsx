import type { Cases } from "@drydock/catalog/cases"
import { Framed } from "./Framed"

export default {
  sample: {},
  windows: { small: [300, 200] },
  more: {
    "In a window": { window: "small", render: <Framed /> },
  },
} satisfies Cases<typeof Framed>
