import { PageHead, Card } from '../../components/ui'

// Placeholder for a screen that is specified but not built yet.
export default function Screen({ screen }) {
  return (
    <>
      <PageHead title={screen.label} sub={`Planned for build phase ${screen.phase}.`} />
      <Card title="What this screen will do">
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {screen.does.map((d) => <li key={d}>{d}</li>)}
        </ul>
      </Card>
    </>
  )
}
