import type { ComponentShape } from "@drydock/reader"
import type { Props } from "./valid"

/** The props a component is drawn with when no cases file gives a sample, and the required props that have no value. */
/**
 * `guessedChildren` is `true` when the children were given only because the type allows them. Some elements allow them in
 * the type and throw when given any, such as `input`, so the page keeps a drawing without them in reserve.
 */
export type AutoSample = { props: Props; unset: string[]; guessedChildren: boolean }

// Each test reads the whole type as the compiler prints it. A type that only mentions a node (`ReactNode[]`, a record of
// nodes, a function that returns one) is none of these, and a value made for it would be the wrong kind of thing.
const isNode = (type: string) => /^(import\("react"\)\.|React\.)?ReactNode$/.test(type)
const isElement = (type: string) => /^(import\("react"\)\.|React\.)?(ReactElement(<[^[\]]*>)?|JSX\.Element)$/.test(type)
const isCallback = (type: string) => /^\([^()]*\)\s*=>\s*[^[\]&|]+$/.test(type)

/**
 * A sample made from the component's own types, so a component draws before anyone writes a cases file.
 * The required props get a value, and so do children: the first value of a choice, `false` for a switch, the prop's name for text,
 * 1 for a number, a function that does nothing for a callback, and the component's name for its children.
 * `element` makes an element from text, for a prop whose type takes nothing else. The generator itself holds no React.
 * A required prop of any other type is left out and named in `unset`: only a person, or a cases file, can give it.
 */
export function autoSample(shape: ComponentShape, element?: (text: string) => unknown): AutoSample {
  const props: Props = {}
  const unset: string[] = []
  for (const prop of shape.props) {
    // Optional children are the one optional prop that is filled: without content most components draw nothing at all.
    if (prop.optional && !(prop.name === "children" && isNode(prop.type))) continue
    const text = prop.name === "children" ? shape.name : prop.name
    if (prop.kind === "union") props[prop.name] = prop.values[0]
    else if (prop.kind === "boolean") props[prop.name] = false
    else if (isCallback(prop.type)) props[prop.name] = () => {}
    else if (prop.type === "string" || isNode(prop.type)) props[prop.name] = text
    else if (prop.type === "number") props[prop.name] = 1
    else if (isElement(prop.type) && element) props[prop.name] = element(text)
    else unset.push(prop.name)
  }
  // Children that only a native element's props declare are not in `props`, so the shape says whether the component takes any.
  // A component that declares its own children has said what they are, and the loop above has dealt with them.
  const declared = shape.props.some((prop) => prop.name === "children")
  const guessedChildren = shape.takesChildren && !declared
  if (guessedChildren) props.children = shape.name
  return { props, unset, guessedChildren }
}
