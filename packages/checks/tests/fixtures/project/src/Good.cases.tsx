import { skip, type Cases } from "@drydock/catalog/cases"
import { Good } from "./Good"

export default {
  sample: { label: "Save" },
  each: { onPick: skip("a click handler draws nothing") },
  windows: { small: [320, 200] },
  more: {
    "Long label": { width: 120, render: <Good label="Save the changes to every field" /> },
    "In a window": { window: "small", render: <Good label="Save" /> },
  },
} satisfies Cases<typeof Good>
