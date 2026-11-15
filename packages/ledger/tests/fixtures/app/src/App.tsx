import Layout from "./ui/Layout"
import { Button, FancyCard, extras } from "./ui"
import { Ghost } from "./ui/Button"
import { Lazy } from "./ui/Lazy"
import { CycleA } from "./ui/CycleA"
import { Badge } from "./ui/TypeOnly"
import "./ui/theme.css"
import "./ui/missing"
import "@/nowhere"
import "not-installed-package"
import raw from "./ui/theme.css?raw"

export function App() {
  return (
    <Layout>
      <Button />
      <FancyCard />
      <extras.Chip />
      <Lazy />
      <CycleA />
      <Badge />
      {raw}
      {String(Ghost)}
    </Layout>
  )
}
