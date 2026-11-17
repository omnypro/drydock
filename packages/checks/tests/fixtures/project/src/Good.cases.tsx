import { skip, type Cases } from "@drydock/catalog/cases"
import { Good } from "./Good"

export default {
  sample: { label: "Save" },
  each: { onPick: skip("a click handler draws nothing") },
  more: { "Long label": { width: 120, render: <Good label="Save the changes to every field" /> } },
} satisfies Cases<typeof Good>
