/** A component that needs real data, which no one can make up from its type. */
export function Needy({ title, room }: { title: string; room: { id: string; seats: number } }) {
  return (
    <p>
      {title}: {room.id}
    </p>
  )
}
