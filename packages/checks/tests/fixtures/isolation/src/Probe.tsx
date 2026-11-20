/** One of each element the catalog's own pages style, so a test can see whether any catalog style reaches a drawn component. */
export function Probe({ tone = "calm" }: { tone?: "calm" | "loud" }) {
  return (
    <div className="probe" data-tone={tone}>
      <p data-probe="text">plain text</p>
      <h2 data-probe="h2">a heading</h2>
      <nav data-probe="nav">
        <a href="#here" data-probe="link">
          a link
        </a>
      </nav>
      <table>
        <tbody>
          <tr>
            <td data-probe="td">a cell</td>
          </tr>
        </tbody>
      </table>
      <div className="grid" data-probe="grid">
        a grid
      </div>
    </div>
  )
}
